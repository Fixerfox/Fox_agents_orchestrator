import type { ContextKind, AgentDefinition, ContextDefinition, KindFolders, SkillDefinition } from '@orquestador/core';
import type { McpView, ProjectApi } from '@orquestador/editor';
import type { DraftStore, LibRow, LibraryTab } from '../common';
import { AgentForm } from './AgentForm';
import { ContextForm } from './ContextForm';
import { NEW } from './editorParts';
import { LibraryOverview } from './LibraryOverview';
import { McpForm } from './McpForm';
import { AgentWelcome, ContextWelcome, McpWelcome, SkillWelcome } from './McpWelcome';
import { SkillForm } from './SkillForm';

interface Props {
  api: ProjectApi;
  tab: LibraryTab;
  drafts: DraftStore;
  agents: AgentDefinition[];
  contexts: ContextDefinition[];
  skills: SkillDefinition[];
  mcp: McpView[];
  rows: LibRow[];
  folders: KindFolders;
  loaded: boolean;
  showWelcome: boolean;
  assistantReady: boolean;
  sel: string | undefined;
  setSel: (id: string | undefined) => void;
  current: { id: string; name: string } | undefined;
  savedId: string | undefined;
  setSavedId: (id: string | undefined) => void;
  setManual: (manual: boolean) => void;
  seed: string | undefined;
  setSeed: (seed: string) => void;
  ctxPick: boolean;
  setInstalling: (open: boolean) => void;
  specKitComplete: boolean;
  specKitHere: boolean;
  speckit: string;
  addSpecKit: () => Promise<void>;
  manualContext: (kind: ContextKind, pickNow?: boolean) => void;
  diagramUses: Record<string, number>;
  usedBy: (kind: 'contexts' | 'skills' | 'mcp', id: string) => AgentDefinition[];
  changed: (nextSel?: string) => Promise<void>;
  createOther: (to: 'contexts' | 'skills' | 'mcp', id?: string) => void;
  busy: { agents: Set<string>; skills: Set<string>; contexts: Set<string>; mcp?: Set<string> } | undefined;
  onAskClaude: ((text: string) => void) | undefined;
  onOpenTerminal: (() => void) | undefined;
}

/** Zona derecha: bienvenida, resumen o la ficha del elemento abierto [R32.14][R38.6]. */
export function LibraryDetail({ api, tab, drafts, agents, contexts, skills, mcp, rows, folders, loaded, showWelcome, assistantReady, sel, setSel, current, savedId, setSavedId, setManual, seed, setSeed, ctxPick, setInstalling, specKitComplete, specKitHere, speckit, addSpecKit, manualContext, diagramUses, usedBy, changed, createOther, busy, onAskClaude, onOpenTerminal }: Props) {
  return (
    <div className="orq-lib__editor">
      {!loaded ? null : showWelcome && tab === 'agents' ? (
        <AgentWelcome
          ready={assistantReady}
          onStart={(text) => (setSeed(text), setManual(true))}
          onWrite={() => setManual(true)}
          onInstall={() => setInstalling(true)}
          onSpecKit={specKitComplete ? undefined : () => void addSpecKit().then(() => setSel(undefined))}
        />
      ) : showWelcome && tab === 'mcp' ? (
        <McpWelcome ready={assistantReady} onAsk={(text) => onAskClaude?.(text)} onManual={() => setManual(true)} />
      ) : showWelcome && tab === 'skills' ? (
        <SkillWelcome
          ready={assistantReady}
          onAsk={(text) => onAskClaude?.(text)}
          onWrite={() => setManual(true)}
          onInstall={() => setInstalling(true)}
          onSpecKit={specKitComplete ? undefined : () => void addSpecKit().then(() => setSel(undefined))}
        />
      ) : showWelcome && tab === 'contexts' ? (
        <ContextWelcome ready={assistantReady} onAsk={(text) => onAskClaude?.(text)} onWrite={() => manualContext('text')} onFiles={() => manualContext('file', true)} onUrl={() => manualContext('url')} />
      ) : sel === undefined || (sel !== NEW && current === undefined) ? (
        <LibraryOverview
          tab={tab}
          rows={rows}
          folders={folders}
          onOpen={(id) => (setSavedId(undefined), setSel(id))}
          onNew={() => (setSavedId(undefined), setManual(false), setSel(NEW))}
          {...(onAskClaude && tab !== 'mcp' ? { onAsk: onAskClaude } : {})}
          {...(onAskClaude && tab === 'mcp' ? { onAsk: () => (setSavedId(undefined), setSel(NEW)) } : {})}
          isUnused={(id) => (tab === 'agents' ? diagramUses[id] === 0 : usedBy(tab as 'contexts' | 'skills' | 'mcp', id).length === 0)}
          isOff={(id) => tab === 'mcp' && mcp.find((m) => m.id === id)?.enabled === false}
          {...(specKitHere ? { specKit: { state: speckit, onAdd: () => void addSpecKit() } } : {})}
        />
      ) : tab === 'agents' ? (
        <AgentForm
          key={`${tab}:${sel}`}
          api={api}
          drafts={drafts}
          draftKey={`${tab}:${sel}`}
          original={current as AgentDefinition | undefined}
          agents={agents}
          contexts={contexts}
          skills={skills}
          mcp={mcp}
          justSaved={savedId === sel}
          onSaved={(id) => void changed(id)}
          onDeleted={() => void changed(undefined)}
          onCreateOther={createOther}
          busy={sel !== undefined && busy?.agents.has(sel) === true}
          {...(sel === NEW && seed ? { seed } : {})}
          assistantReady={assistantReady}
        />
      ) : tab === 'mcp' ? (
        <McpForm
          key={`${tab}:${sel}`}
          api={api}
          drafts={drafts}
          draftKey={`${tab}:${sel}`}
          original={current as McpView | undefined}
          servers={mcp}
          agents={agents}
          justSaved={savedId === sel}
          onSaved={(id) => void changed(id)}
          onDeleted={() => void changed(undefined)}
          onAgentsChanged={() => void changed(sel === NEW ? undefined : sel)}
          busy={sel !== undefined && busy?.mcp?.has(sel) === true}
          {...(onAskClaude ? { onAskClaude } : {})}
          {...(onOpenTerminal ? { onOpenTerminal } : {})}
        />
      ) : tab === 'skills' ? (
        <SkillForm
          key={`${tab}:${sel}`}
          api={api}
          drafts={drafts}
          draftKey={`${tab}:${sel}`}
          original={current as SkillDefinition | undefined}
          skills={skills}
          agents={agents}
          justSaved={savedId === sel}
          onSaved={(id) => void changed(id)}
          onDeleted={() => void changed(undefined)}
          onAgentsChanged={() => void changed(sel === NEW ? undefined : sel)}
          busy={sel !== undefined && busy?.skills.has(sel) === true}
        />
      ) : (
        <ContextForm
          key={`${tab}:${sel}`}
          api={api}
          drafts={drafts}
          draftKey={`${tab}:${sel}`}
          original={current as ContextDefinition | undefined}
          contexts={contexts}
          agents={agents}
          justSaved={savedId === sel}
          onSaved={(id) => void changed(id)}
          onDeleted={() => void changed(undefined)}
          onAgentsChanged={() => void changed(sel === NEW ? undefined : sel)}
          busy={sel !== undefined && busy?.contexts.has(sel) === true}
          autoPick={sel === NEW && ctxPick}
        />
      )}
    </div>
  );
}
