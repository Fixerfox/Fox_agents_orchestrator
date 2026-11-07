import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AgentStreamEvent } from '@orquestador/core';

type BranchEvent = Extract<AgentStreamEvent, { type: 'branch' }>;
type ActionEvent = Extract<AgentStreamEvent, { type: 'git_action' }>;
type GitAction = ActionEvent['action'];

/** Lo que dice un comando sobre las ramas [R58.3]. */
export interface GitCommandEffect {
  created: string[];
  /** De las creadas, las que además mueven `HEAD`: si no se movió, el comando falló [R58.3]. */
  moves: string[];
  named: string[];
  /** Actúa en la rama de `HEAD`, sin nombrarla. */
  acts: boolean;
  /** Lo que hace; sin `branch`, en la rama de `HEAD` [R58.11]. */
  actions: { action: GitAction; branch?: string }[];
}

const ACTS_ON_HEAD = new Set(['commit', 'merge', 'rebase', 'cherry-pick', 'revert', 'pull', 'am']);
const READ_ONLY_MCP = /^(get|list|search|read|find)/i;
const MCP_BRANCH_FIELDS = ['branch', 'branch_name', 'new_branch', 'head', 'source_branch', 'sha', 'ref'];
const REVIEW_URL = /https:\/\/[^\s"'<>)]+\/(?:pull|pull-requests|-\/merge_requests)\/\d+/;
const CLI_REVIEW = /\b(?:gh\s+pr|glab\s+mr)\s+create\b/;
const COMMIT_HASH = /^[0-9a-f]{7,40}$/i;
const MAIN_BRANCH = /^(main|master|develop|trunk)$/;

/** ¿Aceptaría git este nombre de rama? [R58.5] */
export function validBranch(name: string): boolean {
  return name.length > 0 && name.length <= 200 && name !== 'HEAD' && !name.startsWith('-') && !name.includes('..') && !/[\s~^:?*[\\]/.test(name);
}

const shortRef = (ref: string) => ref.replace(/^refs\/heads\//, '');

/** Quita las comillas de un solo token y vacía el texto entrecomillado, que no es parte del comando. */
function withoutQuotes(command: string): string {
  return command.replace(/"([^"]*)"|'([^']*)'/g, (_m, a?: string, b?: string) => {
    const text = a ?? b ?? '';
    return /^[^\s;&|]+$/.test(text) ? text : '_';
  });
}

/** Ramas que crea o usa un comando de terminal [R58.3]. */
export function parseGitCommand(command: string): GitCommandEffect {
  const out: GitCommandEffect = { created: [], moves: [], named: [], acts: false, actions: [] };
  for (const segment of withoutQuotes(command).split(/&&|\|\||[;|\n]/)) {
    const words = segment.trim().split(/\s+/);
    const at = words.indexOf('git');
    if (at < 0) continue;
    const rest = words.slice(at + 1);
    while (rest[0] === '-c') rest.splice(0, 2);
    // `git -C otra-carpeta` va a otro repositorio.
    if (rest[0]?.startsWith('-')) continue;
    const [sub, ...args] = rest;
    if (!sub) continue;
    const plain = args.filter((a) => !a.startsWith('-'));
    if (sub === 'checkout' || sub === 'switch') {
      const flag = args.findIndex((a) => ['-b', '-B', '-c', '-C', '--create'].includes(a));
      const name = flag >= 0 ? args[flag + 1] : undefined;
      if (name) {
        out.created.push(name);
        out.moves.push(name);
      }
    } else if (sub === 'branch') {
      if (args.length > 0 && plain.length === args.length) out.created.push(plain[0]!);
      else if (plain[0] && args.some((a) => a === '-d' || a === '-D' || a === '--delete')) out.actions.push({ action: 'delete', branch: plain[0] });
    } else if (sub === 'push') {
      if (args.includes('--tags')) continue;
      const refspec = plain[1];
      if (args.some((a) => a === '-d' || a === '--delete')) {
        if (refspec) out.actions.push({ action: 'delete', branch: shortRef(refspec) });
      } else if (!refspec || refspec === 'HEAD') {
        out.acts = true;
        out.actions.push({ action: 'push' });
      } else {
        const branch = shortRef(refspec.split(':').pop()!);
        out.named.push(branch);
        out.actions.push({ action: 'push', branch });
      }
    } else if (ACTS_ON_HEAD.has(sub)) {
      out.acts = true;
      if (sub === 'commit') out.actions.push({ action: 'commit' });
    }
  }
  return { created: out.created.filter(validBranch), moves: out.moves.filter(validBranch), named: out.named.filter(validBranch), acts: out.acts, actions: out.actions.filter((a) => a.branch === undefined || validBranch(a.branch)) };
}

/** Dirección de la PR o el merge request en lo que respondió la herramienta [R58.14]. */
export const reviewUrl = (output: string | undefined): string | undefined => (output ? REVIEW_URL.exec(output)?.[0] : undefined);

/** Qué hace una herramienta MCP de git [R58.11]. */
function mcpAction(name: string): GitAction | undefined {
  if (/delete_branch/i.test(name)) return 'delete';
  if (/push_files/i.test(name)) return 'push';
  if (/create_(pull|merge)_request/i.test(name)) return 'pr';
  if (/create_or_update_file|commit/i.test(name) && !READ_ONLY_MCP.test(name)) return 'commit';
  return undefined;
}

/** Rama que toca una herramienta MCP de git [R58.4]. */
export function parseGitMcp(tool: string, input: unknown): { branch: string; created: boolean; action?: GitAction } | undefined {
  const m = /^mcp__(.+?)__(.+)$/.exec(tool);
  if (!m) return undefined;
  const server = m[1]!;
  const name = m[2]!;
  if (!/git|bitbucket/i.test(server) && !/branch/i.test(name)) return undefined;
  const fields = (input ?? {}) as Record<string, unknown>;
  const raw = MCP_BRANCH_FIELDS.map((f) => fields[f]).find((v): v is string => typeof v === 'string' && !COMMIT_HASH.test(v));
  if (raw === undefined) return undefined;
  const branch = shortRef(raw.split(':').pop()!);
  // Leer la rama principal no es actividad: pasa en cualquier proyecto [R58.4].
  if (READ_ONLY_MCP.test(name) && MAIN_BRANCH.test(branch)) return undefined;
  if (!validBranch(branch) || branch.startsWith('refs/')) return undefined;
  const action = mcpAction(name);
  return { branch, created: /create.*branch/i.test(name), ...(action ? { action } : {}) };
}

/** Carpeta de git de `start` o de la más cercana hacia arriba; en un worktree, `.git` es un archivo [R58.2]. */
export async function findGitDir(start: string): Promise<string | undefined> {
  for (let dir = path.resolve(start); ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, '.git');
    try {
      if ((await fs.stat(candidate)).isDirectory()) return candidate;
      const m = /^gitdir:\s*(.+)$/m.exec(await fs.readFile(candidate, 'utf8'));
      if (m) return path.resolve(dir, m[1]!.trim());
    } catch {
      // Aquí no hay: se sigue subiendo.
    }
    if (path.dirname(dir) === dir) return undefined;
  }
}

/** Rama de `HEAD`, leyendo el archivo; suelto o ilegible, ninguna [R58.2]. */
export async function readBranch(gitDir: string): Promise<string | undefined> {
  try {
    return /^ref: refs\/heads\/(.+)$/m.exec(await fs.readFile(path.join(gitDir, 'HEAD'), 'utf8'))?.[1]?.trim();
  } catch {
    return undefined;
  }
}

/** Sigue las ramas de un intento: `HEAD`, comandos y MCP [R58.2]–[R58.5]. */
export class BranchTracker {
  private gitDir: string | undefined;
  private head: string | undefined;
  private readonly calls = new Map<string, unknown[]>();
  private readonly told = new Set<string>();
  private readonly toldCreated = new Set<string>();
  private readonly toldActions = new Set<string>();
  /** Rama de la última PR, porque fusionarla no la nombra [R58.11]. */
  private lastPr: string | undefined;

  constructor(private readonly root: string) {}

  async start(): Promise<void> {
    this.gitDir = await findGitDir(this.root);
    this.head = await this.current();
  }

  private current(): Promise<string | undefined> {
    return this.gitDir ? readBranch(this.gitDir) : Promise.resolve(undefined);
  }

  /** Guarda la entrada: el resultado de la herramienta llega después y sin ella. */
  called(tool: string, input: unknown): void {
    this.calls.set(tool, [...(this.calls.get(tool) ?? []), input]);
  }

  private *tell(found: BranchEvent[]): Iterable<BranchEvent> {
    for (const b of found) {
      if (this.told.has(b.branch) && !(b.created && !this.toldCreated.has(b.branch))) continue;
      this.told.add(b.branch);
      if (b.created) this.toldCreated.add(b.branch);
      yield b;
    }
  }

  private *tellActions(found: ActionEvent[]): Iterable<ActionEvent> {
    for (const a of found) {
      const key = `${a.action} ${a.branch}`;
      if (this.toldActions.has(key)) continue;
      this.toldActions.add(key);
      yield a;
    }
  }

  async *settled(tool: string, ok: boolean, output?: string): AsyncIterable<BranchEvent | ActionEvent> {
    const input = this.calls.get(tool)?.shift();
    const found: BranchEvent[] = [];
    const actions: ActionEvent[] = [];
    const now = await this.current();
    if (ok) {
      const command = (input as { command?: unknown } | undefined)?.command;
      if ((tool === 'Bash' || tool === 'PowerShell') && typeof command === 'string') {
        const effect = parseGitCommand(command);
        const failed = (branch: string) => now !== undefined && now === this.head && now !== branch && effect.moves.includes(branch);
        for (const branch of effect.created.filter((b) => !failed(b))) found.push({ type: 'branch', branch, via: 'command', created: true });
        for (const branch of effect.named) found.push({ type: 'branch', branch, via: 'command' });
        if (effect.acts && now) found.push({ type: 'branch', branch: now, via: 'command' });
        for (const a of effect.actions) {
          const branch = a.branch ?? now;
          if (branch) actions.push({ type: 'git_action', branch, action: a.action });
        }
        if (CLI_REVIEW.test(command) && now) {
          const url = reviewUrl(output);
          actions.push({ type: 'git_action', branch: now, action: 'pr', ...(url ? { url } : {}) });
        }
      }
      const mcp = parseGitMcp(tool, input);
      if (mcp && mcp.action !== 'delete') found.push({ type: 'branch', branch: mcp.branch, via: 'mcp', ...(mcp.created ? { created: true } : {}) });
      const url = mcp?.action === 'pr' ? reviewUrl(output) : undefined;
      if (mcp?.action) actions.push({ type: 'git_action', branch: mcp.branch, action: mcp.action, ...(url ? { url } : {}) });
      if (mcp?.action === 'pr') this.lastPr = mcp.branch;
      if (/^mcp__.*merge_(pull|merge)_request/i.test(tool) && this.lastPr) actions.push({ type: 'git_action', branch: this.lastPr, action: 'merge' });
    }
    if (now && now !== this.head) {
      // El paso estaba en la rama que deja, aunque aún no hubiera hecho nada en ella [R58.2].
      if (this.head && !MAIN_BRANCH.test(this.head)) found.unshift({ type: 'branch', branch: this.head, via: 'ran' });
      this.head = now;
      // Aunque ya se hubiera nombrado, tiene que quedar la última: es donde está el paso [R58.2].
      this.told.delete(now);
      found.push({ type: 'branch', branch: now, via: 'head' });
      actions.push({ type: 'git_action', branch: now, action: 'switch' });
    }
    yield* this.tell(found);
    yield* this.tellActions(actions);
  }

  /** Al terminar, el paso ha trabajado en la rama de `HEAD`, aunque solo leyera [R58.5]. */
  async *finished(): AsyncIterable<BranchEvent> {
    const now = await this.current();
    if (now) yield* this.tell([{ type: 'branch', branch: now, via: 'ran' }]);
  }
}
