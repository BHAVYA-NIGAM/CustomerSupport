const mediasoup = require('mediasoup');

const rooms = new Map();
let worker;

const mediaCodecs = [
  {
    kind: 'audio',
    mimeType: 'audio/opus',
    clockRate: 48000,
    channels: 2
  },
  {
    kind: 'video',
    mimeType: 'video/VP8',
    clockRate: 90000,
    parameters: { 'x-google-start-bitrate': 1000 }
  }
];

async function createWorker() {
  worker = await mediasoup.createWorker({
    rtcMinPort: 40000,
    rtcMaxPort: 49999
  });

  worker.on('died', () => {
    console.error('mediasoup worker died; exiting in 2 seconds');
    setTimeout(() => process.exit(1), 2000);
  });
}

async function getRoom(sessionId) {
  if (!worker) await createWorker();

  if (!rooms.has(sessionId)) {
    const router = await worker.createRouter({ mediaCodecs });
    rooms.set(sessionId, {
      router,
      peers: new Map()
    });
  }

  return rooms.get(sessionId);
}

function getPeer(sessionId, socketId) {
  const room = rooms.get(sessionId);
  if (!room) return null;
  return room.peers.get(socketId);
}

async function addPeer(sessionId, socketId, user) {
  const room = await getRoom(sessionId);
  if (!room.peers.has(socketId)) {
    room.peers.set(socketId, {
      socketId,
      user,
      transports: new Map(),
      producers: new Map(),
      consumers: new Map()
    });
  }
  return room.peers.get(socketId);
}

async function createWebRtcTransport(sessionId, socketId) {
  const room = await getRoom(sessionId);
  const peer = getPeer(sessionId, socketId);
  const listenIp = process.env.MEDIASOUP_LISTEN_IP || '0.0.0.0';
  const announcedAddress = process.env.MEDIASOUP_ANNOUNCED_IP || '127.0.0.1';
  const portRange = {
    min: Number(process.env.MEDIASOUP_MIN_PORT || 40000),
    max: Number(process.env.MEDIASOUP_MAX_PORT || 49999)
  };

  const transport = await room.router.createWebRtcTransport({
    listenInfos: [
      {
        protocol: 'udp',
        ip: listenIp,
        announcedAddress,
        portRange
      },
      {
        protocol: 'tcp',
        ip: listenIp,
        announcedAddress,
        portRange
      }
    ],
    enableUdp: true,
    enableTcp: true,
    preferUdp: true
  });

  peer.transports.set(transport.id, transport);

  return {
    transport,
    params: {
      id: transport.id,
      iceParameters: transport.iceParameters,
      iceCandidates: transport.iceCandidates,
      dtlsParameters: transport.dtlsParameters
    }
  };
}

function getRouterRtpCapabilities(sessionId) {
  const room = rooms.get(sessionId);
  return room?.router.rtpCapabilities;
}

function getOtherProducers(sessionId, socketId) {
  const room = rooms.get(sessionId);
  if (!room) return [];

  const producers = [];
  room.peers.forEach((peer, peerSocketId) => {
    if (peerSocketId !== socketId) {
      peer.producers.forEach((producer) => {
        producers.push({
          producerId: producer.id,
          socketId: peerSocketId,
          kind: producer.kind,
          source: producer.appData?.source || producer.kind,
          user: peer.user
        });
      });
    }
  });

  return producers;
}

function getProducer(sessionId, producerId) {
  const room = rooms.get(sessionId);
  if (!room) return null;

  for (const peer of room.peers.values()) {
    const producer = peer.producers.get(producerId);
    if (producer) return producer;
  }

  return null;
}

function removePeer(sessionId, socketId) {
  const room = rooms.get(sessionId);
  const peer = room?.peers.get(socketId);
  if (!room || !peer) return;

  peer.consumers.forEach((consumer) => consumer.close());
  peer.producers.forEach((producer) => producer.close());
  peer.transports.forEach((transport) => transport.close());
  room.peers.delete(socketId);

  if (room.peers.size === 0) {
    room.router.close();
    rooms.delete(sessionId);
  }
}

function closeRoom(sessionId) {
  const room = rooms.get(sessionId);
  if (!room) return;

  room.peers.forEach((peer) => {
    peer.consumers.forEach((consumer) => consumer.close());
    peer.producers.forEach((producer) => producer.close());
    peer.transports.forEach((transport) => transport.close());
  });
  room.router.close();
  rooms.delete(sessionId);
}

module.exports = {
  addPeer,
  closeRoom,
  createWorker,
  createWebRtcTransport,
  getOtherProducers,
  getPeer,
  getProducer,
  getRoom,
  getRouterRtpCapabilities,
  removePeer
};
