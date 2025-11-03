// tools/memory.js
class MemoryTool {
    constructor() {
        this.cache = new Map();
        console.log("[MemoryTool] Initialized.");
    }

    async getOrCreateState(chatId) {
        // Check cache first
        if (this.cache.has(chatId)) {
            console.log(`[MemoryTool] Retrieved cached state for ${chatId}`);
            return this.cache.get(chatId);
        }

        // Create fresh state
        const state = {
            chat_id: chatId,
            sales_flow_step: null,
            booking_step: null,
            lead_id: null,
            last_updated: new Date()
        };

        this.cache.set(chatId, state);
        console.log(`[MemoryTool] Created new state for ${chatId}`);
        return state;
    }

    async saveState(chatId, state) {
        state.last_updated = new Date();
        this.cache.set(chatId, state);
        console.log(`[MemoryTool] Saved state for ${chatId}`);
    }

    async clearState(chatId) {
        this.cache.delete(chatId);
        console.log(`[MemoryTool] Cleared state for ${chatId}`);
    }

    // Clean up old sessions (called periodically)
    cleanup() {
        const now = Date.now();
        const oneHourAgo = now - (60 * 60 * 1000);
        
        for (const [chatId, state] of this.cache.entries()) {
            const age = state.last_updated.getTime();
            
            // Clear states older than 1 hour with no active flow
            if (age < oneHourAgo && !state.sales_flow_step && !state.booking_step) {
                this.cache.delete(chatId);
                console.log(`[MemoryTool] Auto-cleared stale state for ${chatId}`);
            }
        }
    }

    // Start automatic cleanup
    startCleanup() {
        setInterval(() => {
            this.cleanup();
        }, 300000); // Run every 5 minutes
        console.log("[MemoryTool] Started automatic cleanup (every 5 minutes)");
    }
}

module.exports = MemoryTool;