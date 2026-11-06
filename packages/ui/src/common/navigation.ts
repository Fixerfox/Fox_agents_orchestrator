/** Pestañas de Agentes y Conocimiento. */
export type LibraryTab = 'agents' | 'contexts' | 'skills' | 'mcp';

/** Elemento de la biblioteca que se abre al entrar: `new` crea uno vacío. */
export interface LibraryTarget {
  tab: LibraryTab;
  id: string;
}

/** Va a Agentes o a Conocimiento y, si se indica, abre un elemento. */
export type OpenLibrary = (section: 'agents' | 'knowledge', open?: LibraryTarget) => void;
