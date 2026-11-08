import { describe, expect, it } from 'vitest';
import { defaultSettings, newAgent } from '@orquestador/core';
import { APP_KILL_DENY, ClaudeAdapter, killsAppProcess, withSelfProtection, type ClaudeQueryOptions, type QueryFn } from '../src';

describe('SPEC-079 · un agente no puede cerrar el orquestador', () => {
  it('[R79.1] detecta matar por nombre electron, node, claude u orquestador, en cualquier tramo y forma', () => {
    for (const c of [
      'cd /d/FixerfoxGames && timeout 90 node scratch_cdp.mjs 2>&1 | head -30; taskkill //IM electron.exe //F >/dev/null 2>&1; echo finished',
      'taskkill /F /IM electron.exe',
      'taskkill -im node.exe -f',
      'TASKKILL /IM "Electron.exe" /T /F',
      'killall node',
      'pkill -f electron',
      'pkill claude',
      'powershell -Command "Stop-Process -Name electron -Force"',
      'Get-Process electron | Stop-Process -Force',
      "wmic process where name='electron.exe' delete",
      'sudo killall Orquestador',
    ])
      expect(killsAppProcess(c), c).toBe(true);
  });

  it('[R79.3] por PID, o el nombre de otro programa, sigue permitido', () => {
    for (const c of ['taskkill /PID 4312 /T /F', 'kill 4312', 'kill -9 $(cat app.pid)', 'taskkill /IM FoxPixels.exe /F', 'killall vite', 'pkill -f "vite --port 5173"', 'echo taskkill /IM electron.exe', 'grep -rn "taskkill" src', 'Get-Process | Sort-Object CPU', 'npm run test'])
      expect(killsAppProcess(c), c).toBe(false);
  });

  it('[R79.2] se deniega antes de cualquier otra política, con el motivo y como acción frenada', async () => {
    const seen: string[] = [];
    const notes: { kind: string; reason?: string }[] = [];
    const policy = withSelfProtection(
      (e) => void notes.push(e),
      async (tool: string, _input: Record<string, unknown>) => (seen.push(tool), { behavior: 'allow' as const, updatedInput: {} }),
    );
    const r = await policy('Bash', { command: 'node prueba.mjs; taskkill //IM electron.exe //F' });
    expect(r).toMatchObject({ behavior: 'deny', message: APP_KILL_DENY });
    expect(APP_KILL_DENY).toContain('Orquestador');
    expect(APP_KILL_DENY).toContain('PID');
    expect(seen).toEqual([]);
    expect(notes).toEqual([expect.objectContaining({ kind: 'denied', reason: APP_KILL_DENY })]);
    expect((await policy('Bash', { command: 'taskkill /PID 4312 /T /F' })).behavior).toBe('allow');
    expect((await policy('Write', { file_path: 'a.md' })).behavior).toBe('allow');
  });

  it('[R79.2] el adaptador lo deniega también con «Sin preguntar nunca»', async () => {
    let options: ClaudeQueryOptions | undefined;
    const query: QueryFn = async function* ({ options: o }) {
      options = o;
      yield { type: 'result', subtype: 'success', is_error: false, result: 'ok', usage: { input_tokens: 1, output_tokens: 1 }, total_cost_usd: 0 };
    };
    const agent = { ...newAgent('dev', 'Dev'), permissions: 'full' as const };
    const env = { projectRoot: '/proy', settings: () => ({ ...defaultSettings(), permissions: 'full' as const }), apiKey: async () => undefined, loadAgent: async () => agent, loadContexts: async () => [], loadSkills: async () => [] };
    for await (const _ of new ClaudeAdapter(env, query).run({ nodeId: 'n', agentId: 'dev', input: { text: 'x', files: [] }, attempt: 1, ask: async () => '', previousAnswers: [] }, new AbortController().signal)) void _;
    const r = await options!.canUseTool!('Bash', { command: 'taskkill //IM electron.exe //F' }, { signal: new AbortController().signal } as never);
    expect(r).toMatchObject({ behavior: 'deny', message: APP_KILL_DENY });
  });
});
