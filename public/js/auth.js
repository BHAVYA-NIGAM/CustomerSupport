let mode = 'login';
const form = document.getElementById('authForm');
const message = document.getElementById('authMessage');
const signupFields = document.getElementById('signupFields');
const submitBtn = document.getElementById('authSubmitBtn');

function updateMode(nextMode) {
  mode = nextMode;
  signupFields.hidden = mode === 'login';
  form.name.required = mode === 'register';
  submitBtn.textContent = mode === 'login' ? 'Login' : 'Create Account';
  message.textContent = '';
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document
      .querySelectorAll('.tab')
      .forEach((item) => item.classList.remove('active'));
    tab.classList.add('active');
    updateMode(tab.dataset.mode);
  });
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  message.textContent = '';

  const payload = {
    email: form.email.value,
    password: form.password.value,
  };

  if (mode === 'register') {
    payload.name = form.name.value;
    payload.role = form.role.value;
  }

  try {
    const data = await API.request(`/api/auth/${mode}`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    API.setAuth(data.token, data.user);
    window.location.href =
      data.user.role === 'customer'
        ? '/join.html'
        : data.user.role === 'agent'
          ? '/agent.html'
          : '/admin.html';
  } catch (error) {
    message.textContent =
      mode === 'login' && error.message.includes('Invalid')
        ? 'Invalid email or password. If you have not seeded demo users yet, run npm run seed.'
        : error.message;
  }
});

updateMode(mode);
