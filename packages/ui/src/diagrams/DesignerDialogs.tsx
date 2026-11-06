import { BookOpen, Plug } from 'lucide-react';
import { t, type EditorSession, type EditorSnapshot } from '@orquestador/editor';
import { AssignPicker, type OpenLibrary } from '../common';
import { AgentPicker } from './AgentPicker';
import { InsertPicker, type InsertChoice } from './InsertPicker';
import { ParallelDialog } from './ParallelDialog';
import type { Designer } from './useDesigner';
import type { DesignerSelection } from './useDesignerSelection';
import type { ProjectCatalog } from './useProjectCatalog';

interface Props {
  session: EditorSession;
  snap: EditorSnapshot;
  sel: DesignerSelection;
  lib: ProjectCatalog;
  designer: Designer;
  projectOpen: boolean;
  guard: (fn: () => void) => void;
  openLibrary: OpenLibrary;
}

/** Diálogos que abre el Diseñador: insertar, conocimiento de un paso, ramas en paralelo y elegir agente. */
export function DesignerDialogs({ session, snap, sel, lib, designer, projectOpen, guard, openLibrary }: Props) {
  const { agents } = lib;
  const { inserting, setInserting, parallelAt, setParallelAt, picker, setPicker } = designer;
  const { select } = sel;
  return (
    <>
      {inserting && (
        <InsertPicker
          agents={agents}
          at={inserting.at}
          onClose={() => setInserting(undefined)}
          onCreate={() => {
            setInserting(undefined);
            openLibrary('agents', { tab: 'agents', id: 'new' });
          }}
          onPick={(choice: InsertChoice) => {
            const edgeId = inserting.edgeId;
            setInserting(undefined);
            guard(() => select(session.insertOnEdge(edgeId, choice)));
          }}
          onParallel={() => {
            const edgeId = inserting.edgeId;
            setInserting(undefined);
            setParallelAt(edgeId);
          }}
        />
      )}
      {designer.portPick && <PortPicker session={session} snap={snap} lib={lib} designer={designer} guard={guard} openLibrary={openLibrary} pick={designer.portPick} />}
      {parallelAt && (
        <ParallelDialog
          agents={agents}
          between={(() => {
            const e = snap.level.edges.find((x) => x.id === parallelAt);
            const name = (id?: string) => snap.level.nodes.find((n) => n.id === id)?.label ?? id ?? '';
            return e ? { from: name(e.from), to: name(e.to) } : undefined;
          })()}
          onClose={() => setParallelAt(undefined)}
          onInsert={(spec) => {
            const edgeId = parallelAt;
            setParallelAt(undefined);
            guard(() => {
              const r = session.insertParallel(edgeId, spec);
              select(r.joinId ?? r.ids[0]!);
            });
          }}
        />
      )}
      {picker && (
        <AgentPicker
          agents={agents}
          onClose={() => setPicker(undefined)}
          projectOpen={projectOpen}
          onCreate={() => {
            setPicker(undefined);
            openLibrary('agents', { tab: 'agents', id: 'new' });
          }}
          onPick={(agentId) => {
            const { at, replace } = picker;
            setPicker(undefined);
            if (replace) guard(() => session.updateNode(replace, { agentId }));
            else designer.onAdd({ kind: 'agent', agentId }, at);
          }}
        />
      )}
    </>
  );
}

/** «+» de un conector: skills y contextos, o MCP, solo para ese paso [R33.10]. */
function PortPicker({ session, snap, lib, designer, guard, openLibrary, pick }: Pick<Props, 'session' | 'snap' | 'lib' | 'designer' | 'guard' | 'openLibrary'> & { pick: NonNullable<Designer['portPick']> }) {
  const { catalog } = lib;
  const { setPortPick } = designer;
  const node = snap.level.nodes.find((n) => n.id === pick.nodeId);
  if (!node) return null;
  const name = node.label ?? node.id;
  const know = pick.port === 'know';
  const items = know
    ? [...catalog.skills.map((k) => ({ id: `s:${k.id}`, name: k.name, description: t('res.kind.skill') })), ...catalog.contexts.map((c) => ({ id: `c:${c.id}`, name: c.name, description: t('res.kind.context') }))]
    : (catalog.mcp ?? []).map((m) => ({ id: m.id, name: m.name, ...(m.description ? { description: m.description } : {}) }));
  const selected = know ? [...(node.extra?.skillIds ?? []).map((x) => `s:${x}`), ...(node.extra?.contextIds ?? []).map((x) => `c:${x}`)] : (node.extra?.mcpIds ?? []);
  return (
    <AssignPicker
      title={t(know ? 'res.pick.know' : 'res.pick.mcp', { name })}
      icon={know ? BookOpen : Plug}
      items={items}
      selected={selected}
      emptyText={t('res.pick.empty')}
      createLabel={t('res.pick.create')}
      onCreate={() => (setPortPick(undefined), openLibrary('knowledge', { tab: know ? 'skills' : 'mcp', id: 'new' }))}
      onClose={() => setPortPick(undefined)}
      onApply={(ids) => {
        setPortPick(undefined);
        const extra = know
          ? { ...node.extra, skillIds: ids.filter((x) => x.startsWith('s:')).map((x) => x.slice(2)), contextIds: ids.filter((x) => x.startsWith('c:')).map((x) => x.slice(2)) }
          : { ...node.extra, mcpIds: ids };
        guard(() => session.updateNode(node.id, { extra }));
      }}
    />
  );
}
