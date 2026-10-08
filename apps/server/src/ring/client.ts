import { RingApiError, RingClient } from 'ring-partner-kit';

export const TOKEN_EXPIRED_MESSAGE = 'Ring token expired — paste a new Playground token';

/**
 * Builds the Ring client from the environment. Only Playground mode
 * (`RING_ACCESS_TOKEN`) exists so far; refresh-token mode comes later.
 */
export function createRingClient(env: NodeJS.ProcessEnv = process.env): RingClient {
  const accessToken = env.RING_ACCESS_TOKEN?.trim();
  const hasRefreshToken = Boolean(env.RING_REFRESH_TOKEN?.trim());

  if (accessToken && hasRefreshToken) {
    throw new Error('Set RING_ACCESS_TOKEN or the refresh-token variables in .env, never both.');
  }
  if (!accessToken) {
    throw new Error(
      hasRefreshToken
        ? 'Refresh-token mode is not built yet. Set RING_ACCESS_TOKEN to a Playground token instead.'
        : 'RING_ACCESS_TOKEN is not set. Generate a token in the Ring Developer Playground and put it in .env.',
    );
  }
  return new RingClient({ accessToken });
}

export function isTokenExpired(err: unknown): err is RingApiError {
  return err instanceof RingApiError && err.isUnauthorized;
}
