import { Button } from './ui/Button.js';

interface BottomToolbarProps {
  isEditMode: boolean;
  onToggleEditMode: () => void;
  isSettingsOpen: boolean;
  onToggleSettings: () => void;
  onManageSessions: () => void;
}

export function BottomToolbar({
  isEditMode,
  onToggleEditMode,
  isSettingsOpen,
  onToggleSettings,
  onManageSessions,
}: BottomToolbarProps) {
  return (
    <div className="absolute left-10 bottom-10 z-20 flex items-center gap-4 pixel-panel p-4">
      <Button variant="accent" onClick={onManageSessions} title="Manage sessions and characters">
        + Agent
      </Button>
      <Button
        variant={isEditMode ? 'active' : 'default'}
        onClick={onToggleEditMode}
        title="Edit office layout"
      >
        Layout
      </Button>
      <Button
        variant={isSettingsOpen ? 'active' : 'default'}
        onClick={onToggleSettings}
        title="Settings"
      >
        Settings
      </Button>
    </div>
  );
}
