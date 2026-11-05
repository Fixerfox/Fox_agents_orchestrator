// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { newAgent, newContext, newSkill } from '@orquestador/core';
import { createDiagram } from '@orquestador/editor';
import { App } from '../src/App';
import { createMemoryApi } from '../src/memoryApi';

async function mount() {
  const api = createMemoryApi([createDiagram('principal', 'Principal')], {
    agents: [{ ...newAgent('pix', 'Pixelador'), description: 'Pinta', skillIds: ['paleta'] }],
    skills: [
      { ...newSkill('paleta', 'Paleta'), description: 'Colores' },
      { ...newSkill('trazo', 'Trazo'), description: 'Contornos' },
    ],
    contexts: [{ ...newContext('glosario', 'Glosario'), value: 'Términos' }],
  });
  render(<App initialProject="Juego" api={api} agents={[]} confirm={() => true} />);
  await userEvent.click(screen.getByRole('button', { name: /^Proyecto «/ }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Abrir proyecto' }));
  await screen.findByRole('button', { name: 'Añadir «Pixelador» al diagrama' });
  return api;
}

describe('SPEC-033 · conocimiento añadido en la interfaz', () => {
  it('[R33.5][R33.10] «Solo en este paso» añade una skill al paso sin tocar al agente, y se ve enchufada en el lienzo', async () => {
    const api = await mount();
    fireEvent.click(screen.getByRole('button', { name: 'Insertar un paso entre «Entrada» y «Salida»' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Insertar paso' })).getByRole('button', { name: /Pixelador/ }));
    const box = within(await screen.findByRole('group', { name: 'Solo en este paso' }));
    await userEvent.click(box.getByRole('button', { name: /Skill/ }));
    const picker = within(screen.getByRole('dialog', { name: /^Skills · Solo en este paso/ }));
    await userEvent.click(picker.getByRole('button', { name: 'Añadir Trazo' }));
    await userEvent.click(picker.getByRole('button', { name: 'Listo' }));
    expect(within(screen.getByRole('group', { name: 'Solo en este paso' })).getByText('Trazo')).toBeTruthy();
    // en el lienzo aparece enchufada al conector de arriba del paso [R33.10]
    expect(screen.getByRole('group', { name: 'Skill «Trazo» solo en este paso · Obligatoria' })).toBeTruthy();
    await waitFor(() => expect(api.saved.get('principal')!.nodes.find((n) => n.agentId === 'pix')!.extra).toEqual({ skillIds: ['trazo'] }), { timeout: 2000 });
    expect(api.agents.get('pix')!.skillIds).toEqual(['paleta']);
    await userEvent.click(screen.getByRole('button', { name: 'Quitar «Trazo»' }));
    expect(within(screen.getByRole('group', { name: 'Solo en este paso' })).queryByText('Trazo')).toBeNull();
  });

  it('[R33.6] sin nada seleccionado, el panel muestra el diagrama y lo que reciben todos sus agentes', async () => {
    const api = await mount();
    const box = within(await screen.findByRole('group', { name: 'Para todos sus agentes' }));
    expect(screen.getByRole('heading', { name: 'Principal' })).toBeTruthy();
    await userEvent.click(box.getByRole('button', { name: /Contexto/ }));
    const picker = within(screen.getByRole('dialog', { name: /^Contextos · Para todos sus agentes/ }));
    await userEvent.click(picker.getByRole('button', { name: 'Añadir Glosario' }));
    await userEvent.click(picker.getByRole('button', { name: 'Listo' }));
    await waitFor(() => expect(api.saved.get('principal')!.extra).toEqual({ contextIds: ['glosario'] }), { timeout: 2000 });
  });
});
