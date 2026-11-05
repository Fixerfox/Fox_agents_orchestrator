// @vitest-environment jsdom
import './setup';
import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MockAgent, MockDecider, Orchestrator, newAgent, newMcpServer, newSkill } from '@orquestador/core';
import { SPECKIT_AGENTS, SPECKIT_SKILLS, createDiagram } from '@orquestador/editor';
import { App } from '../src/App';
import { createMemoryApi, type MemoryApiOptions } from '../src/memoryApi';
import { goLib } from './nav';

async function mount(options: MemoryApiOptions = {}) {
  const api = createMemoryApi([createDiagram('principal', 'Principal')], { agents: [{ ...newAgent('pix', 'Pixelador'), description: 'Pinta sprites' }], ...options });
  render(<App initialProject="Juego" api={api} agents={[]} confirm={() => true} />);
  await userEvent.click(screen.getByRole('button', { name: /^Proyecto «/ }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Abrir proyecto' }));
  await screen.findByRole('button', { name: 'Añadir «Pixelador» al diagrama' });
  return api;
}
const panel = async () => within(await screen.findByRole('region', { name: 'Asistente' }));
const say = async (text: string) => userEvent.type((await panel()).getByLabelText('Mensaje para el asistente'), `${text}{Enter}`);
const goMcp = async () => {
  const s = await goLib('contexts');
  await userEvent.click(s.getByRole('tab', { name: /MCP/ }));
  return s;
};

describe('SPEC-038 · asistente', () => {
  it('[R38.2] el texto de Claude se ve con Markdown y sin HTML', async () => {
    await mount({ assistant: () => [{ text: 'Dime:\n\n1. **Alcance**: `npx -y x`\n2. Otra <b>cosa</b>' }] });
    await userEvent.click(screen.getByRole('button', { name: 'Asistente' }));
    await say('hola');
    const p = await panel();
    const strong = await p.findByText('Alcance');
    expect(strong.tagName).toBe('STRONG');
    expect(p.getByText('npx -y x').tagName).toBe('CODE');
    expect(strong.closest('ol')).toBeTruthy();
    expect(p.getByText(/Otra <b>cosa<\/b>/)).toBeTruthy();
    expect(screen.queryByText('**Alcance**', { exact: false })).toBeNull();
  });

  it('[R38.3] varias consultas seguidas se juntan en una línea; el campo tiene enviar dentro y la ayuda de teclas', async () => {
    await mount({ assistant: () => [{ tool: 'list_agents', args: {} }, { tool: 'list_mcp', args: {} }, { text: 'Tienes un agente.' }] });
    await userEvent.click(screen.getByRole('button', { name: 'Asistente' }));
    const p = await panel();
    expect(p.getByText('Intro envía · Mayús+Intro, nueva línea')).toBeTruthy();
    expect((p.getByRole('button', { name: 'Enviar' }) as HTMLButtonElement).disabled).toBe(true);
    await say('qué hay');
    expect(await p.findByText('Tienes un agente.')).toBeTruthy();
    expect(p.getByText('Ha consultado: ver los agentes, ver los servidores mcp')).toBeTruthy();
    expect(p.queryAllByRole('article')).toHaveLength(0);
    expect(await p.findByRole('button', { name: 'Nueva conversación' })).toBeTruthy();
  });

  it('[R38.5] ask_user muestra botones; la respuesta vuelve a Claude y entra en el historial', async () => {
    const api = await mount({ assistant: (m) => (m.length === 1 ? [{ tool: 'ask_user', args: { question: '¿Dónde lo guardo?', options: ['Solo este proyecto', 'Todos mis proyectos'] } }, { text: 'Perfecto.' }] : [{ text: 'Vale.' }]) });
    await userEvent.click(screen.getByRole('button', { name: 'Asistente' }));
    await say('conecta github');
    const p = await panel();
    const card = within(await p.findByRole('article', { name: 'Acción: Pregunta' }));
    expect(card.getByText('¿Dónde lo guardo?')).toBeTruthy();
    await userEvent.click(card.getByRole('button', { name: 'Todos mis proyectos' }));
    expect(await card.findByText('Has respondido: Todos mis proyectos')).toBeTruthy();
    expect(api.assistantResults[0]).toMatchObject({ name: 'ask_user', ok: true, result: { answer: 'Todos mis proyectos' } });
    expect(await p.findByText('Perfecto.')).toBeTruthy();
    expect(card.queryByRole('button', { name: 'Solo este proyecto' })).toBeNull();
    await say('sigue');
    await waitFor(() => expect(api.assistantTurns).toHaveLength(2));
    expect(api.assistantTurns[1]!.map((m) => m.text)).toContain('¿Dónde lo guardo? → Todos mis proyectos');
  });

  it('[R38.5] también se puede escribir otra respuesta', async () => {
    const api = await mount({ assistant: () => [{ tool: 'ask_user', args: { question: '¿Qué servicio?', options: ['GitHub', 'Notion'] } }] });
    await userEvent.click(screen.getByRole('button', { name: 'Asistente' }));
    await say('mcp');
    const card = within(await (await panel()).findByRole('article', { name: 'Acción: Pregunta' }));
    await userEvent.type(card.getByLabelText('Otra respuesta…'), 'Linear{Enter}');
    await waitFor(() => expect(api.assistantResults[0]).toMatchObject({ result: { answer: 'Linear' } }));
  });

  it('[R38.1][R38.4] se abre en Conocimiento sin cambiar de sección, con sugerencias de MCP, y se cierra', async () => {
    await mount();
    await goMcp();
    await userEvent.click(screen.getByRole('button', { name: 'Asistente' }));
    const p = await panel();
    expect(screen.getByRole('region', { name: 'Conocimiento' })).toBeTruthy();
    expect(p.getByText('en Conocimiento')).toBeTruthy();
    expect(p.getByRole('button', { name: /Conecta GitHub/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Asistente' }).getAttribute('aria-pressed')).toBe('true');
    await userEvent.click(p.getByRole('button', { name: 'Cerrar el asistente' }));
    expect(screen.queryByRole('region', { name: 'Asistente' })).toBeNull();
    // en Agentes, sugerencias de agentes
    await goLib('agents');
    await userEvent.click(screen.getByRole('button', { name: 'Asistente' }));
    expect((await panel()).getByRole('button', { name: /Mejora la descripción/ })).toBeTruthy();
  });
});

describe('SPEC-038 · alta de MCP guiada', () => {
  it('[R38.6][R38.7] «Nuevo» pregunta qué conectar; un servicio se lo pide al asistente al lado y lo creado se abre', async () => {
    const api = await mount({
      assistant: () => [{ tool: 'create_mcp', args: { name: 'GitHub', transport: 'http', url: 'https://api.example.com/mcp', secretNames: ['Authorization'], scope: 'app' } }, { text: 'Creado.' }],
    });
    const s = await goMcp();
    await userEvent.click(s.getByRole('button', { name: 'Nuevo servidor MCP' }));
    const w = within(s.getByRole('region', { name: '¿Qué quieres conectar?' }));
    expect(w.getByRole('note').textContent).toMatch(/motor Claude/);
    await userEvent.click(w.getByRole('radio', { name: 'Todos mis proyectos' }));
    await userEvent.click(w.getByRole('button', { name: /GitHub/ }));
    const p = await panel();
    expect(screen.getByRole('region', { name: 'Conocimiento' })).toBeTruthy();
    expect(await p.findByText('Creado.')).toBeTruthy();
    expect(api.assistantTurns[0]!.at(-1)!.text).toMatch(/^Quiero conectar GitHub como servidor MCP para todos mis proyectos\./);
    // la lista se recarga y se abre el servidor nuevo
    expect(await s.findByRole('button', { name: 'GitHub' })).toBeTruthy();
    expect(await s.findByDisplayValue('https://api.example.com/mcp')).toBeTruthy();
  });

  it('[R38.6] describirlo con tus palabras; «Configurar a mano» abre la ficha; con borrador va directo a la ficha', async () => {
    const api = await mount({ assistant: () => [{ text: 'Vale.' }] });
    const s = await goMcp();
    await userEvent.click(s.getByRole('button', { name: 'Nuevo servidor MCP' }));
    await userEvent.type(s.getByLabelText('Describe el servicio'), 'mi Postgres local{Enter}');
    await waitFor(() => expect(api.assistantTurns[0]!.at(-1)!.text).toMatch(/Quiero conectar mi Postgres local como servidor MCP solo en este proyecto/));
    await userEvent.click(s.getByRole('button', { name: /Configurar a mano/ }));
    await userEvent.type(s.getByLabelText('Nombre'), 'Borrador');
    await userEvent.click(s.getByRole('tab', { name: /Skills/ }));
    await userEvent.click(s.getByRole('tab', { name: /MCP/ }));
    await userEvent.click(s.getByRole('button', { name: 'Nuevo servidor MCP' }));
    expect((s.getByLabelText('Nombre') as HTMLInputElement).value).toBe('Borrador');
  });

  it('[R38.8] «Pegar del README» rellena comando, argumentos y secretos sin copiar valores', async () => {
    const api = await mount();
    const s = await goMcp();
    await userEvent.click(s.getByRole('button', { name: 'Nuevo servidor MCP' }));
    await userEvent.click(s.getByRole('button', { name: /Configurar a mano/ }));
    await userEvent.click(s.getByRole('button', { name: 'Pegar del README' }));
    const box = s.getByLabelText('Comando, JSON o dirección');
    fireEvent.change(box, { target: { value: '{roto' } });
    await userEvent.click(s.getByRole('button', { name: 'Rellenar' }));
    expect(s.getByText(/No lo entiendo/)).toBeTruthy();
    fireEvent.change(box, { target: { value: JSON.stringify({ mcpServers: { notion: { command: 'npx', args: ['-y', '@notionhq/notion-mcp-server'], env: { NOTION_TOKEN: 'ntn_secreto' } } } }) } });
    await userEvent.click(s.getByRole('button', { name: 'Rellenar' }));
    expect((s.getByLabelText('Nombre') as HTMLInputElement).value).toBe('notion');
    expect((s.getByLabelText('Comando') as HTMLInputElement).value).toBe('npx');
    expect((s.getByLabelText('Argumentos (uno por línea)') as HTMLTextAreaElement).value).toBe('-y\n@notionhq/notion-mcp-server');
    expect(s.getByText(/no se copian/)).toBeTruthy();
    expect(s.getByLabelText('Se ejecutará').textContent).toContain('npx -y @notionhq/notion-mcp-server');
    expect(screen.queryByDisplayValue(/ntn_secreto/)).toBeNull();
    await userEvent.click(s.getAllByRole('button', { name: 'Guardar' }).find((b) => b.getAttribute('type') === 'submit')!);
    await waitFor(() => expect(api.mcp.get('notion')).toMatchObject({ command: 'npx', secretNames: ['NOTION_TOKEN'] }));
    expect(JSON.stringify([...api.mcp.values()])).not.toContain('ntn_secreto');
  });

  it('[R38.9] «Lista para usar» dice lo que falta y «Pídeselo a Claude» envía la petición sobre ese servidor', async () => {
    const api = await mount({ mcp: [{ ...newMcpServer('figma', 'Figma'), command: 'npx', args: ['figma-mcp'], secretNames: ['FIGMA_TOKEN'] }], assistant: () => [{ text: 'Hecho.' }] });
    const s = await goMcp();
    await userEvent.click(s.getByRole('button', { name: 'Figma' }));
    const ready = within(s.getByRole('region', { name: 'Lista para usar' }));
    const item = (text: RegExp) => ready.getByText(text).closest('li')!;
    expect(item(/^Nombre$/).className).toBe('is-ok');
    expect(item(/Secretos \(0 de 1\)/).className).toBe('');
    expect(item(/Conexión probada/).className).toBe('');
    await userEvent.click(ready.getByRole('button', { name: 'Probar conexión' }));
    await waitFor(() => expect(item(/Conexión probada/).className).toBe('is-ok'));
    const ask = within(s.getByRole('region', { name: 'Pídeselo a Claude' }));
    await userEvent.type(ask.getByLabelText('Pídeselo a Claude'), 'asígnalo al pixelador{Enter}');
    expect(await (await panel()).findByText('Hecho.')).toBeTruthy();
    expect(api.assistantTurns[0]!.at(-1)!.text).toBe('Sobre el servidor MCP «Figma» (id figma): asígnalo al pixelador');
  });
});

describe('SPEC-038 · carpetas y portada de la biblioteca', () => {
  it('[R38.13][R38.14] crear carpeta, mover, buscar con la ruta, renombrar y quitar sin borrar nada', async () => {
    const api = await mount({ skills: [{ ...newSkill('pixel', 'Píxel'), description: 'Sprites 32×32' }, { ...newSkill('audio', 'Audio'), description: 'Sonidos' }] });
    const s = await goLib('skills');
    await userEvent.click(s.getByRole('button', { name: 'Nueva carpeta' }));
    await userEvent.type(s.getByLabelText('Nombre de la carpeta'), 'Arte{Enter}');
    expect(await s.findByRole('button', { name: 'Carpeta «Arte», 0 elementos' })).toBeTruthy();
    await userEvent.click(s.getByRole('button', { name: 'Mover «Píxel» a' }));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Arte' }));
    await waitFor(() => expect(api.folders().kinds.skills.items).toEqual({ pixel: 'Arte' }));
    expect(await s.findByRole('button', { name: 'Carpeta «Arte», 1 elementos' })).toBeTruthy();
    // plegar oculta lo de dentro
    await userEvent.click(s.getByRole('button', { name: 'Carpeta «Arte», 1 elementos' }));
    expect(s.queryByRole('button', { name: 'Píxel' })).toBeNull();
    // buscar aplana y dice la carpeta
    await userEvent.type(s.getByRole('searchbox'), 'sprites');
    expect(within(s.getByRole('button', { name: 'Píxel' })).getByText(/Arte ·/)).toBeTruthy();
    await userEvent.clear(s.getByRole('searchbox'));
    // renombrar con lo de dentro
    fireEvent.contextMenu(s.getByRole('button', { name: 'Carpeta «Arte», 1 elementos' }));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Renombrar carpeta' }));
    const name = s.getByLabelText('Renombrar carpeta');
    await userEvent.clear(name);
    await userEvent.type(name, 'Gráficos/Píxel{Enter}');
    await waitFor(() => expect(api.folders().kinds.skills).toEqual({ folders: ['Gráficos', 'Gráficos/Píxel'], items: { pixel: 'Gráficos/Píxel' } }));
    // quitar: lo de dentro sube y no se borra nada
    fireEvent.contextMenu(await s.findByRole('button', { name: 'Carpeta «Gráficos», 1 elementos' }));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Quitar carpeta' }));
    await waitFor(() => expect(api.folders().kinds.skills).toEqual({ folders: ['Píxel'], items: { pixel: 'Píxel' } }));
    expect(api.skills.size).toBe(2);
  });

  it('[R38.14] arrastrar un elemento a una carpeta lo mueve; soltarlo en la lista lo saca', async () => {
    const api = await mount({ skills: [newSkill('pixel', 'Píxel')], folders: { schemaVersion: 1, kinds: { agents: { folders: [], items: {} }, skills: { folders: ['Arte'], items: {} }, contexts: { folders: [], items: {} }, mcp: { folders: [], items: {} }, diagrams: { folders: [], items: {} } } } });
    const s = await goLib('skills');
    const data = new Map<string, string>();
    const dataTransfer = { setData: (k: string, v: string) => data.set(k, v), getData: (k: string) => data.get(k) ?? '', get types() { return [...data.keys()]; }, effectAllowed: '', dropEffect: '' };
    fireEvent.dragStart(s.getByRole('button', { name: 'Píxel' }), { dataTransfer });
    const folder = s.getByRole('button', { name: 'Carpeta «Arte», 0 elementos' }).closest('li')!;
    fireEvent.dragOver(folder, { dataTransfer });
    fireEvent.drop(folder, { dataTransfer });
    await waitFor(() => expect(api.folders().kinds.skills.items).toEqual({ pixel: 'Arte' }));
    fireEvent.dragStart(await s.findByRole('button', { name: 'Píxel' }), { dataTransfer });
    fireEvent.drop(s.getByRole('navigation', { name: 'Skills' }), { dataTransfer });
    await waitFor(() => expect(api.folders().kinds.skills.items).toEqual({}));
  });

  it('[R38.13] los agentes también van en carpetas y la portada los agrupa', async () => {
    const api = await mount({ folders: { schemaVersion: 1, kinds: { agents: { folders: ['Arte'], items: { pix: 'Arte' } }, skills: { folders: [], items: {} }, contexts: { folders: [], items: {} }, mcp: { folders: [], items: {} }, diagrams: { folders: [], items: {} } } } });
    const s = await goLib('agents');
    expect(s.getByRole('button', { name: 'Carpeta «Arte», 1 elementos' })).toBeTruthy();
    const overview = within(s.getByRole('region', { name: '1 en Agentes' }));
    expect(within(overview.getByRole('region', { name: 'Arte' })).getByText('Pinta sprites')).toBeTruthy();
    void api;
  });

  it('[R38.17] la portada filtra y pide al asistente con el principio ya escrito', async () => {
    const api = await mount({ skills: [{ ...newSkill('a', 'Con uso'), description: 'x' }, newSkill('b', 'Sin desc')], agents: [{ ...newAgent('pix', 'Pixelador'), description: 'Pinta', skillIds: ['a'] }], assistant: () => [{ text: 'Ok.' }] });
    const s = await goLib('skills');
    const ov = within(s.getByRole('region', { name: '2 en Skills' }));
    await userEvent.click(ov.getByRole('radio', { name: /Sin descripción/ }));
    expect(ov.queryByText('Con uso')).toBeNull();
    expect(ov.getByText('Sin desc')).toBeTruthy();
    await userEvent.type(ov.getByLabelText('Pedírselo al asistente'), 'revise paletas{Enter}');
    await waitFor(() => expect(api.assistantTurns[0]!.at(-1)!.text).toBe('Crea una skill que revise paletas'));
  });

  it('[R38.15][R38.16] «Añadir Spec Kit» instala sus skills y agentes en la carpeta «Spec Kit»', async () => {
    const api = await mount();
    const s = await goLib('skills');
    const kit = within(s.getByRole('group', { name: 'Spec Kit' }));
    await userEvent.click(kit.getByRole('button', { name: 'Añadir Spec Kit' }));
    expect(await kit.findByText(/9 skills y 6 agentes/)).toBeTruthy();
    expect(api.skills.has('speckit-specify')).toBe(true);
    expect(api.agents.get('speckit-implementador')!.skillIds).toEqual(['speckit-implement', 'speckit-converge']);
    expect(api.folders().kinds.skills.items['speckit-plan']).toBe('Spec Kit');
    expect(await s.findByRole('button', { name: 'Carpeta «Spec Kit», 9 elementos' })).toBeTruthy();
    expect(s.queryByRole('group', { name: 'Spec Kit' })).toBeNull();
  });

  /** Como el proyecto del 05/11: las skills `speckit-*` importadas de `.claude`, sin los agentes. */
  const importedSkills = () => SPECKIT_SKILLS.map((k) => ({ ...newSkill(k.id, `${k.name} (importada)`), description: 'De .claude' }));

  it('[R38.15] con las skills de Spec Kit ya importadas pero sin agentes, se ofrece «Añadir Spec Kit» y solo crea los agentes', async () => {
    const api = await mount({ skills: importedSkills() });
    const s = await goLib('agents');
    const kit = within(s.getByRole('group', { name: 'Spec Kit' }));
    await userEvent.click(kit.getByRole('button', { name: 'Añadir Spec Kit' }));
    await waitFor(() => expect(SPECKIT_AGENTS.every((a) => api.agents.has(a.id))).toBe(true));
    // Las skills importadas no se tocan.
    expect(api.skills.get('speckit-specify')!.description).toBe('De .claude');
    await waitFor(() => expect(s.queryByRole('group', { name: 'Spec Kit' })).toBeNull());
  });

  it('[R38.26] abrir la plantilla «Spec Kit: de la idea al código» crea antes los agentes que faltan', async () => {
    const api = await mount({ skills: importedSkills() });
    expect(api.agents.has('speckit-especificador')).toBe(false);
    await userEvent.click(await screen.findByRole('button', { name: 'Spec Kit: de la idea al código' }));
    await waitFor(() => expect(SPECKIT_AGENTS.every((a) => api.agents.has(a.id))).toBe(true));
    expect(api.skills.get('speckit-plan')!.description).toBe('De .claude');
    // El diagrama abierto usa agentes que existen.
    expect(await screen.findByRole('button', { name: 'Añadir «Especificador (Spec Kit)» al diagrama' })).toBeTruthy();
  });
});

describe('SPEC-038 · vistas de ejecución', () => {
  function waitingOrchestrator() {
    const agent = { output: 'hecho', tokens: ['hecho'], usage: { inputTokens: 1, outputTokens: 1, costUsd: 0 }, latencyMs: 1 };
    const mock = new MockAgent({ pix: { ...agent, asks: [{ question: '¿Qué estilo?' }] } });
    return new Orchestrator({ getAdapter: () => mock, decider: new MockDecider() });
  }

  it('[R38.10][R38.11][R38.12] el diagrama que corre se marca, «Cancelar» es compacto y «1 en marcha» lleva a En directo', async () => {
    const api = await mount({ orchestrator: waitingOrchestrator() });
    fireEvent.click(await screen.findByRole('button', { name: 'Insertar un paso entre «Entrada» y «Salida»' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Insertar paso' })).getByRole('button', { name: /Pixelador/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Lanzar…' }));
    const d = within(await screen.findByRole('dialog', { name: /^Ejecutar «/ }));
    await userEvent.type(d.getByLabelText('Entrada'), 'un dragón');
    await userEvent.click(d.getByRole('button', { name: 'Lanzar y ver la ejecución' }));
    await screen.findByRole('button', { name: '1 pregunta' });
    // pantalla de la ejecución: Cancelar de contorno, no a todo el ancho
    const cancel = screen.getAllByRole('button', { name: 'Cancelar' }).find((b) => b.closest('.orq-run__head'))!;
    expect(cancel.className).toContain('orq-btn--stop');
    expect(cancel.className).not.toContain('orq-btn--danger');
    await userEvent.click(within(screen.getByRole('navigation', { name: 'Secciones' })).getByRole('button', { name: 'Diseñador' }));
    expect(screen.getByRole('button', { name: 'Abrir el diagrama «Principal», ejecutándose' })).toBeTruthy();
    const close = screen.queryByRole('button', { name: 'Cerrar el panel' });
    if (close) await userEvent.click(close);
    // el lateral del Diseñador no muestra la ejecución; la barra lleva a En directo [R52.8]
    expect(screen.queryByRole('region', { name: 'En marcha' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: '1 en marcha' }));
    expect(await screen.findByRole('article', { name: 'Principal' })).toBeTruthy();
    void api;
  });
});

describe('SPEC-038 · bienvenida de skills y contextos', () => {
  it('[R38.19] «Nueva skill» empieza con la bienvenida: una idea se la pide al asistente y «Escribir» abre la ficha', async () => {
    const api = await mount({ assistant: () => [{ text: 'La redacto.' }] });
    const s = await goLib('skills');
    await userEvent.click(s.getByRole('button', { name: 'Nueva skill' }));
    const w = within(s.getByRole('region', { name: '¿Qué debe saber hacer?' }));
    expect(w.getByRole('note').textContent).toMatch(/motor Claude/);
    expect(w.getByRole('button', { name: 'Añadir Spec Kit' })).toBeTruthy();
    await userEvent.click(w.getByRole('button', { name: /Escribir tests/ }));
    expect(await (await panel()).findByText('La redacto.')).toBeTruthy();
    expect(api.assistantTurns[0]!.at(-1)!.text).toMatch(/^Crea una skill que escriba tests automáticos/);
    expect(screen.getByRole('region', { name: 'Conocimiento' })).toBeTruthy();
    await userEvent.type(w.getByLabelText('Describe la skill'), 'mida sprites{Enter}');
    await waitFor(() => expect(api.assistantTurns.length).toBe(2));
    await userEvent.click(w.getByRole('button', { name: 'Escribir' }));
    expect(s.getByLabelText(/^Cuándo usarla/)).toBeTruthy();
    // con borrador, vuelve directo a la ficha
    await userEvent.type(s.getByLabelText('Nombre'), 'Borrador');
    await userEvent.click(s.getByRole('tab', { name: /Contextos/ }));
    await userEvent.click(s.getByRole('tab', { name: /Skills/ }));
    await userEvent.click(s.getByRole('button', { name: 'Nueva skill' }));
    expect((s.getByLabelText('Nombre') as HTMLInputElement).value).toBe('Borrador');
  });

  it('[R38.19] «Instalar» abre la instalación con revisión y «Añadir Spec Kit» lo instala', async () => {
    const api = await mount();
    const s = await goLib('skills');
    await userEvent.click(s.getByRole('button', { name: 'Nueva skill' }));
    await userEvent.click(within(s.getByRole('region', { name: '¿Qué debe saber hacer?' })).getByRole('button', { name: 'Instalar' }));
    expect(await screen.findByRole('dialog', { name: 'Instalar agentes y skills' })).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(s.getByRole('button', { name: 'Nueva skill' }));
    await userEvent.click(within(s.getByRole('region', { name: '¿Qué debe saber hacer?' })).getByRole('button', { name: 'Añadir Spec Kit' }));
    await waitFor(() => expect(api.skills.has('speckit-tasks')).toBe(true));
  });

  it('[R38.20] «Nuevo contexto»: una idea va al asistente; «Dirección web» y «Elegir archivos» abren la ficha con su tipo', async () => {
    const api = await mount({ assistant: () => [{ text: 'Lo preparo.' }], contextPick: { value: 'contextos/guia', files: 2, bytes: 2048, renamed: 0, scripts: [] } });
    const s = await goLib('contexts');
    await userEvent.click(s.getByRole('button', { name: 'Nuevo contexto' }));
    const w = within(s.getByRole('region', { name: '¿Qué deben saber tus agentes?' }));
    await userEvent.click(w.getByRole('button', { name: /Glosario/ }));
    await waitFor(() => expect(api.assistantTurns[0]!.at(-1)!.text).toMatch(/^Crea un contexto con un glosario/));
    await userEvent.click(within(w.getByRole('group', { name: 'Añadir contexto' })).getByRole('button', { name: 'Dirección web' }));
    expect((s.getByLabelText('Tipo') as HTMLSelectElement).value).toBe('url');
    await userEvent.click(s.getByRole('button', { name: 'Descartar' }));
    await userEvent.click(s.getByRole('button', { name: 'Nuevo contexto' }));
    await userEvent.click(within(s.getByRole('group', { name: 'Añadir contexto' })).getByRole('button', { name: 'Elegir archivos' }));
    await waitFor(() => expect((s.getByLabelText('Ruta dentro del proyecto') as HTMLInputElement).value).toBe('contextos/guia'));
    expect((s.getByLabelText('Tipo') as HTMLSelectElement).value).toBe('file');
  });
});

describe('SPEC-038 · Diseñador, Herramientas y la sección Diagramas', () => {
  it('[R38.21] el rail dice «Diseñador» y la paleta agrupa los tipos de paso como «Herramientas»', async () => {
    await mount();
    const rail = within(screen.getByRole('navigation', { name: 'Secciones' }));
    expect(rail.getByRole('button', { name: 'Diseñador' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('region', { name: 'Herramientas' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Pasos' })).toBeNull();
  });

  it('[R38.22] «Diagramas» lista los diagramas en carpetas y abrir uno lleva al Diseñador', async () => {
    const api = await mount();
    await api.saveDiagram(createDiagram('mundo', 'Mundo'));
    const rail = within(screen.getByRole('navigation', { name: 'Secciones' }));
    await userEvent.click(rail.getByRole('button', { name: 'Diagramas' }));
    const sec = within(await screen.findByRole('region', { name: 'Diagramas' }));
    expect(sec.getByRole('button', { name: 'Abrir «Principal» en el Diseñador' })).toBeTruthy();
    expect(sec.getAllByText('abierto').length).toBeGreaterThan(0);
    await userEvent.click(sec.getByRole('button', { name: 'Nueva carpeta' }));
    await userEvent.type(sec.getByLabelText('Nombre de la carpeta'), 'Juego{Enter}');
    await userEvent.click(sec.getByRole('button', { name: 'Mover «Principal» a' }));
    await userEvent.click(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Juego' }));
    await waitFor(() => expect(api.folders().kinds.diagrams.items).toEqual({ principal: 'Juego' }));
    expect(within(sec.getByRole('region', { name: 'Juego' })).getByRole('button', { name: 'Abrir «Principal» en el Diseñador' })).toBeTruthy();
    await userEvent.click(sec.getByRole('button', { name: 'Más acciones de «Principal»' }));
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: /Duplicar/ })).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(sec.getByRole('button', { name: 'Abrir «Principal» en el Diseñador' }));
    expect(rail.getByRole('button', { name: 'Diseñador' }).getAttribute('aria-current')).toBe('page');
  });
});

describe('SPEC-038 · resultados de una ejecución', () => {
  async function runOnce(options: MemoryApiOptions = {}) {
    const api = await mount(options);
    fireEvent.click(await screen.findByRole('button', { name: 'Insertar un paso entre «Entrada» y «Salida»' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Insertar paso' })).getByRole('button', { name: /Pixelador/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Lanzar…' }));
    const d = within(await screen.findByRole('dialog', { name: /^Ejecutar «/ }));
    await userEvent.type(d.getByLabelText('Entrada'), 'un dragón');
    await userEvent.click(d.getByRole('button', { name: 'Lanzar y ver la ejecución' }));
    return api;
  }

  it('[R38.23] al terminar, la ejecución abre en «Resumen»: cómo acabó, lo pedido, el resultado y cada paso', async () => {
    await runOnce();
    // Bajo el lienzo, solo el aviso; «Ver resumen» abre el modal en «Resumen» [R44.5].
    const banner = within(await screen.findByRole('region', { name: 'La ejecución ha terminado' }, { timeout: 4000 }));
    expect(banner.getByText(/^Terminada bien: 1 paso hecho/)).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'Cronograma' })).toBeNull();
    await userEvent.click(banner.getByRole('button', { name: 'Ver resumen' }));
    const m = within(screen.getByRole('dialog', { name: 'Resultado de «Principal»' }));
    expect(m.getByRole('tab', { name: 'Resumen' }).getAttribute('aria-selected')).toBe('true');
    expect(within(m.getByRole('region', { name: 'Lo que se pidió' })).getByText('un dragón')).toBeTruthy();
    expect(within(m.getByRole('region', { name: 'Resultado final' })).getByText('salida de pix')).toBeTruthy();
    await userEvent.click(within(m.getByRole('region', { name: 'Qué hizo cada paso' })).getByRole('button', { name: 'Ver «pix» en detalle' }));
    expect(screen.getByRole('complementary', { name: 'pix' })).toBeTruthy();
  });

  it('[R38.24] el asistente lee las ejecuciones y el resumen de la última', async () => {
    const api = await runOnce({ assistant: (m) => (m.length === 1 ? [{ tool: 'list_runs', args: {} }, { tool: 'get_run', args: {} }, { text: 'Terminó bien.' }] : [{ text: 'ok' }]) });
    await screen.findByRole('region', { name: 'La ejecución ha terminado' }, { timeout: 4000 });
    await userEvent.click(screen.getByRole('button', { name: 'Asistente' }));
    await say('¿cómo acabó?');
    expect(await (await panel()).findByText('Terminó bien.')).toBeTruthy();
    const runs = api.assistantResults.find((r) => r.name === 'list_runs')!.result as { status: string; order?: string }[];
    expect(runs[0]).toMatchObject({ status: 'succeeded', order: 'un dragón' });
    const run = api.assistantResults.find((r) => r.name === 'get_run')!.result as { headline: string; steps: { label: string; status: string }[]; input: string };
    expect(run.headline).toMatch(/^Terminada bien: 1 paso hecho/);
    expect(run.input).toBe('un dragón');
    expect(run.steps).toEqual([expect.objectContaining({ label: 'pix', status: 'succeeded' })]);
    expect((await panel()).getByText(/Ha consultado: ver las ejecuciones, leer una ejecución/)).toBeTruthy();
  });
});

describe('SPEC-038 · resultado en grande', () => {
  it('[R38.25][R44.5] «Ver resumen» abre el resumen en un modal amplio que se cierra con Escape', async () => {
    await mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Insertar un paso entre «Entrada» y «Salida»' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Insertar paso' })).getByRole('button', { name: /Pixelador/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Lanzar…' }));
    const d = within(await screen.findByRole('dialog', { name: /^Ejecutar «/ }));
    await userEvent.type(d.getByLabelText('Entrada'), 'un dragón');
    await userEvent.click(d.getByRole('button', { name: 'Lanzar y ver la ejecución' }));
    await userEvent.click(within(await screen.findByRole('region', { name: 'La ejecución ha terminado' }, { timeout: 4000 })).getByRole('button', { name: 'Ver resumen' }));
    const modal = within(screen.getByRole('dialog', { name: 'Resultado de «Principal»' }));
    expect(modal.getByText(/^Terminada bien: 1 paso hecho/, { selector: 'p.orq-hint' })).toBeTruthy();
    expect(modal.getByRole('region', { name: 'Qué hizo cada paso' })).toBeTruthy();
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Resultado de «Principal»' })).toBeNull();
  });
});
