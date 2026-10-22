/* ============================================================
 * trendBiasEngine.js — Composite Long/Short Bias Scanner
 * ============================================================
 * Weighs the key intraday confluence conditions the user specified
 * plus a couple of confirmation factors to produce a single
 * action-friendly bias score and badge.
 *
 *  Core rules (user's):
 *   + Price >= VWAP           → +1  (bullish)
 *   + EMA20  > EMA50          → +1
 *   + RSI(14) > 50            → +1
 *   - opposite of above       → -1 each
 *
 *  Confirmation (weighted 0.5 each):
 *   + MACD hist > 0           → +0.5
 *   + Price above EMA20       → +0.5
 *   + SuperTrend buy signal   → +0.5
 *
 *  Score ranges (roughly -4 to +4):
 *    ≥ +2.0  → STRONG LONG
 *    ≥ +1.0  → LONG BIAS
 *    ≥ -1.0  → NEUTRAL / CHOP
 *    ≥ -2.0  → SHORT BIAS
 *    < -2.0  → STRONG SHORT
 * ============================================================ */
class TrendBiasEngine {
    analyze(candles) {
        const def = {
            score: 0, label: 'NEUTRAL', level: 'muted', bias: 'neutral',
            factors: { vwap: 0, ema: 0, rsi: 0, macd: 0, pxema: 0, st: 0 },
        };
        if (!candles || candles.length < 30) return def;

        const n = candles.length;
        const closes = candles.map(c => c.close);
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const vols = candles.map(c => c.volume || 0);

        // EMA20 / EMA50
        const ema20 = this._ema(closes, 20);
        const ema50 = this._ema(closes, 50);
        const lastClose = closes[n - 1];

        // VWAP (session, anchored at first bar in dataset — good for intraday)
        let pv = 0, v = 0;
        for (let i = 0; i < n; i++) {
            const tp = (highs[i] + lows[i] + closes[i]) / 3;
            pv += tp * vols[i];
            v += vols[i];
        }
        const vwap = v ? pv / v : lastClose;

        // RSI (returns numeric array; early bars = 0 → treat as 50 neutral)
        const rsiArr = TechnicalIndicators.RSI(candles, 14);
        let rsi = rsiArr.length ? rsiArr[rsiArr.length - 1] : 50;
        if (!isFinite(rsi) || rsi <= 0 || rsi >= 100) rsi = 50;

        // MACD histogram
        const macd = TechnicalIndicators.MACD(candles);
        const macdHist = (macd && macd.hist.length) ? macd.hist[macd.hist.length - 1] : 0;

        // SuperTrend (simplified, 10-period, 3x ATR)
        const st = this._supertrend(candles, 10, 3);

        let score = 0;
        const factors = {};
        factors.vwap  = lastClose >= vwap ? 1 : -1;
        factors.ema   = ema20 > ema50 ? 1 : -1;
        factors.rsi   = rsi > 50 ? 1 : (rsi < 50 ? -1 : 0);
        factors.macd  = macdHist > 0 ? 0.5 : (macdHist < 0 ? -0.5 : 0);
        factors.pxema = lastClose >= ema20 ? 0.5 : -0.5;
        factors.st    = st && st.direction === 'buy' ? 0.5 : (st && st.direction === 'sell' ? -0.5 : 0);
        score = factors.vwap + factors.ema + factors.rsi + factors.macd + factors.pxema + factors.st;

        let label, level, bias;
        const bearCount = Object.values(factors).filter(v => v < 0).length;
        const bullCount = Object.values(factors).filter(v => v > 0).length;
        // Strong requires high score AND ZERO major bearish factors (RSI/EMA/VWAP all aligned).
        // 1 minor bearish (e.g. RSI<50 but everything else bullish) → demote to "LONG BIAS" not "STRONG".
        if (score >= 2.5 && factors.rsi >= 0 && factors.vwap >= 0 && factors.ema >= 0) {
            label = '🟢 STRONG LONG'; level = 'success'; bias = 'bull';
        } else if (score >= 1.5) {
            label = '🟢 LONG BIAS'; level = 'success'; bias = 'bull';
        } else if (score <= -2.5 && factors.rsi <= 0 && factors.vwap <= 0 && factors.ema <= 0) {
            label = '🔴 STRONG SHORT'; level = 'danger'; bias = 'bear';
        } else if (score <= -1.5) {
            label = '🔴 SHORT BIAS'; level = 'danger'; bias = 'bear';
        } else {
            label = '⚪ NEUTRAL / CHOP'; level = 'muted'; bias = 'neutral';
        }

        return { score, label, level, bias, factors, ema20, ema50, vwap, rsi, macdHist, st };
    }

    _ema(arr, p) {
        const k = 2 / (p + 1);
        let e = arr[0];
        for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
        return e;
    }

    _atr(candles, p) {
        const trs = [];
        for (let i = 1; i < candles.length; i++) {
            const c = candles[i], pc = candles[i - 1];
            const tr = Math.max(
                c.high - c.low,
                Math.abs(c.high - pc.close),
                Math.abs(c.low - pc.close)
            );
            trs.push(tr);
        }
        let atr = trs.slice(0, p).reduce((s, v) => s + v, 0) / p;
        for (let i = p; i < trs.length; i++) atr = (atr * (p - 1) + trs[i]) / p;
        return atr;
    }

    _supertrend(candles, p = 10, mult = 3) {
        if (candles.length < p + 1) return null;
        const atr = this._atr(candles, p);
        const last = candles[candles.length - 1];
        const hl2 = (last.high + last.low) / 2;
        const upper = hl2 + mult * atr;
        const lower = hl2 - mult * atr;
        const dir = last.close > upper ? 'buy' : last.close < lower ? 'sell' : 'none';
        return { upper, lower, direction: dir };
    }
}
window.TrendBiasEngine = TrendBiasEngine;
