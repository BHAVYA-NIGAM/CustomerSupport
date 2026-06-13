const jwt = require('jsonwebtoken');

function signAssetPath(path, payload) {
  const assetToken = jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '6h' });
  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}assetToken=${encodeURIComponent(assetToken)}`;
}

function verifyAssetToken(token, expected) {
  if (!token) return false;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return Object.entries(expected).every(([key, value]) => decoded[key] === value);
  } catch (error) {
    return false;
  }
}

function decorateSharedFile(file) {
  const data = typeof file.toObject === 'function' ? file.toObject() : { ...file };
  const fileId = String(data._id);
  data.filePath = signAssetPath(`/api/files/${fileId}/download`, {
    type: 'shared-file',
    fileId,
    sessionId: data.sessionId
  });
  return data;
}

function decorateRecording(recording) {
  const data = typeof recording.toObject === 'function' ? recording.toObject() : { ...recording };
  const recordingId = String(data._id);
  if (data.status === 'Ready' && data.gridFsId) {
    data.recordingPath = signAssetPath(`/api/recording/download/${recordingId}`, {
      type: 'recording',
      recordingId,
      sessionId: data.sessionId
    });
  }
  return data;
}

module.exports = {
  decorateRecording,
  decorateSharedFile,
  verifyAssetToken
};
