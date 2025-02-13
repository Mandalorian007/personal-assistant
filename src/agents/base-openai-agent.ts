import { z } from 'zod';
import OpenAI from 'openai';
import { AutoParseableTool } from 'openai/lib/parser.mjs';
import { createTool } from '../utils/zod-utils.js';

export interface ZodTool<T extends z.ZodObject<any>> {
  name: string;
  schema: T;
  implementation: (params: z.infer<T>) => Promise<any> | any;
}

export type AgentCapability = {
  name: string;
  description: string;
}

export type AgentSummary = {
  name: string;
  description: string;
  capabilities: AgentCapability[];
}

export type AgentConfig = {
  name: string;
  description: string;
  systemPrompt: string;
  zodTools: ZodTool<any>[];
}

export class BaseOpenAIAgent {
  protected client: OpenAI;
  protected config: AgentConfig;

  constructor(client: OpenAI, config: AgentConfig) {
    this.client = client;
    this.config = config;
  }

  public getAgentSummary(): AgentSummary {
    const tools = this.config.zodTools.map(tool => createTool({
      name: tool.name,
      schema: tool.schema,
      implementation: (params) => ({ result: tool.implementation(params) })
    }));

    return {
      name: this.config.name,
      description: this.config.description,
      capabilities: tools.map(tool => ({
        name: tool.type === 'function' ? tool.function.name : 'unknown',
        description: tool.type === 'function' ? (tool.function.description as string) : 'unknown'
      }))
    };
  }

  public async callAgent(input: string): Promise<string> {
    try {
      const tools = this.config.zodTools.map(tool => createTool({
        name: tool.name,
        schema: tool.schema,
        implementation: (params) => ({ result: tool.implementation(params) })
      }));

      const runner = this.client.beta.chat.completions
        .runTools({
          model: 'gpt-4',
          tools: tools as AutoParseableTool<any, true>[],
          messages: [
            { role: 'system', content: this.config.systemPrompt },
            { role: 'user', content: input }
          ],
        });

      const result = await runner.finalContent();
      return result ?? `${this.config.name} was unable to generate a response.`;
    } catch (error) {
      console.error(`Error in ${this.config.name}:`, error);
      throw new Error(`${this.config.name} encountered an error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public getTools(): ZodTool<any>[] {
    return this.config.zodTools;
  }
} 