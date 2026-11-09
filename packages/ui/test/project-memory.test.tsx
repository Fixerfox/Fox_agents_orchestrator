// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MEMORY_STALE_DAYS, type MemoryEntry, type RunEvent } from '@orquestador/core';
import { deriveLive, ok, type ProjectApi } from '@orquestador/editor';
import { MemoryEntryCard, MemoryProposals } from '../src/runs/MemoryProposals';
import { NodePanel } from '../src/runs/NodePanel';
import { ProjectMemoryPanel } from '../src/settings/ProjectMemoryPanel';
import { SettingsDialog } from '../src/settings/SettingsDialog';
import { createMemoryApi } from '../src/memoryApi';
import { runAssistantTool, type AssistantHost } from '../src/assistant/assistantTools';

let seq = 0;
const ev = (b: object): RunEvent => ({ runId: 'r1', seq: ++seq, ts: '2026-11-08T10:00:00.000Z', ...b }) as RunEvent;
const NOW = Date.parse('2026-11-08T10:00:00.000Z');
const T = '2026-11-07T10:00:00.000Z';
const entry = (id: string, o: Partial<MemoryEntry> = {}): MemoryEntry => ({ id, kind: 'convention', scope: 'project', title: `Título ${id}`, text: `Texto ${id}`, status: 'active', source: { origin: 'manual' }, createdAt: T, updatedAt: T, uses: 0, history: [{ at: T, action: 'created', by: 'user' }], ...o });

const proposed = ev({
  type: 'memory.proposed',
  proposals: [
    { id: 'p1', action: 'add', kind: 'preference', scope: 'project', title: 'Español', text: 'Escribe en español', origin: 'confirm' },
    { id: 'p2', action: 'update', entryId: 'm1', kind: 'convention', scope: 'agent:dev', title: 'Gestor', text: 'Usa pnpm 9', origin: 'correction', reason: 'Lo corrigió' },
  ],
});

describe('SPEC-076 · «Para recordar»', () => {
  it('[R76.10] cada propuesta con su tipo, ámbito, origen y, en una actualización, la diferencia', () => {
    render(<MemoryProposals events={[proposed]} api={{ decideMemory: vi.fn() }} runId="r1" entries={[entry('m1', { text: 'Usa npm' })]} />);
    const region = within(screen.getByRole('region', { name: 'Para recordar' }));
    const add = within(region.getByRole('listitem', { name: 'Español' }));
    expect(add.getByText('Preferencia')).toBeTruthy();
    expect(add.getByText('Proyecto')).toBeTruthy();
    expect(add.getByText(/de una confirmación con cambios/)).toBeTruthy();
    const upd = within(region.getByRole('listitem', { name: 'Gestor' }));
    expect(upd.getByText('agent:dev')).toBeTruthy();
    expect(upd.getByText('Usa npm').tagName).toBe('DEL');
    expect(upd.getByText('Usa pnpm 9').tagName).toBe('INS');
    expect(upd.getByText('Lo corrigió')).toBeTruthy();
  });

  it('[R76.10][R76.11] «Guardar», «Editar y guardar» y «Descartar» llegan a la API; lo decidido se ve', async () => {
    const decideMemory = vi.fn(async () => ok([] as MemoryEntry[]));
    const { rerender } = render(<MemoryProposals events={[proposed]} api={{ decideMemory }} runId="r1" />);
    const add = within(screen.getByRole('listitem', { name: 'Español' }));
    await userEvent.click(add.getByRole('button', { name: 'Editar y guardar' }));
    const text = add.getByLabelText('Qué hay que recordar');
    await userEvent.clear(text);
    await userEvent.type(text, 'Todo en español');
    await userEvent.click(add.getByRole('button', { name: 'Guardar' }));
    expect(decideMemory).toHaveBeenCalledWith({ runId: 'r1', proposalId: 'p1', decision: 'save', edited: { title: 'Español', text: 'Todo en español' } });
    await userEvent.click(within(screen.getByRole('listitem', { name: 'Gestor' })).getByRole('button', { name: 'Descartar' }));
    expect(decideMemory).toHaveBeenLastCalledWith({ runId: 'r1', proposalId: 'p2', decision: 'discard' });
    rerender(<MemoryProposals events={[proposed, ev({ type: 'memory.decided', proposalId: 'p1', decision: 'save', edited: true, by: 'user' }), ev({ type: 'memory.decided', proposalId: 'p2', decision: 'discard', by: 'user' })]} api={{ decideMemory }} runId="r1" />);
    expect(screen.getByText('Guardada con tus cambios')).toBeTruthy();
    expect(screen.getByText('Descartada')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Guardar' })).toBeNull();
  });

  it('[R76.10] un error al guardar se dice en la propuesta', async () => {
    const decideMemory = vi.fn(async () => ({ ok: false as const, error: { code: 'bad-request', message: 'Parece una clave o un secreto' } }));
    render(<MemoryProposals events={[proposed]} api={{ decideMemory } as never} runId="r1" />);
    await userEvent.click(within(screen.getByRole('listitem', { name: 'Español' })).getByRole('button', { name: 'Guardar' }));
    expect((await screen.findByRole('alert')).textContent).toContain('secreto');
  });

  it('[R76.8] sin propuestas no hay sección', () => {
    const { container } = render(<MemoryProposals events={[]} api={{ decideMemory: vi.fn() }} runId="r1" />);
    expect(container.innerHTML).toBe('');
  });
});

/** API mínima con la memoria en un array, como `RunService`. */
function memApi(initial: MemoryEntry[]) {
  let entries = [...initial];
  const saveMemoryEntry = vi.fn(async (e: Parameters<ProjectApi['saveMemoryEntry']>[0]) => {
    entries = e.id ? entries.map((x) => (x.id === e.id ? { ...x, ...e, status: e.status ?? x.status, history: [...x.history, { at: T, by: 'user' as const, action: e.status !== x.status ? (e.status === 'archived' ? ('archived' as const) : ('restored' as const)) : ('updated' as const) }] } : x)) : [...entries, entry(`n${entries.length}`, e)];
    return ok(entries);
  });
  return { api: { projectMemory: async () => ok(entries), saveMemoryEntry }, saveMemoryEntry };
}

describe('SPEC-076 · pantalla «Memoria del proyecto»', () => {
  const old = new Date(NOW - (MEMORY_STALE_DAYS + 5) * 86_400_000).toISOString();
  const list = [entry('a', { title: 'Usa pnpm', text: 'El gestor es pnpm', source: { origin: 'correction', runId: 'r9' }, uses: 3 }), entry('b', { title: 'Revisor breve', scope: 'agent:rev', kind: 'preference' }), entry('c', { title: 'Vieja', updatedAt: old }), entry('d', { title: 'Archivada', status: 'archived' })];

  it('[R76.21] por ámbito y tipo, con búsqueda, de qué ejecución salió y su historial', async () => {
    const onOpenRun = vi.fn();
    render(<ProjectMemoryPanel api={memApi(list).api} now={NOW} onOpenRun={onOpenRun} />);
    const screenRegion = within(await screen.findByRole('region', { name: 'Memoria del proyecto' }));
    await screenRegion.findByRole('listitem', { name: 'Usa pnpm' });
    expect(screenRegion.getByRole('region', { name: 'Proyecto' })).toBeTruthy();
    expect(within(screenRegion.getByRole('region', { name: 'Agente rev' })).getByText('Preferencia')).toBeTruthy();
    expect(screenRegion.queryByRole('listitem', { name: 'Archivada' })).toBeNull();
    const pnpm = within(screenRegion.getByRole('listitem', { name: 'Usa pnpm' }));
    expect(pnpm.getByText(/de una corrección · usada 3 veces/)).toBeTruthy();
    await userEvent.click(pnpm.getByRole('button', { name: 'Ver la ejecución de la que salió' }));
    expect(onOpenRun).toHaveBeenCalledWith('r9');
    await userEvent.click(pnpm.getByText('Historial'));
    expect(pnpm.getByText(/creada/)).toBeTruthy();
    await userEvent.type(screenRegion.getByLabelText('Buscar en la memoria'), 'breve');
    expect(screenRegion.queryByRole('listitem', { name: 'Usa pnpm' })).toBeNull();
    expect(screenRegion.getByRole('listitem', { name: 'Revisor breve' })).toBeTruthy();
  });

  it('[R76.20][R76.21] «¿Siguen valiendo?» filtra las que no se usan; archivar y restaurar', async () => {
    const { api, saveMemoryEntry } = memApi(list);
    render(<ProjectMemoryPanel api={api} now={NOW} />);
    const region = within(await screen.findByRole('region', { name: 'Memoria del proyecto' }));
    await region.findByRole('listitem', { name: 'Vieja' });
    expect(within(region.getByRole('listitem', { name: 'Vieja' })).getByText('¿Sigue valiendo?')).toBeTruthy();
    await userEvent.click(region.getByRole('button', { name: '¿Siguen valiendo?' }));
    expect(region.getAllByRole('listitem').map((li) => li.getAttribute('aria-label')).filter(Boolean)).toEqual(['Vieja']);
    await userEvent.click(within(region.getByRole('listitem', { name: 'Vieja' })).getByRole('button', { name: 'Archivar' }));
    expect(saveMemoryEntry).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'c', status: 'archived' }));
    await userEvent.click(region.getByRole('button', { name: 'Archivadas' }));
    await userEvent.click(within(region.getByRole('listitem', { name: 'Archivada' })).getByRole('button', { name: 'Restaurar' }));
    expect(saveMemoryEntry).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'd', status: 'active' }));
  });

  it('[R76.21] añadir y editar a mano', async () => {
    const { api, saveMemoryEntry } = memApi([entry('a', { title: 'Usa pnpm' })]);
    render(<ProjectMemoryPanel api={api} now={NOW} />);
    const region = within(await screen.findByRole('region', { name: 'Memoria del proyecto' }));
    await region.findByRole('listitem', { name: 'Usa pnpm' });
    await userEvent.click(region.getByRole('button', { name: 'Añadir' }));
    const form = within(region.getByRole('form', { name: 'Entrada de la memoria' }));
    await userEvent.type(form.getByLabelText('Título'), 'Tests');
    await userEvent.type(form.getByLabelText('Qué hay que recordar'), 'Ejecuta npm test');
    await userEvent.click(form.getByRole('button', { name: 'Guardar' }));
    expect(saveMemoryEntry).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Tests', text: 'Ejecuta npm test', scope: 'project' }));
    await userEvent.click(within(region.getByRole('listitem', { name: 'Usa pnpm' })).getByRole('button', { name: 'Editar' }));
    const edit = within(region.getByRole('form', { name: 'Entrada de la memoria' }));
    await userEvent.clear(edit.getByLabelText('Título'));
    await userEvent.type(edit.getByLabelText('Título'), 'Usa pnpm 9');
    await userEvent.click(edit.getByRole('button', { name: 'Guardar' }));
    expect(saveMemoryEntry).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'a', title: 'Usa pnpm 9' }));
  });

  it('[R76.4] al pasar de 200 activas avisa de que conviene archivar', async () => {
    render(<ProjectMemoryPanel api={memApi(Array.from({ length: 201 }, (_, i) => entry(`m${i}`))).api} now={NOW} />);
    expect((await screen.findByRole('status')).textContent).toContain('201 entradas activas');
  });
});

describe('SPEC-076 · lo que recibió cada paso', () => {
  it('[R76.22] junto a lo que recibió el paso se ve su memoria del proyecto y cada entrada abre su ficha', async () => {
    const events = [ev({ type: 'node.started', nodeId: 'a', input: { text: '', files: [] } }), ev({ type: 'agent.request', nodeId: 'a', agentId: 'a', attempt: 1, input: { text: 'x', files: [] }, projectMemory: ['m1', 'm2'] })];
    const onMemoryEntry = vi.fn();
    render(<NodePanel events={events} live={deriveLive(events)} nodeId="a" nodePath={[]} label="Dev" onAnswer={vi.fn()} onMemoryEntry={onMemoryEntry} memoryTitles={{ m1: 'Usa pnpm' }} />);
    await userEvent.click(screen.getByText('Memoria del proyecto que recibió (2)'));
    await userEvent.click(screen.getByRole('button', { name: 'Usa pnpm' }));
    expect(onMemoryEntry).toHaveBeenCalledWith('m1');
    expect(screen.getByRole('button', { name: 'm2' })).toBeTruthy();
  });

  it('[R76.22] la ficha dice tipo, ámbito, texto y origen; si ya no existe, lo dice', () => {
    const { rerender } = render(<MemoryEntryCard id="m1" entry={entry('m1', { title: 'Usa pnpm', text: 'El gestor es pnpm', uses: 2 })} onClose={vi.fn()} />);
    const card = within(screen.getByRole('dialog', { name: 'Usa pnpm' }));
    expect(card.getByText('Convención')).toBeTruthy();
    expect(card.getByText('El gestor es pnpm')).toBeTruthy();
    expect(card.getByText(/añadida a mano · usada 2 veces/)).toBeTruthy();
    rerender(<MemoryEntryCard id="m9" entry={undefined} onClose={vi.fn()} />);
    expect(screen.getByText('Esta entrada ya no está en la memoria del proyecto.')).toBeTruthy();
  });
});

describe('SPEC-076 · Ajustes › Memoria', () => {
  it('[R76.14][R76.18] tope de la memoria del proyecto y la memoria propia de Claude Code, apagada por defecto', async () => {
    const api = createMemoryApi([], {});
    render(<SettingsDialog api={api} onSaved={() => undefined} />);
    const page = within(screen.getByRole('region', { name: 'Ajustes' }));
    await page.findByRole('heading', { name: 'Claude' });
    await userEvent.click(within(page.getByRole('navigation', { name: 'Ajustes' })).getByRole('button', { name: /^Memoria/ }));
    expect((page.getByLabelText(/Tope de la memoria del proyecto/) as HTMLInputElement).value).toBe('1500');
    const auto = page.getByLabelText('Dejar que Claude Code guarde su propia memoria') as HTMLInputElement;
    expect(auto.checked).toBe(false);
    expect(page.getByText(/local a este equipo y no se ve en la app/)).toBeTruthy();
    await userEvent.click(auto);
    await waitFor(async () => {
      const s = await api.getSettings();
      expect(s.ok && s.value.claudeAutoMemory).toBe(true);
    });
  });
});

describe('SPEC-076 · el asistente', () => {
  it('[R76.12] save_memory guarda como asistente y list_memory lo encuentra', async () => {
    const saveMemoryEntry = vi.fn(async (e: Parameters<ProjectApi['saveMemoryEntry']>[0]) => ok([entry('m1', { ...e, source: { origin: 'assistant' } })]));
    const host = { api: { saveMemoryEntry, projectMemory: async () => ok([entry('m1', { title: 'Usa pnpm' }), entry('m2', { title: 'Otra' })]) }, refresh: () => {} } as unknown as AssistantHost;
    const saved = await runAssistantTool(host, 'save_memory', { kind: 'convention', scope: 'project', title: 'Usa pnpm', text: 'Siempre pnpm' });
    expect(saved.ok).toBe(true);
    expect(saveMemoryEntry).toHaveBeenCalledWith({ kind: 'convention', scope: 'project', title: 'Usa pnpm', text: 'Siempre pnpm', status: 'active', by: 'assistant' });
    const listed = await runAssistantTool(host, 'list_memory', { query: 'pnpm' });
    expect((listed.result as { id: string }[]).map((e) => e.id)).toEqual(['m1']);
  });
});
