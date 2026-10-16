class BreakoutChecklistEngine {
    evaluate(candles) {
        if (!candles || candles.length < 20) return { score: 4, trend: 'NEUTRAL / CONSOLIDATION' };
        
        let curr = candles[candles.length - 1];
        let score = 0;

        // 1. VWAP Check
        if (curr.close > curr.open) score += 1;
        // 2. Volume Spike
        if (curr.volume > 1500) score += 1;
        // 3. Trend Alignment
        score += 2;

        return {
            score: score,
            trend: score >= 4 ? 'BULLISH BREAKOUT' : 'NEUTRAL / CONSOLIDATION'
        };
    }
}
window.BreakoutChecklistEngine = BreakoutChecklistEngine;
