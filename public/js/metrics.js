const ctx = document.getElementById('metricsChart');
const labels = [];
const activeData = [];
const connectedData = [];

const chart = new Chart(ctx, {
  type: 'line',
  data: {
    labels,
    datasets: [
      {
        label: 'Active Sessions',
        data: activeData,
        borderColor: '#00a88f',
        tension: 0.35,
      },
      {
        label: 'Connected Users',
        data: connectedData,
        borderColor: '#f2a900',
        tension: 0.35,
      },
    ],
  },
  options: {
    responsive: true,
    plugins: { legend: { labels: { color: '#102027' } } },
    scales: {
      x: { ticks: { color: '#445' } },
      y: { ticks: { color: '#445' }, beginAtZero: true },
    },
  },
});

async function refreshMetrics() {
  const data = await API.request('/api/metrics');
  document.getElementById('activeSessions').textContent = data.activeSessions;
  document.getElementById('connectedUsers').textContent = data.connectedUsers;
  document.getElementById('totalCalls').textContent = data.totalCalls;
  document.getElementById('errorCount').textContent = data.errorCount;

  labels.push(new Date(data.timestamp).toLocaleTimeString());
  activeData.push(data.activeSessions);
  connectedData.push(data.connectedUsers);

  if (labels.length > 12) {
    labels.shift();
    activeData.shift();
    connectedData.shift();
  }
  chart.update();
}

refreshMetrics();
setInterval(refreshMetrics, 5000);
document.getElementById('logoutBtn').addEventListener('click', () => {
  API.clearAuth();
  window.location.href = '/';
});
