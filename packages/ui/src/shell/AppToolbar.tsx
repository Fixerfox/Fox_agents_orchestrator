import { Toolbar } from './Toolbar';
import type { AppModel } from './useApp';

/** Barra superior con los datos de la aplicación: en el Diseñador lanza y fuera sigue la última ejecución [R52.8]. */
export function AppToolbar({ app }: { app: AppModel }) {
  const { snap, doc, designer, run, client, section, layout, runsIndex, launcher, setRunModal, goRuns, project } = app;
  const { assistOpen, setAssistOpen, rightOpen, setRightOpen, sideVisible, toggleRight } = layout;
  const assistantOpen = assistOpen && (section !== 'diagrams' || rightOpen);
  return (
    <Toolbar
      editInHeader
      canUndo={snap.canUndo}
      canRedo={snap.canRedo}
      dirty={snap.dirty}
      projectOpen={project !== undefined}
      onUndo={designer.undo}
      onRedo={designer.redo}
      onSave={() => void doc.save()}
      onNew={() => void doc.newDiagram()}
      onRenameDiagram={doc.requestRename}
      onDuplicateDiagram={() => void doc.duplicateDiagram()}
      onDeleteDiagram={() => void doc.deleteDiagram()}
      saveState={doc.saveStatus}
      onOpenProject={() => void app.onProject('open')}
      onCreateProject={() => void app.onProject('create')}
      onCloseProject={() => void app.closeProject()}
      onOpenSettings={() => app.setSection('settings')}
      projectName={project}
      diagramName={snap.diagram.name}
      currentDiagramId={snap.diagram.id}
      onListDiagrams={doc.listDiagrams}
      onOpenDiagram={(id) => void doc.openDiagram(id)}
      engine={app.config.engine}
      problems={snap.problems}
      {...(section === 'diagrams'
        ? { onRun: () => void launcher.openLaunch(snap.diagram.id) }
        : {
            // Fuera del Diseñador, la barra sigue la ejecución que se lanzó la última [R52.8].
            live: run.live,
            maxTokens: launcher.maxTokens,
            onControl: (a: 'pause' | 'resume' | 'cancel') => void client.control(a),
            ...(run.runId && run.live.status !== 'running' && run.live.status !== 'idle' ? { onShowSummary: () => setRunModal(run.runId) } : {}),
          })}
      running={runsIndex.runs.filter((r) => r.status === 'running').length}
      pendingCount={runsIndex.pending.length}
      onOpenLive={() => goRuns({ section: 'live' })}
      onOpenRuns={() => goRuns({ section: 'inbox' })}
      runError={run.error}
      {...(section === 'diagrams' ? { rightOpen: sideVisible, onToggleRight: toggleRight } : {})}
      assistantOpen={assistantOpen}
      onAssistant={() => {
        if (section === 'diagrams') setRightOpen(true);
        setAssistOpen(!assistantOpen);
      }}
    />
  );
}
