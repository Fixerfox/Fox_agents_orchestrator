import { useEffect, useRef, useState } from 'react';
import { t, type ProjectApi, type TerminalProgram } from '@orquestador/editor';
import { TerminalHub, type TermTab } from './TerminalPanel';

/** Terminales integradas [R30.13]. */
export function useTerminals(api: ProjectApi, project: string | undefined, fail: (message: string) => void) {
  const [terms, setTerms] = useState<TermTab[]>([]);
  const [termActive, setTermActive] = useState<string>();
  const [termOpen, setTermOpen] = useState(true);
  const [hub, setHub] = useState<TerminalHub>();
  useEffect(() => {
    const h = new TerminalHub(api, (id, code) => setTerms((ts) => ts.map((x) => (x.id === id ? { ...x, exited: code } : x))));
    setHub(h);
    return () => h.dispose();
  }, [api]);
  const termSeq = useRef(0);
  /** Abre una terminal con Claude Code o la consola en la carpeta del proyecto [R30.13][R30.14]. */
  const openTerminal = async (program: TerminalProgram, prompt?: string): Promise<{ external: boolean }> => {
    const r = await api.terminalStart({ program, ...(prompt?.trim() ? { prompt: prompt.trim() } : {}), cols: 100, rows: 28 });
    if (!r.ok) {
      fail(t('term.error', { message: r.error.message }));
      throw new Error(r.error.message);
    }
    if (r.value.external) {
      fail(t('term.external'));
      return { external: true };
    }
    const n = ++termSeq.current;
    const id = r.value.id;
    setTerms((ts) => [...ts, { id, program, title: `${program === 'claude' ? t('term.claude') : t('term.shell')} ${n}` }]);
    setTermActive(id);
    setTermOpen(true);
    return { external: false };
  };
  const closeTerminal = (id: string) => {
    void api.terminalKill(id);
    hub?.forget(id);
    setTerms((ts) => {
      const rest = ts.filter((x) => x.id !== id);
      setTermActive((a) => (a === id ? rest[rest.length - 1]?.id : a));
      return rest;
    });
  };
  // Cambiar de proyecto cierra las terminales (el proceso principal ya las ha matado) [R30.13]
  useEffect(() => {
    setTerms([]);
    setTermActive(undefined);
  }, [project]);
  return { hub, terms, termActive, setTermActive, termOpen, setTermOpen, openTerminal, closeTerminal };
}
