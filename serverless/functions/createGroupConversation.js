
exports.handler = async function(context, event, callback) {
    // --- CORS Configuration ---
    const response = new Twilio.Response();
    const requestOrigin = event.headers && event.headers.origin;
    console.log(`[CORS DEBUG /createGroupConversation] Function execution started. Request Origin: ${requestOrigin}`);
    console.log(`[CORS DEBUG /createGroupConversation] Environment ALLOWED_ORIGINS: ${context.ALLOWED_ORIGINS}`);

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
    response.appendHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    response.appendHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    response.appendHeader('Access-Control-Allow-Credentials', 'true');

    // Attempt to derive httpMethod robustly for OPTIONS check
    let httpMethod = event.httpMethod;
    if (!httpMethod && event.request && (event.request.method || event.request.httpMethod)) {
        httpMethod = event.request.method || event.request.httpMethod;
    }
    console.log(`[REQUEST /createGroupConversation] Derived httpMethod for OPTIONS check: ${httpMethod}`);

    if (String(httpMethod).toUpperCase() === 'OPTIONS') {
        console.log("[REQUEST /createGroupConversation] Handling OPTIONS preflight request.");
        response.setStatusCode(204);
        return callback(null, response);
    }
    response.appendHeader('Content-Type', 'application/json');
    // --- End CORS ---

    // --- Environment Variable Checks ---
    const { ACCOUNT_SID, AUTH_TOKEN, CONVERSATIONS_SERVICE_SID, WHATSAPP_TEMPLATE_SID } = context;
    if (!ACCOUNT_SID || !AUTH_TOKEN || !CONVERSATIONS_SERVICE_SID || !WHATSAPP_TEMPLATE_SID) {
        let missing = [];
        if (!ACCOUNT_SID) missing.push("ACCOUNT_SID");
        if (!AUTH_TOKEN) missing.push("AUTH_TOKEN");
        if (!CONVERSATIONS_SERVICE_SID) missing.push("CONVERSATIONS_SERVICE_SID");
        if (!WHATSAPP_TEMPLATE_SID) missing.push("WHATSAPP_TEMPLATE_SID");
        const errorMsg = `Server configuration error: Missing environment variable(s): ${missing.join(', ')}.`;
        console.error("[CONFIG ERROR /createGroupConversation]", errorMsg);
        response.setStatusCode(500);
        response.setBody({ success: false, message: "Server configuration error.", detail: errorMsg });
        return callback(null, response);
    }
    console.log("[CONFIG /createGroupConversation] Required environment variables are present.");

    // --- Input Validation & Payload Extraction ---
    // Assuming payload is at the top-level of 'event' due to previous findings
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
            groupTwilioPhoneNumber: twilioPhoneNumber,
            createdBy: "whatsapp_groups_manager" // Or pass actual initiator if available
        });

        newConversation = await client.conversations.v1.conversations.create({
            friendlyName: friendlyName,
            attributes: conversationAttributes,
            // xTwilioWebhookEnabled: true // If you plan to use webhooks for this conversation
        });
        console.log(`[CONV /createGroupConversation] Conversation created. SID: ${newConversation.sid}`);

        // Step 2: Add Participants
        const whatsAppParticipantsToNotify = [];
        for (const p of participants) {
            if (!p.identifier) {
                console.warn(`[PARTICIPANT /createGroupConversation] Participant missing identifier, skipping:`, p);
                continue;
            }
            try {
                if (p.identifier.startsWith('whatsapp:')) {
                    console.log(`[PARTICIPANT /createGroupConversation] Adding WhatsApp participant: ${p.identifier} to ${newConversation.sid} via proxy ${twilioPhoneNumber}`);
                    await client.conversations.v1.conversations(newConversation.sid)
                        .participants
                        .create({
                            'messagingBinding.address': p.identifier,
                            'messagingBinding.proxyAddress': twilioPhoneNumber
                        });
                    whatsAppParticipantsToNotify.push(p.identifier);
                } else if (p.identifier.startsWith('client:')) {
                    const chatIdentity = p.identifier.substring('client:'.length);
                    console.log(`[PARTICIPANT /createGroupConversation] Adding Chat participant: ${chatIdentity} to ${newConversation.sid}`);
                    await client.conversations.v1.conversations(newConversation.sid)
                        .participants
                        .create({ identity: chatIdentity });
                } else {
                    console.warn(`[PARTICIPANT /createGroupConversation] Unknown participant identifier type, skipping: ${p.identifier}`);
                }
            } catch (participantError) {
                console.error(`[PARTICIPANT ERROR /createGroupConversation] Failed to add participant ${p.identifier} to ${newConversation.sid}:`, participantError);
                // Decide if you want to continue adding others or fail the whole process
            }
        }
        console.log(`[PARTICIPANT /createGroupConversation] Finished adding participants. ${whatsAppParticipantsToNotify.length} WhatsApp participants to notify.`);

        // Step 3: Send WhatsApp Template Message to WhatsApp Participants
        if (whatsAppParticipantsToNotify.length > 0) {
            console.log(`[WHATSAPP /createGroupConversation] Sending template SID ${WHATSAPP_TEMPLATE_SID} from ${twilioPhoneNumber}`);
            for (const waIdentifier of whatsAppParticipantsToNotify) {
                try {
                    // NOTE: For contentVariables, you need to know what your template expects.
                    // Example: if template is "Hi {{1}}, welcome to the {{2}} group! Reply with 'Yes' or 'No'."
                    // const contentVariables = JSON.stringify({
                    //     '1': participants.find(p => p.identifier === waIdentifier)?.name || 'User', // Get participant name if available
                    //     '2': friendlyName
                    // });
                    // If your template has no variables, omit contentVariables or pass null/empty object.
                    
                    console.log(`[WHATSAPP /createGroupConversation] Sending template to ${waIdentifier}`);
                    await client.messages.create({
                        contentSid: WHATSAPP_TEMPLATE_SID,
                        // contentVariables: contentVariables, // Uncomment and adjust if your template uses variables
                        from: twilioPhoneNumber, // This must be a WhatsApp-enabled Twilio number
                        to: waIdentifier
                    });
                    console.log(`[WHATSAPP /createGroupConversation] Template message sent to ${waIdentifier}`);
                } catch (msgError) {
                    console.error(`[WHATSAPP ERROR /createGroupConversation] Failed to send template to ${waIdentifier}:`, msgError);
                    // Decide if you want to collect these errors or fail
                }
            }
        }

        console.log("[SUCCESS /createGroupConversation] Group conversation created and initial notifications attempted.");
        response.setStatusCode(201); // 201 Created
        response.setBody({
            success: true,
            message: "Group conversation created successfully.",
            conversationSid: newConversation.sid,
            friendlyName: newConversation.friendlyName,
            attributes: JSON.parse(newConversation.attributes) // Parse attributes back to object for response
        });
        return callback(null, response);

    } catch (error) {
        console.error("[CRITICAL ERROR /createGroupConversation]", error.message, error.stack);
        // If conversation was partially created, you might want to clean it up or log for manual review.
        // For now, just return a generic server error.
        return callback(null, sendErrorResponse(response, 500, "Failed to create group conversation.", error.message));
    }
};

// Helper function for sending error responses
function sendErrorResponse(response, statusCode, message, detail = null) {
    console.error(`[ERROR RESPONSE /createGroupConversation] Status: ${statusCode}, Message: ${message}, Detail: ${detail}`);
    response.setStatusCode(statusCode);
    const errorBody = { success: false, message: message };
    if (detail) {
        errorBody.detail = detail;
    }
    response.setBody(errorBody);
    return response;
}