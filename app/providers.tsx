'use client';

import { getAccessToken, useUser } from '@auth0/nextjs-auth0/client';
import { useEffect, useRef, useState } from 'react';
import { useReducer, useSpacetimeDB } from 'spacetimedb/react';
import { DbConnection, reducers } from '../src/module_bindings';

import { NotificationBridge } from '../components/NotificationBridge';
import { SpacetimeConnectionProvider } from '@/components/SpacetimeConnectionProvider';
import { Spinner } from '@/components/ui/spinner';
import { Toaster } from '@/components/ui/sonner';

const HOST =
  process.env.NEXT_PUBLIC_SPACETIMEDB_HOST ?? 'wss://maincloud.spacetimedb.com';
const DB_NAME = process.env.NEXT_PUBLIC_SPACETIMEDB_DB_NAME ?? 'nextjs-ts';
const AUTH0_AUDIENCE = process.env.NEXT_PUBLIC_AUTH0_AUDIENCE;
const AUTH0_SCOPE = process.env.NEXT_PUBLIC_AUTH0_SCOPE;

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

  if (isLoading || (user && !isAuth0TokenReady)) {
    return (
      <>
        <div className="flex min-h-screen items-center justify-center bg-[#040b14] text-sm text-slate-400">
          <div className="flex items-center gap-3">
            <Spinner className="size-4" />
            <span>Connecting to SpacetimeDB...</span>
          </div>
        </div>
      </>
    );
  }

  return (
    <SpacetimeConnectionProvider host={HOST} databaseName={DB_NAME} authToken={user ? auth0Token : null}>
      <Auth0UserSync user={user ?? undefined}>
        <NotificationBridge />
        {children}
        <Toaster position="bottom-left" />
      </Auth0UserSync>
    </SpacetimeConnectionProvider>
  );
}
