/** Resultado uniforme de toda operación IPC: nunca lanza hacia el renderer ni filtra trazas. */
export interface ApiError {
  code: string;
  message: string;
  /** Campos con problemas de validación, para mostrarlos junto al campo [R22.5]. */
  fields?: { field: string; message: string }[];
}
export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export const ok = <T>(value: T): ApiResult<T> => ({ ok: true, value });
export const fail = (code: string, message: string, fields?: ApiError['fields']): ApiResult<never> => ({
  ok: false,
  error: { code, message, ...(fields ? { fields } : {}) },
});

export class ContractError extends Error {
  readonly code = 'bad-request';
}
