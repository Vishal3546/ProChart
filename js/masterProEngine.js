class MasterProEngine {
    analyze(candles) {
        if (!candles || candles.length < 20) return { squeeze: false, vsa: 'NORMAL VOLUME', macd: 'NEUTRAL' };
        
        const last20 = candles.slice(-20);
        const closes = last20.map(c => c.close);
        const avg = closes.reduce((a,b) => a+b, 0) / 20;
        const variance = closes.reduce((a,b) => a + Math.pow(b - avg, 2), 0) / 20;
        const stdDev = Math.sqrt(variance);
        const bandWidth = (stdDev * 4) / avg;

        const lastVol = candles[candles.length - 1].volume;
        const avgVol = candles.slice(-10).reduce((a,b) => a + b.volume, 0) / 10;
        
        let vsa = 'NORMAL VOLUME';
        if (lastVol > avgVol * 1.8) vsa = '🔥 HIGH ABSORPTION';

        return {
            squeeze: bandWidth < 0.015,
            vsa: vsa,
            macd: 'BULLISH'
        };
    }
}
window.MasterProEngine = MasterProEngine;
