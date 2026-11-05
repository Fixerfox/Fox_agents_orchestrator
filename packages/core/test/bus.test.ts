import { describe, expect, it } from 'vitest';
import { EventBus, redactSecrets, type RunEvent } from '../src';

const emit5 = (bus: EventBus) => {
  for (let i = 0; i < 5; i++) bus.emit({ type: 'node.queued', nodeId: `n${i}` });
};

describe('SPEC-002 · bus de eventos', () => {
  it('[R2.1] seq empieza en 1 y crece de uno en uno', () => {
    const bus = new EventBus('r');
    emit5(bus);
    expect(bus.history().map((e) => e.seq)).toEqual([1, 2, 3, 4, 5]);
  });

  it('[R2.2] cada evento lleva runId, ts ISO y nodePath solo si procede', () => {
    const bus = new EventBus('run-x', () => new Date('2026-11-04T20:00:00.000Z'));
    const path = ['bucle'];
    const root = bus.emit({ type: 'node.queued', nodeId: 'a' });
    const nested = bus.emit({ type: 'node.queued', nodeId: 'b' }, path);
    path.push('mutado');
    expect(root.runId).toBe('run-x');
    expect(root.ts).toBe('2026-11-04T20:00:00.000Z');
    expect('nodePath' in root).toBe(false);
    expect(nested.nodePath).toEqual(['bucle']);
  });

  it('[R2.3] subscribe con fromSeq entrega historial y luego eventos en vivo sin huecos', () => {
    const bus = new EventBus('r');
    emit5(bus);
    const seen: number[] = [];
    bus.subscribe((e) => seen.push(e.seq), { fromSeq: 3 });
    bus.emit({ type: 'node.queued', nodeId: 'x' });
    bus.emit({ type: 'node.queued', nodeId: 'y' });
    expect(seen).toEqual([3, 4, 5, 6, 7]);
  });

  it('[R2.3] sin fromSeq solo recibe eventos nuevos', () => {
    const bus = new EventBus('r');
    emit5(bus);
    const seen: number[] = [];
    bus.subscribe((e) => seen.push(e.seq));
    bus.emit({ type: 'node.queued', nodeId: 'x' });
    expect(seen).toEqual([6]);
  });

  it('[R2.4] un listener que lanza no afecta a los demás ni al emisor', () => {
    const bus = new EventBus('r');
    const received: RunEvent[] = [];
    bus.subscribe(() => {
      throw new Error('listener roto');
    });
    bus.subscribe((e) => received.push(e));
    expect(() => bus.emit({ type: 'node.queued', nodeId: 'a' })).not.toThrow();
    expect(received).toHaveLength(1);
  });

  it('[R2.5] la función devuelta cancela la suscripción', () => {
    const bus = new EventBus('r');
    const seen: number[] = [];
    const off = bus.subscribe((e) => seen.push(e.seq));
    bus.emit({ type: 'node.queued', nodeId: 'a' });
    off();
    bus.emit({ type: 'node.queued', nodeId: 'b' });
    expect(seen).toEqual([1]);
  });

  it('[R2.6] oculta claves sensibles y secretos reconocibles sin tocar el original', () => {
    const bus = new EventBus('r');
    const input = {
      apiKey: 'valor-secreto',
      nested: { password: 'p', note: 'usa sk-ant-api03-ABCDEFGH12345678 para entrar' },
      header: 'Authorization: Bearer abcdefgh12345678',
      gh: 'ghp_abcdefghijklmnopqrstuvwxyz0123',
      ok: 'texto normal',
    };
    const copy = structuredClone(input);
    const ev = bus.emit({ type: 'tool.called', nodeId: 'a', tool: 't', input });
    const logged = JSON.stringify(ev);
    expect(logged).not.toContain('valor-secreto');
    expect(logged).not.toContain('sk-ant-api03');
    expect(logged).not.toContain('abcdefgh12345678');
    expect(logged).not.toContain('ghp_');
    expect(logged).toContain('texto normal');
    expect(input).toEqual(copy);
    expect(redactSecrets('sin secretos')).toBe('sin secretos');
  });
});
