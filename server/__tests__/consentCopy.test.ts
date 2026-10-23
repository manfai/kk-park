import { describe, expect, it } from 'vitest';

import { copilotProvider } from '../src/providers/index.js';

describe('Copilot consent disclosure', () => {
  it('discloses the exact file scope, enrollment, privacy boundary and removal route', () => {
    const disclosure = copilotProvider.consentDisclosure().disclosure;
    expect(disclosure).toContain('pixel-agents.json');
    expect(disclosure).toContain('~/.copilot/hooks');
    expect(disclosure).toContain('$COPILOT_HOME/hooks');
    expect(disclosure).toContain('Existing hook files are not changed');
    expect(disclosure).toContain(
      'session IDs, working directories, tool names and short activity labels',
    );
    expect(disclosure).toContain(
      'Prompt text, tool results and full conversations are not forwarded',
    );
    expect(disclosure).toContain('PIXEL_AGENTS_COPILOT=1');
    expect(disclosure).toContain('Native Copilot Chat is not enrolled');
    expect(disclosure).toContain('Instant Detection in Settings');
    expect(disclosure).toContain('there is no transcript fallback');
  });

  it('does not claim that observation approves tools or changes permissions', () => {
    expect(copilotProvider.consentDisclosure().disclosure).toContain(
      'they do not approve tools or change Copilot permissions',
    );
  });
});
