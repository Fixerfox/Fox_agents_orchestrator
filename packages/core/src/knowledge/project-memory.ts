import { redactString, type Id } from '../shared';

/** Lo que recuerda el proyecto [R76.1]. */
export type MemoryKind = 'convention' | 'preference' | 'lesson' | 'false-alarm';
export const MEMORY_KINDS: readonly MemoryKind[] = ['convention', 'preference', 'lesson', 'false-alarm'];
/** De dónde salió una entrada [R76.1]. */
export type MemoryOrigin = 'correction' | 'review' | 'retry' | 'confirm' | 'repeated-question' | 'alert-feedback' | 'manual' | 'assistant';
export const MEMORY_ORIGINS: readonly MemoryOrigin[] = ['correction', 'review', 'retry', 'confirm', 'repeated-question', 'alert-feedback', 'manual', 'assistant'];
/** `project`, `diagram:<id>` o `agent:<id>` [R76.1]. */
export type MemoryScope = string;

export interface MemoryEntry {
  id: Id;
  kind: MemoryKind;
  scope: MemoryScope;
  title: string;
  text: string;
  status: 'active' | 'archived';
  source: { runId?: Id; nodeId?: Id; origin: MemoryOrigin };
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  uses: number;
  history: { at: string; action: 'created' | 'updated' | 'archived' | 'restored'; by: 'user' | 'assistant'; runId?: Id; before?: string }[];
}

export const PROJECT_MEMORY_VERSION = 1;
export const MEMORY_TITLE_MAX = 80;
export const MEMORY_TEXT_MAX = 600;
/** Entradas activas como mucho, y desde cuántas se avisa [R76.4]. */
export const MEMORY_MAX_ACTIVE = 300;
export const MEMORY_WARN_ACTIVE = 200;
/** Tope de la sección «Memoria del proyecto» en el prompt [R76.14]. */
export const PROJECT_MEMORY_TOKENS = 1500;
/** Días sin usar tras los que se pregunta si sigue valiendo [R76.20]. */
export const MEMORY_STALE_DAYS = 60;

const SCOPE = /^(project|diagram:[A-Za-z0-9][A-Za-z0-9._-]{0,127}|agent:[A-Za-z0-9][A-Za-z0-9._-]{0,127})$/;
/** Lo que parece una clave: no se guarda nunca en la memoria [R76.3]. */
const SECRET = /(sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----|xox[abp]-[A-Za-z0-9-]{10,})/;
export const looksLikeSecret = (text: string): boolean => SECRET.test(text) || redactString(text) !== text;

/** Lo que no vale de una entrada [R76.1][R76.3]. */
export function memoryEntryProblems(e: Partial<MemoryEntry>): string[] {
  const out: string[] = [];
  if (!e.kind || !MEMORY_KINDS.includes(e.kind)) out.push('Elige el tipo: convención, preferencia, lección o aviso falso');
  if (!e.scope || !SCOPE.test(e.scope)) out.push('El ámbito es el proyecto, un diagrama o un agente');
  const title = (e.title ?? '').trim();
  const text = (e.text ?? '').trim();
  if (!title) out.push('Escribe un título');
  if (title.length > MEMORY_TITLE_MAX) out.push(`El título tiene como mucho ${MEMORY_TITLE_MAX} caracteres`);
  if (!text) out.push('Escribe qué hay que recordar');
  if (text.length > MEMORY_TEXT_MAX) out.push(`El texto tiene como mucho ${MEMORY_TEXT_MAX} caracteres`);
  if (looksLikeSecret(`${title}\n${text}`)) out.push('Parece una clave o un secreto: no se guarda en la memoria');
  return out;
}

/** Los ámbitos que ve un paso: su agente, su diagrama y el proyecto, en ese orden de prioridad [R76.14]. */
export const scopesFor = (o: { diagramId?: Id; agentId?: Id }): MemoryScope[] => [...(o.agentId ? [`agent:${o.agentId}`] : []), ...(o.diagramId ? [`diagram:${o.diagramId}`] : []), 'project'];

/** Las entradas activas de esos ámbitos, por prioridad y, dentro de cada ámbito, las usadas más recientemente [R76.14]. */
export function memoryFor(entries: readonly MemoryEntry[], o: { diagramId?: Id; agentId?: Id }, kinds?: readonly MemoryKind[]): MemoryEntry[] {
  const scopes = scopesFor(o);
  return entries
    .filter((e) => e.status === 'active' && scopes.includes(e.scope) && (!kinds || kinds.includes(e.kind)))
    .sort((a, b) => scopes.indexOf(a.scope) - scopes.indexOf(b.scope) || (b.lastUsedAt ?? b.updatedAt).localeCompare(a.lastUsedAt ?? a.updatedAt));
}

const KIND_LABEL: Record<MemoryKind, string> = { convention: 'Convención', preference: 'Preferencia', lesson: 'Lección', 'false-alarm': 'Aviso falso' };

/**
 * La sección «Memoria del proyecto» del prompt de sistema [R76.14]: título y texto de lo que cabe en el tope, y del
 * resto solo el título, para leerlo con `memoria_proyecto`. Los avisos falsos son para el Supervisor, no para el agente.
 */
export function renderProjectMemory(entries: readonly MemoryEntry[], o: { diagramId?: Id; agentId?: Id }, tokens = PROJECT_MEMORY_TOKENS): { text: string; ids: Id[] } | undefined {
  const list = memoryFor(entries, o, ['convention', 'preference', 'lesson']);
  if (list.length === 0) return undefined;
  const budget = tokens * 3.5;
  const full: string[] = [];
  const titles: string[] = [];
  let used = 0;
  for (const e of list) {
    const line = `- [${KIND_LABEL[e.kind]}] ${e.title}: ${e.text.replace(/\s+/g, ' ')}`;
    if (used + line.length <= budget) {
      full.push(line);
      used += line.length + 1;
    } else titles.push(`- ${e.title} (id ${e.id})`);
  }
  const text = [...full, ...(titles.length > 0 ? ['', 'Hay más; léelas con la herramienta memoria_proyecto si te hacen falta:', ...titles] : [])].join('\n');
  return { text, ids: list.map((e) => e.id) };
}

/** `MEMORIA.md`: el índice legible por ámbito [R76.2]. */
export function memoryIndexMarkdown(entries: readonly MemoryEntry[]): string {
  const active = entries.filter((e) => e.status === 'active');
  const scopes = [...new Set(active.map((e) => e.scope))].sort((a, b) => (a === 'project' ? -1 : b === 'project' ? 1 : a.localeCompare(b)));
  const out = ['# Memoria del proyecto', '', 'Lo que el proyecto ha aprendido, aprobado por una persona. Se edita desde la app.', ''];
  for (const s of scopes) {
    out.push(`## ${s === 'project' ? 'Proyecto' : s.startsWith('agent:') ? `Agente ${s.slice(6)}` : `Diagrama ${s.slice(8)}`}`, '');
    for (const e of active.filter((x) => x.scope === s)) out.push(`- **${e.title}** (${KIND_LABEL[e.kind].toLowerCase()}): ${e.text}`);
    out.push('');
  }
  return `${out.join('\n').trimEnd()}\n`;
}

/** Búsqueda por texto de `memoria_proyecto` [R76.15]. */
export function searchMemory(entries: readonly MemoryEntry[], scopes: readonly MemoryScope[], query: string, max = 10): MemoryEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return entries
    .filter((e) => e.status === 'active' && scopes.includes(e.scope))
    .map((e) => ({ e, score: words.filter((w) => `${e.title} ${e.text}`.toLowerCase().includes(w)).length }))
    .filter((x) => words.length === 0 || x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.e);
}

/** Texto normalizado para comparar propuestas [R76.11]. */
export const normalMemoryText = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** ¿Sigue valiendo? Sin usar en 60 días, o nombra una ruta que ya no existe [R76.20]. */
export function staleReason(e: MemoryEntry, now: number, exists?: (rel: string) => boolean): 'unused' | 'missing-path' | undefined {
  const last = Date.parse(e.lastUsedAt ?? e.updatedAt);
  if (Number.isFinite(last) && now - last > MEMORY_STALE_DAYS * 86_400_000) return 'unused';
  if (exists) {
    const paths = [...`${e.title} ${e.text}`.matchAll(/`([^`\s]+\/[^`\s]*)`/g)].map((m) => m[1]!.replace(/\/$/, ''));
    if (paths.some((p) => !p.includes('*') && !exists(p))) return 'missing-path';
  }
  return undefined;
}
