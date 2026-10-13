class DivergenceEngine {
    scanDivergences(candles, rsiValues) {
        const divergences = [];
        if (candles.length < 10) return divergences;
        const len = candles.length;
        const cNow = candles[len - 1], cPrev = candles[len - 10];
        const rNow = rsiValues[len - 1], rPrev = rsiValues[len - 10];
        
        if (cNow && cPrev && rNow && rPrev) {
            if (cNow.close > cPrev.close && rNow < rPrev) {
                divergences.push({ name: 'Bearish Divergence', signal: 'SELL', accuracy: 85, direction: 'bearish', color: '#ff1744', icon: '🔴', startIndex: len-10, endIndex: len-1, startPrice: cPrev.close, endPrice: cNow.close });
            } else if (cNow.close < cPrev.close && rNow > rPrev) {
                divergences.push({ name: 'Bullish Divergence', signal: 'BUY', accuracy: 85, direction: 'bullish', color: '#00c853', icon: '🟢', startIndex: len-10, endIndex: len-1, startPrice: cPrev.close, endPrice: cNow.close });
            }
        }
        return divergences;
    }
}