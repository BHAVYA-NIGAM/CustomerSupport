const SessionEvent = require('../models/SessionEvent');

async function logSessionEvent(sessionId, type, actor, details = {}) {
  await SessionEvent.create({
    sessionId,
    type,
    actorId: actor?._id,
    actorRole: actor?.role,
    details
  });
}

module.exports = { logSessionEvent };
