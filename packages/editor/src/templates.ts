import { type Diagram, type Id } from '@orquestador/core';
import { t } from './i18n';
import { createDiagram } from './ops';

export interface ExampleTemplate {
  id: string;
  name: string;
  description: string;
  diagram: Diagram;
}

/** Enrutador: una entrada, un router (IA) y tres agentes que desembocan en la salida. */
function routerExample(): Diagram {
  const d = createDiagram('ejemplo-enrutador', t('template.router.name'));
  const agents = [
    { id: 'sprites', y: 20 },
    { id: 'gameplay', y: 140 },
    { id: 'sonido', y: 260 },
  ];
  return {
    ...d,
    nodes: [
      { ...d.nodes[0]!, position: { x: 0, y: 140 } },
      { id: 'router', kind: 'router', label: t('node.router'), router: { mode: 'ai' }, position: { x: 220, y: 140 } },
      ...agents.map((a) => ({
        id: a.id,
        kind: 'agent' as const,
        agentId: a.id,
        label: a.id,
        position: { x: 460, y: a.y },
      })),
      { ...d.nodes[1]!, position: { x: 700, y: 140 } },
    ],
    edges: [
      { id: 'entry->router', from: 'entry', to: 'router' },
      ...agents.flatMap((a) => [
        { id: `router->${a.id}`, from: 'router', to: a.id },
        { id: `${a.id}->output`, from: a.id, to: 'output' },
      ]),
    ],
  };
}

/** Un agente crea y un bucle con evaluador IA revisa hasta que cumple (máximo 5 vueltas). */
function reviewExample(): Diagram {
  const d = createDiagram('ejemplo-revision', t('template.review.name'));
  const body = createDiagram('revision-cuerpo', t('node.loop'));
  return {
    ...d,
    nodes: [
      { ...d.nodes[0]!, position: { x: 0, y: 100 } },
      { id: 'creador', kind: 'agent', agentId: 'creador', label: 'creador', position: { x: 220, y: 100 } },
      {
        id: 'revision',
        kind: 'loop',
        label: 'Revisión',
        position: { x: 440, y: 100 },
        loop: {
          mode: 'ai-judge',
          prompt: '¿El resultado cumple lo pedido?',
          maxIterations: 5,
          body: {
            ...body,
            nodes: [
              body.nodes[0]!,
              { id: 'revisor', kind: 'agent', agentId: 'revisor', label: 'revisor', position: { x: 210, y: 120 } },
              body.nodes[1]!,
            ],
            edges: [
              { id: 'entry->revisor', from: 'entry', to: 'revisor' },
              { id: 'revisor->output', from: 'revisor', to: 'output' },
            ],
          },
        },
      },
      { ...d.nodes[1]!, position: { x: 680, y: 100 } },
    ],
    edges: [
      { id: 'entry->creador', from: 'entry', to: 'creador' },
      { id: 'creador->revision', from: 'creador', to: 'revision' },
      { id: 'revision->output', from: 'revision', to: 'output' },
    ],
  };
}

/** Varios agentes a la vez (fondo, scripts y música de un mundo) y uno que junta sus resultados [R32.36]. */
function parallelExample(): Diagram {
  const d = createDiagram('ejemplo-paralelo', t('template.parallel.name'));
  const branches = [
    { id: 'fondo', agentId: 'sprites', label: 'Fondo', task: 'Dibuja el fondo del mundo que se describe en la entrada.', y: 0 },
    { id: 'scripts', agentId: 'gameplay', label: 'Scripts', task: 'Escribe los scripts de comportamiento de ese mundo.', y: 150 },
    { id: 'musica', agentId: 'sonido', label: 'Música', task: 'Propón la música y los efectos de sonido del mundo.', y: 300 },
  ];
  return {
    ...d,
    nodes: [
      { ...d.nodes[0]!, position: { x: 0, y: 150 } },
      ...branches.map((b) => ({ id: b.id, kind: 'agent' as const, agentId: b.agentId, label: b.label, task: b.task, position: { x: 280, y: b.y } })),
      { id: 'unir', kind: 'agent', agentId: 'revisor', label: 'Unir', task: t('parallel.join.task'), position: { x: 560, y: 150 } },
      { ...d.nodes[1]!, position: { x: 840, y: 150 } },
    ],
    edges: [
      ...branches.flatMap((b) => [
        { id: `entry->${b.id}`, from: 'entry', to: b.id },
        { id: `${b.id}->unir`, from: b.id, to: 'unir' },
      ]),
      { id: 'unir->output', from: 'unir', to: 'output' },
    ],
  };
}

/** Crea → QA → Revisión: si el QA rechaza, vuelve al creador con las correcciones (máx. 3 vueltas) [R34.25]. */
function qaExample(): Diagram {
  const d = createDiagram('ejemplo-qa', t('template.qa.name'));
  return {
    ...d,
    nodes: [
      { ...d.nodes[0]!, position: { x: 0, y: 120 } },
      { id: 'creador', kind: 'agent', agentId: 'creador', label: 'creador', task: t('template.qa.task.creator'), position: { x: 220, y: 100 } },
      { id: 'qa', kind: 'agent', agentId: 'revisor', label: 'qa', task: t('template.qa.task.qa'), position: { x: 500, y: 100 } },
      { id: 'revision', kind: 'review', label: t('node.review'), review: { maxRounds: 3, mode: 'verdict' }, position: { x: 780, y: 100 } },
      { ...d.nodes[1]!, position: { x: 1200, y: 120 } },
    ],
    edges: [
      { id: 'entry->creador', from: 'entry', to: 'creador' },
      { id: 'creador->qa', from: 'creador', to: 'qa' },
      { id: 'qa->revision', from: 'qa', to: 'revision' },
      { id: 'revision.approved->output', from: 'revision', to: 'output', port: 'approved' },
      { id: 'revision.rejected->creador', from: 'revision', to: 'creador', port: 'rejected' },
      { id: 'revision.exhausted->output', from: 'revision', to: 'output', port: 'exhausted' },
    ],
  };
}

import { SPECKIT_TEMPLATE_ID, specKitDiagram } from './speckit';

export function exampleTemplates(): ExampleTemplate[] {
  return [
    { id: 'enrutador', name: t('template.router.name'), description: t('template.router.desc'), diagram: routerExample() },
    { id: 'revision', name: t('template.review.name'), description: t('template.review.desc'), diagram: reviewExample() },
    { id: 'paralelo', name: t('template.parallel.name'), description: t('template.parallel.desc'), diagram: parallelExample() },
    { id: 'qa', name: t('template.qa.name'), description: t('template.qa.desc'), diagram: qaExample() },
    { id: SPECKIT_TEMPLATE_ID, name: t('template.speckit.name'), description: t('template.speckit.desc'), diagram: specKitDiagram() },
  ];
}

/** Copia independiente de una plantilla lista para usarse como diagrama nuevo. */
export function instantiateTemplate(template: ExampleTemplate, id: Id, name?: string): Diagram {
  return { ...structuredClone(template.diagram), id, name: name ?? template.name };
}
