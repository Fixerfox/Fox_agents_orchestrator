// @vitest-environment jsdom
import './setup';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Palette } from '../src/diagrams/Palette';

const AGENTS = [
  { id: 'dis', name: 'disenador', editable: true },
  { id: 'qa', name: 'qa-disenador', editable: true },
  { id: 'arq', name: 'arquitecto', editable: true },
  { id: 'sprites', name: 'Sprites' },
  { id: 'sonido', name: 'Sonido' },
];
const props = () => ({
  agents: AGENTS,
  examples: [{ id: 'x', name: 'Plantilla X', description: 'algo', diagram: { id: 'x', name: 'X', schemaVersion: 1, nodes: [], edges: [] } }],
  usage: [{ agentId: 'dis', uses: [{ path: [], nodeId: 'n1', label: 'disenador' }] }],
  onAdd: vi.fn(),
  onPickAgent: vi.fn(),
  onAddAgent: vi.fn(),
  onSelectUse: vi.fn(),
  onLoadExample: vi.fn(),
});
const fold = (name: RegExp) => screen.getByRole('button', { name });
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe('SPEC-032 · panel izquierdo plegable [R32.39]', () => {
  it('[R32.39] agrupa los agentes: en este diagrama, del proyecto y de ejemplo (plegado)', () => {
    render(<Palette {...props()} />);
    expect(fold(/^En este diagrama/).textContent).toContain('1');
    expect(fold(/^Del proyecto/).textContent).toContain('2');
    expect(fold(/^De ejemplo/).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Añadir «Sprites» al diagrama' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Añadir «arquitecto» al diagrama' })).toBeTruthy();
    // el nombre del uso ya no se repite debajo del agente
    expect(screen.getAllByText('disenador')).toHaveLength(1);
  });

  it('[R32.39] cada sección se pliega y se recuerda al volver', async () => {
    const first = render(<Palette {...props()} />);
    await userEvent.click(fold(/^Herramientas/));
    expect(fold(/^Herramientas/).getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: '+ Router' })).toBeNull();
    await userEvent.click(fold(/^Plantillas/));
    expect(screen.queryByRole('button', { name: 'Plantilla X' })).toBeNull();
    first.unmount();
    render(<Palette {...props()} />);
    expect(fold(/^Herramientas/).getAttribute('aria-expanded')).toBe('false');
    expect(fold(/^Plantillas/).getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(fold(/^Herramientas/));
    expect(screen.getByRole('button', { name: '+ Router' })).toBeTruthy();
  });

  it('[R32.39] al buscar se despliega todo para ver los resultados', async () => {
    render(<Palette {...props()} />);
    await userEvent.click(fold(/^Tus agentes/));
    await userEvent.type(screen.getByLabelText('Buscar nodo'), 'son');
    expect(screen.getByRole('button', { name: 'Añadir «Sonido» al diagrama' })).toBeTruthy();
  });

  it('[R32.39] sin agentes del proyecto, los de ejemplo se ven desplegados', () => {
    render(<Palette {...props()} agents={[{ id: 'sprites', name: 'Sprites' }]} usage={[]} />);
    expect(screen.getByRole('button', { name: 'Añadir «Sprites» al diagrama' })).toBeTruthy();
  });
});
