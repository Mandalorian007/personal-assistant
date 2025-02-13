import { z } from 'zod';
import OpenAI from 'openai';
import { BaseOpenAIAgent, ZodTool } from './base-openai-agent.js';
import { GoogleAuthService } from '../services/google-auth.js';
import { google, docs_v1, drive_v3 } from 'googleapis';

interface DocContent {
  title: string;
  content: string;
}

interface DocUpdate {
  documentId: string;
  content: string;
}

interface DocSearchResult {
  id: string;
  name: string;
  link: string;
  lastModified: string;
}

interface MarkdownStyle {
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
  link?: string;
  code?: boolean;
}

export class GoogleDocsAgent extends BaseOpenAIAgent {
  private docsService!: docs_v1.Docs;
  private driveService!: drive_v3.Drive;

  constructor(client: OpenAI) {
    const zodTools: ZodTool<any>[] = [
      {
        name: 'createDocument',
        schema: z.object({
          title: z.string().describe('Title of the new document'),
          content: z.string().describe('Initial content of the document')
        }).required().describe('Create a new Google Doc'),
        implementation: async ({ title, content }) => {
          const doc = await this.createDoc({ title, content });
          return {
            message: `Created document: "${title}"`,
            documentId: doc.documentId,
            link: `https://docs.google.com/document/d/${doc.documentId}/edit`,
            title: doc.title
          };
        }
      },
      {
        name: 'readDocument',
        schema: z.object({
          documentId: z.string().describe('ID of the document to read')
        }).required().describe('Read content from a Google Doc'),
        implementation: async ({ documentId }) => {
          return await this.readDoc(documentId);
        }
      },
      {
        name: 'updateDocument',
        schema: z.object({
          documentId: z.string().describe('ID of the document to update'),
          content: z.string().describe('New content to replace existing content'),
          replaceContent: z.boolean().optional().describe('Whether to replace all content (default: true)')
        }).required().describe('Update or replace content in a Google Doc'),
        implementation: async ({ documentId, content, replaceContent = true }) => {
          const doc = await this.updateDoc({
            documentId,
            content,
            replaceContent
          });
          return {
            message: replaceContent ? 'Document content replaced' : 'Document updated',
            link: `https://docs.google.com/document/d/${documentId}/edit`
          };
        }
      },
      {
        name: 'searchDocuments',
        schema: z.object({
          query: z.string().describe('Search term to find documents'),
          maxResults: z.number().optional().describe('Maximum number of results (default: 10)')
        }).required().describe('Search for Google Docs by title or content'),
        implementation: async ({ query, maxResults = 10 }) => {
          const results = await this.searchDocs(query, maxResults);
          return {
            count: results.length,
            documents: results.map(doc => ({
              title: doc.name,
              id: doc.id,
              link: doc.link,
              lastModified: doc.lastModified
            }))
          };
        }
      },
      {
        name: 'renameDocument',
        schema: z.object({
          documentId: z.string().describe('ID of the document to rename'),
          newTitle: z.string().describe('New title for the document')
        }).required().describe('Rename an existing Google Doc'),
        implementation: async ({ documentId, newTitle }) => {
          const result = await this.renameDoc(documentId, newTitle);
          return {
            message: `Document renamed to: "${newTitle}"`,
            documentId: result.id,
            link: result.link,
            title: result.name
          };
        }
      },
      {
        name: 'deleteDocument',
        schema: z.object({
          documentId: z.string().describe('ID of the document to delete')
        }).required().describe('Permanently delete a Google Doc'),
        implementation: async ({ documentId }) => {
          await this.deleteDoc(documentId);
          return {
            message: 'Document deleted successfully',
            documentId
          };
        }
      }
    ];

    super(client, {
      name: 'Google Docs',
      description: 'An agent that can create, search, and manage Google Docs',
      systemPrompt: `You are a Google Docs assistant that helps manage documents.
        Always provide document links after creation, updates, or searches.
        Format content appropriately for documents.
        When searching, try to find the most relevant documents.
        
        IMPORTANT: Before deleting any document:
        1. Always ask for explicit confirmation from the user
        2. Show the document title and link that will be deleted
        3. Only proceed with deletion after clear user confirmation
        4. Explain that deletion is permanent and cannot be undone
        
        Example deletion flow:
        User: "Delete the project notes"
        Assistant: "I found a document titled 'Project Notes' (link: ...). Please confirm if you want to permanently delete this document. This action cannot be undone."
        User: "Yes, delete it"
        Assistant: "Document 'Project Notes' has been permanently deleted."`,
      zodTools
    });

    this.initializeServices();
  }

  private async initializeServices() {
    try {
      const authService = GoogleAuthService.getInstance();
      const auth = await authService.getAuthenticatedClient();
      this.docsService = google.docs({ version: 'v1', auth });
      this.driveService = google.drive({ version: 'v3', auth });
    } catch (error) {
      console.error('Failed to initialize services:', error);
      throw error;
    }
  }

  private async applyFormatting(documentId: string, content: string): Promise<void> {
    try {
      await this.docsService.documents.batchUpdate({
        documentId,
        requestBody: {
          requests: [{
            insertText: {
              location: { index: 1 },
              text: content
            }
          }]
        }
      });
    } catch (error) {
      console.error('Failed to format document:', error);
      throw error;
    }
  }

  private processInlineMarkdown(text: string): string {
    const styles: Array<{ start: number; end: number; style: MarkdownStyle }> = [];
    let cleanText = text;

    // Process bold
    cleanText = cleanText.replace(/\*\*(.+?)\*\*/g, (_, content) => {
      styles.push({ start: cleanText.indexOf(content), end: cleanText.indexOf(content) + content.length, style: { bold: true } });
      return content;
    });

    // Process italic
    cleanText = cleanText.replace(/\*(.+?)\*/g, (_, content) => {
      styles.push({ start: cleanText.indexOf(content), end: cleanText.indexOf(content) + content.length, style: { italic: true } });
      return content;
    });

    // Process inline code
    cleanText = cleanText.replace(/`(.+?)`/g, (_, content) => {
      styles.push({ start: cleanText.indexOf(content), end: cleanText.indexOf(content) + content.length, style: { code: true } });
      return content;
    });

    // Process links
    cleanText = cleanText.replace(/\[(.+?)\]\((.+?)\)/g, (_, text, url) => {
      styles.push({ start: cleanText.indexOf(text), end: cleanText.indexOf(text) + text.length, style: { link: url } });
      return text;
    });

    return cleanText;
  }

  private async insertFormattedText(requests: any[], index: number, text: string, formatting: any) {
    requests.push({
      insertText: {
        location: { index },
        text
      }
    });

    if (formatting.textStyle) {
      requests.push({
        updateTextStyle: {
          range: {
            startIndex: index,
            endIndex: index + text.length - 1
          },
          textStyle: formatting.textStyle,
          fields: '*'
        }
      });
    }

    if (formatting.paragraphStyle) {
      requests.push({
        updateParagraphStyle: {
          range: {
            startIndex: index,
            endIndex: index + text.length
          },
          paragraphStyle: formatting.paragraphStyle,
          fields: '*'
        }
      });
    }
  }

  private async createDoc({ title, content }: DocContent) {
    try {
      // Create empty document
      const doc = await this.docsService.documents.create({
        requestBody: { title }
      });

      const documentId = doc.data.documentId!;

      // Apply formatted content
      await this.applyFormatting(documentId, content);

      return {
        documentId,
        title: doc.data.title!
      };
    } catch (error) {
      console.error('Failed to create document:', error);
      throw error;
    }
  }

  private async readDoc(documentId: string) {
    try {
      const doc = await this.docsService.documents.get({
        documentId
      });

      return {
        title: doc.data.title,
        content: this.extractContent(doc.data),
        link: `https://docs.google.com/document/d/${documentId}/edit`
      };
    } catch (error) {
      console.error('Failed to read document:', error);
      throw error;
    }
  }

  private async updateDoc({ documentId, content, replaceContent = true }: DocUpdate & { replaceContent?: boolean }) {
    try {
      if (replaceContent) {
        // Clear existing content
        const doc = await this.docsService.documents.get({ documentId });
        const endIndex = doc.data.body?.content?.pop()?.endIndex || 1;
        
        if (endIndex > 1) {
          await this.docsService.documents.batchUpdate({
            documentId,
            requestBody: {
              requests: [{
                deleteContentRange: {
                  range: {
                    startIndex: 1,
                    endIndex: Math.max(1, endIndex - 1)  // Exclude final newline
                  }
                }
              }]
            }
          });
        }
      }

      // Apply new content with formatting
      await this.applyFormatting(documentId, content);

      return {
        documentId,
        updated: true,
        link: `https://docs.google.com/document/d/${documentId}/edit`
      };
    } catch (error) {
      console.error('Failed to update document:', error);
      throw error;
    }
  }

  private extractContent(document: docs_v1.Schema$Document): string {
    let content = '';
    document.body?.content?.forEach(element => {
      if (element.paragraph) {
        element.paragraph.elements?.forEach(el => {
          content += el.textRun?.content || '';
        });
      }
    });
    return content;
  }

  private async searchDocs(query: string, maxResults: number): Promise<DocSearchResult[]> {
    try {
      // Search for Google Docs files
      const response = await this.driveService.files.list({
        q: `mimeType='application/vnd.google-apps.document' and (name contains '${query}' or fullText contains '${query}')`,
        pageSize: maxResults,
        fields: 'files(id, name, modifiedTime, webViewLink)',
        orderBy: 'modifiedTime desc'
      });

      return (response.data.files || []).map(file => ({
        id: file.id!,
        name: file.name!,
        link: file.webViewLink!,
        lastModified: new Date(file.modifiedTime!).toLocaleString()
      }));
    } catch (error) {
      console.error('Failed to search documents:', error);
      throw error;
    }
  }

  private async renameDoc(documentId: string, newTitle: string): Promise<DocSearchResult> {
    try {
      const file = await this.driveService.files.update({
        fileId: documentId,
        requestBody: {
          name: newTitle
        },
        fields: 'id, name, modifiedTime, webViewLink'
      });

      return {
        id: file.data.id!,
        name: file.data.name!,
        link: file.data.webViewLink!,
        lastModified: new Date(file.data.modifiedTime!).toLocaleString()
      };
    } catch (error) {
      console.error('Failed to rename document:', error);
      throw error;
    }
  }

  private async deleteDoc(documentId: string): Promise<void> {
    try {
      await this.driveService.files.delete({
        fileId: documentId
      });
    } catch (error) {
      console.error('Failed to delete document:', error);
      throw error;
    }
  }
} 