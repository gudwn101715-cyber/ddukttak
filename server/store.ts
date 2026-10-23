import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AppSchema, Project } from '../src/lib/schema.js';

export interface PublishedSnapshot {
  projectId: string;
  versionId: string;
  schema: AppSchema;
  publishedAt: string;
}
interface Workspace {
  format: 1;
  projects: Project[];
  publications: Record<string, PublishedSnapshot>;
}
const emptyWorkspace = (): Workspace => ({ format: 1, projects: [], publications: {} });

/** A single local workspace. Never use this file adapter as a multi-tenant database. */
export class WorkspaceStore {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly file: string;
  constructor(private readonly dataDir: string) {
    this.file = path.join(dataDir, 'workspace.json');
  }

  private async load(): Promise<Workspace> {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8')) as Workspace;
      if (data.format !== 1 || !Array.isArray(data.projects) || !data.publications || typeof data.publications !== 'object') {
        throw new Error('Workspace data has an unsupported format.');
      }
      return data;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyWorkspace();
      throw error;
    }
  }

  async read<T>(select: (workspace: Workspace) => T): Promise<T> {
    await this.queue;
    return select(await this.load());
  }

  async mutate<T>(change: (workspace: Workspace) => T | Promise<T>): Promise<T> {
    const operation = this.queue.then(async () => {
      const workspace = await this.load();
      const result = await change(workspace);
      await mkdir(this.dataDir, { recursive: true, mode: 0o700 });
      const temporary = path.join(this.dataDir, `.workspace-${randomUUID()}.tmp`);
      await writeFile(temporary, JSON.stringify(workspace, null, 2), { mode: 0o600 });
      await rename(temporary, this.file);
      return result;
    });
    this.queue = operation.catch(() => undefined);
    return operation;
  }
}
