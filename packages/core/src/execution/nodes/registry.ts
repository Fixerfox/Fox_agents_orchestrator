import type { Diagram } from '../../diagrams';
import { agentHandler } from './agent';
import { entryHandler } from './entry';
import type { NodeHandler } from './handler';
import { loopHandler } from './loop';
import { outputHandler } from './output';
import { reviewHandler } from './review';
import { routerHandler } from './router';
import { subdiagramHandler } from './subdiagram';
import { transformHandler } from './transform';

/** Qué handler ejecuta cada tipo de nodo [R56.12]. */
export class NodeRegistry {
  private readonly handlers = new Map<string, NodeHandler>();

  constructor(handlers: readonly NodeHandler[] = []) {
    for (const h of handlers) this.register(h);
  }

  register(handler: NodeHandler): this {
    this.handlers.set(handler.kind, handler);
    return this;
  }

  find(kind: string): NodeHandler | undefined {
    return this.handlers.get(kind);
  }

  /** Primer tipo sin handler del diagrama, también dentro de sus bucles. */
  missingIn(diagram: Pick<Diagram, 'nodes'>): string | undefined {
    for (const node of diagram.nodes) {
      if (!this.handlers.has(node.kind)) return node.kind;
      const inner = node.loop ? this.missingIn(node.loop.body) : undefined;
      if (inner !== undefined) return inner;
    }
    return undefined;
  }
}

/** Los tipos de nodo de la aplicación. */
export const defaultNodeRegistry = (): NodeRegistry => new NodeRegistry([entryHandler, outputHandler, agentHandler, routerHandler, loopHandler, subdiagramHandler, reviewHandler, transformHandler]);
