// @vitest-environment jsdom
import './setup';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuestionCard } from '../src/RunsScreen';

const css = readFileSync(join(__dirname, '..', 'src', 'styles.css'), 'utf8');
const rule = (sel: string) => css.split('\n').find((l) => l.startsWith(`${sel} {`)) ?? '';
const src = readFileSync(join(__dirname, '..', 'src', 'RunsScreen.tsx'), 'utf8');

/** Un permiso con un comando enorme, como el heredoc de gen.py que dejaba los botones fuera de la pantalla. */
const LONG = '¿Puedo ejecutar este comando?\n\n' + Array.from({ length: 200 }, (_, i) => `linea_${i} = 'texto muy largo de un comando'`).join('\n');

describe('una pregunta larga no oculta sus botones', () => {
  it('el texto va en su propia caja con scroll; opciones y respuesta quedan fuera de ella', async () => {
    const onAnswer = vi.fn();
    const { container } = render(<QuestionCard item={{ text: LONG, options: ['Permitir', 'Denegar'] }} from="Implementador" onAnswer={onAnswer} />);
    const box = container.querySelector('.orq-inbox__text')!;
    expect(box).toBeTruthy();
    expect(box.textContent).toContain('linea_199');
    // se puede llegar con el teclado para desplazarlo
    expect(box.getAttribute('tabindex')).toBe('0');
    const allow = screen.getByRole('button', { name: 'Permitir' });
    expect(box.contains(allow)).toBe(false);
    expect(box.contains(screen.getByRole('textbox'))).toBe(false);
    await userEvent.click(allow);
    expect(onAnswer).toHaveBeenCalledWith('Permitir');
  });

  it('la caja del texto tiene alto máximo y scroll; la de una confirmación usa el suyo propio', () => {
    expect(rule('.orq-inbox__text')).toMatch(/max-height: min\(40vh, 360px\);.*overflow: auto/);
    expect(rule('.orq-inbox__item.is-confirm .orq-inbox__text')).toContain('overflow: visible');
    expect(rule('.orq-confirm__doc')).toContain('overflow: auto');
  });

  it('en el detalle de la ejecución las preguntas pendientes tienen alto máximo y scroll propio', () => {
    expect(src).toMatch(/<div className="orq-run__asks">\s*\{live\.pending\.map/);
    const r = rule('.orq-run__asks');
    expect(r).toContain('min-height: 0');
    expect(r).toContain('max-height: 55%');
    expect(r).toContain('overflow: auto');
    // la columna recorta, por eso el contenedor tiene que poder encogerse en vez de salirse
    expect(rule('.orq-run')).toContain('overflow: hidden');
  });
});
