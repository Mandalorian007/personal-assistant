import { z } from 'zod';
import OpenAI from 'openai';
import { BaseOpenAIAgent, ZodTool } from './base-openai-agent.js';
import path from 'path';
import fs from 'fs/promises';
import { glob } from 'glob';

export class FileManagementAgent extends BaseOpenAIAgent {
  private scratchpadPath: string;

  constructor(client: OpenAI) {
    const zodTools: ZodTool<any>[] = [
      {
        name: 'listFiles',
        schema: z.object({
          pattern: z.string().describe("File pattern to search for (e.g., '*.md' for markdown notes, 'research/*.txt' for research text files)"),
          recursive: z.boolean().describe("Whether to search in subdirectories like 'research/' or 'notes/'"),
        }),
        implementation: async (args) => this.listFiles(args)
      },
      {
        name: 'createFile',
        schema: z.object({
          filename: z.string().describe("Name of the file to create (e.g., 'research/api_notes.md', 'notes/meeting_summary.txt')"),
          content: z.string().describe("Content to write to the file"),
        }),
        implementation: async (args) => this.createFile(args)
      },
      {
        name: 'readFile',
        schema: z.object({
          filename: z.string().describe("Name of the file to read (e.g., 'research/findings.md', 'notes/todo.txt')"),
        }),
        implementation: async (args) => this.readFile(args)
      },
      {
        name: 'updateFile',
        schema: z.object({
          filename: z.string().describe("Name of the file to update (e.g., 'research/progress.md')"),
          content: z.string().describe("New or additional content for the file"),
        }),
        implementation: async (args) => this.updateFile(args)
      },
      {
        name: 'deleteFile',
        schema: z.object({
          filename: z.string().describe("Name of the file to delete (including path relative to scratchpad)"),
        }),
        implementation: async (args) => this.deleteFile(args)
      },
      {
        name: 'createDirectory',
        schema: z.object({
          dirname: z.string().describe("Name of the directory to create (e.g., 'research/project_x', 'notes/meetings')"),
        }),
        implementation: async (args) => this.createDirectory(args)
      },
      {
        name: 'getFileInfo',
        schema: z.object({
          filename: z.string().describe("Name of the file to check (including path relative to scratchpad)"),
        }),
        implementation: async (args) => this.getFileInfo(args)
      },
      {
        name: 'moveFile',
        schema: z.object({
          source: z.string().describe("Current file location (e.g., 'temp_notes.md')"),
          destination: z.string().describe("New file location (e.g., 'research/completed_notes.md')"),
        }),
        implementation: async (args) => this.moveFile(args)
      },
      {
        name: 'deleteDirectory',
        schema: z.object({
          dirname: z.string().describe("Name of the directory to delete (relative to scratchpad)"),
        }),
        implementation: async (args) => this.deleteDirectory(args)
      }
    ];

    super(client, {
      name: 'File Management',
      description: 'Manages notes, research documents, and temporary files in the scratchpad workspace',
      systemPrompt: `You are a file management assistant that helps organize and manage files in the scratchpad workspace.

      About the Scratchpad:
      - This is a dedicated workspace for notes, research, and temporary files
      - Common directories include 'research/', 'notes/', 'temp/', etc.
      - Markdown (.md) files are preferred for documentation
      - Files should be organized by topic/project in appropriate subdirectories
      
      Best Practices:
      - Keep related files together in topic-specific directories
      - Use clear, descriptive filenames
      - Prefer markdown for documentation and notes
      - Organize research materials in the 'research/' directory
      - Keep temporary or in-progress work in 'temp/' or root
      
      When handling files:
      1. Always check if directories exist before creating files
      2. Use appropriate file extensions (.md for markdown, .txt for plain text)
      3. Organize files logically by topic/purpose
      4. Clean up temporary files when they're no longer needed
      
      Example directory structure:
      scratchpad/
      ├── research/           # In-depth research documents
      ├── notes/             # Quick notes and summaries
      ├── temp/              # Temporary working files
      └── projects/          # Project-specific materials`,
      zodTools
    });

    this.scratchpadPath = path.join(process.cwd(), 'scratchpad');
    this.initScratchpad();
  }

  private async initScratchpad() {
    try {
      await fs.access(this.scratchpadPath);
    } catch {
      await fs.mkdir(this.scratchpadPath);
    }
  }

  private async listFiles(args: { pattern: string; recursive: boolean }) {
    const { pattern, recursive } = args;
    const searchPattern = recursive ? `**/${pattern}` : pattern;
    const files = await glob(searchPattern, {
      cwd: this.scratchpadPath,
      dot: false,
      absolute: false,
      withFileTypes: false
    });
    return { files };
  }

  private async createFile(args: { filename: string; content: string }) {
    const { filename, content } = args;
    const filePath = path.join(this.scratchpadPath, filename);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, 'utf-8');
    return { success: true, path: filePath };
  }

  private async readFile(args: { filename: string }) {
    const { filename } = args;
    const filePath = path.join(this.scratchpadPath, filename);
    const content = await fs.readFile(filePath, 'utf-8');
    return { content };
  }

  private async updateFile(args: { filename: string; content: string }) {
    const { filename, content } = args;
    const filePath = path.join(this.scratchpadPath, filename);
    await fs.writeFile(filePath, content, 'utf-8');
    return { success: true };
  }

  private async deleteFile(args: { filename: string }) {
    const { filename } = args;
    const filePath = path.join(this.scratchpadPath, filename);
    const stats = await fs.stat(filePath);
    
    if (stats.isDirectory()) {
      return this.deleteDirectory({ dirname: filename });
    }
    
    await fs.unlink(filePath);
    return { success: true };
  }

  private async createDirectory(args: { dirname: string }) {
    const { dirname } = args;
    const dirPath = path.join(this.scratchpadPath, dirname);
    await fs.mkdir(dirPath, { recursive: true });
    return { success: true, path: dirPath };
  }

  private async getFileInfo(args: { filename: string }) {
    const { filename } = args;
    const filePath = path.join(this.scratchpadPath, filename);
    const stats = await fs.stat(filePath);
    return {
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
    };
  }

  private async moveFile(args: { source: string; destination: string }) {
    const { source, destination } = args;
    const sourcePath = path.join(this.scratchpadPath, source);
    const destPath = path.join(this.scratchpadPath, destination);
    
    // Ensure paths are within scratchpad
    const resolvedSourcePath = path.resolve(sourcePath);
    const resolvedDestPath = path.resolve(destPath);
    if (!resolvedSourcePath.startsWith(this.scratchpadPath) || 
        !resolvedDestPath.startsWith(this.scratchpadPath)) {
      throw new Error('Cannot move files outside of scratchpad directory');
    }

    // Create destination directory if it doesn't exist
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    
    try {
      // Check if source exists
      await fs.access(sourcePath);
      
      // Perform the move
      await fs.rename(sourcePath, destPath);
      
      return { 
        success: true, 
        from: sourcePath,
        to: destPath 
      };
    } catch (error) {
      console.error('Move error:', error);
      throw new Error(`Failed to move ${source} to ${destination}`);
    }
  }

  private async deleteDirectory(args: { dirname: string }) {
    const { dirname } = args;
    const dirPath = path.join(this.scratchpadPath, dirname);
    const resolvedPath = path.resolve(dirPath);

    // Ensure the path is actually within scratchpad
    if (!resolvedPath.startsWith(this.scratchpadPath)) {
      throw new Error('Cannot delete directory outside of scratchpad');
    }

    // Verify it exists and is a directory
    const stats = await fs.stat(dirPath);
    if (!stats.isDirectory()) {
      throw new Error('Path is not a directory');
    }

    await fs.rm(dirPath, { recursive: true, force: true });
    return { success: true };
  }
} 