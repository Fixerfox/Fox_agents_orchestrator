import { CHECK_TIMEOUT_SEC, clipMiddle, globToRegExp, redactString, validateJsonSchema, type CheckResult, type Id, type Payload, type StepCheck } from '../../shared';
import type { CheckRunner } from '../checks-port';
import type { QuestionBroker } from './question-broker';
import type { RunEmitter } from './run-emitter';

/** Tope del detalle de cada comprobación, recortado por el medio [R75.3]. */
export const CHECK_DETAIL_CHARS = 2000;
export const CHECK_RUN = 'Ejecutar la comprobación';
export const CHECK_SKIP = 'No ejecutarla';
export const UNAPPROVED = 'sin aprobar';

/** Pregunta antes de ejecutar un comando de comprobación que el proyecto no ha aprobado [R75.6]. */
export const checkApprovalQuestion = (label: string, run: string) => `Antes de ejecutar la comprobación «${label}», confirma el comando:\n${run}`;

export interface ChecksContext {
  emitter: RunEmitter;
  questions: QuestionBroker;
  runner: CheckRunner | undefined;
  signal: AbortSignal;
  /** Carpeta del paso (su espacio aislado, si lo tiene) [R75.4]. */
  dir?: string;
}

const done = (c: StepCheck, ok: boolean, detail: string, started: number): CheckResult => ({ checkId: c.id, label: c.label, kind: c.kind, ok, detail: redactString(clipMiddle(detail, CHECK_DETAIL_CHARS)), durationMs: Date.now() - started });

/** Una comprobación; nunca lanza: lo que falla sale como `ok: false` con el motivo [R75.3]. */
async function runOne(ctx: ChecksContext, at: { nodeId: Id; path: Id[] }, c: StepCheck, output: Payload, files: readonly string[]): Promise<CheckResult> {
  const started = Date.now();
  try {
    switch (c.kind) {
      case 'command': {
        if (!ctx.runner) return done(c, false, 'La app no puede ejecutar comprobaciones aquí', started);
        if (!(await ctx.runner.approved(c.run))) {
          const answer = await ctx.questions.ask(at.nodeId, at.path, { text: checkApprovalQuestion(c.label, c.run), options: [CHECK_RUN, CHECK_SKIP], kind: 'permission', fallback: CHECK_SKIP });
          if (answer.trim() !== CHECK_RUN) return done(c, false, UNAPPROVED, started);
          await ctx.runner.approve(c.run);
        }
        const r = await ctx.runner.command({ run: c.run, timeoutSec: c.timeoutSec ?? CHECK_TIMEOUT_SEC, ...(ctx.dir ? { dir: ctx.dir } : {}) }, ctx.signal);
        const expected = c.expectExit ?? 0;
        if (r.timedOut) return done(c, false, `Pasó de ${c.timeoutSec ?? CHECK_TIMEOUT_SEC} s y se cortó.\n${r.output}`, started);
        return done(c, r.exitCode === expected, r.exitCode === expected ? r.output : `Salió con ${r.exitCode ?? 'error'} (se esperaba ${expected}).\n${r.output}`, started);
      }
      case 'files': {
        const unchanged = (c.mustChange ?? []).filter((p) => !files.some((f) => globToRegExp(p).test(f)));
        const missing = c.mustExist && c.mustExist.length > 0 ? (ctx.runner ? await ctx.runner.missing(c.mustExist, ctx.dir) : c.mustExist) : [];
        const why = [...(missing.length > 0 ? [`No existe: ${missing.join(', ')}`] : []), ...(unchanged.length > 0 ? [`El paso no cambió: ${unchanged.join(', ')}`] : [])];
        return done(c, why.length === 0, why.join('\n') || 'Todo en su sitio', started);
      }
      case 'output': {
        const text = output.text;
        const why: string[] = [];
        if (c.contains && !text.includes(c.contains)) why.push(`La salida no contiene «${c.contains}»`);
        if (c.notContains && text.includes(c.notContains)) why.push(`La salida contiene «${c.notContains}»`);
        if (c.matches && !new RegExp(c.matches, 'm').test(text)) why.push(`La salida no cumple /${c.matches}/`);
        return done(c, why.length === 0, why.join('\n') || 'La salida cumple', started);
      }
      case 'schema': {
        let value: unknown;
        try {
          value = JSON.parse(output.text.trim().replace(/^```(?:json)?\s*|```\s*$/g, ''));
        } catch {
          return done(c, false, 'La salida no es JSON', started);
        }
        const errors = validateJsonSchema(value, JSON.parse(c.schema) as Record<string, unknown>);
        return done(c, errors.length === 0, errors.join('\n') || 'La salida cumple el esquema', started);
      }
    }
  } catch (err) {
    return done(c, false, err instanceof Error ? err.message : String(err), started);
  }
}

/**
 * Ejecuta las comprobaciones, una tras otra, y emite `check.result` de cada una [R75.3]. Las de la ficha del agente
 * van primero y las del paso se suman [R75.2].
 */
export async function runChecks(ctx: ChecksContext, at: { nodeId: Id; path: Id[] }, checks: readonly StepCheck[], output: Payload, files: readonly string[]): Promise<CheckResult[]> {
  const out: CheckResult[] = [];
  for (const c of checks) {
    if (ctx.signal.aborted) break;
    const r = await runOne(ctx, at, c, output, files);
    ctx.emitter.emit({ type: 'check.result', nodeId: at.nodeId, ...r }, at.path);
    out.push(r);
  }
  return out;
}

/** Lo que falló, en una línea por comprobación: es el motivo de repetir o de preguntar [R75.5]. */
export const describeFailedChecks = (results: readonly CheckResult[]): string =>
  results
    .filter((r) => !r.ok)
    .map((r) => `«${r.label}»: ${r.detail.split('\n').slice(0, 6).join(' ').slice(0, 400)}`)
    .join('\n');

/** Las de la ficha y las del paso, sin repetir id (manda la del paso) [R75.2]. */
export function mergeChecks(agent: readonly StepCheck[] | undefined, step: readonly StepCheck[] | undefined): StepCheck[] {
  const own = new Set((step ?? []).map((c) => c.id));
  return [...(agent ?? []).filter((c) => !own.has(c.id)), ...(step ?? [])];
}
