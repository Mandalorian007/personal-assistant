import { GoogleAuthService } from '../services/google-auth.js';
import dotenv from 'dotenv';

dotenv.config();

async function testAuth() {
  try {
    const authService = GoogleAuthService.getInstance();
    await authService.getAuthenticatedClient();
    console.log('Authentication successful!');
  } catch (error) {
    console.error('Authentication failed:', error);
  }
}

testAuth(); 