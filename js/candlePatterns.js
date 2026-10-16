class CandlePatternEngine {
    isDowntrend(candles, idx) {
        if (idx < 5) return false;
        return candles[idx].close < candles[idx-5].close;
    }

    isUptrend(candles, idx) {
        if (idx < 5) return false;
        return candles[idx].close > candles[idx-5].close;
    }

    scanAll(candles) {
        const patterns = [];
        if (!candles || candles.length < 5) return patterns;

        for (let i = 5; i < candles.length; i++) {
            const c = candles[i], p = candles[i-1];
            const cBody = Math.abs(c.close - c.open);
            const cRange = c.high - c.low;
            const pBody = Math.abs(p.close - p.open);
            const lWick = Math.min(c.open, c.close) - c.low;

            // Hammer with downtrend check
            if (this.isDowntrend(candles, i) && cRange > 0 &&
                cBody < cRange * 0.3 && lWick > cBody * 2) {
                patterns.push({
                    index: i, name: 'Hammer', signal: 'bullish',
                    accuracy: 78, description: 'Bullish reversal after downtrend'
                });
            }

            // Bullish Engulfing with downtrend check
            if (this.isDowntrend(candles, i) && p.close < p.open && c.close > c.open &&
                c.close > p.open && c.open < p.close && cBody > pBody * 1.3) {
                patterns.push({
                    index: i, name: 'Bullish Engulfing', signal: 'bullish',
                    accuracy: 85, description: 'Strong bullish reversal'
                });
            }

            // Bearish Engulfing
            if (this.isUptrend(candles, i) && p.close > p.open && c.close < c.open &&
                c.close < p.open && c.open > p.close && cBody > pBody * 1.3) {
                patterns.push({
                    index: i, name: 'Bearish Engulfing', signal: 'bearish',
                    accuracy: 85, description: 'Strong bearish reversal'
                });
            }
        }
        return patterns;
    }
}