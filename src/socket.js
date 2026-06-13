const jwt = require('jsonwebtoken');
const User = require('./models/User');
const Session = require('./models/Session');
const Message = require('./models/Message');
const metrics = require('./services/metrics');
const mediasoupService = require('./services/mediasoupService');
const { cleanText } = require('./middleware/validate');
const { logSessionEvent } = require('./services/sessionEvents');

const reconnectTimers = new Map();

function setupSocket(io) {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error('Authentication token missing'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select('-password');
      if (!user) return next(new Error('User not found'));

      socket.user = user;
      next();
    } catch (error) {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    metrics.userConnected();

    socket.on('join-session', async ({ sessionId }, callback) => {
      try {
        const session = await Session.findOne({ sessionId });
        if (!session || session.status !== 'Active') throw new Error('Session is not active');

        const isAllowed =
          String(session.agentId) === String(socket.user._id) ||
          String(session.customerId) === String(socket.user._id) ||
          session.participants.some((participant) => String(participant.userId) === String(socket.user._id)) ||
          socket.user.role === 'admin';
        if (!isAllowed) throw new Error('You are not allowed to join this session');

        socket.join(sessionId);
        socket.sessionId = sessionId;
        await mediasoupService.addPeer(sessionId, socket.id, {
          id: socket.user._id.toString(),
          name: socket.user.name,
          role: socket.user.role
        });

        const timerKey = `${sessionId}:${socket.user._id}`;
        const isReconnect = reconnectTimers.has(timerKey);
        if (reconnectTimers.has(timerKey)) {
          clearTimeout(reconnectTimers.get(timerKey));
          reconnectTimers.delete(timerKey);
        }

        const participant = session.participants.find((p) => String(p.userId) === String(socket.user._id));
        if (participant) {
          participant.socketId = socket.id;
          participant.connected = true;
          participant.disconnectTime = undefined;
          participant.joinedAt = participant.joinedAt || new Date();
        }
        await session.save();
        await logSessionEvent(sessionId, isReconnect ? 'participant_reconnected' : 'participant_joined', socket.user, {
          socketId: socket.id
        });

        if (!isReconnect) {
          socket.to(sessionId).emit('participant-joined', {
            id: socket.user._id,
            name: socket.user.name,
            role: socket.user.role
          });
        }
        callback({ ok: true, reconnected: isReconnect });
      } catch (error) {
        callback({ ok: false, message: error.message });
      }
    });

    socket.on('get-router-rtp-capabilities', async ({ sessionId }, callback) => {
      await mediasoupService.getRoom(sessionId);
      callback({ rtpCapabilities: mediasoupService.getRouterRtpCapabilities(sessionId) });
    });

    socket.on('create-webrtc-transport', async ({ sessionId }, callback) => {
      try {
        const { params } = await mediasoupService.createWebRtcTransport(sessionId, socket.id);
        callback({ ok: true, params });
      } catch (error) {
        callback({ ok: false, message: error.message });
      }
    });

    socket.on('connect-transport', async ({ sessionId, transportId, dtlsParameters }, callback) => {
      try {
        const peer = mediasoupService.getPeer(sessionId, socket.id);
        const transport = peer.transports.get(transportId);
        await transport.connect({ dtlsParameters });
        callback({ ok: true });
      } catch (error) {
        callback({ ok: false, message: error.message });
      }
    });

    socket.on('produce', async ({ sessionId, transportId, kind, rtpParameters, appData }, callback) => {
      try {
        const peer = mediasoupService.getPeer(sessionId, socket.id);
        const transport = peer.transports.get(transportId);
        const producer = await transport.produce({ kind, rtpParameters, appData });
        peer.producers.set(producer.id, producer);

        producer.on('transportclose', () => peer.producers.delete(producer.id));

        socket.to(sessionId).emit('new-producer', {
          producerId: producer.id,
          socketId: socket.id,
          kind,
          source: producer.appData?.source || kind,
          user: peer.user
        });
        callback({ ok: true, id: producer.id });
      } catch (error) {
        callback({ ok: false, message: error.message });
      }
    });

    socket.on('close-producer', ({ sessionId, producerId }, callback) => {
      try {
        const peer = mediasoupService.getPeer(sessionId, socket.id);
        const producer = peer?.producers.get(producerId);
        if (!producer) throw new Error('Producer not found');

        producer.close();
        peer.producers.delete(producerId);
        socket.to(sessionId).emit('producer-closed', { producerId });
        callback({ ok: true });
      } catch (error) {
        callback({ ok: false, message: error.message });
      }
    });

    socket.on('list-producers', ({ sessionId }, callback) => {
      callback({ producers: mediasoupService.getOtherProducers(sessionId, socket.id) });
    });

    socket.on('consume', async ({ sessionId, producerId, rtpCapabilities, transportId }, callback) => {
      try {
        const room = await mediasoupService.getRoom(sessionId);
        if (!room.router.canConsume({ producerId, rtpCapabilities })) {
          throw new Error('Client cannot consume this producer');
        }

        const peer = mediasoupService.getPeer(sessionId, socket.id);
        const transport = peer.transports.get(transportId);
        const producer = mediasoupService.getProducer(sessionId, producerId);
        const consumer = await transport.consume({
          producerId,
          rtpCapabilities,
          paused: true
        });

        peer.consumers.set(consumer.id, consumer);
        consumer.on('transportclose', () => peer.consumers.delete(consumer.id));

        callback({
          ok: true,
          params: {
            id: consumer.id,
            producerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
            source: producer?.appData?.source || consumer.kind
          }
        });
      } catch (error) {
        callback({ ok: false, message: error.message });
      }
    });

    socket.on('resume-consumer', async ({ sessionId, consumerId }, callback) => {
      try {
        const peer = mediasoupService.getPeer(sessionId, socket.id);
        const consumer = peer.consumers.get(consumerId);
        await consumer.resume();
        callback({ ok: true });
      } catch (error) {
        callback({ ok: false, message: error.message });
      }
    });

    socket.on('chat-message', async ({ sessionId, message }, callback) => {
      try {
        const text = cleanText(message, 2000);
        if (!text) throw new Error('Message cannot be empty');

        const saved = await Message.create({
          sessionId,
          senderId: socket.user._id,
          senderName: socket.user.name,
          senderRole: socket.user.role,
          message: text
        });
        io.to(sessionId).emit('chat-message', saved);
        callback({ ok: true, message: saved });
      } catch (error) {
        callback({ ok: false, message: error.message });
      }
    });

    socket.on('media-toggle', ({ sessionId, kind, enabled }) => {
      socket.to(sessionId).emit('media-toggle', {
        userId: socket.user._id,
        name: socket.user.name,
        kind,
        enabled
      });
    });

    socket.on('disconnect', async () => {
      metrics.userDisconnected();
      const sessionId = socket.sessionId;
      if (!sessionId) return;

      mediasoupService.removePeer(sessionId, socket.id);
      const session = await Session.findOne({ sessionId });
      if (!session || session.status !== 'Active') return;

      const participant = session.participants.find((p) => String(p.userId) === String(socket.user._id));
      if (participant) {
        participant.connected = false;
        participant.disconnectTime = new Date();
        await session.save();
      }

      const timerKey = `${sessionId}:${socket.user._id}`;
      const timer = setTimeout(async () => {
        const latest = await Session.findOne({ sessionId });
        const latestParticipant = latest?.participants.find((p) => String(p.userId) === String(socket.user._id));
        if (latestParticipant && !latestParticipant.connected) {
          latestParticipant.leftAt = new Date();
          await latest.save();
          io.to(sessionId).emit('participant-left', { userId: socket.user._id, name: socket.user.name });
          await logSessionEvent(sessionId, 'participant_left_after_grace', socket.user);
        }
        reconnectTimers.delete(timerKey);
      }, 60 * 1000);

      reconnectTimers.set(timerKey, timer);
    });
  });
}

module.exports = setupSocket;
