const mongoose = require('mongoose');

const recordingSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, index: true },
    recordingPath: String,
    fileName: String,
    mimeType: { type: String, default: 'video/mp4' },
    size: { type: Number, default: 0 },
    gridFsId: mongoose.Schema.Types.ObjectId,
    status: { type: String, enum: ['Recording', 'Processing', 'Ready', 'Failed'], default: 'Recording' },
    startedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    startedAt: Date,
    stoppedAt: Date
  },
  { timestamps: true }
);

module.exports = mongoose.model('Recording', recordingSchema);
