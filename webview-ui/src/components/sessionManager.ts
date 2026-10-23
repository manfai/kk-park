import type { SessionsLoaded } from '../../../core/src/messages.js';

export type SessionEntry = SessionsLoaded['sessions'][number];
export type SessionFilter = 'named' | 'archived' | 'all';

export function canOpenSession(session: SessionEntry): boolean {
  return session.canOpen && Boolean(session.characterName?.trim());
}

export function filterSessions(
  sessions: SessionEntry[],
  filter: SessionFilter,
  search: string,
): SessionEntry[] {
  const query = search.trim().toLocaleLowerCase();
  return sessions.filter((session) => {
    const named = Boolean(session.characterName?.trim());
    if (filter === 'named' && (!named || session.archived)) return false;
    if (filter === 'archived' && named && !session.archived) return false;
    return [
      session.characterName,
      session.sessionId,
      session.projectDir,
      session.directoryName,
    ].some((value) => value?.toLocaleLowerCase().includes(query));
  });
}

/** A missing terminal must never resolve to a different session's pane. */
export function exactTerminalId(activeId: number | null, terminalIds: number[]): number | null {
  return activeId !== null && terminalIds.includes(activeId) ? activeId : null;
}
