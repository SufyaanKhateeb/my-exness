'use client';

import { getAccessToken, useUser } from '@auth0/nextjs-auth0/client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SpacetimeDBProvider, useReducer, useSpacetimeDB } from 'spacetimedb/react';
import { DbConnection, ErrorContext, reducers } from '../src/module_bindings';
import { Identity } from 'spacetimedb';

import { ConnectionStatusIndicator, type ConnectionHealthState } from '../components/ConnectionStatusIndicator';
import { NotificationBridge } from '../components/NotificationBridge';
import { Spinner } from '@/components/ui/spinner';
import { Toaster } from '@/components/ui/sonner';

const HOST =
  process.env.NEXT_PUBLIC_SPACETIMEDB_HOST ?? 'wss://maincloud.spacetimedb.com';
const DB_NAME = process.env.NEXT_PUBLIC_SPACETIMEDB_DB_NAME ?? 'nextjs-ts';
const AUTH0_AUDIENCE = process.env.NEXT_PUBLIC_AUTH0_AUDIENCE;
const AUTH0_SCOPE = process.env.NEXT_PUBLIC_AUTH0_SCOPE;
const TOKEN_KEY = `${HOST}/${DB_NAME}/auth_token`;
const HIDDEN_DURATION_THRESHOLD_MS = 30_000;
const RECONNECT_COOLDOWN_MS = 2_000;

function createConnectionState(
  kind: ConnectionHealthState['kind'],
  reason: string,
  detail?: string
): ConnectionHealthState {
  return {
    kind,
    reason,
    detail,
    updatedAt: Date.now(),
  };
}

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
  const [reconnectGeneration, setReconnectGeneration] = useState(0);
  const [connectionState, setConnectionState] = useState<ConnectionHealthState>(() =>
    createConnectionState(
      'dropped',
      'The websocket connection is still starting.',
      'SpacetimeDB has not confirmed an active connection yet.'
    )
  );
  const connectionStateRef = useRef(connectionState);
  const lastHiddenAtRef = useRef<number | null>(null);
  const lastReconnectAtRef = useRef(0);

  const handleConnect = useCallback((_conn: DbConnection, identity: Identity, token: string) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(TOKEN_KEY, token);
    }

    setConnectionState(
      createConnectionState(
        'live',
        'The SpacetimeDB websocket connection is live.',
        `Connected identity ${identity.toHexString()}.`
      )
    );
    console.log('connected');
  }, []);

  const handleDisconnect = useCallback(() => {
    setConnectionState(previousState =>
      createConnectionState(
        'dropped',
        previousState.kind === 'live'
          ? 'The websocket connection dropped after it was previously live.'
          : 'The websocket connection is not active yet.',
        previousState.kind === 'live'
          ? 'The client should retry automatically until the backend becomes reachable again.'
          : 'Waiting for the initial SpacetimeDB websocket handshake.'
      )
    );
  }, []);

  const handleConnectError = useCallback((_ctx: ErrorContext, err: Error) => {
    setConnectionState(
      createConnectionState(
        'down',
        err.message || 'The database server rejected or failed the websocket connection.',
        'SpacetimeDB appears unavailable from the client.'
      )
    );

    console.log('[spacetimedb-client] Error connecting to SpacetimeDB:', err);
  }, []);

  useEffect(() => {
    connectionStateRef.current = connectionState;
  }, [connectionState]);

  const requestReconnect = useCallback((reason: string, detail: string) => {
    const now = Date.now();

    if (now - lastReconnectAtRef.current < RECONNECT_COOLDOWN_MS) {
      return;
    }

    lastReconnectAtRef.current = now;
    setConnectionState(createConnectionState('dropped', reason, detail));
    setReconnectGeneration(currentValue => currentValue + 1);
  }, []);

  useEffect(() => {
    const handleVisibilityOrFocus = () => {
      if (document.visibilityState !== 'visible') {
        return;
      }

      const hiddenDuration = lastHiddenAtRef.current
        ? Date.now() - lastHiddenAtRef.current
        : 0;
      const connectionKind = connectionStateRef.current.kind;
      const shouldReconnect =
        hiddenDuration >= HIDDEN_DURATION_THRESHOLD_MS || connectionKind !== 'live';

      lastHiddenAtRef.current = null;

      if (!shouldReconnect) {
        return;
      }

      requestReconnect(
        'Connection paused during sleep.',
        'Reconnecting to SpacetimeDB after the page became active again.'
      );
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        lastHiddenAtRef.current = Date.now();
        return;
      }

      handleVisibilityOrFocus();
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [requestReconnect]);

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

  const connectionBuilder = useMemo(
    () => {
      if(reconnectGeneration >= 0 && user && auth0Token) {
          return DbConnection.builder()
            .withUri(HOST)
            .withDatabaseName(DB_NAME)
            .withToken(auth0Token)
            .withCompression('gzip')
            .onConnect(handleConnect)
            .onDisconnect(handleDisconnect)
            .onConnectError(handleConnectError);
      } else {
          return DbConnection.builder()
            .withUri(HOST)
            .withDatabaseName(DB_NAME)
            .withCompression('gzip')
            .onConnect(handleConnect)
            .onDisconnect(handleDisconnect)
            .onConnectError(handleConnectError);
      }
    },
    [handleConnect, handleConnectError, handleDisconnect, user, reconnectGeneration, auth0Token]
  );

  if (isLoading || (user && !isAuth0TokenReady)) {
    return (
      <>
        <div className="flex min-h-screen items-center justify-center bg-[#040b14] text-sm text-slate-400">
          <div className="flex items-center gap-3">
            <Spinner className="size-4" />
            <span>Connecting to SpacetimeDB...</span>
          </div>
        </div>
        <ConnectionStatusIndicator state={connectionState} host={HOST} databaseName={DB_NAME} />
      </>
    );
  }

  return (
    <>
      <SpacetimeDBProvider
        // key={user ? `auth0:${connectionToken ?? 'missing-token'}` : 'anonymous'}
        connectionBuilder={connectionBuilder}
      >
        <Auth0UserSync user={user ?? undefined}>
          <NotificationBridge />
          {children}
          <Toaster position="bottom-left" />
        </Auth0UserSync>
      </SpacetimeDBProvider>
      <ConnectionStatusIndicator state={connectionState} host={HOST} databaseName={DB_NAME} />
    </>
  );
}
