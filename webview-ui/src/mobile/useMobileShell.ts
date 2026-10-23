import { useCallback, useState } from 'react';

import type { TerminalDrawerController } from '../hooks/useTerminalDrawer.js';
import type { OfficeState } from '../office/engine/officeState.js';

export type MobileView = 'office' | 'terminal';

export interface MobileShellController {
  view: MobileView;
  /** Slide to the terminal page (the drawer decides which pane shows). */
  showTerminal: () => void;
  /** The >_ / Office button and the edge swipe. */
  toggleView: () => void;
  /** A tap on an agent card. */
  selectCard: (agentId: number) => void;
}

interface MobileShellInputs {
  getOfficeState: () => OfficeState;
  drawer: TerminalDrawerController;
  focusedAgentId: number | null;
  openSession: (id: number) => void;
}

/**
 * The mobile shell's navigation rules: which page shows, and what a card tap,
 * the view toggle, and opening a session do to it. Office and terminal pages share one
 * selection model with the desktop — the drawer still owns which pane is
 * active — this only adds the page.
 */
export function useMobileShell({
  getOfficeState,
  drawer,
  focusedAgentId,
  openSession,
}: MobileShellInputs): MobileShellController {
  const [view, setView] = useState<MobileView>('office');
  const { reveal, shownAgentId } = drawer;

  const showTerminal = useCallback(() => setView('terminal'), []);

  // Entering the terminal view collapses the canvas focus into the terminal
  // selection: whoever is focused in the office is the agent whose terminal
  // shows (sub-agents resolve to their parent, which owns the pane). Card
  // taps, character double-taps, and launches already keep the two in sync —
  // this toggle was the one path that could land on a different agent's
  // terminal than the focused one.
  const toggleView = useCallback(() => {
    if (view === 'terminal') {
      setView('office');
      return;
    }
    if (focusedAgentId !== null) {
      openSession(getOfficeState().terminalOwnerOf(focusedAgentId));
    } else if (shownAgentId !== null) {
      openSession(shownAgentId);
    }
  }, [view, focusedAgentId, openSession, getOfficeState, shownAgentId]);

  // In terminal view the bar is a tab strip: one tap switches panes (agents
  // with no pane jump back to the office). In office view it mirrors the
  // character's two-step tap: the first tap focuses the character (camera
  // follow + status label), a repeat tap on the already-focused agent opens
  // its terminal.
  const selectCard = useCallback(
    (agentId: number) => {
      const os = getOfficeState();
      if (view === 'terminal' || os.selectedAgentId === agentId) {
        os.selectAndFollow(agentId);
        openSession(agentId);
        return;
      }
      os.selectAndFollow(agentId);
      // Pre-select the pane (and the card highlight) without leaving the office.
      reveal(agentId);
    },
    [getOfficeState, view, reveal, openSession],
  );

  return { view, showTerminal, toggleView, selectCard };
}
