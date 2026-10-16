/* ===========================================================
 * TechnicalIndicators — v2026.10
 * Robust null-safe implementations for OHLC candle arrays.
 * =========================================================== */
const TechnicalIndicators = (() => {

    const isNum = n => typeof n === 'number' && !isNaN(n) && isFinite(n);

    const toCloses = (data) => {
        if (!data || !data.length) return [];
        if (typeof data[0] === 'number') return data.map(v => isNum(v) ? v : null);
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

    function SMA(data, period) {
        const closes = toCloses(data);
        const n = closes.length;
        const out = zeros(n);
        if (period <= 0 || n < period) return out;
        const window = [];
        for (let i = 0; i < n; i++) {
            if (closes[i] != null) window.push(closes[i]);
            if (window.length > period) window.shift();
            if (window.length === period) out[i] = window.reduce((a, b) => a + b, 0) / period;
        }
        return out;
    }

    function EMA(data, period) {
        const closes = toCloses(data);
        const n = closes.length;
        const out = zeros(n);
        if (period <= 0 || n < period) return out;
        const k = 2 / (period + 1);
        let sum = 0, counted = 0, i = 0;
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

    function BollingerBands(data, period = 20, mult = 2) {
        const closes = toCloses(data);
        const mid = SMA(closes, period);
        const n = closes.length;
        const upper = zeros(n), lower = zeros(n), width = zeros(n);
        for (let i = period - 1; i < n; i++) {
            if (mid[i] == null) continue;
            let s = 0, valid = 0;
            for (let j = 0; j < period; j++) {
                if (closes[i - j] == null) continue;
                const d = closes[i - j] - mid[i];
                s += d * d; valid++;
            }
            if (valid < period) continue;
            const sd = Math.sqrt(s / valid);
            upper[i] = mid[i] + mult * sd;
            lower[i] = mid[i] - mult * sd;
            width[i] = mid[i] ? (upper[i] - lower[i]) / mid[i] : null;
        }
        return { middle: mid, upper, lower, width };
    }

    function ATR(data, period = 14) {
        const n = data.length;
        const out = zeros(n);
        if (n < 2) return out;
        const isObj = typeof data[0] !== 'number';
        const trs = [];
        for (let i = 0; i < n; i++) {
            if (!isObj) { trs.push(0); continue; }
            if (data[i].high == null || data[i].low == null) { trs.push(null); continue; }
            const prevC = i > 0 && data[i - 1].close != null ? data[i - 1].close : data[i].close;
            const h = data[i].high, l = data[i].low;
            trs.push(Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC)));
        }
        let sum = 0, counted = 0;
        for (let i = 1; i < Math.min(n, period + 1); i++) {
            if (trs[i] != null) { sum += trs[i]; counted++; }
        }
        if (counted === 0) return out;
        out[period] = sum / counted;
        for (let i = period + 1; i < n; i++) {
            if (trs[i] == null || out[i - 1] == null) { out[i] = out[i - 1]; continue; }
            out[i] = (out[i - 1] * (period - 1) + trs[i]) / period;
        }
        return out;
    }

    function SuperTrend(data, period = 10, mult = 3) {
        const atr = ATR(data, period);
        const n = data.length;
        const out = new Array(n).fill(null);
        const dir = new Array(n).fill(1);
        if (n < period + 1 || typeof data[0] === 'number') return { trend: out, dir };
        const upper = zeros(n), lower = zeros(n);
        for (let i = 0; i < n; i++) {
            if (atr[i] == null || data[i].high == null || data[i].low == null) continue;
            const hl2 = (data[i].high + data[i].low) / 2;
            upper[i] = hl2 + mult * atr[i];
            lower[i] = hl2 - mult * atr[i];
            if (i < period) continue;
            if (i === period) { out[i] = lower[i]; dir[i] = 1; continue; }
            const lb = data[i].close > lower[i - 1] ? Math.max(lower[i], lower[i - 1]) : lower[i];
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

    function VWAP(data) {
        const n = data.length;
        const out = zeros(n);
        if (!n) return out;
        const isObj = typeof data[0] !== 'number';
        let sumPV = 0, sumV = 0, anchorKey = null;
        for (let i = 0; i < n; i++) {
            if (!isObj) { out[i] = data[i]; continue; }
            const d = data[i];
            if (d.high == null || d.low == null || d.close == null) { out[i] = i > 0 ? out[i - 1] : null; continue; }
            const ts = typeof d.time === 'number' ? d.time * 1000 : new Date(d.time).getTime();
            const dt = new Date(ts + 5.5 * 3600 * 1000);
            const h = dt.getUTCHours(), m = dt.getUTCMinutes();
            const key = `${dt.getUTCFullYear()}-${dt.getUTCMonth()}-${dt.getUTCDate()}-${h < 9 || (h === 9 && m < 15) ? 'pre' : 'ses'}`;
            if (key !== anchorKey) { sumPV = 0; sumV = 0; anchorKey = key; }
            const typ = (d.high + d.low + d.close) / 3;
            sumPV += typ * (d.volume || 0);
            sumV += (d.volume || 0);
            out[i] = sumV === 0 ? d.close : sumPV / sumV;
        }
        return out;
    }

    function MACD(data, fast = 12, slow = 26, signal = 9) {
        const closes = toCloses(data);
        const n = closes.length;
        const fastEma = EMA(closes, fast);
        const slowEma = EMA(closes, slow);
        const macdLine = zeros(n);
        for (let i = 0; i < n; i++) {
            if (fastEma[i] != null && slowEma[i] != null) macdLine[i] = fastEma[i] - slowEma[i];
        }
        const sigLine = EMA(macdLine, signal);
        const hist = zeros(n);
        for (let i = 0; i < n; i++) {
            if (macdLine[i] != null && sigLine[i] != null) hist[i] = macdLine[i] - sigLine[i];
        }
        return { macd: macdLine, signal: sigLine, hist };
    }

    function StDev(data, period) {
        const closes = toCloses(data);
        const n = closes.length;
        const out = zeros(n);
        if (n < period) return out;
        for (let i = period - 1; i < n; i++) {
            let s = 0, valid = 0;
            for (let j = 0; j < period; j++) {
                if (closes[i - j] != null) { s += closes[i - j]; valid++; }
            }
            if (valid < period) continue;
            const m = s / valid;
            let v = 0;
            for (let j = 0; j < period; j++) {
                if (closes[i - j] != null) v += (closes[i - j] - m) ** 2;
            }
            out[i] = Math.sqrt(v / valid);
        }
        return out;
    }

    return { SMA, EMA, RSI, MACD, VWAP, BollingerBands, ATR, SuperTrend, StDev };
})();

window.TechnicalIndicators = TechnicalIndicators;