// bot_service_v2/BotInstance.js (FINAL, DEFINITIVE VERSION)
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const { db } = require('./services/firebase');
const MainAgent = require('./agents/main');

class BotInstance {
    constructor(agentConfig) {
        this.agentConfig = agentConfig;
        this.agentId = agentConfig.agentId;
        this.statusRef = db.collection('bot_status').doc(this.agentId);
        this.heartbeatInterval = null;
        this.mainAgent = new MainAgent(this.agentConfig);
        
        this.client = new Client({
            authStrategy: new LocalAuth({ clientId: `session-${this.agentId}` }),
            puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
        });

        // --- BINDING THE EVENT HANDLERS ---
        // This ensures that 'this' refers to the BotInstance inside the handlers
        this.client.on('qr', this.handleQrCode.bind(this));
        this.client.on('ready', this.handleReady.bind(this));
        this.client.on('disconnected', this.handleDisconnect.bind(this));
        this.client.on('message', this.handleMessage.bind(this));
    }

    async setStatus(status) {
        console.log(`[${this.agentConfig.fullName}] Setting status to: ${status}`);
        try {
            await this.statusRef.set({
                status: status,
                agentName: this.agentConfig.fullName,
                lastSeen: new Date()
            }, { merge: true });
        } catch (error) {
            console.error(`[${this.agentConfig.fullName}] FAILED to set status:`, error);
        }
    }

    startHeartbeat() {
        this.stopHeartbeat();
        this.heartbeatInterval = setInterval(() => {
            this.statusRef.update({ lastSeen: new Date() });
        }, 60000);
    }

    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
        }
    }

    // --- EVENT HANDLER METHODS ---
    handleQrCode(qr) {
        console.log(`[${this.agentConfig.fullName}] SCAN QR CODE:`);
        qrcode.generate(qr, { small: true });
        this.setStatus('pending_qr_scan');
    }

    async handleReady() {
        console.log(`✅ [${this.agentConfig.fullName}] WhatsApp Client is ready!`);
        await this.setStatus('online');
        this.startHeartbeat();
    }

    async handleDisconnect(reason) {
        console.warn(`🔴 [${this.agentConfig.fullName}] Client was logged out:`, reason);
        await this.setStatus('offline');
        this.stopHeartbeat();
    }

    async handleMessage(msg) {
        if (msg.from.endsWith('@g.us') || msg.from === 'status@broadcast') return;
        const contact = await msg.getContact();
        const contactName = contact.pushname || contact.name || msg.from.split('@')[0];
        const response = await this.mainAgent.handleRequest({
            messageBody: msg.body,
            contactName: contactName,
            chatId: msg.from,
        });
        if (response) {
            this.client.sendMessage(msg.from, response);
        }
    }

    initialize() {
        console.log(`Initializing bot for ${this.agentConfig.fullName}...`);
        this.client.initialize();
    }
}

module.exports = BotInstance;