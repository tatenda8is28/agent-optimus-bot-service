// agents/BookingAgent.js
const { db, admin } = require('../services/firebase');

class BookingAgent {
    constructor(agentConfig) {
        this.config = agentConfig;
        console.log("[BookingAgent] Initialized.");
    }

    async handleRequest(context) {
        const { state, messageBody, contactName } = context;

        // Initialize booking flow
        if (!state.booking_step) {
            state.booking_step = 'request_datetime';
            return `I'd be happy to schedule a viewing for you! When would you like to visit? (e.g., "Tomorrow at 2pm" or "Friday morning")`;
        }

        switch (state.booking_step) {
            case 'request_datetime':
                // For MVP, accept the date as-is
                state.proposed_datetime = messageBody;
                state.booking_step = 'confirm';
                return `Great! So you'd like to visit ${state.proposed_datetime}. Let me check ${this.config.fullName}'s availability...\n\n✅ That time is available!\n\nShall I confirm this booking? Reply "yes" to confirm or "no" to try another time.`;

            case 'confirm':
                const lowerReply = messageBody.toLowerCase();
                
                if (lowerReply.includes('yes') || lowerReply.includes('confirm')) {
                    // Create the booking
                    try {
                        const bookingData = {
                            agentId: this.config.agentId,
                            leadId: state.lead_id || null,
                            title: `Viewing with ${contactName}`,
                            proposedTime: state.proposed_datetime,
                            type: 'ai_booking',
                            status: 'pending_agent_confirmation',
                            createdAt: admin.firestore.Timestamp.now()
                        };

                        await db.collection('bookings').add(bookingData);
                        console.log(`[BookingAgent] ✅ Created booking for ${contactName}`);

                        // Update lead status
                        if (state.lead_id) {
                            await db.collection('leads').doc(state.lead_id).update({
                                status: 'Viewing Booked',
                                lastContactAt: admin.firestore.Timestamp.now()
                            });
                        }
                    } catch (error) {
                        console.error(`[BookingAgent] Error creating booking:`, error);
                        delete state.booking_step;
                        delete state.proposed_datetime;
                        return `I'm sorry, there was an error creating your booking. Please try again or contact ${this.config.fullName} directly.`;
                    }

                    // Clear booking flow
                    delete state.booking_step;
                    delete state.proposed_datetime;

                    return `✅ Perfect! Your viewing is confirmed for ${state.proposed_datetime}.\n\n` +
                           `${this.config.fullName} will see you then! You'll receive a confirmation SMS shortly.\n\n` +
                           `Is there anything else I can help you with?`;

                } else {
                    // User said no or unclear
                    delete state.booking_step;
                    delete state.proposed_datetime;
                    return `No problem! Feel free to reach out when you'd like to schedule a viewing. Is there anything else I can help you with?`;
                }

            default:
                delete state.booking_step;
                return `Let me know if you'd like to book a viewing!`;
        }
    }
}

module.exports = BookingAgent;