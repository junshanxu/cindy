import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  appendDiscoveredCustomProviderModels,
  createCustomProvider,
  customProviderModelConfigFromCatalogModel,
  providerViewToCustomProviderConfig,
  replaceCustomProviderModelId,
  updateCustomProvider,
} from '../customProviders';
import type { CustomProviderConfig, ProviderView } from '@cindy/model-providers';

const createCustomProviderMock = vi.fn();
const updateCustomProviderMock = vi.fn();
const safeStorageStoreMock = vi.fn();

const customProviderConfig = {
  id: 'test-provider',
  name: 'Test Provider',
  runtimes: {
    codex: {
      baseUrl: 'https://example.com/v1',
      models: [{ id: 'test-model', name: 'Test Model' }],
    },
  },
} satisfies CustomProviderConfig;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('window', {
    electronAPI: {
      maker: {
        createCustomProvider: createCustomProviderMock,
        updateCustomProvider: updateCustomProviderMock,
      },
      safeStorageStore: safeStorageStoreMock,
    },
  });
  createCustomProviderMock.mockResolvedValue(undefined);
  updateCustomProviderMock.mockResolvedValue(undefined);
  safeStorageStoreMock.mockResolvedValue(true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('custom provider key persistence', () => {
  it('rejects create when safe storage reports that the key was not stored', async () => {
    safeStorageStoreMock.mockResolvedValue(false);

    await expect(
      createCustomProvider(customProviderConfig, { codex: 'test-key' }),
    ).rejects.toThrow('Failed to securely store the API key for codex.');

    expect(createCustomProviderMock).toHaveBeenCalledWith(customProviderConfig);
    expect(safeStorageStoreMock).toHaveBeenCalledWith(
      'provider_key_test-provider_codex',
      'test-key',
    );
  });

  it('rejects update when safe storage reports that the key was not stored', async () => {
    safeStorageStoreMock.mockResolvedValue(false);

    await expect(
      updateCustomProvider(customProviderConfig, { codex: 'replacement-key' }),
    ).rejects.toThrow('Failed to securely store the API key for codex.');

    expect(updateCustomProviderMock).toHaveBeenCalledWith(customProviderConfig);
    expect(safeStorageStoreMock).toHaveBeenCalledWith(
      'provider_key_test-provider_codex',
      'replacement-key',
    );
  });
});

describe('replaceCustomProviderModelId', () => {
  it('drops hidden metadata when the model id changes', () => {
    expect(replaceCustomProviderModelId({
      id: 'MiniMax-M3',
      name: 'MiniMax M3',
      contextWindow: 1_000_000,
    }, 'another-model')).toEqual({
      id: 'another-model',
      name: 'MiniMax M3',
    });
  });

  it('preserves the original model when the id is unchanged', () => {
    const model = {
      id: 'MiniMax-M3',
      name: 'MiniMax M3',
      contextWindow: 1_000_000,
    };
    expect(replaceCustomProviderModelId(model, model.id)).toBe(model);
  });
});

describe('customProviderModelConfigFromCatalogModel', () => {
  it('does not freeze the materialized custom-provider default into user config', () => {
    expect(customProviderModelConfigFromCatalogModel({
      id: 'default-context',
      name: 'Default Context',
      contextWindow: 200_000,
    })).toEqual({
      id: 'default-context',
      name: 'Default Context',
    });
  });

  it('preserves a provider-specific non-default context window', () => {
    expect(customProviderModelConfigFromCatalogModel({
      id: 'MiniMax-M3',
      name: 'MiniMax M3',
      contextWindow: 1_000_000,
    })).toEqual({
      id: 'MiniMax-M3',
      name: 'MiniMax M3',
      contextWindow: 1_000_000,
    });
  });

  it('preserves hidden defaults while round-tripping catalog models', () => {
    expect(customProviderModelConfigFromCatalogModel({
      id: 'discovered',
      name: 'Discovered',
      contextWindow: 200_000,
      defaultEnabled: false,
    })).toEqual({
      id: 'discovered',
      name: 'Discovered',
      defaultEnabled: false,
    });
  });
});

describe('providerViewToCustomProviderConfig', () => {
  it('preserves no-auth and exact request-path fields through the edit round trip', () => {
    const provider = {
      id: 'local-chat',
      name: 'Local Chat',
      source: 'user',
      agents: ['codex'],
      auth: { method: 'none' },
      access: { kind: 'api' },
      routing: {
        codex: {
          upstream: 'http://127.0.0.1:4000/v1',
          authStrategy: 'none',
          wireProtocol: 'openai-chat',
          requestPath: '/tenant/acme/infer?stream=1',
          modelsUrl: 'http://127.0.0.1:4000/v1/models',
        },
      },
      models: {
        codex: [{
          id: 'local-model',
          name: 'Local Model',
          contextWindow: 200_000,
          efforts: [],
          defaultEffort: null,
        }],
      },
      connected: true,
    } satisfies ProviderView;

    expect(providerViewToCustomProviderConfig(provider)).toEqual({
      id: 'local-chat',
      name: 'Local Chat',
      auth: { method: 'none' },
      runtimes: {
        codex: {
          baseUrl: 'http://127.0.0.1:4000/v1',
          requestPath: '/tenant/acme/infer?stream=1',
          wireProtocol: 'openai-chat',
          modelsUrl: 'http://127.0.0.1:4000/v1/models',
          models: [{ id: 'local-model', name: 'Local Model' }],
        },
      },
    });
  });
});

describe('appendDiscoveredCustomProviderModels', () => {
  it('only appends unknown models and defaults them to hidden', () => {
    const result = appendDiscoveredCustomProviderModels(
      [{ id: 'kept', name: 'Kept' }],
      [
        { id: 'kept', name: 'New name' },
        { id: 'new', name: 'New' },
        { id: 'new', name: 'Duplicate new' },
        { id: '', name: 'Invalid' },
      ],
    );
    expect(result).toEqual({
      models: [
        { id: 'kept', name: 'Kept' },
        { id: 'new', name: 'New', defaultEnabled: false },
      ],
      addedIds: ['new'],
    });
  });
});
