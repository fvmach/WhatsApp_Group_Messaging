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

    const { conversationSid, participantSid } = event;

    if (!conversationSid || !participantSid) {
        response.setStatusCode(400);
        response.setBody({
            success: false,
            message: 'Missing required parameters: conversationSid or participantSid.'
        });
        return callback(null, response);
    }

    const client = context.getTwilioClient();

    try {
        await client.conversations.v1.conversations(conversationSid)
            .participants(participantSid)
            .remove();

        response.setStatusCode(200);
        response.setBody({
            success: true,
            message: `Participant ${participantSid} removed from conversation ${conversationSid}.`
        });
    } catch (err) {
        console.error('[REMOVE PARTICIPANT ERROR]', err);
        response.setStatusCode(500);
        response.setBody({
            success: false,
            message: `Failed to remove participant: ${err.message}`
        });
    }

    return callback(null, response);
};
