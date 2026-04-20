"use client";

import { useEffect, useMemo, useState } from "react";
import { Timestamp } from "spacetimedb";
import { useSpacetimeDB, useTable } from "spacetimedb/react";
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
    precision: number;
    intervalAmount: number;
    intervalUnit: IntervalUnit;
    onIntervalAmountChange: (nextValue: number) => void;
    onIntervalUnitChange: (nextValue: IntervalUnit) => void;
};

export function LiveMarketChart({
    marketId,
    precision,
    intervalAmount,
    intervalUnit,
    onIntervalAmountChange,
    onIntervalUnitChange,
}: LiveMarketChartProps) {
    const conn = useSpacetimeDB();
    const safeIntervalAmount = Math.max(1, Math.trunc(intervalAmount) || 1);
    const activeSourceUsesMinutes = usesMinuteSource(intervalUnit);
    const [selectedMinuteCandles, setSelectedMinuteCandles] = useState<SourceCandle[]>([]); // Force re-render when interval changes
    const [selectedDayCandles, setSelectedDayCandles] = useState<SourceCandle[]>([]); // Force re-render when interval changes

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

    // const selectedMinuteCandles = useMemo(() => {
    //         // eslint-disable-next-line react-hooks/refs
    //     if(minuteCandles.length === 0) return previousSelectedMinuteCandlesRef.current;
    //     return [...minuteCandles].sort(sortByBucketStart);
    //     return getStableSortedSourceCandles(
    //         // eslint-disable-next-line react-hooks/refs
    //         previousSelectedMinuteCandlesRef.current,
    //         minuteCandles,
    //     );
    // }, [minuteCandles]);

    // const selectedDayCandles = useMemo(() => {
    //         // eslint-disable-next-line react-hooks/refs
    //     if(dayCandles.length === 0) return previousSelectedDayCandlesRef.current;
    //     return [...dayCandles].sort(sortByBucketStart);
    //     return getStableSortedSourceCandles(
    //         // eslint-disable-next-line react-hooks/refs
    //         previousSelectedDayCandlesRef.current,
    //         dayCandles,
    //     );
    // }, [dayCandles]);

    // useEffect(() => {
    //     previousSelectedMinuteCandlesRef.current = selectedMinuteCandles;
    //     previousSelectedDayCandlesRef.current = selectedDayCandles;
    // }, [selectedMinuteCandles, selectedDayCandles]);

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

        console.log("inherently requesting more history");
        setHistoryWindowStartMs((currentWindowStartMs) =>
            Math.max(historyRetentionFloorMs, currentWindowStartMs - getHistoryChunkWindowMs(safeIntervalAmount, intervalUnit)),
        );
    }

    return (
        <>
            <ChartToolbar
                isConnected={conn.isActive}
                hasLiveCandles={selectedCandles.length > 0}
                intervalAmount={safeIntervalAmount}
                intervalUnit={intervalUnit}
                onIntervalAmountChange={onIntervalAmountChange}
                onIntervalUnitChange={onIntervalUnitChange}
            />
            <CandlestickChart
                candles={chartCandles}
                precision={precision}
                canLoadMoreHistory={canLoadMoreHistory}
                onRequestMoreHistory={handleRequestMoreHistory}
            />
        </>
    );
    return <div></div>;
}
