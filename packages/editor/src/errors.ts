export type EditorErrorCode =
  | 'protected'
  | 'self-edge'
  | 'duplicate-edge'
  | 'into-entry'
  | 'from-output'
  | 'cycle'
  | 'unknown-node'
  | 'unknown-edge'
  | 'not-a-loop'
  | 'invalid'
  | 'locked'
  | 'self-subdiagram'
  | 'port-required'
  | 'port-taken';

export class EditorError extends Error {
  constructor(
    readonly code: EditorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'EditorError';
  }
}
