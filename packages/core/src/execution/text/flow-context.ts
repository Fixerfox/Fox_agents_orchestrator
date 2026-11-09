import { returnEdges, splitBranchIds, type Diagram, type DiagramNode, type ReturnInfo } from '../../diagrams';
import { isCoordinator, type Id } from '../../shared';

/** Lo que necesita un paso para saber qué tiene alrededor [R80.1]. */
export interface FlowView {
  /** Diagrama del nivel en el que está el paso. */
  diagram: Pick<Diagram, 'nodes' | 'edges'>;
  nodeId: Id;
  /** Bucles y subdiagramas en los que está, del más cercano al más lejano. */
  containers?: readonly DiagramNode[];
  /** Vuelta del bucle más cercano (1, 2…) [R80.6]. */
  loopRound?: number;
  /** Nombre de un agente del registro. */
  agentName?(agentId: Id): string | undefined;
}

export const FLOW_HEADING = '## Tu sitio en el flujo';
/** Como mucho tantos destinos [R80.2]. */
export const FLOW_MAX_TARGETS = 6;
export const FLOW_ONLY_YOURS = 'Haz solo tu tarea: lo que hacen los pasos siguientes no te toca a ti.';

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
const clip = (s: string, n: number) => {
  const t = oneLine(s);
  return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t;
};
const nameOf = (n: DiagramNode | undefined, id: Id) => `«${n?.label?.trim() || id}»`;
const FORMAT: Record<string, string> = { json: 'JSON', markdown: 'Markdown', text: 'texto' };

interface Level {
  byId: Map<Id, DiagramNode>;
  returns: Map<Id, ReturnInfo>;
  label(id: Id): string;
  returnOf(reviewId: Id): ReturnInfo | undefined;
}

function levelOf(view: FlowView): Level {
  const byId = new Map(view.diagram.nodes.map((n) => [n.id, n]));
  const returns = returnEdges(view.diagram);
  return { byId, returns, label: (id) => nameOf(byId.get(id), id), returnOf: (reviewId) => [...returns.values()].find((r) => r.reviewId === reviewId) };
}

function describe(view: FlowView, lv: Level, id: Id): string {
  const n = lv.byId.get(id);
  const name = lv.label(id);
  const parent = view.containers?.[0];
  switch (n?.kind) {
    case 'agent': {
      const agent = n.agentId ? (view.agentName?.(n.agentId) ?? n.agentId) : undefined;
      return `${name}${agent ? `, agente «${agent}»` : ''}: ${n.task?.trim() ? clip(n.task, 160) : 'sin tarea'}`;
    }
    case 'router': {
      const how = n.router?.mode === 'rules' ? 'por reglas' : 'con IA';
      const options = view.diagram.edges.filter((e) => e.from === id).map((e) => `${lv.label(e.to)}${e.condition?.trim() ? ` (si: ${clip(e.condition, 120)})` : ''}`);
      return `El router ${name}, que elige ${how} por dónde sigue entre: ${options.join(', ') || '(sin opciones)'}`;
    }
    case 'review': {
      const r = n.review;
      if (r?.mode === 'human') return `La revisión ${name}: la revisa la persona.`;
      const back = lv.returnOf(id);
      return [
        `La revisión ${name}, que decide si se aprueba`,
        r?.criteria?.trim() ? ` con este criterio: ${clip(r.criteria, 160)}` : '',
        r ? ` (como mucho ${r.maxRounds} vueltas)` : '',
        back ? `; si se rechaza, vuelve a ${lv.label(back.targetId)} con las correcciones` : '',
        '.',
      ].join('');
    }
    case 'transform':
      return `${name}, que la convierte a ${FORMAT[n.transform?.format ?? 'text'] ?? 'texto'}.`;
    case 'loop':
      return `El bucle ${name}.`;
    case 'subdiagram':
      return `El subdiagrama ${name}.`;
    case 'output':
      if (!parent) return 'La salida final de la ejecución.';
      return parent.kind === 'loop' ? `El final de esta vuelta del bucle ${nameOf(parent, parent.id)}.` : `La salida del subdiagrama ${nameOf(parent, parent.id)}.`;
    default:
      return `${name}.`;
  }
}

/** Cómo se describe un destino, a un agente o a un router [R80.2][R81.2]. `view.nodeId` no se usa. */
export function describeTarget(view: Omit<FlowView, 'nodeId' | 'loopRound'>, id: Id): string {
  return describe({ ...view, nodeId: id }, levelOf({ ...view, nodeId: id }), id);
}

/** Texto de «Tu sitio en el flujo», o nada si no hay qué contar [R80.1]–[R80.7]. */
export function flowContext(view: FlowView): string | undefined {
  const { diagram: d, nodeId } = view;
  const lv = levelOf(view);
  const { byId, returns, label } = lv;
  const self = byId.get(nodeId);
  const containers = view.containers ?? [];

  // Destinos directos, sin retornos ni, en un Coordinador, sus ramas de reparto [R80.2][R80.3].
  const branches = self && isCoordinator(self) ? new Set(splitBranchIds(d, nodeId)) : new Set<Id>();
  const targets = [...new Set(d.edges.filter((e) => e.from === nodeId && !returns.has(e.id)).map((e) => e.to))].filter((id) => !branches.has(id));

  const parts: string[] = [];
  if (targets.length > 0) {
    const lines = targets.slice(0, FLOW_MAX_TARGETS).map((id) => `- ${describe(view, lv, id)}`);
    if (targets.length > FLOW_MAX_TARGETS) lines.push(`- (y ${targets.length - FLOW_MAX_TARGETS} más)`);
    parts.push(`Después de ti, tu salida la recibe:\n${lines.join('\n')}`);
  }

  // Quien revisa sin ser el destino del retorno escribe el veredicto [R81.6][R81.7].
  for (const id of targets) {
    const back = byId.get(id)?.review?.mode === 'verdict' ? lv.returnOf(id) : undefined;
    if (!back || back.targetId === nodeId || !back.segment.has(nodeId)) continue;
    parts.push(`Esa revisión lee tu veredicto: termina tu respuesta con una línea «VEREDICTO: APROBADO» o «VEREDICTO: RECHAZADO». Si rechazas, explica qué hay que corregir: es lo que recibirá ${label(back.targetId)}.`);
  }

  // La revisión por la que pasa su tramo, si no es un destino directo [R80.5].
  for (const info of returns.values()) {
    if (!info.segment.has(nodeId) || info.reviewId === nodeId || targets.includes(info.reviewId)) continue;
    const max = byId.get(info.reviewId)?.review?.maxRounds;
    parts.push(`Tu trabajo pasa después por la revisión ${label(info.reviewId)}${max ? ` (como mucho ${max} vueltas)` : ''}: si la rechaza, vuelve a ${label(info.targetId)} con las correcciones.`);
  }

  // El bucle más cercano y su vuelta [R80.6].
  const loop = containers.find((c) => c.kind === 'loop');
  if (loop?.loop) {
    const cfg = loop.loop;
    const n = view.loopRound ?? 1;
    const head = `Estás dentro del bucle ${nameOf(loop, loop.id)}`;
    const round =
      cfg.mode === 'count'
        ? `${head}: vuelta ${n} de ${Math.min(cfg.count ?? 1, cfg.maxIterations)}.`
        : `${head}: vuelta ${n}, como mucho ${cfg.maxIterations}.${cfg.prompt?.trim() ? ` Se repite hasta que: ${clip(cfg.prompt, 200)}` : ''}`;
    parts.push(`${round} Lo que entregues en esta vuelta será la entrada de la siguiente.`);
  }

  if (parts.length === 0) return undefined;
  // Si después trabaja alguien más, no le toca su trabajo [R80.4].
  if (targets.some((id) => ['agent', 'router', 'review'].includes(byId.get(id)?.kind ?? ''))) parts.push(FLOW_ONLY_YOURS);
  return [FLOW_HEADING, ...parts].join('\n\n');
}
