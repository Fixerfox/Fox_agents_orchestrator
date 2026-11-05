// @vitest-environment jsdom
import './setup';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '../src/App';
import { createMemoryApi } from '../src/memoryApi';

const css = readFileSync(join(__dirname, '..', 'src', 'styles.css'), 'utf8');
const rule = (sel: string) => css.split('\n').find((l) => l.startsWith(`${sel} {`)) ?? '';

describe('la app cabe en la ventana [R19.9][R19.8]', () => {
  it('[R19.9] la raíz y la app recortan (ni el foco puede desplazar la página); la ejecución reparte el alto', () => {
    expect(rule('html, body, #root')).toContain('overflow: clip');
    expect(rule('.orq-app')).toContain('overflow: clip');
    expect(rule('.orq-run__left')).toMatch(/min-height: 0;.*overflow: hidden/);
    expect(rule('.orq-run__bottom')).toContain('clamp(');
  });
  it('[R19.8] la barra superior se arrastra y sus controles no; deja sitio a los botones de ventana', () => {
    expect(css).toMatch(/\.orq-topbar, \.orq-start__top \{[^}]*app-region: drag;[^}]*titlebar-area-width/);
    expect(css).toMatch(/\.orq-topbar :is\(button[^)]*\)[^{]*\{ -webkit-app-region: no-drag/);
  });
});

describe('campo del asistente [R38.3]', () => {
  it('[R38.3] tiene tres líneas de alto como mínimo', async () => {
    render(<App initialProject="P" api={createMemoryApi()} agents={[]} confirm={() => true} />);
    const open = await screen.findAllByRole('button', { name: /asistente/i });
    open[0]!.click();
    const box = (await screen.findByRole('textbox', { name: /escribe|mensaje|asistente/i })) as HTMLTextAreaElement;
    expect(box.rows).toBe(3);
    expect(rule('.orq-assist__box textarea')).toContain('min-height: 66px');
    // ocupa todo el ancho del panel (no se encoge a la derecha)
    expect([...css.matchAll(/^\.orq-assist__form \{[^}]*\}/gm)].at(-1)![0]).toContain('align-items: stretch');
  });
});

describe('los filtros de la biblioteca son píldoras [R38.17]', () => {
  it('[R38.17] «.orq-pick» solo se define una vez (la píldora); Trabajos no la reutiliza', () => {
    expect(css.split('\n').filter((l) => l.startsWith('.orq-pick {'))).toHaveLength(1);
    expect(rule('.orq-pick')).toContain('height: 30px');
  });
});

describe('la vista previa junto al nodo va por encima [R54.2]', () => {
  it('[R54.2] el paso con la tarjeta abierta se pinta por encima de las fichas y de los demás pasos', () => {
    expect(rule('.react-flow__node:has(.orq-node__card)')).toContain('z-index: 2000 !important');
    expect(rule('.orq-node__card')).toContain('z-index');
  });
});
