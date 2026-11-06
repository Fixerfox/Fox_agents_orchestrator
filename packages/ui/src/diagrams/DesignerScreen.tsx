import type { ComponentProps, ReactNode } from 'react';
import { ReactFlowProvider } from '@xyflow/react';
import { SlidersHorizontal, X } from 'lucide-react';
import type { RunEvent } from '@orquestador/core';
import { eventsOfDiagram, t, type EditorSession, type EditorSnapshot, type ProjectApi } from '@orquestador/editor';
import { SideResizeHandle, type OpenLibrary } from '../common';
import { Breadcrumbs } from './Breadcrumbs';
import { Canvas } from './Canvas';
import { DiagramMenu, EditButtons, SaveStatus } from './DiagramMenu';
import { Inspector } from './Inspector';
import { Palette } from './Palette';
import type { Designer } from './useDesigner';
import type { DesignerSelection } from './useDesignerSelection';
import type { DiagramDocument } from './useDiagramDocument';
import type { ProjectCatalog } from './useProjectCatalog';

interface Props {
  api: ProjectApi;
  session: EditorSession;
  snap: EditorSnapshot;
  doc: DiagramDocument;
  sel: DesignerSelection;
  lib: ProjectCatalog;
  designer: Designer;
  leftOpen: boolean;
  sideWidth: number;
  onSideWidth: (width: number) => void;
  sideVisible: boolean;
  /** «Ajustes del diagrama» abierto [R33.6]. */
  diagramPanel: boolean;
  onDiagramSettings: () => void;
  onCloseDiagramPanel: () => void;
  /** Panel del asistente, cuando ocupa el lateral derecho [R29.5]. */
  assistant?: ReactNode;
  events: readonly RunEvent[];
  runningIds: string[];
  askingIds: string[];
  files: ComponentProps<typeof Inspector>['files'];
  fail: (message: string) => void;
  guard: (fn: () => void) => void;
  openLibrary: OpenLibrary;
}

/** Diseñador: paleta, cabecera con el diagrama abierto, lienzo y lateral derecho [R32.38][R33.6]. */
export function DesignerScreen(p: Props) {
  const { session, snap, doc, sel, designer } = p;
  const { agents, catalog } = p.lib;
  return (
    <div className="orq-body">
      <Palette
        open={p.leftOpen}
        agents={agents}
        examples={designer.examples}
        usage={designer.usage}
        onAdd={(spec) => designer.onAdd(spec)}
        onPickAgent={() => designer.setPicker({})}
        onAddAgent={(agentId) => designer.onAdd({ kind: 'agent', agentId })}
        onParallel={designer.openParallel}
        resources={[
          ...catalog.skills.map((k) => ({ kind: 'skillIds' as const, id: k.id, name: k.name })),
          ...catalog.contexts.map((c) => ({ kind: 'contextIds' as const, id: c.id, name: c.name })),
          ...(catalog.mcp ?? []).map((m) => ({ kind: 'mcpIds' as const, id: m.id, name: m.name })),
        ]}
        diagrams={doc.diagramList}
        currentDiagramId={snap.diagram.id}
        runningIds={p.runningIds}
        askingIds={p.askingIds}
        onOpenDiagram={(id: string) => void doc.openDiagram(id)}
        diagramMenu={designer.diagramMenu}
        agentMenu={(id) => {
          const m = designer.agentMenuFor(id);
          return [...m.top, ...m.knowledge];
        }}
        onSelectUse={(use) => {
          session.goTo(use.path);
          sel.select(use.nodeId);
        }}
        onLoadExample={designer.loadExample}
        onNewAgent={() => p.openLibrary('agents', { tab: 'agents', id: 'new' })}
      />
      <main className="orq-main">
        <Breadcrumbs
          crumbs={snap.crumbs}
          onGo={(path) => session.goTo(path)}
          onUp={() => session.up()}
          onRename={(name) => p.guard(() => session.rename(name))}
          renameRequest={doc.renameReq}
          actions={
            <>
              <DiagramMenu
                compact
                diagramName={snap.diagram.name}
                currentDiagramId={snap.diagram.id}
                onListDiagrams={doc.listDiagrams}
                onOpenDiagram={(id) => void doc.openDiagram(id)}
                onRenameDiagram={doc.requestRename}
                onDuplicateDiagram={() => void doc.duplicateDiagram()}
                onDeleteDiagram={() => void doc.deleteDiagram()}
                onNew={() => void doc.newDiagram()}
              />
              <span className="orq-grow" />
              <SaveStatus saveState={doc.saveStatus} dirty={snap.dirty} />
              <EditButtons canUndo={snap.canUndo} canRedo={snap.canRedo} projectOpen onNew={() => void doc.newDiagram()} onUndo={designer.undo} onRedo={designer.redo} onSave={() => void doc.save()} />
              <button type="button" className={`orq-btn orq-btn--small orq-btn--ghost orq-crumbs__settings${p.diagramPanel && p.sideVisible ? ' is-on' : ''}`} aria-pressed={p.diagramPanel && p.sideVisible} onClick={p.onDiagramSettings}>
                <SlidersHorizontal size={14} aria-hidden="true" />
                {t('diagram.settings')}
              </button>
            </>
          }
        />
        <ReactFlowProvider>
          <Canvas
            session={session}
            onSelection={sel.updateSelection}
            onReject={p.fail}
            selectRequest={sel.selectRequest}
            agentNames={designer.agentNames}
            extras={designer.extras}
            agentMenu={designer.agentMenuFor}
            onAddSubdiagram={designer.addSubdiagram}
            onAddKnowledge={(nodeId, port) => designer.setPortPick({ nodeId, port })}
            onDropKnowledge={designer.addExtra}
            onOpenDiagram={(id) => void doc.openDiagram(id)}
            onEdit={designer.focusField}
            onAddAt={(kind, at, opts) => (kind === 'agent' ? designer.setPicker({ at }) : designer.onAdd(kind === 'review' && opts?.human ? { kind, human: true } : { kind }, at))}
            onDropParallel={(edgeId) => (edgeId ? designer.setParallelAt(edgeId) : designer.openParallel())}
            onInsert={designer.onInsert}
            onInsertTransform={(edgeId: string) => p.guard(() => sel.select(session.insertOnEdge(edgeId, { kind: 'transform' })))}
          />
        </ReactFlowProvider>
      </main>
      {p.sideVisible && (
        <div className="orq-side" style={{ width: p.sideWidth }}>
          <SideResizeHandle width={p.sideWidth} onChange={p.onSideWidth} />
          {p.assistant ?? <DesignerSide {...p} />}
        </div>
      )}
    </div>
  );
}

/** Lateral derecho sin asistente: el paso seleccionado o los ajustes del diagrama [R33.6]. */
function DesignerSide({ api, session, snap, doc, sel, lib, designer, events, files, fail, openLibrary, onCloseDiagramPanel }: Props) {
  return (
    <>
      {sel.selectedNode && (
        <div className="orq-side__head">
          <span className="orq-side__title">{t('insp.tab.step')}</span>
          <button type="button" className="orq-ib" aria-label={t('insp.close')} title={t('insp.close')} onClick={() => sel.select('')}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}
      {!sel.hasSelection && (
        <div className="orq-side__head">
          <span className="orq-side__title">{t('insp.tab.diagram')}</span>
          <button type="button" className="orq-ib" aria-label={t('diagram.settings.close')} title={t('diagram.settings.close')} onClick={onCloseDiagramPanel}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}
      <Inspector
        session={session}
        snap={snap}
        selection={sel.selection}
        agents={lib.agents}
        onError={fail}
        onEditAgent={(id) => openLibrary('agents', { tab: 'agents', id })}
        events={eventsOfDiagram(events, snap.diagram.id)}
        onSelect={sel.select}
        onChangeAgent={(nodeId) => designer.setPicker({ replace: nodeId })}
        catalog={lib.catalog}
        diagramNames={Object.fromEntries(doc.diagramList.map((d) => [d.id, d.name]))}
        onOpenDiagram={(id) => void doc.openDiagram(id)}
        onCreateKnowledge={(k) => openLibrary('knowledge', { tab: k, id: 'new' })}
        api={api}
        {...(files ? { files } : {})}
      />
    </>
  );
}
