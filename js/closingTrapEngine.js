class ClosingTrapEngine {
    analyzeClosingTrap(candles, vwap, ema20) {
        // Audit Fix: Time-gated - only 3:15-3:30 PM IST
        if (!candles || candles.length < 20) {
            return { btstSignal: '—', color: '#787b86', detail: 'Insufficient data' };
        }

        const now = new Date();
        const utc = now.getTime() + now.getTimezoneOffset() * 60000;
        const ist = new Date(utc + 3600000 * 5.5);
        const mins = ist.getHours() * 60 + ist.getMinutes();

        // 3:15 PM = 915, 3:30 PM = 930
        if (mins < 915 || mins > 930) {
            return {
                btstSignal: '⏱️ Awaiting 3:15-3:30 PM IST window',
                color: '#787b86',
                detail: 'Signal only valid in closing hour'
            };
        }

        const current = candles[candles.length - 1];
        if (!vwap || !ema20) return { btstSignal: '—', color: '#787b86' };

        const aboveVWAP = current.close > vwap;
        const aboveEMA = current.close > ema20;

        const recent5 = candles.slice(-5);
        const buyVol = recent5.filter(c => c.close >= c.open).reduce((s, c) => s + c.volume, 0);
        const sellVol = recent5.filter(c => c.close < c.open).reduce((s, c) => s + c.volume, 0);
        const totalVol = buyVol + sellVol || 1;
        const buyPct = (buyVol / totalVol * 100).toFixed(0);

        if (aboveVWAP && aboveEMA && buyVol > sellVol) {
            return {
                btstSignal: '🟢 BTST CALL (' + buyPct + '% Buy Vol)',
                color: '#00c853',
                detail: 'Closing above VWAP+EMA20 with strong buying'
            };
        } else if (!aboveVWAP && !aboveEMA && sellVol > buyVol) {
            return {
                btstSignal: '🔴 STBT PUT (' + (100-buyPct) + '% Sell Vol)',
                color: '#ff1744',
                detail: 'Closing below VWAP+EMA20 with heavy selling'
            };
        }
        return { btstSignal: '🟡 Mixed signals - Avoid', color: '#ffd740' };
    }
}