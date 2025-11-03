// index.js (UPDATED - robust /api/sendMessage with recipient validation and logging)
require('dotenv').config();
const qrcode = require('qrcode-terminal');
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { db, admin } = require('./services/firebase');
const MainAgent = require('./agents/main');

console.log("Starting Agent Optimus Bot Service v2...");

const AGENT_ID = process.env.AGENT_ID;
if (!AGENT_ID) {
    console.error("❌ CRITICAL ERROR: AGENT_ID is not defined in the .env file.");
    process.exit(1);
}

// --- CHANGE FOR RENDER PERSISTENT DISK ---
// We specify the dataPath to match the Mount Path of the disk on Render.
const client = new Client({
    authStrategy: new LocalAuth({ 
        clientId: `session-${AGENT_ID}`,
        dataPath: '/var/data/wwebjs_auth' // <-- THIS IS THE CRITICAL ADDITION
    }),
    puppeteer: { headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] }
});
// ------------------------------------------

let botBrain = null;
let heartbeatInterval = null;
const statusRef = db.collection('bot_status').doc(AGENT_ID);

async function setStatus(status, agentName = 'Agent Optimus') {
    console.log(`[StatusManager] Setting status to: ${status}`);
    try {
        await statusRef.set({
            status,
            agentName,
            lastSeen: admin.firestore.Timestamp.now()
        }, { merge: true });
    } catch (err) {
        console.error('[StatusManager] Failed to set status:', err);
    }
}

function startHeartbeat() {
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
        statusRef.update({ lastSeen: admin.firestore.Timestamp.now() }).catch(err => console.error("Heartbeat update failed:", err));
    }, 60000);
}
function stopHeartbeat() { if (heartbeatInterval) clearInterval(heartbeatInterval); }

const app = express();
app.use(cors({
    origin: ['http://localhost:5173', 'https://agentoptimus.co.za'],
    credentials: true
}));
app.use(bodyParser.json());

app.get('/api/health', (req, res) => res.json({ ok: true }));

app.post('/api/sendMessage', async (req, res) => {
    try {
        const start = Date.now();
        console.log('[API] /api/sendMessage called', { body: req.body, headers: req.headers });

        const { leadId, message, sentBy } = req.body;
        const agentId = req.header('x-agent-id');

        if (!leadId || !message) return res.status(400).json({ error: 'leadId and message are required' });
        if (!agentId) return res.status(401).json({ error: 'Missing agent id header' });

        const leadSnap = await db.collection('leads').doc(leadId).get();
        if (!leadSnap.exists) {
            console.warn('[API] Lead not found:', leadId);
            return res.status(404).json({ error: 'Lead not found' });
        }
        const lead = leadSnap.data();
        if (lead.agentId !== agentId) {
            console.warn('[API] Agent mismatch. lead.agentId:', lead.agentId, 'agentId header:', agentId);
            return res.status(403).json({ error: 'Agent not allowed to send for this lead' });
        }

        const contactNumber = lead.contact;
        if (!contactNumber) return res.status(400).json({ error: 'Lead has no contact number' });

        const chatId = `${contactNumber}@c.us`;

        if (!client.info || !client.info.wid) {
            console.error('[API] WhatsApp client not ready. client.info:', client.info);
            return res.status(503).json({ error: 'WhatsApp client not ready' });
        }

        let isRegistered = false;
        try {
            isRegistered = await client.isRegisteredUser(chatId);
            console.log('[API] isRegisteredUser', chatId, isRegistered);
        } catch (err) {
            console.warn('[API] Failed to check registration for', chatId, err);
        }

        if (isRegistered === false) {
            console.warn('[API] Recipient not a registered WhatsApp user:', chatId);
            return res.status(422).json({ error: 'Recipient phone number is not a WhatsApp user' });
        }

        let sendResult = null;
        try {
            console.log(`[API] Sending message to ${chatId}...`);
            sendResult = await client.sendMessage(chatId, message);
            console.log('[API] sendMessage result:', sendResult && sendResult.id ? sendResult.id : sendResult);
        } catch (err) {
            console.error('[API] client.sendMessage failed:', err);
            return res.status(500).json({ error: 'Failed to send WhatsApp message', detail: err?.message || String(err) });
        }

        try {
            await db.collection('leads').doc(leadId).update({
                conversation: admin.firestore.FieldValue.arrayUnion({
                    role: 'agent',
                    content: message,
                    timestamp: admin.firestore.Timestamp.now(),
                    sentBy: sentBy || agentId
                }),
                lastContactAt: admin.firestore.Timestamp.now()
            });
            console.log('[API] Appended agent message to Firestore for lead:', leadId);
        } catch (err) {
            console.error('[API] Failed to write agent message to Firestore:', err);
            // Note: Returning a 202 status (Accepted) because the primary action (sending WA message) succeeded.
            return res.status(202).json({ ok: true, warning: 'message_sent_but_firestore_failed', detail: err.message });
        }

        const elapsed = Date.now() - start;
        console.log(`[API] /api/sendMessage completed in ${elapsed}ms for lead ${leadId}`);
        return res.json({ ok: true });
    } catch (error) {
        console.error('❌ /api/sendMessage error:', error);
        return res.status(500).json({ error: error.message || 'Internal server error' });
    }
});

const API_PORT = process.env.API_PORT || 3001;
app.listen(API_PORT, () => console.log(`API server listening on port ${API_PORT}`));

let botReady = false;

async function initializeBot() {
    try {
        const agentDoc = await db.collection('users').doc(AGENT_ID).get();
        if (!agentDoc.exists) throw new Error(`Agent ${AGENT_ID} not found`);
        const agentConfig = { agentId: agentDoc.id, ...agentDoc.data() };
        botBrain = new MainAgent(agentConfig);
        console.log(`✅ Brain loaded for designated agent: ${agentConfig.fullName}`);

        client.on('qr', qr => {
            qrcode.generate(qr, { small: true });
            setStatus('pending_qr_scan', agentConfig.fullName);
        });

        client.on('ready', async () => {
            console.log('✅ WhatsApp Client is ready!');
            botReady = true;
            await setStatus('online', agentConfig.fullName);
            startHeartbeat();
        });

        client.on('disconnected', async (reason) => {
            console.warn('🔴 Client disconnected:', reason);
            botReady = false;
            await setStatus('offline', agentConfig.fullName);
            stopHeartbeat();
        });

        client.on('message', async (msg) => {
            try {
                if (msg.from.endsWith('@g.us') || msg.from === 'status@broadcast') return;
                if (!botBrain) return;

                const contact = await msg.getContact();
                const contactName = contact.pushname || contact.name || msg.from.split('@')[0];
                const chatId = msg.from;
                const contactNumber = chatId.split('@')[0];

                try {
                    const leadsSnapshot = await db.collection('leads')
                        .where('agentId', '==', AGENT_ID)
                        .where('contact', '==', contactNumber)
                        .limit(1)
                        .get();

                    if (!leadsSnapshot.empty) {
                        const leadData = leadsSnapshot.docs[0].data();
                        if (leadData.conversationMode === 'manual') {
                            console.log(`⏸️ AI paused - agent is handling lead: ${chatId}`);
                            const leadId = leadsSnapshot.docs[0].id;
                            await db.collection('leads').doc(leadId).update({
                                conversation: admin.firestore.FieldValue.arrayUnion({
                                    role: 'user',
                                    content: msg.body,
                                    timestamp: admin.firestore.Timestamp.now()
                                }),
                                lastContactAt: admin.firestore.Timestamp.now()
                            });
                            return;
                        }
                    }
                } catch (err) {
                    console.error('Error checking conversationMode:', err);
                }

                const response = await botBrain.handleRequest({
                    messageBody: msg.body,
                    contactName,
                    chatId,
                });

                if (response) {
                    await client.sendMessage(msg.from, response);
                    // This block for logging has been simplified and consolidated in your MainAgent/LeadManager
                    // The core logic inside handleRequest already handles logging.
                }
            } catch (err) {
                console.error('Error in client.message handler:', err);
                try { 
                    if (msg && msg.from) {
                       await client.sendMessage(msg.from, "Sorry, I had an error processing your message."); 
                    }
                } catch(e) {
                    console.error('Failed to send error message back to user:', e);
                }
            }
        });

        client.initialize();
    } catch (error) {
        console.error('CRITICAL initialization error:', error);
        process.exit(1);
    }
}

initializeBot();