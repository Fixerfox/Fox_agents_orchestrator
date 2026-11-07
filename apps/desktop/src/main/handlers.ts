import { ContractError, fail, ok, parseRequest, type ApiResult } from '@orquestador/editor';
import { RunError } from '@orquestador/runtime';
import { StoreError } from '@orquestador/store';
import { handleAssistant } from './handlers/assistant';
import { handleDiagrams } from './handlers/diagrams';
import { handleKnowledge } from './handlers/knowledge';
import { handleProject } from './handlers/project';
import { handleRuns } from './handlers/runs';
import { handleSettings } from './handlers/settings';
import { UNHANDLED, createHandlerState, disposeHandlers, scrubPaths, type DesktopDeps, type HandlerState } from './handlers/state';
import { TerminalError } from './terminal';

export type { OrchestratorContext } from './composition';
export { specKitTarget } from './handlers/project';
export { mcpVaultKey, scrubPaths, type DesktopDeps } from './handlers/state';

const HANDLERS = [handleProject, handleDiagrams, handleRuns, handleKnowledge, handleSettings, handleAssistant];

export class DesktopHandlers {
  private readonly state: HandlerState;

  constructor(deps: DesktopDeps) {
    this.state = createHandlerState(deps);
  }

  /** Único punto de entrada IPC: valida la petición, ejecuta y devuelve siempre un `ApiResult` [R19.3][R19.6]. */
  async invoke(channel: string, payload: unknown): Promise<ApiResult<unknown>> {
    try {
      const arg = parseRequest(channel, payload);
      return ok(await this.dispatch(channel, arg));
    } catch (err) {
      return this.toFailure(err);
    }
  }

  private toFailure(err: unknown): ApiResult<never> {
    const { root } = this.state;
    if (err instanceof ContractError) return fail(err.code, scrubPaths(err.message, root));
    if (err instanceof StoreError) return fail(err.code, scrubPaths(err.message, root), err.fields);
    if (err instanceof RunError) return fail(err.code, scrubPaths(err.message, root));
    if (err instanceof TerminalError) return fail(err.code, err.message);
    return fail('internal', 'Error interno');
  }

  /** Archivo que pide una web previsualizada por el protocolo propio; `undefined` si no se puede servir [R54.4]. */
  async previewAsset(url: string): Promise<string | undefined> {
    return this.state.runs?.previewAsset(url);
  }

  /** Ejecuciones en marcha o en cola, las que se perderían al salir [R61.3]. */
  activeRuns(): number {
    const { runs } = this.state;
    return runs ? runs.runningCount() + runs.queued().length : 0;
  }

  /** Cierra las suscripciones (al cambiar de proyecto o salir). */
  dispose(): void {
    disposeHandlers(this.state);
  }

  private async dispatch(channel: string, arg: unknown): Promise<unknown> {
    for (const handle of HANDLERS) {
      const result = await handle(this.state, channel, arg);
      if (result !== UNHANDLED) return result;
    }
    throw new ContractError(`Canal desconocido: ${channel}`);
  }
}
