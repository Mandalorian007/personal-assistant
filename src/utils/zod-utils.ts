import { ZodSchema } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { ChatCompletionTool } from 'openai/resources/chat/completions.mjs';
import { AutoParseableTool, makeParseableTool } from 'openai/lib/parser.mjs';

export function createTool<T extends object>({
  name,
  schema,
  implementation,
}: {
  name: string;
  schema: ZodSchema<T>;
  implementation: (args: T) => Promise<object> | object;
}): AutoParseableTool<any> {
  return makeParseableTool({
    type: 'function',
    function: {
      name,
      description: schema.description,
      parameters: zodToJsonSchema(schema),
    }
  }, {
    parser: (input: string) => {
      const parsed = JSON.parse(input);
      return schema.parse(parsed);
    },
    callback: implementation
  });
}