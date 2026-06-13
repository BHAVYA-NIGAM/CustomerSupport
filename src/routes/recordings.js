const express = require('express');
const Recording = require('../models/Recording');
const Session = require('../models/Session');
const { auth } = require('../middleware/auth');
const requireRole = require('../middleware/roles');
const { requireFields, cleanText } = require('../middleware/validate');
const { startRecording, stopRecording } = require('../services/recordingService');
const { streamFile } = require('../services/mongoFileStore');
const { decorateRecording, verifyAssetToken } = require('../services/assetLinks');

const router = express.Router();

router.post('/start', auth, requireRole('agent', 'admin'), requireFields(['sessionId']), async (req, res) => {
  try {
    const sessionId = cleanText(req.body.sessionId, 80);
    const session = await Session.findOne({ sessionId });
    if (!session || session.status !== 'Active') return res.status(404).json({ message: 'Active session not found' });
    if (req.user.role !== 'admin' && String(session.agentId) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Only the session agent can record' });
    }

    const recording = decorateRecording(await startRecording(sessionId, req.user._id));
    req.app.get('io').to(sessionId).emit('recording-status', { status: recording.status, recording });
    res.status(201).json({ recording });
  } catch (error) {
    res.status(500).json({ message: error.message || 'Could not start recording' });
  }
});

router.post('/stop', auth, requireRole('agent', 'admin'), requireFields(['sessionId']), async (req, res) => {
  try {
    const sessionId = cleanText(req.body.sessionId, 80);
    const session = await Session.findOne({ sessionId });
    if (!session || session.status !== 'Active') return res.status(404).json({ message: 'Active session not found' });
    if (req.user.role !== 'admin' && String(session.agentId) !== String(req.user._id)) {
      return res.status(403).json({ message: 'Only the session agent can stop recording' });
    }

    const recording = decorateRecording(await stopRecording(sessionId));
    req.app.get('io').to(sessionId).emit('recording-status', { status: recording.status, recording });
    res.json({ recording });
  } catch (error) {
    res.status(400).json({ message: error.message || 'Could not stop recording' });
  }
});

router.get('/download/:recordingId', async (req, res) => {
  const recording = await Recording.findById(req.params.recordingId);
  if (!recording || recording.status !== 'Ready' || !recording.gridFsId) {
    return res.status(404).json({ message: 'Recording not found' });
  }

  const allowed = verifyAssetToken(req.query.assetToken, {
    type: 'recording',
    recordingId: String(recording._id),
    sessionId: recording.sessionId
  });
  if (!allowed) return res.status(403).json({ message: 'Recording link is invalid or expired' });

  res.setHeader('Content-Type', recording.mimeType || 'video/mp4');
  if (recording.size) res.setHeader('Content-Length', recording.size);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(recording.fileName || `${recording.sessionId}.mp4`)}"`);
  await streamFile(recording.gridFsId, res);
});

router.get('/:sessionId', auth, async (req, res) => {
  const recordings = await Recording.find({ sessionId: req.params.sessionId }).sort({ createdAt: -1 });
  res.json({ recordings: recordings.map(decorateRecording) });
});

module.exports = router;
