export type RunErrorCode = 'not-found' | 'invalid-diagram' | 'bad-request' | 'busy';

export class RunError extends Error {
  constructor(
    readonly code: RunErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RunError';
  }
}
