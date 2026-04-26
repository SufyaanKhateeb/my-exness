import type { CandlestickData, UTCTimestamp } from 'lightweight-charts';

export const MS_PER_MINUTE = 60_000;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;
export const CHART_HEIGHT = 430;
export const HISTORY_LOAD_THRESHOLD_BARS = 50;

const MINUTE_HISTORY_RETENTION_MS = 1000 * MS_PER_DAY;
const DAY_HISTORY_RETENTION_MS = 1000 * MS_PER_DAY;
const DEFAULT_HISTORY_BAR_TARGET = 180;
const HISTORY_CHUNK_BAR_TARGET = 120;
const APPROX_DAYS_PER_WEEK = 7;
const APPROX_DAYS_PER_MONTH = 30;

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

export type IntervalOption = {
  amount: number;
  unit: IntervalUnit;
  label: string;
};

export const CHART_INTERVAL_OPTIONS: IntervalOption[] = [
  { amount: 1, unit: 'minute', label: '1m' },
  { amount: 2, unit: 'minute', label: '2m' },
  { amount: 3, unit: 'minute', label: '3m' },
  { amount: 4, unit: 'minute', label: '4m' },
  { amount: 5, unit: 'minute', label: '5m' },
  { amount: 10, unit: 'minute', label: '10m' },
  { amount: 15, unit: 'minute', label: '15m' },
  { amount: 30, unit: 'minute', label: '30m' },
  { amount: 45, unit: 'minute', label: '45m' },
  { amount: 1, unit: 'hour', label: '1h' },
  { amount: 2, unit: 'hour', label: '2h' },
  { amount: 4, unit: 'hour', label: '4h' },
  { amount: 1, unit: 'day', label: '1D' },
  { amount: 1, unit: 'week', label: '1W' },
  { amount: 1, unit: 'month', label: '1M' },
  { amount: 12, unit: 'month', label: '12M' },
];

export type SourceCandle = {
  id: bigint;
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

export function areSourceCandlesEqual(
  left: readonly SourceCandle[],
  right: readonly SourceCandle[]
) {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const leftCandle = left[index];
    const rightCandle = right[index];

    if (
      leftCandle.marketId !== rightCandle.marketId ||
      leftCandle.bucketStart.toMillis() !== rightCandle.bucketStart.toMillis() ||
      leftCandle.open !== rightCandle.open ||
      leftCandle.high !== rightCandle.high ||
      leftCandle.low !== rightCandle.low ||
      leftCandle.close !== rightCandle.close ||
      leftCandle.volume !== rightCandle.volume
    ) {
      return false;
    }
  }

  return true;
}

export function getStableSortedSourceCandles(
  previous: readonly SourceCandle[],
  next: readonly SourceCandle[],
) {
  const sortedNext = Array.from(next).sort(sortByBucketStart);

  let i = 0, j = 0;

  const result : SourceCandle[] = [];
    while (i < previous.length && j < sortedNext.length) {
        const left = previous[i];
        const right = sortedNext[j];

        if (left.id === right.id) {
            // left.bucketStart = right.bucketStart;
            // left.open = right.open;
            // left.high = right.high;
            // left.low = right.low;
            // left.close = right.close;
            // left.volume = right.volume;
            result.push(left);
            i++;
            j++;
        } else if (left.bucketStart.toMillis() < right.bucketStart.toMillis()) {
            result.push(left);
            i++;
        } else {
            result.push(right);
            j++;
        }
    }

    while (i < previous.length) {
        result.push(previous[i]);
        i++;
    }
    
    while (j < sortedNext.length) {
        result.push(sortedNext[j]);
        j++;
    }

    console.log(previous.length, next.length, result.length)

  return result;
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
          ? 'D'
          : unit === 'week'
            ? 'W'
            : 'M';

  return `${amount}${suffix}`;
}

export function isPresetInterval(amount: number, unit: IntervalUnit) {
  return CHART_INTERVAL_OPTIONS.some(option => option.amount === amount && option.unit === unit);
}

export function getIntervalOption(amount: number, unit: IntervalUnit) {
  return CHART_INTERVAL_OPTIONS.find(option => option.amount === amount && option.unit === unit) ?? null;
}

export function getIntervalTriggerLabel(amount: number, unit: IntervalUnit) {
  return getIntervalOption(amount, unit)?.label ?? getIntervalLabel(amount, unit);
}

export function usesMinuteSource(unit: IntervalUnit) {
  return unit === 'minute' || unit === 'hour';
}

export function getHistoryRetentionMs(unit: IntervalUnit) {
  return usesMinuteSource(unit) ? MINUTE_HISTORY_RETENTION_MS : DAY_HISTORY_RETENTION_MS;
}

export function getDisplayedIntervalMs(amount: number, unit: IntervalUnit) {
  if (unit === 'minute') {
    return amount * MS_PER_MINUTE;
  }

  if (unit === 'hour') {
    return amount * MS_PER_HOUR;
  }

  if (unit === 'day') {
    return amount * MS_PER_DAY;
  }

  if (unit === 'week') {
    return amount * APPROX_DAYS_PER_WEEK * MS_PER_DAY;
  }

  return amount * APPROX_DAYS_PER_MONTH * MS_PER_DAY;
}

export function getInitialHistoryWindowMs(amount: number, unit: IntervalUnit) {
  return Math.min(
    getHistoryRetentionMs(unit),
    getDisplayedIntervalMs(amount, unit) * DEFAULT_HISTORY_BAR_TARGET
  );
}

export function getHistoryChunkWindowMs(amount: number, unit: IntervalUnit) {
  return Math.min(
    getHistoryRetentionMs(unit),
    getDisplayedIntervalMs(amount, unit) * HISTORY_CHUNK_BAR_TARGET
  );
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

export function aggregateCandles(rows: readonly SourceCandle[], amount: number, unit: IntervalUnit) {
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