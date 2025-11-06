async function ensureMapExists(client, serviceSid, mapUniqueName) {
  try {
    const map = await client.sync.v1.services(serviceSid)
      .syncMaps(mapUniqueName)
      .fetch();
    console.log(`[SYNC MAP] Sync Map "${mapUniqueName}" (SID: ${map.sid}) found.`);
    return map;
  } catch (error) {
    if (error.status === 404) {
      console.log(`[SYNC MAP] Sync Map "${mapUniqueName}" not found. Creating it...`);
      try {
        const newMap = await client.sync.v1.services(serviceSid)
          .syncMaps
          .create({ uniqueName: mapUniqueName, ttl: 0 });
        console.log(`[SYNC MAP] Sync Map "${mapUniqueName}" (SID: ${newMap.sid}) created.`);
        return newMap;
      } catch (createError) {
        console.error(`[SYNC MAP ERROR] Error creating Sync Map "${mapUniqueName}":`, createError);
        throw createError;
      }
    } else {
      console.error(`[SYNC MAP ERROR] Error fetching Sync Map "${mapUniqueName}":`, error);
      throw error;
    }
  }
}

// ---- Helpers: accept +E164 / digits / whatsapp:+E164; normalize to whatsapp:+E164
const E164 = /^\+[1-9]\d{1,14}$/;
const stripWa = s => String(s || "").trim().replace(/^whatsapp:/i, "");
const digitsPlus = s => String(s || "").replace(/[^\d+]/g, "");
const normalizeE164 = (input) => {
  const raw = digitsPlus(stripWa(input));
  if (!raw) return "";
  if (!raw.startsWith("+") && /^\d{8,15}$/.test(raw)) return `+${raw}`;
  return raw;
};
const toWhatsappKey = (input) => {
  const e164 = normalizeE164(input);
  if (!E164.test(e164)) return ""; // invalid after normalization
  return `whatsapp:${e164}`;
};
const normalizeIdentifier = (identifier) => {
  if (typeof identifier !== "string") return "";
  const trimmed = identifier.trim();
  if (trimmed.startsWith("client:")) return trimmed;             // leave chat identity as-is
  const waKey = toWhatsappKey(trimmed);                           // normalize phones
  return waKey;
};

exports.handler = async function(context, event, callback) {
  const response = new Twilio.Response();

  // --- Logging / request info
  console.log(`[SYNC-CONTACTS] Function Invoked. UTC: ${new Date().toISOString()}`);
  console.log('[SYNC-CONTACTS] Raw event object:', JSON.stringify(event, null, 2));

  // --- Derive httpMethod
  let httpMethodFromEvent = event.httpMethod;
  if (event.request && (event.request.method || event.request.httpMethod)) {
    httpMethodFromEvent = event.request.method || event.request.httpMethod;
  }
  console.log('[SYNC-CONTACTS] Initial httpMethodFromEvent:', httpMethodFromEvent);

  // --- CORS
  const clientRequestOrigin =
    (event.headers && (event.headers.origin || event.headers.Origin)) ||
    (event.request && event.request.headers && (event.request.headers.origin || event.request.headers.Origin));

  const configuredAllowedOrigins = (context.ALLOWED_ORIGINS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  let effectiveAllowOriginHeader = null;
  if (configuredAllowedOrigins.includes("*")) {
    effectiveAllowOriginHeader = "*";
  } else if (clientRequestOrigin) {
    const lowerSet = new Set(configuredAllowedOrigins.map(o => o.toLowerCase()));
    if (lowerSet.has(String(clientRequestOrigin).toLowerCase())) {
      effectiveAllowOriginHeader = clientRequestOrigin;
    }
  }
  if (effectiveAllowOriginHeader) {
    response.appendHeader("Access-Control-Allow-Origin", effectiveAllowOriginHeader);
  }
  response.appendHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.appendHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.appendHeader("Access-Control-Allow-Credentials", "true");

  if (String(httpMethodFromEvent).toUpperCase() === "OPTIONS") {
    console.log("[REQUEST] Handling OPTIONS preflight request.");
    response.setStatusCode(204);
    return callback(null, response);
  }
  response.appendHeader("Content-Type", "application/json");

  // --- Env var checks
  const requiredEnvVars = ['ACCOUNT_SID', 'AUTH_TOKEN', 'SYNC_SERVICE_SID', 'SYNC_MAP_UNIQUE_NAME'];
  for (const varName of requiredEnvVars) {
    if (!context[varName]) {
      const errorMsgDetail = `Missing environment variable: ${varName}`;
      console.error("[CONFIG ERROR]", errorMsgDetail);
      response.setStatusCode(500);
      response.setBody({ message: "Server configuration error", detail: errorMsgDetail });
      return callback(null, response);
    }
  }
  console.log("[CONFIG] Required environment variables are present.");

  const client = context.getTwilioClient();
  const syncServiceSid = context.SYNC_SERVICE_SID;
  const mapUniqueName = context.SYNC_MAP_UNIQUE_NAME;

  const requestPayload = event;
  console.log('[SYNC-CONTACTS] Using top-level event as requestPayload:', JSON.stringify(requestPayload, null, 2));
  console.log('[SYNC-CONTACTS] Client Request Origin:', clientRequestOrigin);

  try {
    await ensureMapExists(client, syncServiceSid, mapUniqueName);
    console.log("[REQUEST] Processing as POST request. Action from payload:", requestPayload.action);

    if (requestPayload.action === 'list') {
      console.log("[ACTION] List contacts.");
      const mapItems = await client.sync.v1.services(syncServiceSid)
        .syncMaps(mapUniqueName)
        .syncMapItems
        .list({ pageSize: 1000 });

      console.log(`[SYNC-CONTACTS LIST ACTION] Fetched ${mapItems.length} raw items from Sync.`);

      const contacts = mapItems.map((item, index) => {
        console.log(`[SYNC-CONTACTS LIST ACTION] Raw Item from SDK [${index}]:`, JSON.stringify(item, null, 2));
        const itemName = item.data && typeof item.data === 'object' ? item.data.name : null;
        const itemTeam = item.data && typeof item.data === 'object' ? item.data.team : null;

        return {
          id: item.key, // stored normalized key (e.g., whatsapp:+55119...)
          data: {
            name: itemName,
            identifier: item.key, // keep canonical identifier as key
            team: itemTeam
          }
        };
      });

      console.log(`[SUCCESS] Mapped ${contacts.length} contacts for 'list' action. Final mapped contacts to be sent:`, JSON.stringify(contacts, null, 2));
      response.setStatusCode(200);
      response.setBody({ contacts });

    } else if (requestPayload.action === 'delete') {
      // Accept +E164 / digits / whatsapp:+E164; normalize to key
      const rawKey = requestPayload.syncItemSid || requestPayload.key || requestPayload.identifier;
      const keyToDelete = (typeof rawKey === "string" && rawKey.startsWith("client:"))
        ? rawKey
        : normalizeIdentifier(rawKey);

      if (!keyToDelete) {
        console.error("[VALIDATION ERROR] Missing or invalid key for delete action. Payload:", JSON.stringify(requestPayload));
        response.setStatusCode(400);
        response.setBody({ message: "Missing or invalid 'syncItemSid' (item key) for delete action" });
        return callback(null, response);
      }

      console.log(`[ACTION] Delete contact with Key: ${keyToDelete}`);
      await client.sync.v1.services(syncServiceSid)
        .syncMaps(mapUniqueName)
        .syncMapItems(keyToDelete)
        .remove();
      console.log(`[SUCCESS] Contact with Key ${keyToDelete} deleted.`);
      response.setStatusCode(200);
      response.setBody({ message: "Contact deleted successfully" });

    } else {
      // Add/Update
      const { name, identifier, team } = requestPayload;
      if (!name || !identifier) {
        console.error("[VALIDATION ERROR] Missing 'name' or 'identifier' for add/update. Payload:", JSON.stringify(requestPayload));
        response.setStatusCode(400);
        response.setBody({ message: "Missing required fields (name/identifier) in payload for adding/updating a contact." });
        return callback(null, response);
      }

      const normalized = normalizeIdentifier(identifier);

      // If it's a chat identity, keep it; otherwise we expect a valid whatsapp:+E164 after normalization
      if (!normalized || (!normalized.startsWith("client:") && !/^whatsapp:\+[1-9]\d{1,14}$/.test(normalized))) {
        console.error(`[VALIDATION ERROR] Invalid identifier after normalization: input="${identifier}", normalized="${normalized}"`);
        response.setStatusCode(400);
        response.setBody({
          message: "Invalid identifier format",
          detail: "Provide a Conversations identity as 'client:<id>' or a phone number as +E164 (we'll normalize to whatsapp:+E164)."
        });
        return callback(null, response);
      }

      console.log(`[ACTION] Add/Update contact: ${normalized}`);
      const contactDataItem = { name, team: team || null };
      let mapItem;
      let httpStatusCode = 200;
      let message = "Contact updated successfully";

      try {
        mapItem = await client.sync.v1.services(syncServiceSid)
          .syncMaps(mapUniqueName)
          .syncMapItems
          .create({ key: normalized, data: contactDataItem });
        httpStatusCode = 201;
        message = "Contact created successfully";
        console.log(`[SUCCESS] Contact "${name}" (${normalized}) created. Key: ${mapItem.key}`);
      } catch (error) {
        if (error.code === 54305 || error.status === 409) {
          console.log(`Contact with key "${normalized}" already exists. Updating.`);
          mapItem = await client.sync.v1.services(syncServiceSid)
            .syncMaps(mapUniqueName)
            .syncMapItems(normalized)
            .update({ data: contactDataItem });
          console.log(`[SUCCESS] Contact "${name}" (${normalized}) updated. Key: ${mapItem.key}`);
        } else {
          throw error;
        }
      }

      response.setStatusCode(httpStatusCode);
      response.setBody({
        message,
        contact: {
          id: mapItem.key,
          sid: mapItem.sid,
          identifier: mapItem.key,
          name: mapItem.data.name,
          team: mapItem.data.team
        }
      });
    }

    return callback(null, response);

  } catch (error) {
    console.error("[CRITICAL ERROR] Unhandled exception in /sync-contacts function:", error.message, error.stack);
    response.setStatusCode(error.status || 500);
    response.setBody({
      message: "Failed to process contact request.",
      detail: error.message || "An internal server error occurred."
    });
    return callback(null, response);
  }
};
