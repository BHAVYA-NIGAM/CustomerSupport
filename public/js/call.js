const sessionId = new URLSearchParams(window.location.search).get('sessionId');
const user = API.user();
const socket = io({ auth: { token: API.token() }, reconnection: true });

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const remoteAudio = document.getElementById('remoteAudio');
const callMessage = document.getElementById('callMessage');
const chatMessages = document.getElementById('chatMessages');
const recordingBox = document.getElementById('recordingBox');
const remoteAvatar = document.getElementById('remoteAvatar');
const localAvatar = document.getElementById('localAvatar');
const remoteLabel = document.getElementById('videoLabel');

let device;
let localStream;
let sendTransport;
let recvTransport;
let audioProducer;
let videoProducer;
let screenProducer;
let screenStream;
let audioEnabled = true;
let videoEnabled = true;
let sharingScreen = false;
let callStarted = false;
let rebuilding = false;
let recordingPollTimer;
const consumers = new Map();
const videoConsumers = new Map();
const remoteVideoStream = new MediaStream();
const remoteAudioStream = new MediaStream();

document.getElementById('sessionLabel').textContent = sessionId || 'unknown';
document.getElementById('localVideoLabel').textContent =
  `${user?.name || 'You'} (You)`;
document.getElementById('localInitials').textContent = initials(
  user?.name || 'You',
);

if (!sessionId || !API.token()) window.location.href = '/';
if (user?.role === 'customer') {
  document.querySelectorAll('.agent-only').forEach((item) => item.remove());
} else {
  document.querySelectorAll('.customer-only').forEach((item) => item.remove());
}

function socketRequest(event, payload = {}) {
  return new Promise((resolve, reject) => {
    socket.emit(event, payload, (response) => {
      if (!response || response.ok === false)
        reject(new Error(response?.message || `${event} failed`));
      else resolve(response);
    });
  });
}

async function getLocalMedia() {
  if (localStream?.active) return;

  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Camera and microphone require HTTPS or localhost.');
  }

  localStream = new MediaStream();
  let mediaError;

  try {
    const combinedStream = await navigator.mediaDevices.getUserMedia({
      audio: true,
      video: true,
    });
    combinedStream.getTracks().forEach((track) => localStream.addTrack(track));
  } catch (error) {
    mediaError = error;
    await requestOptionalTrack({ video: true }, 'camera');
    await requestOptionalTrack({ audio: true }, 'microphone');
  }

  localVideo.srcObject = localStream;
  const hasVideo = localStream.getVideoTracks().length > 0;
  const hasAudio = localStream.getAudioTracks().length > 0;
  videoEnabled = hasVideo;
  audioEnabled = hasAudio;
  localAvatar.classList.toggle('visible', !hasVideo);
  updateControl('cameraBtn', hasVideo);
  updateControl('muteBtn', hasAudio);

  if (hasVideo) await localVideo.play().catch(() => {});
  if (!hasVideo && !hasAudio) {
    throw new Error(
      mediaError?.name === 'NotAllowedError'
        ? 'Camera and microphone are blocked. Allow browser permissions, then refresh the meeting.'
        : 'No camera or microphone was found. Connect a device, then refresh the meeting.',
    );
  }
  if (!hasVideo || !hasAudio) {
    callMessage.textContent = hasVideo
      ? 'Camera is on, but microphone is unavailable or blocked.'
      : 'Microphone is on, but camera is unavailable or blocked.';
  }
}

async function requestOptionalTrack(constraints, label) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    stream.getTracks().forEach((track) => localStream.addTrack(track));
  } catch (error) {
    console.warn(`${label} unavailable`, error);
  }
}

async function buildMediaConnection(isReconnect = false) {
  if (rebuilding) return;
  rebuilding = true;

  try {
    const join = await socketRequest('join-session', { sessionId });
    await getLocalMedia();
    closeTransports();

    const routerData = await socketRequest('get-router-rtp-capabilities', {
      sessionId,
    });
    device = new mediasoupClient.Device();
    await device.load({ routerRtpCapabilities: routerData.rtpCapabilities });

    await createSendTransport();
    await createReceiveTransport();

    const audioTrack = localStream.getAudioTracks()[0];
    const videoTrack = localStream.getVideoTracks()[0];
    if (audioTrack)
      audioProducer = await sendTransport.produce({
        track: audioTrack,
        appData: { source: 'microphone' },
      });
    if (videoTrack)
      videoProducer = await sendTransport.produce({
        track: videoTrack,
        appData: { source: 'camera' },
      });

    const { producers } = await socketRequest('list-producers', { sessionId });
    for (const producer of producers)
      await consumeProducer(
        producer.producerId,
        producer.user,
        producer.source,
      );

    callStarted = true;
    callMessage.textContent =
      join.reconnected || isReconnect
        ? 'Connection restored. You are back in the meeting.'
        : 'Connected.';
  } finally {
    rebuilding = false;
  }
}

async function createSendTransport() {
  const { params } = await socketRequest('create-webrtc-transport', {
    sessionId,
  });
  sendTransport = device.createSendTransport(params);

  sendTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
    socketRequest('connect-transport', {
      sessionId,
      transportId: sendTransport.id,
      dtlsParameters,
    })
      .then(callback)
      .catch(errback);
  });

  sendTransport.on(
    'produce',
    ({ kind, rtpParameters, appData }, callback, errback) => {
      socketRequest('produce', {
        sessionId,
        transportId: sendTransport.id,
        kind,
        rtpParameters,
        appData,
      })
        .then(({ id }) => callback({ id }))
        .catch(errback);
    },
  );

  sendTransport.on('connectionstatechange', (state) =>
    showConnectionState(state),
  );
}

async function createReceiveTransport() {
  const { params } = await socketRequest('create-webrtc-transport', {
    sessionId,
  });
  recvTransport = device.createRecvTransport(params);

  recvTransport.on('connect', ({ dtlsParameters }, callback, errback) => {
    socketRequest('connect-transport', {
      sessionId,
      transportId: recvTransport.id,
      dtlsParameters,
    })
      .then(callback)
      .catch(errback);
  });

  recvTransport.on('connectionstatechange', (state) =>
    showConnectionState(state),
  );
}

async function consumeProducer(producerId, producerUser, producerSource) {
  if (consumers.has(producerId) || !recvTransport) return;

  const { params } = await socketRequest('consume', {
    sessionId,
    producerId,
    rtpCapabilities: device.rtpCapabilities,
    transportId: recvTransport.id,
  });

  const consumer = await recvTransport.consume(params);
  const source = params.source || producerSource || consumer.kind;
  consumers.set(producerId, consumer);
  await socketRequest('resume-consumer', {
    sessionId,
    consumerId: consumer.id,
  });
  consumer.track.enabled = true;
  setRemoteParticipant(producerUser?.name);

  if (consumer.kind === 'video') {
    videoConsumers.set(producerId, { consumer, source });
    await renderPreferredRemoteVideo();
  } else {
    remoteAudioStream.addTrack(consumer.track);
    remoteAudio.srcObject = remoteAudioStream;
    await remoteAudio.play().catch(() => {
      callMessage.textContent =
        'Remote audio is ready. Click anywhere in the meeting if your browser blocked autoplay.';
    });
  }

  consumer.on('transportclose', () => consumers.delete(producerId));
  consumer.on('trackended', () => {
    consumers.delete(producerId);
    if (consumer.kind === 'video') {
      videoConsumers.delete(producerId);
      renderPreferredRemoteVideo();
    }
  });
}

async function renderPreferredRemoteVideo() {
  const entries = [...videoConsumers.values()];
  const preferred =
    entries.find((entry) => entry.source === 'screen') ||
    entries.find((entry) => entry.source === 'camera');

  remoteVideoStream
    .getVideoTracks()
    .forEach((track) => remoteVideoStream.removeTrack(track));
  if (!preferred) {
    remoteAvatar.classList.add('visible');
    remoteVideo.srcObject = remoteVideoStream;
    return;
  }

  remoteVideoStream.addTrack(preferred.consumer.track);
  remoteVideo.srcObject = remoteVideoStream;
  remoteAvatar.classList.toggle('visible', preferred.consumer.track.muted);
  preferred.consumer.track.addEventListener(
    'unmute',
    () => remoteAvatar.classList.remove('visible'),
    { once: true },
  );
  await remoteVideo.play().catch(() => {});
}

function closeTransports() {
  consumers.forEach((consumer) => consumer.close());
  consumers.clear();
  videoConsumers.clear();
  audioProducer?.close();
  videoProducer?.close();
  screenProducer?.close();
  sendTransport?.close();
  recvTransport?.close();
  audioProducer = null;
  videoProducer = null;
  screenProducer = null;
}

function showConnectionState(state) {
  if (state === 'failed' || state === 'disconnected') {
    callMessage.textContent =
      'Network interrupted. Holding your place for 60 seconds while reconnecting...';
  }
}

socket.on('connect', async () => {
  if (callStarted && !rebuilding) {
    try {
      await buildMediaConnection(true);
    } catch (error) {
      callMessage.textContent = error.message;
    }
  }
});

socket.on('disconnect', () => {
  if (callStarted)
    callMessage.textContent =
      'Network interrupted. Holding your place for 60 seconds while reconnecting...';
});

socket.on('connect_error', (error) => {
  callMessage.textContent = `Meeting connection failed: ${error.message}`;
});

socket.on(
  'new-producer',
  async ({ producerId, user: producerUser, source }) => {
    try {
      await consumeProducer(producerId, producerUser, source);
    } catch (error) {
      callMessage.textContent = `Could not receive remote media: ${error.message}`;
    }
  },
);
socket.on('producer-closed', ({ producerId }) => {
  consumers.get(producerId)?.close();
  consumers.delete(producerId);
  videoConsumers.delete(producerId);
  renderPreferredRemoteVideo();
});

socket.on('chat-message', renderMessage);
socket.on('file-shared', renderFile);
socket.on('recording-status', ({ status, recording }) =>
  renderRecording(status, recording),
);
socket.on('session-ended', ({ recordingStatus }) => {
  stopLocalMedia();
  const message =
    recordingStatus === 'Processing'
      ? 'Call ended. The recording is being processed.'
      : 'Call ended by the agent or administrator.';
  redirectAfterCall(message);
});
socket.on('participant-left', ({ name }) => {
  callMessage.textContent = `${name} left after the 60-second reconnect window.`;
  remoteAvatar.classList.add('visible');
});
socket.on('participant-joined', ({ name }) => setRemoteParticipant(name));
socket.on('media-toggle', ({ name, kind, enabled }) => {
  setRemoteParticipant(name);
  if (kind === 'video') remoteAvatar.classList.toggle('visible', !enabled);
});

document.getElementById('muteBtn').addEventListener('click', async () => {
  if (!audioProducer && !localStream?.getAudioTracks().length) {
    callMessage.textContent = 'No microphone is available for this meeting.';
    return;
  }
  audioEnabled = !audioEnabled;
  if (audioEnabled) await audioProducer?.resume();
  else await audioProducer?.pause();
  localStream
    ?.getAudioTracks()
    .forEach((track) => (track.enabled = audioEnabled));
  socket.emit('media-toggle', {
    sessionId,
    kind: 'audio',
    enabled: audioEnabled,
  });
  updateControl('muteBtn', audioEnabled);
});

document.getElementById('cameraBtn').addEventListener('click', async () => {
  if (!videoProducer && !localStream?.getVideoTracks().length) {
    callMessage.textContent = 'No camera is available for this meeting.';
    return;
  }
  videoEnabled = !videoEnabled;
  if (videoEnabled) await videoProducer?.resume();
  else await videoProducer?.pause();
  localStream
    ?.getVideoTracks()
    .forEach((track) => (track.enabled = videoEnabled));
  localAvatar.classList.toggle('visible', !videoEnabled);
  socket.emit('media-toggle', {
    sessionId,
    kind: 'video',
    enabled: videoEnabled,
  });
  updateControl('cameraBtn', videoEnabled);
});

document
  .getElementById('shareScreenBtn')
  .addEventListener('click', async () => {
    try {
      if (sharingScreen) {
        await stopScreenShare();
        return;
      }

      screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      const screenTrack = screenStream.getVideoTracks()[0];
      if (!screenTrack || screenTrack.readyState !== 'live') {
        throw new Error(
          'The selected screen stopped sharing before it could be sent.',
        );
      }
      if (!sendTransport || sendTransport.closed) {
        throw new Error(
          'The media connection is not ready yet. Wait a moment and try again.',
        );
      }
      screenProducer = await sendTransport.produce({
        track: screenTrack,
        appData: { source: 'screen' },
      });
      sharingScreen = true;
      updateScreenShareControl(true);
      screenTrack.addEventListener(
        'ended',
        () => stopScreenShare().catch(() => {}),
        { once: true },
      );
    } catch (error) {
      screenStream?.getTracks().forEach((track) => track.stop());
      screenStream = null;
      sharingScreen = false;
      callMessage.textContent = `Screen sharing could not start: ${error.message}`;
    }
  });

async function stopScreenShare() {
  if (!sharingScreen) return;
  if (screenProducer && !screenProducer.closed) {
    await socketRequest('close-producer', {
      sessionId,
      producerId: screenProducer.id,
    }).catch(() => {});
    screenProducer.close();
  }
  screenProducer = null;
  screenStream?.getTracks().forEach((track) => track.stop());
  screenStream = null;
  sharingScreen = false;
  updateScreenShareControl(false);
}

document
  .getElementById('chatForm')
  .addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = document.getElementById('chatInput');
    const text = input.value.trim();
    if (!text) return;
    await socketRequest('chat-message', { sessionId, message: text });
    input.value = '';
  });

document
  .getElementById('fileForm')
  .addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = document.getElementById('fileInput');
    if (!input.files[0]) return;

    const form = new FormData();
    form.append('sessionId', sessionId);
    form.append('file', input.files[0]);

    try {
      await API.request('/api/files/upload', { method: 'POST', body: form });
      input.value = '';
    } catch (error) {
      callMessage.textContent = error.message;
    }
  });

document
  .getElementById('startRecordingBtn')
  ?.addEventListener('click', async () => {
    try {
      if (
        document
          .getElementById('startRecordingBtn')
          .querySelector('.material-symbols-outlined').textContent ===
        'stop_circle'
      ) {
        const data = await API.request('/api/recording/stop', {
          method: 'POST',
          body: JSON.stringify({ sessionId }),
        });

        renderRecording(data.recording.status, data.recording);
        updateRecordingButton(false);
      } else {
        const data = await API.request('/api/recording/start', {
          method: 'POST',
          body: JSON.stringify({ sessionId }),
        });

        renderRecording(data.recording.status, data.recording);
        updateRecordingButton(true);
      }
    } catch (error) {
      callMessage.textContent = error.message;
    }
  });


document.getElementById('endCallBtn')?.addEventListener('click', async () => {
  try {
    await API.request('/api/session/end', {
      method: 'POST',
      body: JSON.stringify({ sessionId }),
    });
    redirectAfterCall('Call ended successfully.');
  } catch (error) {
    callMessage.textContent = error.message;
  }
});

document.getElementById('leaveCallBtn')?.addEventListener('click', () => {
  stopLocalMedia();
  window.location.href = '/join.html?left=1';
});

function setupMeetingDetails(session) {
  const remoteName =
    user?.role === 'customer'
      ? session.agentId?.name
      : session.customerName || session.customerId?.name;
  setRemoteParticipant(remoteName);

  if (user?.role === 'customer') return;
  const link = `${window.location.origin}/join/${session.inviteToken}`;
  document.getElementById('meetingLink').value = link;
  document.getElementById('meetingToken').value = session.inviteToken;
  document
    .getElementById('meetingInfoBtn')
    ?.addEventListener('click', () =>
      document.getElementById('meetingInfoDialog').showModal(),
    );
  document
    .getElementById('closeMeetingInfoBtn')
    ?.addEventListener('click', () =>
      document.getElementById('meetingInfoDialog').close(),
    );
  document
    .getElementById('copyMeetingLinkBtn')
    ?.addEventListener('click', async () => {
      await navigator.clipboard.writeText(link);
      callMessage.textContent = 'Meeting link copied.';
    });
}

function setRemoteParticipant(name) {
  const displayName = name || 'Waiting for participant';
  remoteLabel.textContent = displayName;
  document.getElementById('remoteInitials').textContent = initials(displayName);
}

function initials(name) {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join('') || '?'
  );
}

function updateControl(id, enabled) {
  const button = document.getElementById(id);

  button.classList.toggle('off', !enabled);

  const icon = button.querySelector('.material-symbols-outlined');
  const label = button.querySelector('small');

  if (id === 'muteBtn') {
    icon.textContent = enabled ? 'mic' : 'mic_off';
    label.textContent = enabled ? 'Mic On' : 'Mic Off';
  }

  if (id === 'cameraBtn') {
    icon.textContent = enabled ? 'videocam' : 'videocam_off';
    label.textContent = enabled ? 'Camera On' : 'Camera Off';
  }
}

function updateScreenShareControl(active) {
  const button = document.getElementById('shareScreenBtn');
  const icon = button.querySelector('.material-symbols-outlined');
  const label = button.querySelector('small');

  button.classList.toggle('sharing', active);

  icon.textContent = active ? 'stop_screen_share' : 'present_to_all';

  label.textContent = active ? 'Stop Share' : 'Share Screen';
}

function renderRecording(status, recording) {
  updateRecordingButton(status === 'Recording');

  const label = status === 'Recording' ? 'In progress' : status;

  recordingBox.innerHTML = `
    Recording: <strong>${label}</strong>
    ${
      status === 'Ready' && recording?.recordingPath
        ? `
          · <button
              class="recording-play-button"
              data-recording-path="${recording.recordingPath}">
              Play
            </button>
          · <a href="${recording.recordingPath}" download>
              Download MP4
            </a>
        `
        : ''
    }
  `;

  clearTimeout(recordingPollTimer);

  if (status === 'Processing') {
    recordingPollTimer = setTimeout(refreshRecordingStatus, 2500);
  }
}

recordingBox.addEventListener('click', (event) => {
  const playButton = event.target.closest('.recording-play-button');
  if (playButton) openRecordingPlayer(playButton.dataset.recordingPath);
});

function openRecordingPlayer(path) {
  const player = document.getElementById('recordingPlayer');
  player.src = path;
  document.getElementById('recordingDownloadLink').href = path;
  document.getElementById('recordingPlayerDialog').showModal();
  player.play().catch(() => {});
}

document
  .getElementById('closeRecordingPlayerBtn')
  .addEventListener('click', () => {
    const player = document.getElementById('recordingPlayer');
    player.pause();
    document.getElementById('recordingPlayerDialog').close();
  });

async function refreshRecordingStatus() {
  try {
    const data = await API.request(`/api/recording/${sessionId}`);
    const latest = data.recordings[0];
    if (latest) renderRecording(latest.status, latest);
  } catch (error) {
    callMessage.textContent = error.message;
  }
}

function renderMessage(message) {
  const item = document.createElement('div');
  item.className = `chat-item ${message.senderRole === user.role ? 'mine' : ''}`;
  item.innerHTML = `<strong>${escapeHtml(message.senderName || message.senderRole)}</strong><span>${new Date(message.timestamp).toLocaleTimeString()}</span><p>${escapeHtml(message.message)}</p>`;
  chatMessages.appendChild(item);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function renderFile(file) {
  const item = document.createElement('div');
  item.className = `chat-item ${file.uploaderRole === user.role ? 'mine' : ''}`;
  item.innerHTML = `
    <strong>${escapeHtml(file.uploaderName || file.uploaderRole)}</strong>
    <span>${new Date(file.uploadedAt).toLocaleTimeString()}</span>
    <p>Shared file: <a href="${file.filePath}" target="_blank" rel="noopener">${escapeHtml(file.originalName)}</a></p>
  `;
  chatMessages.appendChild(item);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function stopLocalMedia() {
  clearTimeout(recordingPollTimer);
  closeTransports();
  screenStream?.getTracks().forEach((track) => track.stop());
  localStream?.getTracks().forEach((track) => track.stop());
  socket.disconnect();
}

function redirectAfterCall(message) {
  sessionStorage.setItem('callEndedMessage', message);
  stopLocalMedia();
  window.location.href =
    user?.role === 'customer'
      ? '/join.html?ended=1'
      : user?.role === 'admin'
        ? '/admin.html'
        : '/agent.html';
}

async function loadSession() {
  const data = await API.request(`/api/session/${sessionId}`);
  setupMeetingDetails(data.session);
  data.messages.forEach(renderMessage);
  data.files.forEach(renderFile);
  const latestRecording = data.recordings[0];
  if (latestRecording) renderRecording(latestRecording.status, latestRecording);
}

loadSession()
  .then(() => buildMediaConnection())
  .catch((error) => {
    callMessage.textContent = error.message;
  });

document.getElementById('copyInviteBtn').addEventListener('click', async () => {
  copyInviteBtn.innerHTML = `
    Copied <span class="material-symbols-outlined">check</span>
  `;

  setTimeout(() => {
    copyInviteBtn.innerHTML = `
      Copy Invite Link
      <span class="material-symbols-outlined copy">
        content_copy
      </span>
    `;
  }, 2000);
});

// const icon = document.querySelector('#muteBtn .material-symbols-outlined');

// if (audioEnabled) {
//   icon.textContent = 'mic';
// } else {
//   icon.textContent = 'mic_off';
// }

// const icon = document.querySelector('#cameraBtn .material-symbols-outlined');

// if (videoEnabled) {
//   icon.textContent = 'videocam';
// } else {
//   icon.textContent = 'videocam_off';
// }

function updateRecordingButton(isRecording) {
  const btn = document.getElementById('startRecordingBtn');
  if (!btn) return;

  const icon = btn.querySelector('.material-symbols-outlined');
  const label = btn.querySelector('small');

  if (isRecording) {
    icon.textContent = 'stop_circle';
    label.textContent = 'Stop Recording';
    btn.title = 'Stop recording';
  } else {
    icon.textContent = 'radio_button_checked';
    label.textContent = 'Start Recording';
    btn.title = 'Start recording';
  }
}
