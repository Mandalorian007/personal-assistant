import { z } from 'zod';
import OpenAI from 'openai';
import { BaseOpenAIAgent, ZodTool } from './base-openai-agent.js';
import { GoogleAuthService } from '../services/google-auth.js';
import { google, gmail_v1 } from 'googleapis';

interface EmailSummary {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  to: string[];
  date: string;
  snippet: string;
}

interface EmailMessage extends EmailSummary {
  body: string;
}

interface EmailSummaryResponse {
  count: number;
  emails: {
    id: string;
    subject: string;
    from: string;
    date: string;
    snippet: string;
  }[];
}

interface DraftEmail {
  to: string[];
  subject: string;
  body: string;
  isHTML?: boolean;
}

export class GmailAgent extends BaseOpenAIAgent {
  private gmailService!: gmail_v1.Gmail;

  constructor(client: OpenAI) {
    const zodTools: ZodTool<any>[] = [
      {
        name: 'searchEmails',
        schema: z.object({
          query: z.string().describe('Gmail search query (e.g., "from:john subject:meeting")'),
          maxResults: z.number().optional().describe('Maximum number of results to return (default: 10)')
        }).required().describe('Search for emails using Gmail search syntax'),
        implementation: async ({ query, maxResults = 10 }) => {
          const emails = await this.searchEmails(query, maxResults);
          if (emails.length === 0) {
            throw new Error('No emails found matching your search');
          }
          return {
            count: emails.length,
            emails: emails.map(email => ({
              id: email.id,
              subject: email.subject,
              from: email.from,
              date: email.date,
              snippet: email.snippet
            }))
          } satisfies EmailSummaryResponse;
        }
      },
      {
        name: 'getEmailDetails',
        schema: z.object({
          messageId: z.string().describe('Gmail message ID to fetch')
        }).required().describe('Get full details of a specific email'),
        implementation: async ({ messageId }) => {
          return await this.getEmailDetails(messageId);
        }
      },
      {
        name: 'createDraft',
        schema: z.object({
          to: z.array(z.string()).describe('List of recipient email addresses'),
          subject: z.string().describe('Email subject line'),
          body: z.string().describe('Email content'),
          format: z.enum(['plain', 'html']).describe('Email format: "plain" for text, "html" for formatted')
        }).strict().required(),
        implementation: async ({ to, subject, body, format }) => {
          // Validate email addresses
          const validEmails = to.filter((addr: string) => addr.includes('@'));
          if (validEmails.length === 0) {
            throw new Error('No valid email addresses provided. Please provide email addresses in the format: user@domain.com');
          }

          const draft = await this.createDraft({
            to: validEmails,
            subject,
            body,
            isHTML: format === 'html'
          });

          return {
            message: 'Draft created successfully',
            draft: {
              id: draft.id,
              subject: draft.subject,
              to: draft.to.join(', ')
            }
          };
        }
      }
    ];

    super(client, {
      name: 'Gmail',
      description: 'A Gmail agent that can search, read, and draft emails',
      systemPrompt: `You are a helpful Gmail assistant that can search, read, and draft emails.
        
        Usage patterns:
        1. First search for emails:
           - Use searchEmails with queries like "from:john" or "subject:meeting"
           - Returns brief summaries including subject, sender, and preview
           - IMPORTANT: Save the message IDs for getting full content
        
        2. Then get full content if needed:
           - Use getEmailDetails with the message ID from the search results
           - Only fetch full content when user wants to read an email
        
        When summarizing search results:
        1. Keep track of message IDs
        2. Present emails with numbers for easy reference
        3. Include sender, subject, and date
        
        For drafting emails:
        - Recipient email addresses must be in proper format (user@domain.com)
        - First find contact's email using findContact if only name is given
        - Use clear, professional formatting
        - Support both plain text and HTML formats
        
        Example:
        1. Find contact: "Find email for John Smith"
        2. Draft email: "Draft email to john.smith@example.com"`,
      zodTools
    });

    this.initializeGmail();
  }

  private async initializeGmail() {
    try {
      const authService = GoogleAuthService.getInstance();
      const auth = await authService.getAuthenticatedClient();
      this.gmailService = google.gmail({ version: 'v1', auth });
    } catch (error) {
      console.error('Failed to initialize Gmail service:', error);
      throw error;
    }
  }

  private async searchEmails(query: string, maxResults: number = 10): Promise<EmailSummary[]> {
    try {
      const response = await this.gmailService.users.messages.list({
        userId: 'me',
        q: query,
        maxResults
      });

      const messages = response.data.messages || [];
      return await Promise.all(
        messages.map(async message => {
          const summary = await this.gmailService.users.messages.get({
            userId: 'me',
            id: message.id!,
            format: 'metadata',
            metadataHeaders: ['Subject', 'From', 'To', 'Date']
          });

          const headers = summary.data.payload?.headers || [];
          const getHeader = (name: string) => 
            headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value;

          return {
            id: summary.data.id!,
            threadId: summary.data.threadId!,
            subject: getHeader('subject') || '(no subject)',
            from: getHeader('from') || '',
            to: (getHeader('to') || '').split(',').map(e => e.trim()),
            date: getHeader('date') || '',
            snippet: summary.data.snippet || ''
          };
        })
      );
    } catch (error) {
      console.error('Failed to search emails:', error);
      throw error;
    }
  }

  private async getEmailDetails(messageId: string): Promise<EmailMessage> {
    try {
      const response = await this.gmailService.users.messages.get({
        userId: 'me',
        id: messageId,
        format: 'full'
      });

      const message = response.data;
      const headers = message.payload?.headers || [];
      const getHeader = (name: string) => headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value;

      // Parse email body
      let body = '';
      if (message.payload?.body?.data) {
        body = Buffer.from(message.payload.body.data, 'base64').toString('utf-8');
      } else if (message.payload?.parts) {
        // Handle multipart messages
        const textPart = message.payload.parts.find(part => 
          part.mimeType === 'text/plain' || part.mimeType === 'text/html'
        );
        if (textPart?.body?.data) {
          body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
        }
      }

      return {
        id: message.id!,
        threadId: message.threadId!,
        subject: getHeader('subject') || '(no subject)',
        from: getHeader('from') || '',
        to: (getHeader('to') || '').split(',').map(e => e.trim()),
        date: getHeader('date') || '',
        snippet: message.snippet || '',
        body
      };
    } catch (error) {
      console.error('Failed to get email details:', error);
      throw error;
    }
  }

  private async createDraft(draft: DraftEmail): Promise<EmailMessage> {
    try {
      // Create email content
      const email: gmail_v1.Schema$Message = {
        raw: await this.createRawEmail(draft)
      };

      // Create the draft
      const response = await this.gmailService.users.drafts.create({
        userId: 'me',
        requestBody: {
          message: email
        }
      });

      // Get the created draft details
      const draftDetails = await this.gmailService.users.drafts.get({
        userId: 'me',
        id: response.data.id!,
        format: 'full'
      });

      return this.formatEmailFromDraft(draftDetails.data);
    } catch (error) {
      console.error('Failed to create draft:', error);
      throw error;
    }
  }

  private async createRawEmail(draft: DraftEmail): Promise<string> {
    // Validate email addresses
    const validEmails = draft.to.filter((addr: string) => addr.includes('@'));
    if (validEmails.length === 0) {
      throw new Error('Invalid email address format');
    }

    const headers = [
      `To: ${validEmails.join(', ')}`,
      'From: me',
      `Subject: ${draft.subject}`,
      `Content-Type: ${draft.isHTML ? 'text/html' : 'text/plain'}; charset=utf-8`,
      'MIME-Version: 1.0'
    ].join('\r\n');

    let body = draft.body;
    if (draft.isHTML) {
      // Ensure proper HTML structure
      if (!body.includes('<html>')) {
        body = `
          <html>
            <head>
              <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; }
                p { margin: 1em 0; }
                ul, ol { margin: 1em 0; padding-left: 2em; }
                h1, h2, h3 { color: #333; }
              </style>
            </head>
            <body>
              ${body}
            </body>
          </html>
        `;
      }
    }

    const emailContent = `${headers}\r\n\r\n${body}`;
    return Buffer.from(emailContent).toString('base64url');
  }

  private formatEmailFromDraft(draft: gmail_v1.Schema$Draft): EmailMessage {
    const message = draft.message!;
    const headers = message.payload?.headers || [];
    const getHeader = (name: string) => 
      headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value;

    return {
      id: message.id!,
      threadId: message.threadId!,
      subject: getHeader('subject') || '(no subject)',
      from: getHeader('from') || '',
      to: (getHeader('to') || '').split(',').map(e => e.trim()),
      date: getHeader('date') || '',
      snippet: message.snippet || '',
      body: this.getEmailBody(message)
    };
  }

  private getEmailBody(message: gmail_v1.Schema$Message): string {
    if (message.payload?.body?.data) {
      return Buffer.from(message.payload.body.data, 'base64').toString('utf-8');
    }
    
    if (message.payload?.parts) {
      const textPart = message.payload.parts.find(part => 
        part.mimeType === 'text/plain' || part.mimeType === 'text/html'
      );
      if (textPart?.body?.data) {
        return Buffer.from(textPart.body.data, 'base64').toString('utf-8');
      }
    }
    
    return '';
  }
} 