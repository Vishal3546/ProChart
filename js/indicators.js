/* ===========================================================
 * TechnicalIndicators — v2026.10
 * Robust implementations. Accepts either array of candles
 * ({open,high,low,close,volume,time}) OR array of numbers.
 * Returns array parallel to input (null where insufficient data).
 * =========================================================== */
const TechnicalIndicators = (() => {

    // Helpers
    const toCloses = (data) => {
        if (!data || !data.length) return [];
        if (typeof data[0] === 'number') return data.slice();
        return data.map(d => d.close);
    };
    const toHighs = (data) => {
        if (typeof data[0] === 'number') return data.slice();
        return data.map(d => d.high);
    };
    const toLows = (data) => {
        if (typeof data[0] === 'number') return data.slice();
        return data.map(d => d.low);
    };
    const zeros = (n) => new Array(n).fill(null);

    // ---------- SMA ----------
    function SMA(data, period) {
        const closes = toCloses(data);
        const n = closes.length;
        const out = zeros(n);
        if (period <= 0 || n < period) return out;
        let sum = 0;
        for (let i = 0; i < period; i++) sum += closes[i];
        out[period - 1] = sum / period;
        for (let i = period; i < n; i++) {
            sum += closes[i] - closes[i - period];
            out[i] = sum / period;
        }
        return out;
    }

    // ---------- EMA (Wilder-style uses alpha=2/(period+1)) ----------
    function EMA(data, period) {
        const closes = toCloses(data);
        const n = closes.length;
        const out = zeros(n);
        if (period <= 0 || n < period) return out;
        const k = 2 / (period + 1);
        let sum = 0;
        for (let i = 0; i < period; i++) sum += closes[i];
        out[period - 1] = sum / period;
        for (let i = period; i < n; i++) {
            out[i] = (closes[i] - out[i - 1]) * k + out[i - 1];
        }
        return out;
    }

    // ---------- RSI (Wilder smoothing) ----------
    function RSI(data, period = 14) {
        const closes = toCloses(data);
        const n = closes.length;
        const out = zeros(n);
        if (n <= period) return out;
        let gains = 0, losses = 0;
        for (let i = 1; i <= period; i++) {
            const diff = closes[i] - closes[i - 1];
            if (diff > 0) gains += diff; else losses -= diff;
        }
        let avgG = gains / period, avgL = losses / period;
        out[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
        for (let i = period + 1; i < n; i++) {
            const diff = closes[i] - closes[i - 1];
            const g = diff > 0 ? diff : 0;
            const l = diff < 0 ? -diff : 0;
            avgG = (avgG * (period - 1) + g) / period;
            avgL = (avgL * (period - 1) + l) / period;
            out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
        }
        return out;
    }

    // ---------- Bollinger Bands (middle=SMA, upper/lower = mid ± mult*stdev) ----------
    function BollingerBands(data, period = 20, mult = 2) {
        const closes = toCloses(data);
        const mid = SMA(closes, period);
        const n = closes.length;
        const upper = zeros(n), lower = zeros(n), width = zeros(n);
        for (let i = period - 1; i < n; i++) {
            let s = 0;
            for (let j = 0; j < period; j++) {
                const d = closes[i - j] - mid[i];
                s += d * d;
            }
            const sd = Math.sqrt(s / period);
            upper[i] = mid[i] + mult * sd;
            lower[i] = mid[i] - mult * sd;
            width[i] = (upper[i] - lower[i]) / mid[i]; // %b-width
        }
        return { middle: mid, upper, lower, width };
    }

    // ---------- ATR (Wilder 14-day) ----------
    function ATR(data, period = 14) {
        const n = data.length;
        const out = zeros(n);
        if (n < 2) return out;
        const isObj = typeof data[0] !== 'number';
        const trs = [];
        for (let i = 0; i < n; i++) {
            if (!isObj) { trs.push(0); continue; }
            const h = data[i].high, l = data[i].low, c = i > 0 ? data[i - 1].close : data[i].close;
            const tr = Math.max(h - l, Math.abs(h - c), Math.abs(l - c));
            trs.push(tr);
        }
        let sum = 0;
        for (let i = 1; i <= period; i++) sum += trs[i];
        out[period] = sum / period;
        for (let i = period + 1; i < n; i++) {
            out[i] = (out[i - 1] * (period - 1) + trs[i]) / period;
        }
        return out;
    }

    // ---------- SuperTrend ----------
    function SuperTrend(data, period = 10, mult = 3) {
        const atr = ATR(data, period);
        const n = data.length;
        const out = new Array(n).fill(null);
        const dir = new Array(n).fill(1); // 1=short/bearish-to-bullish flip zone, -1=long
        const isObj = typeof data[0] !== 'number';
        if (!isObj) return out;
        const upper = zeros(n), lower = zeros(n);
        for (let i = 0; i < n; i++) {
            if (atr[i] == null) continue;
            const hl2 = (data[i].high + data[i].low) / 2;
            upper[i] = hl2 + mult * atr[i];
            lower[i] = hl2 - mult * atr[i];
            if (i === period) {
                out[i] = lower[i];
                dir[i] = 1;
                continue;
            }
            if (i < period) continue;
            // Lower band ratchet
            const lb = data[i].close > lower[i - 1] ? Math.max(lower[i], lower[i - 1]) : lower[i];
            // Upper band ratchet
            const ub = data[i].close < upper[i - 1] ? Math.min(upper[i], upper[i - 1]) : upper[i];
            let d = dir[i - 1];
            if (d === -1 && data[i].close < ub) d = 1;
            else if (d === 1 && data[i].close > lb) d = -1;
            out[i] = d === 1 ? lb : ub;
            dir[i] = d;
            lower[i] = lb; upper[i] = ub;
        }
        return { trend: out, dir };
    }

    // ---------- VWAP (daily-anchored, IST session 09:15) ----------
    function VWAP(data) {
        const n = data.length;
        const out = zeros(n);
        if (!n) return out;
        const isObj = typeof data[0] !== 'number';
        let sumPV = 0, sumV = 0, anchorKey = null;
        for (let i = 0; i < n; i++) {
            if (!isObj) { out[i] = data[i]; continue; }
            const d = data[i];
            const ts = typeof d.time === 'number' ? d.time * 1000 : new Date(d.time).getTime();
            const dt = new Date(ts + (5.5 * 3600 * 1000)); // interpret as IST if seconds/ms naive
            const h = dt.getUTCHours(), m = dt.getUTCMinutes();
            // Reset at 09:15 IST (daily session open)
            const key = `${dt.getUTCFullYear()}-${dt.getUTCMonth()}-${dt.getUTCDate()}-${h < 9 || (h === 9 && m < 15) ? 'pre' : 'ses'}`;
            if (key !== anchorKey) { sumPV = 0; sumV = 0; anchorKey = key; }
            const typ = (d.high + d.low + d.close) / 3;
            sumPV += typ * (d.volume || 0);
            sumV += (d.volume || 0);
            out[i] = sumV === 0 ? d.close : sumPV / sumV;
        }
        return out;
    }

    // ---------- MACD ----------
    function MACD(data, fast = 12, slow = 26, signal = 9) {
        const closes = toCloses(data);
        const n = closes.length;
        const fastEma = EMA(closes, fast);
        const slowEma = EMA(closes, slow);
        const macdLine = zeros(n);
        for (let i = 0; i < n; i++) {
            if (fastEma[i] !== null && slowEma[i] !== null)
                macdLine[i] = fastEma[i] - slowEma[i];
        }
        const sigLine = EMA(macdLine, signal);
        const hist = zeros(n);
        for (let i = 0; i < n; i++) {
            if (macdLine[i] !== null && sigLine[i] !== null)
                hist[i] = macdLine[i] - sigLine[i];
        }
        return { macd: macdLine, signal: sigLine, hist };
    }

    // ---------- ATR-derived volatility helpers ----------
    function StDev(data, period) {
        const closes = toCloses(data);
        const n = closes.length;
        const out = zeros(n);
        if (n < period) return out;
        for (let i = period - 1; i < n; i++) {
            let s = 0;
            for (let j = 0; j < period; j++) s += closes[i - j];
            const m = s / period;
            let v = 0;
            for (let j = 0; j < period; j++) v += (closes[i - j] - m) ** 2;
            out[i] = Math.sqrt(v / period);
        }
        return out;
    }

    return { SMA, EMA, RSI, MACD, VWAP, BollingerBands, ATR, SuperTrend, StDev };
})();

window.TechnicalIndicators = TechnicalIndicators;
