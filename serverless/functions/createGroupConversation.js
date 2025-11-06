exports.handler = async function(context, event, callback) {
  // --- CORS Configuration ---
  const response = new Twilio.Response();
  const requestOrigin = event.headers && (event.headers.origin || event.headers.Origin);
  console.log(`[CORS DEBUG /createGroupConversation] Function execution started. Request Origin: ${requestOrigin}`);
  console.log(`[CORS DEBUG /createGroupConversation] Environment ALLOWED_ORIGINS: ${context.ALLOWED_ORIGINS}`);

  const configuredAllowedOrigins = (context.ALLOWED_ORIGINS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  let effectiveAllowOriginHeader = null;
  if (configuredAllowedOrigins.includes("*")) {
    effectiveAllowOriginHeader = "*";
  } else if (requestOrigin) {
    const lowerSet = new Set(configuredAllowedOrigins.map(o => o.toLowerCase()));
    if (lowerSet.has(String(requestOrigin).toLowerCase())) {
      effectiveAllowOriginHeader = requestOrigin;
    }
  }
  if (effectiveAllowOriginHeader) {
    response.appendHeader("Access-Control-Allow-Origin", effectiveAllowOriginHeader);
  }
  response.appendHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.appendHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.appendHeader("Access-Control-Allow-Credentials", "true");

  // Derive httpMethod for OPTIONS check
  let httpMethod = event.httpMethod || (event.request && (event.request.method || event.request.httpMethod));
  console.log(`[REQUEST /createGroupConversation] Derived httpMethod for OPTIONS check: ${httpMethod}`);
  if (String(httpMethod).toUpperCase() === "OPTIONS") {
    console.log("[REQUEST /createGroupConversation] Handling OPTIONS preflight request.");
    response.setStatusCode(204);
    return callback(null, response);
  }
  response.appendHeader("Content-Type", "application/json");
  // --- End CORS ---

  // --- Always-WhatsApp helpers ---
  const E164 = /^\+[1-9]\d{1,14}$/;
  const stripWa = s => String(s || "").trim().replace(/^whatsapp:/i, "");
  const digitsPlus = s => String(s || "").replace(/[^\d+]/g, "");
  const normalizeE164 = (input) => {
    // Remove whatsapp:, spaces, punctuation
    let raw = digitsPlus(stripWa(input));
    if (!raw) return "";

    // Convert 00-prefix international to + (e.g., 0044... -> +44...)
    if (raw.startsWith("00")) raw = `+${raw.slice(2)}`;

    // Add + if looks like an international number (8–15 digits)
    if (!raw.startsWith("+") && /^\d{8,15}$/.test(raw)) raw = `+${raw}`;

    // Final sanity: must be valid E.164
    if (!E164.test(raw)) return "";
    return raw;
  };
  const asWa = (input) => {
    const e = normalizeE164(input);
    return e ? `whatsapp:${e}` : "";
  };

  const { ACCOUNT_SID, AUTH_TOKEN, CONVERSATIONS_SERVICE_SID, WHATSAPP_TEMPLATE_SID, TWILIO_FUNCTIONS_BASE_URL } = context;
  if (!ACCOUNT_SID || !AUTH_TOKEN || !CONVERSATIONS_SERVICE_SID || !WHATSAPP_TEMPLATE_SID || !TWILIO_FUNCTIONS_BASE_URL) {
    let missing = [];
    if (!ACCOUNT_SID) missing.push("ACCOUNT_SID");
    if (!AUTH_TOKEN) missing.push("AUTH_TOKEN");
    if (!CONVERSATIONS_SERVICE_SID) missing.push("CONVERSATIONS_SERVICE_SID");
    if (!WHATSAPP_TEMPLATE_SID) missing.push("WHATSAPP_TEMPLATE_SID");
    if (!TWILIO_FUNCTIONS_BASE_URL) missing.push("TWILIO_FUNCTIONS_BASE_URL");
    const errorMsg = `Server configuration error: Missing environment variable(s): ${missing.join(", ")}.`;
    console.error("[CONFIG ERROR /createGroupConversation]", errorMsg);
    response.setStatusCode(500);
    response.setBody({ success: false, message: "Server configuration error.", detail: errorMsg });
    return callback(null, response);
  }
  console.log("[CONFIG /createGroupConversation] Required environment variables are present.");

  // --- Input Validation & Payload Extraction ---
  const { friendlyName, description, participants, twilioPhoneNumber } = event;

  if (!friendlyName) {
    return callback(null, sendErrorResponse(response, 400, "Missing 'friendlyName' for the group."));
  }
  if (!twilioPhoneNumber) {
    return callback(null, sendErrorResponse(response, 400, "Missing 'twilioPhoneNumber' for the group."));
  }
  if (!participants || !Array.isArray(participants) || participants.length === 0) {
    return callback(null, sendErrorResponse(response, 400, "Missing or empty 'participants' array."));
  }

  const client = context.getTwilioClient();
  let newConversation;

  try {
    // Step 1: Create the Conversation
    console.log(`[CONV /createGroupConversation] Creating conversation: "${friendlyName}"`);
    const conversationAttributes = JSON.stringify({
      description: description || "",
      groupTwilioPhoneNumber: normalizeE164(twilioPhoneNumber), // store clean E.164 (no whatsapp: in attributes)
      createdBy: "whatsapp_groups_manager"
    });

    newConversation = await client.conversations.v1
      .services(CONVERSATIONS_SERVICE_SID)
      .conversations
      .create({
        friendlyName,
        attributes: conversationAttributes
      });
    console.log(`[CONV /createGroupConversation] Conversation created. Service: ${CONVERSATIONS_SERVICE_SID} SID: ${newConversation.sid}`);

    // Ensure the proxy is whatsapp:+E164
    const twilioWa = asWa(twilioPhoneNumber);
    if (!twilioWa) {
      return callback(null, sendErrorResponse(response, 400, "Invalid Twilio WhatsApp number. Provide a valid E.164 sender."));
    }

    // Step 2: Add Participants
    const whatsAppParticipantsToNotify = [];

    for (const p of participants) {
      const raw = (p.identifier || "").trim();
      if (!raw) {
        console.warn("[PARTICIPANT] Missing identifier, skipping:", p);
        continue;
      }

      // Conversations identity (not WhatsApp)
      if (raw.startsWith("client:")) {
        const chatIdentity = raw.slice("client:".length);
        console.log(`[PARTICIPANT] Adding Chat participant: ${chatIdentity}`);
        await client.conversations.v1
          .services(CONVERSATIONS_SERVICE_SID)
          .conversations(newConversation.sid)
          .participants
          .create({ identity: chatIdentity });
        continue;
      }

      // Normalize to whatsapp:+E164
      const waAddr = asWa(raw);
      if (!waAddr) {
        console.warn(`[PARTICIPANT] Invalid phone after normalization, skipping: "${raw}"`);
        continue;
      }

      console.log(`[PARTICIPANT] Adding WhatsApp participant: ${waAddr} via proxy ${twilioWa}`);
      await client.conversations.v1
        .services(CONVERSATIONS_SERVICE_SID)
        .conversations(newConversation.sid)
        .participants
        .create({
          "messagingBinding.address": waAddr,
          "messagingBinding.proxyAddress": twilioWa
        });

      whatsAppParticipantsToNotify.push(waAddr);
    }

    console.log(`[PARTICIPANT /createGroupConversation] Finished adding participants. ${whatsAppParticipantsToNotify.length} WhatsApp participants to notify.`);

    // Step 3: Send WhatsApp Template Message to WhatsApp Participants
    if (whatsAppParticipantsToNotify.length > 0) {
      console.log(`[WHATSAPP /createGroupConversation] Sending template SID ${WHATSAPP_TEMPLATE_SID} from ${twilioWa}`);
      for (const waIdentifier of whatsAppParticipantsToNotify) {
        try {
          console.log(`[WHATSAPP /createGroupConversation] Sending template to ${waIdentifier}`);
          await client.messages.create({
            contentSid: WHATSAPP_TEMPLATE_SID,
            from: twilioWa,
            to: waIdentifier
            // contentVariables: JSON.stringify({ '1': 'User', '2': friendlyName }) // if your template needs variables
          });
          console.log(`[WHATSAPP /createGroupConversation] Template message sent to ${waIdentifier}`);
        } catch (msgError) {
          console.error(`[WHATSAPP ERROR /createGroupConversation] Failed to send template to ${waIdentifier}:`, msgError);
        }
      }
    }

    console.log("[SUCCESS /createGroupConversation] Group conversation created and initial notifications attempted.");
    response.setStatusCode(201);
    response.setBody({
      success: true,
      message: "Group conversation created successfully.",
      conversationSid: newConversation.sid,
      friendlyName: newConversation.friendlyName,
      attributes: JSON.parse(newConversation.attributes)
    });
    return callback(null, response);

  } catch (error) {
    console.error("[CRITICAL ERROR /createGroupConversation]", error.message, error.stack);
    return callback(null, sendErrorResponse(response, 500, "Failed to create group conversation.", error.message));
  }
};

// Helper function for sending error responses
function sendErrorResponse(response, statusCode, message, detail = null) {
  console.error(`[ERROR RESPONSE /createGroupConversation] Status: ${statusCode}, Message: ${message}, Detail: ${detail}`);
  response.setStatusCode(statusCode);
  const errorBody = { success: false, message };
  if (detail) errorBody.detail = detail;
  response.setBody(errorBody);
  return response;
}
