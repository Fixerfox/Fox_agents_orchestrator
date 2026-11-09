import { validateDiagram, type Diagram } from '../../diagrams';
import type { Id } from '../../shared';
import type { RunServices } from '../nodes/handler';
import { errorMessage } from '../nodes/handler';
import type { NodeRegistry } from '../nodes/registry';

/** Un problema del árbol de diagramas, con la ruta del contenedor en el que está [R74.9]. */
export interface TreeProblem {
  message: string;
  path: Id[];
}

/** Clave de una plantilla resuelta: id y versión [R74.9]. */
export const templateKey = (templateId: Id, version: number | 'latest') => `${templateId}@${version}`;

/**
 * Valida todo el árbol antes de ejecutar nada [R74.9]: tipos sin handler (R56.12), cada nivel con `validateDiagram`,
 * profundidad máxima y referencias circulares, resolviendo cada subdiagrama de la copia de la ejecución (R52.1). Las
 * plantillas resueltas se guardan para que la ejecución use exactamente esas.
 */
export async function validateTree(root: Diagram, run: Pick<RunServices, 'resolveTemplate' | 'maxDepth' | 'templates' | 'emitter'>, nodes: NodeRegistry): Promise<TreeProblem[]> {
  const out: TreeProblem[] = [];
  const walk = async (d: Diagram, path: Id[], depth: number, stack: Id[]): Promise<void> => {
    const missing = nodes.missingIn(d);
    if (missing !== undefined) {
      out.push({ message: `No se sabe ejecutar el tipo de nodo «${missing}»`, path });
      return;
    }
    const issues = validateDiagram(d);
    if (issues.length > 0) {
      out.push({ message: `Diagrama inválido: ${issues.map((i) => `${i.code}: ${i.message}`).join('; ')}`, path });
      return;
    }
    for (const n of d.nodes) {
      const inner = [...path, n.id];
      if (n.kind === 'loop' && n.loop) {
        if (depth + 1 > run.maxDepth) out.push({ message: `Profundidad máxima (${run.maxDepth}) superada en «${n.label ?? n.id}»`, path });
        else await walk(n.loop.body, inner, depth + 1, stack);
      }
      if (n.kind === 'subdiagram' && n.subdiagram) {
        const { templateId, version } = n.subdiagram;
        if (depth + 1 > run.maxDepth) {
          out.push({ message: `Profundidad máxima (${run.maxDepth}) superada en «${n.label ?? n.id}»`, path });
          continue;
        }
        if (stack.includes(templateId)) {
          out.push({ message: `Referencia circular a la plantilla ${templateId} en «${n.label ?? n.id}»`, path });
          continue;
        }
        if (!run.resolveTemplate) {
          out.push({ message: 'No hay resolvedor de plantillas configurado', path });
          continue;
        }
        const key = templateKey(templateId, version);
        let template = run.templates?.get(key);
        if (!template) {
          try {
            template = await run.resolveTemplate(templateId, version, run.emitter.runId);
          } catch (err) {
            out.push({ message: `No se encontró la plantilla de «${n.label ?? n.id}»: ${errorMessage(err)}`, path });
            continue;
          }
          run.templates?.set(key, template);
        }
        await walk(template, inner, depth + 1, [...stack, templateId]);
      }
    }
  };
  await walk(root, [], 0, [root.id]);
  return out;
}
