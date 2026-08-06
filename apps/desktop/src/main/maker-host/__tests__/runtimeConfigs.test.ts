import { beforeEach, describe, expect, it, vi } from 'vitest';

let memorySettings = {
  maker: true,
  claudeCode: false,
  codex: false,
  pi: false,
};

const fsMocks = vi.hoisted(() => ({
  existsSync: vi.fn(() => true),
  chmodSync: vi.fn(),
}));

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => '/tmp/xdt-maker-test-app',
    getPath: (name: string) => {
      if (name !== 'userData') throw new Error(`unexpected path: ${name}`);
      return '/tmp/xdt-maker-test-user-data';
    },
  },
}));

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs');
  return {
    ...actual,
    existsSync: fsMocks.existsSync,
    chmodSync: fsMocks.chmodSync,
    default: {
      ...actual,
      existsSync: fsMocks.existsSync,
      chmodSync: fsMocks.chmodSync,
    },
  };
});

// runtime-configs 经 effectiveXdGatewayBaseUrl 读 model-access 下发的 endpoint;
// 本测试不断言端点,mock 成 fixture 值只为隔离 credentialsStore 的文件 IO。
vi.mock('../../model-access/effectiveEndpoint.js', async () => {
  const { TEST_XD_GATEWAY_BASE_URL } = await import('../../../test/vitest/clientEndpointsFixture');
  return { effectiveXdGatewayBaseUrl: () => TEST_XD_GATEWAY_BASE_URL };
});

describe('runtime-configs', () => {
  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    fsMocks.existsSync.mockReturnValue(true);
    memorySettings = {
      maker: true,
      claudeCode: false,
      codex: false,
      pi: false,
    };
  });

  it('propagates persisted Maker Memory enablement into agent runtime configs', async () => {
    vi.doMock('../memory-settings-store.js', () => ({
      readMemorySettings: () => memorySettings,
    }));

    const { buildDesktopClaudeRuntimeConfig, desktopCodexRuntimeConfig } = await import(
      '../runtime-configs.js'
    );

    const claudeConfig = buildDesktopClaudeRuntimeConfig(() => 'http://127.0.0.1:1234');

    expect(claudeConfig.memoryEnabled).toBe(false);
    expect(claudeConfig.makerMemoryEnabled).toBe(true);
    expect(desktopCodexRuntimeConfig.memoryEnabled).toBe(false);
    expect(desktopCodexRuntimeConfig.makerMemoryEnabled).toBe(true);

    memorySettings = {
      maker: false,
      claudeCode: true,
      codex: true,
      pi: true,
    };

    expect(claudeConfig.memoryEnabled).toBe(true);
    expect(claudeConfig.makerMemoryEnabled).toBe(false);
    expect(desktopCodexRuntimeConfig.memoryEnabled).toBe(true);
    expect(desktopCodexRuntimeConfig.makerMemoryEnabled).toBe(false);
  });

  it('warms bundled ripgrep lazily and reuses a successful probe', async () => {
    vi.doMock('../memory-settings-store.js', () => ({
      readMemorySettings: () => memorySettings,
    }));

    const existsSync = fsMocks.existsSync;
    const { warmUpBundledRipgrep, getRipgrepBinaryPath, desktopCodexRuntimeConfig } =
      await import('../runtime-configs.js');

    expect(existsSync).not.toHaveBeenCalled();
    const path = warmUpBundledRipgrep();
    const probes = existsSync.mock.calls.length;
    expect(path).toContain('/apps/ripgrep-bin/');
    expect(desktopCodexRuntimeConfig.pathPrepends).toEqual([path.replace(/\/rg$/, '')]);
    expect(getRipgrepBinaryPath()).toBe(path);
    expect(existsSync).toHaveBeenCalledTimes(probes);
  });

  it('fails during warmup when the bundled ripgrep binary is missing', async () => {
    vi.doMock('../memory-settings-store.js', () => ({
      readMemorySettings: () => memorySettings,
    }));
    fsMocks.existsSync.mockReturnValue(false);
    const { warmUpBundledRipgrep } = await import('../runtime-configs.js');
    expect(() => warmUpBundledRipgrep()).toThrow(/Bundled ripgrep not found/);
  });

  it('places generic Cindy-side Skill precedence in Claude and Codex only', async () => {
    vi.doMock('../memory-settings-store.js', () => ({
      readMemorySettings: () => memorySettings,
    }));

    const { buildDesktopClaudeRuntimeConfig, desktopCodexRuntimeConfig } = await import(
      '../runtime-configs.js'
    );
    const claudeConfig = buildDesktopClaudeRuntimeConfig(() => 'http://127.0.0.1:1234');
    const prompts = [claudeConfig.systemPrompt, desktopCodexRuntimeConfig.systemPrompt];

    for (const prompt of prompts) {
      expect(prompt).toContain('## Skill source precedence');
      expect(prompt).toMatch(
        /Cindy surfaces Skills from its own managed, user, and project\s+sources/u,
      );
      expect(prompt).toContain('Explicitly selecting the downstream Skill does not waive');
      // 来源判定必须落在可观察的清单标注上，并且无标注时 fail-closed 回落到
      // 「先跑 Cindy 侧 Skill」，否则这条规则对模型不可执行 (#1650 review)。
      expect(prompt).toMatch(/available-Skills listing already labels each Skill/u);
      expect(prompt).toMatch(
        /no usable source\s+label, treat the Skill as downstream and still run the applicable Cindy-side Skill first/u,
      );
      // 产品侧只表达来源级规则：不得出现具体 selector、Skill 名或本机路径。
      expect(prompt).not.toMatch(/\$[\w:-]+|\/(?:Users|home)\/|[A-Z]:\\/u);
    }
  });

  it('asks Claude and Codex to write user-facing plans in plain language', async () => {
    vi.doMock('../memory-settings-store.js', () => ({
      readMemorySettings: () => memorySettings,
    }));

    const { buildDesktopClaudeRuntimeConfig, desktopCodexRuntimeConfig } = await import(
      '../runtime-configs.js'
    );
    const claudeConfig = buildDesktopClaudeRuntimeConfig(() => 'http://127.0.0.1:1234');

    for (const prompt of [claudeConfig.systemPrompt, desktopCodexRuntimeConfig.systemPrompt]) {
      expect(prompt).toContain('## User-facing plans');
      expect(prompt).toContain('Write for a general user, not as internal engineering notes.');
      expect(prompt).toContain('Name the real action and visible result instead.');
    }
  });
});
