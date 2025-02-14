import { z } from 'zod';
import OpenAI from 'openai';
import { BaseOpenAIAgent, ZodTool } from './base-openai-agent.js';

export class TranslationAgent extends BaseOpenAIAgent {
  constructor(client: OpenAI) {
    const zodTools: ZodTool<any>[] = [
      {
        name: 'translate',
        schema: z.object({
          text: z.string().describe('Text to translate'),
          targetLanguage: z.string().describe('Target language for translation'),
          preserveFormatting: z.boolean().optional().describe('Whether to preserve text formatting')
        }).required().describe('Translate text between languages'),
        implementation: async (args) => this.performTranslation(args)
      }
    ];

    super(client, {
      name: 'Translation',
      description: 'An agent that provides accurate language translation services',
      systemPrompt: `You are a translation assistant focused on accurate and natural-sounding translations.
        Always identify the source language and include it in your response.
        Preserve the original meaning, tone, and context while adapting to target language conventions.
        When uncertain, prioritize clarity over literal translation.`,
      zodTools
    });
  }

  private async performTranslation({ 
    text, 
    targetLanguage, 
    preserveFormatting = true 
  }: { 
    text: string; 
    targetLanguage: string; 
    preserveFormatting?: boolean;
  }): Promise<any> {
    try {
      const response = await this.client.chat.completions.create({
        model: 'gpt-3.5-turbo',
        temperature: 0.2,
        messages: [
          {
            role: 'system',
            content: `You are a precise translator${preserveFormatting ? ' that preserves text formatting' : ''}.
              Translate to ${targetLanguage} and start your response with "Translated from [detected language]:".
              Maintain the original meaning and context.`
          },
          {
            role: 'user',
            content: text
          }
        ]
      });

      return {
        translation: response.choices[0].message.content,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Translation error:', error);
      throw new Error('Failed to translate text');
    }
  }
} 