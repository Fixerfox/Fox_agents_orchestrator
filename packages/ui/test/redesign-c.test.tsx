// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { newAgent, newContext, type AgentDefinition, type RunEvent } from '@orquestador/core';
import { createDiagram, type DraftRequest } from '@orquestador/editor';
import { App } from '../src/App';
import { ProjectChanges } from '../src/runs/RunFiles';
import { createMemoryApi, type MemoryApiOptions } from '../src/memoryApi';
import { goLib } from './nav';

const agent = (id: string, name: string, patch: Partial<AgentDefinition> = {}): AgentDefinition => ({ ...newAgent(id, name), ...patch });
const BUILT_IN = [
  { id: 'sprites', name: 'Sprites', description: 'Dibuja en píxel art', skills: ['Paleta', 'Tamaños'], contexts: ['Glosario', 'Estilo'] },
  { id: 'revisor', name: 'Revisor', description: 'Da un veredicto' },
];
async function mount(options: MemoryApiOptions = {}, diagrams = [createDiagram('principal', 'Principal')]) {
  const api = createMemoryApi(diagrams, options);
  render(<App initialProject="Juego" api={api} agents={BUILT_IN} confirm={() => true} />);
  await userEvent.click(screen.getByRole('button', { name: /^Proyecto «/ }));
  await userEvent.click(screen.getByRole('menuitem', { name: 'Abrir proyecto' }));
  await screen.findByRole('button', { name: 'Bucle de revisión' });
  return api;
}
/** Inserta el agente en la conexión Entrada → Salida, así queda conectado y seleccionado. */
const insertAgent = async (name: RegExp) => {
  fireEvent.click(screen.getByRole('button', { name: 'Insertar un paso entre «Entrada» y «Salida»' }));
  await userEvent.click(within(screen.getByRole('dialog', { name: 'Insertar paso' })).getByRole('button', { name }));
};
const addAgent = async (name: RegExp) => {
  await userEvent.click(screen.getByRole('button', { name: '+ Agente' }));
  await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name }));
};

describe('SPEC-032 · fidelidad a los prototipos', () => {
  it('[R32.27] la tarjeta del agente muestra hasta tres fichas de conocimiento y Entrada/Salida sus notas', async () => {
    await mount();
    await addAgent(/Sprites/);
    const card = within(await screen.findByLabelText(/^Agente «sprites»/));
    expect(card.getByText('Paleta')).toBeTruthy();
    expect(card.getByText('Glosario')).toBeTruthy();
    expect(card.queryByText('Estilo')).toBeNull();
    expect(within(screen.getByLabelText(/^Entrada/)).getByText('Se pide al ejecutar')).toBeTruthy();
    expect(within(screen.getByLabelText(/^Salida/)).getByText('Resultado final')).toBeTruthy();
  });

  it('[R32.27] un bucle muestra los pasos que contiene y su máximo de vueltas', async () => {
    await mount();
    await userEvent.click(await screen.findByRole('button', { name: 'Bucle de revisión' }));
    const loop = within(await screen.findByLabelText(/^Bucle «Revisión»/));
    expect(loop.getByText(/^máx\. \d+ vueltas$/)).toBeTruthy();
    expect(document.querySelector('.orq-node__inner')?.children.length).toBeGreaterThan(0);
  });

  it('[R32.28] el nombre del diagrama abre un selector con los del proyecto y «Diagrama nuevo»', async () => {
    await mount({}, [createDiagram('principal', 'Principal'), createDiagram('otro', 'Otro')]);
    const btn = await screen.findByRole('button', { name: /^Diagrama «/ });
    await userEvent.click(btn);
    const menu = within(screen.getByRole('menu', { name: /^Diagrama «/ }));
    const otro = await menu.findByRole('menuitemradio', { name: 'Otro' });
    expect(menu.getByRole('menuitem', { name: 'Diagrama nuevo' })).toBeTruthy();
    await userEvent.click(otro);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Diagrama «Otro»' })).toBeTruthy());
    await userEvent.click(screen.getByRole('button', { name: 'Diagrama «Otro»' }));
    expect((await screen.findByRole('menuitemradio', { name: 'Otro' })).getAttribute('aria-checked')).toBe('true');
  });

  it('[R32.29] la tarea tiene ✦ dentro y la propuesta se acepta en el propio campo', async () => {
    const draft = vi.fn((_req: DraftRequest) => ({ ok: true as const, value: { fields: { value: 'Dibuja cada enemigo en 32×32' }, problems: [], ms: 5 } }));
    await mount({ draft });
    await addAgent(/Sprites/);
    await userEvent.click(screen.getByRole('button', { name: 'Escribir con Claude' }));
    await userEvent.type(screen.getByLabelText('¿Qué debería hacer este paso?'), 'enemigos{Enter}');
    await screen.findByRole('region', { name: 'Propuesta de Claude' });
    expect(draft.mock.calls[0]![0]).toMatchObject({ instruction: 'enemigos', current: { name: 'Tarea del paso «sprites»' } });
    await userEvent.click(screen.getByRole('button', { name: 'Aceptar cambios' }));
    await waitFor(() => expect((screen.getByLabelText('Qué tiene que hacer') as HTMLTextAreaElement).value).toBe('Dibuja cada enemigo en 32×32'));
    expect(within(screen.getByLabelText(/^Agente «sprites»/)).getByText('Dibuja cada enemigo en 32×32')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mejorar' })).toBeTruthy();
  });

  it('[R32.29] «Recibe:» lista los pasos que le llegan y «Cambiar» sustituye el agente desde la galería', async () => {
    await mount();
    await insertAgent(/Sprites/);
    expect(within(screen.getByLabelText('Recibe:')).getByText('@entrada')).toBeTruthy();
    const card = within(screen.getByRole('group', { name: 'Quién lo hace' }));
    expect(card.getByRole('button', { name: 'Editar el agente' })).toBeTruthy();
    await userEvent.click(card.getByRole('button', { name: 'Cambiar el agente' }));
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Elige un agente' })).getByRole('button', { name: /Revisor/ }));
    expect(within(screen.getByRole('group', { name: 'Quién lo hace' })).getByText('Revisor', { selector: 'strong' })).toBeTruthy();
  });

  it('[R32.29][R47.11] «Archivos» guarda al momento los permisos de los agentes', async () => {
    const api = await mount({ workFolderPick: { name: 'INCWars', files: 10 } });
    await api.pickWorkFolder();
    const rail = within(screen.getByRole('navigation', { name: 'Secciones' }));
    await userEvent.click(rail.getByRole('button', { name: 'Proyecto' }));
    await userEvent.click(rail.getByRole('button', { name: 'Diseñador' }));
    await addAgent(/Sprites/);
    const files = within(await screen.findByRole('group', { name: 'Archivos' }));
    expect(await files.findByText('Crear archivos nuevos en INCWars')).toBeTruthy();
    const create = files.getByRole('switch', { name: 'Crear archivos nuevos en INCWars' }) as HTMLInputElement;
    expect(create.checked && create.disabled).toBe(true);
    const perms = within(files.getByRole('group', { name: 'Permisos de los agentes' }));
    expect(perms.getAllByRole('radio')).toHaveLength(3);
    // por defecto no se pregunta nada, con su aviso [R51.1]
    expect((perms.getByRole('radio', { name: /^Sin preguntar nunca/ }) as HTMLInputElement).checked).toBe(true);
    await userEvent.click(perms.getByRole('radio', { name: /^Preguntar/ }));
    await waitFor(async () => expect(await api.getSettings()).toMatchObject({ ok: true, value: { permissions: 'ask' } }));
    await userEvent.click(perms.getByRole('radio', { name: /^Sin preguntar nunca/ }));
    await waitFor(async () => expect(await api.getSettings()).toMatchObject({ ok: true, value: { permissions: 'full' } }));
    expect(perms.getByText(/podrán borrar archivos y ejecutar cualquier comando/)).toBeTruthy();
  });

  it('[R47.11] si el agente del paso tiene sus propios permisos, «Archivos» lo dice', async () => {
    await mount({ workFolderPick: { name: 'INCWars', files: 10 }, agents: [agent('lector', 'Lector', { permissions: 'readonly' })] });
    await addAgent(/Lector/);
    const files = within(await screen.findByRole('group', { name: 'Archivos' }));
    expect(files.getByText('Este agente usa los suyos: Solo lectura.')).toBeTruthy();
  });

  it('[R32.30] los campos hablan de tareas y la lista dice modelo y diagramas que usan el agente', async () => {
    const d = createDiagram('principal', 'Principal');
    d.nodes.push({ id: 'n1', kind: 'agent', agentId: 'a', position: { x: 0, y: 0 } });
    await mount({ agents: [agent('a', 'Alfa', { description: 'Hace cosas' })] }, [d]);
    const s = await goLib('agents');
    expect(await s.findByText(/^Sonnet .* · 1 diagrama$/)).toBeTruthy();
    await userEvent.click(s.getByRole('button', { name: 'Alfa' }));
    expect(s.getByLabelText('Para qué sirve')).toBeTruthy();
    const k = await goLib('skills');
    await userEvent.click(k.getByRole('button', { name: 'Nueva skill' }));
    await userEvent.click(k.getByRole('button', { name: 'Escribir' }));
    expect(k.getByLabelText(/^Cuándo usarla/)).toBeTruthy();
    expect(k.getByLabelText(/^Pasos/)).toBeTruthy();
  });

  it('[R32.31] un contexto nuevo empieza con «Añadir contexto» y sus caminos; explica cómo se entrega', async () => {
    await mount({ contexts: [{ ...newContext('ref', 'Referencia'), kind: 'file', value: 'docs/a.md' }] });
    const s = await goLib('contexts');
    await userEvent.click(s.getByRole('button', { name: 'Nuevo contexto' }));
    const zone = within(s.getByRole('group', { name: 'Añadir contexto' }));
    expect(s.queryByLabelText('Tipo')).toBeNull();
    expect(s.getByLabelText('Describe el contexto')).toBeTruthy();
    await userEvent.click(zone.getByRole('button', { name: 'Escribir' }));
    await userEvent.click(s.getByRole('button', { name: 'Escribir con Claude' }));
    expect(s.getByRole('dialog', { name: 'Pedir a Claude' })).toBeTruthy();
    expect(within(s.getByRole('region', { name: 'Cómo se entrega' })).getByText(/texto completo va en las instrucciones/)).toBeTruthy();
    await userEvent.click(s.getByRole('button', { name: 'Referencia' }));
    expect(within(s.getByRole('region', { name: 'Cómo se entrega' })).getByText(/recibe la ruta/)).toBeTruthy();
  });

  it('[R32.31] «Elegir archivos» abre el diálogo del sistema y deja el contexto como archivo', async () => {
    await mount({ contextPick: { value: 'contextos/guia', files: 2, bytes: 2048, renamed: 0, scripts: [] } });
    const s = await goLib('contexts');
    await userEvent.click(s.getByRole('button', { name: 'Nuevo contexto' }));
    await userEvent.click(within(s.getByRole('group', { name: 'Añadir contexto' })).getByRole('button', { name: 'Elegir archivos' }));
    await waitFor(() => expect((s.getByLabelText('Ruta dentro del proyecto') as HTMLInputElement).value).toBe('contextos/guia'));
    expect((s.getByLabelText('Tipo') as HTMLSelectElement).value).toBe('file');
  });

  it('[R32.32] Resultados lista los archivos modificados con «Restaurar» y los nuevos', async () => {
    const api = createMemoryApi([], { backups: { r1: { 'src/a.ts': 'antes' } } });
    const ev = (seq: number, path: string): RunEvent => ({ runId: 'r1', seq, ts: 't', type: 'file.produced', nodeId: 'n', path }) as RunEvent;
    render(<ProjectChanges api={api} runId="r1" finished events={[ev(1, 'src/a.ts'), ev(2, 'docs/nuevo.md')]} />);
    const box = within(await screen.findByRole('region', { name: 'Cambios en la carpeta del proyecto' }));
    expect(await box.findByText('src/a.ts')).toBeTruthy();
    expect(box.getByText('modificado')).toBeTruthy();
    expect(box.getByText('nuevo')).toBeTruthy();
    expect(box.getAllByText('src/a.ts')).toHaveLength(1);
    const spy = vi.spyOn(api, 'restoreBackup');
    await userEvent.click(box.getByRole('button', { name: 'Restaurar src/a.ts' }));
    expect(spy).toHaveBeenCalledWith({ runId: 'r1', path: 'src/a.ts' });
    expect(await box.findByText('Restaurado')).toBeTruthy();
  });

  it('[R32.33] el router y el bucle con IA dicen qué verá Claude', async () => {
    await mount();
    await userEvent.click(screen.getByRole('button', { name: '+ Router' }));
    expect(await screen.findByText(/^Claude verá: lo que sale del paso anterior/)).toBeTruthy();
    await userEvent.selectOptions(screen.getByLabelText('Modo de enrutado'), 'rules');
    expect(screen.getByText(/cuya condición se cumpla/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '+ Bucle' }));
    await userEvent.selectOptions(await screen.findByLabelText('Modo del bucle'), 'ai-judge');
    expect(screen.getByText(/^Claude verá: el resultado de cada vuelta/)).toBeTruthy();
    expect(screen.getByLabelText('Condición para terminar').getAttribute('placeholder')).toMatch(/^Ej\.:/);
    fireEvent.blur(screen.getByLabelText('Condición para terminar'));
  });
});
