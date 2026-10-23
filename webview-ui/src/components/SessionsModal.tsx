import { useEffect, useState } from 'react';

import type { Directory, SessionRejection } from '../hooks/useExtensionMessages.js';
import { transport } from '../transport/index.js';
import {
  canOpenSession,
  filterSessions,
  type SessionEntry,
  type SessionFilter,
} from './sessionManager.js';
import { Button } from './ui/Button.js';
import { Modal } from './ui/Modal.js';

interface SessionsModalProps {
  isOpen: boolean;
  sessions: SessionEntry[] | null;
  rejection: SessionRejection | null;
  directories: Directory[];
  canLaunch: boolean;
  unavailableReason: string | null;
  onClose: () => void;
  onOpen: (id: number) => void;
  onArchive: (id: number) => void;
  onAddDirectory: () => void;
  onEditDirectory: (directory: Directory) => void;
}

function SessionRow({
  session,
  onOpen,
  onArchive,
  rejection,
}: {
  session: SessionEntry;
  onOpen: (id: number) => void;
  onArchive: (id: number) => void;
  rejection: SessionRejection | null;
}) {
  const [name, setName] = useState(session.characterName ?? '');
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    setName(session.characterName ?? '');
    setPending(null);
  }, [session.characterName]);
  useEffect(() => {
    if (rejection && (rejection.id === undefined || rejection.id === session.id)) setPending(null);
  }, [rejection, session.id]);

  const saveName = (value: string) => {
    setPending(value);
    transport.send({ type: 'setSessionCharacterName', id: session.id, name: value });
  };

  return (
    <article
      data-testid="session-row"
      data-session-id={session.sessionId}
      className="border-2 border-border p-8 min-w-0"
    >
      <div className="flex flex-wrap justify-between gap-4 mb-4">
        <strong className="text-accent-bright break-all">
          {session.characterName || 'Unnamed session'}
        </strong>
        <span className="text-text-muted text-sm">
          {session.archived ? 'Archived · ' : ''}
          {session.connected ? 'Connected' : 'Disconnected'} · {session.status}
        </span>
      </div>
      <p className="text-sm text-text-muted break-all m-0">
        {session.directoryName ?? 'Directory'}
      </p>
      <p className="text-sm text-text-muted break-all m-0">
        {session.projectDir || 'No folder recorded'}
      </p>
      <p className="text-xs text-text-muted break-all mt-4 mb-6">Session: {session.sessionId}</p>
      <form
        className="flex flex-wrap gap-4 items-end"
        onSubmit={(event) => {
          event.preventDefault();
          const nextName = name.trim();
          if (pending !== null || !nextName || nextName === session.characterName) return;
          saveName(nextName);
        }}
      >
        <label className="w-full min-w-0 text-sm text-text">
          Local character name
          <input
            aria-label={`Local character name for ${session.sessionId}`}
            value={name}
            disabled={pending !== null}
            onChange={(event) => setName(event.target.value)}
            className="block w-full min-w-0 bg-bg text-text border-2 border-border px-6 py-4 mt-2 rounded-none"
          />
        </label>
        <Button
          type="submit"
          disabled={pending !== null || !name.trim() || name.trim() === session.characterName}
        >
          {pending !== null ? 'Saving…' : 'Save name'}
        </Button>
        {session.characterName && !session.archived && (
          <Button type="button" disabled={pending !== null} onClick={() => onArchive(session.id)}>
            Archive
          </Button>
        )}
        {session.archived && (
          <Button
            type="button"
            onClick={() =>
              transport.send({
                type: 'setSessionArchived',
                id: session.id,
                archived: false,
              })
            }
          >
            Restore to office
          </Button>
        )}
        <Button
          type="button"
          disabled={pending !== null || !canOpenSession(session)}
          onClick={() => onOpen(session.id)}
          title={
            !session.characterName?.trim()
              ? 'Save a local character name first.'
              : !session.canOpen
                ? 'This session cannot be opened by this host.'
                : undefined
          }
        >
          {session.connected ? 'Open' : 'Resume'}
        </Button>
      </form>
    </article>
  );
}

export function SessionsModal({
  isOpen,
  sessions,
  rejection,
  directories,
  canLaunch,
  unavailableReason,
  onClose,
  onOpen,
  onArchive,
  onAddDirectory,
  onEditDirectory,
}: SessionsModalProps) {
  const [filter, setFilter] = useState<SessionFilter>('named');
  const [search, setSearch] = useState('');
  const [directoryPath, setDirectoryPath] = useState('');
  const selectedDirectory =
    directories.find((directory) => directory.path === directoryPath) ?? directories[0];
  const visible = filterSessions(sessions ?? [], filter, search);

  useEffect(() => {
    if (!isOpen) return;
    transport.send({ type: 'requestSessions' });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (document.querySelector('[data-testid="archive-confirmation"]')) return;
        event.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isOpen, onClose]);

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Sessions" className="w-full max-w-3xl!">
      <div data-testid="sessions-manager" className="p-6 flex flex-col gap-8">
        <p className="text-sm text-text-muted m-0">
          One session, one character. Give a session a local name to show it in the office.
          Archiving confines a named character inside the nearest reachable free cage position and
          stops its managed CLI. Small cages hold one character; large cages hold up to five. Names
          and conversation history stay unchanged. Unnamed sessions remain hidden.
        </p>
        {rejection && (
          <p role="alert" className="text-status-error break-words m-0">
            {rejection.reason}
          </p>
        )}
        <div className="flex flex-wrap gap-4">
          {(['named', 'archived', 'all'] as const).map((value) => (
            <Button
              key={value}
              variant={filter === value ? 'active' : 'default'}
              onClick={() => setFilter(value)}
            >
              {value === 'named' ? 'Named' : value === 'archived' ? 'Archived / unnamed' : 'All'}
            </Button>
          ))}
        </div>
        <input
          aria-label="Search sessions"
          placeholder="Search names, folders or session IDs"
          className="w-full bg-bg text-text border-2 border-border px-6 py-4 rounded-none"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <div className="flex flex-col gap-6" aria-live="polite">
          {sessions === null ? (
            <p>{rejection ? 'Unable to load sessions.' : 'Loading sessions…'}</p>
          ) : visible.length === 0 ? (
            <p>No matching sessions.</p>
          ) : (
            visible.map((session) => (
              <SessionRow
                key={session.id}
                session={session}
                onOpen={onOpen}
                onArchive={onArchive}
                rejection={rejection}
              />
            ))
          )}
        </div>
        <section className="border-t-2 border-border pt-8">
          <h3 className="text-accent-bright m-0 mb-4">New unnamed session</h3>
          <p className="text-sm text-text-muted mt-0">
            Launch in a Directory, then name the new session here. It stays hidden until named.
          </p>
          <div className="flex flex-wrap gap-4">
            <select
              aria-label="New session Directory"
              value={selectedDirectory?.path ?? ''}
              onChange={(event) => setDirectoryPath(event.target.value)}
              className="flex-1 min-w-0 bg-bg text-text border-2 border-border p-4 rounded-none"
            >
              {directories.map((directory) => (
                <option key={directory.path} value={directory.path}>
                  {directory.name} — {directory.path}
                </option>
              ))}
            </select>
            <Button
              disabled={!canLaunch || !selectedDirectory}
              title={!canLaunch ? (unavailableReason ?? 'Terminal unavailable') : undefined}
              onClick={() => {
                if (!selectedDirectory) return;
                setFilter('archived');
                setSearch('');
                transport.send({ type: 'launchAgent', directoryPath: selectedDirectory.path });
              }}
            >
              New session
            </Button>
            <Button onClick={onAddDirectory}>+ Directory</Button>
            {selectedDirectory?.source === 'user' && (
              <Button onClick={() => onEditDirectory(selectedDirectory)}>Edit Directory</Button>
            )}
          </div>
          {selectedDirectory?.source === 'host' && (
            <p className="text-sm text-text-muted">Host Directory · read-only</p>
          )}
          {!canLaunch && (
            <p className="text-sm text-text-muted">
              {unavailableReason ?? 'Terminal unavailable on this host.'}
            </p>
          )}
        </section>
      </div>
    </Modal>
  );
}
