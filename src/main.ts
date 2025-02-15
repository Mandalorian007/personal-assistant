import TelegramBot from 'node-telegram-bot-api';
import { config } from 'dotenv';
import { PersonalAssistant } from './personal-assistant.js';
import OpenAI from 'openai';
import fs from 'fs';
import path from 'path';
import { pipeline } from 'stream/promises';
import { createWriteStream } from 'fs';
import { fileURLToPath } from 'url';

config();

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TELEGRAM_TOKEN) {
  throw new Error('TELEGRAM_BOT_TOKEN must be provided in environment');
}

const openai = new OpenAI();
const assistant = new PersonalAssistant(openai);
const bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true });

// Create temp directory for downloaded files
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = path.join(__dirname, '..', 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR);
}

async function downloadFile(fileId: string, extension: string = ''): Promise<string> {
  const file = await bot.getFile(fileId);
  const filePath = path.join(TEMP_DIR, `${fileId}${extension}`);
  const fileStream = createWriteStream(filePath);
  
  await pipeline(
    (await fetch(`https://api.telegram.org/file/bot${TELEGRAM_TOKEN}/${file.file_path}`)).body!,
    fileStream
  );
  
  return filePath;
}

async function transcribeAudio(filePath: string): Promise<string> {
  const transcription = await openai.audio.transcriptions.create({
    file: fs.createReadStream(filePath),
    model: 'whisper-1',
    language: 'en'
  });
  
  fs.unlinkSync(filePath);
  return transcription.text;
}

async function analyzeImage(filePath: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: [
          { 
            type: "text", 
            text: "Provide: 1) Any text visible in the image, and 2) A concise description of the visual content. Format as 'Text: [extracted text] | Visual: [description]'. If no text is present, indicate 'No text found'." 
          },
          {
            type: "image_url",
            image_url: {
              url: `data:image/${path.extname(filePath).slice(1)};base64,${fs.readFileSync(filePath).toString('base64')}`
            }
          }
        ],
      },
    ],
    max_tokens: 500,
  });

  fs.unlinkSync(filePath);
  return response.choices[0].message.content || "Unable to analyze image";
}

async function extractDocumentText(filePath: string): Promise<string> {
  // Basic text extraction for common file types
  const ext = path.extname(filePath).toLowerCase();
  let content = '';
  
  try {
    if (['.txt', '.md', '.json', '.csv'].includes(ext)) {
      content = fs.readFileSync(filePath, 'utf-8');
    } else {
      content = `[File uploaded: ${path.basename(filePath)}]`;
    }
  } catch (error) {
    console.error('Error reading file:', error);
    content = '[Error reading file content]';
  }
  
  fs.unlinkSync(filePath);
  return content;
}

// Handle messages
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    // Handle voice messages
    if (msg.voice) {
      await bot.sendMessage(chatId, '🎧 Processing your voice message...');
      const filePath = await downloadFile(msg.voice.file_id, '.ogg');
      const transcription = await transcribeAudio(filePath);
      
      await bot.sendMessage(chatId, `📝 Transcription: "${transcription}"\n\nProcessing your request...`);
      
      const response = await assistant.process(
        `[Voice Transcription] ${transcription}\n\nNote: This is a transcribed voice message. Please verify any names, dates, or specific details that might have been misheard.`
      );
      
      if (response.includes('I encountered an issue:')) {
        await bot.sendMessage(chatId, `❌ ${response}`);
      } else {
        await bot.sendMessage(chatId, response);
      }
      return;
    }
    
    // Handle images
    if (msg.photo) {
      await bot.sendMessage(chatId, '🖼️ Analyzing image...');
      const photo = msg.photo[msg.photo.length - 1];
      const file = await bot.getFile(photo.file_id);
      const ext = path.extname(file.file_path || '.jpg');
      const filePath = await downloadFile(photo.file_id, ext);
      const analysis = await analyzeImage(filePath);
      
      const userMessage = msg.caption || 'What do you see in this image?';
      const response = await assistant.process(
        `[Image Context] ${analysis}\n\nUser's message: ${userMessage}`
      );
      
      await bot.sendMessage(chatId, response);
      return;
    }
    
    // Handle documents
    if (msg.document) {
      await bot.sendMessage(chatId, '📄 Processing document...');
      const filePath = await downloadFile(msg.document.file_id, path.extname(msg.document.file_name || ''));
      const content = await extractDocumentText(filePath);
      
      const userMessage = msg.caption || 'What do you think about this document?';
      const response = await assistant.process(
        `[Document Content] ${content}\n\nUser's message: ${userMessage}`
      );
      
      await bot.sendMessage(chatId, response);
      return;
    }
    
    // Handle text messages
    if (msg.text) {
      const response = await assistant.process(msg.text);
      await bot.sendMessage(chatId, response);
      return;
    }
    
    // Unsupported message type
    await bot.sendMessage(chatId, 'Sorry, I can only process text, voice messages, images, and documents.');
    
  } catch (error) {
    console.error('Error processing message:', error);
    await bot.sendMessage(
      chatId,
      '❌ I encountered an unexpected error. Please try again or rephrase your request.'
    );
  }
});

// Error handling
bot.on('error', (error) => {
  console.error('Telegram bot error:', error);
});

bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

console.log('Telegram bot is running...'); 