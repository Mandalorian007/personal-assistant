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

// Create temp directory for audio files
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP_DIR = path.join(__dirname, '..', 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR);
}

async function downloadAudio(fileId: string): Promise<string> {
  const file = await bot.getFile(fileId);
  const filePath = path.join(TEMP_DIR, `${fileId}.ogg`);
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
  
  // Clean up temp file
  fs.unlinkSync(filePath);
  
  return transcription.text;
}

// Handle text messages
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  
  try {
    // Handle voice messages
    if (msg.voice) {
      await bot.sendMessage(chatId, '🎧 Processing your voice message...');
      
      const filePath = await downloadAudio(msg.voice.file_id);
      const transcription = await transcribeAudio(filePath);
      
      await bot.sendMessage(chatId, `📝 Transcription: "${transcription}"\n\nProcessing your request...`);
      
      const response = await assistant.process(
        `[Voice Transcription] ${transcription}\n\nNote: This is a transcribed voice message. Please verify any names, dates, or specific details that might have been misheard.`
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
    await bot.sendMessage(chatId, 'Sorry, I can only process text and voice messages.');
    
  } catch (error) {
    console.error('Error processing message:', error);
    await bot.sendMessage(
      chatId,
      'Sorry, I encountered an error processing your message. Please try again.'
    );
  }
});

// Handle errors
bot.on('error', (error) => {
  console.error('Telegram bot error:', error);
});

// Start message
bot.on('polling_error', (error) => {
  console.error('Polling error:', error);
});

console.log('Telegram bot is running...'); 