const mongoose = require('mongoose');

const sharedFileSchema = new mongoose.Schema(
  {
    sessionId: { type: String, required: true, index: true },
    uploader: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    uploaderName: String,
    uploaderRole: { type: String, enum: ['agent', 'customer', 'admin'], required: true },
    fileName: { type: String, required: true },
    originalName: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, default: 0 },
    gridFsId: { type: mongoose.Schema.Types.ObjectId, required: true },
    filePath: { type: String, required: true },
    uploadedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

module.exports = mongoose.model('SharedFile', sharedFileSchema);
