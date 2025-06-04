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

    const client = context.getTwilioClient();
    const added = [];
    const skipped = [];
    const errors = [];

    for (const p of participants) {
        if (!p.identifier) {
            skipped.push(p);
            continue;
        }

        try {
            if (p.identifier.startsWith('whatsapp:')) {
                console.log(`[ADD PARTICIPANT] Adding WhatsApp: ${p.identifier}`);
                await client.conversations.v1.conversations(conversationSid)
                    .participants
                    .create({
                        'messagingBinding.address': p.identifier,
                        'messagingBinding.proxyAddress': twilioPhoneNumber,
                        attributes: { friendlyName: p.name || p.identifier }
                    });
            } else if (p.identifier.startsWith('client:')) {
                const identity = p.identifier.substring('client:'.length);
                console.log(`[ADD PARTICIPANT] Adding client identity: ${identity}`);
                await client.conversations.v1.conversations(conversationSid)
                    .participants
                    .create({
                        identity,
                        attributes: { friendlyName: p.name || identity }
                    });
            } else {
                console.warn(`[ADD PARTICIPANT] Unknown type, skipping: ${p.identifier}`);
                skipped.push(p);
                continue;
            }

            added.push(p.identifier);
        } catch (err) {
            console.error(`[ADD PARTICIPANT ERROR] Failed to add: ${p.identifier}`, err);
            errors.push({ identifier: p.identifier, error: err.message });
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
