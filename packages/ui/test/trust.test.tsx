// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createDiagram } from '@orquestador/editor';
import { App } from '../src/App';
import { createMemoryApi } from '../src/memoryApi';
import { openSettingsPage, settingsSection } from './nav';

const ITEMS = [
  { file: '.claude/settings.json', key: 'hooks', detail: '1 comando' },
  { file: '.claude/settings.json', key: 'env', detail: 'ANTHROPIC_BASE_URL' },
];

async function mount(trustItems = ITEMS) {
  const api = createMemoryApi([createDiagram('principal', 'Principal')], { trustItems });
  render(<App api={api} confirm={() => true} />);
  await userEvent.click(screen.getByRole('button', { name: 'Crear proyecto' }));
  return api;
}
const dialog = () => screen.findByRole('dialog', { name: '¿Confías en la configuración de Claude Code de este proyecto?' });

describe('SPEC-088 · pantalla de confianza', () => {
  it('[R88.7] E88.a: al abrir un proyecto que trae hooks o env, pregunta enseñando lo que trae; «Ignorarla» lo guarda', async () => {
    const api = await mount();
    const d = within(await dialog());
    const items = within(d.getByRole('list', { name: 'Lo que trae' })).getAllByRole('listitem').map((li) => li.textContent);
    expect(items[0]).toContain('hooks: 1 comando');
    expect(items[1]).toContain('env: ANTHROPIC_BASE_URL');
    await userEvent.click(d.getByRole('button', { name: 'Ignorarla' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await api.projectTrust()).toMatchObject({ ok: true, value: { decision: 'ignored' } });
  });

  it('[R88.7] cerrarlo sin elegir no guarda nada; sin nada que revisar no aparece', async () => {
    const api = await mount();
    await dialog();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(await api.projectTrust()).toMatchObject({ ok: true, value: { decision: null } });
  });

  it('[R88.7] sin nada que revisar, no hay diálogo', async () => {
    await mount([]);
    await screen.findByRole('navigation', { name: 'Secciones' });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('[R88.8] en Ajustes › Claude se ve el estado y «Revisar» abre el mismo diálogo', async () => {
    const api = await mount();
    await userEvent.click(within(await dialog()).getByRole('button', { name: 'Ignorarla' }));
    const s = await openSettingsPage();
    await settingsSection('Claude');
    expect(await s.findByText('Ignorada: los agentes y el asistente usan solo la tuya.')).toBeTruthy();
    await userEvent.click(s.getByRole('button', { name: 'Revisar' }));
    await userEvent.click(within(await dialog()).getByRole('button', { name: 'Confiar' }));
    expect(await s.findByText('Confías en ella: los agentes y el asistente la cargan.')).toBeTruthy();
    expect(await api.projectTrust()).toMatchObject({ ok: true, value: { decision: 'trusted' } });
  });
});
