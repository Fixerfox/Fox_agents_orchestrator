import type { Id } from '../../shared';
import { pathKey } from '../replay';
import type { RunEvent } from '../events';
import type { RunOptions } from '../run-types';
import { declaredFiles, withinDeclared } from '../text/split';
import { LOOP_WARN, toolSignature } from './watchdog';

/** Lo que detecta una regla [R60.1]. */
export interface SupervisorAlert {
  nodeId: Id;
  path: readonly Id[];
  rule: 'undeclared-file' | 'empty-output' | 'unexpected-branch' | 'retry-loop' | 'budget-burn' | 'tool-loop' | 'instructions-changed';
  detail: string;
}

/** Lo que las reglas recuerdan de la ejecución [R60.2]. */
export interface RuleState {
  declared: Map<string, string[]>;
  agents: Set<string>;
  branch?: string;
  rejected: Map<string, number>;
  spent: Map<string, { tokens: number; costUsd: number }>;
  /** Último reintento de cada paso, para saber si se agotaron al terminar [R63.4]. */
  retries: Map<string, { attempt: number; max: number; message: string }>;
  /** Última herramienta de cada paso y cuántas veces seguidas se repitió [R70.10]. */
  loops: Map<string, { sig: string; count: number }>;
}

export const newRuleState = (): RuleState => ({ declared: new Map(), agents: new Set(), rejected: new Map(), spent: new Map(), retries: new Map(), loops: new Map() });

/** Veces que un Coordinador puede rechazar su reparto: la primera y sus 2 repeticiones [R59.8]. */
const MAX_REJECTIONS = 3;

/** Reglas del Supervisor: solo miran eventos, nunca llaman al motor [R60.2]. */
export function applyRules(state: RuleState, e: RunEvent, budget: RunOptions['budget']): SupervisorAlert[] {
  const path = e.nodePath ?? [];
  const alert = (nodeId: Id, rule: SupervisorAlert['rule'], detail: string): SupervisorAlert[] => [{ nodeId, path, rule, detail }];
  switch (e.type) {
    case 'edge.traversed': {
      const files = e.input ? declaredFiles(e.input.text) : undefined;
      if (files) state.declared.set(pathKey(path, e.toNodeId), files);
      return [];
    }
    case 'agent.request':
      state.agents.add(pathKey(path, e.nodeId));
      state.loops.delete(pathKey(path, e.nodeId));
      return [];
    case 'tool.called': {
      // La misma herramienta con la misma entrada, seguida y sin cambiar archivos [R70.10].
      const key = pathKey(path, e.nodeId);
      const sig = toolSignature(e.tool, e.input);
      const prev = state.loops.get(key);
      const count = prev?.sig === sig ? prev.count + 1 : 1;
      state.loops.set(key, { sig, count });
      return count === LOOP_WARN ? alert(e.nodeId, 'tool-loop', `Repitió ${LOOP_WARN} veces seguidas ${e.tool} con la misma entrada, sin cambiar ningún archivo.`) : [];
    }
    case 'file.produced': {
      state.loops.delete(pathKey(path, e.nodeId));
      // Tocar las instrucciones del proyecto cambia todas las ejecuciones siguientes [R76.19].
      if (!e.reused && INSTRUCTIONS.test(e.path)) return alert(e.nodeId, 'instructions-changed', `${e.change === 'created' ? 'Creó' : 'Cambió'} ${e.path}: eso cambia cómo trabajan los agentes en todas las ejecuciones siguientes.`);
      const declared = state.declared.get(pathKey(path, e.nodeId));
      return declared && !withinDeclared(e.path, declared) ? alert(e.nodeId, 'undeclared-file', `Tocó ${e.path}, que no estaba entre sus archivos (${declared.join(', ')}).`) : [];
    }
    case 'node.finished': {
      const key = pathKey(path, e.nodeId);
      const retry = state.retries.get(key);
      state.retries.delete(key);
      // Agotó los reintentos: falló también el último intento [R63.4].
      if (e.status === 'failed' && retry && retry.attempt + 1 >= retry.max) return alert(e.nodeId, 'retry-loop', `Agotó sus reintentos: ${retry.message}`);
      return e.status === 'succeeded' && state.agents.has(key) && !e.output?.text.trim() ? alert(e.nodeId, 'empty-output', 'Terminó bien, pero sin entregar nada.') : [];
    }
    case 'git.branch': {
      const before = state.branch;
      state.branch = e.branch;
      const explained = e.created === true || e.via === 'head';
      return !explained && before !== undefined && before !== e.branch ? alert(e.nodeId, 'unexpected-branch', `Actuó en la rama ${e.branch} y se venía trabajando en ${before}.`) : [];
    }
    case 'error': {
      // El aviso cuenta el error del último intento [R63.4].
      const retry = e.nodeId !== undefined ? state.retries.get(pathKey(path, e.nodeId)) : undefined;
      if (retry) retry.message = e.message;
      return [];
    }
    case 'node.retrying':
      state.retries.set(pathKey(path, e.nodeId), { attempt: e.attempt, max: e.max, message: e.message });
      return [];
    case 'split.rejected': {
      const key = pathKey(path, e.nodeId);
      const times = (state.rejected.get(key) ?? 0) + 1;
      state.rejected.set(key, times);
      return times >= MAX_REJECTIONS ? alert(e.nodeId, 'retry-loop', 'Repitió el reparto hasta el máximo.') : [];
    }
    case 'agent.usage': {
      if (e.source) return [];
      const key = pathKey(path, e.nodeId);
      const spent = state.spent.get(key) ?? { tokens: 0, costUsd: 0 };
      spent.tokens += e.inputTokens + e.outputTokens;
      spent.costUsd += e.costUsd ?? 0;
      state.spent.set(key, spent);
      const burned = (budget?.maxTokens !== undefined && spent.tokens > budget.maxTokens / 2) || (budget?.maxCostUsd !== undefined && spent.costUsd > budget.maxCostUsd / 2);
      return burned ? alert(e.nodeId, 'budget-burn', 'Este paso ha gastado más de la mitad del presupuesto.') : [];
    }
    default:
      return [];
  }
}

/** Archivos de instrucciones de Claude Code y de otros agentes [R76.19]. */
const INSTRUCTIONS = /(^|\/)(CLAUDE\.md|CLAUDE\.local\.md|AGENTS\.md)$|(^|\/)\.claude\//;

/** La rama de git de una ejecución y quién creó cada una [R60.26]. */
export interface BranchMemory {
  branch?: string;
  creators: Map<string, string>;
}

export const newBranchMemory = (): BranchMemory => ({ creators: new Map() });

export function rememberBranch(memory: BranchMemory, e: Extract<RunEvent, { type: 'git.branch' }>, label: string): void {
  if (e.created && !memory.creators.has(e.branch)) memory.creators.set(e.branch, label);
  if (e.via !== 'ran' || memory.branch === undefined) memory.branch = e.branch;
}

export function branchMemoryLine(memory: BranchMemory): string {
  if (memory.branch === undefined) return '';
  const by = memory.creators.get(memory.branch);
  return `Rama de git: ${memory.branch}${by ? ` (creada por ${by})` : ''}`;
}
