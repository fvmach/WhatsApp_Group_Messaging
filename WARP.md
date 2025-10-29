# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

This is a WhatsApp Group Messaging sample application built with the Twilio Conversations API. It demonstrates creating and managing WhatsApp group conversations with both client and WhatsApp participants.

### Architecture Components

- **Frontend**: Single-page HTML application (`src/index.html`) with vanilla JavaScript (`src/app.js`)
- **Backend**: Twilio Serverless Functions in `serverless/functions/` directory
- **Storage**: Twilio Sync for contact management
- **Messaging**: Twilio Conversations API for group messaging
- **WhatsApp Integration**: Twilio WhatsApp Business API with template messages
- **Flex Integration**: Twilio Flex for agent invitation functionality

### Key Technologies
- Twilio Conversations SDK v2.3
- Twilio Serverless Functions
- Twilio Sync for contacts storage
- Twilio Flex for agent routing
- WhatsApp Business API

## Development Setup

### Prerequisites
- Twilio Account with:
  - Conversations API enabled
  - Sync Service (default used)
  - Messaging Service with WhatsApp sender configured
  - Flex workspace (optional, for agent features)
- Twilio CLI with Serverless Plugin
- Node.js v18 or newer

### Environment Variables (for Twilio Serverless)
Create a `.env` file in the project root with:
```env
ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
API_KEY_SID=SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
API_SECRET=your_api_secret
AUTH_TOKEN=your_auth_token
CONVERSATIONS_SERVICE_SID=ISxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GUEST_ROLE_SID=RLxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
SYNC_SERVICE_SID=default
SYNC_MAP_UNIQUE_NAME=contacts
ALLOWED_ORIGINS=http://localhost:8000
TOKEN_TTL=3600
WHATSAPP_TEMPLATE_SID=HXxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_FUNCTIONS_BASE_URL=https://your-domain.twil.io
TASKROUTER_WORKSPACE_SID=WSxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TASKROUTER_WORKFLOW_SID=WWxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Common Development Commands

#### Deploy Serverless Functions
```bash
# From project root
cd serverless
twilio serverless:deploy
```

**CRITICAL**: After deployment, you MUST update the `FUNCTION_BASE_URL` in `src/app.js`:
```javascript
const FUNCTION_BASE_URL = 'https://your-deployed-domain.twil.io';
```
Replace with your actual deployment URL. The application will not work without this step.

#### Serve Frontend Locally
```bash
# Option 1: Using serve
npx serve src
# Option 2: Using Python
python3 -m http.server 8000 --directory src
```

#### Access Local Development
```
http://localhost:8000/index.html
```

## Code Architecture

### Frontend Structure
- **Global State**: Managed in `app.js` with client instance, contacts, and active conversations
- **Event-Driven**: Uses Conversations SDK event handlers for real-time updates
- **Modal-Based UI**: Separate modals for different group management actions
- **Identity Management**: Supports both global (`whatsapp_groups_manager`) and scoped identities

### Backend Functions Structure

#### Core Functions
- `initialize-twilio-sdk.js`: Generates access tokens with conversation grants
- `createGroupConversation.js`: Creates group conversations and adds participants
- `sync-contacts.js`: CRUD operations for contact management via Sync
- `getConversations.js`: Lists user's conversations with filtering/sorting
- `notifyGroup.js`: Sends messages to group conversations

#### Management Functions
- `updateGroupDetails.js`: Updates group name/description
- `addGroupParticipants.js`: Adds new participants to existing groups
- `removeGroupParticipant.js`: Removes participants from groups
- `archiveGroup.js`: Archives group conversations
- `deleteGroup.js`: Permanently deletes group conversations

#### Flex Integration Functions
- `invite-flex-agent.js`: Creates Flex Interactions and invites agents/queues with interaction reuse
- `list-taskrouter-entities.js`: Lists TaskRouter workers and queues for agent selection

### Flex Agent Invitation System

The application includes a comprehensive system for escalating WhatsApp group conversations to Flex agents:

#### Features
- **One-click escalation**: "Invite Flex Agent" button on each group
- **Agent/Queue selection**: Modal interface for selecting specific workers or queues
- **Multi-invite support**: Can invite multiple workers and/or a queue simultaneously
- **Interaction reuse**: Stores Flex Interaction details in conversation attributes to avoid duplicates
- **Contextual escalation**: Includes meaningful attributes explaining escalation reason

#### Workflow
1. User clicks "Invite Flex Agent" on any WhatsApp group
2. System loads available workers and queues from TaskRouter
3. User selects desired agents/queues from modal interface
4. System creates or reuses Flex Interaction linked to the conversation
5. Invites are sent to selected workers/queues via Flex Interactions API
6. Agents receive tasks in their Flex interface with full conversation context

### Identity and Scoping Strategy

The application uses a scoped identity approach:
- **Global Admin**: `whatsapp_groups_manager` for service-wide operations
- **Group Scoped**: `{conversationSid}_group_manager` for guest access to specific groups

### CORS Configuration

All functions implement robust CORS handling with:
- Dynamic origin validation against `ALLOWED_ORIGINS`
- Support for wildcard (`*`) origins
- Proper preflight OPTIONS handling

## Development Patterns

### Function Error Handling
Functions follow a consistent error response pattern:
```javascript
response.setStatusCode(statusCode);
response.setBody({ 
  success: false, 
  message: "User-friendly message", 
  detail: "Technical details" 
});
```

### Contact Management
Contacts are stored in Twilio Sync with:
- **Key**: The identifier (e.g., `whatsapp:+1234567890` or `client:username`)
- **Data**: `{ name, team }` object

### Participant Types
The system supports two participant types:
- **WhatsApp**: Phone numbers (E.164 format) prefixed with `whatsapp:`
- **Client**: Twilio Client identities prefixed with `client:`

## Testing and Debugging

### Frontend Development
1. Update `FUNCTION_BASE_URL` in `app.js` to your deployed Serverless domain
2. Use browser developer tools to monitor Conversations SDK events
3. Check console logs for detailed API call information

### Backend Function Testing
Functions can be tested individually using curl or Postman:
```bash
curl -X POST https://your-domain.twil.io/function-name \
  -H "Content-Type: application/json" \
  -d '{"param": "value"}'
```

### Common Debug Points
- **FUNCTION_BASE_URL not configured**: Most common issue! Verify `FUNCTION_BASE_URL` in `src/app.js` matches your deployed Functions domain
- **CORS Issues**: Check `ALLOWED_ORIGINS` environment variable
- **Token Issues**: Verify API Key SID/Secret in environment
- **Sync Issues**: Ensure Sync Service SID is correct
- **WhatsApp Issues**: Verify phone number format and template SID

## Production Considerations

### Security
- Never expose Twilio credentials on frontend
- Use short-lived access tokens (TOKEN_TTL)
- Implement proper input validation and sanitization
- Use HTTPS for all endpoints

### Scalability
- Consider moving from Twilio Serverless to dedicated backend for production
- Implement webhook handling for message events
- Add proper logging and monitoring
- Consider database storage instead of Sync for larger scale

### WhatsApp Compliance
- Ensure proper opt-in before adding participants
- Use approved WhatsApp templates only
- Handle opt-out requests properly
- Follow WhatsApp Business Policy guidelines

## Key Files Reference

- `src/app.js`: Main frontend application logic
- `src/index.html`: User interface and styling
- `serverless/functions/initialize-twilio-sdk.js`: Authentication endpoint
- `serverless/functions/createGroupConversation.js`: Group creation logic
- `serverless/functions/sync-contacts.js`: Contact management API
- `serverless/functions/invite-flex-agent.js`: Flex agent integration

## Troubleshooting

### Common Issues
1. **SDK Connection Issues**: Check token validity and identity format
2. **CORS Errors**: Verify origin in ALLOWED_ORIGINS
3. **Participant Addition Fails**: Check phone number format (E.164)
4. **Function Timeouts**: Increase timeout or optimize function logic
5. **Flex Integration Issues**: Verify workspace/workflow SIDs in environment variables
6. **Agent Invitation Fails**: Check that TaskRouter entities exist and are active
7. **Interaction Creation Errors**: Ensure Flex Interactions API is enabled on account

### Environment Variable Issues
Missing environment variables will cause functions to return 500 errors. Check Twilio Console > Serverless > Services > Environment Variables to ensure all required variables are set.
