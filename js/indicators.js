/* ===========================================================
 * TechnicalIndicators — v2026.10
 * Robust implementations. Accepts either array of candles
 * ({open,high,low,close,volume,time}) OR array of numbers.
 * Returns array parallel to input (null where insufficient data).
 * =========================================================== */
const TechnicalIndicators = (() => {

    // Helpers — null-safe (Angel One kabhi-kabhi incomplete last candle bhejta hai)
    const isNum = n => typeof n === 'number' && !isNaN(n) && isFinite(n);
    const toCloses = (data) => {
        if (!data || !data.length) return [];
        if (typeof data[0] === 'number') {
            return data.map(v => isNum(v) ? v : null);
        }
        return data.map(d => (d && isNum(d.close)) ? d.close : null);
    };
    const toHighs = (data) => {
        if (!data || !data.length) return [];
        if (typeof data[0] === 'number') return data.map(v => isNum(v) ? v : null);
        return data.map(d => (d && isNum(d.high)) ? d.high : null);
    };
    const toLows = (data) => {
        if (!data || !data.length) return [];
        if (typeof data[0] === 'number') return data.map(v => isNum(v) ? v : null);
        return data.map(d => (d && isNum(d.low)) ? d.low : null);
    };
    const zeros = (n) => new Array(n).fill(null);

    // (removed dead code: replaceLeadingNulls was defined but never called)

    // ---------- SMA (null-safe) ----------
    function SMA(data, period) {
        const closes = toCloses(data);
        const n = closes.length;
        const out = zeros(n);
        if (period <= 0 || n < period) return out;
        let window = [];
        for (let i = 0; i < n; i++) {
            if (closes[i] != null) window.push(closes[i]);
            if (window.length > period) window.shift();
            if (window.length === period) out[i] = window.reduce((a, b) => a + b, 0) / period;
        }
        return out;
    }

    // ---------- EMA (Wilder-style uses alpha=2/(period+1)) — null-safe ----------
    function EMA(data, period) {
        const closes = toCloses(data);
        const n = closes.length;
        const out = zeros(n);
        if (period <= 0 || n < period) return out;
        const k = 2 / (period + 1);
        let sum = 0, counted = 0, i = 0;
        // gather first `period` valid closes
        for (; i < n && counted < period; i++) {
            if (closes[i] != null) { sum += closes[i]; counted++; }
        }
        if (counted < period) return out;
        out[i - 1] = sum / period;
        let prev = out[i - 1];
        for (; i < n; i++) {
            if (closes[i] == null) { out[i] = prev; continue; }
            const v = (closes[i] - prev) * k + prev;
            out[i] = v;
            prev = v;
        }
        return out;
    }

    // ---------- RSI (Wilder smoothing, null-safe) ----------
    function RSI(data, period = 14) {
        const closes = toCloses(data);
        const n = closes.length;
        const out = zeros(n);
        if (n <= period) return out;
        let avgG = null, avgL = null, prevClose = null;
        let gains = 0, losses = 0, diffCount = 0;
        for (let i = 0; i < n; i++) {
            if (closes[i] == null) continue;
            if (prevClose == null) { prevClose = closes[i]; continue; }
            const diff = closes[i] - prevClose;
            const g = diff > 0 ? diff : 0;
            const l = diff < 0 ? -diff : 0;
            if (avgG == null) {
                // seed phase
                gains += g; losses += l; diffCount++;
                if (diffCount === period) {
                    avgG = gains / period; avgL = losses / period;
                    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
                }
            } else {
                avgG = (avgG * (period - 1) + g) / period;
                avgL = (avgL * (period - 1) + l) / period;
                out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
            }
            prevClose = closes[i];
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

    // ---------- SuperTrend (ratcheted bands, single color at a time) ----------
    function SuperTrend(data, period = 10, mult = 3) {
        const atr = ATR(data, period);
        const n = data.length;
        const out = new Array(n).fill(null);
        const dir = new Array(n).fill(0);
        if (n < period + 1 || typeof data[0] === 'number') return { trend: out, dir };

        let prevUb = null, prevLb = null, prevDir = 0, prevSt = null, seeded = false;
        for (let i = 0; i < n; i++) {
            if (atr[i] == null || data[i].high == null || data[i].low == null || data[i].close == null) {
                if (seeded) { out[i] = prevSt; dir[i] = prevDir; }
                continue;
            }
            const hl2 = (data[i].high + data[i].low) / 2;
            const ub = hl2 + mult * atr[i];
            const lb = hl2 - mult * atr[i];
            if (!seeded) {
                if (i < period) continue;
                prevUb = ub; prevLb = lb;
                prevDir = data[i].close > hl2 ? -1 : 1;  // -1=uptrend (below price), +1=downtrend (above)
                prevSt = prevDir === -1 ? lb : ub;
                out[i] = prevSt; dir[i] = prevDir; seeded = true;
                continue;
            }
            // Ratchet
            const curLb = data[i].close > prevLb ? Math.max(lb, prevLb) : lb;
            const curUb = data[i].close < prevUb ? Math.min(ub, prevUb) : ub;
            let d = prevDir;
            if (prevDir === -1 && data[i].close < curLb) d = 1;        // flip to downtrend
            else if (prevDir === 1 && data[i].close > curUb) d = -1;  // flip to uptrend
            const st = d === -1 ? curLb : curUb;
            out[i] = st; dir[i] = d;
            prevUb = curUb; prevLb = curLb; prevDir = d; prevSt = st;
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
