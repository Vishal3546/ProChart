class CandlePatternEngine {
    constructor() { this.detectedPatterns = []; }
    bodySize(c) { return Math.abs(c.close - c.open); }
    totalRange(c) { return c.high - c.low || 0.0001; }
    isBullish(c) { return c.close > c.open; }
    isBearish(c) { return c.close < c.open; }
    isDoji(c) { return this.bodySize(c) / this.totalRange(c) < 0.05; }
    
    scanAll(candles, minAccuracy = 60) {
        this.detectedPatterns = [];
        if (candles.length < 5) return this.detectedPatterns;

        for (let i = 1; i < candles.length; i++) {
            const c = candles[i];
            const prev = candles[i - 1];

            // Hammer
            if (c.high - Math.max(c.open, c.close) <= this.totalRange(c) * 0.15 &&
                Math.min(c.open, c.close) - c.low >= this.bodySize(c) * 2) {
                this.detectedPatterns.push({
                    type: 'single', name: 'Hammer', signal: 'bullish', index: i, accuracy: 82,
                    description: 'Bullish reversal. Rejection of lower prices.'
                });
            }

            // Engulfing
            if (i >= 1) {
                if (this.isBearish(prev) && this.isBullish(c) && c.open <= prev.close && c.close >= prev.open) {
                    this.detectedPatterns.push({
                        type: 'double', name: 'Bullish Engulfing', signal: 'bullish', index: i, accuracy: 86,
                        description: 'Strong bullish reversal. Buyers engulf sellers.'
                    });
                }
            }
        }
        return this.detectedPatterns.filter(p => p.accuracy >= minAccuracy);
    }
}