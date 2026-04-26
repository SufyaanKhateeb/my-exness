'use client';

import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

export type ConnectionHealthState = {
  kind: 'live' | 'down' | 'dropped';
  reason: string;
  detail?: string;
  updatedAt: number;
};

type ConnectionStatusIndicatorProps = {
  state: ConnectionHealthState;
  host: string;
  databaseName: string;
};

const STATUS_STYLES: Record<
  ConnectionHealthState['kind'],
  {
    label: string;
    dotClassName: string;
    ringClassName: string;
  }
> = {
  live: {
    label: 'Live',
    dotClassName: 'bg-emerald-500',
    ringClassName: 'ring-emerald-500/25',
  },
  down: {
    label: 'DB Down',
    dotClassName: 'bg-rose-500',
    ringClassName: 'ring-rose-500/25',
  },
  dropped: {
    label: 'Dropped',
    dotClassName: 'bg-amber-400',
    ringClassName: 'ring-amber-400/25',
  },
};

function formatTimestamp(value: number) {
  return new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(value);
}

export function ConnectionStatusIndicator({ state, host, databaseName }: ConnectionStatusIndicatorProps) {
  const statusStyle = STATUS_STYLES[state.kind];

  return (
    <div className="fixed bottom-4 left-4 z-50">
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`SpacetimeDB connection status: ${statusStyle.label}`}
            className={cn(
              'inline-flex size-5 items-center justify-center rounded-full border border-background/70 bg-background/90 shadow-md backdrop-blur-sm ring-4 transition hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              statusStyle.ringClassName
            )}
          >
            <span className={cn('size-2.5 rounded-full', statusStyle.dotClassName)} />
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" className="w-80">
          <PopoverHeader>
            <PopoverTitle>Connection {statusStyle.label}</PopoverTitle>
            <PopoverDescription>{state.reason}</PopoverDescription>
          </PopoverHeader>

          {state.detail ? <p className="text-muted-foreground text-xs wrap-break-word">{state.detail}</p> : null}

          <div className="space-y-1 text-[11px] text-muted-foreground">
            <p>Host: {host}</p>
            <p>Database: {databaseName}</p>
            <p>Updated: {formatTimestamp(state.updatedAt)}</p>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}