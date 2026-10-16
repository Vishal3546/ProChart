/* ============================================================
 * BreakoutChecklistEngine — 6-point institutional breakout validator
 * Score 0-6 with reason tags
 * ============================================================ */
class BreakoutChecklistEngine {
    evaluate(candles) {
        if (!candles || candles.length < 30) {
            return { score: 0, total: 6, trend: 'INSUFFICIENT DATA', reasons: [], level: 'muted' };
        }
        const n = candles.length;
        const c = candles[n - 1];
        const closes = candles.map(k => k.close);
        const highs = candles.map(k => k.high);
        const lows  = candles.map(k => k.low);
        const vols  = candles.map(k => k.volume || 0);

        const ema20  = TechnicalIndicators.EMA(candles, 20);
        const ema50  = TechnicalIndicators.EMA(candles, 50);
        const rsi14  = TechnicalIndicators.RSI(candles, 14);
        const atr14  = TechnicalIndicators.ATR(candles, 14);

        const avgVol20 = vols.slice(-20).reduce((a, b) => a + b, 0) / 20;
        const high20 = Math.max(...highs.slice(-20));
        const low20  = Math.min(...lows.slice(-20));
        const rng20  = high20 - low20 || 1;

        const reasons = [];
        let score = 0;

        // 1) Price above EMA20 (short-term trend)
        if (ema20[n - 1] != null && c.close > ema20[n - 1]) { score++; reasons.push('Above EMA20'); }
        // 2) EMA20 > EMA50 (trend alignment)
        if (ema50[n - 1] != null && ema20[n - 1] > ema50[n - 1]) { score++; reasons.push('EMA20>EMA50'); }
        // 3) Break of 20-period high (fresh breakout)
        if (c.close >= high20 - (rng20 * 0.002)) { score++; reasons.push('20-bar breakout'); }
        // 4) Volume surge (>=1.5x 20-bar average)
        if ((c.volume || 0) >= avgVol20 * 1.5) { score++; reasons.push('Vol +50%'); }
        // 5) RSI momentum (55..75 = healthy bull momentum, not overbought)
        const r = rsi14[n - 1];
        if (r != null && r >= 55 && r <= 78) { score++; reasons.push(`RSI ${r.toFixed(0)}`); }
        // 6) Close in top 25% of candle range (buying pressure)
        const bodyRange = Math.max(c.high - c.low, 1e-9);
        const closeLoc = (c.close - c.low) / bodyRange;
        if (closeLoc >= 0.65) { score++; reasons.push('Strong close'); }

        let trend, level;
        if (score >= 5) { trend = '🚀 STRONG BULL BREAKOUT'; level = 'success'; }
        else if (score >= 4) { trend = '✅ BULLISH BREAKOUT'; level = 'success'; }
        else if (score === 3) { trend = '⚡ SET-UP FORMING'; level = 'warning'; }
        else if (score === 2) { trend = '➡ NEUTRAL / CHOP'; level = 'muted'; }
        else { trend = '❌ BEARISH / REJECTION'; level = 'danger'; }

        return { score, total: 6, trend, reasons, level };
    }
}
window.BreakoutChecklistEngine = BreakoutChecklistEngine;
