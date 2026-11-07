import { useSyncExternalStore } from 'react';
import type { EditorSession, EditorSnapshot } from '@orquestador/editor';

export function useSession(session: EditorSession): EditorSnapshot {
  return useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
}
