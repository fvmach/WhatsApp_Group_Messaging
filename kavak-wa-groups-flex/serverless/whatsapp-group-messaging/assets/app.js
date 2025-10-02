// --- Global State & Configuration ---
let conversationsClient = null;
let userContacts = []; // This will be populated by fetchContacts
let activeConversations = []; // This will be populated by fetchActiveConversations from your Twilio Function
let originalActiveConversations = []; 
const FUNCTION_BASE_URL = 'https://whatsapp-group-messaging-1361.twil.io';

let groupSearchTerm = '';
let groupFilterState = 'active'; // e.g., 'active', 'inactive', 'closed', or '' for all
let groupOrderBy = 'dateUpdated'; // Default order: by last updated
let groupOrderDirection = 'desc';   // Default direction: descending
let activeIdentity = null;

// React state references (will be set by React components)
let reactStateUpdaters = {
    setContacts: null,
    setGroups: null,
    setSdkStatus: null,
    setIsInitialized: null
};

// --- Bridge functions for React integration ---
window.initializeSDKFromPaste = async function(identity) {
    try {
        // Always resolve to whatsapp_groups_manager unless another identity is explicitly provided
        const tokenResponse = await callTwilioFunction('initialize-twilio-sdk', 'POST', {
            identity: identity || 'whatsapp_groups_manager'
        });

        activeIdentity = tokenResponse.identity;
        conversationsClient = new Twilio.Conversations.Client(tokenResponse.token);

        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error('SDK initialization timeout')), 10000);
            
            conversationsClient.on('connectionStateChanged', (state) => {
                if (state === 'connected') {
                    clearTimeout(timeout);
                    console.log('Conversations Client Connected as global identity:', activeIdentity);
                    
                    // Setup event listeners
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

                    loadInitialData();
                    resolve();
                } else if (state === 'disconnected' || state === 'denied') {
                    clearTimeout(timeout);
                    reject(new Error(`Conversations Client ${state}`));
                }
            });
        });
    } catch (error) {
        console.error('SDK Initialization error:', error);
        throw error;
    }
};

window.addContactFromPaste = async function(name, identifier, team) {
    try {
        await callTwilioFunction('sync-contacts', 'POST', { name, identifier, team });
        await fetchContacts();
    } catch (error) {
        console.error('Failed to add contact:', error);
        throw error;
    }
};

window.createGroupFromPaste = async function(friendlyName, description, twilioPhoneNumber, selectedParticipants) {
    try {
        const participants = selectedParticipants.map(id => {
            const contact = userContacts.find(c => c.data && c.data.identifier === id);
            return { 
                identifier: id, 
                name: contact ? contact.data.name : id 
            };
        });

        await callTwilioFunction('createGroupConversation', 'POST', { 
            friendlyName, 
            description, 
            participants, 
            twilioPhoneNumber 
        });
        
        await fetchActiveConversations();
    } catch (error) {
        console.error('Failed to create group:', error);
        throw error;
    }
};

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
        renderContacts();
        renderParticipantSelectionCheckboxes(document.getElementById('group-participants-select'), userContacts);
    } catch (error) {
        console.error('Failed to fetch contacts:', error);
        const contactsList = document.getElementById('contacts-list');
        if (contactsList) {
            const errorItem = document.createElement('li');
            errorItem.className = 'paste-list-item';
            errorItem.innerHTML = '<span style="color: #d61f2d;">Failed to load contacts. Check console.</span>';
            contactsList.appendChild(errorItem);
        }
    }
}

function renderContacts() {
    const contactsListEl = document.getElementById('contacts-list');
    if (!contactsListEl) return;
    
    contactsListEl.innerHTML = '';
    if (!userContacts || userContacts.length === 0) {
        const emptyItem = document.createElement('li');
        emptyItem.className = 'paste-list-item';
        emptyItem.innerHTML = '<span>No contacts added yet.</span>';
        contactsListEl.appendChild(emptyItem);
        return;
    }
    
    userContacts.forEach(contact => {
        if (!contact.data || !contact.id) {
            console.warn("Skipping rendering contact due to missing data or id:", contact);
            return;
        }
        
        const contactItem = document.createElement('li');
        contactItem.className = 'paste-list-item';
        
        const displayName = contact.data.name || 'N/A';
        const displayIdentifier = contact.data.identifier || 'N/A';
        const displayTeam = contact.data.team ? ` - Team: ${contact.data.team}` : '';
        
        contactItem.innerHTML = `
            <span><strong>${displayName}</strong> (${displayIdentifier})${displayTeam}</span>
            <button 
                class="paste-button destructive"
                onclick="deleteContact('${contact.id}')"
                style="padding: 6px 12px; font-size: 14px; margin: 0;"
            >Delete</button>
        `;
        contactsListEl.appendChild(contactItem);
    });
}

// Rest of the original contact management functions
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
    if (!containerEl) return;
    
    containerEl.innerHTML = '';
    if (!contacts || contacts.length === 0) {
        containerEl.innerHTML = '<p>No contacts available to select.</p>'; 
        return;
    }
    
    contacts.forEach(contact => {
        if (!contact.data || !contact.data.identifier) {
            console.warn("Skipping contact in checkbox list due to missing data.identifier:", contact);
            return;
        }
        
        const checkboxId = `cb-${contact.data.identifier.replace(/[^a-zA-Z0-9]/g, "")}-${Math.random().toString(16).slice(2)}`;
        const isSelected = selectedIdentifiers.includes(contact.data.identifier);
        const displayName = contact.data.name || contact.data.identifier;
        
        const checkboxDiv = document.createElement('div');
        checkboxDiv.className = 'checkbox-item';
        checkboxDiv.innerHTML = `
            <input type="checkbox" id="${checkboxId}" value="${contact.data.identifier}" data-name="${contact.data.name}" ${isSelected ? 'checked' : ''}>
            <label for="${checkboxId}">${displayName} (${contact.data.identifier})</label>
        `;
        containerEl.appendChild(checkboxDiv);
    });
}

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
    const groupsListEl = document.getElementById('groups-list');
    if (!groupsListEl) return;
    
    groupsListEl.innerHTML = '';
    if (!activeConversations || activeConversations.length === 0) {
        const emptyItem = document.createElement('li');
        emptyItem.className = 'paste-list-item';
        emptyItem.innerHTML = '<span>No groups found or created yet.</span>';
        groupsListEl.appendChild(emptyItem);
        return;
    }

    activeConversations.forEach(convData => {
        const groupItem = document.createElement('li');
        groupItem.className = 'paste-list-item';
        groupItem.style.flexDirection = 'column';
        groupItem.style.alignItems = 'stretch';
        
        const groupName = convData.friendlyName || `Group ${convData.sid.slice(-6)}`;
        const groupDesc = (convData.attributes && convData.attributes.description) ? convData.attributes.description : 'No description';
        const groupTwilioNum = (convData.attributes && convData.attributes.groupTwilioPhoneNumber) ? convData.attributes.groupTwilioPhoneNumber : 'N/A';
        const groupState = convData.state || 'unknown';
        const sanitizedGroupName = groupName.replace(/'/g, "\\'").replace(/"/g, "&quot;");
        const participantsPlaceholderId = `participants-count-${convData.sid}`;

        groupItem.innerHTML = `
            <div style="margin-bottom: 12px;">
                <h4 class="paste-heading-4" style="margin: 0 0 8px 0; color: #0263e0;">${groupName} <small style="color: #666;">(${convData.sid})</small></h4>
                <p style="margin: 0 0 4px 0; color: #666; font-style: italic;">${groupDesc}</p>
                <p style="margin: 0 0 4px 0; font-size: 14px; color: #888;">Twilio Number: ${groupTwilioNum} | State: <strong>${groupState}</strong></p>
                <p id="${participantsPlaceholderId}" style="margin: 0; font-size: 14px; color: #888;">Participants: Fetching...</p>
            </div>
            <div class="button-group">
                <button class="paste-button secondary" onclick="promptJoinConversation('${convData.sid}', '${groupTwilioNum}', '${sanitizedGroupName}')" 
                        style="padding: 8px 12px; font-size: 14px;">Join</button>
                <button class="paste-button" onclick="openChatModalAsGroupManager('${convData.sid}', '${sanitizedGroupName}')"
                        style="padding: 8px 12px; font-size: 14px; background: #28a745;">View</button>
                <button class="paste-button" onclick="openNotifyModal('${convData.sid}', '${sanitizedGroupName}')"
                        style="padding: 8px 12px; font-size: 14px; background: #ffc107; color: black;">Notify</button>
                <button class="paste-button secondary" onclick="openUpdateModal('${convData.sid}')"
                        style="padding: 8px 12px; font-size: 14px;">Update</button>
                <button class="paste-button" onclick="archiveGroup('${convData.sid}')"
                        style="padding: 8px 12px; font-size: 14px; background: #6c757d;">Archive</button>
                <button class="paste-button destructive" onclick="deleteGroup('${convData.sid}')"
                        style="padding: 8px 12px; font-size: 14px;">Delete</button>
                <button class="paste-button" onclick="openInviteFlexModal('${convData.sid}', '${sanitizedGroupName}')"
                        style="padding: 8px 12px; font-size: 14px; background: #f22f46;">Invite Flex Agent</button>
            </div>
        `;
        groupsListEl.appendChild(groupItem);

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

// Filter event handlers for the React components
window.updateSearchTerm = function(term) {
    groupSearchTerm = term;
    applyFiltersAndRenderGroups();
};

window.updateFilterState = function(state) {
    groupFilterState = state;
    applyFiltersAndRenderGroups();
};

window.updateOrderBy = function(orderBy) {
    groupOrderBy = orderBy;
    applyFiltersAndRenderGroups();
};

window.updateOrderDirection = function(direction) {
    groupOrderDirection = direction;
    applyFiltersAndRenderGroups();
};

// All the remaining original functions...
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
        document.getElementById('update-group-sid-modal').value = conversationSid;
        document.getElementById('update-group-name-display-modal').textContent = conversation.friendlyName || `Group ${conversation.sid.slice(-6)}`;
        document.getElementById('update-group-name-modal').value = conversation.friendlyName || '';
        const attributes = await conversation.getAttributes();
        document.getElementById('update-group-description-modal').value = attributes?.description || '';
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
        renderParticipantSelectionCheckboxes(document.getElementById('update-group-add-participants-select'), availableContactsToAdd);
        const updateGroupCurrentParticipantsListEl = document.getElementById('update-group-current-participants-list');
        updateGroupCurrentParticipantsListEl.innerHTML = '';
        currentSdkParticipants.forEach(p => {
            let pIdForLookup = p.identity;
            if (!pIdForLookup && p.bindings?.whatsapp?.address) pIdForLookup = p.bindings.whatsapp.address;
            else if (!pIdForLookup && p.attributes?.proxyAddress) pIdForLookup = p.attributes.proxyAddress;
            const pDisplayId = pIdForLookup || p.sid;
            const contactData = userContacts.find(c => c.data && (c.data.identifier === pIdForLookup || `whatsapp:${c.data.identifier}` === pIdForLookup || `client:${c.data.identifier}` === pIdForLookup));
            const displayName = contactData?.data?.name || p.attributes?.friendlyName || pDisplayId;
            
            const participantItem = document.createElement('li');
            participantItem.className = 'participant-item';
            participantItem.innerHTML = `
                <span>${displayName} (${pDisplayId})</span>
                <button onclick="removeParticipantFromGroup('${conversationSid}', '${p.sid}')"
                        style="background: #dc3545; color: white; border: none; padding: 6px 12px; border-radius: 4px; cursor: pointer; font-size: 14px;">Remove</button>
            `;
            updateGroupCurrentParticipantsListEl.appendChild(participantItem);
        });
        document.getElementById('update-group-modal').classList.remove('hidden');
    } catch (error) {
        console.error("Error opening update modal or fetching conversation details:", error);
        alert("Could not load group details for update: " + error.message);
    }
};

// Event listeners for form submissions
document.addEventListener('DOMContentLoaded', function() {
    // Notify message button
    const sendNotifyMessageButton = document.getElementById('send-notify-message-button');
    if (sendNotifyMessageButton) {
        sendNotifyMessageButton.addEventListener('click', async () => {
            const conversationSid = document.getElementById('notify-group-sid-modal').value;
            const message = document.getElementById('notify-message').value.trim();
            if (!message) { alert('Message cannot be empty.'); return; }
            try {
                await callTwilioFunction('notifyGroup', 'POST', { conversationSid, message });
                alert('Notification sent!');
                closeModal('notify-group-modal');
            } catch (error) { console.error('Failed to send notification:', error); }
        });
    }

    // Save group details button
    const saveGroupDetailsButton = document.getElementById('save-group-details-button');
    if (saveGroupDetailsButton) {
        saveGroupDetailsButton.addEventListener('click', async () => {
            const conversationSid = document.getElementById('update-group-sid-modal').value;
            const friendlyName = document.getElementById('update-group-name-modal').value.trim();
            const description = document.getElementById('update-group-description-modal').value.trim();
            if (!friendlyName) { alert('Group name cannot be empty.'); return; }
            try {
                await callTwilioFunction('updateGroupDetails', 'POST', { conversationSid, friendlyName, description });
                alert('Group details updated!');
                await fetchActiveConversations();
                closeModal('update-group-modal');
            } catch (error) { console.error('Failed to update group details:', error); }
        });
    }

    // Add participants button
    const addParticipantsButtonModal = document.getElementById('add-participants-button-modal');
    if (addParticipantsButtonModal) {
        addParticipantsButtonModal.addEventListener('click', async () => {
            const conversationSid = document.getElementById('update-group-sid-modal').value;
            const participantCheckboxes = document.getElementById('update-group-add-participants-select').querySelectorAll('input:checked');
            const participants = Array.from(participantCheckboxes)
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
    }

    // Send Flex invites button
    const sendFlexInvitesButton = document.getElementById('send-flex-invites-button');
    if (sendFlexInvitesButton) {
        sendFlexInvitesButton.addEventListener('click', async () => {
            const conversationSid = document.getElementById('invite-flex-conversation-sid').value;
            const selectedWorkerSids = Array.from(document.getElementById('invite-workers-select').selectedOptions).map(o => o.value);
            const selectedQueueSid = document.getElementById('invite-queue-select').value;

            if ((!selectedWorkerSids || selectedWorkerSids.length === 0) && !selectedQueueSid) {
                alert('Pick at least one worker or a queue.'); 
                return;
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
            else if (state === 'disconnected' || state === 'denied') { clearTimeout(timeout); groupManagerClient.removeListener('connectionStateChanged', onState); reject(new Error(`Connection ${state}`)); }
        };
        groupManagerClient.on('connectionStateChanged', onState);
        });

        // Step 3: Safely get conversation by SID and join it
        const conversation = await groupManagerClient.getConversationBySid(conversationSid);

        console.log(`[GroupManager Join] Successfully joined conversation ${conversationSid} as ${groupManagerIdentity}.`);
        alert(`Successfully joined ${groupName}!`);

    } catch (err) {
        console.error("[GroupManager Join] Error:", err);
        alert("Could not join the group. See console for details.");
    }
};

window.openChatModalAsGroupManager = async (conversationSid, groupName) => {
    if (!groupManagerClient) {
        alert("You need to join a group first using the 'Join' button.");
        return;
    }

    try {
        // Use the group manager client to get the conversation
        const conversation = await groupManagerClient.getConversationBySid(conversationSid);

        // Ensure we're a participant before trying to read messages
        try {
            await conversation.join();
        } catch (err) {
            // SDK/Server may race; ignore "already a participant" noise, rethrow anything else
            if (!String(err?.message || '').includes('already a participant')) throw err;
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

        document.getElementById('chat-modal').classList.remove('hidden');

    } catch (err) {
        console.error("[GroupManager Chat Modal] Error:", err);
        alert("Could not open group chat.");
    }
}

function appendChatMessage(message) {
    const container = document.getElementById('chat-messages');
    const msgEl = document.createElement('div');
    msgEl.className = 'chat-message';
    msgEl.innerHTML = `<strong>${message.author}:</strong> ${message.body}`;
    container.appendChild(msgEl);
    container.scrollTop = container.scrollHeight;
}

window.openNotifyModal = (conversationSid, groupName) => {
    document.getElementById('notify-group-sid-modal').value = conversationSid;
    document.getElementById('notify-group-name-modal').textContent = groupName;
    document.getElementById('notify-group-modal').classList.remove('hidden');
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
    document.getElementById('invite-flex-conversation-sid').value = conversationSid;
    document.getElementById('invite-flex-group-name').textContent = `${groupName} (${conversationSid})`;

    // Clear previous options
    document.getElementById('invite-workers-select').innerHTML = '';
    document.getElementById('invite-queue-select').innerHTML = '';

    // Prevent double-click while loading
    document.getElementById('send-flex-invites-button').disabled = true;

    try {
        const res = await callTwilioFunction('list-taskrouter-entities', 'GET');
        if (!res || res.success === false) {
            throw new Error(res?.message || 'Failed to load TaskRouter entities');
        }

        const workers = Array.isArray(res.workers) ? res.workers : [];
        const queues  = Array.isArray(res.queues)  ? res.queues  : [];

        // Populate workers (multi)
        const workersSelect = document.getElementById('invite-workers-select');
        workers.forEach(w => {
            const opt = document.createElement('option');
            opt.value = w.sid;
            opt.textContent = `${w.friendlyName} — ${w.sid}`;
            workersSelect.appendChild(opt);
        });

        // Populate queues (single)
        const queueSelect = document.getElementById('invite-queue-select');
        const noneOpt = document.createElement('option');
        noneOpt.value = '';
        noneOpt.textContent = '— None —';
        queueSelect.appendChild(noneOpt);

        queues.forEach(q => {
            const opt = document.createElement('option');
            opt.value = q.sid;
            opt.textContent = `${q.friendlyName} — ${q.sid}`;
            queueSelect.appendChild(opt);
        });

        document.getElementById('invite-flex-modal').classList.remove('hidden');
        document.getElementById('send-flex-invites-button').disabled = false;
    } catch (e) {
        console.error('Failed to load TaskRouter entities:', e);
        alert('Could not load workers/queues. Check server logs.');
        document.getElementById('send-flex-invites-button').disabled = false;
    }
};

// --- Modal Utilities ---
window.closeModal = (modalId) => { 
    document.getElementById(modalId).classList.add('hidden'); 
};

window.onclick = (event) => { 
    if (event.target.classList.contains('modal-overlay')) 
        event.target.classList.add('hidden'); 
};