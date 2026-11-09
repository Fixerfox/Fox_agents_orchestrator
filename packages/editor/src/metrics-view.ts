import type { RunMetrics } from '@orquestador/core';

const csvCell = (v: string | number): string => {
  const s = typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(4)) : v;
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** La tabla por agente de «Rendimiento» en CSV, para abrirla en una hoja de cálculo [R77.18]. */
export function metricsCsv(m: RunMetrics, name: (agentId: string) => string = (id) => id): string {
  const head = ['agente', 'pasos', 'intentos', 'reintentos', 'trabajando_s', 'esperando_s', 'en_cola_s', 'tokens', 'coste_usd'];
  const rows = m.byAgent.map((a) => [name(a.agentId), a.steps, a.attempts, a.retries, Math.round(a.workMs / 1000), Math.round(a.waitMs / 1000), Math.round(a.queueMs / 1000), a.tokens, a.costUsd]);
  const total = ['total', m.total.steps, m.total.attempts, m.total.retries, Math.round(m.total.workMs / 1000), Math.round(m.total.waitMs / 1000), Math.round(m.total.queueMs / 1000), m.total.tokens, m.total.costUsd];
  const sup = ['supervisor', 0, 0, 0, 0, 0, 0, m.supervisor.tokens, m.supervisor.costUsd];
  return `${[head, ...rows, total, sup].map((r) => r.map(csvCell).join(',')).join('\n')}\n`;
}
