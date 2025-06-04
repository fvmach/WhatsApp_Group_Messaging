exports.handler = async function(context, event, callback) {
    const response = new Twilio.Response();
    response.appendHeader('Content-Type', 'application/json');

    try {
        const webhookEventType = event.EventType;
        const author = event.Author;
        const originalBody = event.Body;

        if (webhookEventType !== 'onMessageAdd') {
            console.log(`[SKIP] EventType ${webhookEventType} is not handled.`);
            response.setBody({});
            return callback(null, response);
        }

        if (!originalBody || !author) {
            console.warn('[SKIP] Missing message body or author.');
            response.setBody({});
            return callback(null, response);
        }

        // Extract phone number from whatsapp:+E164
        const formattedAuthor = author.replace(/^whatsapp:/, '');
        const authorLine = `\`${formattedAuthor}\``;
        const formattedBody = `${authorLine}\n${originalBody}`;

        console.log(`[MODIFY] Message updated from "${originalBody}" to "${formattedBody}"`);

        response.setBody({
            body: formattedBody
        });
        return callback(null, response);

    } catch (error) {
        console.error('[ERROR webhook]', error.message, error.stack);
        response.setStatusCode(500);
        response.setBody({ error: 'Internal Server Error' });
        return callback(null, response);
    }
};
