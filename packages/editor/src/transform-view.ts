import { applyTransformRules, checkFormat, type Diagram, type Id, type Payload, type RunEvent, type TransformConfig } from '@orquestador/core';
import { t, type MessageKey } from './i18n';

/** De dónde sale la entrada de la vista previa [R37.13]. */
export type PreviewSource = 'run' | 'prev' | 'sample' | 'none';

export interface TransformPreview {
  source: PreviewSource;
  /** Lo que se transforma. */
  input?: Payload;
  result?: { ok: true; text: string; warnings: string[] } | { ok: false; errors: string[]; warnings: string[] };
}

const samePath = (e: RunEvent, path: readonly Id[]) => {
  const np = e.nodePath ?? [];
  return np.length === path.length && np.every((x, i) => x === path[i]);
};

/**
 * Entrada para la vista previa, sin ejecutar nada: lo que el nodo recibió en la última ejecución, si no lo que
 * salió del paso anterior en esa ejecución y si no el ejemplo pegado [R37.13].
 */
export function previewInput(events: readonly RunEvent[], level: Diagram, path: readonly Id[], nodeId: Id, sample: string | undefined): { source: PreviewSource; input?: Payload } {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === 'node.started' && e.nodeId === nodeId && e.input && samePath(e, path)) return { source: 'run', input: e.input };
  }
  const from = level.edges.filter((e) => e.to === nodeId).map((e) => e.from);
  const outputs: { label: string; payload: Payload }[] = [];
  for (const id of from) {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i]!;
      if (e.type === 'node.finished' && e.nodeId === id && e.output && samePath(e, path)) {
        outputs.push({ label: level.nodes.find((n) => n.id === id)?.label ?? id, payload: e.output });
        break;
      }
    }
  }
  if (outputs.length === 1) return { source: 'prev', input: outputs[0]!.payload };
  if (outputs.length > 1) {
    // Igual que el motor: varias entradas se juntan con el nombre de cada paso.
    return { source: 'prev', input: { text: outputs.map((o) => `## ${o.label}\n${o.payload.text}`).join('\n\n'), files: [...new Set(outputs.flatMap((o) => o.payload.files))] } };
  }
  if (sample?.trim()) return { source: 'sample', input: { text: sample, files: [] } };
  return { source: 'none' };
}

/** Vista previa sin tokens: reglas aplicadas de verdad; con Claude, solo si la entrada ya cumple el formato [R37.13]. */
export function previewTransform(cfg: TransformConfig, events: readonly RunEvent[], level: Diagram, path: readonly Id[], nodeId: Id): TransformPreview {
  const src = previewInput(events, level, path, nodeId, cfg.sample);
  if (!src.input) return { source: src.source };
  if (cfg.mode === 'rules') return { ...src, result: applyTransformRules(cfg, src.input) };
  const r = checkFormat(src.input.text, cfg.format, cfg.schema, true);
  return { ...src, result: r.ok ? { ok: true, text: r.text, warnings: [] } : { ok: false, errors: r.errors, warnings: [] } };
}

/** Subtítulo de la tarjeta: «JSON · por reglas», «Markdown · con Claude»… [R37.14]. */
export function transformSubtitle(cfg: TransformConfig | undefined): string | undefined {
  if (!cfg) return undefined;
  return t('node.sub.transform', { format: t(`tf.format.${cfg.format}` as MessageKey), mode: t(`tf.mode.${cfg.mode}` as MessageKey) });
}

/** Solo vale la última ejecución si es de este diagrama: otro diagrama puede tener nodos con los mismos ids [R37.13]. */
export function eventsOfDiagram(events: readonly RunEvent[], diagramId: Id): readonly RunEvent[] {
  const started = events.find((e) => e.type === 'run.started');
  return started && started.type === 'run.started' && started.diagramId === diagramId ? events : [];
}
