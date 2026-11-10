import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { globToRegExp, unifiedDiff, lineStats, type CheckRunner, type EvidenceSource } from '@orquestador/core';
import type { ProjectStore } from '@orquestador/store';

/** Variables que nunca llegan a una comprobación: claves de la app y de los proveedores [R75.4]. */
const SECRET_ENV = /(API_KEY|TOKEN|SECRET|PASSWORD|ANTHROPIC|OPENAI|AWS_|GH_|GITHUB_)/i;
const OUTPUT_MAX = 200_000;
const hashOf = (run: string) => createHash('sha256').update(run).digest('hex');

/** Entorno sin secretos para las comprobaciones [R75.4]. */
export const checkEnv = (env: NodeJS.ProcessEnv): NodeJS.ProcessEnv => Object.fromEntries(Object.entries(env).filter(([k]) => !SECRET_ENV.test(k)));

/** Mata el proceso y todo lo que lanzó [R75.4]. */
function killTree(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { stdio: 'ignore' });
    else process.kill(-pid, 'SIGKILL');
  } catch {
    /* ya no existe */
  }
}

/** Archivos de una carpeta, por ruta relativa con `/`, sin las internas. */
async function listFiles(root: string, max = 20_000): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string, prefix: string): Promise<void> => {
    if (out.length >= max) return;
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (['.git', 'node_modules', '.orquestador'].includes(e.name)) continue;
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(path.join(dir, e.name), rel);
      else if (e.isFile()) out.push(rel);
    }
  };
  await walk(root, '');
  return out;
}

/** Comprobaciones del proyecto: comandos aprobados en su carpeta y archivos que existen [R75.4][R75.6]. */
export function checkRunnerFor(store: Pick<ProjectStore, 'paths' | 'getWorkFolder'>, projectRoot: string, approvalsFile?: string): CheckRunner {
  // Las aprobaciones viven en los datos de la app: las de un repositorio no cuentan [R88.5].
  const file = approvalsFile ?? store.paths.approvedChecksFile;
  const read = async (): Promise<string[]> => {
    try {
      const raw = JSON.parse(await fs.readFile(file, 'utf8')) as { approved?: unknown };
      return Array.isArray(raw.approved) ? raw.approved.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  };
  const root = async (dir?: string) => dir ?? (await store.getWorkFolder()) ?? projectRoot;
  return {
    approved: async (run) => (await read()).includes(hashOf(run)),
    async approve(run) {
      const list = [...new Set([...(await read()), hashOf(run)])];
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, `${JSON.stringify({ schemaVersion: 1, approved: list }, null, 2)}\n`);
    },
    async command({ run, timeoutSec, dir }, signal) {
      const cwd = await root(dir);
      const started = Date.now();
      return new Promise((resolve) => {
        const child = spawn(run, { cwd, shell: true, env: checkEnv(process.env), detached: process.platform !== 'win32', windowsHide: true });
        let output = '';
        let timedOut = false;
        const add = (b: Buffer) => {
          if (output.length < OUTPUT_MAX) output += b.toString('utf8');
        };
        child.stdout?.on('data', add);
        child.stderr?.on('data', add);
        const timer = setTimeout(() => {
          timedOut = true;
          killTree(child.pid);
        }, timeoutSec * 1000);
        const onAbort = () => killTree(child.pid);
        signal.addEventListener('abort', onAbort, { once: true });
        const finish = (exitCode: number | null) => {
          clearTimeout(timer);
          signal.removeEventListener('abort', onAbort);
          resolve({ exitCode, output, timedOut, durationMs: Date.now() - started });
        };
        child.on('error', (e) => {
          output += String(e.message);
          finish(null);
        });
        child.on('close', (code) => finish(code));
      });
    },
    async missing(patterns, dir) {
      const files = await listFiles(await root(dir));
      return patterns.filter((p) => !files.some((f) => globToRegExp(p).test(f)));
    },
  };
}

/** El diff de lo que tocó un paso, contra la copia de antes (R31.6) [R75.7]. */
export function evidenceFor(store: Pick<ProjectStore, 'paths' | 'getWorkFolder'>, projectRoot: string): EvidenceSource {
  return {
    async diff({ runId, files, dir, priority, maxChars }) {
      const root = dir ?? (await store.getWorkFolder()) ?? projectRoot;
      const backups = store.paths.backupsDir(runId);
      const read = (abs: string) => fs.readFile(abs, 'utf8').catch(() => undefined);
      const parts: { path: string; text: string; size: number; first: boolean }[] = [];
      const lines: { path: string; added: number; removed: number }[] = [];
      const listed: string[] = [];
      for (const f of files) {
        if (f.via === 'command') {
          listed.push(`${f.path} (cambiado por un comando)`);
          continue;
        }
        const now = (await read(path.join(root, ...f.path.split('/')))) ?? '';
        const before = f.change === 'created' ? undefined : await read(path.join(backups, ...f.path.split('/')));
        const s = lineStats(before ?? '', now);
        lines.push({ path: f.path, ...s });
        if (now.includes('\u0000')) continue;
        parts.push({ path: f.path, text: unifiedDiff(f.path, before, now), size: now.length, first: priority.some((p) => f.path === p || f.path.startsWith(p.endsWith('/') ? p : `${p}/`) || globToRegExp(p).test(f.path)) });
      }
      parts.sort((a, b) => Number(b.first) - Number(a.first) || a.size - b.size);
      let diff = '';
      const left: string[] = [];
      for (const p of parts) {
        if (diff.length + p.text.length <= maxChars) diff += p.text;
        else {
          const l = lines.find((x) => x.path === p.path)!;
          left.push(`${p.path} (+${l.added} −${l.removed})`);
        }
      }
      const tail = [...left, ...listed];
      return { diff: tail.length > 0 && maxChars > 0 ? `${diff}\n(No caben aquí: ${tail.join(', ')})` : diff, lines };
    },
  };
}
