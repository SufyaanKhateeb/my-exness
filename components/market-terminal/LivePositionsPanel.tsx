'use client';

import { type LiveTradingPanelProps, LiveTradingPanelView } from '@/components/market-terminal/LiveTradingPanel';

export function LivePositionsPanel(props: LiveTradingPanelProps) {
  return <LiveTradingPanelView {...props} mode="positions" />;
}