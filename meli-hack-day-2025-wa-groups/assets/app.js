// --- Global State & Configuration ---
let conversationsClient = null;
let userContacts = []; // This will be populated by fetchContacts
let activeConversations = []; // This will be populated by fetchActiveConversations from your Twilio Function
let originalActiveConversations = []; 
const FUNCTION_BASE_URL = 'https://whatsapp-group-messaging-9230-dev.twil.io'; // <-- Set your Twilio Function base URL here

let groupSearchTerm = '';
let groupFilterState = 'active'; // e.g., 'active', 'inactive', 'closed', or '' for all
let groupOrderBy = 'dateUpdated'; // Default order: by last updated
let groupOrderDirection = 'desc';   // Default direction: descending
let activeIdentity = null;

// --- DOM Elements ---
const initializeSdkButton = document.getElementById('initialize-sdk-button');
const sdkStatusEl = document.getElementById('sdk-status');
const tokenIdentityInput = document.getElementById('token-identity');
const contactsSection = document.getElementById('contacts-section');
const groupsSection = document.getElementById('groups-section');
const addContactButton = document.getElementById('add-contact-button');
const contactNameInput = document.getElementById('contact-name');
const contactIdInput = document.getElementById('contact-id');
const contactTeamInput = document.getElementById('contact-team');
const contactsListEl = document.getElementById('contacts-list');
const createGroupButton = document.getElementById('create-group-button');
const groupNameInput = document.getElementById('group-name');
const groupDescriptionInput = document.getElementById('group-description');
const groupTwilioNumberInput = document.getElementById('group-twilio-number');
const groupParticipantsSelectEl = document.getElementById('group-participants-select');
const groupsListEl = document.getElementById('groups-list');
const notifyGroupModal = document.getElementById('notify-group-modal');
const updateGroupModal = document.getElementById('update-group-modal');
const notifyGroupNameModalEl = document.getElementById('notify-group-name-modal');
const notifyGroupSidModalInput = document.getElementById('notify-group-sid-modal');
const notifyMessageInput = document.getElementById('notify-message');
const sendNotifyMessageButton = document.getElementById('send-notify-message-button');
const updateGroupNameDisplayModalEl = document.getElementById('update-group-name-display-modal');
const updateGroupSidModalInput = document.getElementById('update-group-sid-modal');
const updateGroupNameModalInput = document.getElementById('update-group-name-modal');
const updateGroupDescriptionModalInput = document.getElementById('update-group-description-modal');
const saveGroupDetailsButton = document.getElementById('save-group-details-button');
const updateGroupAddParticipantsSelectEl = document.getElementById('update-group-add-participants-select');
const addParticipantsButtonModal = document.getElementById('add-participants-button-modal');
const updateGroupCurrentParticipantsListEl = document.getElementById('update-group-current-participants-list');
let searchGroupsInput, filterGroupStateSelect, orderGroupsBySelect, orderGroupsDirectionSelect;
const inviteFlexModal = document.getElementById('invite-flex-modal');
const inviteFlexGroupNameEl = document.getElementById('invite-flex-group-name');
const inviteFlexConversationSidInput = document.getElementById('invite-flex-conversation-sid');
const inviteWorkersSelect = document.getElementById('invite-workers-select');
const inviteQueueSelect = document.getElementById('invite-queue-select');
const sendFlexInvitesButton = document.getElementById('send-flex-invites-button');

// --- API Helper ---
async function callTwilioFunction(endpoint, method = 'POST', body = {}) {
    if (!FUNCTION_BASE_URL) {
        alert('Twilio Function Base URL is not configured. Please set FUNCTION_BASE_URL in the script.');
        throw new Error('Function Base URL not set.');
    }
    console.log(`Calling Function: ${method} ${FUNCTION_BASE_URL}/${endpoint}`, (method !== 'GET' && method !== 'HEAD') ? body : '');
    try {
        const response = await fetch(`${FUNCTION_BASE_URL}/${endpoint}`, {
            method: method,
            headers: { 'Content-Type': 'application/json' },
            body: (method !== 'GET' && method !== 'HEAD') ? JSON.stringify(body) : null
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`Function ${endpoint} server responded with status ${response.status}: ${errorText}`);
            let errorData;
            try {
                if (errorText && errorText.trim() !== "") {
                    errorData = JSON.parse(errorText);
                } else {
                    errorData = { message: response.statusText, detail: "Empty error response from server." };
                }
            } catch (parseError) {
                console.error(`Failed to parse error response from ${endpoint} as JSON:`, parseError);
                errorData = { message: response.statusText, detail: errorText };
            }
            throw new Error(`Function ${endpoint} failed: ${errorData.detail || errorData.message || response.statusText}`);
        }
        return response.status === 204 ? null : await response.json();
    } catch (error) {
        console.error(`Network or other error calling Twilio Function ${endpoint}:`, error.message);
        alert(`Error: ${error.message}`);
        throw error;
    }
}

// --- Initialization ---
initializeSdkButton.addEventListener('click', async () => {
    const clientProvidedIdentity = tokenIdentityInput.value.trim();
    sdkStatusEl.textContent = 'SDK Status: Initializing...';
    try {
        // Always resolve to whatsapp_groups_manager unless another identity is explicitly provided
        const tokenResponse = await callTwilioFunction('initialize-twilio-sdk', 'POST', {
            identity: clientProvidedIdentity || 'whatsapp_groups_manager'
        });

        activeIdentity = tokenResponse.identity;
        conversationsClient = new Twilio.Conversations.Client(tokenResponse.token);

        conversationsClient.on('connectionStateChanged', (state) => {
            sdkStatusEl.textContent = `SDK Status: ${state}`;
            if (state === 'connected') {
                console.log('Conversations Client Connected as global identity:', activeIdentity);

                document.getElementById('init-section').classList.add('hidden');
                contactsSection.classList.remove('hidden');
                groupsSection.classList.remove('hidden');

                searchGroupsInput = document.getElementById('search-groups-input');
                filterGroupStateSelect = document.getElementById('filter-group-state-select');
                orderGroupsBySelect = document.getElementById('order-groups-by-select');
                orderGroupsDirectionSelect = document.getElementById('order-groups-direction-select');

                setupGroupListEventListeners();
                loadInitialData();
            } else if (state === 'disconnected' || state === 'denied') {
                console.error('Conversations Client disconnected or token denied. State:', state);
            }
        });

        conversationsClient.on('conversationJoined', fetchActiveConversations);
        conversationsClient.on('conversationLeft', fetchActiveConversations);
        conversationsClient.on('conversationUpdated', ({ conversation, updateReasons }) => {
            if (['friendlyName', 'attributes', 'state'].some(reason => updateReasons.includes(reason))) {
                fetchActiveConversations();
            }
        });

        conversationsClient.on('messageAdded', (message) => {
            console.log(`[MSG][${message.conversation.sid}] ${message.author}: ${message.body}`);
        });

    } catch (error) {
        sdkStatusEl.textContent = `SDK Status: Error - ${error.message}`;
        console.error('SDK Initialization error:', error);
    }
});


function setupGroupListEventListeners() {
    if (searchGroupsInput) {
        searchGroupsInput.addEventListener('input', (e) => {
            groupSearchTerm = e.target.value;
            applyFiltersAndRenderGroups();
        });
    }
    if (filterGroupStateSelect) {
        filterGroupStateSelect.addEventListener('change', (e) => {
            groupFilterState = e.target.value;
            applyFiltersAndRenderGroups();
        });
    }
    if (orderGroupsBySelect) {
        orderGroupsBySelect.addEventListener('change', (e) => {
            groupOrderBy = e.target.value;
            applyFiltersAndRenderGroups();
        });
    }
    if (orderGroupsDirectionSelect) {
        orderGroupsDirectionSelect.addEventListener('change', (e) => {
            groupOrderDirection = e.target.value;
            applyFiltersAndRenderGroups();
        });
    }
}

async function loadInitialData() {
    console.log("loadInitialData: Fetching contacts...");
    await fetchContacts();
    console.log("loadInitialData: Fetching active conversations...");
    await fetchActiveConversations();
    console.log("loadInitialData: Initial data load complete.");
}

// --- Contact Management ---
async function fetchContacts() {
    console.log("Fetching contacts using /sync-contacts POST with action: 'list'...");
    try {
        const result = await callTwilioFunction('sync-contacts', 'POST', { action: 'list' });
        userContacts = result.contacts || [];
        // console.log("CLIENT-SIDE: Raw result from /sync-contacts:", JSON.stringify(result, null, 2)); // Keep if needed for contact debugging
        // console.log("CLIENT-SIDE: Parsed userContacts array (length " + userContacts.length + "):", JSON.stringify(userContacts, null, 2));
        renderContacts();
        renderParticipantSelectionCheckboxes(groupParticipantsSelectEl, userContacts);
    } catch (error) {
        console.error('Failed to fetch contacts:', error);
        contactsListEl.innerHTML = '<li class="list-item">Failed to load contacts. Check console.</li>';
    }
}

function renderContacts() {
    contactsListEl.innerHTML = '';
    if (!userContacts || userContacts.length === 0) {
        contactsListEl.innerHTML = '<li class="list-item">No contacts added yet.</li>';
        return;
    }
    userContacts.forEach(contact => {
        if (!contact.data || !contact.id) {
            console.warn("Skipping rendering contact due to missing data or id:", contact);
            return;
        }
        const li = document.createElement('li');
        li.className = 'list-item';
        const displayName = contact.data.name || 'N/A';
        const displayIdentifier = contact.data.identifier || 'N/A';
        const displayTeam = contact.data.team ? ` - Team: ${contact.data.team}` : '';
        li.innerHTML = `
            <span><strong>${displayName}</strong> (${displayIdentifier})${displayTeam}</span>
            <div class="actions"><button onclick="deleteContact('${contact.id}')">Delete</button></div>`;
        contactsListEl.appendChild(li);
    });
}
sendFlexInvitesButton.addEventListener('click', async () => {
  const conversationSid = inviteFlexConversationSidInput.value;
  const selectedWorkerSids = Array.from(inviteWorkersSelect.selectedOptions).map(o => o.value);
  const selectedQueueSid = inviteQueueSelect.value;

  if ((!selectedWorkerSids || selectedWorkerSids.length === 0) && !selectedQueueSid) {
    alert('Pick at least one worker or a queue.'); return;
  }

  sendFlexInvitesButton.disabled = true;
  sendFlexInvitesButton.textContent = 'Sending…';

  try {
    // Invite queue (if chosen)
    if (selectedQueueSid) {
      await callTwilioFunction('invite-flex-agent', 'POST', {
        conversationSid,
        queueSid: selectedQueueSid,
        inviteAttributes: { reason: 'Escalated from group' }
      });
    }

    // Invite each worker
    for (const wk of selectedWorkerSids) {
      await callTwilioFunction('invite-flex-agent', 'POST', {
        conversationSid,
        workerSid: wk,
        inviteAttributes: { reason: 'Direct agent invite from group' }
      });
    }

    alert('Invite(s) sent to Flex.');
    closeModal('invite-flex-modal');

  } catch (e) {
    console.error('Failed to send invites:', e);
    alert('Failed to send one or more invites. See console.');
  } finally {
    sendFlexInvitesButton.disabled = false;
    sendFlexInvitesButton.textContent = 'Send Invites';
  }
});

addContactButton.addEventListener('click', async () => {
    const name = contactNameInput.value.trim();
    const identifier = contactIdInput.value.trim();
    const team = contactTeamInput.value.trim();
    if (!name || !identifier) { alert('Contact Name and ID are required.'); return; }
    // Validate identifier: allow Twilio client identities (beginning with 'client:') or E.164 phone numbers.
    const e164Regex = /^\+?[1-9]\d{1,14}$/;
    if (identifier.startsWith('client:')) {
        // OK: accepted as-is.
    } else if (!e164Regex.test(identifier)) {
        alert("Identifier must be a valid phone number in E.164 format (e.g., +1234567890) or start with 'client:'.");
        return;
    }
    try {
        await callTwilioFunction('sync-contacts', 'POST', { name, identifier, team });
        contactNameInput.value = ''; contactIdInput.value = ''; contactTeamInput.value = '';
        await fetchContacts();
    } catch (error) { console.error('Failed to add contact:', error); }
});

async function deleteContact(contactKey) {
    if (!contactKey) { alert("Error: Contact Key is missing for deletion."); return; }
    if (!confirm('Are you sure you want to delete this contact?')) return;
    try {
        await callTwilioFunction('sync-contacts', 'POST', { action: 'delete', syncItemSid: contactKey });
        await fetchContacts();
    } catch (error) { console.error('Failed to delete contact:', error); }
}

// --- Group Conversation Management ---
function renderParticipantSelectionCheckboxes(containerEl, contacts, selectedIdentifiers = []) {
    containerEl.innerHTML = '';
    if (!contacts || contacts.length === 0) {
        containerEl.innerHTML = '<p>No contacts available to select.</p>'; return;
    }
    contacts.forEach(contact => {
        if (!contact.data || !contact.data.identifier) {
            console.warn("Skipping contact in checkbox list due to missing data.identifier:", contact);
            return;
        }
        const checkboxId = `cb-${contact.data.identifier.replace(/[^a-zA-Z0-9]/g, "")}-${Math.random().toString(16).slice(2)}`;
        const isSelected = selectedIdentifiers.includes(contact.data.identifier);
        const displayName = contact.data.name || contact.data.identifier;
        containerEl.innerHTML += `
            <div>
                <input type="checkbox" id="${checkboxId}" value="${contact.data.identifier}" data-name="${contact.data.name}" ${isSelected ? 'checked' : ''}>
                <label for="${checkboxId}">${displayName} (${contact.data.identifier})</label>
            </div>`;
    });
}

createGroupButton.addEventListener('click', async () => {
    console.log("Create Group button clicked."); // ADDED LOG
    const friendlyName = groupNameInput.value.trim();
    const description = groupDescriptionInput.value.trim();
    const twilioPhoneNumber = groupTwilioNumberInput.value.trim();
    const participants = Array.from(groupParticipantsSelectEl.querySelectorAll('input:checked'))
        .map(cb => ({ identifier: cb.value, name: cb.dataset.name }));
    if (!friendlyName) { alert('Group Name is required.'); return; }
    if (participants.length === 0) { alert('Select at least one participant.'); return; }
    if (!twilioPhoneNumber) { alert('Twilio Phone Number is required.'); return; }

    console.log("Attempting to call /createGroupConversation function..."); // ADDED LOG
    try {
        const createGroupResult = await callTwilioFunction('createGroupConversation', 'POST', { friendlyName, description, participants, twilioPhoneNumber });
        console.log("Group creation function call successful (client-side). Result:", createGroupResult); // ADDED LOG

        groupNameInput.value = ''; groupDescriptionInput.value = ''; groupTwilioNumberInput.value = '';
        groupParticipantsSelectEl.querySelectorAll('input:checked').forEach(cb => cb.checked = false);

        console.log("Calling fetchActiveConversations after group creation..."); // ADDED LOG
        await fetchActiveConversations(); // Refresh group list
        console.log("fetchActiveConversations completed after group creation."); // ADDED LOG
    } catch (error) {
        console.error('Failed to create group (in createGroupButton listener):', error);
        // Alert is already handled by callTwilioFunction
    }
});

async function fetchActiveConversations() {
    console.log("Fetching active group conversations via /getConversations Twilio Function...");
    try {
        const result = await callTwilioFunction('getConversations', 'GET');

        if (result && result.success && Array.isArray(result.conversations)) {
            originalActiveConversations = result.conversations; // Store the raw list
            console.log("Original active group conversations fetched from function (count: " + originalActiveConversations.length + "):", originalActiveConversations);
        } else {
            console.error("Failed to fetch active conversations from function or invalid format. Result:", JSON.stringify(result, null, 2));
            originalActiveConversations = [];
        }
        applyFiltersAndRenderGroups(); // Apply current filters/sort and render
    } catch (error) {
        console.error('Error fetching active group conversations from function:', error);
        originalActiveConversations = [];
        applyFiltersAndRenderGroups(); // Render empty or error state
    }
}

function applyFiltersAndRenderGroups() {
    console.log(`Applying filters: Search='${groupSearchTerm}', State='${groupFilterState}', OrderBy='${groupOrderBy}', Dir='${groupOrderDirection}'`);
    let processedConversations = [...originalActiveConversations]; // Start with a copy

    // 1. Apply Search Filter (case-insensitive on friendlyName and description)
    if (groupSearchTerm) {
        const lowerSearchTerm = groupSearchTerm.toLowerCase();
        processedConversations = processedConversations.filter(conv => {
            const nameMatch = conv.friendlyName && conv.friendlyName.toLowerCase().includes(lowerSearchTerm);
            const descMatch = conv.attributes && conv.attributes.description && conv.attributes.description.toLowerCase().includes(lowerSearchTerm);
            return nameMatch || descMatch;
        });
    }

    // 2. Apply State Filter
    if (groupFilterState) { // e.g., 'active', 'inactive', 'closed'
        processedConversations = processedConversations.filter(conv => conv.state === groupFilterState);
    }

    // 3. Apply Ordering
    processedConversations.sort((a, b) => {
        let valA, valB;

        switch (groupOrderBy) {
            case 'dateUpdated':
                valA = new Date(a.dateUpdated || 0); // Handle null/undefined dates
                valB = new Date(b.dateUpdated || 0);
                break;
            case 'dateCreated':
                valA = new Date(a.dateCreated || 0);
                valB = new Date(b.dateCreated || 0);
                break;
            case 'friendlyName':
            default: // Default to friendlyName
                valA = (a.friendlyName || '').toLowerCase();
                valB = (b.friendlyName || '').toLowerCase();
                break;
        }

        if (valA < valB) {
            return groupOrderDirection === 'asc' ? -1 : 1;
        }
        if (valA > valB) {
            return groupOrderDirection === 'asc' ? 1 : -1;
        }
        // Handle cases where values are equal, secondary sort by SID to maintain stable sort
        if (a.sid && b.sid) {
            return a.sid.localeCompare(b.sid);
        }
        return 0;
    });

    activeConversations = processedConversations; // Update the global variable that renderGroups uses
    renderGroups(); // Call the existing renderGroups to display the processed list
}

function renderGroups() {
    console.log("renderGroups called. activeConversations count:", activeConversations.length);
    groupsListEl.innerHTML = '';
    if (!activeConversations || activeConversations.length === 0) {
        groupsListEl.innerHTML = '<li class="list-item">No groups found or created yet.</li>';
        return;
    }

    activeConversations.forEach(convData => {
        const li = document.createElement('li');
        li.className = 'list-item';
        const groupName = convData.friendlyName || `Group ${convData.sid.slice(-6)}`;
        const groupDesc = (convData.attributes && convData.attributes.description) ? convData.attributes.description : 'No description';
        const groupTwilioNum = (convData.attributes && convData.attributes.groupTwilioPhoneNumber) ? convData.attributes.groupTwilioPhoneNumber : 'N/A';
        const groupState = convData.state || 'unknown';
        const sanitizedGroupName = groupName.replace(/'/g, "\\'").replace(/"/g, "&quot;");
        const participantsPlaceholderId = `participants-count-${convData.sid}`;

        li.innerHTML = `
            <div>
                <strong>${groupName}</strong> <small>(${convData.sid})</small><br>
                <em>${groupDesc}</em><br>
                <small>Twilio Number: ${groupTwilioNum} | State: ${groupState}</small><br>
                <small id="${participantsPlaceholderId}">Participants: Fetching...</small>
            </div>
            <div class="actions">
                <button onclick="promptJoinConversation('${convData.sid}', '${groupTwilioNum}', '${sanitizedGroupName}')">Join</button>
                <button onclick="openChatModalAsGroupManager('${convData.sid}', '${sanitizedGroupName}')">View</button>
                <button onclick="openNotifyModal('${convData.sid}', '${sanitizedGroupName}')">Notify</button>
                <button class="secondary" onclick="openUpdateModal('${convData.sid}')">Update</button>
                <button onclick="archiveGroup('${convData.sid}')">Archive</button>
                <button onclick="deleteGroup('${convData.sid}')">Delete</button>
                <button onclick="openInviteFlexModal('${convData.sid}', '${sanitizedGroupName}')">Invite Flex Agent</button>
            </div>`;
        groupsListEl.appendChild(li);

        if (conversationsClient) {
            conversationsClient.peekConversationBySid(convData.sid)
                .then(sdkConv => sdkConv.getParticipants())
                .then(participants => {
                    const el = document.getElementById(participantsPlaceholderId);
                    if (el) el.textContent = `Participants: ${participants.length}`;
                })
                .catch(e => {
                    const el = document.getElementById(participantsPlaceholderId);
                    if (el) el.textContent = "Participants: Error";
                    console.error(`Error fetching participants for ${convData.sid}:`, e);
                });
        } else {
            const el = document.getElementById(participantsPlaceholderId);
            if (el) el.textContent = "Participants: (SDK not ready)";
        }
    });
}

window.openUpdateModal = async (conversationSid) => {
    if (!conversationsClient) {
        alert("Conversations client not initialized. Cannot update group.");
        return;
    }
    try {
        console.log(`Fetching details for conversation SID: ${conversationSid} for update modal.`);
        const conversation = await conversationsClient.peekConversationBySid(conversationSid);
        if (!conversation) {
            alert('Conversation not found via SDK.');
            return;
        }
        updateGroupSidModalInput.value = conversationSid;
        updateGroupNameDisplayModalEl.textContent = conversation.friendlyName || `Group ${conversation.sid.slice(-6)}`;
        updateGroupNameModalInput.value = conversation.friendlyName || '';
        const attributes = await conversation.getAttributes();
        updateGroupDescriptionModalInput.value = attributes?.description || '';
        const currentSdkParticipants = await conversation.getParticipants();
        const currentParticipantIdentities = currentSdkParticipants.map(p => {
            if (p.identity) return p.identity;
            if (p.attributes?.proxyAddress) return p.attributes.proxyAddress;
            if (p.bindings?.whatsapp?.address) return p.bindings.whatsapp.address;
            return null;
        }).filter(id => id != null);
        const availableContactsToAdd = userContacts.filter(contact =>
            contact.data && contact.data.identifier && !currentParticipantIdentities.some(id => {
                const contactIdentifier = contact.data.identifier.replace('whatsapp:', '').replace('client:', '');
                const participantIdentifier = id.replace('whatsapp:', '').replace('client:', '');
                return participantIdentifier === contactIdentifier;
            })
        );
        renderParticipantSelectionCheckboxes(updateGroupAddParticipantsSelectEl, availableContactsToAdd);
        updateGroupCurrentParticipantsListEl.innerHTML = '';
        currentSdkParticipants.forEach(p => {
            let pIdForLookup = p.identity;
            if (!pIdForLookup && p.bindings?.whatsapp?.address) pIdForLookup = p.bindings.whatsapp.address;
            else if (!pIdForLookup && p.attributes?.proxyAddress) pIdForLookup = p.attributes.proxyAddress;
            const pDisplayId = pIdForLookup || p.sid;
            const contactData = userContacts.find(c => c.data && (c.data.identifier === pIdForLookup || `whatsapp:${c.data.identifier}` === pIdForLookup || `client:${c.data.identifier}` === pIdForLookup));
            const displayName = contactData?.data?.name || p.attributes?.friendlyName || pDisplayId;
            updateGroupCurrentParticipantsListEl.innerHTML += `
                <li class="list-item">
                    <span>${displayName} (${pDisplayId})</span>
                    <button onclick="removeParticipantFromGroup('${conversationSid}', '${p.sid}')">Remove</button>
                </li>`;
        });
        updateGroupModal.style.display = 'block';
    } catch (error) {
        console.error("Error opening update modal or fetching conversation details:", error);
        alert("Could not load group details for update: " + error.message);
    }
};

sendNotifyMessageButton.addEventListener('click', async () => {
    const conversationSid = notifyGroupSidModalInput.value;
    const message = notifyMessageInput.value.trim();
    if (!message) { alert('Message cannot be empty.'); return; }
    try {
        await callTwilioFunction('notifyGroup', 'POST', { conversationSid, message });
        alert('Notification sent!');
        closeModal('notify-group-modal');
    } catch (error) { console.error('Failed to send notification:', error); }
});

saveGroupDetailsButton.addEventListener('click', async () => {
    const conversationSid = updateGroupSidModalInput.value;
    const friendlyName = updateGroupNameModalInput.value.trim();
    const description = updateGroupDescriptionModalInput.value.trim();
    if (!friendlyName) { alert('Group name cannot be empty.'); return; }
    try {
        await callTwilioFunction('updateGroupDetails', 'POST', { conversationSid, friendlyName, description });
        alert('Group details updated!');
        await fetchActiveConversations();
        closeModal('update-group-modal');
    } catch (error) { console.error('Failed to update group details:', error); }
});

addParticipantsButtonModal.addEventListener('click', async () => {
    const conversationSid = updateGroupSidModalInput.value;
    const participants = Array.from(updateGroupAddParticipantsSelectEl.querySelectorAll('input:checked'))
        .map(cb => ({ identifier: cb.value, name: cb.dataset.name }));

    const convData = originalActiveConversations.find(c => c.sid === conversationSid);
    const twilioPhoneNumber = convData?.attributes?.groupTwilioPhoneNumber;

    if (!twilioPhoneNumber) {
        alert('Missing Twilio number for this group.');
        return;
    }
    if (participants.length === 0) {
        alert('No participants selected.');
        return;
    }

    try {
        await callTwilioFunction('addGroupParticipants', 'POST', {
            conversationSid,
            participants,
            twilioPhoneNumber
        });
        alert('Participants added!');
        await openUpdateModal(conversationSid);
        await fetchActiveConversations();
    } catch (error) {
        console.error('Failed to add participants:', error);
    }
});

let groupManagerClient = null;
let groupManagerIdentity = null;

window.promptJoinConversation = async (conversationSid, twilioPhoneNumber, groupName) => {
    if (!confirm(`Do you want to join this group conversation: ${groupName}?`)) return;

    try {
        // Step 1: Request a token *and* ensure group_manager is added as participant
        const tokenResponse = await callTwilioFunction('initialize-twilio-sdk', 'POST', { 
            purpose: 'join',
            conversationSid
        });

        groupManagerIdentity = tokenResponse.identity;
        console.log(`Group manager identity resolved: ${groupManagerIdentity}`);

        // Step 2: Await full SDK client instantiation (avoids race conditions)
        groupManagerClient = new Twilio.Conversations.Client(tokenResponse.token);
        // wait until the client is connected (prevents race conditions)
        await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('SDK init timeout')), 10000);
        const onState = (state) => {
            if (state === 'connected') { clearTimeout(timeout); groupManagerClient.removeListener('connectionStateChanged', onState); resolve(); }
            if (state === 'denied') { clearTimeout(timeout); groupManagerClient.removeListener('connectionStateChanged', onState); reject(new Error('Token denied')); }
        };
        groupManagerClient.on('connectionStateChanged', onState);
        });
        console.log(`[GroupManager SDK] Ready as identity: ${groupManagerClient.user.identity}`);


        // Step 3: Proceed to open modal (join if needed inside)
        await openChatModalAsGroupManager(conversationSid, groupName);

    } catch (error) {
        console.error("Failed during group manager join process:", error);
        alert("Could not join the conversation.");
    }
};


let activeChatConversation = null;

async function openChatModalAsGroupManager(conversationSid, groupName) {
    if (!groupManagerClient) return alert("Group manager SDK not ready.");
    
    try {
        const conversation = await groupManagerClient.peekConversationBySid(conversationSid);
        console.log(`SDK resolved identity (via user object): ${groupManagerClient.user.identity}`);

        // if Group Manager is not a participant yet, join now; otherwise carry on
        try {
        await conversation.getParticipantByIdentity(groupManagerIdentity);
        // we are already a participant
        } catch {
        try {
            await conversation.join();
        } catch (err) {
            // SDK/Server may race; ignore “already a participant” noise, rethrow anything else
            if (!String(err?.message || '').includes('already a participant')) throw err;
        }
        }


        const chatGroupNameEl = document.getElementById('chat-group-name-modal');
        const chatMessagesEl = document.getElementById('chat-messages');
        chatGroupNameEl.textContent = groupName;
        chatMessagesEl.innerHTML = '';

        const messages = await conversation.getMessages();
        messages.items.forEach(m => appendChatMessage(m));

        conversation.on('messageAdded', appendChatMessage);

        document.getElementById('send-chat-message-button').onclick = async () => {
            const input = document.getElementById('chat-input');
            const text = input.value.trim();
            if (text) {
                await conversation.sendMessage(text);
                input.value = '';
            }
        };

        document.getElementById('chat-modal').style.display = 'block';

    } catch (err) {
        console.error("[GroupManager Chat Modal] Error:", err);
        alert("Could not open group chat.");
    }
}


function appendChatMessage(message) {
    const container = document.getElementById('chat-messages');
    const msgEl = document.createElement('div');
    msgEl.innerHTML = `<strong>${message.author}:</strong> ${message.body}`;
    container.appendChild(msgEl);
    container.scrollTop = container.scrollHeight;
}

window.openNotifyModal = (conversationSid, groupName) => {
    notifyGroupSidModalInput.value = conversationSid;
    notifyGroupNameModalEl.textContent = groupName;
    notifyGroupModal.style.display = 'block';
};


window.removeParticipantFromGroup = async (conversationSid, participantSid) => {
    if (!confirm('Remove this participant?')) return;
    try {
        await callTwilioFunction('removeGroupParticipant', 'POST', { conversationSid, participantSid });
        alert('Participant removed!');
        await openUpdateModal(conversationSid);
        await fetchActiveConversations();
    } catch (error) { console.error('Failed to remove participant:', error); }
};

window.archiveGroup = async (conversationSid) => {
    if (!confirm('Archive this group?')) return;
    try {
        await callTwilioFunction('archiveGroup', 'POST', { conversationSid });
        alert('Group archive request sent.');
        await fetchActiveConversations();
    } catch (error) { console.error('Failed to archive group:', error); }
};

window.deleteGroup = async (conversationSid) => {
    if (!confirm('Permanently delete this group? This cannot be undone.')) return;
    try {
        await callTwilioFunction('deleteGroup', 'POST', { conversationSid });
        alert('Group delete request sent.');
        await fetchActiveConversations();
    } catch (error) { console.error('Failed to delete group:', error); }
};

window.openInviteFlexModal = async (conversationSid, groupName) => {
  inviteFlexConversationSidInput.value = conversationSid;
  inviteFlexGroupNameEl.textContent = `${groupName} (${conversationSid})`;

  // Clear previous options
  inviteWorkersSelect.innerHTML = '';
  inviteQueueSelect.innerHTML = '';

  // Prevent double-click while loading
  sendFlexInvitesButton.disabled = true;

  try {
    const res = await callTwilioFunction('list-taskrouter-entities', 'GET');
    if (!res || res.success === false) {
      throw new Error(res?.message || 'Failed to load TaskRouter entities');
    }

    const workers = Array.isArray(res.workers) ? res.workers : [];
    const queues  = Array.isArray(res.queues)  ? res.queues  : [];

    // Populate workers (multi)
    workers.forEach(w => {
      const opt = document.createElement('option');
      opt.value = w.sid;
      opt.textContent = `${w.friendlyName} — ${w.sid}`;
      inviteWorkersSelect.appendChild(opt);
    });

    // Populate queues (single)
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = '— None —';
    inviteQueueSelect.appendChild(noneOpt);

    queues.forEach(q => {
      const opt = document.createElement('option');
      opt.value = q.sid;
      opt.textContent = `${q.friendlyName} — ${q.sid}`;
      inviteQueueSelect.appendChild(opt);
    });

    inviteFlexModal.style.display = 'block';
    sendFlexInvitesButton.disabled = false;
  } catch (e) {
    console.error('Failed to load TaskRouter entities:', e);
    alert('Could not load workers/queues. Check server logs.');
    sendFlexInvitesButton.disabled = false;
  }
};



// --- Modal Utilities ---
window.closeModal = (modalId) => { document.getElementById(modalId).style.display = 'none'; };
window.onclick = (event) => { if (event.target.classList.contains('modal')) event.target.style.display = "none"; };
