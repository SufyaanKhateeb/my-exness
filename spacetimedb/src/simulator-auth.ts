import { SenderError } from 'spacetimedb/server';

import {
  AUTH0_AUDIENCE,
  AUTH0_ISSUER,
} from './simulator-config';
import type { ExchangeCtx } from './index';

type AuthenticatedContext = Pick<ExchangeCtx, 'senderAuth'>;

function claimAsStringArray(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === 'string');
}

function hasScopeClaim(value: unknown, scope: string) {
  if (typeof value !== 'string') {
    return false;
  }

  return value.split(/\s+/).includes(scope);
}

function ensureAuth0Jwt(ctx: AuthenticatedContext) {
  const senderAuth = ctx.senderAuth;

  if (senderAuth.isInternal) {
    return null;
  }

  const jwt = senderAuth.jwt;

  if (!jwt) {
    throw new SenderError('Authentication required. Sign in with Auth0 to access this reducer.');
  }

  if (jwt.issuer !== AUTH0_ISSUER) {
    throw new SenderError('Unauthorized issuer. This module only accepts Auth0 tokens from the configured tenant.');
  }

  if (!jwt.audience.includes(AUTH0_AUDIENCE)) {
    throw new SenderError('Invalid Auth0 audience for this SpacetimeDB module.');
  }

  return jwt;
}

function ensurePermission(ctx: AuthenticatedContext, permission: string) {
  const jwt = ensureAuth0Jwt(ctx);

  if (!jwt) {
    return;
  }

  const permissions = claimAsStringArray(jwt.fullPayload.permissions);

  if (permissions.includes(permission) || hasScopeClaim(jwt.fullPayload.scope, permission)) {
    return;
  }

  throw new SenderError(`Permission \"${permission}\" is required.`);
}

function getCurrentAuth0UserId(ctx: AuthenticatedContext) {
  const jwt = ensureAuth0Jwt(ctx);
  const subject = jwt?.fullPayload?.sub;

  if (typeof subject !== 'string' || subject.length === 0) {
    throw new SenderError('Authenticated Auth0 subject claim is missing.');
  }

  return subject;
}

export { ensureAuth0Jwt, ensurePermission, getCurrentAuth0UserId };