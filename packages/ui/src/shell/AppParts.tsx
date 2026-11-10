import { X } from 'lucide-react';
import { t } from '@orquestador/editor';
import { SideResizeHandle, downloadText } from '../common';
import { DesignerDialogs } from '../diagrams';
import { LaunchDialog, RunModal } from '../runs';
import { SettingsDialog, TrustDialog } from '../settings';
import { AppAssistant } from './AppSections';
import { NavRail } from './NavRail';
import { StartScreen } from './StartScreen';
import { TerminalPanel } from './TerminalPanel';
import type { AppModel } from './useApp';

/** Sin proyecto abierto: pantalla de inicio o ajustes [R32.24]. */
export function StartView({ app }: { app: AppModel }) {
  const { api, startSettings, setStartSettings } = app;
  return (
    <div className="orq-app">
      {startSettings ? <SettingsDialog api={api} onSaved={app.config.setSettings} onClose={() => setStartSettings(false)} /> : <StartScreen api={api} engine={app.config.settings?.engine} onOpened={app.onOpened} onSettings={() => setStartSettings(true)} />}
    </div>
  );
}

export function AppNav({ app }: { app: AppModel }) {
  return <NavRail section={app.section} onGo={app.goSection} runsBadge={app.runsIndex.pending.length} designerAsking={app.askingIds.includes(app.snap.diagram.id)} />;
}

/** Modal de la última ejecución, desde la barra [R44.4]. */
export function AppRunModal({ app }: { app: AppModel }) {
  const { api, runModal, setRunModal, run, section, goRuns } = app;
  if (!runModal) return null;
  return (
    <RunModal
      api={api}
      runId={runModal}
      main={run}
      onClose={() => setRunModal(undefined)}
      // Un paso del modal lleva a la ejecución en Ejecuciones con ese paso en el lateral [R44.2].
      onPick={(key) => (setRunModal(undefined), goRuns({ section: 'history', runId: runModal, step: key }))}
      {...(section !== 'runs' ? { onOpenRuns: () => (setRunModal(undefined), goRuns({ section: 'history', runId: runModal })) } : {})}
      onExport={(id, jsonl) => downloadText(`${id}.jsonl`, jsonl)}
    />
  );
}

export function AppAlert({ app }: { app: AppModel }) {
  if (!app.message) return null;
  return (
    <div className="orq-alert" role="alert">
      <span className="orq-alert__text">{app.message}</span>
      <button type="button" className="orq-alert__close" aria-label={t('alert.close')} title={t('alert.close')} onClick={() => app.setMessage(undefined)}>
        <X size={16} aria-hidden />
      </button>
    </div>
  );
}

/** Fuera del Diseñador el asistente va en un panel acoplado [R38.1]. */
export function AssistantDock({ app }: { app: AppModel }) {
  const { layout, section } = app;
  if (!layout.assistOpen || section === 'diagrams') return null;
  return (
    <div className="orq-dock" style={{ width: layout.sideWidth }}>
      <SideResizeHandle width={layout.sideWidth} onChange={layout.setSideWidth} />
      <AppAssistant app={app} />
    </div>
  );
}

export function TerminalDock({ app }: { app: AppModel }) {
  const { hub, terms, termActive, termOpen, setTermActive, setTermOpen, closeTerminal, openTerminal } = app.terminals;
  if (!hub) return null;
  return <TerminalPanel api={app.api} hub={hub} tabs={terms} active={termActive} open={termOpen} onActive={setTermActive} onClose={closeTerminal} onNew={(p) => void openTerminal(p).catch(() => undefined)} onToggle={() => setTermOpen((v) => !v)} />;
}

/** Diálogos por encima de toda la aplicación. */
export function AppDialogs({ app }: { app: AppModel }) {
  const { api, snap, launcher, runsIndex, session, sel, lib, designer, guard, openLibrary, project, config: conf } = app;
  return (
    <>
      <LaunchDialog api={api} launcher={launcher} runsIndex={runsIndex} engine={conf.engine} currentDiagramId={snap.diagram.id} defaultMaxTokens={conf.settings?.defaultMaxTokens} defaultUnanswered={conf.settings?.unanswered} onEngine={(e) => void conf.setEngine(e)} />
      <DesignerDialogs session={session} snap={snap} sel={sel} lib={lib} designer={designer} projectOpen={project !== undefined} guard={guard} openLibrary={openLibrary} />
      {app.trust.open && app.trust.info && <TrustDialog info={app.trust.info} onDecide={(d) => void app.trust.decide(d)} onClose={() => app.trust.setOpen(false)} />}
    </>
  );
}
