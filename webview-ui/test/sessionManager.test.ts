import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  canOpenSession,
  exactTerminalId,
  filterSessions,
  type SessionEntry,
} from '../src/components/sessionManager.js';
import { OfficeState } from '../src/office/engine/officeState.js';
import { buildDynamicCatalog } from '../src/office/layout/furnitureCatalog.js';
import { isWalkable } from '../src/office/layout/tileMap.js';
import { CharacterState, Direction, type OfficeLayout, TileType } from '../src/office/types.js';

const sessions: SessionEntry[] = [
  {
    id: 1,
    sessionId: 'running-unnamed',
    projectDir: '/work/app',
    directoryName: 'App',
    connected: true,
    canOpen: true,
    status: 'active',
  },
  {
    id: 2,
    sessionId: 'named-session',
    characterName: 'Ada',
    projectDir: '/work/app',
    directoryName: 'App',
    connected: false,
    canOpen: true,
    status: 'offline',
  },
  {
    id: 3,
    sessionId: 'old-session',
    projectDir: '/work/tools',
    directoryName: 'Tools',
    connected: false,
    canOpen: false,
    status: 'offline',
  },
];

describe('session manager', () => {
  it('archives every unnamed session regardless of connection or activity', () => {
    expect(filterSessions(sessions, 'named', '').map((session) => session.id)).toEqual([2]);
    expect(filterSessions(sessions, 'archived', '').map((session) => session.id)).toEqual([1, 3]);
  });

  it('searches local names, folder context and session IDs without merging a project', () => {
    expect(filterSessions(sessions, 'all', ' APP ').map((session) => session.id)).toEqual([1, 2]);
    expect(filterSessions(sessions, 'named', 'ada').map((session) => session.id)).toEqual([2]);
    expect(
      filterSessions(sessions, 'archived', 'OLD-SESSION').map((session) => session.id),
    ).toEqual([3]);
    expect(filterSessions(sessions, 'named', 'tools')).toEqual([]);
  });

  it('never falls back to another session when the selected terminal is missing', () => {
    expect(exactTerminalId(2, [1, 3])).toBeNull();
    expect(exactTerminalId(null, [1, 3])).toBeNull();
    expect(exactTerminalId(3, [1, 3])).toBe(3);
  });

  it('requires a saved local name as well as host capability to open a session', () => {
    expect(canOpenSession(sessions[0])).toBe(false);
    expect(canOpenSession(sessions[1])).toBe(true);
    expect(canOpenSession({ ...sessions[1], canOpen: false })).toBe(false);
    expect(canOpenSession({ ...sessions[1], characterName: '   ' })).toBe(false);
  });

  it('includes named parked characters in Archived, not the active Named list', () => {
    const archived = { ...sessions[1], archived: true };
    expect(filterSessions([archived], 'named', '')).toEqual([]);
    expect(filterSessions([archived], 'archived', 'Ada')).toEqual([archived]);
  });

  it('can restore the same session before its archive animation finishes', () => {
    const office = new OfficeState();
    office.addAgent(2, 0, 0);
    office.removeAgent(2);
    office.addAgent(2, 0, 0);
    office.update(2);
    expect(office.characters.has(2)).toBe(true);
    expect(office.characters.get(2)?.matrixEffect).not.toBe('despawn');
  });

  describe('archived character confinement', () => {
    beforeAll(() => {
      buildDynamicCatalog({
        catalog: [
          {
            id: 'JAIL_CAGE',
            label: 'Jail Cage',
            category: 'decor',
            width: 32,
            height: 48,
            footprintW: 2,
            footprintH: 3,
            isDesk: false,
          },
        ],
        sprites: { JAIL_CAGE: Array.from({ length: 48 }, () => Array(32).fill('')) },
      });
    });

    function officeWithCages(): OfficeState {
      const layout: OfficeLayout = {
        version: 1,
        cols: 8,
        rows: 9,
        tiles: Array.from({ length: 72 }, (_, index) =>
          index % 8 === 3 ? TileType.WALL : TileType.FLOOR_1,
        ),
        furniture: [
          { uid: 'unreachable', type: 'JAIL_CAGE', col: 4, row: 0 },
          { uid: 'reachable', type: 'JAIL_CAGE', col: 0, row: 6 },
        ],
      };
      const office = new OfficeState(layout);
      office.addAgent(1, 0, 0, undefined, true);
      const ch = office.characters.get(1)!;
      ch.tileCol = 2;
      ch.tileRow = 1;
      return office;
    }

    it('enters the nearest reachable cage, centers behind its bars and cannot be commanded out', () => {
      const office = officeWithCages();
      const expectedPath = office.archivePath(1)!;
      expect(expectedPath.at(-1)).toEqual({ col: 0, row: 8 });
      expect(expectedPath.every(({ col }) => col < 3)).toBe(true);
      office.setAgentArchived(1, true);
      expect(office.characters.get(1)?.path).toEqual(expectedPath);
      for (let tick = 0; tick < 100; tick++) office.update(0.1);
      office.setAgentActive(1, true);
      office.setAgentTool(1, 'edit');
      office.showPermissionBubble(1);
      expect(office.walkToTile(1, 2, 1)).toBe(false);
      office.rebuildFromLayout(office.getLayout());
      office.update(300);
      expect(office.characters.get(1)).toMatchObject({
        tileCol: 0,
        tileRow: 8,
        x: 16,
        y: 136,
        archiveCageId: 'reachable',
        state: CharacterState.IDLE,
        isArchived: true,
        isActive: false,
        currentTool: null,
        bubbleType: null,
        path: [],
      });
      office.setAgentArchived(1, false);
      expect(office.characters.get(1)?.isArchived).toBe(false);
      expect(office.characters.get(1)?.archiveCageId).toBeUndefined();
      const ch = office.characters.get(1)!;
      expect(isWalkable(ch.tileCol, ch.tileRow, office.tileMap, office.blockedTiles)).toBe(true);
      expect(office.archivePath(1)).not.toBeNull();
    });

    it('reserves a whole cage immediately, even while its occupant is still walking there', () => {
      const office = officeWithCages();
      office.addAgent(2, 1, 0, undefined, true);
      const other = office.characters.get(2)!;
      other.tileCol = 2;
      other.tileRow = 1;
      other.path = [];
      office.setAgentArchived(1, true);
      expect(office.characters.get(1)?.path.length).toBeGreaterThan(0);
      expect(office.archivePath(2)).toBeNull();
      office.setAgentArchived(1, false);
      expect(office.archivePath(2)).not.toBeNull();
    });

    it('chooses the shortest reachable cage and assigns distinct cages to different characters', () => {
      const office = officeWithCages();
      const layout = office.getLayout();
      layout.tiles.fill(TileType.FLOOR_1);
      office.rebuildFromLayout(layout);
      const ch = office.characters.get(1)!;
      ch.tileCol = 2;
      ch.tileRow = 1;
      office.setAgentArchived(1, true);
      expect(ch.archiveCageId).toBe('unreachable');
      office.addAgent(2, 1, 0, undefined, true);
      const other = office.characters.get(2)!;
      other.tileCol = 2;
      other.tileRow = 1;
      office.setAgentArchived(2, true);
      expect(other.archiveCageId).toBe('reachable');
      expect(office.walkableTiles.some(({ col, row }) => col < 2 && row >= 6)).toBe(false);
    });

    it('does not treat carpet as a cage and surfaces a removed cage explicitly', () => {
      const office = officeWithCages();
      office.setAgentArchived(1, true);
      const layout = {
        ...office.getLayout(),
        furniture: [],
        carpetTiles: Array(72).fill({ variant: 0 }),
      };
      const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
      office.rebuildFromLayout(layout);
      expect(office.archivePath(1)).toBeNull();
      expect(office.characters.get(1)?.archiveParkingError).toContain('Jail Cage');
      expect(office.characters.get(1)?.archiveCageId).toBeUndefined();
      expect(warning).toHaveBeenCalled();
      warning.mockRestore();
    });

    it('follows a moved cage when the layout is rebuilt', () => {
      const office = officeWithCages();
      office.setAgentArchived(1, true);
      for (let tick = 0; tick < 100; tick++) office.update(0.1);
      const layout = {
        ...office.getLayout(),
        furniture: [{ uid: 'reachable', type: 'JAIL_CAGE', col: 1, row: 5 }],
      };
      office.rebuildFromLayout(layout);
      for (let tick = 0; tick < 100; tick++) office.update(0.1);
      expect(office.characters.get(1)).toMatchObject({
        archiveCageId: 'reachable',
        tileCol: 1,
        tileRow: 7,
        x: 32,
        y: 120,
        state: CharacterState.IDLE,
      });
    });

    it('releases the workstation while keeping its seat preference for restore', () => {
      const office = officeWithCages();
      office.seats.set('desk', {
        uid: 'desk',
        seatCol: 0,
        seatRow: 1,
        facingDir: Direction.DOWN,
        assigned: false,
      });
      office.reassignSeat(1, 'desk');
      office.setAgentArchived(1, true);
      expect(office.seats.get('desk')?.assigned).toBe(false);
      expect(office.characters.get(1)?.seatId).toBeNull();
      expect(office.getPersistableSeats()[1].seatId).toBe('desk');
      office.setAgentArchived(1, false);
      expect(office.characters.get(1)?.seatId).toBe('desk');
      expect(office.seats.get('desk')?.assigned).toBe(true);
    });
  });
});
