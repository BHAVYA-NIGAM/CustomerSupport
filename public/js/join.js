const params = new URLSearchParams(window.location.search);
const pathToken = window.location.pathname.startsWith('/join/')
  ? decodeURIComponent(window.location.pathname.split('/join/')[1] || '')
  : '';
const tokenFromUrl = params.get('token') || pathToken;
const inviteInput = document.getElementById('inviteToken');
const summary = document.getElementById('inviteSummary');
const message = document.getElementById('joinMessage');
const hasExitMessage = params.has('ended') || params.has('left');

inviteInput.value = tokenFromUrl;

if (params.get('ended')) {
  summary.textContent = sessionStorage.getItem('callEndedMessage') || 'The call has ended.';
  sessionStorage.removeItem('callEndedMessage');
} else if (params.get('left')) {
  summary.textContent = 'You left the call. Paste another invite link whenever you are ready.';
}

function extractInviteToken(value) {
  const rawValue = value.trim();
  if (!rawValue) return '';

  try {
    const parsed = new URL(rawValue);
    const queryToken = parsed.searchParams.get('token');
    if (queryToken) return queryToken.trim();

    const pathParts = parsed.pathname.split('/').filter(Boolean);
    return pathParts[pathParts.length - 1] || rawValue;
  } catch (error) {
    const pathParts = rawValue.split('/').filter(Boolean);
    return pathParts[pathParts.length - 1] || rawValue;
  }
}

async function checkInvite() {
  const inviteToken = extractInviteToken(inviteInput.value);
  if (!inviteToken) {
    if (!hasExitMessage) summary.textContent = 'Paste your invite link or token to join the support session.';
    return;
  }
  try {
    const data = await API.request(`/api/session/invite/${encodeURIComponent(inviteToken)}`);
    summary.textContent = `You are joining a live session with ${data.agentName}.`;
  } catch (error) {
    summary.textContent = error.message;
  }
}

inviteInput.addEventListener('input', checkInvite);

document.getElementById('joinForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const submitButton = event.currentTarget.querySelector('button[type="submit"]');
  const inviteToken = extractInviteToken(inviteInput.value);
  message.textContent = '';
  submitButton.disabled = true;
  submitButton.textContent = 'Joining...';

  try {
    const data = await API.request('/api/session/customer-join', {
      method: 'POST',
      body: JSON.stringify({
        inviteToken,
        name: document.getElementById('customerName').value
      })
    });
    API.setAuth(data.token, data.user);
    window.location.href = `/call.html?sessionId=${data.sessionId}`;
  } catch (error) {
    message.textContent = error.message === 'Invite is invalid or session has ended'
      ? 'That invite link is invalid or the agent has already ended the session. Ask the agent to create a fresh session.'
      : error.message;
    submitButton.disabled = false;
    submitButton.textContent = 'Join Call';
  }
});

checkInvite();
