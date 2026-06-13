const express = require('express');
const Message = require('../models/Message');
const Session = require('../models/Session');
const { auth } = require('../middleware/auth');
const { cleanText, requireFields } = require('../middleware/validate');

const router = express.Router();

router.post('/send', auth, requireFields(['sessionId', 'message']), async (req, res) => {
  const sessionId = cleanText(req.body.sessionId, 80);
  const text = cleanText(req.body.message, 2000);
  const session = await Session.findOne({ sessionId });

  if (!session || session.status !== 'Active') {
    return res.status(404).json({ message: 'Active session not found' });
  }

  const message = await Message.create({
    sessionId,
    senderId: req.user._id,
    senderName: req.user.name,
    senderRole: req.user.role,
    message: text
  });

  req.app.get('io').to(sessionId).emit('chat-message', message);
  res.status(201).json({ message });
});

router.get('/:sessionId', auth, async (req, res) => {
  const messages = await Message.find({ sessionId: req.params.sessionId }).sort({ timestamp: 1 });
  res.json({ messages });
});

module.exports = router;
