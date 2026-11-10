import { requestCheck, UNHANDLED } from './check';
import { parseAssistantRequest } from './assistant';
import { parseDiagramsRequest } from './diagrams';
import { parseKnowledgeRequest } from './knowledge';
import { parseProjectRequest } from './project';
import { ContractError } from './result';
import { parseRunsRequest } from './runs';
import { parseSettingsRequest } from './settings';

export { ContractError, fail, ok, type ApiError, type ApiResult } from './result';
export { CHANNELS, OPEN_RUN_CHANNEL, RUN_EVENTS_CHANNEL, type ChannelName, type InvokeMethod, type ProjectApi } from './contract';
export { TERMINAL_EVENTS_CHANNEL, TERMINAL_LIMITS, type ProjectInfo, type ProjectTrustInfo, type TerminalEvent, type TerminalProgram, type TerminalStartRequest, type WorkFolderInspection, type WorkFolderView } from './project';
export type { DiagramSummary, JobInfo } from './diagrams';
export { MAX_ATTACHMENT_BYTES, MAX_INPUT_FILES, type CorrectionProposal, type FilePreview, type InputAttachment, type InputProjectFile, type OpenRunTarget, type OutputFileInfo, type QueuedRunView, type RunAction, type RunFileContent, type RunSummary, type StartRunRequest, type StartRunResult } from './runs';
export { SKILL_FILE_MAX, type ImportKind, type McpTestResult, type McpView } from './knowledge';
export type { AppInfo, ConnectionResult, SettingsView } from './settings';
export type { DraftRequest, DraftResult } from './assistant';
export { TEST_ARG, TEST_CALL_CHANNEL, TEST_READY_CHANNEL, TEST_REPLY_CHANNEL, parseTestReply, type TestBridgeApi, type TestCall, type TestReply } from './test-bridge';

const PARSERS = [parseProjectRequest, parseDiagramsRequest, parseRunsRequest, parseKnowledgeRequest, parseSettingsRequest, parseAssistantRequest];

/**
 * Valida la forma de la petición de un canal. Devuelve el argumento ya tipado
 * o lanza `ContractError`. Las rutas y campos extra se rechazan.
 */
export function parseRequest(channel: string, payload: unknown): unknown {
  const check = requestCheck((m) => new ContractError(`Petición no válida en ${channel}: ${m}`));
  for (const parse of PARSERS) {
    const parsed = parse(channel, payload, check);
    if (parsed !== UNHANDLED) return parsed;
  }
  throw new ContractError(`Canal desconocido: ${channel}`);
}
