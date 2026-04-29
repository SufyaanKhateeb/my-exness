'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { SpacetimeDBProvider, useSpacetimeDB } from 'spacetimedb/react';
import { Identity } from 'spacetimedb';

import { DbConnection, type ErrorContext } from '@/src/module_bindings';
import { ConnectionStatusIndicator, type ConnectionHealthState } from '@/components/ConnectionStatusIndicator';

const HIDDEN_DURATION_THRESHOLD_MS = 30_000;
const RECONNECT_COOLDOWN_MS = 2_000;

type ResetPhase = 'idle' | 'restarting';

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

function ReconnectOnResume({
  lastHiddenAtRef,
  connectionStateRef,
  requestReconnect,
  markConnectionLive,
}: {
  lastHiddenAtRef: React.MutableRefObject<number | null>;
  connectionStateRef: React.MutableRefObject<ConnectionHealthState>;
  requestReconnect: (reason: string, detail: string) => void;
  markConnectionLive: (detail?: string) => void;
}) {
  const { getConnection } = useSpacetimeDB();

  useEffect(() => {
    let cancelled = false;

    async function handleVisibilityOrFocus() {
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

      const conn = getConnection() as DbConnection | null;
      if (!conn?.isActive) {
        requestReconnect(
          'Connection paused during sleep.',
          'Reconnecting to SpacetimeDB after the page became active again.'
        );
        return;
      }

      try {
        const result = await conn.procedures.ping({});

        if (cancelled) {
          return;
        }

        if (result === 'pong') {
          markConnectionLive('Existing SpacetimeDB connection verified with ping after the page became active again.');
          return;
        }

        requestReconnect(
          'Connection paused during sleep.',
          'Reconnecting to SpacetimeDB after the page became active again because ping returned an unexpected response.'
        );
      } catch (error) {
        if (cancelled) {
          return;
        }

        requestReconnect(
          'Connection paused during sleep.',
          error instanceof Error
            ? `Reconnecting to SpacetimeDB after ping failed when the page became active again: ${error.message}`
            : 'Reconnecting to SpacetimeDB after ping failed when the page became active again.'
        );
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        lastHiddenAtRef.current = Date.now();
        return;
      }

      void handleVisibilityOrFocus();
    };

    const handleFocus = () => {
      void handleVisibilityOrFocus();
    };

    window.addEventListener('focus', handleFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      cancelled = true;
      window.removeEventListener('focus', handleFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [connectionStateRef, getConnection, lastHiddenAtRef, markConnectionLive, requestReconnect]);

  return null;
}

export function SpacetimeConnectionProvider({
  host,
  databaseName,
  authToken,
  children,
}: {
  host: string;
  databaseName: string;
  authToken: string | null;
  children: ReactNode;
}) {
  const [providerInstanceId, setProviderInstanceId] = useState(0);
  const [resetPhase, setResetPhase] = useState<ResetPhase>('idle');
  const [lastReconnectAt, setLastReconnectAt] = useState(0);
  const [connectionState, setConnectionState] = useState<ConnectionHealthState>(() =>
    createConnectionState(
      'dropped',
      'The websocket connection is still starting.',
      'SpacetimeDB has not confirmed an active connection yet.'
    )
  );
  const connectionStateRef = useRef(connectionState);
  const lastHiddenAtRef = useRef<number | null>(null);
  const tokenKey = `${host}/${databaseName}/auth_token`;
  const isProviderMounted = resetPhase === 'idle';

  const markConnectionLive = useCallback((detail?: string) => {
    setConnectionState(
      createConnectionState(
        'live',
        'The SpacetimeDB websocket connection is live.',
        detail
      )
    );
  }, []);

  const requestReconnect = useCallback((reason: string, detail: string) => {
    const now = Date.now();

    if (resetPhase === 'restarting') {
      return;
    }

    if (now - lastReconnectAt < RECONNECT_COOLDOWN_MS) {
      return;
    }

    setResetPhase('restarting');
    setLastReconnectAt(now);
    setConnectionState(createConnectionState('dropped', reason, detail));
  }, [lastReconnectAt, resetPhase]);

  const handleConnect = useCallback((_conn: DbConnection, identity: Identity, token: string) => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(tokenKey, token);
    }

    markConnectionLive(`Connected identity ${identity.toHexString()}.`);
  }, [markConnectionLive, tokenKey]);

  const handleDisconnect = useCallback(() => {
    if (resetPhase === 'restarting') {
      return;
    }

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

    requestReconnect(
      'The websocket connection dropped after it was previously live.',
      'Forcing a new SpacetimeDB connection after disconnect.'
    );
  }, [requestReconnect, resetPhase]);

  const handleConnectError = useCallback((_ctx: ErrorContext, err: Error) => {
    setConnectionState(
      createConnectionState(
        'down',
        err.message || 'The database server rejected or failed the websocket connection.',
        'SpacetimeDB appears unavailable from the client.'
      )
    );

    requestReconnect(
      'The websocket connection failed to initialize.',
      err.message || 'Retrying SpacetimeDB after a websocket connection error.'
    );
  }, [requestReconnect]);

  useEffect(() => {
    connectionStateRef.current = connectionState;
  }, [connectionState]);

  useEffect(() => {
    if (resetPhase !== 'restarting') {
      return;
    }

    const remountTimer = window.setTimeout(() => {
      setProviderInstanceId(currentValue => currentValue + 1);
      setResetPhase('idle');
    }, 0);

    return () => {
      window.clearTimeout(remountTimer);
    };
  }, [resetPhase]);

  const connectionBuilder = useMemo(() => {
    const builder = DbConnection.builder()
      .withUri(host)
      .withDatabaseName(databaseName)
      .withCompression('gzip')
      .onConnect(handleConnect)
      .onDisconnect(handleDisconnect)
      .onConnectError(handleConnectError);

    return authToken ? builder.withToken(authToken) : builder;
  }, [authToken, databaseName, handleConnect, handleConnectError, handleDisconnect, host]);

  return (
    <>
      {isProviderMounted ? (
        <SpacetimeDBProvider key={providerInstanceId} connectionBuilder={connectionBuilder}>
          <ReconnectOnResume
            lastHiddenAtRef={lastHiddenAtRef}
            connectionStateRef={connectionStateRef}
            requestReconnect={requestReconnect}
            markConnectionLive={markConnectionLive}
          />
          {children}
        </SpacetimeDBProvider>
      ) : null}
      <ConnectionStatusIndicator state={connectionState} host={host} databaseName={databaseName} />
    </>
  );
}