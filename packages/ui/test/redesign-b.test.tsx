// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { newAgent, newContext, newSkill, type AgentDefinition } from '@orquestador/core';
import { createDiagram } from '@orquestador/editor';
import { App } from '../src/App';
import { createMemoryApi, type MemoryApiOptions } from '../src/memoryApi';
import { content, goLib, settingsSaved, stepTab } from './nav';

const enc = new TextEncoder();
const agent = (id: string, name: string, patch: Partial<AgentDefinition> = {}): AgentDefinition => ({ ...newAgent(id, name), ...patch });
const rail = () => within(screen.getByRole('navigation', { name: 'Secciones' }));
async function mount(options: MemoryApiOptions = {}) {
  const api = createMemoryApi([createDiagram('principal', 'Principal')], options);
  render(<App api={api} agents={[{ id: 'sprites', name: 'Sprites', description: 'Pinta' }]} confirm={() => true} />);
  await userEvent.click(screen.getByRole('button', { name: 'Crear proyecto' }));
  return api;
}

describe('SPEC-032 · M7b navegación y biblioteca', () => {
  it('[R32.13][R52.5] un rail global lleva a cada sección a pantalla completa y marca la activa', async () => {
    await mount();
    const names = rail().getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual(['Ejecuciones', 'Trabajos', 'Diseñador', 'Diagramas', 'Agentes', 'Conocimiento', 'Proyecto', 'Ajustes']);
    expect(rail().getByRole('button', { name: 'Diseñador' }).getAttribute('aria-current')).toBe('page');
    for (const [btn, region] of [
      ['Agentes', 'Agentes'],
      ['Conocimiento', 'Conocimiento'],
      ['Trabajos', 'Trabajos'],
      ['Ejecuciones', 'Ejecuciones'],
      ['Proyecto', 'Proyecto'],
      ['Ajustes', 'Ajustes'],
    ] as const) {
      await userEvent.click(rail().getByRole('button', { name: btn }));
      expect(screen.getByRole('region', { name: region })).toBeTruthy();
      expect(rail().getByRole('button', { name: btn }).getAttribute('aria-current')).toBe('page');
      expect(screen.queryByRole('dialog')).toBeNull();
    }
  });

  it('[R32.14] el editor del agente tiene cabecera fija con «Sin guardar», Descartar y Guardar con Ctrl+S', async () => {
    const api = await mount({ agents: [agent('a', 'Alfa', { description: 'Hace cosas' })] });
    const s = await goLib('agents');
    await userEvent.click(s.getByRole('button', { name: 'Alfa' }));
    expect(s.queryByText('Sin guardar')).toBeNull();
    await userEvent.type(s.getByLabelText('Instrucciones'), 'Nuevas');
    expect(s.getByText('Sin guardar')).toBeTruthy();
    await userEvent.click(s.getByRole('button', { name: 'Descartar' }));
    expect((s.getByLabelText('Instrucciones') as HTMLTextAreaElement).value).toBe('');
    await userEvent.type(s.getByLabelText('Instrucciones'), 'Guárdame');
    fireEvent.keyDown(s.getByLabelText('Instrucciones'), { key: 's', ctrlKey: true });
    await waitFor(() => expect(api.agents.get('a')?.instructions).toBe('Guárdame'));
    expect(s.getByRole('button', { name: 'Guardar' }).getAttribute('aria-keyshortcuts')).toBe('Control+S');
  });

  it('[R32.14] el identificador y el máximo de turnos van en «Avanzado» y se ve dónde se usa', async () => {
    await mount({ agents: [agent('a', 'Alfa')] });
    const s = await goLib('agents');
    await userEvent.click(s.getByRole('button', { name: 'Alfa' }));
    await userEvent.click(s.getByRole('button', { name: /^Modelo y aspecto/ }));
    const adv = s.getByText('Avanzado').closest('details')!;
    expect(adv.hasAttribute('open')).toBe(false);
    expect(within(adv).getByText('Identificador:')).toBeTruthy();
    expect(within(adv).getByLabelText(/Máximo de turnos/)).toBeTruthy();
    await userEvent.click(s.getByRole('button', { name: /^Dónde se usa/ }));
    expect(await s.findByText('Aún no está en ningún diagrama')).toBeTruthy();
  });

  it('[R32.15] cada contexto dice cuántos agentes lo usan y se asigna o quita desde «Lo usan»', async () => {
    const api = await mount({ agents: [agent('a', 'Alfa', { contextIds: ['paleta'] }), agent('b', 'Beta')], contexts: [{ ...newContext('paleta', 'Paleta'), value: 'rojo' }] });
    const s = await goLib('contexts');
    expect(s.getByText('1 agente')).toBeTruthy();
    await userEvent.click(s.getByRole('button', { name: 'Paleta' }));
    const used = within(s.getByRole('region', { name: 'Lo usan' }));
    expect(used.getByText('Alfa')).toBeTruthy();
    await userEvent.selectOptions(used.getByLabelText('Asignar a un agente…'), 'b');
    await waitFor(() => expect(api.agents.get('b')?.contextIds).toEqual(['paleta']));
    await userEvent.click(await used.findByRole('button', { name: 'Quitar de «Alfa»' }));
    await waitFor(() => expect(api.agents.get('a')?.contextIds).toEqual([]));
    expect(await s.findByText('1 agente')).toBeTruthy();
  });

  it('[R32.15] una skill también muestra «Lo usan»; sin guardar explica que hay que guardarla', async () => {
    await mount({ agents: [agent('a', 'Alfa', { skillIds: ['pix'] })], skills: [{ ...newSkill('pix', 'Pix'), description: 'Pinta' }] });
    const s = await goLib('skills');
    await userEvent.click(s.getByRole('button', { name: 'Pix' }));
    expect(within(s.getByRole('region', { name: 'Lo usan' })).getByText('Alfa')).toBeTruthy();
    await userEvent.click(s.getByRole('button', { name: 'Nueva skill' }));
    await userEvent.click(s.getByRole('button', { name: 'Escribir' }));
    expect(within(s.getByRole('region', { name: 'Lo usan' })).getByText('Guárdalo primero para asignarlo a agentes.')).toBeTruthy();
  });
});

describe('SPEC-032 · M7b carpeta del proyecto', () => {
  const files = [
    { path: 'agents/pixelador.md', data: enc.encode('---\nname: pixelador\ndescription: Pinta sprites\nskills: pixel-art\n---\nDibuja.\n') },
    { path: 'skills/pixel-art/SKILL.md', data: enc.encode('---\nname: pixel-art\ndescription: Paleta limitada\n---\n# Pasos\n') },
    { path: '.mcp.json', data: enc.encode('{"mcpServers":{"pixelart-mcp":{"command":"npx"}}}') },
  ];
  const options: MemoryApiOptions = {
    agents: [agent('dev', 'Dev')],
    workFolderPick: { name: 'INCWars', files: 412 },
    workFolderTree: { files, summary: 'INCWars/\n  juego/\n  assets/', docs: [{ name: 'CLAUDE.md', text: '# Normas\nTodo en español.' }] },
  };

  it('[R32.17][R32.24] «Desde la carpeta de un proyecto» abre el asistente: carpeta, hallazgos y revisión', async () => {
    const api = createMemoryApi([createDiagram('principal', 'Principal')], options);
    render(<App api={api} confirm={() => true} />);
    await userEvent.click(screen.getByRole('button', { name: 'Desde la carpeta de un proyecto' }));
    const wiz = within(await screen.findByRole('region', { name: 'Conectar la carpeta del proyecto' }));
    expect(wiz.getByText('Carpeta').closest('li')?.getAttribute('aria-current')).toBe('step');
    await userEvent.click(wiz.getByRole('button', { name: 'Elegir carpeta…' }));
    expect(await wiz.findByText('INCWars')).toBeTruthy();
    expect(await wiz.findByText('✓ 1 agentes de Claude Code')).toBeTruthy();
    expect(wiz.getByText('✓ 1 skills')).toBeTruthy();
    expect(wiz.getByText('✓ Documentos guía: CLAUDE.md')).toBeTruthy();
    expect(wiz.getByText(/1 servidores MCP/)).toBeTruthy();
    expect(wiz.getByText(/juego\//)).toBeTruthy();
    await userEvent.click(wiz.getByRole('button', { name: 'Revisar propuesta' }));
    expect(wiz.getByText('Revisar').closest('li')?.getAttribute('aria-current')).toBe('step');
    expect((wiz.getByRole('checkbox', { name: /pixelador/ }) as HTMLInputElement).checked).toBe(true);
    expect(within(wiz.getByRole('region', { name: 'pixelart-mcp' })).getByText('llega apagado')).toBeTruthy();
    expect(wiz.getByText('Modificar o sobrescribir existentes')).toBeTruthy();
  });

  it('[R32.17] aplicar instala lo marcado, crea el contexto común y lo asigna a todos los agentes', async () => {
    const api = await mount(options);
    await userEvent.click(rail().getByRole('button', { name: 'Proyecto' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Conectar la carpeta del proyecto' }));
    const wiz = within(await screen.findByRole('region', { name: 'Conectar la carpeta del proyecto' }));
    await userEvent.click(wiz.getByRole('button', { name: 'Elegir carpeta…' }));
    await userEvent.click(await wiz.findByRole('button', { name: 'Revisar propuesta' }));
    const summary = wiz.getByRole('textbox', { name: 'Resumen del proyecto' }) as HTMLTextAreaElement;
    expect(summary.value).toContain('INCWars/');
    await userEvent.type(summary, '\nJuego de estrategia');
    await userEvent.click(wiz.getByRole('button', { name: 'Crear con esta propuesta' }));
    expect(await wiz.findByText('Proyecto conectado a INCWars')).toBeTruthy();
    expect(api.agents.get('pixelador')?.skillIds).toEqual(['pixel-art']);
    const ctx = [...api.contexts.values()];
    expect(ctx.map((c) => c.name).sort()).toEqual(['CLAUDE.md', 'Resumen del proyecto']);
    expect(ctx.find((c) => c.name === 'Resumen del proyecto')?.value).toContain('Juego de estrategia');
    for (const a of api.agents.values()) expect([...a.contextIds].sort()).toEqual(ctx.map((c) => c.id).sort());
    await userEvent.click(wiz.getByRole('button', { name: 'Ver el proyecto' }));
    const proj = within(await screen.findByRole('region', { name: 'Proyecto' }));
    expect(await proj.findByText('INCWars')).toBeTruthy();
    expect(proj.getByText('pixelador')).toBeTruthy();
  });

  it('[R30.6] marcar un MCP de la carpeta lo añade al proyecto apagado; sin marcar no se añade', async () => {
    const api = await mount(options);
    await userEvent.click(rail().getByRole('button', { name: 'Proyecto' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Conectar la carpeta del proyecto' }));
    const wiz = within(await screen.findByRole('region', { name: 'Conectar la carpeta del proyecto' }));
    await userEvent.click(wiz.getByRole('button', { name: 'Elegir carpeta…' }));
    await userEvent.click(await wiz.findByRole('button', { name: 'Revisar propuesta' }));
    const box = wiz.getByRole('checkbox', { name: 'pixelart-mcp' }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    await userEvent.click(box);
    await userEvent.click(wiz.getByRole('button', { name: 'Crear con esta propuesta' }));
    await wiz.findByText('Proyecto conectado a INCWars');
    expect(api.mcp.get('pixelart-mcp')).toMatchObject({ command: 'npx', enabled: false });
  });

  it('[R32.17] desmarcar un agente no lo instala; cancelar no instala nada', async () => {
    const api = await mount(options);
    await userEvent.click(rail().getByRole('button', { name: 'Proyecto' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Conectar la carpeta del proyecto' }));
    let wiz = within(await screen.findByRole('region', { name: 'Conectar la carpeta del proyecto' }));
    await userEvent.click(wiz.getByRole('button', { name: 'Elegir carpeta…' }));
    await userEvent.click(await wiz.findByRole('button', { name: 'Cancelar' }));
    expect(api.agents.has('pixelador')).toBe(false);
    await userEvent.click(await screen.findByRole('button', { name: 'Analizar de nuevo' }));
    wiz = within(await screen.findByRole('region', { name: 'Conectar la carpeta del proyecto' }));
    await userEvent.click(await wiz.findByRole('button', { name: 'Revisar propuesta' }));
    await userEvent.click(wiz.getByRole('checkbox', { name: /pixelador/ }));
    await userEvent.click(wiz.getByRole('button', { name: 'Crear con esta propuesta' }));
    await wiz.findByText('Proyecto conectado a INCWars');
    expect(api.agents.has('pixelador')).toBe(false);
    expect(api.skills.has('pixel-art')).toBe(true);
  });
});

describe('SPEC-032 · M7b panel del nodo, inicio y ajustes', () => {
  it('[R32.22][R52.8][R64.4] el panel del nodo es «Paso», sin «Última ejecución», con conocimiento del agente, enlace a editarlo y Duplicar', async () => {
    await mount({ agents: [agent('pix', 'Pixelador', { skillIds: ['k'], contextIds: ['c'] })], skills: [{ ...newSkill('k', 'pixel-art'), description: 'x' }], contexts: [{ ...newContext('c', 'Paleta'), value: 'r' }] });
    await userEvent.click(await screen.findByRole('button', { name: 'Añadir «Pixelador» al diagrama' }));
    await screen.findByLabelText(/^Agente «pix»/);
    expect(screen.getByText('Paso', { selector: '.orq-side__title' })).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Última ejecución' })).toBeNull();
    await stepTab('Conocimiento');
    const know = within(screen.getByRole('group', { name: 'Conocimiento' }));
    expect(know.getByText('pixel-art')).toBeTruthy();
    expect(know.getByText('Paleta')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Duplicar' }));
    expect(await screen.findAllByLabelText(/^Agente «pix/)).toHaveLength(2);
    await stepTab('Agente');
    await userEvent.click(screen.getByRole('button', { name: 'Editar el agente' }));
    // abre «Configurar» en «El agente»; desde ahí se llega a Agentes
    await userEvent.click(within(screen.getByRole('dialog', { name: /^Configurar «/ })).getByRole('button', { name: 'Abrir en Agentes' }));
    const s = content();
    expect(screen.getByRole('region', { name: 'Agentes' })).toBeTruthy();
    expect((s.getByLabelText('Nombre') as HTMLInputElement).value).toBe('Pixelador');
  });

  it('[R32.22] cerrar el panel quita la selección', async () => {
    await mount();
    await userEvent.click(screen.getByRole('button', { name: '+ Router' }));
    await screen.findByText('Paso', { selector: '.orq-side__title' });
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar el panel' }));
    await waitFor(() => expect(screen.queryByText('Paso', { selector: '.orq-side__title' })).toBeNull());
    expect(screen.getByText('Selecciona un nodo o una conexión')).toBeTruthy();
  });

  it('[R32.24] el inicio pregunta qué orquestar, ofrece tres caminos y los recientes como tabla', async () => {
    const api = createMemoryApi([], { recent: [{ id: 'r1', name: 'Juego', folder: 'Juegos / Juego', openedAt: new Date().toISOString(), missing: false }] });
    render(<App api={api} confirm={() => true} />);
    expect(screen.getByRole('heading', { name: '¿Qué vas a orquestar?' })).toBeTruthy();
    for (const name of ['Crear proyecto', 'Desde una plantilla', 'Desde la carpeta de un proyecto', 'Abrir proyecto']) expect(screen.getByRole('button', { name })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Crear proyecto' }).getAttribute('aria-describedby')).toBe('start-c1');
    expect(await screen.findByRole('button', { name: 'Abrir Juego' })).toBeTruthy();
    expect(screen.getByText('Proyecto')).toBeTruthy();
    expect(screen.getByText('Hoy')).toBeTruthy();
  });

  it('[R32.24] «Desde una plantilla» abre Diagramas con las plantillas a mano', async () => {
    render(<App api={createMemoryApi([])} confirm={() => true} />);
    await userEvent.click(screen.getByRole('button', { name: 'Desde una plantilla' }));
    expect(await screen.findByRole('region', { name: 'Plantillas' })).toBeTruthy();
  });

  it('[R32.25] Ajustes es una página con navegación lateral y se guarda sola; desde el inicio tiene «Volver»', async () => {
    const api = createMemoryApi([]);
    render(<App api={api} confirm={() => true} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ajustes' }));
    const page = within(await screen.findByRole('region', { name: 'Ajustes' }));
    expect(page.getAllByRole('link').map((a) => a.textContent)).toEqual(['Claude', 'Reglas de los agentes', 'Presupuesto', 'Supervisor', 'Apariencia']);
    expect(page.getByText(/Los cambios se guardan al momento/)).toBeTruthy();
    await userEvent.click(await page.findByRole('radio', { name: /Claude \(real\)/ }));
    await settingsSaved();
    expect(((await api.getSettings()) as { value: { engine: string } }).value.engine).toBe('claude');
    await userEvent.click(page.getByRole('button', { name: 'Volver' }));
    expect(await screen.findByRole('heading', { name: '¿Qué vas a orquestar?' })).toBeTruthy();
    expect(screen.getByText('Claude')).toBeTruthy();
  });
});

describe('SPEC-032 · M7b revisión de la carpeta', () => {
  it('[R32.17] cada agente muestra las skills que se le asignan y se tachan si se desmarca la skill', async () => {
    const files = [
      { path: 'agents/pixelador.md', data: enc.encode('---\nname: pixelador\ndescription: Pinta\nskills: pixel-art\n---\nDibuja.\n') },
      { path: 'skills/pixel-art/SKILL.md', data: enc.encode('---\nname: pixel-art\ndescription: Paleta\n---\n# Pasos\n') },
    ];
    await mount({ workFolderPick: { name: 'Juego', files: 3 }, workFolderTree: { files, summary: 'Juego/', docs: [] } });
    await userEvent.click(rail().getByRole('button', { name: 'Proyecto' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Conectar la carpeta del proyecto' }));
    const wiz = within(await screen.findByRole('region', { name: 'Conectar la carpeta del proyecto' }));
    await userEvent.click(wiz.getByRole('button', { name: 'Elegir carpeta…' }));
    await userEvent.click(await wiz.findByRole('button', { name: 'Revisar propuesta' }));
    const row = wiz.getByRole('checkbox', { name: /pixelador/ }).closest('label')!;
    const tag = within(row).getByText('pixel-art');
    expect(tag.className).not.toContain('is-off');
    await userEvent.click(wiz.getByRole('checkbox', { name: /^pixel-art/ }));
    expect(within(row).getByText('pixel-art').className).toContain('is-off');
  });
});
