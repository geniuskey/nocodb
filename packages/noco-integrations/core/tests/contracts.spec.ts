import { describe, expect, it, vi } from 'vitest';

import {
  createManifest,
  IntegrationRegistry,
  IntegrationType,
  IntegrationWrapper,
} from '../src';

describe('Community integration contracts', () => {
  it('adds the model-discovery capability to AI manifests', () => {
    const manifest = createManifest(IntegrationType.Ai, {
      title: 'Example AI',
      icon: 'example',
      version: '1.0.0',
    });

    expect(manifest).toMatchObject({
      title: 'Example AI',
      expose: ['availableModels'],
    });
  });

  it('registers and resolves an integration by type and subtype', () => {
    const registry = IntegrationRegistry.getInstance();
    const entry = {
      type: IntegrationType.Auth,
      sub_type: 'community-contract-test',
      wrapper: IntegrationWrapper,
      form: {} as never,
      manifest: {
        title: 'Contract test',
        icon: 'test',
        version: '1.0.0',
      },
    };

    registry.register(entry);

    expect(registry.get(entry.type, entry.sub_type)).toBe(entry);
  });

  it('provides configuration and logger access to wrappers', () => {
    const logger = vi.fn();
    const wrapper = new IntegrationWrapper({ enabled: true }, logger);

    wrapper.log('ready');

    expect(wrapper.config).toEqual({ enabled: true });
    expect(logger).toHaveBeenCalledWith('ready');
  });
});
