/* ============================================================
 * trendBiasEngine.js — Composite Long/Short Bias Scanner (v2026.10)
 * v42: Bulletproof null-safety, defensive parses, guaranteed shape
 * ============================================================ */
class TrendBiasEngine {
    analyze(candles) {
        const def = {
            score: 0, label: '⚪ NEUTRAL / CHOP', level: 'muted', bias: 'neutral',
            factors: { vwap: 0, ema: 0, rsi: 0, macd: 0, pxema: 0, st: 0 },
            ema20: 0, ema50: 0, vwap: 0, rsi: 50, macdHist: 0, st: null
        };
        if (!candles || !Array.isArray(candles) || candles.length < 15) return def;

        const n = candles.length;
        const closes = candles.map(c => Number(c.close) || 0);
        const highs = candles.map(c => Number(c.high) || 0);
        const lows = candles.map(c => Number(c.low) || 0);
        const vols = candles.map(c => Number(c.volume) || 0);

        const lastClose = closes[n - 1] || 0;
        if (lastClose <= 0) return def;

        const ema20 = this._ema(closes, 20);
        const ema50 = this._ema(closes, 50);

        // Session-anchored / Fallback VWAP
        let vwap = lastClose;
        if (window.TechnicalIndicators && typeof window.TechnicalIndicators.VWAP === 'function') {
            try {
                const vwapArr = window.TechnicalIndicators.VWAP(candles) || [];
                const lv = vwapArr.length ? vwapArr[vwapArr.length - 1] : null;
                if (lv != null && isFinite(lv) && lv > 0) vwap = lv;
            } catch (_) {}
        } else {
            let pv = 0, v = 0;
            const lookback = Math.min(75, n);
            for (let i = n - lookback; i < n; i++) {
                const tp = (highs[i] + lows[i] + closes[i]) / 3;
                pv += tp * vols[i];
                v += vols[i];
            }
            vwap = v > 0 ? pv / v : lastClose;
        }

        // RSI — defensive: can return raw number OR object with .value
        let rsi = 50;
        if (window.TechnicalIndicators && typeof window.TechnicalIndicators.RSI === 'function') {
            try {
                const rsiArr = window.TechnicalIndicators.RSI(candles, 14) || [];
                const rsiRaw = rsiArr.length ? rsiArr[rsiArr.length - 1] : null;
                const val = (rsiRaw != null && typeof rsiRaw === 'object') ? rsiRaw.value : rsiRaw;
                if (val != null && isFinite(val) && val > 0 && val < 100) rsi = val;
            } catch (_) {}
        }

        // MACD
        let macdHist = 0;
        if (window.TechnicalIndicators && typeof window.TechnicalIndicators.MACD === 'function') {
            try {
                const macd = window.TechnicalIndicators.MACD(candles);
                if (macd && macd.hist && macd.hist.length) {
                    const h = macd.hist[macd.hist.length - 1];
                    if (h != null && isFinite(h)) macdHist = h;
                }
            } catch (_) {}
        }

        const st = this._supertrend(candles, 10, 3);

        const factors = {
            vwap:  lastClose >= vwap ? 1 : -1,
            ema:   ema20 > ema50 ? 1 : -1,
            rsi:   rsi > 50 ? 1 : (rsi < 50 ? -1 : 0),
            macd:  macdHist > 0 ? 0.5 : (macdHist < 0 ? -0.5 : 0),
            pxema: lastClose >= ema20 ? 0.5 : -0.5,
            st:    st && st.direction === 'buy' ? 0.5 : (st && st.direction === 'sell' ? -0.5 : 0)
        };

        const score = factors.vwap + factors.ema + factors.rsi + factors.macd + factors.pxema + factors.st;

        let label, level, bias;
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
        if (!arr || !arr.length) return 0;
        const k = 2 / (p + 1);
        let e = arr[0] || 0;
        for (let i = 1; i < arr.length; i++) e = (arr[i] || 0) * k + e * (1 - k);
        return e;
    }

    _atr(candles, p) {
        if (!candles || candles.length < 2) return 0;
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
        if (trs.length === 0) return 0;
        const effP = Math.min(p, trs.length);
        let atr = trs.slice(0, effP).reduce((s, v) => s + v, 0) / effP;
        for (let i = effP; i < trs.length; i++) atr = (atr * (effP - 1) + trs[i]) / effP;
        return atr;
    }

    _supertrend(candles, p = 10, mult = 3) {
        if (!candles || candles.length < p + 1) return null;
        const atr = this._atr(candles, p);
        if (!isFinite(atr) || atr <= 0) return null;
        const last = candles[candles.length - 1];
        const hl2 = (Number(last.high) + Number(last.low)) / 2;
        const upper = hl2 + mult * atr;
        const lower = hl2 - mult * atr;
        const dir = Number(last.close) > upper ? 'buy' : Number(last.close) < lower ? 'sell' : 'none';
        return { upper, lower, direction: dir };
    }
}
window.TrendBiasEngine = TrendBiasEngine;
