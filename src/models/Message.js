const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, index: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    senderName: String,
    senderRole: { type: String, enum: ['agent', 'customer', 'admin'], required: true },
    message: { type: String, required: true, trim: true },
    timestamp: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Message', messageSchema);
