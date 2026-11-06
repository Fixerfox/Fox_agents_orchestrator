import { describe, expect, it } from 'vitest';
import { AgentError, EventBus, type RunEvent } from '../src';
import { BudgetTracker } from '../src/execution/run/budget-tracker';
import { ConcurrencyLimiter } from '../src/execution/run/concurrency-limiter';
import { PauseGate } from '../src/execution/run/pause-gate';
import { QuestionBroker } from '../src/execution/run/question-broker';
import { ResumeCache } from '../src/execution/run/resume-cache';
import { RetryPolicy } from '../src/execution/run/retry-policy';
import { RunAbort } from '../src/execution/run/run-abort';
import { RunEmitter } from '../src/execution/run/run-emitter';

const emitter = () => new RunEmitter(new EventBus('r', () => new Date(0)));
const types = (events: readonly RunEvent[]) => events.map((e) => e.type);
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

describe('SPEC-056 · servicios de una ejecución, sin orquestador', () => {
  describe('PauseGate', () => {
    it('[R56.13] sin pausa no detiene; con pausa espera hasta reanudar', async () => {
      const gate = new PauseGate();
      const signal = new AbortController().signal;
      await gate.wait(signal);
      gate.pause();
      expect(gate.isPaused).toBe(true);
      let passed = false;
      const waiting = gate.wait(signal).then(() => void (passed = true));
      await tick();
      expect(passed).toBe(false);
      gate.resume();
      await waiting;
      expect(passed).toBe(true);
    });

    it('[R56.13] cancelar suelta a quien espera aunque siga en pausa', async () => {
      const gate = new PauseGate();
      const ctrl = new AbortController();
      gate.pause();
      const waiting = gate.wait(ctrl.signal);
      ctrl.abort();
      await expect(waiting).resolves.toBeUndefined();
      expect(gate.isPaused).toBe(true);
    });
  });

  describe('ConcurrencyLimiter', () => {
    it('[R56.13] no deja pasar de `max` y entrega los huecos en orden', async () => {
      const limiter = new ConcurrencyLimiter(1);
      await limiter.acquire();
      const order: string[] = [];
      const a = limiter.acquire().then(() => order.push('a'));
      const b = limiter.acquire().then(() => order.push('b'));
      await tick();
      expect(order).toEqual([]);
      limiter.release();
      await a;
      expect(order).toEqual(['a']);
      limiter.release();
      await b;
      expect(order).toEqual(['a', 'b']);
    });

    it('[R56.13] suelta el hueco mientras se espera al usuario y lo recupera al volver', async () => {
      const limiter = new ConcurrencyLimiter(1);
      await limiter.acquire();
      const slot = { held: true };
      let otherGotIt = false;
      const answer = limiter.whileWaiting(slot, new AbortController().signal, async () => {
        expect(slot.held).toBe(false);
        await limiter.acquire();
        otherGotIt = true;
        limiter.release();
        return 'sí';
      });
      await expect(answer).resolves.toBe('sí');
      expect(otherGotIt).toBe(true);
      expect(slot.held).toBe(true);
    });

    it('[R56.13] si se cancela mientras espera no recupera el hueco, y propaga el error', async () => {
      const limiter = new ConcurrencyLimiter(1);
      await limiter.acquire();
      const ctrl = new AbortController();
      const slot = { held: true };
      const waiting = limiter.whileWaiting(slot, ctrl.signal, async () => {
        ctrl.abort();
        throw new Error('aborted');
      });
      await expect(waiting).rejects.toThrow('aborted');
      expect(slot.held).toBe(false);
    });
  });

  describe('BudgetTracker', () => {
    it('[R56.13] acumula el uso y, al llegar al límite de tokens, avisa una vez y detiene', () => {
      const em = emitter();
      const stop = new RunAbort();
      const budget = new BudgetTracker({ maxTokens: 10 }, em, stop);
      budget.add(3, 2, 0.5);
      expect(stop.signal.aborted).toBe(false);
      budget.add(4, 1);
      budget.add(5, 5);
      expect(budget.usage).toEqual({ inputTokens: 12, outputTokens: 8, costUsd: 0.5 });
      expect(types(em.history())).toEqual(['run.budget_reached']);
      expect(stop.reason).toBe('budget_exceeded');
      expect(stop.signal.aborted).toBe(true);
    });

    it('[R56.13] también limita por coste, y sin límite nunca detiene', () => {
      const em = emitter();
      const stop = new RunAbort();
      new BudgetTracker({ maxCostUsd: 1 }, em, stop).add(1, 1, 2);
      expect(em.history()[0]).toMatchObject({ type: 'run.budget_reached', limit: 'cost', used: 2, max: 1 });
      const free = new RunAbort();
      new BudgetTracker(undefined, emitter(), free).add(1e9, 1e9, 1e9);
      expect(free.signal.aborted).toBe(false);
    });
  });

  describe('RunAbort', () => {
    it('[R56.13] manda el primer motivo', () => {
      const stop = new RunAbort();
      stop.abort('cancelled', 'por el usuario');
      stop.abort('budget_exceeded', 'tarde');
      expect(stop.reason).toBe('cancelled');
      expect(stop.detail).toBe('por el usuario');
    });
  });

  describe('QuestionBroker', () => {
    const broker = (timeoutMs?: number) => {
      const em = emitter();
      const ctrl = new AbortController();
      return { em, ctrl, q: new QuestionBroker(em, ctrl.signal, timeoutMs) };
    };

    it('[R56.13] pregunta, queda pendiente y se responde una sola vez', async () => {
      const { em, q } = broker();
      const answer = q.ask('n', ['l'], { text: '¿Color?', options: ['Rojo'] });
      expect(q.list()).toEqual([{ questionId: 'q-1', nodeId: 'n', nodePath: ['l'], text: '¿Color?', options: ['Rojo'] }]);
      expect(q.answer('q-1', 'Rojo')).toBe(true);
      expect(q.answer('q-1', 'Azul')).toBe(false);
      await expect(answer).resolves.toBe('Rojo');
      expect(q.list()).toEqual([]);
      expect(types(em.history())).toEqual(['agent.question', 'agent.answer']);
      expect(em.history()[0]!.nodePath).toEqual(['l']);
    });

    it('[R56.13] numera las preguntas y no confunde una respuesta desconocida', async () => {
      const { q } = broker();
      void q.ask('a', [], { text: 'uno' });
      void q.ask('b', [], { text: 'dos' });
      expect(q.list().map((p) => p.questionId)).toEqual(['q-1', 'q-2']);
      expect(q.answer('q-9', 'x')).toBe(false);
    });

    it('[R56.13] al cancelar, la pregunta se rechaza y deja de estar pendiente', async () => {
      const { ctrl, q } = broker();
      const answer = q.ask('n', [], { text: '¿?' });
      ctrl.abort();
      await expect(answer).rejects.toThrow('aborted');
      expect(q.list()).toEqual([]);
    });

    it('[R56.13] con tiempo máximo, falla con un error que no se reintenta', async () => {
      const { q } = broker(1);
      const err = await q.ask('n', [], { text: '¿?' }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(AgentError);
      expect((err as AgentError).retriable).toBe(false);
      expect(q.list()).toEqual([]);
    });
  });

  describe('RetryPolicy', () => {
    it('[R56.13] la espera se duplica en cada intento', () => {
      const retry = new RetryPolicy({ maxAttempts: 4, baseDelayMs: 100 });
      expect([1, 2, 3].map((a) => retry.delayAfter(a))).toEqual([100, 200, 400]);
      expect(retry.maxAttempts).toBe(4);
    });

    it('[R56.13] por defecto son 3 intentos desde 1 s, y espera con el reloj que le den', async () => {
      const waits: number[] = [];
      const retry = new RetryPolicy(undefined, async (ms) => void waits.push(ms));
      await retry.wait(retry.delayAfter(1), new AbortController().signal);
      expect(retry.maxAttempts).toBe(3);
      expect(waits).toEqual([1000]);
    });

    it('[R56.13] la espera real termina enseguida si se cancela', async () => {
      const ctrl = new AbortController();
      const waiting = new RetryPolicy().wait(60_000, ctrl.signal);
      ctrl.abort();
      await expect(waiting).resolves.toBeUndefined();
    });
  });

  describe('ResumeCache', () => {
    const previous = { text: 'antes', files: [] };

    it('[R56.13] cada salida y cada aprobación se usan una sola vez', () => {
      const cache = new ResumeCache({ reuse: { fromRunId: 'r0', outputs: { a: previous }, approvedReviews: ['rev'] } });
      expect(cache.reuseFrom).toBe('r0');
      expect(cache.takeReused('a')).toEqual(previous);
      expect(cache.takeReused('a')).toBeUndefined();
      expect(cache.takeApproved('rev')).toBe(true);
      expect(cache.takeApproved('rev')).toBe(false);
    });

    it('[R56.13] la corrección solo la toma su paso, y una vez', () => {
      const cache = new ResumeCache({ correction: { fromRunId: 'r0', nodeId: 'b', text: 'x', previous } });
      expect(cache.takeCorrection('a')).toBeUndefined();
      expect(cache.takeCorrection('b')).toMatchObject({ text: 'x' });
      expect(cache.takeCorrection('b')).toBeUndefined();
    });

    it('[R56.13] sin nada que reutilizar no devuelve nada', () => {
      const cache = new ResumeCache({});
      expect(cache.reuseFrom).toBeUndefined();
      expect(cache.takeReused('a')).toBeUndefined();
      expect(cache.takeApproved('a')).toBe(false);
    });
  });

  describe('RunEmitter', () => {
    it('[R56.13] emite con `seq` creciente y la ruta del paso', () => {
      const em = emitter();
      em.emit({ type: 'node.queued', nodeId: 'a' });
      em.emit({ type: 'node.queued', nodeId: 'b' }, ['loop']);
      em.error('b', 'mal', ['loop']);
      expect(em.runId).toBe('r');
      expect(em.history().map((e) => e.seq)).toEqual([1, 2, 3]);
      expect(em.history()[1]!.nodePath).toEqual(['loop']);
      expect(em.history()[2]).toMatchObject({ type: 'error', nodeId: 'b', message: 'mal', retriable: false });
    });
  });
});
