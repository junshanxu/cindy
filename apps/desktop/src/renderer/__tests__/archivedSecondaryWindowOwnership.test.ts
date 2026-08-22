import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const sessionViewSource = readFileSync(
  resolve(__dirname, '..', 'features', 'cc-agent', 'CCAgentSessionView.tsx'),
  'utf8',
);
const orcaSplitViewSource = readFileSync(
  resolve(__dirname, '..', 'features', 'cc-agent', 'OrcaSplitView.tsx'),
  'utf8',
);
const workdirBrowseRouteSource = readFileSync(
  resolve(__dirname, '..', 'features', 'cc-agent', 'workdir-browse', 'WorkdirBrowseRoute.tsx'),
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
    const closePreflight = sessionViewSource.indexOf(
      'await onBeforeSecondaryWindowClose()',
      ownerGateEnd,
    );
    const cancelGate = sessionViewSource.indexOf(
      'if (!allowClose || cancelled) return;',
      closePreflight,
    );
    const closeWindow = sessionViewSource.indexOf(
      'window.electronAPI?.windowCloseSelf();',
      cancelGate,
    );

    expect(archivedEffect).toBeGreaterThan(-1);
    expect(removePane).toBeGreaterThan(archivedEffect);
    expect(ownerGate).toBeGreaterThan(removePane);
    expect(ownerGateEnd).toBeGreaterThan(ownerGate);
    expect(closePreflight).toBeGreaterThan(ownerGateEnd);
    expect(cancelGate).toBeGreaterThan(closePreflight);
    expect(closeWindow).toBeGreaterThan(cancelGate);
    expect(sessionViewSource).toMatch(
      /\}, \[\s*session\?\.status,\s*sessionId,\s*ownsWindowRoute,\s*onBeforeSecondaryWindowClose,\s*secondaryWindowArchiveOwner,\s*\]\);/,
    );
  });

  it('marks the Orca lead as route owner and the worker as embedded', () => {
    const leadView = orcaSplitViewSource.indexOf('sessionIdProp={leadSessionId}');
    const leadOwner = orcaSplitViewSource.indexOf('navigationMode="route-owner"', leadView);
    const workerView = orcaSplitViewSource.indexOf('sessionIdProp={workerSession.id}', leadOwner);
    const workerEmbedded = orcaSplitViewSource.indexOf(
      'navigationMode="sidebar-embedded"',
      workerView,
    );

    expect(leadView).toBeGreaterThan(-1);
    expect(leadOwner).toBeGreaterThan(leadView);
    expect(workerView).toBeGreaterThan(leadOwner);
    expect(workerEmbedded).toBeGreaterThan(workerView);
    expect(orcaSplitViewSource).toContain(
      'onBeforeSecondaryWindowClose={onBeforeSecondaryWindowClose}',
    );
    expect(orcaSplitViewSource).toContain('secondaryWindowArchiveOwner="host"');
  });

  it('keeps the Orca host subscribed to archived leads and closes after the dirty-file preflight', () => {
    expect(orcaSplitViewSource).toContain("useCCSessions({ includeArchived: 'all' })");
    const archivedLeadGuard = orcaSplitViewSource.indexOf(
      "if (leadSession?.status !== 'archived') return;",
    );
    const secondaryWindowGuard = orcaSplitViewSource.indexOf(
      'if (!isSecondaryWindow()) return;',
      archivedLeadGuard,
    );
    const closePreflight = orcaSplitViewSource.indexOf(
      'await onBeforeSecondaryWindowClose()',
      secondaryWindowGuard,
    );
    const cancelGate = orcaSplitViewSource.indexOf(
      'if (!allowClose || cancelled) return;',
      closePreflight,
    );
    const closeWindow = orcaSplitViewSource.indexOf(
      'window.electronAPI?.windowCloseSelf();',
      cancelGate,
    );

    expect(archivedLeadGuard).toBeGreaterThan(-1);
    expect(secondaryWindowGuard).toBeGreaterThan(archivedLeadGuard);
    expect(closePreflight).toBeGreaterThan(secondaryWindowGuard);
    expect(cancelGate).toBeGreaterThan(closePreflight);
    expect(closeWindow).toBeGreaterThan(cancelGate);
  });

  it('lets the workdir route protect dirty files before either route-owning chat closes', () => {
    expect(workdirBrowseRouteSource).toContain('() => confirmSwitchAway(selectedPath, null)');
    expect(
      workdirBrowseRouteSource.match(
        /onBeforeSecondaryWindowClose=\{confirmSecondaryWindowClose\}/g,
      ),
    ).toHaveLength(2);
  });

  it('blocks both the composer and send path for archived secondary-window sessions', () => {
    const guardDeclaration = sessionViewSource.indexOf(
      'const blocksArchivedSecondaryWindowInput =',
    );
    const sendGuard = sessionViewSource.indexOf(
      'if (blocksArchivedSecondaryWindowInput) return false;',
      guardDeclaration,
    );
    const composerDisabled = sessionViewSource.indexOf('disabled={', sendGuard);
    const composerGuard = sessionViewSource.indexOf(
      'blocksArchivedSecondaryWindowInput',
      composerDisabled,
    );

    expect(guardDeclaration).toBeGreaterThan(-1);
    expect(sendGuard).toBeGreaterThan(guardDeclaration);
    expect(composerDisabled).toBeGreaterThan(sendGuard);
    expect(composerGuard).toBeGreaterThan(composerDisabled);
  });
});
