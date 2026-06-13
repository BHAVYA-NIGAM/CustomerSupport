const express = require('express');
const Session = require('../models/Session');
const metrics = require('../services/metrics');

const router = express.Router();

router.get('/', async (req, res) => {
  const [activeSessions, totalCalls] = await Promise.all([
    Session.countDocuments({ status: 'Active' }),
    Session.countDocuments({})
  ]);
  res.json(metrics.snapshot(activeSessions, totalCalls));
});

router.get('/prometheus', async (req, res) => {
  const [activeSessions, totalCalls] = await Promise.all([
    Session.countDocuments({ status: 'Active' }),
    Session.countDocuments({})
  ]);
  const snap = metrics.snapshot(activeSessions, totalCalls);
  res.type('text/plain').send(
    [
      `customersupport_active_sessions ${snap.activeSessions}`,
      `customersupport_connected_users ${snap.connectedUsers}`,
      `customersupport_total_calls ${snap.totalCalls}`,
      `customersupport_error_count ${snap.errorCount}`
    ].join('\n')
  );
});

module.exports = router;
