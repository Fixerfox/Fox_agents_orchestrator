import { useCallback, useEffect, useState, type MutableRefObject } from 'react';
import { slugify } from '@orquestador/core';
import { createDiagram, t, type EditorSession, type EditorSnapshot, type ProjectApi } from '@orquestador/editor';

const AUTOSAVE_MS = 700;
const LAST_KEY = 'orq-last-diagram:';
function readLast(project: string | undefined): string | undefined {
  if (project === undefined) return undefined;
  try {
    return localStorage.getItem(`${LAST_KEY}${project}`) ?? undefined;
  } catch {
    return undefined;
  }
}

interface Options {
  api: ProjectApi;
  session: EditorSession;
  snap: EditorSnapshot;
  project: string | undefined;
  projectRef: MutableRefObject<string | undefined>;
  confirm: (message: string) => boolean;
  fail: (message: string) => void;
  guard: (fn: () => void) => void;
  clearSelection: () => void;
  /** Va al Diseñador tras abrir un diagrama. */
  goDiagrams: () => void;
}

/** El diagrama abierto como documento: lista, guardado automático, crear, duplicar, abrir y eliminar [R32.38][R33.8]. */
export function useDiagramDocument({ api, session, snap, project, projectRef, confirm, fail, guard, clearSelection, goDiagrams }: Options) {
  /** Diagramas del proyecto para el panel lateral y los subdiagramas [R33.8]. */
  const [diagramList, setDiagramList] = useState<{ id: string; name: string }[]>([]);
  const refreshDiagrams = useCallback(async () => {
    const r = await api.listDiagrams();
    setDiagramList(r.ok ? r.value : []);
  }, [api]);
  useEffect(() => {
    if (project !== undefined) void refreshDiagrams();
    else setDiagramList([]);
  }, [project, refreshDiagrams]);

  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'error'>('idle');
  const save = useCallback(async () => {
    const diagram = session.diagram;
    setSaveState('saving');
    const res = await api.saveDiagram(diagram);
    if (res.ok) {
      // Solo se marca guardado si no ha cambiado mientras tanto [R32.38].
      if (session.diagram === diagram) session.markSaved();
      setSaveState('idle');
      void refreshDiagrams();
    } else {
      setSaveState('error');
      fail(t('project.error', { message: res.error.message }));
    }
  }, [api, session, fail, refreshDiagrams]);
  /** Con proyecto abierto lo pendiente se guarda antes de cambiar de diagrama; sin proyecto, se confirma [R32.38]. */
  const discardOk = useCallback(() => {
    if (!session.getSnapshot().dirty) return true;
    if (projectRef.current !== undefined) {
      void save();
      return true;
    }
    return confirm(t('project.confirm.discard'));
  }, [session, confirm, save, projectRef]);

  /** Guardado automático poco después de cada cambio, con proyecto abierto y sin ejecución [R32.38]. */
  useEffect(() => {
    if (project === undefined || !snap.dirty) return;
    const h = setTimeout(() => void save(), AUTOSAVE_MS);
    return () => clearTimeout(h);
  }, [snap.version, snap.dirty, project, save]);

  /** Nombre e id libres para un diagrama nuevo («Diagrama nuevo 2»…) [R32.38]. */
  const freshDiagram = useCallback(
    async (base = t('diagram.new.name')) => {
      const r = project !== undefined ? await api.listDiagrams() : undefined;
      const list = r?.ok ? r.value : [];
      const names = new Set(list.map((d) => d.name));
      let name = base;
      for (let n = 2; names.has(name); n++) name = `${base} ${n}`;
      const id = slugify(name, new Set([...list.map((d) => d.id), session.diagram.id]), 'diagrama');
      return { id, name };
    },
    [api, project, session],
  );
  const [renameReq, setRenameReq] = useState(0);
  const requestRename = () => setRenameReq((n) => n + 1);
  const newDiagram = async () => {
    if (!discardOk()) return;
    const { id, name } = await freshDiagram();
    const fresh = createDiagram(id, name);
    guard(() => session.load(fresh));
    clearSelection();
    setRenameReq((n) => n + 1);
    if (projectRef.current !== undefined) void api.saveDiagram(fresh).then(() => refreshDiagrams());
  };
  /** Diagrama nuevo con nombre, para el asistente [R29.2]. */
  const createNamed = async (name: string) => {
    if (!discardOk()) throw new Error('Hay cambios sin guardar');
    const fresh = await freshDiagram(name.trim() || undefined);
    const d = createDiagram(fresh.id, fresh.name);
    session.load(d);
    clearSelection();
    await api.saveDiagram(d);
    await refreshDiagrams();
  };
  const duplicateDiagram = async () => {
    if (!discardOk()) return;
    const { id, name } = await freshDiagram(t('diagram.copy.name', { name: session.diagram.name }));
    const copy = { ...structuredClone(session.diagram), id, name };
    const res = await api.saveDiagram(copy);
    if (!res.ok) return fail(t('project.error', { message: res.error.message }));
    guard(() => session.load(copy));
    await refreshDiagrams();
  };
  /** Al abrir un proyecto se abre el último diagrama usado, si no el primero, o se crea «Principal» [R32.38]. */
  const openFirstDiagram = async () => {
    const last = readLast(projectRef.current); // antes de esperar: luego se guarda el que está abierto ahora
    const r = await api.listDiagrams();
    const first = r.ok ? (r.value.find((d) => d.id === last) ?? r.value[0]) : undefined;
    if (first) {
      const d = await api.loadDiagram(first.id);
      if (d.ok) return guard(() => session.load(d.value));
    }
    const { id, name } = r.ok && r.value.length > 0 ? await freshDiagram() : { id: 'principal', name: t('diagram.main.name') };
    const fresh = createDiagram(id, name);
    guard(() => session.load(fresh));
    await api.saveDiagram(fresh);
    await refreshDiagrams();
  };
  const deleteDiagram = async () => {
    const d = session.diagram;
    if (!confirm(t('diagram.delete.confirm', { name: d.name }))) return;
    const res = await api.deleteDiagram(d.id);
    if (!res.ok) return fail(t('project.error', { message: res.error.message }));
    session.markSaved();
    await openFirstDiagram();
    await refreshDiagrams();
  };
  const deleteOther = async (id: string) => {
    const name = diagramList.find((d) => d.id === id)?.name ?? id;
    if (!confirm(t('diagram.delete.confirm', { name }))) return;
    const res = await api.deleteDiagram(id);
    if (!res.ok) return fail(t('project.error', { message: res.error.message }));
    await refreshDiagrams();
  };
  const openDiagram = async (id: string) => {
    if (id === session.diagram.id || !discardOk()) return;
    const r = await api.loadDiagram(id);
    if (!r.ok) return fail(t('project.error', { message: r.error.message }));
    session.load(r.value);
    clearSelection();
    goDiagrams();
  };

  // Recuerda en este equipo el último diagrama abierto de cada proyecto [R32.38].
  useEffect(() => {
    if (project === undefined) return;
    try {
      localStorage.setItem(`${LAST_KEY}${project}`, snap.diagram.id);
    } catch {
      /* sin almacenamiento: se abrirá el primero */
    }
  }, [project, snap.diagram.id]);

  /** Lista para los selectores de diagrama de la barra y de la cabecera. */
  const listDiagrams = async () => {
    const r = await api.listDiagrams();
    return r.ok ? r.value : [];
  };
  const saveStatus = project === undefined ? ('no-project' as const) : saveState === 'saving' ? ('saving' as const) : saveState === 'error' ? ('error' as const) : snap.dirty ? ('dirty' as const) : ('saved' as const);
  return { diagramList, refreshDiagrams, save, discardOk, freshDiagram, renameReq, requestRename, newDiagram, createNamed, duplicateDiagram, openFirstDiagram, deleteDiagram, deleteOther, openDiagram, listDiagrams, saveStatus };
}

export type DiagramDocument = ReturnType<typeof useDiagramDocument>;
