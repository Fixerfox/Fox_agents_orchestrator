import { describe, expect, it } from 'vitest';
import { LIMITS, SKILL_LIMITS, emptyLibraryFolders, validateAgent, validateDiagram, validateSkill, type AgentDefinition, type LibraryFolders } from '@orquestador/core';
import { SPECKIT_AGENTS, SPECKIT_COMMIT, SPECKIT_SKILLS, exampleTemplates, hasSpecKit, installSpecKitInto, specKitDiagram } from '../src';

function memTarget(skills: string[] = [], agents: string[] = []) {
  const saved = { skills: new Map<string, unknown>(), files: new Map<string, string>(), agents: new Map<string, AgentDefinition>(), folders: emptyLibraryFolders() as LibraryFolders };
  return {
    saved,
    target: {
      skillIds: async () => [...skills, ...saved.skills.keys()],
      agentIds: async () => [...agents, ...saved.agents.keys()],
      saveSkill: async (k: { id: string }) => void saved.skills.set(k.id, k),
      saveSkillFile: async (id: string, path: string, text: string) => void saved.files.set(`${id}/${path}`, text),
      saveAgent: async (a: AgentDefinition) => void saved.agents.set(a.id, a),
      getFolders: async () => saved.folders,
      saveFolders: async (f: LibraryFolders) => void (saved.folders = f),
    },
  };
}

describe('SPEC-038 · Spec Kit preinstalado', () => {
  it('[R38.15] trae los 9 comandos de Spec Kit como skills válidas, adaptadas y con su licencia', () => {
    expect(SPECKIT_COMMIT).toMatch(/^[0-9a-f]{40}$/);
    expect(SPECKIT_SKILLS.map((s) => s.id)).toEqual(['speckit-constitution', 'speckit-specify', 'speckit-clarify', 'speckit-plan', 'speckit-tasks', 'speckit-analyze', 'speckit-checklist', 'speckit-implement', 'speckit-converge']);
    for (const s of SPECKIT_SKILLS) {
      expect(validateSkill({ id: s.id, name: s.name, description: s.description, body: s.body })).toEqual([]);
      expect(s.body.length).toBeLessThanOrEqual(SKILL_LIMITS.body);
      expect(s.body).toMatch(/^## Running in Orquestador/);
      expect(s.body).not.toMatch(/__SPECKIT_COMMAND_|\$ARGUMENTS|## Pre-Execution Checks|## Mandatory Post-Execution Hooks/);
      expect(s.files.some((f) => f.path === 'referencias/LICENSE-spec-kit.txt' && /MIT License/.test(f.text))).toBe(true);
    }
    expect(SPECKIT_SKILLS.find((s) => s.id === 'speckit-specify')!.files.map((f) => f.path)).toContain('referencias/spec-template.md');
  });

  it('[R38.16] seis agentes, uno por fase, con sus skills; el diagrama de ejemplo es válido', () => {
    const ids = new Set(SPECKIT_SKILLS.map((s) => s.id));
    expect(SPECKIT_AGENTS).toHaveLength(6);
    for (const a of SPECKIT_AGENTS) {
      expect(validateAgent(a, { contextIds: new Set(), skillIds: ids, mcpIds: new Set() })).toEqual([]);
      expect(a.instructions.length).toBeLessThanOrEqual(LIMITS.instructions);
      expect(a.skillIds.length).toBeGreaterThan(0);
    }
    const covered = new Set(SPECKIT_AGENTS.flatMap((a) => a.skillIds));
    expect([...ids].filter((x) => !covered.has(x))).toEqual([]);
    expect(validateDiagram(specKitDiagram())).toEqual([]);
    expect(exampleTemplates().some((x) => x.id === 'spec-kit')).toBe(true);
  });

  it('[R38.15][R38.16] instala skills, archivos y agentes en la carpeta «Spec Kit» sin tocar lo que ya existe', async () => {
    const { saved, target } = memTarget(['speckit-plan'], ['speckit-tareas']);
    const r = await installSpecKitInto(target);
    expect(r.skills).toHaveLength(8);
    expect(r.agents).toHaveLength(5);
    expect(r.skipped).toEqual(['speckit-plan', 'speckit-tareas']);
    expect(saved.files.has('speckit-specify/referencias/spec-template.md')).toBe(true);
    expect(saved.folders.kinds.skills.items['speckit-specify']).toBe('Spec Kit');
    expect(saved.folders.kinds.agents.items['speckit-implementador']).toBe('Spec Kit');
    expect(saved.folders.kinds.skills.items['speckit-plan']).toBeUndefined();
    expect(hasSpecKit([...saved.skills.keys(), 'speckit-plan'], [...saved.agents.keys(), 'speckit-tareas'])).toBe(true);
    // otra vez: no hace nada
    const again = await installSpecKitInto(target);
    expect(again.skills.length + again.agents.length).toBe(0);
  });

  it('[R38.15] con las skills `speckit-*` importadas pero sin agentes, Spec Kit no está completo y añadirlo crea solo los agentes', async () => {
    // El caso real del 05/11: las skills llegaron de `.claude` con los mismos ids y los agentes nunca se crearon.
    const skillIds = SPECKIT_SKILLS.map((s) => s.id);
    expect(hasSpecKit(skillIds, [])).toBe(false);
    expect(hasSpecKit(skillIds, SPECKIT_AGENTS.slice(1).map((a) => a.id))).toBe(false);
    const { saved, target } = memTarget(skillIds, []);
    const r = await installSpecKitInto(target);
    expect(r.skills).toEqual([]);
    expect(r.agents).toEqual(SPECKIT_AGENTS.map((a) => a.id));
    expect(saved.skills.size).toBe(0);
    expect(hasSpecKit(skillIds, [...saved.agents.keys()])).toBe(true);
    // Los agentes del diagrama de la plantilla quedan todos creados.
    const used = specKitDiagram().nodes.filter((n) => n.kind === 'agent').map((n) => n.agentId!);
    expect(used.filter((id) => !saved.agents.has(id))).toEqual([]);
  });
});

describe('SPEC-039 · contrato y agentes de ejemplo', () => {
  it('[R39.1][R39.7] el contrato acepta askFirst, icono y tono; los agentes de Spec Kit traen icono', async () => {
    const { CHANNELS, parseRequest, ContractError } = await import('../src');
    const { newAgent } = await import('@orquestador/core');
    expect(parseRequest(CHANNELS.saveAgent, { ...newAgent('a', 'A'), askFirst: true, icon: 'bug', tone: 'rose' })).toBeTruthy();
    expect(() => parseRequest(CHANNELS.saveAgent, { ...newAgent('a', 'A'), askFirst: 'x' })).toThrow(ContractError);
    for (const a of SPECKIT_AGENTS) expect(a.icon).toBeTruthy();
  });

  it('[R39.2] create_agent y update_agent aceptan askFirst, icono y tono', async () => {
    const { ASSISTANT_TOOLS } = await import('../src');
    for (const n of ['create_agent', 'update_agent']) expect(Object.keys(ASSISTANT_TOOLS.find((x) => x.name === n)!.params)).toEqual(expect.arrayContaining(['askFirst', 'icon', 'tone']));
  });
});

describe('SPEC-039 · lo obligatorio del agente en el contrato y en Spec Kit', () => {
  it('[R39.12] el contrato acepta required; los agentes de Spec Kit traen su skill principal como obligatoria', async () => {
    const { CHANNELS, parseRequest, ContractError } = await import('../src');
    const { newAgent } = await import('@orquestador/core');
    expect(parseRequest(CHANNELS.saveAgent, { ...newAgent('a', 'A'), skillIds: ['s'], required: { skillIds: ['s'] } })).toBeTruthy();
    expect(() => parseRequest(CHANNELS.saveAgent, { ...newAgent('a', 'A'), required: { otros: ['s'] } })).toThrow(ContractError);
    expect(() => parseRequest(CHANNELS.saveAgent, { ...newAgent('a', 'A'), required: { skillIds: ['../x'] } })).toThrow(ContractError);
    for (const a of SPECKIT_AGENTS) {
      expect(a.required?.skillIds).toHaveLength(1);
      expect(a.skillIds).toContain(a.required!.skillIds![0]);
    }
    expect(SPECKIT_AGENTS.find((a) => a.name.includes('Implementador'))?.required?.skillIds?.[0]).toMatch(/implement/);
  });
});

describe('SPEC-041 · contrato [R41.2][R41.3]', () => {
  it('[R41.2][R41.3] reanudar y cancelar solo aceptan un id de ejecución', async () => {
    const { CHANNELS, parseRequest, ContractError } = await import('../src');
    expect(parseRequest(CHANNELS.resumeRun, 'r1')).toBe('r1');
    expect(parseRequest(CHANNELS.dismissRun, 'r1')).toBe('r1');
    expect(() => parseRequest(CHANNELS.resumeRun, '../x')).toThrow(ContractError);
    expect(() => parseRequest(CHANNELS.dismissRun, 3)).toThrow(ContractError);
  });
});
