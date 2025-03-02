import readline from 'readline';
import { PersonalAssistant } from './personal-assistant.js';
import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

async function startCLI() {
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
  });

  const assistant = new PersonalAssistant(openai);

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log('Personal Assistant CLI (Type "exit" to quit, "clear" to clear history)\n');

  const promptUser = () => {
    rl.question('You: ', async (input) => {
      if (input.toLowerCase() === 'exit') {
        rl.close();
        return;
      }

      if (input.toLowerCase() === 'clear') {
        assistant.clearHistory();
        console.log('Conversation history cleared.');
        promptUser();
        return;
      }

      try {
        const response = await assistant.process(input);
        if (response.includes('I encountered an issue:')) {
          console.log('\n❌ Assistant:', response, '\n');
        } else {
          console.log('\n💬 Assistant:', response, '\n');
        }
      } catch (error) {
        console.error('\n❌ Error:', 'Something went wrong. Please try again.', '\n');
      }

      promptUser();
    });
  };

  promptUser();
}

startCLI().catch(console.error); 