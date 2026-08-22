import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const sessionViewSource = readFileSync(
  resolve(__dirname, '..', 'features', 'cc-agent', 'CCAgentSessionView.tsx'),
  'utf8',
);

describe('archived secondary-window ownership', () => {
  it('removes embedded split panes without letting them close the route-owning window', () => {
    const archivedEffect = sessionViewSource.indexOf("if (session?.status !== 'archived') return;");
    const removePane = sessionViewSource.indexOf(
      'splitGroupStore.removeSession(sessionId);',
      archivedEffect,
    );
    const ownerGate = sessionViewSource.indexOf('if (!ownsWindowRoute) {', removePane);
    const ownerGateEnd = sessionViewSource.indexOf('\n    }', ownerGate);
    const closeWindow = sessionViewSource.indexOf(
      'window.electronAPI?.windowClose();',
      ownerGateEnd,
    );

    expect(archivedEffect).toBeGreaterThan(-1);
    expect(removePane).toBeGreaterThan(archivedEffect);
    expect(ownerGate).toBeGreaterThan(removePane);
    expect(ownerGateEnd).toBeGreaterThan(ownerGate);
    expect(closeWindow).toBeGreaterThan(ownerGateEnd);
    expect(sessionViewSource).toContain('}, [session?.status, sessionId, ownsWindowRoute]);');
  });
});
