const user = API.user();
const message = document.getElementById('agentMessage');
const inviteBox = document.getElementById('inviteBox');
let lastInviteLink = '';

if (!API.token() || !['agent', 'admin'].includes(user?.role)) {
  window.location.href = '/';
}

document.getElementById('logoutBtn').addEventListener('click', () => {
  API.clearAuth();
  window.location.href = '/';
});

document
  .getElementById('createSessionBtn')
  .addEventListener('click', async () => {
    try {
      const data = await API.request('/api/session/create', {
        method: 'POST',
        body: '{}',
      });
      lastInviteLink = data.inviteLink;
      inviteBox.classList.remove('empty');
      inviteBox.innerHTML = `
      <p>
      Token Id - <strong>${data.session.inviteToken}</strong>
      </p>
      <input readonly value="${data.inviteLink}">
      <a class="primary link-button" href="/call.html?sessionId=${data.session.sessionId}">Join as Agent</a>
    `;
      await loadHistory();
    } catch (error) {
      message.textContent = error.message;
    }
  });

document.getElementById('copyInviteBtn').addEventListener('click', async () => {
  if (!lastInviteLink) return;
  await navigator.clipboard.writeText(lastInviteLink);
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

async function loadHistory() {
  const data = await API.request('/api/admin/history');
  document.getElementById('historyRows').innerHTML = data.sessions
    .slice(0, 10)
    .map(
      (session) => `
      <tr>
        <td>${session.sessionId}</td>
        <td><span class="status ${session.status.toLowerCase()}">${session.status}</span></td>
        <td>${session.customerName || session.customerId?.name || '-'}</td>
        <td>${API.formatTime(session.startTime)}</td>
        <td>${API.formatDuration(session.duration)}</td>
        <td>${recordingAction(session.latestRecording)}</td>
        <td>${session.status === 'Active' ? `<a href="/call.html?sessionId=${session.sessionId}">Join / Record</a>` : `<a href="/history.html?sessionId=${session.sessionId}">View</a>`}</td>
      </tr>
    `,
    )
    .join('');
}

function recordingAction(recording) {
  if (!recording) return '<span class="hint">Not recorded</span>';
  if (recording.status === 'Ready' && recording.recordingPath) {
    return `<a href="${recording.recordingPath}" target="_blank" rel="noopener">Play</a> · <a href="${recording.recordingPath}" download>Download MP4</a>`;
  }
  return `<span class="recording-status">${recording.status === 'Recording' ? 'In progress' : recording.status}</span>`;
}

loadHistory().catch((error) => {
  message.textContent = error.message;
});
