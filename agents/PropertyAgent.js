// agents/PropertyAgent.js
const { db } = require('../services/firebase'); // Use our new Firebase service

class PropertyAgent {
    constructor(agentConfig) {
        this.config = agentConfig;
        console.log("[PropertyAgent] Initialized.");
    }

    // Helper function to format the results for WhatsApp
    #formatResults(properties) {
        if (properties.length === 0) {
            return "I'm sorry, I couldn't find any properties matching your search. Please try a different area or criteria.";
        }

        let response = `Based on your request, I found ${properties.length} properties for you:\n\n`;
        properties.slice(0, 5).forEach((prop, index) => {
            const price = new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', minimumFractionDigits: 0 }).format(prop.price);
            const specs = this.#getPropertySpecs(prop);

            response += `*${index + 1}. ${prop.title || 'Property Listing'}*\n`;
            response += `📍 Location: ${prop.address || 'N/A'}\n`;
            response += `💰 Price: ${price}\n`;
            if (specs) response += `🏠 Specs: ${specs}\n`;
            response += `🔗 View: ${prop.propertyUrl}\n\n`;
        });

        if (properties.length > 5) {
            response += `And ${properties.length - 5} more.`;
        }
        return response;
    }

    // Helper to build the specs string, copied from our dashboard
    #getPropertySpecs(prop) {
        if (prop.specs) return prop.specs;
        const parts = [];
        if (prop.bedrooms) parts.push(`${prop.bedrooms} Bed`);
        if (prop.bathrooms) parts.push(`${prop.bathrooms} Bath`);
        if (prop.garages) parts.push(`${prop.garages} Garage`);
        return parts.join(' | ');
    }


    async handleRequest(context) {
        const { messageBody } = context;
        console.log(`[PropertyAgent] Handling search request: "${messageBody}"`);
        
        // For now, we'll use a simple keyword search.
        const searchLocation = messageBody.replace(/show me houses in/i, '').trim().toLowerCase();

        try {
            const propertiesRef = db.collection('properties');
            const snapshot = await propertiesRef
                .where('agentId', '==', this.config.agentId)
                .where('suburb_lowercase', '==', searchLocation)
                .get();

            if (snapshot.empty) {
                console.log('No matching documents.');
                return "I'm sorry, I couldn't find any properties in that area. Please try another suburb.";
            }

            const foundProperties = [];
            snapshot.forEach(doc => {
                foundProperties.push(doc.data());
            });

            return this.#formatResults(foundProperties);

        } catch (error) {
            console.error("❌ ERROR in PropertyAgent handleRequest:", error);
            return "I'm sorry, I'm having trouble searching the property database right now.";
        }
    }
}

module.exports = PropertyAgent;