export type StoreErrorCode =
  | 'not-found'
  | 'corrupt'
  | 'future-version'
  | 'invalid-id'
  | 'outside-root'
  | 'secrets'
  | 'exists'
  | 'not-a-project'
  | 'invalid'
  | 'unavailable';

export class StoreError extends Error {
  constructor(
    readonly code: StoreErrorCode,
    message: string,
    /** Campos con problemas, si el error es de validación [R22.1]. */
    readonly fields?: { field: string; message: string }[],
  ) {
    super(message);
    this.name = 'StoreError';
  }
}
