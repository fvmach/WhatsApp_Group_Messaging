# Twilio Conversations Group Messaging Sample App

This is a sample web application built using the [Twilio Conversations API](https://www.twilio.com/docs/conversations) for managing WhatsApp group messaging. It allows you to create, manage, and interact with group chats, leveraging **Twilio Serverless** for backend logic, **Twilio Sync** for contact management, and the **Twilio Conversations JavaScript SDK** on the frontend.

## Features

* Contact management via Twilio Sync (names, metadata per WhatsApp number)
* Group creation with description and WhatsApp number assignment
* Participant management (add/remove members)
* Message sending, group notifications, and conversation updates
* Dynamic role-based identity: service-wide admin vs. per-group guest
* Scoped SDK initialization for multi-identity use
* Pre-event webhook logic to prepend display names to messages
  (resolving contact names from Sync or Conversations participant info)

## Architecture

* **Frontend**: HTML + JavaScript + Twilio Conversations SDK
* **Backend**: Twilio Functions (demo only)
* **Storage**: Twilio Sync (Contacts)
* **Messaging**: Twilio Conversations API
* **Roles**: Guest and Admin role separation via Access Token provisioning
* **Webhooks**: Pre-event `onMessageAdd` webhook enriches message body with display name

## Setup

### Prerequisites

* Twilio Account with:

  * Conversations API enabled
  * Sync Service (default used, with a Map for contacts)
  * Messaging Service with WhatsApp sender configured
* Twilio CLI with Serverless Plugin
* Node.js v18 or newer

### Install Serverless Project

```bash
twilio serverless:init whatsapp-group-messaging --template=blank
cd whatsapp-group-messaging
```

### Add Function Files

Place the following into the `/functions` directory:

* `initialize-twilio-sdk.js`
* `createGroupConversation.js`
* `notifyGroup.js`
* `sync-contacts.js`
* `getConversations.js`
* `updateGroupDetails.js`
* `addGroupParticipants.js`
* `removeGroupParticipant.js`
* `deleteGroup.js`
* `archiveGroup.js`
* `prepend-message-author.js` (pre-event webhook for `onMessageAdd`)

Place the following into the `/assets` directory:

* `index.html`
* `app.js`

### Add Environment Variables

Create a `.env` file at the root of the project:

```env
ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
API_KEY_SID=SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
API_SECRET=your_api_secret
AUTH_TOKEN=your_auth_token
SYNC_SERVICE_SID=your-sync-service-sid
SYNC_MAP_UNIQUE_NAME=contacts
CONVERSATIONS_SERVICE_SID=ISxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GUEST_ROLE_SID=RLxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
WHATSAPP_TEMPLATE_SID=HXxxxxxxxx
TWILIO_FUNCTIONS_BASE_URL=your_serverless_domain
ALLOWED_ORIGINS=http://localhost:8000
TOKEN_TTL=3600
```

### Deploy Functions and Assets

```bash
twilio serverless:deploy
```

Note the base URL output from the deployment (e.g., `https://your-domain.twil.io`).

## Running the Frontend

You can serve the frontend locally using any static server:

```bash
npx serve .
# or
python3 -m http.server 8000
```

Then open in your browser:

```
http://localhost:8000/index.html
```

## Usage

1. Initialize the SDK using the identity `whatsapp_groups_manager` (global admin) or a conversation-scoped identity (e.g., `CHxxxxx_group_manager`).

2. Add contacts into the Sync Map using WhatsApp numbers as keys (e.g., `whatsapp:+1234567890`) with metadata like:

   ```json
   {
     "name": "Sample Contact",
     "team": "Demo Customers"
   }
   ```

3. Create groups, assign a Twilio WhatsApp number, and select participants.

4. Messages sent by WhatsApp users are enriched via the `prepend-message-author.js` webhook:

   * Resolves names from Sync Map
   * Falls back to participant attributes or WhatsApp number
   * Prepends display name to message body

5. Use the "Notify", "Update", "Archive", and "Delete" buttons to manage conversations.

## Best Practices

* **Scoped Identities**:

  * `whatsapp_groups_manager` for global admin access
  * `${conversationSid}_group_manager` for guest/group-specific operations
* **Role Separation**: Use the Conversations API Role resource to limit guest access.
* **Token Security**: Always provision short-lived access tokens and rotate them securely.
* **Participant Management**: Check if a participant already exists before creating.
* **Webhook Events**: Use `onMessageAdd` (the Conversations service event) for pre-event message enrichment.
* **Frontend Access**: Do not expose Twilio credentials on the frontend. Use Functions to issue tokens and perform privileged actions.

## Production Considerations

Twilio Serverless is suitable for demo and testing purposes. In production, you should:

* Move logic to a secure backend (e.g., Node.js/Express on AWS Lambda or GCP Cloud Functions)
* Use your organization’s identity management system (OAuth, IAM)
* Implement webhook handling for delivery receipts and status updates
* Add analytics/logging for audit trails
* Validate payloads and sanitize inputs
* Apply regional routing and scaling as needed

## Roadmap Suggestions

* Read receipts and typing indicators
* Multi-conversation interface (tabbed/paneled)
* Admin moderation panel
* Scheduled or broadcast messaging
* CRM or ticketing system integrations

## License

This project is provided for educational and demonstration purposes. For production use, follow Twilio’s compliance, security, and deployment best practices.
