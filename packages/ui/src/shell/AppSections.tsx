import { projectPermission, type ProjectPermission } from '@orquestador/core';
import { AssistantPanel } from '../assistant';
import { downloadText } from '../common';
import { DesignerScreen, DiagramsScreen } from '../diagrams';
import { LibraryScreen } from '../knowledge';
import { JobsScreen, RunsScreen } from '../runs';
import { ProjectScreen, SettingsDialog } from '../settings';
import type { AppModel } from './useApp';

/** El asistente, en el lateral del Diseñador o en el panel acoplado [R29.5][R38.1]. */
export function AppAssistant({ app }: { app: AppModel }) {
  return <AssistantPanel api={app.api} host={app.assistantHost} state={app.chat} setState={app.setChat} confirmActions={projectPermission(app.config.settings ?? {}) !== 'full'} where={app.section} onClose={() => app.layout.setAssistOpen(false)} />;
}

function Designer({ app }: { app: AppModel }) {
  const { layout, sel, config: conf } = app;
  return (
    <DesignerScreen
      api={app.api}
      session={app.session}
      snap={app.snap}
      doc={app.doc}
      sel={sel}
      lib={app.lib}
      designer={app.designer}
      leftOpen={layout.leftOpen}
      sideWidth={layout.sideWidth}
      onSideWidth={layout.setSideWidth}
      sideVisible={layout.sideVisible}
      diagramPanel={layout.diagramPanel}
      onDiagramSettings={() => layout.toggleDiagramPanel(() => sel.select(''))}
      onCloseDiagramPanel={() => layout.setDiagramPanel(false)}
      assistant={layout.assistOpen ? <AppAssistant app={app} /> : undefined}
      events={app.run.events}
      runningIds={app.runningIds}
      askingIds={app.askingIds}
      files={conf.settings ? { folder: conf.workFolder, permissions: projectPermission(conf.settings), onPermissions: (level: ProjectPermission) => void conf.setPermissions(level) } : undefined}
      fail={app.fail}
      guard={app.guard}
      openLibrary={app.openLibrary}
    />
  );
}

/** La pantalla de la sección abierta [R32.13]. */
export function AppSections({ app }: { app: AppModel }) {
  const { api, section, setSection, snap, doc, designer, run, client, runsIndex, layout, goRuns, launcher } = app;
  const openInDesigner = (id: string) => {
    setSection('diagrams');
    if (id !== snap.diagram.id) void doc.openDiagram(id);
  };
  return (
    <div className="orq-shell__content" data-testid="content">
      {section === 'diagrams' && <Designer app={app} />}
      {section === 'runs' && (
        <RunsScreen
          api={api}
          main={run}
          index={runsIndex}
          nav={app.runsNav}
          onNav={app.setRunsNav}
          subOpen={layout.runsSub}
          onToggleSub={() => layout.setRunsSub((v) => !v)}
          onControlMain={(a) => void client.control(a)}
          onAnswerMain={(q, text) => void client.answer(q, text)}
          agentNames={designer.agentNames}
          onExport={(id, jsonl) => downloadText(`${id}.jsonl`, jsonl)}
        />
      )}
      {(section === 'agents' || section === 'knowledge') && (
        <LibraryScreen
          api={api}
          section={section}
          open={app.libOpen}
          drafts={app.drafts}
          onGo={app.openLibrary}
          onChanged={() => void app.lib.reloadAgents()}
          onAskClaude={(text) => app.askAssistant(text)}
          version={app.libVersion}
          assistantReady={app.config.engine === 'claude'}
          onOpenTerminal={() => void app.terminals.openTerminal('claude').catch(() => undefined)}
        />
      )}
      {section === 'project' && (
        <ProjectScreen
          api={api}
          live={run.live}
          startWizard={app.wizard}
          onWizardShown={() => app.setWizard(false)}
          onChanged={() => void app.lib.reloadAgents()}
          onGoDiagrams={app.goDiagrams}
          onOpenSettings={() => setSection('settings')}
        />
      )}
      {section === 'settings' && <SettingsDialog api={api} onSaved={app.config.setSettings} />}
      {section === 'jobs' && (
        <JobsScreen
          api={api}
          index={runsIndex}
          version={doc.diagramList}
          onLaunch={(id) => void launcher.openLaunch(id)}
          onHistory={(id) => goRuns({ section: 'history', diagramId: id })}
          onEdit={openInDesigner}
          onNew={app.goDiagrams}
          onOpenRuns={(to) => goRuns({ section: to })}
        />
      )}
      {section === 'library' && (
        <DiagramsScreen
          api={api}
          diagrams={doc.diagramList}
          currentId={snap.diagram.id}
          runningIds={app.runningIds}
          askingIds={app.askingIds}
          onOpen={openInDesigner}
          onNew={() => void doc.newDiagram().then(app.goDiagrams)}
          menu={(id) => designer.diagramMenu(id).map((m) => (m.id === 'd-open' ? { ...m, disabled: false, onSelect: () => openInDesigner(id) } : m))}
        />
      )}
    </div>
  );
}
