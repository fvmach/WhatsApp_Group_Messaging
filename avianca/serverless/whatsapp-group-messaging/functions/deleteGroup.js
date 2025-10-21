exports.handler = async function(context, event, callback) {
const response = new Twilio.Response();
const requestOrigin = event.headers && event.headers.origin;

console.log(`[CORS DEBUG] Function execution started. Current UTC: ${new Date().toISOString()}`);
console.log('[CORS DEBUG] Request Origin Header:', requestOrigin);
console.log('[CORS DEBUG] Environment ALLOWED_ORIGINS:', context.ALLOWED_ORIGINS);

const configuredAllowedOrigins = (context.ALLOWED_ORIGINS || "").split(',');
console.log('[CORS DEBUG] Parsed configuredAllowedOrigins:', configuredAllowedOrigins);

let effectiveAllowOriginHeader = null;
if (configuredAllowedOrigins.includes('*')) {
    effectiveAllowOriginHeader = '*';
} else if (requestOrigin && configuredAllowedOrigins.includes(requestOrigin.toLowerCase())) {
    effectiveAllowOriginHeader = requestOrigin;
}

if (effectiveAllowOriginHeader) {
    response.appendHeader('Access-Control-Allow-Origin', effectiveAllowOriginHeader);
    console.log('[CORS DEBUG] Setting Access-Control-Allow-Origin to:', effectiveAllowOriginHeader);
} else {
    console.log('[CORS DEBUG] Origin NOT ALLOWED. Skipping Access-Control-Allow-Origin header for:', requestOrigin);
}

response.appendHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
response.appendHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
response.appendHeader('Access-Control-Allow-Credentials', 'true');

if (event.httpMethod === 'OPTIONS') {
    console.log('[REQUEST] Handling OPTIONS preflight request.');
    response.setStatusCode(204);
    return callback(null, response);
}

response.appendHeader('Content-Type', 'application/json');


    // --- Input Validation ---
    const { conversationSid } = event;
    if (!conversationSid) {
        response.setStatusCode(400);
        response.setBody({ success: false, message: 'Missing conversationSid.' });
        return callback(null, response);
    }

    try {
        const client = context.getTwilioClient();
        console.log(`[deleteGroup] Deleting conversation SID: ${conversationSid}`);

        await client.conversations.v1.conversations(conversationSid).remove();

        response.setStatusCode(200);
        response.setBody({ success: true, message: 'Group deleted successfully.' });
        return callback(null, response);
    } catch (error) {
        console.error('[deleteGroup] Error:', error);
        response.setStatusCode(500);
        response.setBody({ success: false, message: 'Failed to delete group.', error: error.message });
        return callback(null, response);
    }
};
