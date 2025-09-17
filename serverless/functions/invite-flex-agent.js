exports.handler = async function (context, event, callback) {
  const client = context.getTwilioClient();
  const response = new Twilio.Response();

  // --- CORS Headers ---
  const requestOrigin =
    event.headers?.origin || event.request?.headers?.origin || '';
  const allowedOrigins = ['http://localhost:3000', 'http://localhost:8000', 'https://flex.twilio.com'];
  const allowOrigin = allowedOrigins.includes(requestOrigin) ? requestOrigin : null;

  if (!allowOrigin) {
    response.appendHeader('Content-Type', 'application/json');
    response.setStatusCode(403);
    response.setBody({ error: 'Origin not allowed' });
    return callback(null, response);
  }

  response.appendHeader('Access-Control-Allow-Origin', allowOrigin);
  response.appendHeader('Access-Control-Allow-Methods', 'OPTIONS, POST');
  response.appendHeader('Access-Control-Allow-Headers', 'Content-Type');
  response.appendHeader('Access-Control-Allow-Credentials', 'true');
  response.appendHeader('Content-Type', 'application/json');

  // --- Preflight ---
  const method = event.httpMethod || event.request?.method;
  if (method === 'OPTIONS') {
    console.log('[invite-flex-agent] CORS preflight response sent');
    response.setStatusCode(204);
    return callback(null, response);
  }

  try {
    // Accept JSON body (Runtime V2 passes parsed fields on event for JSON)
    let payload = {};
    try { payload = typeof event.body === 'string' ? JSON.parse(event.body) : (event || {}); } catch {}
    const { conversationSid, queueSid, workerSid, inviteAttributes = {} } = payload;

    console.log('[invite-flex-agent] Payload received:', {
      conversationSid,
      queueSid: queueSid || 'none',
      workerSid: workerSid || 'none'
    });

    if (!conversationSid) {
      response.setStatusCode(400);
      response.setBody({ error: 'Missing conversationSid' });
      return callback(null, response);
    }

    // Create Interaction linked to existing Conversation - using the correct singular API
    console.log('[invite-flex-agent] Creating interaction...');
    
    // Build routing properties carefully - don't include null/undefined values
    const routingProperties = {
      workspace_sid: context.TASKROUTER_WORKSPACE_SID,
      task_channel_unique_name: 'chat',
      attributes: JSON.stringify({
        conversationSid,
        from: conversationSid, // Use conversationSid as the from identifier
        ...inviteAttributes
      })
    };
    
    // Add workflow_sid if available (typically required for TaskRouter operations)
    if (context.TASKROUTER_WORKFLOW_SID) {
      routingProperties.workflow_sid = context.TASKROUTER_WORKFLOW_SID;
    }

    // Only add worker_sid OR queue_sid, not both at the same time
    if (workerSid && workerSid !== 'none') {
      routingProperties.worker_sid = workerSid;
    } else if (queueSid && queueSid !== 'none') {
      routingProperties.queue_sid = queueSid;
    }

    console.log('[invite-flex-agent] Routing properties:', JSON.stringify(routingProperties, null, 2));

    const interaction = await client.flexApi.v1.interaction.create({
      channel: {
        type: 'whatsapp',
        initiated_by: 'customer',
        properties: { media_channel_sid: conversationSid },
      },
      routing: {
        properties: {
          workspace_sid: context.TASKROUTER_WORKSPACE_SID,
          task_channel_unique_name: 'chat',
          ...(context.TASKROUTER_WORKFLOW_SID ? { workflow_sid: context.TASKROUTER_WORKFLOW_SID } : {}),
          ...(queueSid && queueSid !== 'none' ? { queue_sid: queueSid } : {}),
          ...(workerSid && workerSid !== 'none' ? { worker_sid: workerSid } : {}),
          attributes: {
            conversationSid,
            ...inviteAttributes
          },
        },
      },
    });

    console.log('[invite-flex-agent] Interaction created:', interaction.sid);

    // Optional explicit Invite (queue or worker) to generate a routed task
    if ((queueSid && queueSid !== 'none') || (workerSid && workerSid !== 'none')) {
      console.log('[invite-flex-agent] Creating explicit invite...');
      
      const inviteRoutingProperties = {
        workspace_sid: context.TASKROUTER_WORKSPACE_SID,
        task_channel_unique_name: 'chat',
        attributes: JSON.stringify({
          conversationSid,
          ...inviteAttributes
        })
      };
      
      // Add workflow_sid if available
      if (context.TASKROUTER_WORKFLOW_SID) {
        inviteRoutingProperties.workflow_sid = context.TASKROUTER_WORKFLOW_SID;
      }

      // Only add worker_sid OR queue_sid for invite
      if (workerSid && workerSid !== 'none') {
        inviteRoutingProperties.worker_sid = workerSid;
      } else if (queueSid && queueSid !== 'none') {
        inviteRoutingProperties.queue_sid = queueSid;
      }

      await client.flexApi.v1
        .interaction(interaction.sid)
        .channels(interaction.channel.sid)
        .invites.create({
          routing: {
            properties: inviteRoutingProperties,
          },
        });
      console.log('[invite-flex-agent] Explicit invite created successfully');
    }

    // Update conversation attributes to track the interaction
    try {
      const conv = await client.conversations.v1.conversations(conversationSid).fetch();
      let attrs = {};
      try { 
        attrs = conv.attributes ? JSON.parse(conv.attributes) : {}; 
      } catch { 
        attrs = {}; 
      }

      const updatedAttrs = {
        ...attrs,
        flexInteraction: {
          sid: interaction.sid,
          channelSid: interaction.channel?.sid,
          createdAt: new Date().toISOString()
        }
      };

      await client.conversations.v1.conversations(conversationSid)
        .update({ attributes: JSON.stringify(updatedAttrs) });

      console.log('[invite-flex-agent] Conversation attributes updated');
    } catch (attrError) {
      console.log('[invite-flex-agent] Warning: Could not update conversation attributes:', attrError.message);
      // Don't fail the whole operation if attribute update fails
    }

    response.setStatusCode(201);
    response.setBody({ 
      success: true,
      interactionSid: interaction.sid,
      message: 'Flex agent invitation sent successfully'
    });
    return callback(null, response);
  } catch (err) {
    console.error('[invite-flex-agent] Error:', err);
    response.setStatusCode(500);
    response.setBody({ 
      success: false,
      error: err.message 
    });
    return callback(null, response);
  }
};
