import { TERMINAL_OSC52_MAX_BASE64_CHARS } from '../constants.js';

/** Copy the selection verbatim, let the browser paste, or use the terminal. */
export type ClipboardKeyAction = 'copy' | 'paste' | 'terminal';

/** The parts of a KeyboardEvent the rules read. */
export interface KeyChord {
  key: string;
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}

/**
 * The Windows / Linux clipboard keys, which xterm would otherwise send to the
 * PTY as control characters (^C, ^V) and cancel, so the browser never copies
 * or pastes. On a Mac copy and paste are Cmd chords that xterm leaves alone,
 * and Ctrl+C / Ctrl+V must stay terminal keys, so nothing changes there.
 *
 * - Ctrl+V and Ctrl+Shift+V paste.
 * - Ctrl+C copies only while there is a selection; without one it is still
 *   the interrupt.
 * - Ctrl+Shift+C always copies (with no selection it copies nothing): left to
 *   the browser it opens the DevTools element picker.
 */
export function clipboardKeyAction(
  ev: KeyChord,
  isMac: boolean,
  hasSelection: boolean,
): ClipboardKeyAction {
  if (isMac || !ev.ctrlKey || ev.altKey || ev.metaKey) return 'terminal';
  const key = ev.key.toLowerCase();
  if (key === 'v') return 'paste';
  if (key === 'c' && (ev.shiftKey || hasSelection)) return 'copy';
  return 'terminal';
}

/**
 * The text of an OSC 52 clipboard write (`ESC ] 52 ; <targets> ; <base64> BEL`,
 * here without the framing), or null for anything we don't act on: a query
 * (`?` — the clipboard is never read back to the PTY), a clear (empty
 * payload), an oversized payload, or one that isn't base64 UTF-8.
 *
 * Programs in the terminal use this to copy to the clipboard of the machine
 * the terminal is DISPLAYED on, rather than only the server's clipboard.
 */
export function decodeOsc52(data: string): string | null {
  const sep = data.indexOf(';');
  if (sep < 0) return null;
  const payload = data.slice(sep + 1);
  if (payload === '' || payload === '?' || payload.length > TERMINAL_OSC52_MAX_BASE64_CHARS) {
    return null;
  }
  try {
    const binary = atob(payload);
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
