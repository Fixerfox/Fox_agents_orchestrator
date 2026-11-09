/** Un proveedor que pidió esperar [R77.4]. */
export interface ProviderCooldown {
  provider: string;
  untilTs: string;
  reason: 'rate_limit' | 'overloaded';
}

/**
 * Lo que comparten todas las ejecuciones de la app [R77.1][R77.4]: el hueco global de cada intento de agente y el
 * enfriamiento de los proveedores. Lo implementa `runtime`; sin él, cada ejecución solo tiene su propio límite.
 */
export interface SharedResources {
  /**
   * Espera a que el proveedor deje de pedir esperar (`cooling`) y a que haya hueco en toda la app (`queued`, con los
   * agentes que trabajan en otras ejecuciones), en orden de llegada. Devuelve cómo soltarlo.
   */
  agentSlot(o: { signal: AbortSignal; queued(others: number): void; cooling(c: ProviderCooldown): void }): Promise<() => void>;
  /** El proveedor devolvió un límite de uso con `retry-after`: nada nuevo arranca con él hasta que pase [R77.4]. */
  limited(o: { retryAfterMs: number; reason: ProviderCooldown['reason'] }): ProviderCooldown | undefined;
}
