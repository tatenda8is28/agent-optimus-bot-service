// tools/LeadManager.js (FIXED - NO DUPLICATES)
const { db, admin } = require('../services/firebase');

class LeadManager {
    
    // Find existing lead by contact number
    async #findLeadByContact(agentId, contactNumber) {
        try {
            const leadsRef = db.collection('leads');
            const snapshot = await leadsRef
                .where('agentId', '==', agentId)
                .where('contact', '==', contactNumber)
                .limit(1)
                .get();

            if (!snapshot.empty) {
                const doc = snapshot.docs[0];
                console.log(`[LeadManager] ✅ Found existing lead: ${doc.id}`);
                return doc.id;
            }
            
            return null;
        } catch (error) {
            console.error('[LeadManager] ❌ Error finding lead:', error);
            return null;
        }
    }

    // Create new lead
    async #createLead(agentId, contactName, contactNumber, initialMessage, status = 'New Inquiry') {
        const { v4: uuidv4 } = require('uuid');
        const leadId = uuidv4();
        
        const leadData = {
            agentId: agentId,
            name: contactName,
            contact: contactNumber,
            status: status,
            conversationMode: 'ai',      // Default to AI handling
            takenOverBy: null,
            takenOverAt: null,
            createdAt: admin.firestore.Timestamp.now(),
            lastContactAt: admin.firestore.Timestamp.now(),
            conversation: [
                { 
                    role: 'user', 
                    content: initialMessage, 
                    timestamp: admin.firestore.Timestamp.now() 
                }
            ]
        };
        
        await db.collection('leads').doc(leadId).set(leadData);
        console.log(`[LeadManager] ✅ Created new lead profile with ID: ${leadId}`);
        return leadId;
    }

    // Main logging function
    async logInteraction(context, botResponse) {
        const { agentConfig, messageBody, contactName, chatId, state } = context;
        
        // Extract contact number from WhatsApp chat ID
        const contactNumber = chatId.split('@')[0];

        // Check if lead already exists
        let leadId = await this.#findLeadByContact(agentConfig.agentId, contactNumber);

        if (!leadId) {
            // FIRST INTERACTION - Create new lead
            leadId = await this.#createLead(
                agentConfig.agentId, 
                contactName, 
                contactNumber, 
                messageBody
            );
            state.lead_id = leadId;
            
            // Log bot response
            await db.collection('leads').doc(leadId).update({
                conversation: admin.firestore.FieldValue.arrayUnion(
                    { 
                        role: 'assistant', 
                        content: botResponse, 
                        timestamp: admin.firestore.Timestamp.now() 
                    }
                ),
                lastContactAt: admin.firestore.Timestamp.now()
            });
        } else {
            // SUBSEQUENT INTERACTIONS - Update existing lead
            state.lead_id = leadId;
            
            await db.collection('leads').doc(leadId).update({
                conversation: admin.firestore.FieldValue.arrayUnion(
                    { 
                        role: 'user', 
                        content: messageBody, 
                        timestamp: admin.firestore.Timestamp.now() 
                    },
                    { 
                        role: 'assistant', 
                        content: botResponse, 
                        timestamp: admin.firestore.Timestamp.now() 
                    }
                ),
                lastContactAt: admin.firestore.Timestamp.now()
            });
        }
        
        console.log(`[LeadManager] ✅ Logged interaction for lead ${leadId}`);
    }

    // Update lead qualification data
    async updateLeadData(leadId, updateData) {
        try {
            await db.collection('leads').doc(leadId).update({
                ...updateData,
                lastContactAt: admin.firestore.Timestamp.now()
            });
            console.log(`[LeadManager] ✅ Updated lead ${leadId} with data:`, Object.keys(updateData));
        } catch (error) {
            console.error(`[LeadManager] ❌ Error updating lead ${leadId}:`, error);
        }
    }
}

module.exports = LeadManager;