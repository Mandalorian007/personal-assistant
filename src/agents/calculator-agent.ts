import { z } from 'zod';
import OpenAI from 'openai';
import { BaseOpenAIAgent, ZodTool } from './base-openai-agent.js';

export class CalculatorAgent extends BaseOpenAIAgent {
  constructor(client: OpenAI) {
    const zodTools: ZodTool<any>[] = [
      {
        name: 'add',
        schema: z.object({
          a: z.number().describe('First number to add'),
          b: z.number().describe('Second number to add')
        }).describe('Add two numbers together'),
        implementation: ({ a, b }) => a + b
      },
      {
        name: 'subtract',
        schema: z.object({
          a: z.number().describe('Number to subtract from'),
          b: z.number().describe('Number to subtract')
        }).describe('Subtract the second number from the first number'),
        implementation: ({ a, b }) => a - b
      },
      {
        name: 'multiply',
        schema: z.object({
          a: z.number().describe('First number to multiply'),
          b: z.number().describe('Second number to multiply')
        }).describe('Multiply two numbers together'),
        implementation: ({ a, b }) => a * b
      },
      {
        name: 'divide',
        schema: z.object({
          a: z.number().describe('Number to divide'),
          b: z.number().describe('Number to divide by')
        }).describe('Divide the first number by the second number'),
        implementation: ({ a, b }) => {
          if (b === 0) throw new Error('Division by zero');
          return a / b;
        }
      }
    ];

    super(client, {
      name: 'Calculator',
      description: 'A mathematical agent that performs accurate and reliable calculations.',
      systemPrompt: `You are a highly accurate and fast calculator that will perform the calculations to the highest precision. All responses should be in plain text with no special formatting.`,
      zodTools
    });
  }
} 