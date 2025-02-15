import OpenAI from 'openai';
import { CalculatorAgent } from './agents/calculator-agent.js';
import { BaseOpenAIAgent, AgentSummary } from './agents/base-openai-agent.js';
import { createTool } from './utils/zod-utils.js';
import { AutoParseableTool } from 'openai/lib/parser.mjs';
import { WeatherAgent } from './agents/weather-agent.js';
import { CalendarAgent } from './agents/calendar-agent.js';
import { ContactsAgent } from './agents/contacts-agent.js';
import { GmailAgent } from './agents/gmail-agent.js';
import { InternetSearchAgent } from './agents/internet-search-agent.js';
import { GoogleDocsAgent } from './agents/google-docs-agent.js';
import { FileManagementAgent } from './agents/file-management-agent.js';
import { TranslationAgent } from './agents/translation-agent.js';

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export class PersonalAssistant extends BaseOpenAIAgent {
  private agents: BaseOpenAIAgent[];
  private agentTools: AutoParseableTool<any>[];
  private messageHistory: ChatMessage[] = [];

  constructor(client: OpenAI) {
    const agents = [
      new CalculatorAgent(client),
      new WeatherAgent(client),
      new CalendarAgent(client),
      new ContactsAgent(client),
      new GmailAgent(client),
      new InternetSearchAgent(client),
      new GoogleDocsAgent(client),
      new FileManagementAgent(client),
      new TranslationAgent(client),
    ];

    const agentTools = agents.flatMap(agent => agent.getTools().map(tool => createTool(tool)));
    const currentDate = new Date().toLocaleString();

    super(client, {
      name: 'Personal Assistant',
      description: 'A coordinator that understands user needs and delegates to specialized agents',
      systemPrompt: `You are Mei, an intelligent AI assistant that coordinates with specialized agents to solve user problems.
        
        About you:
        - Your name is Mei
        - You are friendly, professional, and efficient
        - You communicate clearly and concisely
        - You take initiative to help solve problems
        
        Before responding, carefully consider:
        1. What is the user really trying to accomplish?
        2. Which agent(s) have the capabilities needed?
        3. How to break down complex requests into steps for the agents to handle?
        
        When dealing with people's names:
        - Always use findContact first to get accurate contact details
        - Use the resolved email address for any further operations
        - Handle cases where multiple matches are found
        
        Example workflow:
        User: "Email Dani about dinner tonight"
        Mei's steps:
        1. Use findContact to get Dani's details
        2. Use the returned email address to create the draft
        3. Confirm the action with the user
        
        For email operations:
        1. Resolve contact details first
        2. Use proper email formatting
        3. Handle any ambiguity in contact matching
        
        Always explain what actions you took and the results clearly to the user.
        
        Current date and time: ${currentDate}
        The user's name is Matthew Fontana, but generally goes by Matt in most situations.`,
      zodTools: []
    });

    this.agents = agents;
    this.agentTools = agentTools;

    this.messageHistory = [{
      role: 'system',
      content: this.config.systemPrompt
    }];
  }

  public getAvailableAgents(): AgentSummary[] {
    return this.agents.map(agent => agent.getAgentSummary());
  }

  public async process(input: string): Promise<string> {
    try {
      const response = await this.callAgent(input);
      
      if (!response.success && response.error) {
        // Try to handle common errors
        switch (response.error.code) {
          case 'FileNotFoundError':
            return `I couldn't find that file. Please check if it exists and try again.`;
          case 'PermissionError':
            return `I don't have permission to perform that action. Please check your permissions and try again.`;
          default:
            return `I encountered an issue: ${response.error.message}. Would you like me to try a different approach?`;
        }
      }

      return response.content;
    } catch (error) {
      console.error('Error in personal assistant:', error);
      return "I apologize, but I encountered an unexpected error. Please try rephrasing your request or try again later.";
    }
  }

  public getMessageHistory(): ChatMessage[] {
    return this.messageHistory;
  }

  public clearHistory(): void {
    this.messageHistory = [{
      role: 'system',
      content: this.config.systemPrompt
    }];
  }
} 