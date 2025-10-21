
exports.handler = async function(context, event, callback) {
    const response = new Twilio.Response();
    // --- CORS Configuration ---
    // Assuming standard CORS setup is here (as in previous versions)
    const requestOrigin = event.headers && event.headers.origin;
    console.log(`[CORS DEBUG /getConversations] Function execution started. Request Origin: ${requestOrigin}`);
    const configuredAllowedOrigins = (context.ALLOWED_ORIGINS || "").split(',');
    let effectiveAllowOriginHeader = null;
    if (configuredAllowedOrigins.includes('*')) {
        effectiveAllowOriginHeader = '*';
    } else if (requestOrigin && configuredAllowedOrigins.includes(requestOrigin.toLowerCase())) {
        effectiveAllowOriginHeader = requestOrigin;
    }
    if (effectiveAllowOriginHeader) {
        response.appendHeader('Access-Control-Allow-Origin', effectiveAllowOriginHeader);
    }
    response.appendHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    response.appendHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.appendHeader('Access-Control-Allow-Credentials', 'true');

    let httpMethod = event.httpMethod;
    if (!httpMethod && event.request && (event.request.method || event.request.httpMethod)) {
        httpMethod = event.request.method || event.request.httpMethod;
    }
     if (String(httpMethod).toUpperCase() === 'OPTIONS') {
        console.log("[REQUEST /getConversations] Handling OPTIONS preflight request.");
        response.setStatusCode(204);
        return callback(null, response);
    }
    response.appendHeader('Content-Type', 'application/json');
    // --- End CORS ---

    // --- Environment Variable Checks ---
    const { ACCOUNT_SID, AUTH_TOKEN, CONVERSATIONS_SERVICE_SID } = context;
    if (!ACCOUNT_SID || !AUTH_TOKEN || !CONVERSATIONS_SERVICE_SID) {
        // ... (error handling for missing env vars)
        const errorMsg = "Server configuration error: Missing required Twilio credentials or Service SID.";
        console.error("[CONFIG ERROR /getConversations]", errorMsg);
        response.setStatusCode(500);
        response.setBody({ success: false, message: "Server configuration error.", detail: errorMsg });
        return callback(null, response);
    }
    console.log("[CONFIG /getConversations] Required environment variables are present.");

    const client = context.getTwilioClient();

    try {
        // --- Date Range Calculation ---
        let { startDate, endDate } = event; // Passed as query parameters from app.js

        if (!endDate) {
            const now = new Date();
            endDate = now.toISOString().split('T')[0] + 'T23:59:59Z'; // End of today
        } else {
            // Ensure endDate is end of day
            endDate = endDate.split('T')[0] + 'T23:59:59Z';
        }

        if (!startDate) {
            const ninetyDaysAgo = new Date();
            ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
            startDate = ninetyDaysAgo.toISOString().split('T')[0] + 'T00:00:00Z'; // Beginning of 90 days ago
        } else {
            // Ensure startDate is beginning of day
            startDate = startDate.split('T')[0] + 'T00:00:00Z';
        }

        console.log(`[CONV /getConversations] Fetching conversations for service SID: ${CONVERSATIONS_SERVICE_SID}`);
        console.log(`[CONV /getConversations] Date Range: ${startDate} to ${endDate}`);

        // The API list operation with date filters sorts by dateCreated descending.
        // We will fetch conversations within this date range.
        // The API does not support multiple 'state' values in one query.
        // We will fetch and then filter for 'active' and 'inactive'.
        const conversations = await client.conversations.v1.services(CONVERSATIONS_SERVICE_SID)
            .conversations
            .list({
                startDate: startDate,
                endDate: endDate,
                limit: 1000 // Max limit, consider pagination for very large sets
            });

        console.log(`[CONV /getConversations] Fetched ${conversations.length} conversations total within date range before state filtering.`);

        const formattedAndFilteredConversations = conversations
            .map(conv => {
                let attributes = {};
                try {
                    if (conv.attributes) {
                        attributes = JSON.parse(conv.attributes);
                    }
                } catch (e) {
                    console.warn(`[CONV /getConversations] Could not parse attributes for conversation ${conv.sid}: ${conv.attributes}`);
                }
                return {
                    sid: conv.sid,
                    friendlyName: conv.friendlyName,
                    attributes: attributes,
                    dateCreated: conv.dateCreated,
                    dateUpdated: conv.dateUpdated,
                    state: conv.state // e.g., 'active', 'inactive', 'closed'
                };
            })
            .filter(conv => conv.state === 'active' || conv.state === 'inactive' || conv.state === null); 
            // Note: `null` state can also be considered active for a period.
            // If you strictly only want 'active' and 'inactive', remove `|| conv.state === null`.

        console.log(`[CONV /getConversations] Successfully filtered ${formattedAndFilteredConversations.length} active/inactive group conversations.`);
        response.setStatusCode(200);
        response.setBody({
            success: true,
            conversations: formattedAndFilteredConversations
        });
        return callback(null, response);

    } catch (error) {
        console.error("[CRITICAL ERROR /getConversations]", error.message, error.stack);
        response.setStatusCode(error.status || 500);
        response.setBody({
            success: false,
            message: "Failed to fetch conversations.",
            detail: error.message
        });
        return callback(null, response);
    }
};