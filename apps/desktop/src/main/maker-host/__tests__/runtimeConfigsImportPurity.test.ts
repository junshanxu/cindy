import { describe, expect, it, vi } from 'vitest';

const fsState = vi.hoisted(() => ({
  existsSync: vi.fn(() => true),
  chmodSync: vi.fn(),
}));

vi.mock('electron', () => ({
  // Deliberately omit getAppPath: importing runtime-configs must not probe rg.
  app: {
    isPackaged: false,
    getPath: () => '/tmp/cindy-test-user-data',
  },
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: fsState.existsSync,
    chmodSync: fsState.chmodSync,
    default: { ...actual, existsSync: fsState.existsSync, chmodSync: fsState.chmodSync },
  };
});

vi.mock('../../model-access/effectiveEndpoint.js', () => ({
  effectiveXdGatewayBaseUrl: () => 'https://gateway.example.test',
}));

describe('runtime-configs import purity', () => {
  it('does not access the Electron app path or probe the filesystem during import', async () => {
    const mod = await import('../runtime-configs.js');

    expect(mod.desktopCodexRuntimeConfig).toBeDefined();
    expect(fsState.existsSync).not.toHaveBeenCalled();
    expect(fsState.chmodSync).not.toHaveBeenCalled();
  });
});
