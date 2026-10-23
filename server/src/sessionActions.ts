import type { AgentRuntime } from './agentRuntime.js';
import type { AgentStateStore } from './agentStateStore.js';
import { sessionCatalogue } from './sessionCatalog.js';
import type { AgentState } from './types.js';

export function handleSessionMessage(
  message: Record<string, unknown>,
  send: (message: Record<string, unknown>) => void,
  store: AgentStateStore,
  runtime: AgentRuntime,
  open: (agent: AgentState) => void | Promise<void>,
  stop?: (agent: AgentState) => void | Promise<void>,
): boolean {
  if (
    ![
      'requestSessions',
      'setSessionCharacterName',
      'setSessionArchived',
      'openSession',
      'focusAgent',
    ].includes(String(message.type))
  )
    return false;
  const reject = (error: unknown): void => {
    console.error('[Pixel Agents] Session action failed:', error);
    send({
      type: 'sessionActionRejected',
      id: typeof message.id === 'number' ? message.id : undefined,
      reason: error instanceof Error ? error.message : 'Unable to update this session.',
    });
  };
  try {
    if (message.type === 'requestSessions') {
      runtime.refreshSessions();
      send({ ...sessionCatalogue(store) });
    } else {
      if (typeof message.id !== 'number' || !Number.isSafeInteger(message.id))
        throw new Error('Choose a valid session.');
      const id = message.id;
      if (message.type === 'setSessionCharacterName') {
        runtime.nameSession(id, message.name);
        send({ ...sessionCatalogue(store) });
      } else if (message.type === 'setSessionArchived') {
        void runtime
          .setSessionArchived(id, message.archived, stop)
          .then(() => send({ ...sessionCatalogue(store) }))
          .catch(reject);
      } else {
        void runtime
          .openSession(id, open)
          .then(() => send({ type: 'sessionOpened', id }))
          .catch(reject);
      }
    }
  } catch (err) {
    reject(err);
  }
  return true;
}
