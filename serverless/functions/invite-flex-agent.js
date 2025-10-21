exports.handler = async function (context, event, callback) {
  const client = context.getTwilioClient();
  const response = new Twilio.Response();

  // --- CORS Headers ---
  const requestOrigin = event.request?.headers?.origin || event.headers?.origin || '';
  console.log(`[CORS DEBUG /invite-flex-agent] Function execution started. Request Origin: ${requestOrigin}`);
  
  const allowedOrigins = context.ALLOWED_ORIGINS ? 
    context.ALLOWED_ORIGINS.split(',').map(origin => origin.trim()) : 
    ['http://localhost:3000', 'http://localhost:8000', 'https://flex.twilio.com'];
  
  const allowOrigin = allowedOrigins.includes('*') || allowedOrigins.includes(requestOrigin) ? 
    (allowedOrigins.includes('*') ? '*' : requestOrigin) : null;

  if (!allowOrigin && requestOrigin) {
    console.log(`[CORS DEBUG /invite-flex-agent] Origin ${requestOrigin} not in allowed list: ${allowedOrigins.join(', ')}`);
    response.appendHeader('Content-Type', 'application/json');
    response.setStatusCode(403);
    response.setBody({ error: 'Origin not allowed' });
    return callback(null, response);
  }

  response.appendHeader('Access-Control-Allow-Origin', allowOrigin || '*');
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
    console.log('[invite-flex-agent] RAW event:', JSON.stringify({
      request: typeof event.request,
      conversationSid: event.conversationSid,
      workerSid: event.workerSid,
      queueSid: event.queueSid,
      inviteAttributes: typeof event.inviteAttributes
    }));

    // Environment validation
    const requiredVars = ['TASKROUTER_WORKSPACE_SID', 'TASKROUTER_WORKFLOW_SID'];
    const missingVars = requiredVars.filter(varName => !context[varName]);
    if (missingVars.length > 0) {
      console.log('[invite-flex-agent] Missing environment variables:', missingVars);
      response.setStatusCode(500);
      response.setBody({ success: false, error: `Missing environment variables: ${missingVars.join(', ')}` });
      return callback(null, response);
    }
    
    console.log('[invite-flex-agent] Env check:', {
      TASKROUTER_WORKSPACE_SID: context.TASKROUTER_WORKSPACE_SID,
      TASKROUTER_WORKFLOW_SID: context.TASKROUTER_WORKFLOW_SID
    });

    // Parse request body
    let body = {};
    if (typeof event.body === 'string') {
      try {
        body = JSON.parse(event.body);
      } catch (parseError) {
        console.log('[invite-flex-agent] JSON parse error:', parseError.message);
      }
    } else {
      body = event;
    }
    
    console.log('[invite-flex-agent] Parsed body:', JSON.stringify({
      request: typeof body.request,
      conversationSid: body.conversationSid,
      workerSid: body.workerSid,
      queueSid: body.queueSid,
      inviteAttributes: typeof body.inviteAttributes
    }));

    const { conversationSid, queueSid, workerSid, inviteAttributes = {} } = body;

    if (!conversationSid) {
      response.setStatusCode(400);
      response.setBody({ success: false, error: 'Missing conversationSid' });
      return callback(null, response);
    }

    // Check if interaction already exists for this conversation
    let existingInteractionSid = null;
    try {
      const conv = await client.conversations.v1.conversations(conversationSid).fetch();
      if (conv.attributes) {
        const attrs = JSON.parse(conv.attributes);
        if (attrs.flexInteraction?.sid) {
          existingInteractionSid = attrs.flexInteraction.sid;
          console.log('[invite-flex-agent] Found existing interaction:', existingInteractionSid);
        }
      }
    } catch (fetchError) {
      console.log('[invite-flex-agent] Warning: Could not fetch conversation:', fetchError.message);
    }

    let interactionSid = existingInteractionSid;
    
    // Create new interaction if none exists
    if (!existingInteractionSid) {
      console.log('[invite-flex-agent] Creating Interaction with routing:', {
        conversationSid,
        reason: 'Direct agent invite from group',
        known_worker: workerSid || 'none',
        known_queue: queueSid || 'none'
      });

      // Build task attributes with conversation context
      const taskAttributes = {
        conversationSid,
        from: 'whatsapp:group',
        name: 'WhatsApp Group Customer',
        channelType: 'whatsapp',
        direction: 'inbound',
        initiated_by: 'customer',
        ...inviteAttributes
      };

      const interaction = await client.flexApi.v1.interaction.create({
        channel: {
          type: 'whatsapp', // Interaction channel type should be whatsapp
          initiated_by: 'customer',
          properties: {
            media_channel_sid: conversationSid
          }
        },
        routing: {
          properties: {
            workspace_sid: context.TASKROUTER_WORKSPACE_SID,
            workflow_sid: context.TASKROUTER_WORKFLOW_SID,
            task_channel_unique_name: 'chat',
            ...(queueSid && queueSid !== 'none' ? { queue_sid: queueSid } : {}),
            ...(workerSid && workerSid !== 'none' ? { worker_sid: workerSid } : {}),
            attributes: taskAttributes
          }
        }
      });

      interactionSid = interaction.sid;
      console.log('[invite-flex-agent] Interaction created', interactionSid);

      // Wait for channel to be created and get channel SID
      let channelSid = null;
      let attempts = 0;
      while (!channelSid && attempts < 5) {
        attempts++;
        try {
          const interactionDetails = await client.flexApi.v1.interaction(interactionSid).fetch();
          if (interactionDetails.channel && interactionDetails.channel.sid) {
            channelSid = interactionDetails.channel.sid;
            console.log('[invite-flex-agent] Channel found:', channelSid);
            break;
          }
          console.log(`[invite-flex-agent] Channel poll attempt ${attempts}: waiting...`);
          await new Promise(resolve => setTimeout(resolve, 200));
        } catch (pollError) {
          console.log(`[invite-flex-agent] Channel poll attempt ${attempts} error:`, pollError.message);
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      if (!channelSid) {
        console.log('[invite-flex-agent] Channel not ready after retries');
        // Don't fail - continue with invite creation
      }

      // Create invite for specific worker or queue
      if ((queueSid && queueSid !== 'none') || (workerSid && workerSid !== 'none')) {
        try {
          const inviteRoutingProperties = {
            workspace_sid: context.TASKROUTER_WORKSPACE_SID,
            workflow_sid: context.TASKROUTER_WORKFLOW_SID,
            task_channel_unique_name: 'chat',
            attributes: taskAttributes
          };
          
          if (workerSid && workerSid !== 'none') {
            inviteRoutingProperties.worker_sid = workerSid;
          } else if (queueSid && queueSid !== 'none') {
            inviteRoutingProperties.queue_sid = queueSid;
          }

          if (channelSid) {
            await client.flexApi.v1
              .interaction(interactionSid)
              .channels(channelSid)
              .invites.create({
                routing: {
                  properties: inviteRoutingProperties
                }
              });
            console.log('[invite-flex-agent] Invite created successfully');
          } else {
            console.log('[invite-flex-agent] Skipping invite creation - no channel SID available');
          }
        } catch (inviteError) {
          console.log('[invite-flex-agent] Warning: Could not create invite:', inviteError.message);
          // Don't fail the whole operation
        }
      }

      // Update conversation attributes with interaction details
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
            sid: interactionSid,
            channelSid: channelSid,
            createdAt: new Date().toISOString()
          }
        };

        await client.conversations.v1.conversations(conversationSid)
          .update({ attributes: JSON.stringify(updatedAttrs) });

        console.log('[invite-flex-agent] Conversation attributes updated with interaction details');
      } catch (attrError) {
        console.log('[invite-flex-agent] Warning: Could not update conversation attributes:', attrError.message);
      }
    } else {
      // Use existing interaction for additional invites
      console.log('[invite-flex-agent] Using existing interaction:', existingInteractionSid);
      
      if ((queueSid && queueSid !== 'none') || (workerSid && workerSid !== 'none')) {
        try {
          // Get the existing interaction to find the channel SID
          const interactionDetails = await client.flexApi.v1.interaction(existingInteractionSid).fetch();
          const channelSid = interactionDetails.channel?.sid;
          
          if (channelSid) {
            const taskAttributes = {
              conversationSid,
              from: 'whatsapp:group',
              name: 'WhatsApp Group Customer',
              channelType: 'whatsapp',
              direction: 'inbound',
              initiated_by: 'customer',
              ...inviteAttributes
            };
            
            const inviteRoutingProperties = {
              workspace_sid: context.TASKROUTER_WORKSPACE_SID,
              workflow_sid: context.TASKROUTER_WORKFLOW_SID,
              task_channel_unique_name: 'chat',
              attributes: taskAttributes
            };
            
            if (workerSid && workerSid !== 'none') {
              inviteRoutingProperties.worker_sid = workerSid;
            } else if (queueSid && queueSid !== 'none') {
              inviteRoutingProperties.queue_sid = queueSid;
            }

            await client.flexApi.v1
              .interaction(existingInteractionSid)
              .channels(channelSid)
              .invites.create({
                routing: {
                  properties: inviteRoutingProperties
                }
              });
            console.log('[invite-flex-agent] Additional invite created for existing interaction');
          }
        } catch (inviteError) {
          console.log('[invite-flex-agent] Warning: Could not create additional invite:', inviteError.message);
        }
      }
    }

    response.setStatusCode(200);
    response.setBody({
      success: true,
      interactionSid: interactionSid,
      message: 'Flex agent invitation processed successfully'
    });
    return callback(null, response);
    
  } catch (err) {
    console.error('[invite-flex-agent] Error:', err);
    response.setStatusCode(500);
    response.setBody({
      success: false,
      message: 'Failed to invite Flex agent',
      detail: err.message
    });
    return callback(null, response);
  }
};
