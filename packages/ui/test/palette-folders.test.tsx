// @vitest-environment jsdom
import './setup';
import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { emptyLibraryFolders, newSkill } from '@orquestador/core';
import { createDiagram } from '@orquestador/editor';
import { App } from '../src/App';
import { createMemoryApi } from '../src/memoryApi';

const skill = (id: string, name: string) => ({ ...newSkill(id, name), description: name, body: '# Pasos' });

async function mount() {
  const api = createMemoryApi([createDiagram('principal', 'Principal')], { skills: [skill('suelta', 'Suelta'), skill('pixel', 'Píxel'), skill('paleta', 'Paleta'), skill('plan', 'Plan')] });
  render(<App api={api} confirm={() => true} />);
  await userEvent.click(screen.getByRole('button', { name: 'Crear proyecto' }));
  const folders = emptyLibraryFolders();
  folders.kinds.skills = { folders: ['Arte', 'Arte/Píxel', 'Spec Kit'], items: { pixel: 'Arte/Píxel', paleta: 'Arte', plan: 'Spec Kit' } };
  await api.saveLibraryFolders(folders);
  // Volver al Diseñador relee las carpetas [R93.4].
  const rail = within(screen.getByRole('navigation', { name: 'Secciones' }));
  await userEvent.click(rail.getByRole('button', { name: 'Agentes' }));
  await userEvent.click(rail.getByRole('button', { name: 'Diseñador' }));
  return api;
}
const skillsSection = async () => within(await screen.findByRole('region', { name: 'Skills' }));

beforeEach(() => localStorage.clear());

describe('SPEC-093 · la paleta por carpetas', () => {
  it('[R93.1][R93.4] lo de la raíz primero y después cada carpeta, con su número y las subcarpetas sangradas', async () => {
    await mount();
    const s = await skillsSection();
    const arte = await s.findByRole('button', { name: /^Arte/ });
    expect(arte.textContent).toContain('2');
    expect(s.getByRole('button', { name: /^Píxel/ })).toBeTruthy();
    expect(s.getByRole('button', { name: /^Spec Kit/ })).toBeTruthy();
    const names = s.getAllByRole('listitem').map((li) => li.getAttribute('aria-label'));
    expect(names.indexOf('Arrastra «Suelta» sobre un agente')).toBeLessThan(names.indexOf('Arrastra «Paleta» sobre un agente'));
    expect(s.getByRole('listitem', { name: /«Píxel»/ }).getAttribute('style')).toContain('padding-left');
  });

  it('[R93.2] cada carpeta se pliega y se despliega, y lo recuerda', async () => {
    await mount();
    const s = await skillsSection();
    const arte = await s.findByRole('button', { name: /^Arte/ });
    expect(arte.getAttribute('aria-expanded')).toBe('true');
    await userEvent.click(arte);
    expect(arte.getAttribute('aria-expanded')).toBe('false');
    expect(s.queryByRole('listitem', { name: /«Paleta»/ })).toBeNull();
    // Con la carpeta plegada, su subcarpeta tampoco se ve.
    expect(s.queryByRole('button', { name: /^Píxel/ })).toBeNull();
    expect(JSON.parse(localStorage.getItem('orq-pal-folds') ?? '{}')).toMatchObject({ 'res-skillIds-dir:Arte': true });
  });

  it('[R93.3] al buscar se despliega todo y una carpeta sin coincidencias no aparece', async () => {
    await mount();
    const s = await skillsSection();
    await userEvent.click(await s.findByRole('button', { name: /^Arte/ }));
    await userEvent.type(screen.getByPlaceholderText('Buscar o arrastrar…'), 'Píx');
    await waitFor(async () => expect((await skillsSection()).getByRole('listitem', { name: /«Píxel»/ })).toBeTruthy());
    expect((await skillsSection()).queryByRole('button', { name: /^Spec Kit/ })).toBeNull();
  });
});
