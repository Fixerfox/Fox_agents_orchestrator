import { deliverableFileName, type DeliverableSpec, type DiagramNode } from '../../../diagrams';
import type { Id, Payload } from '../../../shared';
import { AgentError } from '../../adapter';
import { collectLinks, DELIVERABLE_ATTEMPTS, deliverableContext, deliverableInstructions, deliverableMarkdown, itemTitle, linksMarkdown, type DeliverableItemResult, type DeliverableLinks } from '../../deliverable';
import type { RunEvent } from '../../events';
import { checkFormat } from '../../transform';
import { errorMessage, type Outcome, type StepContext } from '../handler';

type Composed = { ok: true; text: string; attempts: number; tokens: number } | { ok: false; error: string; attempts: number; tokens: number } | 'cancelled';

/** Compone el entregable en la Salida: enlaces sin IA y el resto con un turno de Claude por elemento [R46.6]–[R46.9]. */
export async function composeDeliverable(step: StepContext, node: DiagramNode, input: Payload, spec: DeliverableSpec): Promise<Outcome> {
  const events = step.emitter.history();
  // Agentes: los que pidieron un turno y, al reanudar, los reutilizados de la ejecución anterior [R41.1].
  const agentKeys = new Set(events.filter((e) => e.type === 'agent.request' || e.type === 'node.reused').map((e) => [...(e.nodePath ?? []), (e as { nodeId: Id }).nodeId].join('/')));
  const links: DeliverableLinks = collectLinks(events, (id, p) => agentKeys.has([...p, id].join('/')));
  const root = step.root;
  const kindOf = new Map(root.nodes.map((n) => [n.id, n]));
  const last = new Map<Id, { status: string; text: string }>();
  for (const e of events) {
    if (e.type !== 'node.finished' || (e.nodePath?.length ?? 0) > 0) continue;
    const n = kindOf.get(e.nodeId);
    if (!n || !['agent', 'subdiagram', 'transform'].includes(n.kind)) continue;
    last.set(e.nodeId, { status: e.status, text: e.output?.text ?? '' });
  }
  const steps = [...last].map(([id, v]) => ({ label: kindOf.get(id)?.label ?? id, ...v }));
  const entryId = root.nodes.find((n) => n.kind === 'entry')?.id;
  const started = events.find((e): e is Extract<RunEvent, { type: 'node.started' }> => e.type === 'node.started' && e.nodeId === entryId && !e.nodePath?.length);
  const context = deliverableContext({ request: started?.input?.text ?? '', input, steps, links });
  const ctxPayload: Payload = { text: context, files: [...input.files] };

  const sections: { title: string; body: string }[] = [];
  const items: DeliverableItemResult[] = [];
  let json: string | undefined;
  for (const it of spec.items) {
    const title = itemTitle(it);
    if (it.kind === 'links') {
      sections.push({ title, body: linksMarkdown(links) });
      items.push({ kind: 'links', title, ok: true, attempts: 0 });
      continue;
    }
    const r = await composeItem(step, node, it, ctxPayload, { steps: steps.length, files: links.files.length });
    if (r === 'cancelled') return { status: 'cancelled' };
    items.push({ kind: it.kind, title, ok: r.ok, ...(r.ok ? {} : { error: r.error }), attempts: r.attempts, ...(r.tokens ? { tokens: r.tokens } : {}) });
    if (!r.ok) {
      sections.push({ title, body: `No se pudo completar: ${r.error}` });
      continue;
    }
    if (it.kind === 'json') {
      json = r.text;
      sections.push({ title, body: '```json\n' + r.text + '\n```' });
    } else sections.push({ title, body: r.text });
  }
  const ok = items.every((i) => i.ok);
  const markdown = deliverableMarkdown(sections);
  step.emitter.emit({ type: 'deliverable.done', nodeId: node.id, ok, fileName: deliverableFileName(spec), markdown, ...(json !== undefined ? { json } : {}), links, items });
  if (!ok && spec.onMissing === 'fail') {
    const why = items.filter((i) => !i.ok).map((i) => `${i.title}: ${i.error}`).join('; ');
    const reason = `El entregable no se pudo completar: ${why}`;
    step.failRun(reason);
    step.emitter.emit({ type: 'error', nodeId: node.id, message: reason, retriable: false });
    return { status: 'failed' };
  }
  return { status: 'succeeded', output: { text: markdown, files: [...input.files] } };
}

/** Un elemento compuesto con `Decider.transform`, con un reintento si no cumple el formato [R46.6]. */
async function composeItem(
  step: StepContext,
  node: DiagramNode,
  it: Exclude<DeliverableSpec['items'][number], { kind: 'links' }>,
  input: Payload,
  counts: { steps: number; files: number },
): Promise<Composed> {
  const transform = step.decider.transform?.bind(step.decider);
  if (!transform) return { ok: false, error: 'el motor activo no sabe componer con Claude', attempts: 0, tokens: 0 };
  const format = it.kind === 'json' ? 'json' : 'markdown';
  const schema = it.kind === 'json' && it.schema?.trim() ? it.schema : undefined;
  let lastError = '';
  let tokens = 0;
  for (let attempt = 1; attempt <= DELIVERABLE_ATTEMPTS; attempt++) {
    await step.gate.wait(step.signal);
    if (step.signal.aborted) return 'cancelled';
    try {
      const res = await transform(
        {
          nodeId: node.id,
          format,
          instructions: deliverableInstructions(it),
          ...(schema ? { schema } : {}),
          input,
          attempt,
          ...(lastError ? { previousError: lastError } : {}),
          deliverable: { kind: it.kind, ...(it.kind === 'custom' ? { title: it.title.trim() } : {}), ...counts },
        },
        step.signal,
      );
      if (step.signal.aborted) return 'cancelled';
      if (res.usage) {
        tokens += res.usage.inputTokens + res.usage.outputTokens;
        step.emitter.emit({ type: 'agent.usage', nodeId: node.id, inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens, ...(res.usage.costUsd !== undefined ? { costUsd: res.usage.costUsd } : {}) });
        step.budget.add(res.usage.inputTokens, res.usage.outputTokens, res.usage.costUsd);
        if (step.signal.aborted) return 'cancelled';
      }
      const r = checkFormat(res.text, format, schema, true);
      if (r.ok) return { ok: true, text: r.text, attempts: attempt, tokens };
      lastError = r.errors.join('; ');
    } catch (err) {
      if (step.signal.aborted) return 'cancelled';
      lastError = errorMessage(err);
      if (!(err instanceof AgentError && err.retriable)) return { ok: false, error: lastError, attempts: attempt, tokens };
    }
  }
  return { ok: false, error: lastError, attempts: DELIVERABLE_ATTEMPTS, tokens };
}
