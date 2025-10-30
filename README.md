# Twilio Conversations Group Messaging Sample App

This is a sample web application built using the [Twilio Conversations API](https://www.twilio.com/docs/conversations) for managing WhatsApp group messaging. It allows you to create, manage, and interact with group chats, leveraging Twilio Serverless for backend logic and the Twilio Conversations JavaScript SDK on the frontend.

## Features

### Contact Management
- Add, update, and delete contacts via Twilio Sync
- Support for both WhatsApp numbers (`whatsapp:+1234567890`) and Twilio Client identities (`client:username`)
- Team/group organization for contacts
- Persistent storage using Twilio Sync Maps

### Group Conversation Management
- Create WhatsApp group conversations with custom names and descriptions
- Assign Twilio WhatsApp-enabled phone numbers to groups
- Add multiple participants (WhatsApp and/or Twilio Client)
- Automatic WhatsApp template message notifications to new participants
- Update group details (name, description)
- Archive or permanently delete groups
- Real-time conversation state updates via SDK events

### Participant Management
- Add participants to existing groups
- Remove participants from groups
- Support mixed participant types (WhatsApp + Twilio Client)
- E.164 phone number format validation

### Flex Agent Integration (Optional)
- Escalate WhatsApp group conversations to Flex agents
- Select specific workers or queues for escalation
- Reusable Flex Interactions to avoid duplicates
- Contextual task attributes for agent routing
- Multi-invite support (multiple workers + queue)

### Identity & Access Management
- Dynamic role-based identities:
  - Global admin: `whatsapp_groups_manager` for service-wide operations
  - Group-scoped: `{conversationSid}_group_manager` for guest access
- Short-lived JWT access tokens with configurable TTL
- API Key-based token generation (not Account SID/Auth Token)

## Architecture

### Frontend (`src/`)
- **Technology**: Vanilla JavaScript + HTML (no framework dependencies)
- **SDK**: Twilio Conversations JavaScript SDK v2.3+
- **State Management**: Global JavaScript objects for contacts and conversations
- **UI Pattern**: Modal-based interface for group operations
- **Real-time Updates**: SDK event listeners for conversation and message events

### Backend (`serverless/functions/`)
- **Platform**: Twilio Serverless Functions (Node.js runtime)
- **Purpose**: Demo/prototyping environment (not recommended for production scale)
- **Functions**:
  - `initialize-twilio-sdk.js` - JWT access token generation with Conversations grant
  - `createGroupConversation.js` - Group creation + participant addition + WhatsApp template messaging
  - `sync-contacts.js` - CRUD operations for contact management
  - `getConversations.js` - List user conversations with filtering/sorting
  - `notifyGroup.js` - Send messages to group conversations
  - `updateGroupDetails.js` - Update group name/description
  - `addGroupParticipants.js` - Add participants to existing groups
  - `removeGroupParticipant.js` - Remove participants from groups
  - `archiveGroup.js` - Archive conversations
  - `deleteGroup.js` - Permanently delete conversations
  - `invite-flex-agent.js` - Create Flex Interactions and invite agents/queues
  - `list-taskrouter-entities.js` - List TaskRouter workers and queues
  - `prepend-author-on-message-added.js` - Message webhook handler (if enabled)
  - `private-message.js` - Private messaging utility

### Storage & Services
- **Twilio Sync**: Contact management (key-value storage in Sync Maps)
- **Twilio Conversations API**: Group messaging, participant management, message delivery
- **Twilio Messaging API**: WhatsApp template message notifications
- **Twilio Flex (optional)**: Agent routing and task distribution
- **TaskRouter (optional)**: Worker and queue management for Flex

### Security & Access Control
- **Authentication**: API Key + Secret for JWT generation (never expose on frontend)
- **Authorization**: Conversations SDK Roles with configurable permissions
- **CORS**: Dynamic origin validation with whitelist support
- **Token Lifecycle**: Short-lived tokens (default 3600s) with refresh capability

## Setup

### Prerequisites

#### Twilio Account Setup
1. **Twilio Account** with sufficient credits
2. **Conversations API** enabled (create a Conversations Service in Console)
3. **Sync Service** - use `default` or create a custom one
4. **WhatsApp Sender** - A WhatsApp-enabled Twilio phone number
5. **WhatsApp Template** - Create and approve a WhatsApp template message for group invitations
6. **API Key** - Create an API Key in Twilio Console (Account > API Keys)
7. **Flex Workspace** (optional) - Only if using Flex agent escalation features

#### Local Development Tools
- **Node.js** v18 or newer
- **Twilio CLI**: `npm install -g twilio-cli`
- **Serverless Plugin**: `twilio plugins:install @twilio-labs/plugin-serverless`

#### WhatsApp Template Requirements
Your WhatsApp template must be approved by Meta/WhatsApp before use. Example template:
```
Hello! You've been invited to join a WhatsApp group conversation. Please reply to continue.
```
Note the Template SID (starts with `HX...`) after approval.

### Project Structure

This repository is already set up with the following structure:

```
WhatsApp_Group_Messaging/
├── serverless/
│   ├── functions/          # Backend Twilio Functions
│   │   ├── initialize-twilio-sdk.js
│   │   ├── createGroupConversation.js
│   │   ├── sync-contacts.js
│   │   ├── getConversations.js
│   │   ├── notifyGroup.js
│   │   ├── updateGroupDetails.js
│   │   ├── addGroupParticipants.js
│   │   ├── removeGroupParticipant.js
│   │   ├── archiveGroup.js
│   │   ├── deleteGroup.js
│   │   ├── invite-flex-agent.js
│   │   ├── list-taskrouter-entities.js
│   │   ├── prepend-author-on-message-added.js
│   │   └── private-message.js
│   ├── assets/             # (optional - for Serverless deployment)
│   └── .env               # Environment variables (create this)
├── src/                   # Frontend application
│   ├── index.html
│   └── app.js
├── README.md
└── WARP.md
```

No additional setup needed - all function files are already in place.

### Add Environment Variables

Create a `.env` file in the `serverless/` directory:

```env
# Core Twilio Credentials
ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AUTH_TOKEN=your_auth_token

# API Key for Access Token Generation (create in Twilio Console)
API_KEY_SID=SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
API_SECRET=your_api_secret

# Conversations Service
CONVERSATIONS_SERVICE_SID=ISxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Sync for Contact Management
SYNC_SERVICE_SID=default
SYNC_MAP_UNIQUE_NAME=contacts

# WhatsApp Configuration
WHATSAPP_TEMPLATE_SID=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_FUNCTIONS_BASE_URL=https://your-domain.twil.io

# Flex Integration (optional - only if using Flex agent features)
TASKROUTER_WORKSPACE_SID=WSxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TASKROUTER_WORKFLOW_SID=WWxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Security & CORS
ALLOWED_ORIGINS=http://localhost:8000,http://localhost:3000
TOKEN_TTL=3600
```

### Deploy Functions

Navigate to the serverless directory and deploy:

```bash
cd serverless
twilio serverless:deploy
```

**Important**: Note the base URL from the deployment output (e.g., `https://whatsapp-group-messaging-1234-dev.twil.io`). You'll need this for the next step.

### Configure Frontend Base URL

**IMPORTANT**: After deploying, you must update the `FUNCTION_BASE_URL` constant in `src/app.js`:

```javascript
const FUNCTION_BASE_URL = 'https://your-deployed-domain.twil.io';
```

Replace `'https://your-deployed-domain.twil.io'` with the actual URL from your deployment output.

**This step is required** - the frontend will not work without this configuration.

## Running the Frontend

You can serve the frontend locally using any static server:

```bash
# From project root, serve the src/ directory
npx serve src
# or
python3 -m http.server 8000 --directory src
# or from within src/
cd src && python3 -m http.server 8000
```

Then open in your browser:

```
http://localhost:8000/index.html
```

## Usage

### 1. Initialize SDK
- Click **"Initialize SDK"** button
- Default identity: `whatsapp_groups_manager` (global admin)
- Alternative: Enter custom identity for scoped access
- Wait for connection status to show "connected"

### 2. Manage Contacts
- **Add Contact**:
  - Enter name (e.g., "John Doe")
  - Enter identifier in format:
    - WhatsApp: `whatsapp:+12345678900` or `+12345678900`
    - Twilio Client: `client:john_doe`
  - Optionally add team name
  - Click **"Add Contact"**
- **Delete Contact**: Click delete icon next to contact
- Contacts are stored in Twilio Sync and persist across sessions

### 3. Create WhatsApp Group
- Enter **Group Name** (e.g., "Customer Support Team")
- Enter **Group Description** (optional)
- Enter **Twilio WhatsApp Number** (must be WhatsApp-enabled)
- Select **Participants** from contact list (multiple selection)
- Click **"Create Group"**
- System will:
  - Create Conversations group
  - Add all selected participants
  - Send WhatsApp template message to WhatsApp participants

### 4. Manage Groups
- **Send Notification**: Click "Notify" to send message to entire group
- **Update Details**: Click "Update" to modify name, description, or add participants
- **Remove Participant**: In update modal, click "Remove" next to participant
- **Invite Flex Agent**: Click "Invite Flex Agent" to escalate to support agent (if Flex configured)
- **Archive Group**: Click "Archive" to deactivate (can be reactivated)
- **Delete Group**: Click "Delete" to permanently remove

### 5. Filter & Search Groups
- **Search**: Type in search box to filter by name
- **Filter by State**: Active, Inactive, Closed
- **Sort**: By date created, date updated, name
- **Direction**: Ascending or descending

### 6. Flex Agent Escalation (Optional)
If Flex is configured:
- Click **"Invite Flex Agent"** on any group
- Select specific worker(s) or queue
- Click **"Send Invites"**
- Agent receives task in Flex with full conversation context
- Subsequent invites reuse same Flex Interaction

## Best Practices

- **Scoped Identities**: Avoid using random identities. Use scoped identities like:
  - `whatsapp_groups_manager` for global admin access
  - `${conversationSid}_group_manager` for guest/group-specific operations
- **Role Separation**: Use the Conversations API Role resource to limit guest access.
- **Token Security**: Always provision short-lived access tokens and rotate them securely.
- **Participant Management**: Check if identity exists before creating to avoid errors.
- **Frontend Access**: Do not expose Twilio credentials on the frontend. Tokens must come from server functions.

## Production Considerations

Twilio Serverless is suitable for demo and testing purposes. In production, you should:

- Move logic to a secure backend (e.g., Node.js/Express on AWS Lambda or GCP Cloud Functions)
- Use your organization’s identity management system (OAuth, IAM)
- Implement webhook handling (e.g., delivery receipts, message status)
- Add analytics/logging for audit trails
- Validate payloads and sanitize inputs
- Apply regional routing and scaling if necessary

## Troubleshooting

### Common Issues

1. **"Failed to fetch" or CORS errors**
   - Verify `ALLOWED_ORIGINS` in `.env` includes your frontend URL
   - Check browser console for specific origin being blocked
   - Ensure wildcards are used correctly (`*` for all origins)

2. **"Missing environment variable" errors**
   - Check all required variables are set in `serverless/.env`
   - Redeploy functions after updating environment variables
   - Verify no typos in variable names

3. **"Server configuration error" on token generation**
   - Ensure `API_KEY_SID` starts with `SK...` (not `AC...`)
   - Verify `API_SECRET` matches the API Key created in Console
   - Check API Key is active in Twilio Console

4. **WhatsApp template message fails**
   - Verify template is approved by Meta/WhatsApp
   - Check `WHATSAPP_TEMPLATE_SID` starts with `HX...`
   - Ensure Twilio phone number is WhatsApp-enabled
   - Verify template content variables match your function code

5. **Participants not added to group**
   - Verify phone numbers are in E.164 format (`+1234567890`)
   - Check WhatsApp numbers are properly prefixed (`whatsapp:+...`)
   - Ensure Twilio number assigned to group is correct

6. **Flex invites not working**
   - Verify `TASKROUTER_WORKSPACE_SID` and `TASKROUTER_WORKFLOW_SID` are set
   - Check Flex Interactions API is enabled on your account
   - Ensure workers/queues exist and are active

7. **Frontend not connecting to functions**
   - **MOST COMMON**: Verify `FUNCTION_BASE_URL` in `src/app.js` matches deployed URL
   - Check deployment URL in Twilio Console > Serverless > Services
   - Ensure no trailing slash in URL

### Debug Mode
- Open browser developer console (F12)
- Check Network tab for failed requests
- Review Console tab for SDK connection status
- Look for CORS-related errors in Console

## Important Notes

### WhatsApp Compliance
- **Opt-in Required**: Always obtain user consent before adding to WhatsApp groups
- **Template Messages**: Only approved templates can initiate conversations
- **24-hour Window**: After user replies, you can send freeform messages for 24 hours
- **Opt-out Handling**: Implement proper opt-out mechanism
- **Business Policy**: Follow WhatsApp Business Policy and Commerce Policy

### Security Best Practices
- **Never expose credentials**: Keep `.env` file private and out of version control
- **API Keys**: Use API Keys (not Account SID/Auth Token) for client tokens
- **Short-lived tokens**: Default 3600s (1 hour) TTL, adjust based on security needs
- **CORS whitelist**: Use specific origins in production, avoid `*`
- **Input validation**: All functions validate inputs server-side
- **HTTPS only**: Always use HTTPS in production

### Scalability Considerations
- **Twilio Serverless Limits**: Functions have execution time and memory limits
- **Sync Limits**: Each Sync Map can store up to 16KB per item
- **Conversations Limits**: Check API limits for your account tier
- **Production Backend**: For high-scale use, migrate to dedicated infrastructure

## Roadmap Suggestions

- Read receipts and typing indicators
- Multi-conversation interface (tabbed or side-by-side panels)
- Admin moderation panel with analytics
- Scheduled messages and broadcast campaigns
- Rich media support (images, videos, documents)
- Integration with CRM systems (Salesforce, HubSpot)
- Message templates and quick replies
- Conversation tagging and categorization
- Export conversation history

## License

This project is provided for educational and demonstration purposes. For production use, follow Twilio’s compliance, security, and deployment best practices.