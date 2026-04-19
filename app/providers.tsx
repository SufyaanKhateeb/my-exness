'use client';

import { getAccessToken, useUser } from '@auth0/nextjs-auth0/client';
import { useEffect, useMemo, useState } from 'react';
import { SpacetimeDBProvider } from 'spacetimedb/react';
import { DbConnection, ErrorContext } from '../src/module_bindings';
import { Identity } from 'spacetimedb';

const HOST =
  process.env.NEXT_PUBLIC_SPACETIMEDB_HOST ?? 'wss://maincloud.spacetimedb.com';
const DB_NAME = process.env.NEXT_PUBLIC_SPACETIMEDB_DB_NAME ?? 'nextjs-ts';
const AUTH0_AUDIENCE = process.env.NEXT_PUBLIC_AUTH0_AUDIENCE;
const AUTH0_SCOPE = process.env.NEXT_PUBLIC_AUTH0_SCOPE;
const TOKEN_KEY = `${HOST}/${DB_NAME}/auth_token`;

const onConnect = (_conn: DbConnection, identity: Identity, token: string) => {
  if (typeof window !== 'undefined') {
    localStorage.setItem(TOKEN_KEY, token);
  }
  console.log('[spacetimedb-client] Connected to SpacetimeDB', {
    identity: identity.toHexString(),
    receivedToken: Boolean(token),
  });
};

const onDisconnect = () => {
  console.log('[spacetimedb-client] Disconnected from SpacetimeDB');
};

const onConnectError = (_ctx: ErrorContext, err: Error) => {
  console.log('[spacetimedb-client] Error connecting to SpacetimeDB:', err);
};

export function Providers({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useUser();
  const [auth0Token, setAuth0Token] = useState<string | null>(null);
  const [isAuth0TokenReady, setIsAuth0TokenReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function resolveAccessToken() {
      if (!user) {
        console.log('[spacetimedb-client] No Auth0 user session, using anonymous or cached token flow');
        setAuth0Token(null);
        setIsAuth0TokenReady(true);
        return;
      }

      setIsAuth0TokenReady(false);

      try {
        const token = await getAccessToken({
          // audience: AUTH0_AUDIENCE,
          // scope: AUTH0_SCOPE || undefined,
        });

        if (!cancelled) {
          setAuth0Token(token);
          setIsAuth0TokenReady(true);
        }
      } catch (error) {
        console.error('Error fetching Auth0 access token for SpacetimeDB:', error);

        if (!cancelled) {
          setAuth0Token(null);
          setIsAuth0TokenReady(true);
        }
      }
    }

    void resolveAccessToken();

    return () => {
      cancelled = true;
    };
  }, [user]);

  const connectionToken = useMemo(() => {
    if (user) {
      return auth0Token ?? undefined;
    }

    if (typeof window === 'undefined') {
      return undefined;
    }

    return localStorage.getItem(TOKEN_KEY) || undefined;
  }, [auth0Token, user]);

  const connectionBuilder = useMemo(
    () => {
      return DbConnection.builder()
        .withUri(HOST)
        .withDatabaseName(DB_NAME)
        .withToken(connectionToken)
        .onConnect(onConnect)
        .onDisconnect(onDisconnect)
        .onConnectError(onConnectError);
    },
    [connectionToken]
  );

  if (isLoading || (user && !isAuth0TokenReady)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#040b14] text-sm text-slate-400">
        Connecting to SpacetimeDB...
      </div>
    );
  }

  return (
    <SpacetimeDBProvider
      key={user ? `auth0:${connectionToken ?? 'missing-token'}` : 'anonymous'}
      connectionBuilder={connectionBuilder}
    >
      {children}
    </SpacetimeDBProvider>
  );
}
