// @vitest-environment jsdom
import './setup';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EMPTY_LIVE } from '@orquestador/editor';
import { App } from '../src/App';
import { DRAG_TYPE } from '../src/Canvas';
import { createMemoryApi } from '../src/memoryApi';
import { Toolbar } from '../src/Toolbar';
import { ThemeToggle } from '../src/ThemeToggle';
import { THEME_KEY, applyTheme, loadTheme, nextTheme, saveTheme } from '../src/theme';

const root = join(__dirname, '..', '..', '..');
const css = readFileSync(join(__dirname, '..', 'src', 'styles.css'), 'utf8');
const AGENTS = [
  { id: 'sprites', name: 'Sprites' },
  { id: 'sonido', name: 'Sonido' },
];
const mount = () => render(<App initialProject="Proyecto" api={createMemoryApi()} agents={AGENTS} confirm={() => true} />);

/** Variables de un bloque de la hoja de estilos, a partir de su cabecera. */
function vars(header: string): Record<string, string> {
  const start = css.indexOf(header);
  expect(start, header).toBeGreaterThanOrEqual(0);
  const open = css.indexOf('{', start);
  const end = css.indexOf('}', open);
  const out: Record<string, string> = {};
  for (const m of css.slice(open + 1, end).matchAll(/--([\w-]+):\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe('temas [R21.1]', () => {
  it('[R21.1] el selector recorre automático, claro y oscuro', () => {
    expect(nextTheme('auto')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('auto');
  });

  it('[R21.1] el tema se guarda, se recupera y un valor raro cae en automático', () => {
    const mem = new Map<string, string>();
    const storage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    saveTheme('dark', storage);
    expect(mem.get(THEME_KEY)).toBe('dark');
    expect(loadTheme(storage)).toBe('dark');
    mem.set(THEME_KEY, 'neon');
    expect(loadTheme(storage)).toBe('auto');
    expect(loadTheme({ getItem: () => { throw new Error('bloqueado'); } })).toBe('auto');
    expect(() => saveTheme('light', { setItem: () => { throw new Error('bloqueado'); } })).not.toThrow();
  });

  it('[R21.1] aplicar el tema pone data-theme y en automático lo quita', () => {
    const el = document.createElement('div');
    applyTheme('dark', el);
    expect(el.getAttribute('data-theme')).toBe('dark');
    applyTheme('auto', el);
    expect(el.hasAttribute('data-theme')).toBe(false);
  });

  it('[R21.1] pulsar el selector cambia el tema, lo aplica y lo recuerda', async () => {
    localStorage.clear();
    render(<ThemeToggle />);
    await userEvent.click(screen.getByRole('button', { name: /Tema: Automático/ }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    await userEvent.click(screen.getByRole('button', { name: /Tema: Claro/ }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
    document.documentElement.removeAttribute('data-theme');
  });

  it('[R21.1] el tema guardado se aplica antes de pintar con un script externo', () => {
    const html = readFileSync(join(root, 'apps/desktop/src/renderer/index.html'), 'utf8');
    expect(html.indexOf('theme-init.js')).toBeGreaterThan(0);
    expect(html.indexOf('theme-init.js')).toBeLessThan(html.indexOf('<body'));
    expect(html).not.toMatch(/<script>[^<]/);
    const code = readFileSync(join(root, 'apps/desktop/src/renderer/theme-init.js'), 'utf8');
    const attrs: Record<string, string> = {};
    const fakeDoc = { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } };
    new Function('localStorage', 'document', code)({ getItem: () => 'dark' }, fakeDoc);
    expect(attrs['data-theme']).toBe('dark');
    new Function('localStorage', 'document', code)({ getItem: () => { throw new Error('x'); } }, fakeDoc);
  });

  it('[R21.1] todos los colores salen de variables y el tema automático repite el oscuro', () => {
    const blocks = [':root {', ":root[data-theme='dark'] {", ":root:not([data-theme='light']) {"];
    let rest = css;
    for (const h of blocks) {
      const i = rest.indexOf(h);
      const end = rest.indexOf('}', i);
      rest = rest.slice(0, i) + rest.slice(end + 1);
    }
    expect(rest.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) ?? []).toEqual([]);
    const dark = vars(":root[data-theme='dark'] {");
    const auto = vars(":root:not([data-theme='light']) {");
    for (const [k, v] of Object.entries(auto)) expect(dark[k], k).toBe(v);
    const colorKeys = (h: string) => Object.keys(vars(h)).filter((k) => !['ease', 'font', 'mono'].includes(k)).sort();
    expect(colorKeys(':root {')).toEqual(colorKeys(":root[data-theme='dark'] {"));
  });
});

describe('contraste [R21.2]', () => {
  for (const [name, header] of [['claro', ':root {'], ['oscuro', ":root[data-theme='dark'] {"]] as const) {
    it(`[R21.2] tema ${name}: texto principal y secundario 4,5:1 y bordes de controles 3:1`, () => {
      const v = vars(header);
      for (const surface of ['bg', 'bg-deep', 'card', 'raised']) {
        expect(contrast(v.text!, v[surface]!), `text/${surface}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(v.text2!, v[surface]!), `text2/${surface}`).toBeGreaterThanOrEqual(4.5);
      }
      for (const surface of ['bg', 'card']) {
        expect(contrast(v.muted!, v[surface]!), `muted/${surface}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(v['ctrl-border']!, v[surface]!), `borde/${surface}`).toBeGreaterThanOrEqual(3);
        expect(contrast(v['accent-text']!, v[surface]!), `acento/${surface}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(v.neg!, v[surface]!), `neg/${surface}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(v.pos!, v[surface]!), `pos/${surface}`).toBeGreaterThanOrEqual(3);
      }
      expect(contrast(v['primary-ink']!, v.primary!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v['accent-ink']!, v.accent!)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v['on-neg']!, v.neg!)).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe('iconos y accesibilidad [R21.3][R21.9]', () => {
  it('[R21.3] todos los botones tienen nombre accesible y los de solo icono, tooltip', async () => {
    mount();
    await screen.findByLabelText('Entrada «Entrada»');
    const unnamed = screen.getAllByRole('button').filter((b) => !(b.getAttribute('aria-label') ?? b.textContent ?? '').trim());
    expect(unnamed).toEqual([]);
    for (const b of screen.getAllByRole('button')) {
      if (!(b.textContent ?? '').trim() && b.getAttribute('aria-label')) expect(b.getAttribute('title'), b.getAttribute('aria-label')!).toBe(b.getAttribute('aria-label'));
    }
    // Los iconos van en la barra superior y en la cabecera del Diseñador (editar el diagrama) [R32.38].
    expect(document.querySelectorAll('.orq-topbar svg, .orq-crumbs svg').length).toBeGreaterThan(6);
  });

  it('[R21.9] hay foco visible, objetivos de 32 px y se respeta «reducir movimiento»', () => {
    expect(css).toMatch(/:focus-visible\s*\{[^}]*outline/);
    expect(css).toMatch(/min-height:\s*32px;\s*min-width:\s*32px/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(css).not.toMatch(/transition:\s*all/);
  });

  it('[R21.9] la interfaz se maneja con teclado: los botones son botones y los nodos enfocables', async () => {
    mount();
    const node = await screen.findByLabelText('Entrada «Entrada»');
    expect(node.getAttribute('tabindex')).toBe('0');
    expect(document.querySelectorAll('[onclick],div[role=button]').length).toBe(0);
  });
});

describe('arrastrar desde la paleta [R21.4]', () => {
  const dt = (kind: string) => ({ types: [DRAG_TYPE], getData: (t: string) => (t === DRAG_TYPE ? kind : ''), setData: vi.fn(), effectAllowed: '' });

  it('[R21.4] las filas de la paleta son arrastrables y marcan su tipo', () => {
    mount();
    const row = screen.getByRole('button', { name: '+ Router' });
    expect(row.getAttribute('draggable')).toBe('true');
    const data = dt('');
    fireEvent.dragStart(row, { dataTransfer: data });
    expect(data.setData).toHaveBeenCalledWith(DRAG_TYPE, 'router');
  });

  it('[R21.4] soltar un router en el lienzo lo crea y soltar un agente abre la galería', async () => {
    mount();
    const canvas = screen.getByTestId('canvas');
    fireEvent.drop(canvas, { dataTransfer: dt('router'), clientX: 200, clientY: 120 });
    expect(await screen.findByLabelText(/^Router «Router»/)).toBeTruthy();
    fireEvent.drop(canvas, { dataTransfer: dt('agent'), clientX: 300, clientY: 220 });
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /Sonido/ }));
    expect(await screen.findByLabelText(/^Agente «sonido»/)).toBeTruthy();
  });

  it('[R21.4] soltar algo que no es un nodo no crea nada', () => {
    mount();
    fireEvent.drop(screen.getByTestId('canvas'), { dataTransfer: { types: ['text/plain'], getData: () => 'x' } });
    expect(screen.queryByLabelText(/^Router/)).toBeNull();
  });

  it('[R21.4] el clic sigue añadiendo nodos', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: '+ Bucle' }));
    expect(await screen.findByLabelText(/^Bucle «Bucle»/)).toBeTruthy();
  });
});

describe('tarjetas de nodo [R21.5]', () => {
  it('[R21.5] cada nodo tiene icono, nombre y subtítulo con el agente o el modo', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: '+ Router' }));
    await userEvent.click(screen.getByRole('button', { name: '+ Bucle' }));
    const router = (await screen.findByLabelText(/^Router «Router»/)) as HTMLElement;
    expect(within(router).getByText('decide la IA')).toBeTruthy();
    expect(router.querySelector('.orq-node__icon svg')).toBeTruthy();
    expect(within(screen.getByLabelText(/^Bucle «Bucle»/)).getByText('3 vueltas')).toBeTruthy();
  });

  it('[R21.5] el agente muestra el nombre del agente y un icono de aviso si tiene problemas', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: '+ Agente' }));
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /Sonido/ }));
    const node = (await screen.findByLabelText(/^Agente «sonido», 1 problemas/)) as HTMLElement;
    expect(within(node).getByText('Sonido')).toBeTruthy();
    expect(node.querySelector('.orq-node__problem svg')).toBeTruthy();
  });
});

describe('barra de transporte [R21.6]', () => {
  const live = (over = {}) => ({ ...EMPTY_LIVE, status: 'running' as const, usage: { inputTokens: 9, outputTokens: 0, costUsd: 0 }, ...over });
  const bar = (l = live(), max: number | undefined = 10) =>
    render(<Toolbar canUndo={false} canRedo={false} dirty={false} projectOpen onUndo={() => {}} onRedo={() => {}} onSave={() => {}} onNew={() => {}} onOpenProject={() => {}} onCreateProject={() => {}} live={l} maxTokens={max} onRun={() => {}} onControl={() => {}} />);

  it('[R21.6] quedan N tokens en plural y «Queda 1 token» en singular', () => {
    bar();
    expect(screen.getByText(/Queda 1 token$/)).toBeTruthy();
    bar(live({ usage: { inputTokens: 5, outputTokens: 0, costUsd: 0 } }));
    expect(screen.getByText(/Quedan 5 tokens/)).toBeTruthy();
  });

  it('[R21.6] el medidor refleja lo gastado del tope', () => {
    const { container } = bar(live({ usage: { inputTokens: 5, outputTokens: 0, costUsd: 0 } }));
    expect((container.querySelector('.orq-meter__bar i') as HTMLElement).style.width).toBe('50%');
  });

  it('[R21.6] ejecutar, pausar o reanudar y parar son botones con icono y nombre', () => {
    bar();
    for (const name of ['Lanzar…', 'Pausar', 'Cancelar']) {
      const b = screen.getAllByRole('button', { name })[0]!;
      expect(b.querySelector('svg')).toBeTruthy();
    }
    bar(live({ paused: true }));
    expect(screen.getByRole('button', { name: 'Reanudar' }).querySelector('svg')).toBeTruthy();
  });
});

describe('problemas junto a Ejecutar [R21.7]', () => {
  it('[R21.7][R32.23] no hay panel inferior: los problemas son un contador junto a Ejecutar que abre su lista', async () => {
    mount();
    expect(screen.queryByRole('tab', { name: /Problemas|Resultados/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /avisos?$|errores$/ })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '+ Router' }));
    const chip = await screen.findByRole('button', { name: /avisos?$/ });
    expect(chip.getAttribute('aria-expanded')).toBe('false');
    await userEvent.click(chip);
    expect(screen.getByRole('region', { name: 'Problemas' })).toBeTruthy();
    expect(screen.getByText(/necesita al menos una conexión de salida/)).toBeTruthy();
  });
});

describe('pantallas vacías [R21.8]', () => {
  it('[R21.8] el lienzo vacío, los agentes, las ejecuciones y el registro dicen qué hacer', async () => {
    render(<App initialProject="Proyecto" api={createMemoryApi()} agents={[]} confirm={() => true} />);
    expect(screen.getByText(/Añade un agente desde el panel izquierdo/)).toBeTruthy();
    expect(screen.getByText('Todavía no hay agentes en el proyecto.')).toBeTruthy();
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Secciones' })).getByRole('button', { name: 'Ejecuciones' }));
    expect(await screen.findByText(/Todavía no hay ejecuciones en este proyecto/)).toBeTruthy();
  });
});

describe('paneles plegables [R21.10]', () => {
  it('[R21.10] el panel izquierdo se pliega con «Diagramas» del rail y el derecho con su botón', async () => {
    mount();
    expect(screen.getByRole('complementary', { name: 'Nodos' })).toBeTruthy();
    const diagrams = within(screen.getByRole('navigation', { name: 'Secciones' })).getByRole('button', { name: 'Diseñador' });
    await userEvent.click(diagrams);
    expect(screen.queryByRole('complementary', { name: 'Nodos' })).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Secciones' })).toBeTruthy();
    await userEvent.click(diagrams);
    expect(screen.getByRole('complementary', { name: 'Nodos' })).toBeTruthy();
    // Sin nada seleccionado el derecho no se ve [R33.6]; su botón lo muestra y lo pliega.
    expect(screen.queryByLabelText('Propiedades')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Mostrar panel derecho' }));
    expect(screen.getByLabelText('Propiedades')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Plegar panel derecho' }));
    expect(screen.queryByLabelText('Propiedades')).toBeNull();
  });

  it('[R21.10] la interfaz es usable desde 900 px de ancho', () => {
    expect(css).toMatch(/\.orq-app\s*\{[^}]*min-width:\s*900px/);
  });
});

describe('recursos locales [R21.11]', () => {
  it('[R21.11] las fuentes se empaquetan con la app y nada se pide a la red', () => {
    const main = readFileSync(join(root, 'apps/desktop/src/renderer/main.tsx'), 'utf8');
    expect(main).toContain('@fontsource-variable/geist/index.css');
    expect(main).toContain('@fontsource-variable/geist-mono/index.css');
    expect(readFileSync(join(root, 'scripts/build-desktop.mjs'), 'utf8')).toContain("'.woff2': 'file'");
    expect(css).not.toMatch(/https?:\/\//);
    expect(css).not.toMatch(/@import/);
  });
});
