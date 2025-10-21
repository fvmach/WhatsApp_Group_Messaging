exports.handler = async function(context, event, callback) {
  const response = new Twilio.Response();
  response.appendHeader("Content-Type", "application/json");

  const client = context.getTwilioClient();
  const { SYNC_SERVICE_SID, SYNC_MAP_UNIQUE_NAME } = context;

  try {
    const { EventType, Author, Body, ConversationSid, ParticipantSid } = event;

    // Accept both forms: onMessageAdd (from service) and onMessageAdded (some docs/examples)
    const handledEvents = ["onMessageAdd", "onMessageAdded"];
    if (!handledEvents.includes(EventType)) {
      console.log(`[SKIP] EventType ${EventType} is not handled.`);
      response.setBody({});
      return callback(null, response);
    }

    if (!Body || !Author) {
      console.warn("[SKIP] Missing message body or author.");
      response.setBody({});
      return callback(null, response);
    }

    // --- Helper to strip whatsapp: prefix for display if needed
    const stripWa = (s) => String(s || "").replace(/^whatsapp:/, "");

    let displayName = null;

    // 1) Try Sync Map lookup (expected key format: whatsapp:+E164)
    if (SYNC_SERVICE_SID && SYNC_MAP_UNIQUE_NAME) {
      try {
        const item = await client.sync.v1
          .services(SYNC_SERVICE_SID)
          .syncMaps(SYNC_MAP_UNIQUE_NAME)
          .syncMapItems(Author) // Author is often 'whatsapp:+E164'
          .fetch();

        if (item?.data && typeof item.data === "object" && item.data.name) {
          displayName = String(item.data.name);
          console.log(`[NAME] Resolved from Sync for key "${Author}": ${displayName}`);
        } else {
          console.log(`[NAME] Sync item found for "${Author}" but no 'name' in data.`);
        }
      } catch (e) {
        if (e.status === 404) {
          console.log(`[NAME] No Sync contact found for key "${Author}".`);
        } else {
          console.warn("[NAME] Error fetching Sync contact:", e.message);
        }
      }
    } else {
      console.log("[NAME] SYNC_* env vars not set; skipping Sync lookup.");
    }

    // 2) If still unknown and we have a participant, ask Conversations for hints
    if (!displayName && ConversationSid && ParticipantSid) {
      try {
        const participant = await client.conversations.v1
          .conversations(ConversationSid)
          .participants(ParticipantSid)
          .fetch();

        // Try attributes.friendlyName
        let friendly = null;
        try {
          if (participant.attributes) {
            const attrs = JSON.parse(participant.attributes);
            friendly = attrs?.friendlyName || null;
          }
        } catch (_) { /* ignore parse issues */ }

        displayName =
          friendly ||
          participant.identity ||                      // chat identity
          participant.messagingBinding?.address ||     // whatsapp:+E164 / sms:+E164
          null;

        if (displayName) {
          console.log(`[NAME] Resolved from participant: ${displayName}`);
        }
      } catch (e) {
        console.warn("[NAME] Error fetching participant:", e.message);
      }
    }

    // 3) Fallbacks
    if (!displayName) {
      if (Author.startsWith("whatsapp:")) {
        displayName = stripWa(Author); // show +E164 if we have nothing better
      } else {
        displayName = Author;
      }
      console.log(`[NAME] Using fallback display name: ${displayName}`);
    }

    const authorLine = `\`${displayName}\``;
    const formattedBody = `${authorLine}\n${Body}`;

    console.log(`[MODIFY] Message updated from "${Body}" to "${formattedBody}"`);

    // NOTE: This only takes effect for pre-event webhooks.
    response.setBody({ body: formattedBody });
    return callback(null, response);

  } catch (error) {
    console.error("[ERROR webhook]", error.message, error.stack);
    response.setStatusCode(500);
    response.setBody({ error: "Internal Server Error" });
    return callback(null, response);
  }
};
