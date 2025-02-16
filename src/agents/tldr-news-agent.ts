import { z } from 'zod';
import OpenAI from 'openai';
import { BaseOpenAIAgent, ZodTool } from './base-openai-agent.js';

export class TLDRNewsAgent extends BaseOpenAIAgent {
  private baseUrl = 'https://r.jina.ai/https://tldr.tech/tech/';

  constructor(client: OpenAI) {
    const today = new Date();
    const currentDay = today.toLocaleDateString('en-US', { weekday: 'long' });
    const currentDate = today.toISOString().split('T')[0];

    const zodTools: ZodTool<any>[] = [
      {
        name: 'getTLDRNews',
        schema: z.object({
          year: z.number().describe('Year between 2020-2030 (e.g., 2025)'),
          month: z.number().describe('Month number between 1-12'),
          day: z.number().describe('Day of month between 1-31'),
        }).describe('Get TLDR news for a specific date'),
        implementation: async ({ year, month, day }) => {
          const requestDate = new Date(year, month - 1, day);
          const dayOfWeek = requestDate.getDay(); // 0 = Sunday, 6 = Saturday
          
          // Shift weekend dates to Friday
          if (dayOfWeek === 0) { // Sunday
            requestDate.setDate(requestDate.getDate() - 2);
          } else if (dayOfWeek === 6) { // Saturday
            requestDate.setDate(requestDate.getDate() - 1);
          }
          
          const dateString = requestDate.toISOString().split('T')[0];
          const originalDateString = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
          
          try {
            const response = await fetch(`${this.baseUrl}${dateString}`);
            const content = response.ok ? await response.text() : `No tech news available for ${dateString}`;
            
            // Add context for weekend dates
            const prefix = (dayOfWeek === 0 || dayOfWeek === 6) 
              ? `Note: Showing Friday's (${dateString}) news for ${originalDateString} due to weekend.\n\n`
              : '';
            
            return {
              date: dateString,
              content: prefix + content,
              source: 'tldr.tech'
            };
          } catch (error) {
            return {
              date: dateString,
              content: `No tech news available for ${dateString}`,
              source: 'tldr.tech'
            };
          }
        }
      }
    ];

    super(client, {
      name: 'TLDR News',
      description: 'Provides TLDR tech news summaries from TLDR Tech, handling requests like "today\'s tldr news" or "Friday\'s tldr updates"',
      systemPrompt: `You are a tech news assistant that provides daily summaries from TLDR Tech.

        Current Context:
        - Today's Date: ${currentDate}
        - Day of Week: ${currentDay}
        
        Focus on presenting the news clearly and concisely, highlighting the most important tech developments.`,
      zodTools
    });
  }
} 