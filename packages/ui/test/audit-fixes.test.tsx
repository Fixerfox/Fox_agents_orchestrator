// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import userEvent from '@testing-library/user-event';
import { newMcpServer, type Diagram } from '@orquestador/core';
import { t } from '@orquestador/editor';
import { App } from '../src/App';
import { DraftStore } from '../src/common';
import { McpForm } from '../src/knowledge/McpForm';
import { stepTab } from './nav';
import { createMemoryApi } from '../src/memoryApi';
import { FIT_VIEW, offscreen, subtitle } from '../src/diagrams/canvasView';
import { crumbSection } from '../src/runs/runFormat';
import { liveAnnouncement } from '../src/shell/Toolbar';
import { WIDE_PX, useShellLayout } from '../src/shell/useShellLayout';

const AGENTS = [{ id: 'sprites', name: 'Sprites', description: 'Dibuja', model: 'claude-sonnet-5-5' }];

describe('SPEC-063 · interfaz', () => {
  it('[R63.21] «Pídeselo a Claude» de la ficha MCP no guarda la ficha, ni con el botón ni con Intro', async () => {
    const saveMcp = vi.fn(async () => ({ ok: true, value: undefined }));
    const api = new Proxy({ saveMcp }, { get: (o, k) => (k in o ? (o as never)[k] : async () => ({ ok: true, value: [] })) }) as never;
    const def = { ...newMcpServer('github', 'GitHub'), secretsSet: [] } as never;
    const onAskClaude = vi.fn();
    const { container } = render(<McpForm api={api} drafts={new DraftStore()} draftKey="k" original={def} servers={[def]} agents={[]} justSaved={false} onSaved={() => {}} onDeleted={() => {}} onAgentsChanged={() => {}} onAskClaude={onAskClaude} />);
    const box = container.querySelector('.orq-mcpf__askbox input') as HTMLInputElement;
    expect(box.closest('form')?.classList.contains('orq-mcpf__askbox')).toBe(false);
    fireEvent.change(box, { target: { value: 'configúralo' } });
    await userEvent.click(within(box.parentElement!).getByRole('button'));
    fireEvent.change(box, { target: { value: 'otra vez' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await new Promise((r) => setTimeout(r, 10));
    expect(onAskClaude).toHaveBeenCalledTimes(2);
    expect(saveMcp).not.toHaveBeenCalled();
  });

  it('[R63.22] los textos dicen lo que hace el motor', () => {
    expect(t('perm.full.hint')).toContain('escribir fuera de la carpeta');
    expect(t('perm.full.hint')).not.toMatch(/Nunca escribe/);
    expect(t('settings.work.hint')).not.toMatch(/te preguntan antes de modificar/);
    expect(t('rundlg.budget.hint')).toMatch(/se detiene y queda fallida/);
    expect(t('rundlg.budget.hint')).not.toMatch(/pausa/);
    expect(t('runs.live.empty')).toContain('«Lanzar…»');
    expect(t('runs.history.never')).toContain('«Lanzar…»');
  });

  it('[R63.23] encajar el lienzo nunca baja de 0,75', () => {
    expect(FIT_VIEW.minZoom).toBe(0.75);
    expect(FIT_VIEW.maxZoom).toBe(1);
  });

  it('[R63.24] el índice de Ajustes incluye «Supervisor»', async () => {
    render(<App api={createMemoryApi([])} confirm={() => true} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ajustes' }));
    const page = within(await screen.findByRole('region', { name: 'Ajustes' }));
    const link = page.getByRole('link', { name: 'Supervisor' });
    expect(link.getAttribute('href')).toBe('#sec-supervisor');
  });

  it('[R63.25] la tarjeta no repite el nombre del agente si es el del paso', () => {
    const level = { id: 'd', name: 'd', schemaVersion: 1, nodes: [], edges: [] } as Diagram;
    const node = (label: string, more = {}) => ({ id: 'n', kind: 'agent' as const, agentId: 'sprites', label, ...more });
    expect(subtitle(node('Sprites'), { sprites: 'Sprites' }, level)).toBeUndefined();
    expect(subtitle(node('sprites '), { sprites: 'Sprites' }, level)).toBeUndefined();
    expect(subtitle(node('Fondo'), { sprites: 'Sprites' }, level)).toBe('Sprites');
    expect(subtitle(node('Sprites', { model: 'claude-opus-5-5', confirm: true }), { sprites: 'Sprites' }, level)).toBe('Opus 5.5 · confirma');
    expect(subtitle(node('Fondo', { model: 'claude-opus-5-5' }), { sprites: 'Sprites' }, level)).toBe('Sprites · Opus 5.5');
  });

  it('[R63.26] una ejecución terminada cuelga de «Historial»', () => {
    expect(crumbSection({ section: 'live', runId: 'r' }, { status: 'succeeded' })).toBe('history');
    expect(crumbSection({ section: 'live', runId: 'r' }, { status: 'running' })).toBe('live');
    expect(crumbSection({ section: 'live' }, undefined)).toBe('live');
    expect(crumbSection({ section: 'inbox', runId: 'r' }, { status: 'failed' })).toBe('inbox');
  });

  it('[R63.27] una región aria-live anuncia preguntas y el final de la ejecución', () => {
    expect(liveAnnouncement(0, undefined)).toBe('');
    expect(liveAnnouncement(1, undefined)).toBe('Una pregunta espera tu respuesta');
    expect(liveAnnouncement(3, 'succeeded')).toBe('3 preguntas esperan tu respuesta. La ejecución ha terminado: Terminada');
    expect(liveAnnouncement(0, 'running')).toBe('');
    render(<App initialProject="Juego" api={createMemoryApi()} agents={AGENTS} confirm={() => true} />);
    const region = document.querySelector('.orq-topbar .orq-sr');
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(region?.getAttribute('role')).toBe('status');
  });

  it('[R63.28] «Confirmar antes de terminar» es una fila con la casilla junto a su texto', async () => {
    render(<App initialProject="Juego" api={createMemoryApi()} agents={AGENTS} confirm={() => true} />);
    await userEvent.click(screen.getByRole('button', { name: '+ Agente' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Sprites/ }));
    await screen.findByLabelText(/^Agente «/);
    await stepTab('Permisos');
    const box = await screen.findByRole('checkbox', { name: 'Confirmar antes de terminar' });
    const label = box.closest('label')!;
    expect(label.classList.contains('orq-switch')).toBe(true);
    expect(label.textContent).toBe('Confirmar antes de terminar');
  });

  it('[R63.29] se centra el paso elegido solo si queda tapado o fuera', () => {
    const vp = { x: 0, y: 0, zoom: 1 };
    const size = { width: 800, height: 600 };
    expect(offscreen({ x: 100, y: 100, width: 200, height: 60 }, vp, size)).toBe(false);
    expect(offscreen({ x: 700, y: 100, width: 200, height: 60 }, vp, size)).toBe(true);
    expect(offscreen({ x: 100, y: 100, width: 200, height: 60 }, { x: -150, y: 0, zoom: 1 }, size)).toBe(true);
    expect(offscreen({ x: 400, y: 100, width: 200, height: 60 }, { x: 0, y: 0, zoom: 2 }, size)).toBe(true);
  });

  it('[R63.30] en una ventana estrecha, abrir el asistente pliega el submenú de Ejecuciones; la vista de la ejecución se reordena', () => {
    const at = (width: number) => {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
      const { result } = renderHook(() => useShellLayout(false));
      act(() => result.current.setAssistOpen(true));
      return result.current;
    };
    const narrow = at(WIDE_PX - 1);
    expect([narrow.assistOpen, narrow.runsSub, narrow.leftOpen]).toEqual([true, false, true]);
    const wide = at(WIDE_PX + 200);
    expect([wide.assistOpen, wide.runsSub, wide.leftOpen]).toEqual([true, true, true]);
    const css = readFileSync(join(__dirname, '..', 'src', 'styles.css'), 'utf8');
    expect(css).toContain('.orq-run__canvas { position: relative; container-type: inline-size; }');
    expect(css).toMatch(/@container \(max-width: 640px\) \{ \.orq-done \{[^}]*width: 100%/);
    expect(css).toMatch(/@container \(max-width: 760px\) \{ \.orq-run__body \{ flex-direction: column; \}/);
  });
});
