const E164 = /^\+?[1-9]\d{1,14}$/;
const plusify = s => (s && s.startsWith('+') ? s : `+${s}`);
const toWa = s => (s && s.startsWith('whatsapp:') ? s : `whatsapp:${plusify(String(s))}`);

exports.handler = async function(context, event, callback) {
  const response = new Twilio.Response();
  const requestOrigin = event.headers && event.headers.origin;

  const allowedOrigins = (context.ALLOWED_ORIGINS || "").split(',');
  let allowOrigin = null;
  if (allowedOrigins.includes('*')) {
    allowOrigin = '*';
  } else if (requestOrigin && allowedOrigins.includes(requestOrigin.toLowerCase())) {
    allowOrigin = requestOrigin;
  }

  if (allowOrigin) response.appendHeader('Access-Control-Allow-Origin', allowOrigin);
  response.appendHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.appendHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  response.appendHeader('Access-Control-Allow-Credentials', 'true');
  response.appendHeader('Content-Type', 'application/json');

  if (event.httpMethod === 'OPTIONS') {
    response.setStatusCode(204);
    return callback(null, response);
  }

  const { conversationSid, participants, twilioPhoneNumber } = event;

  if (!conversationSid || !Array.isArray(participants) || participants.length === 0 || !twilioPhoneNumber) {
    response.setStatusCode(400);
    response.setBody({
      success: false,
      message: "Missing required parameters: conversationSid, participants, or twilioPhoneNumber."
    });
    return callback(null, response);
  }

  // Normalize Twilio proxy to WhatsApp form to match participant address type
  const twilioWa = toWa(twilioPhoneNumber);

  const client = context.getTwilioClient();
  const added = [];
  const skipped = [];
  const errors = [];

  for (const p of participants) {
    const raw = (p && (p.identifier || p.id || p.address) || '').trim();
    const displayName = (p && p.name) ? p.name : raw;

    if (!raw) {
      skipped.push({ participant: p, reason: 'missing identifier' });
      continue;
    }

    try {
      if (raw.startsWith('client:')) {
        const identity = raw.slice('client:'.length);
        console.log(`[ADD PARTICIPANT] Adding client identity: ${identity}`);
        await client.conversations.v1.conversations(conversationSid)
          .participants
          .create({
            identity,
            attributes: JSON.stringify({ friendlyName: displayName || identity })
          });
        added.push(raw);
        continue;
      }

      // Treat anything else as a phone number (bare +E164 or already whatsapp:+E164)
      let waAddr;
      if (raw.startsWith('whatsapp:')) {
        // ensure the part after whatsapp: is valid E.164 (with +)
        const bare = raw.slice('whatsapp:'.length);
        const e164 = plusify(bare);
        if (!E164.test(e164)) {
          skipped.push({ participant: p, reason: 'invalid E.164 after whatsapp: prefix' });
          continue;
        }
        waAddr = `whatsapp:${e164}`;
      } else {
        // raw should be +E164; if missing +, add it and validate
        const e164 = plusify(raw);
        if (!E164.test(e164)) {
          skipped.push({ participant: p, reason: 'invalid E.164' });
          continue;
        }
        waAddr = `whatsapp:${e164}`;
      }

      console.log(`[ADD PARTICIPANT] Adding WhatsApp: ${waAddr} via proxy ${twilioWa}`);
      await client.conversations.v1.conversations(conversationSid)
        .participants
        .create({
          'messagingBinding.address': waAddr,
          'messagingBinding.proxyAddress': twilioWa,
          attributes: JSON.stringify({ friendlyName: displayName || waAddr })
        });

      added.push(waAddr);
    } catch (err) {
      console.error(`[ADD PARTICIPANT ERROR] Failed to add: ${raw}`, err);
      errors.push({ identifier: raw, code: err.code, message: err.message });
    }
  }

  response.setStatusCode(200);
  response.setBody({
    success: true,
    message: 'Add participants request processed.',
    added,
    skipped,
    errors
  });

  return callback(null, response);
};
