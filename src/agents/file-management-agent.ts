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
          pattern: z.string().describe("File pattern to search for (e.g., '*.txt', 'doc/*.pdf')"),
          recursive: z.boolean().describe("Whether to search recursively in subdirectories"),
        }),
        implementation: async (args) => this.listFiles(args)
      },
      {
        name: 'createFile',
        schema: z.object({
          filename: z.string().describe("Name of the file to create (including path relative to scratchpad)"),
          content: z.string().describe("Content to write to the file"),
        }),
        implementation: async (args) => this.createFile(args)
      },
      {
        name: 'readFile',
        schema: z.object({
          filename: z.string().describe("Name of the file to read (including path relative to scratchpad)"),
        }),
        implementation: async (args) => this.readFile(args)
      },
      {
        name: 'updateFile',
        schema: z.object({
          filename: z.string().describe("Name of the file to update (including path relative to scratchpad)"),
          content: z.string().describe("New content for the file"),
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
          dirname: z.string().describe("Name of the directory to create (relative to scratchpad)"),
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
          source: z.string().describe("Source file path (relative to scratchpad)"),
          destination: z.string().describe("Destination path (relative to scratchpad)"),
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
      description: 'Manages files in a scratchpad directory with create, read, update, and delete operations',
      systemPrompt: 'You are a file management assistant that helps organize and manage files in the scratchpad directory.',
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
    
    // Ensure destination directory exists
    await fs.mkdir(path.dirname(destPath), { recursive: true });
    
    await fs.rename(sourcePath, destPath);
    return { 
      success: true, 
      from: sourcePath,
      to: destPath 
    };
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