// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { NavRail } from '../src/shell/NavRail';

describe('orden del rail [R32.13]', () => {
  it('[R32.13] Ejecuciones, Trabajos, Diseñador, Diagramas, Agentes, Conocimiento y Proyecto, en ese orden', () => {
    render(<NavRail section="runs" onGo={vi.fn()} />);
    const names = within(screen.getByRole('navigation')).getAllByRole('button').map((b) => b.textContent);
    expect(names.slice(0, 7)).toEqual(['Ejecuc.', 'Trabajos', 'Diseñador', 'Diagramas', 'Agentes', 'Conocim.', 'Proyecto']);
  });
});
