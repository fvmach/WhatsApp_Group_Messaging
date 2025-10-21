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
      const newMap = await client.sync.v1.services(serviceSid)
        .syncMaps
        .create({ uniqueName: mapUniqueName, ttl: 0 });
      console.log(`[SYNC MAP] Sync Map "${mapUniqueName}" (SID: ${newMap.sid}) created.`);
      return newMap;
    }
    console.error(`[SYNC MAP ERROR] Error fetching Sync Map "${mapUniqueName}":`, error);
    throw error;
  }
}

function stripWhatsappPrefix(identifier) {
  return identifier.startsWith("whatsapp:") ? identifier.slice(9) : identifier;
}

exports.handler = async function(context, event, callback) {
  const response = new Twilio.Response();
  response.appendHeader("Content-Type", "application/json");

  console.log(`[SYNC-CONTACTS] Invoked. UTC: ${new Date().toISOString()}`);
  console.log("[SYNC-CONTACTS] Raw event:", JSON.stringify(event));

  const client = context.getTwilioClient();
  const syncServiceSid = context.SYNC_SERVICE_SID;
  const mapUniqueName = context.SYNC_MAP_UNIQUE_NAME;

  try {
    await ensureMapExists(client, syncServiceSid, mapUniqueName);
    const action = event.action || "addOrUpdate";
    let contacts = [];

    if (action === "list") {
      console.log("[ACTION] List contacts");
      const items = await client.sync.v1.services(syncServiceSid)
        .syncMaps(mapUniqueName)
        .syncMapItems.list({ pageSize: 1000 });

      contacts = items.map(item => ({
        id: item.key, // whatsapp:+E164
        data: {
          identifier: stripWhatsappPrefix(item.key), // plain +E164
          name: item.data?.name || null,
          team: item.data?.team || null
        }
      }));

    } else if (action === "delete") {
      const itemKey = event.itemKey || event.syncItemSid;
      if (!itemKey) {
        response.setStatusCode(400);
        response.setBody({ message: "Missing 'itemKey' for delete" });
        return callback(null, response);
      }
      console.log(`[ACTION] Delete contact ${itemKey}`);
      await client.sync.v1.services(syncServiceSid)
        .syncMaps(mapUniqueName)
        .syncMapItems(itemKey)
        .remove();
      contacts = []; // nothing returned

    } else { // Add or Update
      const { name, identifier, team } = event;
      if (!name || !identifier) {
        response.setStatusCode(400);
        response.setBody({ message: "Missing required fields (name/identifier)" });
        return callback(null, response);
      }

      // Normalize identifier → always whatsapp:+E164
      let normalizedIdentifier = identifier;
      if (/^\+[1-9]\d{6,14}$/.test(identifier)) {
        normalizedIdentifier = `whatsapp:${identifier}`;
      }

      console.log(`[ACTION] Add/Update ${normalizedIdentifier}`);
      const contactData = { name, team: team || null };
      let item;
      try {
        item = await client.sync.v1.services(syncServiceSid)
          .syncMaps(mapUniqueName)
          .syncMapItems.create({ key: normalizedIdentifier, data: contactData });
      } catch (err) {
        if (err.code === 54305 || err.status === 409) {
          item = await client.sync.v1.services(syncServiceSid)
            .syncMaps(mapUniqueName)
            .syncMapItems(normalizedIdentifier)
            .update({ data: contactData });
        } else throw err;
      }

      contacts = [{
        id: item.key, // whatsapp:+E164
        data: {
          identifier: stripWhatsappPrefix(item.key),
          name: item.data.name,
          team: item.data.team
        }
      }];
    }

    response.setStatusCode(200);
    response.setBody({ contacts });
    return callback(null, response);

  } catch (error) {
    console.error("[SYNC-CONTACTS ERROR]", error);
    response.setStatusCode(error.status || 500);
    response.setBody({ message: "Internal error", detail: error.message });
    return callback(null, response);
  }
};
