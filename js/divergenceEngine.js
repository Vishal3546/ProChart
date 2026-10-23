/* ============================================================
 * DivergenceEngine — RSI Bullish / Bearish divergence detection
 * Bullish: price makes lower low, RSI makes higher low → reversal up
 * Bearish: price makes higher high, RSI makes lower high → reversal down
 * Uses 5-bar swing pivots over last 60 bars.
 * ============================================================ */
class DivergenceEngine {
    scanDivergences(candles, rsiValues) {
        const out = { detected: false, label: '⚪ NONE', level: 'muted', direction: null, details: null };
        if (!candles || candles.length < 30 || !rsiValues || !rsiValues.length) return out;
        const n = candles.length;

        // Normalize RSI array to match candles length (right-align) — TechnicalIndicators.RSI
        // returns length n-13 (first 14 bars undefined), so raw rsiValues[i] is shifted.
        const rsiNorm = new Array(n).fill(null);
        const offset = n - rsiValues.length;
        for (let k = 0; k < rsiValues.length; k++) {
            const v = rsiValues[k];
            // Handle both {value: X} objects and raw numbers
            const val = (typeof v === 'object' && v !== null) ? v.value : v;
            if (val != null && isFinite(val)) rsiNorm[k + offset] = val;
        }

        const look = Math.min(60, n);
        const start = n - look;

        const pivotLows = [];
        const pivotHighs = [];
        for (let i = start + 3; i < n - 2; i++) {
            let isLL = true, isHH = true;
            for (let j = 1; j <= 3; j++) {
                if (candles[i].low  >= candles[i - j].low  || candles[i].low  >= candles[i + j].low)  isLL = false;
                if (candles[i].high <= candles[i - j].high || candles[i].high <= candles[i + j].high) isHH = false;
            }
            if (isLL && rsiNorm[i] != null) pivotLows.push({ i, price: candles[i].low, rsi: rsiNorm[i] });
            if (isHH && rsiNorm[i] != null) pivotHighs.push({ i, price: candles[i].high, rsi: rsiNorm[i] });
        }

        // Bullish divergence: compare last two pivot lows
        if (pivotLows.length >= 2) {
            const prev = pivotLows[pivotLows.length - 2];
            const cur  = pivotLows[pivotLows.length - 1];
            if (cur.price < prev.price && cur.rsi > prev.rsi + 2) {
                out.detected = true;
                out.label = '🟢 BULL DIV';
                out.level = 'success';
                out.direction = 'bullish';
                out.details = { prev, cur };
                return out;
            }
        }
        // Bearish divergence: last two pivot highs
        if (pivotHighs.length >= 2) {
            const prev = pivotHighs[pivotHighs.length - 2];
            const cur  = pivotHighs[pivotHighs.length - 1];
            if (cur.price > prev.price && cur.rsi < prev.rsi - 2) {
                out.detected = true;
                out.label = '🔴 BEAR DIV';
                out.level = 'danger';
                out.direction = 'bearish';
                out.details = { prev, cur };
                return out;
            }
        }
        return out;
    }
}
window.DivergenceEngine = DivergenceEngine;
