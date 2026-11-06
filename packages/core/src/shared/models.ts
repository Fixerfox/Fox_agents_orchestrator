/** Modelos que se pueden asignar a un agente. */
export const MODELS = [
  { id: 'claude-sonnet-5-5', name: 'Sonnet 5.5' },
  { id: 'claude-opus-5-5', name: 'Opus 5.5' },
  { id: 'claude-haiku-5-5', name: 'Haiku 5.5' },
] as const;

export const DEFAULT_MODEL = 'claude-sonnet-5-5';
