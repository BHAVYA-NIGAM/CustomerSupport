async function loadAdmin() {
  const [live, history] = await Promise.all([
    API.request('/api/admin/live-sessions'),
    API.request('/api/admin/history'),
  ]);

  document.getElementById('liveSessions').innerHTML = live.sessions.length
    ? live.sessions
        .map(
          (session) => `
      <article class="mini-card">
        <strong>${session.sessionId}</strong>
        <p>Agent: ${session.agentId?.name || '-'}</p>
        <p>Customer: ${session.customerName || session.customerId?.name || '-'}</p>
        <p>Duration: ${API.formatDuration(Math.round((Date.now() - new Date(session.startTime)) / 1000))}</p>

        <p>Recording: ${session.latestRecording?.status || 'Not started'}</p>
        <div class="admin-meet-btn">
        <a class="primary link-button" href="/call.html?sessionId=${session.sessionId}">Join / Record</a>
        <button class="danger" onclick="endSession('${session.sessionId}')">End Session</button>
        </div>
        
      </article>
    `,
        )
        .join('')
    : '<p class="hint">No live sessions right now.</p>';

  document.getElementById('adminHistoryRows').innerHTML = history.sessions
    .slice(0, 10)
    .map(
      (session) => `
    <tr>
      <td>${session.sessionId}</td>
      <td>${session.agentId?.name || '-'}</td>
      <td>${session.customerName || session.customerId?.name || '-'}</td>
      <td>${session.status}</td>
      <td>${API.formatDuration(session.duration)}</td>
      <td>${recordingAction(session.latestRecording)}</td>
      <td><a href="/history.html?sessionId=${session.sessionId}">View Events</a></td>
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

async function endSession(sessionId) {
  await API.request('/api/admin/end-session', {
    method: 'POST',
    body: JSON.stringify({ sessionId }),
  });
  await loadAdmin();
}

loadAdmin().catch(() => {
  window.location.href = '/';
});

document.getElementById('logoutBtn').addEventListener('click', () => {
  API.clearAuth();
  window.location.href = '/';
});
