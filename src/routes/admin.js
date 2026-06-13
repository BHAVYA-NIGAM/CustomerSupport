const express = require('express');
const Session = require('../models/Session');
const User = require('../models/User');
const SessionEvent = require('../models/SessionEvent');
const Recording = require('../models/Recording');
const { auth } = require('../middleware/auth');
const requireRole = require('../middleware/roles');
const { requireFields, cleanText } = require('../middleware/validate');
const mediasoupService = require('../services/mediasoupService');
const { stopRecordingIfActive } = require('../services/recordingService');
const { logSessionEvent } = require('../services/sessionEvents');
const { decorateRecording } = require('../services/assetLinks');

async function attachLatestRecordings(sessions) {
  const sessionIds = sessions.map((session) => session.sessionId);
  const recordings = await Recording.find({ sessionId: { $in: sessionIds } }).sort({ createdAt: -1 });
  const latestBySession = new Map();

  recordings.forEach((recording) => {
    if (!latestBySession.has(recording.sessionId)) latestBySession.set(recording.sessionId, recording);
  });

  return sessions.map((session) => ({
    ...session.toObject(),
    latestRecording: latestBySession.has(session.sessionId)
      ? decorateRecording(latestBySession.get(session.sessionId))
      : null
  }));
}

const router = express.Router();

router.use(auth, requireRole('admin', 'agent'));

router.get('/live-sessions', async (req, res) => {
  const sessions = await Session.find({ status: 'Active' })
    .populate('agentId', 'name email')
    .populate('customerId', 'name email')
    .sort({ startTime: -1 });
  res.json({ sessions: await attachLatestRecordings(sessions) });
});

router.get('/history', async (req, res) => {
  const [sessions, totalCalls, agents] = await Promise.all([
    Session.find({}).populate('agentId', 'name email').populate('customerId', 'name email').sort({ createdAt: -1 }).limit(100),
    Session.countDocuments({}),
    User.countDocuments({ role: 'agent' })
  ]);
  const events = await SessionEvent.find({}).sort({ createdAt: -1 }).limit(100);
  res.json({ sessions: await attachLatestRecordings(sessions), events, summary: { totalCalls, agents } });
});

router.post('/end-session', requireFields(['sessionId']), async (req, res) => {
  const session = await Session.findOne({ sessionId: cleanText(req.body.sessionId, 80) });
  if (!session) return res.status(404).json({ message: 'Session not found' });

  session.status = 'Ended';
  session.endTime = new Date();
  session.duration = Math.max(0, Math.round((session.endTime - session.startTime) / 1000));
  await session.save();
  await logSessionEvent(session.sessionId, 'session_ended_by_admin', req.user);
  const recording = await stopRecordingIfActive(session.sessionId);
  mediasoupService.closeRoom(session.sessionId);
  req.app.get('io').to(session.sessionId).emit('session-ended', {
    sessionId: session.sessionId,
    recordingStatus: recording?.status
  });
  res.json({ session, recording });
});

module.exports = router;
