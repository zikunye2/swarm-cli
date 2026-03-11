/**
 * Detects available AI agents by checking provider credentials and status.
 */

import { ProviderRegistry } from '../models/provider.js';
import { validateCredentials } from '../auth/credentials.js';
import { loadConfig, getEffectiveAuth } from '../config.js';
import type { ProviderStatus, DetectedAgents } from '../types.js';

/**
 * Probe all registered providers and return their availability status.
 */
export async function detectAvailableAgents(): Promise<DetectedAgents> {
  const config = await loadConfig();
  const providerNames = ProviderRegistry.list();

  const statuses = await Promise.all(
    providerNames.map(async (name): Promise<ProviderStatus> => {
      const def = ProviderRegistry.getDefinition(name);
      if (!def) {
        return {
          name,
          displayName: name,
          available: false,
          authType: 'unknown',
          authValid: false,
          variants: [],
        };
      }

      const authType = getEffectiveAuth(config, name);
      const validation = await validateCredentials(name, authType);

      return {
        name: def.name,
        displayName: def.displayName,
        available: validation.valid,
        authType,
        authValid: validation.valid,
        variants: def.variants.map((v) => v.id),
      };
    }),
  );

  return {
    available: statuses.filter((s) => s.available),
    unavailable: statuses.filter((s) => !s.available),
  };
}
