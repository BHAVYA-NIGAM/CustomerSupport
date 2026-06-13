let sessions = [];
let events = [];

async function loadHistory() {
  const data = await API.request('/api/admin/history');
  sessions = data.sessions;
  events = data.events;
  renderSessions(sessions);

  const requestedSession = new URLSearchParams(window.location.search).get(
    'sessionId',
  );
  if (requestedSession) showEvents(requestedSession);
}

function renderSessions(items) {
  document.getElementById('fullHistoryRows').innerHTML = items
    .map(
      (session) => `
    <tr>
      <td>${session.sessionId}</td>
      <td>${session.agentId?.name || '-'}</td>
      <td>${session.customerName || session.customerId?.name || '-'}</td>
      <td><span class="status ${session.status.toLowerCase()}">${session.status}</span></td>
      <td>${API.formatTime(session.startTime)}</td>
      <td>${API.formatDuration(session.duration)}</td>
      <td>${recordingAction(session.latestRecording)}</td>
      <td><button class="secondary" onclick="showEvents('${session.sessionId}')">View Events</button></td>
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

function showEvents(sessionId) {
  document.getElementById('eventTitle').textContent = `Session ${sessionId}`;
  const sessionEvents = events.filter((event) => event.sessionId === sessionId);
  document.getElementById('eventLog').innerHTML = sessionEvents.length
    ? sessionEvents
        .map(
          (event) => `
      <article class="event-item">
        <strong>${event.type.replaceAll('_', ' ')}</strong>
        <span>${API.formatTime(event.createdAt)}</span>
        <p>${event.actorRole || 'system'}</p>
      </article>
    `,
        )
        .join('')
    : '<p class="hint">No events stored for this session.</p>';
}

document.getElementById('historySearch').addEventListener('input', (event) => {
  const query = event.target.value.toLowerCase().trim();
  renderSessions(
    sessions.filter((session) =>
      [
        session.sessionId,
        session.agentId?.name,
        session.customerName,
        session.customerId?.name,
        session.status,
      ]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(query)),
    ),
  );
});

loadHistory().catch(() => {
  window.location.href = '/';
});

const user = API.user();

const profile = document.getElementById('profile');

profile.href = user?.role === 'admin' ? '/admin.html' : '/agent.html';

profile.innerHTML = user?.role === 'admin' ? 'Admin' : 'Agent';

document.getElementById('logoutBtn').addEventListener('click', () => {
  API.clearAuth();
  window.location.href = '/';
});
