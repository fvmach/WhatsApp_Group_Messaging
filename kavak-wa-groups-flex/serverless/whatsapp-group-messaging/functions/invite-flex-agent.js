/**
 * Twilio Function: invite-flex-agent
 *
 * - Creates a Flex Interaction for a WhatsApp Conversation.
 * - Waits for the channel to be provisioned.
 * - Posts an Invite to either a specific Worker (workerSid) or Queue (queueSid).
 * - Uses conversationSid as the group identity (no individual customer address).
 */

exports.handler = async function handler(context, event, callback) {
  const client = context.getTwilioClient();
  const response = new Twilio.Response();

  // --- Debug logging ---
  console.log("[invite-flex-agent] RAW event:", JSON.stringify(event, null, 2));
  console.log("[invite-flex-agent] Env check:", {
    TASKROUTER_WORKSPACE_SID: context.TASKROUTER_WORKSPACE_SID,
    TASKROUTER_WORKFLOW_SID: context.TASKROUTER_WORKFLOW_SID,
  });

  // --- CORS headers ---
  const hdrs = event.headers || event.request?.headers || {};
  const origin = hdrs.origin || hdrs.Origin || '';
  const allowedOrigins = [
    'http://localhost:3000',
    'https://flex.twilio.com',
    context.APP_BASE_URL // optional env var for prod
  ];
  if (allowedOrigins.includes(origin)) {
    response.appendHeader('Access-Control-Allow-Origin', origin);
    response.appendHeader('Access-Control-Allow-Credentials', 'true');
  } else {
    response.appendHeader('Access-Control-Allow-Origin', '*');
  }
  response.appendHeader('Access-Control-Allow-Methods', 'OPTIONS, POST');
  response.appendHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, X-Requested-With'
  );
  response.appendHeader('Content-Type', 'application/json');
  response.appendHeader('Vary', 'Origin');

  if (event.httpMethod === 'OPTIONS') {
    response.setStatusCode(204);
    return callback(null, response);
  }

  try {
    // --- Parse body safely ---
    let body = event;
    if (typeof event.body === 'string' && event.body.trim().length) {
      try {
        body = JSON.parse(event.body);
      } catch {
        console.error("[invite-flex-agent] Invalid JSON body:", event.body);
        response.setStatusCode(400);
        response.setBody({ error: 'Invalid JSON body' });
        return callback(null, response);
      }
    }
    console.log("[invite-flex-agent] Parsed body:", JSON.stringify(body, null, 2));

    const {
      conversationSid,   // CHXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
      workerSid,         // WRXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX (optional)
      queueSid,          // WQXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX (optional)
      workflowSid,       // WWXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX (optional override)
      inviteAttributes   // Optional custom attributes from frontend
    } = body || {};

    const workspaceSid = context.TASKROUTER_WORKSPACE_SID;
    const defaultWorkflowSid = context.TASKROUTER_WORKFLOW_SID;

    // --- Validate inputs ---
    if (!conversationSid || !workspaceSid) {
      console.error("[invite-flex-agent] Missing params", { conversationSid, workspaceSid });
      response.setStatusCode(400);
      response.setBody({
        error: 'Missing required params: conversationSid, TASKROUTER_WORKSPACE_SID'
      });
      return callback(null, response);
    }

    // --- STEP 1: Create Interaction ---
    const routingAttributes = {
      conversationSid,
      ...(inviteAttributes || {}),
    };
    if (workerSid) routingAttributes.known_worker = workerSid;

    console.log("[invite-flex-agent] Creating Interaction with routing:", routingAttributes);

    const interaction = await client.flexApi.v1.interaction.create({
      channel: {
        type: 'whatsapp',
        initiated_by: 'customer',
        properties: { media_channel_sid: conversationSid }
      },
      routing: {
        properties: {
          workspace_sid: workspaceSid,
          workflow_sid: workflowSid || defaultWorkflowSid,
          task_channel_unique_name: 'chat',
          attributes: routingAttributes
        }
      }
    });

    const interactionSid = interaction.sid;
    console.log('[invite-flex-agent] Interaction created', interactionSid);

    // --- STEP 2: Poll Channels until ready ---
    let channelSid = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const ch = await client.request({
        method: 'GET',
        uri: `https://flex-api.twilio.com/v1/Interactions/${interactionSid}/Channels`
      });

      const list = Array.isArray(ch.data?.channels)
        ? ch.data.channels
        : Array.isArray(ch.data?.data)
        ? ch.data.data
        : Array.isArray(ch.data)
        ? ch.data
        : [];

      console.log(`[invite-flex-agent] Channel poll attempt ${attempt + 1}:`, list);

      if (list.length && (list[0].sid || list[0].channelSid)) {
        channelSid = list[0].sid || list[0].channelSid;
        break;
      }

      await new Promise(r => setTimeout(r, 200));
    }

    if (!channelSid) {
      console.warn('[invite-flex-agent] Channel not ready after retries');
      response.setStatusCode(202);
      response.setBody({
        success: false,
        message: 'Channel not ready yet. Retry after a short delay.',
        interactionSid
      });
      return callback(null, response);
    }

    // --- STEP 3: Post Invite (agent or queue) ---
    if (workerSid || queueSid) {
      const routingProps = {
        workspace_sid: workspaceSid,
        task_channel_unique_name: 'chat',
        attributes: { conversationSid, ...(inviteAttributes || {}) }
      };
      if (workflowSid || defaultWorkflowSid)
        routingProps.workflow_sid = workflowSid || defaultWorkflowSid;
      if (queueSid) routingProps.queue_sid = queueSid;
      if (workerSid) routingProps.worker_sid = workerSid;

      console.log("[invite-flex-agent] Posting Invite with routing:", routingProps);

      const invite = await client.request({
        method: 'POST',
        uri: `https://flex-api.twilio.com/v1/Interactions/${interactionSid}/Channels/${channelSid}/Invites`,
        data: { routing: { properties: routingProps } }
      });

      if (invite.status < 200 || invite.status >= 300) {
        console.error("[invite-flex-agent] Flex API invite failed", invite.status, invite.data);
        response.setStatusCode(invite.status);
        response.setBody({ error: 'Flex API invite failed', details: invite.data });
        return callback(null, response);
      }

      response.setStatusCode(200);
      response.setBody({
        success: true,
        interactionSid,
        channelSid,
        invitePosted: true
      });
      return callback(null, response);
    }

    // No routing target, just return channel presence
    response.setStatusCode(200);
    response.setBody({
      success: true,
      interactionSid,
      channelSid,
      invitePosted: false
    });
    return callback(null, response);
  } catch (err) {
    console.error('[invite-flex-agent] ERROR', err);
    response.setStatusCode(500);
    response.setBody({ error: err.message || String(err) });
    return callback(null, response);
  }
};
