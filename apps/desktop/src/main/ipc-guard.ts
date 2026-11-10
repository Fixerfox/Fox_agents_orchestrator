/** Lo que se mira del evento de IPC: el marco que llama. */
export interface IpcSender {
  senderFrame?: { parent: unknown } | null;
}

/**
 * Solo atiende el marco principal de la ventana: un marco hijo (una vista previa, aunque no tenga preload) nunca habla
 * con el proceso principal [R90.11].
 */
export function fromMainFrame(event: IpcSender): boolean {
  return event.senderFrame !== undefined && event.senderFrame !== null && event.senderFrame.parent === null;
}

export const IPC_FRAME_DENY = 'Petición rechazada: no viene de la ventana de la aplicación.';
