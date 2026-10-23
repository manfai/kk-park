import type { HookProvider } from '../../../core/src/provider.js';
import { copilotProvider } from './hook/copilot/copilot.js';

export { copilotProvider };
export { copyCopilotHookScript } from './hook/copilot/copilotHookInstaller.js';

export const hookProviders: readonly HookProvider[] = [copilotProvider];

export function hookProviderById(id: unknown): HookProvider | undefined {
  return hookProviders.find((provider) => provider.id === id);
}
