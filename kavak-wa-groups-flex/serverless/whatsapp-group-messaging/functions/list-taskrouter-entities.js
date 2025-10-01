exports.handler = async function (context, event, callback) {
  // --- CORS Configuration (robust) ---
  const response = new Twilio.Response();
  const requestOrigin =
    (event.headers && event.headers.origin) ||
    (event.request && event.request.headers && event.request.headers.origin);

  console.log(`[CORS DEBUG /listTaskrouterEntities] Function execution started. Request Origin: ${requestOrigin}`);
  console.log(`[CORS DEBUG /listTaskrouterEntities] Environment ALLOWED_ORIGINS: ${context.ALLOWED_ORIGINS}`);

  const configuredAllowedOrigins = (context.ALLOWED_ORIGINS || "").split(",");
  let effectiveAllowOriginHeader = null;
  if (configuredAllowedOrigins.includes("*")) {
    effectiveAllowOriginHeader = "*";
  } else if (requestOrigin && configuredAllowedOrigins.includes(String(requestOrigin).toLowerCase())) {
    effectiveAllowOriginHeader = requestOrigin;
  }
  if (effectiveAllowOriginHeader) {
    response.appendHeader("Access-Control-Allow-Origin", effectiveAllowOriginHeader);
  }
  response.appendHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  response.appendHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  response.appendHeader("Access-Control-Allow-Credentials", "true");

  // Derive httpMethod robustly
  let httpMethod = event.httpMethod;
  if (!httpMethod && event.request && (event.request.method || event.request.httpMethod)) {
    httpMethod = event.request.method || event.request.httpMethod;
  }
  console.log(`[REQUEST /listTaskrouterEntities] Derived httpMethod for OPTIONS check: ${httpMethod}`);

  if (String(httpMethod).toUpperCase() === "OPTIONS") {
    console.log("[REQUEST /listTaskrouterEntities] Handling OPTIONS preflight request.");
    response.setStatusCode(204);
    return callback(null, response);
  }

  response.appendHeader("Content-Type", "application/json");
  // --- End CORS ---

  const { TASKROUTER_WORKSPACE_SID } = context;
  if (!TASKROUTER_WORKSPACE_SID) {
    response.setStatusCode(500);
    response.setBody({ success: false, message: "Missing TASKROUTER_WORKSPACE_SID" });
    return callback(null, response);
  }

  const client = context.getTwilioClient();

  try {
    const [workers, queues] = await Promise.all([
      client.taskrouter.v1.workspaces(TASKROUTER_WORKSPACE_SID).workers.list({ limit: 200 }),
      client.taskrouter.v1.workspaces(TASKROUTER_WORKSPACE_SID).taskQueues.list({ limit: 200 }),
    ]);

    const workersOut = workers.map((w) => ({
      sid: w.sid,
      friendlyName: w.friendlyName || w.sid,
    }));
    const queuesOut = queues.map((q) => ({
      sid: q.sid,
      friendlyName: q.friendlyName || q.sid,
    }));

    response.setStatusCode(200);
    response.setBody({ success: true, workers: workersOut, queues: queuesOut });
    return callback(null, response);
  } catch (e) {
    console.error("[/listTaskrouterEntities] Error:", e);
    response.setStatusCode(500);
    response.setBody({ success: false, message: e.message });
    return callback(null, response);
  }
};
