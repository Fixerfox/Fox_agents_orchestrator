/** La línea de un error de la interfaz que marca el aviso de error, o nada [R19.12]. */
export const crashLine = (args: readonly unknown[]): string | undefined => {
  const first = args[0] as { message?: unknown } | undefined;
  const message = typeof first?.message === 'string' ? first.message : typeof args[2] === 'string' ? args[2] : undefined;
  return message?.startsWith('[orquestador:interfaz]') ? message : undefined;
};
