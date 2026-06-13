const mongoose = require('mongoose');

const participantSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    name: String,
    role: { type: String, enum: ['agent', 'customer'] },
    socketId: String,
    joinedAt: Date,
    leftAt: Date,
    disconnectTime: Date,
    connected: { type: Boolean, default: false }
  },
  { _id: false }
);

const sessionSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    inviteToken: { type: String, required: true, unique: true, index: true },
    agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    customerName: String,
    startTime: { type: Date, default: Date.now },
    endTime: Date,
    duration: { type: Number, default: 0 },
    status: { type: String, enum: ['Active', 'Ended'], default: 'Active' },
    participants: [participantSchema]
  },
  { timestamps: true }
);

module.exports = mongoose.model('Session', sessionSchema);
