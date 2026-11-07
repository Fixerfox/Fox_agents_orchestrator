import { useCallback, useEffect, useState } from 'react';
import type { AgentDefinition, ContextDefinition, SkillDefinition } from '@orquestador/core';
import { t, type McpView, type ProjectApi } from '@orquestador/editor';
import type { DraftStore } from '../common';
import { AgentForm } from './AgentForm';

interface Library {
  agents: AgentDefinition[];
  contexts: ContextDefinition[];
  skills: SkillDefinition[];
  mcp: McpView[];
}

interface Props {
  api: ProjectApi;
  /** Los mismos borradores que Agentes: lo que no se guarda sigue ahí al volver [R64.5]. */
  drafts: DraftStore;
  agentId: string;
  busy: boolean;
  assistantReady: boolean;
  onSaved: () => void;
  /** Abre Conocimiento (crear o ver una skill, contexto o MCP) [R22.11]. */
  onCreateOther: (tab: 'contexts' | 'skills' | 'mcp', id?: string) => void;
}

/** La ficha de un agente fuera de Agentes (ventana «Configurar» del diagrama), sin «Eliminar» [R64.4]. */
export function AgentQuickEditor({ api, drafts, agentId, busy, assistantReady, onSaved, onCreateOther }: Props) {
  const [lib, setLib] = useState<Library>();
  const [saved, setSaved] = useState(false);
  const reload = useCallback(async () => {
    const [a, c, k, m] = await Promise.all([api.listAgents(), api.listContexts(), api.listSkills(), api.listMcp()]);
    setLib({ agents: a.ok ? a.value : [], contexts: c.ok ? c.value : [], skills: k.ok ? k.value : [], mcp: m.ok ? m.value : [] });
  }, [api]);
  useEffect(() => void reload(), [reload]);
  const original = lib?.agents.find((a) => a.id === agentId);
  if (!lib || !original) return <p className="orq-hint">{t('stepcfg.agent.loading')}</p>;
  return (
    <AgentForm
      key={original.id}
      api={api}
      drafts={drafts}
      draftKey={`agents:${original.id}`}
      original={original}
      agents={lib.agents}
      contexts={lib.contexts}
      skills={lib.skills}
      mcp={lib.mcp}
      justSaved={saved}
      onSaved={() => {
        setSaved(true);
        void reload();
        onSaved();
      }}
      onDeleted={() => undefined}
      onCreateOther={onCreateOther}
      busy={busy}
      assistantReady={assistantReady}
      deletable={false}
    />
  );
}
