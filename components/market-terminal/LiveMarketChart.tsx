"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Timestamp } from "spacetimedb";
import { useTable } from "spacetimedb/react";
import { CandlestickData } from "lightweight-charts";

import { CandlestickChart } from "@/components/market-terminal/CandlestickChart";
import { ChartToolbar } from "@/components/market-terminal/ChartToolbar";
import {
    aggregateCandles,
    FALLBACK_CANDLES,
    getHistoryChunkWindowMs,
    getHistoryRetentionMs,
    getInitialHistoryWindowMs,
    type IntervalUnit,
    type SourceCandle,
    sortByBucketStart,
    usesMinuteSource,
} from "@/lib/market-terminal";
import { tables } from "@/src/module_bindings";

type LiveMarketChartProps = {
    marketId: number;
    marketLabel: string;
    precision: number;
    intervalAmount: number;
    intervalUnit: IntervalUnit;
    onIntervalAmountChange: (nextValue: number) => void;
    onIntervalUnitChange: (nextValue: IntervalUnit) => void;
};

export function LiveMarketChart({
    marketId,
    marketLabel,
    precision,
    intervalAmount,
    intervalUnit,
    onIntervalAmountChange,
    onIntervalUnitChange,
}: LiveMarketChartProps) {
    const safeIntervalAmount = Math.max(1, Math.trunc(intervalAmount) || 1);
    const activeSourceUsesMinutes = usesMinuteSource(intervalUnit);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [overlayContainer, setOverlayContainer] = useState<HTMLDivElement | null>(null);
    const fullscreenContainerRef = useRef<HTMLDivElement | null>(null);
    const [selectedMinuteCandles, setSelectedMinuteCandles] = useState<SourceCandle[]>([]); // need this for preventing unwanted re-renders
    const [selectedDayCandles, setSelectedDayCandles] = useState<SourceCandle[]>([]); // need this for preventing unwanted re-renders

    const [historyWindowStartMs, setHistoryWindowStartMs] = useState(() => {
        const initialWindowMs = getInitialHistoryWindowMs(safeIntervalAmount, intervalUnit);
        return Date.now() - initialWindowMs;
    });
    const [historyRetentionFloorMs] = useState(() => Date.now() - getHistoryRetentionMs(intervalUnit));
    const historyWindowStart = useMemo(() => Timestamp.fromDate(new Date(historyWindowStartMs)), [historyWindowStartMs]);
    const [minuteCandles, minuteCandlesReady] = useTable(
        activeSourceUsesMinutes
            ? tables.marketMinuteCandle.where((candle) => candle.marketId.eq(marketId).and(candle.bucketStart.gte(historyWindowStart)))
            : tables.marketMinuteCandle.where((candle) => candle.marketId.eq(-1)),
    );
    const [dayCandles, dayCandlesReady] = useTable(
        activeSourceUsesMinutes
            ? tables.marketDayCandle.where((candle) => candle.marketId.eq(-1))
            : tables.marketDayCandle.where((candle) => candle.marketId.eq(marketId).and(candle.bucketStart.gte(historyWindowStart))),
    );

    useEffect(() => {
        if (minuteCandles.length > 0) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setSelectedMinuteCandles(() => [...minuteCandles].sort(sortByBucketStart));
        }
    }, [minuteCandles]);

    useEffect(() => {
        if (dayCandles.length > 0) {
            // eslint-disable-next-line react-hooks/set-state-in-effect
            setSelectedDayCandles(() => [...dayCandles].sort(sortByBucketStart));
        }
    }, [dayCandles]);

    useEffect(() => {
        const handleFullscreenChange = () => {
            setIsFullscreen(document.fullscreenElement === fullscreenContainerRef.current);
        };

        document.addEventListener("fullscreenchange", handleFullscreenChange);

        return () => {
            document.removeEventListener("fullscreenchange", handleFullscreenChange);
        };
    }, []);

    const selectedCandles = useMemo(() => {
        const sourceRows = activeSourceUsesMinutes ? selectedMinuteCandles : selectedDayCandles;
        return aggregateCandles(sourceRows, safeIntervalAmount, intervalUnit);
    }, [activeSourceUsesMinutes, intervalUnit, safeIntervalAmount, selectedDayCandles, selectedMinuteCandles]);

    const activeSourceCount = activeSourceUsesMinutes ? selectedMinuteCandles.length : selectedDayCandles.length;
    const activeSourceReady = activeSourceUsesMinutes ? minuteCandlesReady : dayCandlesReady;

    const chartCandles = useMemo(() => {
        return selectedCandles.length > 0
            ? selectedCandles
            : activeSourceCount === 0 && activeSourceReady
              ? FALLBACK_CANDLES
              : ([] as CandlestickData[]);
    }, [activeSourceCount, activeSourceReady, selectedCandles]);

    const canLoadMoreHistory = historyWindowStartMs > historyRetentionFloorMs;

    function handleRequestMoreHistory() {
        if (!canLoadMoreHistory) {
            return;
        }

        setHistoryWindowStartMs((currentWindowStartMs) =>
            Math.max(historyRetentionFloorMs, currentWindowStartMs - getHistoryChunkWindowMs(safeIntervalAmount, intervalUnit)),
        );
    }

    async function handleToggleFullscreen() {
        const chartSurface = fullscreenContainerRef.current;

        if (!chartSurface) {
            return;
        }

        if (document.fullscreenElement === chartSurface) {
            await document.exitFullscreen();
            return;
        }

        await chartSurface.requestFullscreen();
    }

    const handleContainerRef = (node: HTMLDivElement | null) => {
        fullscreenContainerRef.current = node;
        setOverlayContainer(node);
    };

    return (
        <div
            ref={handleContainerRef}
            className={`flex min-h-0 flex-col overflow-hidden border-none shadow-none ${
                isFullscreen ? "h-screen w-screen rounded-none border-none" : "h-full"
            }`}
        >
            <ChartToolbar
                intervalAmount={safeIntervalAmount}
                intervalUnit={intervalUnit}
                isFullscreen={isFullscreen}
                overlayContainer={overlayContainer}
                onIntervalAmountChange={onIntervalAmountChange}
                onIntervalUnitChange={onIntervalUnitChange}
                onToggleFullscreen={() => {
                    void handleToggleFullscreen();
                }}
            />
            <div className="min-h-0 flex-1 px-1 pb-1 md:px-2 md:pb-2">
                <CandlestickChart
                    candles={chartCandles}
                    precision={precision}
                    marketLabel={marketLabel}
                    intervalAmount={safeIntervalAmount}
                    intervalUnit={intervalUnit}
                    canLoadMoreHistory={canLoadMoreHistory}
                    onRequestMoreHistory={handleRequestMoreHistory}
                />
            </div>
        </div>
    );
}
