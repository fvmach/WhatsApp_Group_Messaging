
exports.handler = function(context, event, callback) {
    // We expect the following to be set as Environment Variables and available in 'context':
    // 1. ACCOUNT_SID: Your main Twilio Account SID (often automatically available)
    // 2. API_KEY_SID: An API Key SID you create in the Twilio Console (e.g., SKxxxxxxxxxxxx)
    // 3. API_SECRET: The secret for the API Key SID above.
    // 4. CONVERSATIONS_SERVICE_SID: Your Conversations Service SID.
    // 5. ALLOWED_ORIGINS: For CORS.
    // 6. TOKEN_TTL (Optional): Token lifetime.
    // Note: context.AUTH_TOKEN will also be available if you checked the box for Twilio credentials,
    //       and is used by context.getTwilioClient() for server-to-server REST API calls.

    const response = new Twilio.Response();
    const requestOrigin = event.headers && event.headers.origin;

    // --- CORS Configuration & Logging ---
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
        console.log('[CORS DEBUG] Origin NOT ALLOWED based on ALLOWED_ORIGINS. Access-Control-Allow-Origin header WILL NOT be set for non-OPTIONS request from this origin:', requestOrigin);
    }
    response.appendHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.appendHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.appendHeader('Access-Control-Allow-Credentials', 'true');
    // --- End CORS ---

    if (event.httpMethod === 'OPTIONS') {
        console.log('[REQUEST] Handling OPTIONS preflight request.');
        response.setStatusCode(204);
        return callback(null, response);
    }

    response.appendHeader('Content-Type', 'application/json');

    // --- Environment Variable Access & Validation ---
    const accountSid = context.ACCOUNT_SID; // Uses the standard context.ACCOUNT_SID
    const apiKeySid = context.API_KEY_SID;   // Expects you to set API_KEY_SID as an Env Var
    const apiSecret = context.API_SECRET;   // Expects you to set API_SECRET as an Env Var
    const conversationsServiceSid = context.CONVERSATIONS_SERVICE_SID;
    const tokenTtl = context.TOKEN_TTL;

    console.log(`[CONFIG] Using ACCOUNT_SID: ${accountSid ? 'Present' : 'MISSING!'}`);
    console.log(`[CONFIG] Using API_KEY_SID: ${apiKeySid ? 'Present' : 'MISSING!'}`);
    console.log(`[CONFIG] Using API_SECRET: ${apiSecret ? 'Present (presence check only)' : 'MISSING!'}`);
    console.log(`[CONFIG] Using CONVERSATIONS_SERVICE_SID: ${conversationsServiceSid ? 'Present' : 'MISSING!'}`);
    if (context.AUTH_TOKEN) {
        console.log('[INFO] context.AUTH_TOKEN is available (used by context.getTwilioClient() for REST API calls, NOT for this AccessToken generation).');
    }


    if (!accountSid || !apiKeySid || !apiSecret || !conversationsServiceSid) {
        let missingVars = [];
        if (!accountSid) missingVars.push("ACCOUNT_SID");
        if (!apiKeySid) missingVars.push("API_KEY_SID (must be an SK... value set as env var)");
        if (!apiSecret) missingVars.push("API_SECRET (the secret for your API_KEY_SID, set as env var)");
        if (!conversationsServiceSid) missingVars.push("CONVERSATIONS_SERVICE_SID");
        
        const errorMsg = `Server configuration error: Missing required environment variable(s): ${missingVars.join(', ')}. Please create an API Key in the Twilio Console and set API_KEY_SID and API_SECRET as environment variables.`;
        console.error("[CONFIG ERROR]", errorMsg);
        response.setStatusCode(500);
        response.setBody({ message: "Server configuration error.", detail: errorMsg });
        return callback(null, response);
    }

    // --- Hardcoded Identity ---
    const identity = "whatsapp_groups_manager";
    console.log('[IDENTITY] Using hardcoded identity for Access Token:', JSON.stringify(identity));
    if (event.identity) { // Log what client sent, even if ignored
        console.log('[INFO] Client POST body included identity (ignored for token):', JSON.stringify(event.identity));
    }

    // --- Token Generation ---
    try {
        console.log(`[TOKEN GEN] Attempting to generate token for identity: "${identity}"`);
        const AccessToken = Twilio.jwt.AccessToken;
        const ChatGrant = AccessToken.ChatGrant;

        const token = new AccessToken(
            accountSid, // From context.ACCOUNT_SID
            apiKeySid,  // From context.API_KEY_SID (must be SK...)
            apiSecret,  // From context.API_SECRET
            {
                identity: identity,
                ttl: parseInt(tokenTtl) || 3600
            }
        );

        const chatGrant = new ChatGrant({ serviceSid: conversationsServiceSid });
        token.addGrant(chatGrant);
        const jwtToken = token.toJwt();
        console.log('[TOKEN GEN] Token generated successfully.');

        response.setStatusCode(200);
        response.setBody({ identity: identity, token: jwtToken });
        return callback(null, response);

    } catch (e) {
        console.error("[TOKEN GEN CRITICAL ERROR] Exception during token creation:", e.message, e.stack);
        response.setStatusCode(500);
        response.setBody({ message: "Critical error during token generation.", detail: e.message });
        return callback(null, response);
    }
};