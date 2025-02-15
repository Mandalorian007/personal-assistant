import { z } from 'zod';
import OpenAI from 'openai';
import { BaseOpenAIAgent, ZodTool } from './base-openai-agent.js';

export class InternetSearchAgent extends BaseOpenAIAgent {
  private perplexityClient: OpenAI;

  constructor(client: OpenAI) {
    const perplexityApiKey = process.env.PERPLEXITY_API_KEY;
    if (!perplexityApiKey) {
      throw new Error('PERPLEXITY_API_KEY environment variable is required');
    }

    const zodTools: ZodTool<any>[] = [
      {
        name: 'searchInternet',
        schema: z.object({
          query: z.string().describe('Search query to find information about'),
          detailed: z.boolean().optional().describe('Whether to return detailed results')
        }).required().describe('Search the internet for current information'),
        implementation: async ({ query, detailed = false }) => {
          return await this.performSearch(query, detailed);
        }
      }
    ];

    super(client, {
      name: 'Internet Search',
      description: 'An agent that can search the internet for current information',
      systemPrompt: `You are an internet search assistant that provides accurate and up-to-date information.
        Always cite sources when possible and indicate when information might be outdated.
        Present information in a clear, organized manner.`,
      zodTools
    });

    // Initialize Perplexity client using OpenAI's client
    this.perplexityClient = new OpenAI({
      apiKey: perplexityApiKey,
      baseURL: 'https://api.perplexity.ai'
    });
  }

  private async performSearch(query: string, detailed: boolean): Promise<any> {
    try {
      const response = await this.perplexityClient.chat.completions.create({
        model: 'sonar-pro',
        messages: [
          {
            role: 'system',
            content: detailed 
              ? 'Provide detailed information with multiple sources when available.'
              : 'Be precise and concise in your response.'
          },
          {
            role: 'user',
            content: query
          }
        ]
      });

      return {
        answer: response.choices[0].message.content,
        // @ts-ignore
        citations: response?.citations || [],
        model: 'sonar-pro',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Perplexity API error:', error);
      throw new Error('Failed to search the internet');
    }
  }
} 