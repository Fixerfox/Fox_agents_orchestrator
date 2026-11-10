import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { atomicWrite } from './fs-util';

export type TrustDecision = 'trusted' | 'ignored';

/** Clave de un proyecto en los datos de la app: 16 caracteres del SHA-256 de su carpeta [R88.3]. */
export function projectKey(root: string, platform: NodeJS.Platform = process.platform): string {
  const resolved = path.resolve(root);
  return createHash('sha256').update(platform === 'win32' ? resolved.toLowerCase() : resolved).digest('hex').slice(0, 16);
}

/**
 * Si se confía en la configuración de Claude Code de cada proyecto, con la huella de lo que se revisó. Vive en los
 * datos de la app, nunca en el repositorio [R88.3].
 */
export class ProjectTrustStore {
  constructor(private readonly file: string) {}

  private async read(): Promise<Record<string, { fingerprint: string; decision: TrustDecision }>> {
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8')) as { projects?: unknown };
      return raw.projects && typeof raw.projects === 'object' ? (raw.projects as Record<string, { fingerprint: string; decision: TrustDecision }>) : {};
    } catch {
      return {};
    }
  }

  /** La decisión vigente: solo si la huella coincide con la de lo que se revisó [R88.3]. */
  async decision(root: string, fingerprint: string): Promise<TrustDecision | null> {
    const entry = (await this.read())[projectKey(root)];
    if (!entry || entry.fingerprint !== fingerprint) return null;
    return entry.decision === 'trusted' || entry.decision === 'ignored' ? entry.decision : null;
  }

  async set(root: string, fingerprint: string, decision: TrustDecision): Promise<void> {
    const projects = await this.read();
    projects[projectKey(root)] = { fingerprint, decision };
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await atomicWrite(this.file, `${JSON.stringify({ schemaVersion: 1, projects }, null, 2)}\n`);
  }
}
