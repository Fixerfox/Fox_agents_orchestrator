// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { exampleTemplates } from '@orquestador/editor';
import { Palette } from '../src/diagrams/Palette';

const palette = (o: Partial<React.ComponentProps<typeof Palette>> = {}) => {
  const props = {
    agents: [],
    examples: exampleTemplates(),
    usage: [],
    onAdd: vi.fn(),
    onPickAgent: vi.fn(),
    onAddAgent: vi.fn(),
    onSelectUse: vi.fn(),
    onLoadExample: vi.fn(),
    ...o,
  };
  render(<Palette {...props} />);
  return props;
};

describe('SPEC-021 · panel izquierdo de Diagramas (prototipo «Editor A»)', () => {
  it('[R21.17][R32.21] un solo panel con Pasos, Tus agentes y Plantillas', () => {
    palette({ agents: [{ id: 'pix', name: 'Pixelador' }] });
    expect(screen.getByRole('complementary', { name: 'Nodos' })).toBeTruthy();
    for (const name of ['Herramientas', 'Tus agentes', 'Plantillas']) expect(screen.getByRole('region', { name })).toBeTruthy();
    expect(screen.getByRole('button', { name: '+ Agente' }).textContent).toBe('Tarea de agente');
    expect(screen.getByRole('button', { name: '+ Router' }).textContent).toBe('Decidir camino');
    expect(screen.getByRole('button', { name: 'Añadir «Pixelador» al diagrama' })).toBeTruthy();
  });

  it('[R21.17] plegado no se muestra', () => {
    palette({ open: false });
    expect(screen.queryByRole('complementary')).toBeNull();
  });

  it('[R21.18] el buscador filtra pasos, agentes y plantillas, avisa si nada coincide y se puede borrar', async () => {
    palette({ agents: [{ id: 'pix', name: 'Pixelador', description: 'Dibuja sprites' }] });
    const box = screen.getByRole('searchbox', { name: 'Buscar nodo' });
    await userEvent.type(box, 'camino');
    expect(screen.getByRole('button', { name: '+ Router' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '+ Agente' })).toBeNull();
    await userEvent.clear(box);
    await userEvent.type(box, 'sprites');
    expect(screen.getByRole('button', { name: 'Añadir «Pixelador» al diagrama' })).toBeTruthy();
    await userEvent.clear(box);
    await userEvent.type(box, 'zzz');
    expect(screen.getByText('Ningún nodo coincide con «zzz».')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Borrar búsqueda' }));
    // Agente, Router, Bucle y Revisión [R34.22].
    // Agente, Router, Bucle, Revisión y Transformar [R37.11], y la Revisión humana [R53.16].
    expect(screen.getAllByRole('button', { name: /^\+ / })).toHaveLength(6);
  });

  it('[R21.18] los pasos se arrastran al lienzo con su tipo', () => {
    palette();
    const data: Record<string, string> = {};
    const dataTransfer = { setData: (k: string, v: string) => (data[k] = v), effectAllowed: '' };
    fireEvent.dragStart(screen.getByRole('button', { name: '+ Bucle' }), { dataTransfer });
    expect(Object.values(data)).toEqual(['loop']);
    expect(dataTransfer.effectAllowed).toBe('copy');
  });

  it('[R37.11] «Transformar datos» también se arrastra al lienzo', () => {
    palette();
    const data: Record<string, string> = {};
    fireEvent.dragStart(screen.getByRole('button', { name: '+ Transformar' }), { dataTransfer: { setData: (k: string, v: string) => (data[k] = v), effectAllowed: '' } });
    expect(Object.values(data)).toEqual(['transform']);
  });

  it('[R53.16][R32.36] «Revisión humana» y «Varios a la vez» también se arrastran', () => {
    palette({ onParallel: vi.fn() });
    for (const [name, kind] of [['+ Revisión humana', 'humanReview'], ['+ Varios a la vez', 'parallel']] as const) {
      const data: Record<string, string> = {};
      const button = screen.getAllByRole('button').find((b) => b.getAttribute('aria-label')?.startsWith(name))!;
      expect(button.getAttribute('draggable')).toBe('true');
      fireEvent.dragStart(button, { dataTransfer: { setData: (k: string, v: string) => (data[k] = v), effectAllowed: '' } });
      expect(Object.values(data)).toEqual([kind]);
    }
  });

  it('[R21.19] sin agentes lo dice y ofrece «Nuevo agente»', async () => {
    const onNewAgent = vi.fn();
    palette({ onNewAgent });
    expect(screen.getByText(/Todavía no hay agentes/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Nuevo agente' }));
    expect(onNewAgent).toHaveBeenCalledTimes(1);
  });

  it('[R21.20] las plantillas son tarjetas con nombre y descripción', async () => {
    const ex = exampleTemplates();
    const p = palette({ examples: ex });
    expect(screen.getAllByText('Cargar en el lienzo')).toHaveLength(ex.length);
    expect(screen.getByText(ex[0]!.description)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: ex[0]!.name }));
    expect(p.onLoadExample).toHaveBeenCalledWith(ex[0]);
  });

  it('[R21.15] cada agente dice cuántas veces se usa y sus usos seleccionan el nodo; pulsarlo añade otro', async () => {
    const use = { nodeId: 'n1', path: ['bucle'], label: 'Dibujar' };
    const p = palette({ agents: [{ id: 'pix', name: 'Pixelador' }], usage: [{ agentId: 'pix', uses: [use, { nodeId: 'n2', path: [], label: 'Retocar' }] }] });
    expect(screen.getByText('2 usos')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /^Ir a un paso de «Pixelador»/ }));
    expect(p.onSelectUse).toHaveBeenCalledWith(use);
    await userEvent.click(screen.getByRole('button', { name: 'Añadir «Pixelador» al diagrama' }));
    expect(p.onAddAgent).toHaveBeenCalledWith('pix');
  });
});
