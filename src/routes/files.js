const express = require('express');
const multer = require('multer');
const SharedFile = require('../models/SharedFile');
const Session = require('../models/Session');
const { auth } = require('../middleware/auth');
const { cleanText } = require('../middleware/validate');
const { streamFile, uploadBuffer } = require('../services/mongoFileStore');
const { decorateSharedFile, verifyAssetToken } = require('../services/assetLinks');

const router = express.Router();
const allowedTypes = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.MAX_FILE_SIZE_MB || 10) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    cb(null, allowedTypes.has(file.mimetype));
  }
});

router.post('/upload', auth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'Upload a PDF, PNG, JPG, or DOCX file' });

  const sessionId = cleanText(req.body.sessionId, 80);
  const session = await Session.findOne({ sessionId });
  if (!session || session.status !== 'Active') return res.status(404).json({ message: 'Active session not found' });
  if (!canAccessSession(session, req.user)) {
    return res.status(403).json({ message: 'You cannot upload files to this session' });
  }

  const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  const fileName = `${Date.now()}-${safeName}`;
  const gridFsId = await uploadBuffer(req.file.buffer, {
    filename: fileName,
    contentType: req.file.mimetype,
    metadata: {
      kind: 'shared-file',
      sessionId,
      uploadedBy: String(req.user._id)
    }
  });

  const file = await SharedFile.create({
    sessionId,
    uploader: req.user._id,
    uploaderName: req.user.name,
    uploaderRole: req.user.role,
    fileName,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
    gridFsId,
    filePath: `/api/files/${gridFsId}/download`
  });

  const decoratedFile = decorateSharedFile(file);
  req.app.get('io').to(sessionId).emit('file-shared', decoratedFile);
  res.status(201).json({ file: decoratedFile });
});

router.get('/:fileId/download', async (req, res) => {
  const file = await SharedFile.findById(req.params.fileId);
  if (!file) return res.status(404).json({ message: 'File not found' });

  const allowed = verifyAssetToken(req.query.assetToken, {
    type: 'shared-file',
    fileId: String(file._id),
    sessionId: file.sessionId
  });
  if (!allowed) return res.status(403).json({ message: 'File link is invalid or expired' });

  res.setHeader('Content-Type', file.mimeType);
  res.setHeader('Content-Length', file.size);
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.originalName)}"`);
  await streamFile(file.gridFsId, res);
});

function canAccessSession(session, user) {
  return (
    user.role === 'admin' ||
    String(session.agentId) === String(user._id) ||
    String(session.customerId) === String(user._id) ||
    session.participants.some((participant) => String(participant.userId) === String(user._id))
  );
}

module.exports = router;
