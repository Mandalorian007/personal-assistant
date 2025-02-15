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

export type AgentResponse = {
  success: boolean;
  content: string;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
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

  public async callAgent(input: string): Promise<AgentResponse> {
    try {
      const tools = this.config.zodTools.map(tool => createTool({
        name: tool.name,
        schema: tool.schema,
        implementation: async (params) => {
          try {
            return { result: await tool.implementation(params) };
          } catch (error) {
            return {
              error: {
                code: error instanceof Error ? error.name : 'TOOL_ERROR',
                message: error instanceof Error ? error.message : String(error),
                details: error
              }
            };
          }
        }
      }));

      const runner = this.client.beta.chat.completions
        .runTools({
          model: 'gpt-4o',
          tools: tools as AutoParseableTool<any, true>[],
          messages: [
            { role: 'system', content: this.config.systemPrompt },
            { role: 'user', content: input }
          ],
        });

      const result = await runner.finalContent();
      return {
        success: true,
        content: result ?? `${this.config.name} was unable to generate a response.`
      };
    } catch (error) {
      console.error(`Error in ${this.config.name}:`, error);
      return {
        success: false,
        content: `${this.config.name} encountered an error.`,
        error: {
          code: error instanceof Error ? error.name : 'AGENT_ERROR',
          message: error instanceof Error ? error.message : String(error),
          details: error
        }
      };
    }
  }

  public getTools(): ZodTool<any>[] {
    return this.config.zodTools;
  }
} 