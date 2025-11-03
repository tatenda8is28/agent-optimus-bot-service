// agents/main.js
const SalesAgent = require('./SalesAgent');
const PropertyAgent = require('./PropertyAgent');
const BookingAgent = require('./BookingAgent');
const MemoryTool = require('../tools/memory');
const LeadManager = require('../tools/LeadManager');

const { ChatOpenAI } = require("@langchain/openai");
const { z } = require("zod");

class MainAgent {
    constructor(agentConfig) {
        this.config = agentConfig;
        this.memoryTool = new MemoryTool();
        this.leadManager = new LeadManager();
        
        this.salesAgent = new SalesAgent(agentConfig);
        this.propertyAgent = new PropertyAgent(agentConfig);
        this.bookingAgent = new BookingAgent(agentConfig);

        const llm = new ChatOpenAI({ modelName: "gpt-3.5-turbo", temperature: 0 });

        const routerSchema = z.object({
            intent: z.enum([
                "sales_flow_inquiry", 
                "property_search", 
                "booking_request", 
                "knowledge_base_qa", 
                "general_chat"
            ]).describe("The user's primary intent based on their message."),
            confidence: z.number().min(0).max(1).describe("A confidence score from 0 to 1 on how sure you are about the intent."),
        }).describe("The routing decision for the user's message.");

        this.router = llm.withStructuredOutput(routerSchema, { name: "intent_router" });
    }

    async #getIntent(message, state) {
        if (state.sales_flow_step) { return 'sales_flow_inquiry'; }
        if (state.booking_step) { return 'booking_request'; }

        const prompt = `
You are an expert AI router for a real estate agent's assistant. Your job is to analyze the user's message and determine their primary intent.

Here are the possible intents:
- 'sales_flow_inquiry': The user is showing initial interest in a property. This is often indicated by sending a link (e.g., from property24.com or privateproperty.co.za) or a generic message like "I'm interested."
- 'property_search': The user is explicitly asking to find or see properties, often mentioning a location, price, or number of bedrooms. Example: "Show me houses in Klerksdorp" or "Do you have any 3-bedroom listings?"
- 'booking_request': The user wants to schedule, confirm, or ask about a viewing or appointment. Example: "Can I book a viewing for tomorrow?" or "When are you available?"
- 'knowledge_base_qa': The user is asking a specific question about real estate processes, the agent, or the area. Example: "What are transfer costs?" or "Which areas do you service?"
- 'general_chat': This is a fallback for simple greetings, acknowledgements, or messages where the intent is not clear. Example: "Hello", "Thanks", "ok".

Analyze the following user message and determine the most appropriate intent.

User Message: "${message}"`;

        console.log(`[MainAgent] Routing message: "${message}"`);
        const result = await this.router.invoke(prompt);
        console.log(`[MainAgent] Router output:`, result);
        
        if (result.confidence < 0.7) {
            console.log(`[MainAgent] Low confidence score. Defaulting to general_chat.`);
            return 'general_chat';
        }

        return result.intent;
    }

    async handleRequest(context) {
        const { messageBody, contactName, chatId } = context;
        const state = await this.memoryTool.getOrCreateState(chatId);
        context.state = state;
        context.agentConfig = this.config;

        let response = '';
        const intent = await this.#getIntent(messageBody, state);
        console.log(`[MainAgent] Determined Intent for ${chatId}: ${intent}`);

        switch (intent) {
            case 'sales_flow_inquiry':
                response = await this.salesAgent.handleRequest(context);
                break;
            case 'property_search':
                response = await this.propertyAgent.handleRequest(context);
                break;
            case 'booking_request':
                response = await this.bookingAgent.handleRequest(context);
                break;
            case 'knowledge_base_qa':
                response = `I'm sorry, my ability to answer general questions is still under development. I can currently help you with property inquiries and bookings.`;
                break;
            default: // general_chat
                response = `Hi ${contactName}! I'm Optimus, the AI assistant for ${this.config.fullName}. You can ask me to find properties, inquire about a listing, or schedule a viewing. How can I help?`;
        }
        
        if (response) {
            await this.leadManager.logInteraction(context, response);
        }
        
        if (state.sales_flow_step || state.booking_step) {
            await this.memoryTool.saveState(chatId, state);
        } else {
            await this.memoryTool.clearState(chatId);
        }
        return response;
    }
}

module.exports = MainAgent;