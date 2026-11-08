// Vuelve a pasar los casos de referencia del Supervisor por el prompt actual con un modelo real [R75.23].
// Uso: npm run supervisor:eval -- <carpeta del proyecto>
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ClaudeDecider, sdkQuery } from '@orquestador/claude';
import { caseAgrees, defaultSettings, type SupervisorCase } from '@orquestador/core';

async function main(): Promise<void> {
  const project = process.argv[2];
  if (!project) throw new Error('Di la carpeta del proyecto: npm run supervisor:eval -- <carpeta>');
  const file = join(project, '.orquestador', 'supervisor', 'cases.jsonl');
  const cases = readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as SupervisorCase).filter((c) => c.step);
  const decider = new ClaudeDecider({ query: sdkQuery, projectRoot: project, settings: () => ({ ...defaultSettings(), engine: 'claude' }), apiKey: async () => process.env['ANTHROPIC_API_KEY'] });
  let agree = 0;
  const byRule = new Map<string, { n: number; ok: number }>();
  for (const c of cases) {
    const v = await decider.supervise({ step: c.step!.label ?? c.rule, input: { text: c.step!.input, files: [] }, actions: [], output: { text: c.step!.output, files: c.step!.files } }, new AbortController().signal);
    const ok = caseAgrees(c, v);
    if (ok) agree++;
    const r = byRule.get(c.rule) ?? { n: 0, ok: 0 };
    r.n++;
    if (ok) r.ok++;
    byRule.set(c.rule, r);
    process.stdout.write(`${ok ? '✓' : '✗'} ${c.rule} · persona: ${c.person.verdict} · revisión: ${v.ok ? 'ok' : `no (${v.severity ?? 'grave'})`}\n`);
  }
  process.stdout.write(`\nCoinciden ${agree} de ${cases.length} casos.\n`);
  for (const [rule, r] of byRule) process.stdout.write(`  ${rule}: ${r.ok}/${r.n}\n`);
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
