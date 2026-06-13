const counters = {
  connectedUsers: 0,
  errorCount: 0
};

function userConnected() {
  counters.connectedUsers += 1;
}

function userDisconnected() {
  counters.connectedUsers = Math.max(0, counters.connectedUsers - 1);
}

function recordError(error) {
  counters.errorCount += 1;
  console.error(error);
}

function snapshot(activeSessions, totalCalls) {
  return {
    activeSessions,
    connectedUsers: counters.connectedUsers,
    totalCalls,
    errorCount: counters.errorCount,
    timestamp: new Date().toISOString()
  };
}

module.exports = { userConnected, userDisconnected, recordError, snapshot };
