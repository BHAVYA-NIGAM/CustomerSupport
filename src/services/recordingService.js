const path = require('path');
const os = require('os');
const fs = require('fs/promises');
const { spawn } = require('child_process');
const Recording = require('../models/Recording');
const { decorateRecording } = require('./assetLinks');
const { uploadFile } = require('./mongoFileStore');

const activeRecorders = new Map();
const recordingsDir = path.join(os.tmpdir(), 'customersupport-recordings');

async function startRecording(sessionId, userId) {
  const existing = activeRecorders.get(sessionId);
  if (existing) return existing.recording;

  await ensureFfmpegAvailable();
  await fs.mkdir(recordingsDir, { recursive: true });

  const fileName = `${sessionId}-${Date.now()}.mp4`;
  const outputPath = path.join(recordingsDir, fileName);
  const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';

  const args = [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=#101827:s=1280x720:r=25`,
    '-f',
    'lavfi',
    '-i',
    'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-shortest',
    '-vf',
    `drawtext=text='Customer Support Session ${sessionId}':fontcolor=white:fontsize=38:x=(w-text_w)/2:y=(h-text_h)/2`,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-movflags',
    '+faststart',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    outputPath
  ];

  const recording = await Recording.create({
    sessionId,
    recordingPath: '',
    fileName,
    mimeType: 'video/mp4',
    status: 'Recording',
    startedBy: userId,
    startedAt: new Date()
  });

  const ffmpegProcess = spawn(ffmpegPath, args, { stdio: ['pipe', 'ignore', 'pipe'] });

  ffmpegProcess.stderr.on('data', () => {
    // FFmpeg writes progress to stderr; keeping it quiet makes demos cleaner.
  });

  ffmpegProcess.on('error', async () => {
    recording.status = 'Failed';
    recording.stoppedAt = new Date();
    await recording.save();
    activeRecorders.delete(sessionId);
  });

  ffmpegProcess.on('close', async (code) => {
    const latest = await Recording.findById(recording._id);
    if (latest && latest.status !== 'Failed') {
      if (code === 0) {
        try {
          const stats = await fs.stat(outputPath);
          latest.gridFsId = await uploadFile(outputPath, {
            filename: fileName,
            contentType: 'video/mp4',
            metadata: {
              kind: 'recording',
              sessionId,
              recordingId: String(latest._id)
            }
          });
          latest.size = stats.size;
          latest.recordingPath = `/api/recording/download/${latest._id}`;
          latest.status = 'Ready';
          latest.stoppedAt = latest.stoppedAt || new Date();
          await latest.save();
        } catch (error) {
          latest.status = 'Failed';
          latest.stoppedAt = latest.stoppedAt || new Date();
          await latest.save();
        } finally {
          await fs.unlink(outputPath).catch(() => {});
        }
      } else {
        latest.status = 'Failed';
        latest.stoppedAt = latest.stoppedAt || new Date();
        await latest.save();
        await fs.unlink(outputPath).catch(() => {});
      }
    }
    activeRecorders.delete(sessionId);
  });

  activeRecorders.set(sessionId, { process: ffmpegProcess, recording });
  return decorateRecording(recording);
}

async function stopRecording(sessionId) {
  const active = activeRecorders.get(sessionId);
  const recording = await Recording.findOne({ sessionId }).sort({ createdAt: -1 });

  if (!recording) {
    throw new Error('No recording found for this session');
  }

  if (recording.status === 'Failed') {
    throw new Error('Recording failed because FFmpeg is unavailable or exited unexpectedly');
  }

  recording.status = 'Processing';
  recording.stoppedAt = new Date();
  await recording.save();

  if (active) {
    if (!active.process.killed && active.process.stdin.writable) {
      active.process.stdin.write('q');
      active.process.stdin.end();
    }
  } else {
    recording.status = 'Ready';
    await recording.save();
  }

  return decorateRecording(recording);
}

function isRecording(sessionId) {
  return activeRecorders.has(sessionId);
}

async function stopRecordingIfActive(sessionId) {
  if (!isRecording(sessionId)) return null;
  return stopRecording(sessionId);
}

function ensureFfmpegAvailable() {
  const ffmpegPath = process.env.FFMPEG_PATH || 'ffmpeg';

  return new Promise((resolve, reject) => {
    const probe = spawn(ffmpegPath, ['-version'], { stdio: ['ignore', 'ignore', 'ignore'] });

    probe.on('error', () => {
      reject(new Error('FFmpeg is not available. Install FFmpeg or set FFMPEG_PATH to enable recordings.'));
    });

    probe.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error('FFmpeg could not start. Check FFMPEG_PATH before recording.'));
    });
  });
}

module.exports = { isRecording, startRecording, stopRecording, stopRecordingIfActive };
