require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const { Server } = require('socket.io');
const connectDB = require('./config/db');
const setupSocket = require('./socket');
const mediasoupService = require('./services/mediasoupService');
const metrics = require('./services/metrics');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

app.set('io', io);
app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../public')));
app.use('/mediasoup-client', express.static(path.join(__dirname, '../node_modules/mediasoup-client')));
app.use('/chart.js', express.static(path.join(__dirname, '../node_modules/chart.js')));

app.get('/join/:token', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/join.html'));
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/session', require('./routes/sessions'));
app.use('/api/chat', require('./routes/chat'));
app.use('/api/files', require('./routes/files'));
app.use('/api/recording', require('./routes/recordings'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/metrics', require('./routes/metrics'));

app.get('/health', (req, res) => {
  res.json({ ok: true, app: 'Customer Support', time: new Date().toISOString() });
});

app.use((err, req, res, next) => {
  metrics.recordError(err);
  res.status(500).json({ message: 'Unexpected server error' });
});

async function start() {
  try {
    await connectDB();
    await mediasoupService.createWorker();
    setupSocket(io);

    const port = process.env.PORT || 3000;
    server.listen(port, () => {
      console.log(`Customer Support running at http://localhost:${port}`);
    });
  } catch (error) {
    metrics.recordError(error);
    process.exit(1);
  }
}

start();
