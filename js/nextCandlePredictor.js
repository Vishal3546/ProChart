/* ============================================================
 * nextCandlePredictor.js — AI Next-Candle Forecast (v2026.10)
 * ============================================================
 * Combines multi-factor confluence to give an edge-weighted
 * probability for the NEXT candle's direction. This is NOT a
 * guarantee — it is a decision-support score (like TradingView's
 * "Summary" widget) that weighs the following inputs:
 *
 *   - EMA alignment (20/50 slope + relative position)
 *   - RSI regime (OB/OS/neutral + divergence context)
 *   - MACD crossover direction
 *   - VWAP position (above/below intraday anchor)
 *   - Volume confirmation (rising vs dry-up)
 *   - Bollinger position (upper/lower/middle)
 *   - Last candle pattern color + body size
 *
 * Output: { direction: 'bull'|'bear'|'neutral', score: -100..+100,
 *           confidence: 'low'|'med'|'high', factors: [...] }
 * ============================================================ */
class NextCandlePredictor {
    analyze(candles) {
        if (!candles || candles.length < 25) {
            return { direction: 'neutral', score: 0, confidence: 'low', factors: ['Insufficient data'] };
        }
        const n = candles.length;
        const last = candles[n - 1];
        const prev = candles[n - 2];
        const closes = candles.map(c => c.close);
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const vols = candles.map(c => c.volume || 0);
        let score = 0;
        const factors = [];

        // ---------- Helpers ----------
        const sma = (arr, p) => arr.slice(-p).reduce((s, v) => s + v, 0) / p;
        const stddev = (arr, p, mean) => {
            const s = arr.slice(-p).reduce((a, v) => a + (v - mean) ** 2, 0) / p;
            return Math.sqrt(s);
        };
        const ema = (arr, p) => {
            const k = 2 / (p + 1);
            let e = arr[0];
            for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
            return e;
        };

        // ---------- 1. EMA trend ----------
        const ema20 = ema(closes, 20);
        const ema50 = ema(closes, 50);
        const ema20_5ago = ema(closes.slice(0, -5), 20);
        const emaSlope = (ema20 - ema20_5ago) / ema20_5ago * 100;
        if (last.close > ema20 && ema20 > ema50) { score += 20; factors.push('EMA20 > EMA50 bullish alignment'); }
        else if (last.close < ema20 && ema20 < ema50) { score -= 20; factors.push('EMA20 < EMA50 bearish alignment'); }
        if (emaSlope > 0.1) { score += 8; factors.push(`EMA20 rising (${emaSlope.toFixed(2)}%)`); }
        else if (emaSlope < -0.1) { score -= 8; factors.push(`EMA20 falling (${emaSlope.toFixed(2)}%)`); }

        // ---------- 2. RSI regime ----------
        const rsiArr = TechnicalIndicators.RSI(candles, 14) || [];
        const _rsiVal = (v) => (v != null && typeof v === 'object') ? (v.value ?? null) : v;
        let rsi = rsiArr.length ? _rsiVal(rsiArr[rsiArr.length - 1]) : 50;
        let rsiPrev = rsiArr.length > 1 ? _rsiVal(rsiArr[rsiArr.length - 2]) : 50;
        if (!isFinite(rsi) || rsi == null) rsi = 50;
        if (!isFinite(rsiPrev) || rsiPrev == null) rsiPrev = 50;
        if (rsi != null) {
            if (rsi < 30) { score += 12; factors.push(`RSI oversold (${rsi.toFixed(0)}) — bounce setup`); }
            else if (rsi > 70) { score -= 12; factors.push(`RSI overbought (${rsi.toFixed(0)}) — pullback risk`); }
            if (rsi > rsiPrev + 1 && rsi < 60) score += 5;
            else if (rsi < rsiPrev - 1 && rsi > 40) score -= 5;
        }

        // ---------- 3. MACD ----------
        const macd = TechnicalIndicators.MACD(candles);
        if (macd && macd.macd && macd.macd.length >= 2) {
            const mL = macd.macd.length;
            const mCur = macd.macd[mL - 1], mPrev = macd.macd[mL - 2];
            const sCur = macd.signal[mL - 1], sPrev = macd.signal[mL - 2];
            const hCur = macd.hist[mL - 1], hPrev = macd.hist[mL - 2];
            // All must be finite numbers (null-guard)
            if ([mCur, mPrev, sCur, sPrev, hCur, hPrev].every(v => isFinite(v))) {
                if (mCur > sCur && mPrev <= sPrev) { score += 18; factors.push('MACD bullish crossover'); }
                else if (mCur < sCur && mPrev >= sPrev) { score -= 18; factors.push('MACD bearish crossover'); }
                if (hCur > 0 && hCur > hPrev) score += 5;
                else if (hCur < 0 && hCur < hPrev) score -= 5;
            }
        }

        // ---------- 4. Bollinger position ----------
        const mid = sma(closes, 20);
        const sd = stddev(closes, 20, mid);
        const upper = mid + 2 * sd, lower = mid - 2 * sd;
        if (last.close <= lower) { score += 10; factors.push('Price at BB lower (mean-reversion long)'); }
        else if (last.close >= upper) { score -= 10; factors.push('Price at BB upper (mean-reversion short)'); }

        // ---------- 5. VWAP position (session-anchored, TradingView standard) ----------
        const vw = (() => {
            if (TechnicalIndicators && TechnicalIndicators.VWAP) {
                const vwapArr = TechnicalIndicators.VWAP(candles);
                const lv = vwapArr[vwapArr.length - 1];
                if (isFinite(lv) && lv > 0) return lv;
            }
            let pv = 0, v = 0;
            const look = Math.min(75, n);  // ~1 session on 5m TF
            for (let i = n - look; i < n; i++) {
                const tp = (candles[i].high + candles[i].low + candles[i].close) / 3;
                pv += tp * (candles[i].volume || 0);
                v += (candles[i].volume || 0);
            }
            return v ? pv / v : last.close;
        })();
        if (last.close > vw) { score += 6; factors.push('Above VWAP (intraday bullish)'); }
        else { score -= 6; factors.push('Below VWAP (intraday bearish)'); }

        // ---------- 6. Last candle momentum ----------
        const body = last.close - last.open;
        const bodyAbs = Math.abs(body);
        const avgBody = (() => {
            let s = 0, c = 0;
            for (let i = Math.max(0, n - 10); i < n; i++) {
                s += Math.abs(candles[i].close - candles[i].open);
                c++;
            }
            return s / Math.max(1, c);
        })();
        if (body > 0 && bodyAbs > avgBody * 1.2) { score += 8; factors.push('Strong bullish momentum candle'); }
        else if (body < 0 && bodyAbs > avgBody * 1.2) { score -= 8; factors.push('Strong bearish momentum candle'); }

        // ---------- 7. Volume confirmation ----------
        const avgVol = sma(vols, 10);
        const volRatio = vols[n - 1] / (avgVol || 1);
        if (volRatio > 1.4 && body > 0) { score += 6; factors.push(`Volume ${volRatio.toFixed(1)}x confirms up move`); }
        else if (volRatio > 1.4 && body < 0) { score -= 6; factors.push(`Volume ${volRatio.toFixed(1)}x confirms down move`); }
        else if (volRatio < 0.6) factors.push(`Low volume (${volRatio.toFixed(1)}x) — chop likely`);

        // ---------- Aggregate ----------
        score = Math.max(-100, Math.min(100, score));
        let direction = 'neutral', confidence = 'low';
        if (score >= 20) direction = 'bull';
        else if (score <= -20) direction = 'bear';
        const abs = Math.abs(score);
        if (abs >= 45) confidence = 'high';
        else if (abs >= 25) confidence = 'med';

        // Top-3 most impactful factors
        return { direction, score, confidence, factors: factors.slice(0, 4) };
    }
}
window.NextCandlePredictor = NextCandlePredictor;
