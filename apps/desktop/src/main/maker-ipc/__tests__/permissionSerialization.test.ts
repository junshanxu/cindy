import { describe, expect, it } from 'vitest';

import { PermissionQueue } from '../register.js';
import type { InteractionDecision } from '@cindy/maker-core';

function allow(): InteractionDecision {
  return { kind: 'permission', behavior: 'allow' };
}
function deny(reason = 'denied'): InteractionDecision {
  return { kind: 'permission', behavior: 'deny', reason };
}

describe('PermissionQueue (issue #3092)', () => {
  it('runs two permission requests sequentially, not in parallel', async () => {
    // The renderer has a single pending-permission slot, so two parallel
    // permission requests must NOT be broadcast concurrently. This is the
    // root cause of #3092: the second broadcast overwrote the first slot
    // and the first canUseTool Promise hung for the 10-minute timeout.
    const queue = new PermissionQueue();
    let firstStarted = false;
    let firstFinished = false;
    let secondStartedBeforeFirstFinished = false;

    const first = queue.dispatch(async () => {
      firstStarted = true;
      // Simulate an async wait for the user to resolve the card.
      await new Promise((r) => setTimeout(r, 30));
      firstFinished = true;
      return allow();
    });
    // Schedule the second immediately — before the first resolves.
    const second = queue.dispatch(async () => {
      if (!firstFinished) secondStartedBeforeFirstFinished = true;
      return allow();
    });

    await Promise.all([first, second]);

    expect(firstStarted).toBe(true);
    expect(firstFinished).toBe(true);
    expect(secondStartedBeforeFirstFinished).toBe(false);
  });

  it('resolves the second with its own decision after the first', async () => {
    const queue = new PermissionQueue();
    const decisions: Array<'allow' | 'deny'> = [];
    const first = queue.dispatch(async () => {
      decisions.push('allow');
      return allow();
    });
    const second = queue.dispatch(async () => {
      decisions.push('deny');
      return deny();
    });

    const [firstDecision, secondDecision] = await Promise.all([first, second]);

    // Both runs return permission decisions (kind discriminator narrows the
    // InteractionDecision union so .behavior is accessible without a cast).
    expect(firstDecision.kind).toBe('permission');
    expect(secondDecision.kind).toBe('permission');
    if (firstDecision.kind === 'permission') {
      expect(firstDecision.behavior).toBe('allow');
    }
    if (secondDecision.kind === 'permission') {
      expect(secondDecision.behavior).toBe('deny');
    }
    // Ordering must be preserved: each run is queued behind the previous.
    expect(decisions).toEqual(['allow', 'deny']);
  });

  it('does not wedge the queue when a run rejects', async () => {
    // A throwing handler (e.g. broadcast failed) must not poison the chain
    // so subsequent permissions can still run. The rejected promise itself
    // propagates, but the chain recovers.
    const queue = new PermissionQueue();
    const rejected = queue.dispatch(async () => {
      throw new Error('broadcast failed');
    });
    await expect(rejected).rejects.toThrow('broadcast failed');

    const after = queue.dispatch(async () => allow());
    const afterDecision = await after;
    expect(afterDecision.kind).toBe('permission');
    if (afterDecision.kind === 'permission') {
      expect(afterDecision.behavior).toBe('allow');
    }
  });

  it('never invokes a run before the previous one settles even under microtask bursts', async () => {
    // Stress test: queue N synchronous dispatches and assert that only one
    // run body is ever in-flight at a time.
    const queue = new PermissionQueue();
    const N = 10;
    let inFlight = 0;
    let maxInFlight = 0;
    const violations: number[] = [];

    const runs = Array.from({ length: N }, (_, i) =>
      queue.dispatch(async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        if (inFlight > 1) violations.push(i);
        // Yield several times so any racing dispatch has a chance to start.
        await Promise.resolve();
        await Promise.resolve();
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
        return allow();
      }),
    );

    await Promise.all(runs);
    expect(violations).toEqual([]);
    expect(maxInFlight).toBe(1);
  });

  it('cancels queued-but-not-started runs without invoking them (session close)', async () => {
    // When a session closes while A is in-flight and B is queued behind it,
    // cancel() must settle B immediately with the terminal decision and NOT
    // run B's broadcast after A settles — otherwise the closed session gets
    // a phantom permission card that hangs for 10 minutes (issue #3092
    // review P1).
    const queue = new PermissionQueue();
    let aReleased: ((() => void) | null) | undefined;
    let bRan = false;
    let cRan = false;

    const a = queue.dispatch(
      () =>
        new Promise((resolve) => {
          aReleased = () => resolve(allow());
        }),
    );
    const b = queue.dispatch(async () => {
      bRan = true;
      return allow();
    });
    // Cancel while A is in-flight and B is queued.
    queue.cancel(deny('session_closed'));
    const c = queue.dispatch(async () => {
      cRan = true;
      return allow();
    });

    // B and C settle immediately with the cancellation decision, without
    // ever invoking their run bodies.
    await expect(b).resolves.toMatchObject({
      kind: 'permission',
      behavior: 'deny',
      reason: 'session_closed',
    });
    await expect(c).resolves.toMatchObject({
      kind: 'permission',
      behavior: 'deny',
      reason: 'session_closed',
    });
    expect(bRan).toBe(false);
    expect(cRan).toBe(false);
    expect(queue.isCancelled()).toBe(true);

    // Releasing A lets it settle normally; B must still not have run.
    aReleased?.();
    await a;
    expect(bRan).toBe(false);
  });

  it('resetForNewTurn drains queued runs but keeps the queue usable for a later turn', async () => {
    // Transient teardown (Stop / turn-idle reconcile / orca disable) must
    // settle queued permissions for the aborted turn, but must NOT poison the
    // session permanently — a subsequent permission on the next turn still has
    // to show its card and run (issue #3092 review P1 / Greptile).
    const queue = new PermissionQueue();
    let aReleased: ((() => void) | null) | undefined;
    let bRan = false;

    const a = queue.dispatch(
      () =>
        new Promise((resolve) => {
          aReleased = () => resolve(allow());
        }),
    );
    const b = queue.dispatch(async () => {
      bRan = true;
      return allow();
    });

    // Transient reset while A is in-flight and B is queued.
    queue.resetForNewTurn(deny('session_aborted'));
    await expect(b).resolves.toMatchObject({
      kind: 'permission',
      behavior: 'deny',
      reason: 'session_aborted',
    });
    expect(bRan).toBe(false);

    // Release A; it resolves normally.
    aReleased?.();
    await a;

    // A dispatch AFTER reset must run normally (queue is not permanently
    // cancelled), simulating the next user turn.
    let laterRan = false;
    const later = queue.dispatch(async () => {
      laterRan = true;
      return allow();
    });
    await later;
    expect(laterRan).toBe(true);
    expect(queue.isCancelled()).toBe(false);
  });
});
