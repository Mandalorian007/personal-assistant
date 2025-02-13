import { OAuth2Client } from 'google-auth-library';
import * as fs from 'fs/promises';
import * as path from 'path';
import http from 'http';
import open from 'open';

export class GoogleAuthService {
  private static instance: GoogleAuthService;
  private oauth2Client: OAuth2Client;
  private readonly TOKEN_PATH = path.join(process.cwd(), 'secrets', 'google-token.json');
  private readonly CREDENTIALS_PATH = path.join(process.cwd(), 'secrets', 'client_secret_129981005260-p4tt46huvnt8rjkbn1kfqmg9isavni9g.apps.googleusercontent.com.json');

  private constructor() {
    this.oauth2Client = new OAuth2Client();
  }

  public static getInstance(): GoogleAuthService {
    if (!GoogleAuthService.instance) {
      GoogleAuthService.instance = new GoogleAuthService();
    }
    return GoogleAuthService.instance;
  }

  async getAuthenticatedClient(): Promise<OAuth2Client> {
    const credentials = JSON.parse(
      await fs.readFile(this.CREDENTIALS_PATH, 'utf-8')
    );

    this.oauth2Client = new OAuth2Client({
      clientId: credentials.installed.client_id,
      clientSecret: credentials.installed.client_secret,
      redirectUri: 'http://localhost:3000/oauth2callback',
    });

    try {
      const token = JSON.parse(await fs.readFile(this.TOKEN_PATH, 'utf-8'));
      this.oauth2Client.setCredentials(token);
    } catch (error) {
      const tokens = await this.getNewToken();
      this.oauth2Client.setCredentials(tokens);
      await fs.writeFile(this.TOKEN_PATH, JSON.stringify(tokens));
    }

    return this.oauth2Client;
  }

  private async getNewToken(): Promise<any> {
    const SCOPES = [
      'https://www.googleapis.com/auth/contacts',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/drive.file',
      'profile'
    ];

    return new Promise((resolve, reject) => {
      // Create server to handle OAuth callback
      const server = http.createServer(async (req, res) => {
        try {
          if (req.url?.startsWith('/oauth2callback')) {
            const code = new URL(req.url, 'http://localhost:3000').searchParams.get('code');
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end('Authentication successful! You can close this window.');
            server.close();

            if (code) {
              const { tokens } = await this.oauth2Client.getToken(code);
              resolve(tokens);
            }
          }
        } catch (e) {
          reject(e);
        }
      }).listen(3000);

      // Generate auth url and open browser
      const authUrl = this.oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: SCOPES,
        prompt: 'consent'
      });

      open(authUrl);
      console.log('Opening browser for authentication...');
    });
  }

  public async generateAuthUrl(): Promise<string> {
    // Read and set up credentials first
    const credentials = JSON.parse(
      await fs.readFile(this.CREDENTIALS_PATH, 'utf-8')
    );

    this.oauth2Client = new OAuth2Client({
      clientId: credentials.installed.client_id,
      clientSecret: credentials.installed.client_secret,
      redirectUri: credentials.installed.redirect_uris[0],
    });

    const SCOPES = [
      'https://www.googleapis.com/auth/contacts',
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/documents',
      'https://www.googleapis.com/auth/drive',
      'https://www.googleapis.com/auth/drive.file',
      'profile'
    ];

    return this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      prompt: 'consent'  // Always show consent screen
    });
  }
} 