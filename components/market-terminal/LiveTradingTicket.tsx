'use client';

import { type LiveTradingPanelProps, LiveTradingPanelView } from '@/components/market-terminal/LiveTradingPanel';

export function LiveTradingTicket(props: LiveTradingPanelProps) {
  return <LiveTradingPanelView {...props} mode="ticket" />;
}