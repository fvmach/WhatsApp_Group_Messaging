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

exports.handler = async function(context, event, callback) {
    const response = new Twilio.Response();
    // ... (all initial logging, CORS, OPTIONS check, Env Var checks as in your last correct version) ...
    console.log(`[SYNC-CONTACTS] Function Invoked. UTC: ${new Date().toISOString()}`);
    console.log('[SYNC-CONTACTS] Raw event object:', JSON.stringify(event, null, 2));
    let httpMethodFromEvent = event.httpMethod;
    if (event.request && (event.request.method || event.request.httpMethod)) {
        httpMethodFromEvent = event.request.method || event.request.httpMethod;
    }
    console.log('[SYNC-CONTACTS] Initial httpMethodFromEvent:', httpMethodFromEvent);
    const requestPayload = event;
    const clientRequestOrigin = (event.headers && event.headers.origin) || (event.request && event.request.headers && event.request.headers.origin);
    console.log('[SYNC-CONTACTS] Using top-level event as requestPayload:', JSON.stringify(requestPayload, null, 2));
    console.log('[SYNC-CONTACTS] Client Request Origin:', clientRequestOrigin);

    const configuredAllowedOrigins = (context.ALLOWED_ORIGINS || "").split(',');
    let effectiveAllowOriginHeader = null;
    if (configuredAllowedOrigins.includes('*')) {
        effectiveAllowOriginHeader = '*';
    } else if (clientRequestOrigin && configuredAllowedOrigins.includes(clientRequestOrigin.toLowerCase())) {
        effectiveAllowOriginHeader = clientRequestOrigin;
    }
    if (effectiveAllowOriginHeader) {
        response.appendHeader('Access-Control-Allow-Origin', effectiveAllowOriginHeader);
    }
    response.appendHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.appendHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.appendHeader('Access-Control-Allow-Credentials', 'true');

    if (String(httpMethodFromEvent).toUpperCase() === 'OPTIONS') {
        console.log("[REQUEST] Handling OPTIONS preflight request.");
        response.setStatusCode(204);
        return callback(null, response);
    }
    response.appendHeader('Content-Type', 'application/json');

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

                const contactObject = {
                    id: item.key, // MODIFIED: Use item.key (the whatsapp:+... string) as the 'id'
                    data: {
                        name: itemName,
                        identifier: item.key, // Keep item.key also as 'identifier' in data for consistency
                        team: itemTeam
                    }
                };
                console.log(`  Constructed contactObject [${index}]: ${JSON.stringify(contactObject, null, 2)}`);
                return contactObject;
            });
            
            console.log(`[SUCCESS] Mapped ${contacts.length} contacts for 'list' action. Final mapped contacts to be sent:`, JSON.stringify(contacts, null, 2));
            response.setStatusCode(200);
            response.setBody({ contacts: contacts });
            
        } else if (requestPayload.action === 'delete') {
            // MODIFICATION NEEDED HERE: If app.js sends item.key as 'syncItemSid', this needs to delete by KEY
            const itemKeyToDelete = requestPayload.syncItemSid; // This will now be the contact's key (e.g., whatsapp:+...)
            if (!itemKeyToDelete) {
                console.error("[VALIDATION ERROR] Missing 'syncItemSid' (which should be the item key) for delete action. Payload:", JSON.stringify(requestPayload));
                response.setStatusCode(400);
                response.setBody({ message: "Missing 'syncItemSid' (item key) for delete action" });
                return callback(null, response);
            }
            console.log(`[ACTION] Delete contact with Key: ${itemKeyToDelete}`);
            await client.sync.v1.services(syncServiceSid)
                .syncMaps(mapUniqueName)
                .syncMapItems(itemKeyToDelete) // Delete by KEY
                .remove();
            console.log(`[SUCCESS] Contact with Key ${itemKeyToDelete} deleted.`);
            response.setStatusCode(200);
            response.setBody({ message: "Contact deleted successfully" });

        } else { // Default to Add/Update contact
            const { name, identifier, team } = requestPayload;
            if (!name || !identifier) {
                console.error("[VALIDATION ERROR] Missing 'name' or 'identifier' from payload for add/update. Payload:", JSON.stringify(requestPayload));
                response.setStatusCode(400);
                response.setBody({ message: "Missing required fields (name/identifier) in payload for adding/updating a contact." });
                return callback(null, response);
            }
            if (typeof identifier !== 'string' || !(identifier.startsWith('whatsapp:') || identifier.startsWith('client:'))) {
                console.error(`[VALIDATION ERROR] Invalid identifier format: ${identifier}`);
                response.setStatusCode(400);
                response.setBody({ message: "Invalid identifier format", detail: "Identifier must be a string and start with 'whatsapp:' or 'client:'." });
                return callback(null, response);
            }

            console.log(`[ACTION] Add/Update contact: ${identifier}`);
            const contactDataItem = { name: name, team: team || null };
            let mapItem;
            let httpStatusCode = 200;
            let message = "Contact updated successfully";
            try {
                mapItem = await client.sync.v1.services(syncServiceSid)
                    .syncMaps(mapUniqueName)
                    .syncMapItems
                    .create({ key: identifier, data: contactDataItem }); // 'identifier' is used as key here
                httpStatusCode = 201; message = "Contact created successfully";
                console.log(`[SUCCESS] Contact "${name}" (${identifier}) created. Key: ${mapItem.key}`); // mapItem.sid would also be available here
            } catch (error) {
                if (error.code === 54305 || error.status === 409) { 
                    console.log(`Contact with identifier "${identifier}" already exists. Updating.`);
                    mapItem = await client.sync.v1.services(syncServiceSid)
                        .syncMaps(mapUniqueName)
                        .syncMapItems(identifier) // Update by key
                        .update({ data: contactDataItem });
                     console.log(`[SUCCESS] Contact "${name}" (${identifier}) updated. Key: ${mapItem.key}`);
                } else { throw error; }
            }
            response.setStatusCode(httpStatusCode);
            // For add/update, include both sid and key if possible, or decide on primary id
            response.setBody({ 
                message: message, 
                contact: { 
                    id: mapItem.key, // Send key as id
                    sid: mapItem.sid, // Also send SID if available and useful
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