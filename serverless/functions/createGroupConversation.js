exports.handler = async function(context, event, callback) {
  // --- CORS ---
  const response = new Twilio.Response();
  const origin = event.headers && (event.headers.origin || event.headers.Origin);
  const allowed = (context.ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
  let allow = null;
  if (allowed.includes("*")) allow = "*";
  else if (origin && allowed.map(x => x.toLowerCase()).includes(String(origin).toLowerCase())) allow = origin;
  if (allow) response.appendHeader("Access-Control-Allow-Origin", allow);
  response.appendHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.appendHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.appendHeader("Access-Control-Allow-Credentials", "true");
  const httpMethod = event.httpMethod || (event.request && (event.request.method || event.request.httpMethod));
  if (String(httpMethod).toUpperCase() === "OPTIONS") { response.setStatusCode(204); return callback(null, response); }
  response.appendHeader("Content-Type", "application/json");

  // --- Helpers: accept whatsapp:+E164 or +E164, ALWAYS emit whatsapp:+E164 ---
  const E164 = /^\+[1-9]\d{1,14}$/;
  const stripWa = s => String(s || "").trim().replace(/^whatsapp:/i, "");
  const toE164OrNull = input => { const v = stripWa(input); return E164.test(v) ? v : null; };
  const toWa = e164 => `whatsapp:${e164}`;

  // --- Env vars ---
  const REQUIRED = ["ACCOUNT_SID","AUTH_TOKEN","CONVERSATIONS_SERVICE_SID","WHATSAPP_TEMPLATE_SID","TWILIO_FUNCTIONS_BASE_URL"];
  const missing = REQUIRED.filter(v => !context[v]);
  if (missing.length) {
    response.setStatusCode(500);
    response.setBody({ success:false, message:"Server configuration error.", detail:`Missing ${missing.join(", ")}` });
    return callback(null, response);
  }
  const { CONVERSATIONS_SERVICE_SID, WHATSAPP_TEMPLATE_SID } = context;

  // --- Input ---
  const { friendlyName, description, participants, twilioPhoneNumber } = event;
  if (!friendlyName) return cbErr(400, "Missing 'friendlyName'.");
  if (!twilioPhoneNumber) return cbErr(400, "Missing 'twilioPhoneNumber'.");
  if (!Array.isArray(participants) || participants.length === 0) return cbErr(400, "Missing or empty 'participants' array.");

  // Validate sender (accept +E164 or whatsapp:+E164)
  const proxyE164 = toE164OrNull(twilioPhoneNumber);
  if (!proxyE164) return cbErr(400, "Twilio WhatsApp number must be +E164 or whatsapp:+E164.", "Example: +14155550123");
  const proxyWa = toWa(proxyE164);

  // Pre-validate participants; build final payload
  const prepared = [];
  const invalid = [];
  for (const p of participants) {
    const raw = String(p.identifier || "").trim();
    if (!raw) { invalid.push({ input:"(empty)", reason:"missing identifier" }); continue; }

    if (raw.startsWith("client:")) {
      prepared.push({ type:"chat", identity: raw.slice("client:".length) });
      continue;
    }

    const e164 = toE164OrNull(raw); // accepts whatsapp:+E164 or +E164
    if (!e164) { invalid.push({ input: raw, reason: "must be +E164 or whatsapp:+E164" }); continue; }

    prepared.push({ type:"wa", waAddr: toWa(e164) });
  }

  if (invalid.length) {
    response.setStatusCode(400);
    response.setBody({ success:false, message:"One or more participants are invalid.", invalidParticipants: invalid });
    return callback(null, response);
  }

  const client = context.getTwilioClient();

  try {
    // Create conversation
    const attributes = JSON.stringify({
      description: description || "",
      groupTwilioPhoneNumber: proxyE164, // store plain +E164 (attributes only)
      createdBy: "whatsapp_groups_manager"
    });

    const conv = await client.conversations.v1
      .services(CONVERSATIONS_SERVICE_SID)
      .conversations
      .create({ friendlyName, attributes });

    // Add participants
    const waToNotify = [];
    for (const n of prepared) {
      if (n.type === "chat") {
        await client.conversations.v1
          .services(CONVERSATIONS_SERVICE_SID)
          .conversations(conv.sid)
          .participants
          .create({ identity: n.identity });
      } else {
        await client.conversations.v1
          .services(CONVERSATIONS_SERVICE_SID)
          .conversations(conv.sid)
          .participants
          .create({
            "messagingBinding.address": n.waAddr,     // MUST be whatsapp:+E164
            "messagingBinding.proxyAddress": proxyWa  // MUST be whatsapp:+E164
          });
        waToNotify.push(n.waAddr);
      }
    }

    // Notify WA participants with template (from/to must be whatsapp:+E164)
    for (const to of waToNotify) {
      try {
        await client.messages.create({
          contentSid: WHATSAPP_TEMPLATE_SID,
          from: proxyWa,
          to
          // contentVariables: JSON.stringify({ '1': 'User', '2': friendlyName })
        });
      } catch (e) {
        console.error(`[WHATSAPP ERROR] Template to ${to} failed:`, e);
      }
    }

    response.setStatusCode(201);
    response.setBody({
      success:true,
      message:"Group conversation created successfully.",
      conversationSid: conv.sid,
      friendlyName: conv.friendlyName,
      attributes: JSON.parse(conv.attributes)
    });
    return callback(null, response);

  } catch (error) {
    console.error("[CRITICAL ERROR /createGroupConversation]", error.message, error.stack);
    response.setStatusCode(500);
    response.setBody({ success:false, message:"Failed to create group conversation.", detail:error.message });
    return callback(null, response);
  }

  function cbErr(code, msg, detail) {
    response.setStatusCode(code);
    const body = { success:false, message:msg };
    if (detail) body.detail = detail;
    response.setBody(body);
    return callback(null, response);
  }
};
