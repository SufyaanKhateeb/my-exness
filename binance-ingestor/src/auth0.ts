import { AuthenticationClient } from 'auth0';

import type { IngestConfig } from './config';

type CachedToken = {
  accessToken: string;
  expiresAtMs: number;
};

type ClientCredentialsGrantBody = Parameters<
  AuthenticationClient['oauth']['clientCredentialsGrant']
>[0] & {
  scope?: string;
};

let cachedToken: CachedToken | null = null;

function getClient(config: IngestConfig) {
  return new AuthenticationClient({
    domain: config.auth0Domain,
    clientId: config.auth0ClientId,
    clientSecret: config.auth0ClientSecret,
  });
}

export async function getSpacetimeIngestToken(config: IngestConfig) {
  const now = Date.now();

  if (cachedToken && cachedToken.expiresAtMs - 60_000 > now) {
    return cachedToken.accessToken;
  }

  const client = getClient(config);
  const tokenRequest: ClientCredentialsGrantBody = {
    audience: config.auth0Audience,
  };

  if (config.auth0Scope) {
    tokenRequest.scope = config.auth0Scope;
  }

  const response = await client.oauth.clientCredentialsGrant(
    tokenRequest as Parameters<AuthenticationClient['oauth']['clientCredentialsGrant']>[0]
  );
  const accessToken = response.data.access_token;
  const expiresIn = response.data.expires_in ?? 3600;

  cachedToken = {
    accessToken,
    expiresAtMs: now + expiresIn * 1000,
  };

  return accessToken;
}