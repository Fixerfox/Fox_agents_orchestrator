import { failStep, nodeStarted, type NodeHandler } from './handler';

/** Subdiagrama: una plantilla entera usada como un solo paso. */
export const subdiagramHandler: NodeHandler = {
  kind: 'subdiagram',
  async run(step, node, input, path) {
    nodeStarted(step, node, input, path);
    const { templateId, version } = node.subdiagram!;
    const { depth, emitter, stack } = step;
    if (depth + 1 > step.maxDepth) return failStep(step, node, `Profundidad máxima (${step.maxDepth}) superada`, path);
    if (stack.includes(templateId)) return failStep(step, node, `Referencia circular a la plantilla ${templateId}`, path);
    if (!step.resolveTemplate) return failStep(step, node, 'No hay resolvedor de plantillas configurado', path);

    const template = await step.resolveTemplate(templateId, version, emitter.runId);
    emitter.emit({ type: 'subdiagram.started', nodeId: node.id, templateId, version }, path);
    const r = await step.execute(template, input, [...path, node.id], depth + 1, [...stack, templateId]);
    emitter.emit({ type: 'subdiagram.finished', nodeId: node.id, status: r.status }, path);
    return { status: r.status, ...(r.output ? { output: r.output } : {}) };
  },
};
