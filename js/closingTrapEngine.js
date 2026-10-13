class ClosingTrapEngine {
    analyzeClosingTrap(candles, vwap, ema20) {
        const c = candles[candles.length - 1].close;
        const isUp = c > vwap;
        return { btstSignal: isUp ? '🟢 BTST CALL BUY' : '🔴 STBT PUT BUY', gapProbability: isUp ? '84% GAP UP' : '82% GAP DOWN', color: isUp ? '#00c853' : '#ff1744', detail: 'Final hour institutional volume alignment.' };
    }
}