// /create-flex-interaction.js
exports.handler = async function handler(context, event, callback) {
  const response = new Twilio.Response();
  response.appendHeader('Content-Type', 'application/json');

  const {
    ACCOUNT_SID, AUTH_TOKEN,
    TASKROUTER_WORKSPACE_SID, TASKROUTER_WORKFLOW_SID
  } = context;

  const { conversationSid, channelType = 'whatsapp', initiatedBy = 'customer' } = event;

  if (!conversationSid) {
    response.setStatusCode(400);
    response.setBody({ success: false, message: "conversationSid is required" });
    return callback(null, response);
  }
  if (!TASKROUTER_WORKSPACE_SID) {
    response.setStatusCode(500);
    response.setBody({ success: false, message: "Missing TASKROUTER_WORKSPACE_SID" });
    return callback(null, response);
  }

  const client = context.getTwilioClient();

  try {
    // Read conversation & merge attributes
    const conv = await client.conversations.v1.conversations(conversationSid).fetch();
    const attrs = conv.attributes ? JSON.parse(conv.attributes) : {};

    // Reuse if already present
    if (attrs.flexInteraction?.sid && attrs.flexInteraction?.channelSid) {
      response.setBody({
        success: true,
        alreadyExisted: true,
        interactionSid: attrs.flexInteraction.sid,
        channelSid: attrs.flexInteraction.channelSid
      });
      return callback(null, response);
    }

    // Create Interaction bound to this Conversation
    // For customer-initiated binding: media_channel_sid (CH…) is required. :contentReference[oaicite:1]{index=1}
    const interaction = await client.flexApi.v1.interactions.create({
      channel: {
        type: channelType,                 // sms | whatsapp | chat | web | email | messenger | gbm
        initiated_by: initiatedBy,         // 'customer' binds to existing CH…  :contentReference[oaicite:2]{index=2}
        properties: { media_channel_sid: conversationSid }
      },
      // Routing is required unless you pass channel.sid; include at least workspace + workflow. :contentReference[oaicite:3]{index=3}
      routing: {
        properties: {
          workspace_sid: TASKROUTER_WORKSPACE_SID,
          ...(TASKROUTER_WORKFLOW_SID ? { workflow_sid: TASKROUTER_WORKFLOW_SID } : {}),
          attributes: {
            conversationSid,
            channelType
          }
        }
      }
    });

    // Fetch the Interaction Channel (UO…) link
    // The helper returns a minimal object; fetch channels to get UO SID.
    const channels = await client.flexApi.v1
      .interactions(interaction.sid)
      .channels
      .list({ limit: 1 });

    const channelSid = channels?.[0]?.sid;
    if (!channelSid) throw new Error("Could not resolve Interaction Channel SID (UO…)");

    // Persist to Conversation attributes for later Invites
    const newAttrs = {
      ...attrs,
      flexInteraction: { sid: interaction.sid, channelSid, channelType }
    };
    await client.conversations.v1.conversations(conversationSid)
      .update({ attributes: JSON.stringify(newAttrs) });

    response.setBody({
      success: true,
      interactionSid: interaction.sid,
      channelSid
    });
    return callback(null, response);

  } catch (err) {
    console.error("[create-flex-interaction] Error:", err);
    response.setStatusCode(500);
    response.setBody({ success: false, message: err.message });
    return callback(null, response);
  }
};
