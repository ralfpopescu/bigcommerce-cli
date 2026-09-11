import { getProfile } from '../config';

import { ApiClient, ApiClientOptions } from './client';

/**
 * The single place a command turns a profile name into a client. Keeping this
 * in one function means credential resolution has one seam to stub in tests,
 * rather than one per command module.
 */
export function createClient(
  profile?: string,
  overrides: Partial<ApiClientOptions> = {},
): ApiClient {
  const { storeHash, accessToken } = getProfile(profile);

  return new ApiClient({ storeHash, accessToken, ...overrides });
}
