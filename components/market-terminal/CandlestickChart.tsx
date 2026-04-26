'use client';

import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type LogicalRangeChangeEventHandler,
  type Time,
} from 'lightweight-charts';

import {
  CHART_HEIGHT,
  HISTORY_LOAD_THRESHOLD_BARS,
  getIntervalTriggerLabel,
  formatPrice,
  type IntervalUnit,
} from '@/lib/market-terminal';

type CandlestickChartProps = {
  candles: CandlestickData[];
  precision: number;
  marketLabel: string;
  intervalAmount: number;
  intervalUnit: IntervalUnit;
  canLoadMoreHistory?: boolean;
  onRequestMoreHistory?: () => void;
};

function renderOverlayMarkup(
  candle: CandlestickData,
  precision: number,
  time: Time,
  marketLabel: string,
  intervalAmount: number,
  intervalUnit: IntervalUnit,
) {
  const outcomeColor = candle.close >= candle.open ? '#4ade80' : '#fb7185';
  const intervalLabel = getIntervalTriggerLabel(intervalAmount, intervalUnit);

  return `
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;font-size:11px;line-height:1.2;">
      <span style="color:#e2ecf9;font-size:12px;font-weight:600;letter-spacing:0.01em;">${marketLabel} . ${intervalLabel}</span>
      <span style="color:#8ea3bd;letter-spacing:0.08em;text-transform:uppercase;">${formatTooltipTime(time)}</span>
      <span style="color:#5f738e;letter-spacing:0.1em;text-transform:uppercase;">O <span style="color:${outcomeColor};font-size:12px;">${formatPrice(candle.open, precision)}</span></span>
      <span style="color:#5f738e;letter-spacing:0.1em;text-transform:uppercase;">H <span style="color:${outcomeColor};font-size:12px;">${formatPrice(candle.high, precision)}</span></span>
      <span style="color:#5f738e;letter-spacing:0.1em;text-transform:uppercase;">L <span style="color:${outcomeColor};font-size:12px;">${formatPrice(candle.low, precision)}</span></span>
      <span style="color:#5f738e;letter-spacing:0.1em;text-transform:uppercase;">C <span style="color:${outcomeColor};font-size:12px;">${formatPrice(candle.close, precision)}</span></span>
    </div>
  `;
}

function formatTooltipTime(time: Time) {
  if (typeof time === 'string') {
    return time;
  }

  if (typeof time === 'number') {
    const date = new Date(time * 1000);
    const startDate = new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'UTC',
    }).format(date);
    const startHour = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: 'UTC',
    }).format(date);

    return `${startDate} ${startHour} UTC`;
  }

  return `${time.year}-${String(time.month).padStart(2, '0')}-${String(time.day).padStart(2, '0')} 00:00 UTC`;
}

export function CandlestickChart({
  candles,
  precision,
  marketLabel,
  intervalAmount,
  intervalUnit,
  canLoadMoreHistory = false,
  onRequestMoreHistory,
}: CandlestickChartProps) {
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const precisionRef = useRef(precision);
  const canLoadMoreHistoryRef = useRef(canLoadMoreHistory);
  const onRequestMoreHistoryRef = useRef(onRequestMoreHistory);
  const historyRequestPendingRef = useRef(false);

  useEffect(() => {
    precisionRef.current = precision;
  }, [precision]);

  useEffect(() => {
    canLoadMoreHistoryRef.current = canLoadMoreHistory;
  }, [canLoadMoreHistory]);

  useEffect(() => {
    onRequestMoreHistoryRef.current = onRequestMoreHistory;
  }, [onRequestMoreHistory]);

  useEffect(() => {
    historyRequestPendingRef.current = false;
  }, [candles.length]);

  useEffect(() => {
    const overlay = overlayRef.current;
    const latestCandle = candles.at(-1);

    if (!overlay || !latestCandle) {
      return;
    }

    overlay.innerHTML = renderOverlayMarkup(
      latestCandle,
      precision,
      latestCandle.time,
      marketLabel,
      intervalAmount,
      intervalUnit,
    );
  }, [candles, intervalAmount, intervalUnit, marketLabel, precision]);

  useEffect(() => {
    const container = chartContainerRef.current;

    if (!container) {
      return;
    }

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight || CHART_HEIGHT,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#8ea3bd',
      },
      grid: {
        vertLines: { color: 'rgba(148, 163, 184, 0.08)' },
        horzLines: { color: 'rgba(148, 163, 184, 0.08)' },
      },
      rightPriceScale: {
        borderColor: 'rgba(148, 163, 184, 0.14)',
      },
      timeScale: {
        borderColor: 'rgba(148, 163, 184, 0.14)',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        horzLine: {
          labelVisible: false,
        },
        vertLine: {
          labelVisible: false,
        },
      },
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: '#28c76f',
      downColor: '#ff5a65',
      wickUpColor: '#28c76f',
      wickDownColor: '#ff5a65',
      borderVisible: false,
      priceLineVisible: true,
      lastValueVisible: true,
    });

    chartRef.current = chart;
    seriesRef.current = series;

    chart.subscribeCrosshairMove(param => {
      const overlay = overlayRef.current;

      if (!overlay) {
        return;
      }

      if (
        !param.point ||
        !param.time ||
        param.point.x < 0 ||
        param.point.x > container.clientWidth ||
        param.point.y < 0 ||
        param.point.y > container.clientHeight
      ) {
        return;
      }

      const data = param.seriesData.get(series);

      if (!data || !('open' in data)) {
        return;
      }

      overlay.innerHTML = renderOverlayMarkup(
        data,
        precisionRef.current,
        param.time,
        marketLabel,
        intervalAmount,
        intervalUnit,
      );
    });

    const handleVisibleLogicalRangeChange: LogicalRangeChangeEventHandler = logicalRange => {
      const currentSeries = seriesRef.current;
      if (
        !logicalRange ||
        !currentSeries ||
        !canLoadMoreHistoryRef.current ||
        historyRequestPendingRef.current ||
        !onRequestMoreHistoryRef.current
      ) {
        return;
      }

      const barsInfo = currentSeries.barsInLogicalRange(logicalRange);

      if (barsInfo && barsInfo.barsBefore < HISTORY_LOAD_THRESHOLD_BARS) {
        historyRequestPendingRef.current = true;
        onRequestMoreHistoryRef.current();
      }
    };

    chart.timeScale().subscribeVisibleLogicalRangeChange(handleVisibleLogicalRangeChange);

    const resizeObserver = new ResizeObserver(entries => {
      const entry = entries[0];

      if (entry) {
        chart.resize(entry.contentRect.width, entry.contentRect.height || CHART_HEIGHT);
      }

      chart.timeScale().fitContent();
    });

    resizeObserver.observe(container);
    chartRef.current?.timeScale().fitContent();

    return () => {
      resizeObserver.disconnect();
      chart.timeScale().unsubscribeVisibleLogicalRangeChange(handleVisibleLogicalRangeChange);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, [intervalAmount, intervalUnit, marketLabel]);

  useEffect(() => {
    if (!seriesRef.current) {
      return;
    }

    seriesRef.current.setData(candles);
  }, [candles]);

  return (
    <div ref={chartContainerRef} className="relative h-full w-full min-h-0">
      <div
        ref={overlayRef}
        className="pointer-events-none absolute left-3 top-3 z-20 px-1 py-0.5 md:left-4 md:top-4"
        style={{ background: 'transparent' }}
      />
    </div>
  );
}