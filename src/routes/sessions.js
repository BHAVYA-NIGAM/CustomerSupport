const express = require('express');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const Session = require('../models/Session');
const User = require('../models/User');
const Message = require('../models/Message');
const Recording = require('../models/Recording');
const SharedFile = require('../models/SharedFile');
const SessionEvent = require('../models/SessionEvent');
const { auth, signToken } = require('../middleware/auth');
const requireRole = require('../middleware/roles');
const { cleanText, requireFields } = require('../middleware/validate');
const { logSessionEvent } = require('../services/sessionEvents');
const mediasoupService = require('../services/mediasoupService');
const { stopRecordingIfActive } = require('../services/recordingService');
const { decorateRecording, decorateSharedFile } = require('../services/assetLinks');

const router = express.Router();

router.post('/create', auth, requireRole('agent', 'admin'), async (req, res) => {
  try {
    const sessionId = uuidv4().slice(0, 8);
    const inviteToken = Math.random().toString(36).substring(2, 8).toUpperCase();

    const session = await Session.create({
      sessionId,
      inviteToken,
      agentId: req.user._id,
      participants: [
        {
          userId: req.user._id,
          name: req.user.name,
          role: 'agent',
          joinedAt: new Date(),
          connected: false
        }
      ]
    });

    await logSessionEvent(sessionId, 'session_created', req.user, { inviteToken });

    res.status(201).json({
      session,
      inviteLink: `${process.env.APP_BASE_URL || 'http://localhost:3000'}/join/${inviteToken}`
    });
  } catch (error) {
    res.status(500).json({ message: 'Could not create session' });
  }
});

router.get('/invite/:token', async (req, res) => {
  const inviteToken = cleanInviteToken(req.params.token);
  const session = await Session.findOne({ inviteToken }).populate('agentId', 'name email');
  if (!session || session.status !== 'Active') {
    return res.status(404).json({ message: 'Invite is invalid or session has ended' });
  }
  res.json({
    sessionId: session.sessionId,
    agentName: session.agentId.name,
    status: session.status
  });
});

router.post('/customer-join', requireFields(['inviteToken', 'name']), async (req, res) => {
  try {
    const inviteToken = cleanInviteToken(req.body.inviteToken);
    const name = cleanText(req.body.name, 80);
    const session = await Session.findOne({ inviteToken });

    if (!session || session.status !== 'Active') {
      return res.status(404).json({ message: 'Invite is invalid or session has ended' });
    }
    if (!name) {
      return res.status(400).json({ message: 'Please enter your name to join the call' });
    }

    const email = `guest-${session.sessionId}-${uuidv4()}@customersupport.local`;
    const password = await bcrypt.hash(uuidv4(), 10);
    const customer = await User.create({ name, email, password, role: 'customer' });

    session.customerId = customer._id;
    session.customerName = name;
    session.participants.push({
      userId: customer._id,
      name,
      role: 'customer',
      joinedAt: new Date(),
      connected: false
    });
    await session.save();
    await logSessionEvent(session.sessionId, 'customer_invite_accepted', customer, { name });

    res.status(201).json({
      token: signToken(customer),
      user: { id: customer._id, name: customer.name, email: customer.email, role: customer.role },
      sessionId: session.sessionId
    });
  } catch (error) {
    res.status(500).json({ message: 'Could not join session' });
  }
});

router.get('/:id', auth, async (req, res) => {
  const session = await Session.findOne({ sessionId: req.params.id })
    .populate('agentId', 'name email')
    .populate('customerId', 'name email');

  if (!session) return res.status(404).json({ message: 'Session not found' });

  const isParticipant =
    String(session.agentId?._id || session.agentId) === String(req.user._id) ||
    String(session.customerId?._id || session.customerId) === String(req.user._id) ||
    session.participants.some((participant) => String(participant.userId) === String(req.user._id)) ||
    req.user.role === 'admin';

  if (!isParticipant) return res.status(403).json({ message: 'You cannot view this session' });

  const [messages, recordings, files, events] = await Promise.all([
    Message.find({ sessionId: session.sessionId }).sort({ timestamp: 1 }),
    Recording.find({ sessionId: session.sessionId }).sort({ createdAt: -1 }),
    SharedFile.find({ sessionId: session.sessionId }).sort({ uploadedAt: 1 }),
    SessionEvent.find({ sessionId: session.sessionId }).sort({ createdAt: 1 })
  ]);

  res.json({
    session,
    messages,
    recordings: recordings.map(decorateRecording),
    files: files.map(decorateSharedFile),
    events
  });
});

router.post('/end', auth, requireRole('agent', 'admin'), requireFields(['sessionId']), async (req, res) => {
  const session = await Session.findOne({ sessionId: cleanText(req.body.sessionId, 80) });
  if (!session) return res.status(404).json({ message: 'Session not found' });

  const isAgent = String(session.agentId) === String(req.user._id);
  if (!isAgent && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Only the owning agent or admin can end this session' });
  }

  session.status = 'Ended';
  session.endTime = new Date();
  session.duration = Math.max(0, Math.round((session.endTime - session.startTime) / 1000));
  session.participants = session.participants.map((participant) => ({
    ...participant.toObject(),
    connected: false,
    leftAt: participant.leftAt || new Date()
  }));
  await session.save();
  await logSessionEvent(session.sessionId, 'session_ended', req.user);
  const recording = await stopRecordingIfActive(session.sessionId);
  mediasoupService.closeRoom(session.sessionId);

  req.app.get('io').to(session.sessionId).emit('session-ended', {
    sessionId: session.sessionId,
    recordingStatus: recording?.status
  });
  res.json({ session, recording });
});

function cleanInviteToken(value) {
  const rawValue = cleanText(value, 500);
  if (!rawValue) return '';

  try {
    const parsed = new URL(rawValue);
    const queryToken = parsed.searchParams.get('token');
    if (queryToken) return cleanText(queryToken, 120);

    const pathParts = parsed.pathname.split('/').filter(Boolean);
    return cleanText(pathParts[pathParts.length - 1] || rawValue, 120);
  } catch (error) {
    const pathParts = rawValue.split('/').filter(Boolean);
    return cleanText(pathParts[pathParts.length - 1] || rawValue, 120);
  }
}

module.exports = router;
