import type { CandlestickData, UTCTimestamp } from 'lightweight-charts';

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;
export const CHART_HEIGHT = 430;

export const FALLBACK_CANDLES: CandlestickData[] = [
  { time: 1_712_707_200 as UTCTimestamp, open: 64120, high: 64280, low: 63980, close: 64190 },
  { time: 1_712_708_100 as UTCTimestamp, open: 64190, high: 64440, low: 64110, close: 64370 },
  { time: 1_712_709_000 as UTCTimestamp, open: 64370, high: 64520, low: 64260, close: 64410 },
  { time: 1_712_709_900 as UTCTimestamp, open: 64410, high: 64480, low: 64160, close: 64210 },
  { time: 1_712_710_800 as UTCTimestamp, open: 64210, high: 64330, low: 64040, close: 64120 },
  { time: 1_712_711_700 as UTCTimestamp, open: 64120, high: 64510, low: 64090, close: 64480 },
  { time: 1_712_712_600 as UTCTimestamp, open: 64480, high: 64620, low: 64380, close: 64570 },
  { time: 1_712_713_500 as UTCTimestamp, open: 64570, high: 64640, low: 64210, close: 64320 },
];

export type IntervalUnit = 'minute' | 'hour' | 'day' | 'week' | 'month';

export type SourceCandle = {
  marketId: number;
  bucketStart: { toMillis(): bigint };
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export function sortByBucketStart(left: SourceCandle, right: SourceCandle) {
  return Number(left.bucketStart.toMillis() - right.bucketStart.toMillis());
}

export function formatPrice(price: number, precision: number) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  }).format(price);
}

export function formatCompactVolume(volume: number) {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(volume);
}

export function formatPercent(value: number) {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`;
}

export function formatRate(value: number) {
  return `${(value * 100).toFixed(value < 0.001 ? 3 : 2)}%`;
}

export function getIntervalLabel(amount: number, unit: IntervalUnit) {
  const suffix =
    unit === 'minute'
      ? 'm'
      : unit === 'hour'
        ? 'h'
        : unit === 'day'
          ? 'd'
          : unit === 'week'
            ? 'w'
            : 'mo';

  return `${amount}${suffix}`;
}

function getBucketStartMs(value: number, unit: IntervalUnit, amount: number) {
  if (unit === 'minute') {
    return Math.floor(value / (amount * MS_PER_MINUTE)) * amount * MS_PER_MINUTE;
  }

  if (unit === 'hour') {
    return Math.floor(value / (amount * MS_PER_HOUR)) * amount * MS_PER_HOUR;
  }

  if (unit === 'day') {
    return Math.floor(value / (amount * MS_PER_DAY)) * amount * MS_PER_DAY;
  }

  if (unit === 'week') {
    const date = new Date(value);
    const dayOffset = (date.getUTCDay() + 6) % 7;
    const mondayStart = Date.UTC(
      date.getUTCFullYear(),
      date.getUTCMonth(),
      date.getUTCDate() - dayOffset
    );

    return Math.floor(mondayStart / (amount * 7 * MS_PER_DAY)) * amount * 7 * MS_PER_DAY;
  }

  const date = new Date(value);
  const totalMonths = date.getUTCFullYear() * 12 + date.getUTCMonth();
  const bucketMonth = Math.floor(totalMonths / amount) * amount;

  return Date.UTC(Math.floor(bucketMonth / 12), bucketMonth % 12, 1);
}

export function aggregateCandles(rows: SourceCandle[], amount: number, unit: IntervalUnit) {
  const buckets = new Map<
    number,
    {
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }
  >();

  for (const row of [...rows].sort(sortByBucketStart)) {
    const rowMillis = Number(row.bucketStart.toMillis());
    const bucketStart = getBucketStartMs(rowMillis, unit, amount);
    const existing = buckets.get(bucketStart);

    if (!existing) {
      buckets.set(bucketStart, {
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
      });
      continue;
    }

    existing.high = Math.max(existing.high, row.high);
    existing.low = Math.min(existing.low, row.low);
    existing.close = row.close;
    existing.volume += row.volume;
  }

  return [...buckets.entries()]
    .sort(([left], [right]) => left - right)
    .map(([bucketStart, candle]) => ({
      time: Math.floor(bucketStart / 1000) as UTCTimestamp,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));
}