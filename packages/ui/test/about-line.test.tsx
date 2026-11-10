// @vitest-environment jsdom
import './setup';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AboutLine } from '../src/settings/AboutLine';

describe('SPEC-091 · versión en Ajustes', () => {
  it('[R91.11] enseña «Orquestador <versión>» y la licencia; sin datos de la app, nada', () => {
    const { container, rerender } = render(<AboutLine app={{ version: '0.9.0', platform: 'win32', arch: 'x64' }} />);
    expect(screen.getByTestId('settings-about').textContent).toBe('Orquestador 0.9.0 · Licencia MIT · © Nicolas Corta Avila');
    rerender(<AboutLine app={undefined} />);
    expect(container.textContent).toBe('');
  });
});
