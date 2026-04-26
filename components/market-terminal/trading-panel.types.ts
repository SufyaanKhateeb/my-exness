export type TradingPanelProps = {
  marketId: number;
  marketSymbol: string;
  baseAsset: string;
  quoteAsset: string;
  precision: number;
  quoteIntervalMs: number;
};