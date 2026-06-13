const fs = require('fs');
const { pipeline } = require('stream/promises');
const mongoose = require('mongoose');

const BUCKET_NAME = 'customerSupportFiles';

function bucket() {
  if (!mongoose.connection.db) {
    throw new Error('MongoDB is not connected');
  }

  return new mongoose.mongo.GridFSBucket(mongoose.connection.db, {
    bucketName: BUCKET_NAME
  });
}

function uploadBuffer(buffer, { filename, contentType, metadata = {} }) {
  return new Promise((resolve, reject) => {
    const uploadStream = bucket().openUploadStream(filename, {
      contentType,
      metadata
    });

    uploadStream.on('error', reject);
    uploadStream.on('finish', () => resolve(uploadStream.id));
    uploadStream.end(buffer);
  });
}

function uploadFile(filePath, { filename, contentType, metadata = {} }) {
  return new Promise((resolve, reject) => {
    const uploadStream = bucket().openUploadStream(filename, {
      contentType,
      metadata
    });
    const readStream = fs.createReadStream(filePath);

    readStream.on('error', reject);
    uploadStream.on('error', reject);
    uploadStream.on('finish', () => resolve(uploadStream.id));
    readStream.pipe(uploadStream);
  });
}

async function streamFile(gridFsId, writableStream) {
  const downloadStream = bucket().openDownloadStream(new mongoose.Types.ObjectId(gridFsId));
  await pipeline(downloadStream, writableStream);
}

async function deleteFile(gridFsId) {
  if (!gridFsId) return;
  await bucket().delete(new mongoose.Types.ObjectId(gridFsId)).catch(() => {});
}

module.exports = {
  deleteFile,
  streamFile,
  uploadBuffer,
  uploadFile
};
