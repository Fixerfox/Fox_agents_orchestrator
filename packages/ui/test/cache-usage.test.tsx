// @vitest-environment jsdom
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { RunEvent } from '@orquestador/core';
import { deriveLive, formatTokens, summarizeRun, usageText } from '@orquestador/editor';
import { RunDoneBanner } from '../src/runs/RunDoneBanner';

const ev = (seq: number, body: Record<string, unknown>) => ({ runId: 'r', seq, ts: `2026-11-10T10:00:0${seq}.000Z`, ...body }) as unknown as RunEvent;
const events = [
  ev(1, { type: 'run.started', diagramId: 'd' }),
  ev(2, { type: 'agent.usage', nodeId: 'a', inputTokens: 300_000, outputTokens: 33_162, cachedTokens: 296_000, costUsd: 0.3 }),
  ev(3, { type: 'agent.usage', nodeId: 'b', inputTokens: 100_000, outputTokens: 0, cachedTokens: 100_000, costUsd: 0.124 }),
  ev(4, { type: 'run.finished', status: 'succeeded' }),
];

describe('SPEC-083 · los tokens de caché se ven aparte', () => {
  it('[R83.5] la vista en vivo y el resumen suman aparte lo leído de la caché', () => {
    expect(deriveLive(events).usage).toMatchObject({ inputTokens: 400_000, outputTokens: 33_162, cachedTokens: 396_000 });
    expect(summarizeRun(events, (id) => id).usage).toMatchObject({ inputTokens: 400_000, cachedTokens: 396_000 });
    expect(deriveLive([events[0]!]).usage.cachedTokens).toBeUndefined();
  });

  it('[R83.6] formato compacto y «· N de caché» solo si hay caché', () => {
    expect(formatTokens(320)).toBe('320');
    expect(formatTokens(9_876)).toBe('9876');
    expect(formatTokens(433_162)).toBe('433 k');
    expect(formatTokens(1_234_567)).toBe('1,2 M');
    expect(usageText({ inputTokens: 400_000, outputTokens: 33_162, cachedTokens: 396_000 })).toBe('433 k tokens · 396 k de caché');
    expect(usageText({ inputTokens: 300, outputTokens: 20 })).toBe('320 tokens');
  });

  it('[R83.6] el aviso de fin lo enseña con la pista que explica la caché', () => {
    render(<RunDoneBanner events={events} labelOf={(n) => n} onSummary={vi.fn()} />);
    const figures = screen.getByText(/433 k tokens · 396 k de caché/);
    expect(figures.getAttribute('title')).toContain('una décima parte');
  });
});
