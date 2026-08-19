import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  BrowserControlRequest,
  BrowserControlResult,
  BrowserControlRuntime,
} from '@cindy/browser-control-runtime';

import { createLocalhostGuardedRuntime } from '../browser-localhost-runtime-guard.js';

function ok(action: string, data: Record<string, unknown>): BrowserControlResult {
  return { ok: true, action: action as BrowserControlResult['action'], data };
}

function makeInner(): { inner: BrowserControlRuntime; calls: BrowserControlRequest[] } {
  const calls: BrowserControlRequest[] = [];
  const inner: BrowserControlRuntime = {
    async call(request) {
      calls.push(request);
      if (request.action === 'close') return ok('close', {});
      if (request.action === 'navigate') {
        const data: Record<string, unknown> = {};
        if (typeof request.targetId === 'string') data.targetId = request.targetId;
        // Simulate a redirect when a marker URL is requested.
        if (request.url === 'https://evil.example/redirect-to-localhost') {
          data.url = 'http://localhost:5173/';
        } else if (typeof request.url === 'string') {
          data.url = request.url;
        }
        return ok('navigate', data);
      }
      if (request.action === 'open') {
        const url = (request.url ?? request.targetUrl) as string | undefined;
        return ok('open', {
          targetId: 'tab-1',
          ...(url ? { url } : {}),
        });
      }
      if (request.action === 'act') {
        const data: Record<string, unknown> = { targetId: request.targetId ?? 'tab-1' };
        const request2 = request.request as { url?: string } | undefined;
        if (request2?.url) data.url = request2.url;
        return ok('act', data);
      }
      return ok(request.action, {});
    },
  };
  return { inner, calls };
}

function makeRuntime(inner: BrowserControlRuntime) {
  return createLocalhostGuardedRuntime(inner, {
    warn: vi.fn(),
  });
}

describe('LocalhostGuardedRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows a normal navigate to a public URL', async () => {
    const { inner } = makeInner();
    const rt = makeRuntime(inner);
    const res = await rt.call({ action: 'navigate', url: 'https://example.com/', targetId: 't1' });
    expect(res.ok).toBe(true);
  });

  it('allows an approved localhost navigation on a dev port', async () => {
    const { inner } = makeInner();
    const rt = makeRuntime(inner);
    const res = await rt.call({
      action: 'navigate',
      url: 'http://localhost:5173/',
      targetId: 't1',
    });
    expect(res.ok).toBe(true);
  });

  it('blocks localhost on a sensitive port and closes the tab', async () => {
    const { inner, calls } = makeInner();
    const rt = makeRuntime(inner);
    const res = await rt.call({
      action: 'navigate',
      url: 'http://localhost:6379/',
      targetId: 't1',
    });
    expect(res.ok).toBe(false);
    expect(res.message).toContain('6379');
    // The violating tab must be closed so the agent can't scrape it.
    expect(calls.some((c) => c.action === 'close' && c.targetId === 't1')).toBe(true);
  });

  it('blocks a public URL that 30x-redirects to localhost', async () => {
    const { inner, calls } = makeInner();
    const rt = makeRuntime(inner);
    const res = await rt.call({
      action: 'navigate',
      url: 'https://evil.example/redirect-to-localhost',
      targetId: 't2',
    });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/redirected/i);
    expect(calls.some((c) => c.action === 'close' && c.targetId === 't2')).toBe(true);
  });

  it('blocks an act that navigates a public page into localhost', async () => {
    const { inner } = makeInner();
    // The post-act page URL is reported via result.data.url (like the real
    // /act route does via resolveCurrentTarget); the click request itself has
    // no URL. Simulate a form-submit landing on localhost.
    const callMock = vi.fn(async (request: BrowserControlRequest) => {
      if (request.action === 'close') return ok('close', {});
      if (request.action === 'act') {
        return ok('act', { targetId: 't3', url: 'http://localhost:5173/submit' });
      }
      if (request.action === 'navigate') {
        return ok('navigate', { targetId: 't3', url: String(request.url) });
      }
      return ok(request.action, {});
    });
    inner.call = callMock;
    const rt = makeRuntime(inner);
    // Tab starts on a public page.
    await rt.call({ action: 'navigate', url: 'https://example.com/', targetId: 't3' });
    const res = await rt.call({
      action: 'act',
      targetId: 't3',
      request: { kind: 'click', ref: 'e1' },
    });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/without an explicit/i);
    expect(callMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'close', targetId: 't3' }),
    );
  });

  it('allows an act that stays on an already-approved localhost tab', async () => {
    const { inner } = makeInner();
    inner.call = vi.fn(async (request: BrowserControlRequest) => {
      if (request.action === 'close') return ok('close', {});
      if (request.action === 'act') {
        return ok('act', { targetId: 't4', url: 'http://localhost:5173/dashboard' });
      }
      if (request.action === 'navigate') {
        return ok('navigate', { targetId: 't4', url: String(request.url) });
      }
      return ok(request.action, {});
    });
    const rt = makeRuntime(inner);
    await rt.call({ action: 'navigate', url: 'http://localhost:5173/', targetId: 't4' });
    const res = await rt.call({
      action: 'act',
      targetId: 't4',
      request: { kind: 'click', ref: 'e1' },
    });
    expect(res.ok).toBe(true);
  });

  it('normalizes a trailing-dot localhost redirect target and still blocks it', async () => {
    const { inner } = makeInner();
    const callMock = vi.fn(async (request: BrowserControlRequest) => {
      if (request.action === 'close') return ok('close', {});
      if (request.action === 'navigate') {
        return ok('navigate', { targetId: request.targetId, url: 'http://localhost.:5173/' });
      }
      return ok(request.action, {});
    });
    inner.call = callMock;
    const rt = makeRuntime(inner);
    const res = await rt.call({
      action: 'navigate',
      url: 'https://evil.example/',
      targetId: 't5',
    });
    // Trailing-dot localhost is still recognized as loopback for the redirect check.
    expect(res.ok).toBe(false);
    expect(callMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'close', targetId: 't5' }),
    );
  });

  it('does not interfere with non-navigation actions', async () => {
    const { inner } = makeInner();
    const rt = makeRuntime(inner);
    for (const action of ['snapshot', 'screenshot', 'status', 'tabs'] as const) {
      // eslint-disable-next-line no-await-in-loop
      const res = await rt.call({ action });
      expect(res.ok).toBe(true);
    }
  });
});
