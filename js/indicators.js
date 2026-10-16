class TechnicalIndicators {
    static SMA(data, period) {
        const res = new Array(data.length).fill(null);
        if (data.length < period) return res;
        let sum = 0;
        for (let i = 0; i < period; i++) sum += data[i] || 0;
        res[period - 1] = sum / period;
        for (let i = period; i < data.length; i++) {
            sum += (data[i] || 0) - (data[i - period] || 0);
            res[i] = sum / period;
        }
        return res;
    }

    static EMA(data, period) {
        const res = new Array(data.length).fill(null);
        if (data.length < period) return res;
        const k = 2 / (period + 1);
        let sum = 0;
        for (let i = 0; i < period; i++) sum += data[i] || 0;
        res[period - 1] = sum / period;
        for (let i = period; i < data.length; i++) {
            res[i] = ((data[i] || 0) - res[i - 1]) * k + res[i - 1];
        }
        return res;
    }

    static VWAP(candles) {
        let tpv = 0, vol = 0;
        return candles.map(c => {
            const tp = (c.high + c.low + c.close) / 3;
            tpv += tp * (c.volume || 1);
            vol += c.volume || 1;
            return vol > 0 ? tpv / vol : tp;
        });
    }

    static RSI(data, period = 14) {
        const res = new Array(data.length).fill(null);
        if (data.length <= period) return res;
        let gains = 0, losses = 0;
        for (let i = 1; i <= period; i++) {
            const d = data[i] - data[i - 1];
            if (d >= 0) gains += d; else losses -= d;
        }
        let avgG = gains / period, avgL = losses / period;
        res[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
        for (let i = period + 1; i < data.length; i++) {
            const d = data[i] - data[i - 1];
            avgG = (avgG * (period - 1) + (d > 0 ? d : 0)) / period;
            avgL = (avgL * (period - 1) + (d < 0 ? -d : 0)) / period;
            res[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
        }
        return res;
    }

    static MACD(data, fast = 12, slow = 26, signal = 9) {
        const f = this.EMA(data, fast);
        const s = this.EMA(data, slow);
        const macd = data.map((_, i) => f[i] != null && s[i] != null ? f[i] - s[i] : null);
        const valid = macd.map(v => v == null ? 0 : v);
        const sig = this.EMA(valid, signal);
        const hist = macd.map((v, i) => v != null && sig[i] != null ? v - sig[i] : null);
        return { macd, signal: sig, histogram: hist };
    }

    static BollingerBands(data, period = 20, mult = 2) {
        const mid = this.SMA(data, period);
        const upper = new Array(data.length).fill(null);
        const lower = new Array(data.length).fill(null);
        for (let i = period - 1; i < data.length; i++) {
            let ss = 0;
            for (let j = i - period + 1; j <= i; j++) {
                const d = (data[j] || 0) - mid[i];
                ss += d * d;
            }
            const sd = Math.sqrt(ss / period);
            upper[i] = mid[i] + mult * sd;
            lower[i] = mid[i] - mult * sd;
        }
        return { upper, middle: mid, lower };
    }

    // Audit Fix: Real ADX with Wilder's Smoothing
    static ADX(candles, period = 14) {
        if (candles.length < period * 2) return null;
        const tr = [], plusDM = [], minusDM = [];
        for (let i = 1; i < candles.length; i++) {
            const h = candles[i].high, l = candles[i].low;
            const ph = candles[i-1].high, pl = candles[i-1].low, pc = candles[i-1].close;
            tr.push(Math.max(h-l, Math.abs(h-pc), Math.abs(l-pc)));
            const upMove = h - ph, downMove = pl - l;
            plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
            minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
        }
        // Wilder's Smoothing
        const smooth = (arr, p) => {
            const out = [];
            let s = 0;
            for (let i = 0; i < p; i++) s += arr[i];
            out.push(s);
            for (let i = p; i < arr.length; i++) {
                s = s - (s / p) + arr[i];
                out.push(s);
            }
            return out;
        };
        const trS = smooth(tr, period);
        const pDMS = smooth(plusDM, period);
        const mDMS = smooth(minusDM, period);
        const plusDI = pDMS.map((v, i) => trS[i] > 0 ? (v / trS[i]) * 100 : 0);
        const minusDI = mDMS.map((v, i) => trS[i] > 0 ? (v / trS[i]) * 100 : 0);
        const dx = plusDI.map((v, i) => {
            const sum = v + minusDI[i];
            return sum > 0 ? Math.abs(v - minusDI[i]) / sum * 100 : 0;
        });
        if (dx.length < period) return null;
        let adxSum = 0;
        for (let i = 0; i < period; i++) adxSum += dx[i];
        const adx = [adxSum / period];
        for (let i = period; i < dx.length; i++) {
            adx.push((adx[adx.length-1] * (period-1) + dx[i]) / period);
        }
        return adx[adx.length - 1];
    }
}