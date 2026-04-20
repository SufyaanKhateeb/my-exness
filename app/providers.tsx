'use client';

import { getAccessToken, useUser } from '@auth0/nextjs-auth0/client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { SpacetimeDBProvider, useReducer, useSpacetimeDB } from 'spacetimedb/react';
import { DbConnection, ErrorContext, reducers } from '../src/module_bindings';
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

type AuthenticatedUser = {
  sub?: string;
  name?: string | null;
  email?: string | null;
};

function Auth0UserSync({
  user,
  children,
}: {
  user: AuthenticatedUser | undefined;
  children: React.ReactNode;
}) {
  const { getConnection, isActive } = useSpacetimeDB();
  const syncCurrentUser = useReducer(reducers.syncCurrentUser);
  const lastCheckedUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function ensureCurrentUserSync() {
      const conn = getConnection() as DbConnection | null;
      const auth0UserId = user?.sub;

      if (!conn || !auth0UserId) {
        return;
      }

      if (lastCheckedUserIdRef.current === auth0UserId) {
        return;
      }

      const exists = await conn.procedures.currentUserExists({});

      if (cancelled) {
        return;
      }

      if (!exists) {
        await syncCurrentUser({
          displayName: user?.name ?? '',
          email: user?.email ?? '',
        });

        if (cancelled) {
          return;
        }
      }

      lastCheckedUserIdRef.current = auth0UserId;
    }

    if (!user?.sub) {
      lastCheckedUserIdRef.current = null;
      return;
    }

    if (!isActive) {
      return;
    }

    void ensureCurrentUserSync();

    return () => {
      cancelled = true;
    };
  }, [getConnection, isActive, syncCurrentUser, user]);

  return <>{children}</>;
}

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
          audience: AUTH0_AUDIENCE,
          scope: AUTH0_SCOPE || undefined,
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
      <Auth0UserSync user={user ?? undefined}>{children}</Auth0UserSync>
    </SpacetimeDBProvider>
  );
}
