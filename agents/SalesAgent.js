// agents/SalesAgent.js
const { db, admin } = require('../services/firebase');

class SalesAgent {
    constructor(agentConfig) {
        this.config = agentConfig;
        console.log("[SalesAgent] Initialized.");
    }

    async handleRequest(context) {
        const { state, messageBody, contactName } = context;

        // Initialize the qualification flow
        if (!state.sales_flow_step) {
            state.sales_flow_step = 'ask_budget';
            state.contact_name = contactName;
            return `Hi ${contactName}! I'd love to help you find the perfect property. To get started, what's your budget range?`;
        }

        // Progress through the qualification steps
        switch (state.sales_flow_step) {
            case 'ask_budget':
                state.budget = messageBody;
                state.sales_flow_step = 'ask_timeline';
                return `Great! And when are you looking to move? (e.g., immediately, in 1-3 months, just exploring)`;

            case 'ask_timeline':
                state.timeline = messageBody;
                state.sales_flow_step = 'ask_preferences';
                return `Perfect! What are your must-haves? (e.g., number of bedrooms, location, garden, etc.)`;

            case 'ask_preferences':
                state.preferences = messageBody;
                
                // Update the lead in Firestore with qualification data
                if (state.lead_id) {
                    try {
                        await db.collection('leads').doc(state.lead_id).update({
                            financial_position: state.budget,
                            timeline: state.timeline,
                            preferences: state.preferences,
                            status: 'Qualified',
                            lastContactAt: admin.firestore.Timestamp.now()
                        });
                        console.log(`[SalesAgent] ✅ Lead ${state.lead_id} qualified!`);
                    } catch (error) {
                        console.error(`[SalesAgent] Error updating lead:`, error);
                    }
                }

                // Clear the flow - we're done qualifying
                delete state.sales_flow_step;

                return `Thank you, ${contactName}! Based on what you've told me:\n\n` +
                       `💰 Budget: ${state.budget}\n` +
                       `📅 Timeline: ${state.timeline}\n` +
                       `🏠 Preferences: ${state.preferences}\n\n` +
                       `I can help you find perfect matches! Would you like me to search our listings, or would you prefer to book a viewing with ${this.config.fullName}?`;

            default:
                // Fallback - shouldn't happen
                delete state.sales_flow_step;
                return `How can I help you today, ${contactName}?`;
        }
    }
}

module.exports = SalesAgent;