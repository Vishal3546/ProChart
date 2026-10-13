class TechnicalIndicators {
    static SMA(data, period) {
        const res = new Array(data.length).fill(null);
        if (data.length < period) return res;
        let sum = 0;
        for (let i = 0; i < period; i++) sum += (data[i] || 0);
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
        const mult = 2 / (period + 1);
        let sum = 0;
        for (let i = 0; i < period; i++) sum += (data[i] || 0);
        res[period - 1] = sum / period;
        for (let i = period; i < data.length; i++) {
            res[i] = ((data[i] || 0) - res[i - 1]) * mult + res[i - 1];
        }
        return res;
    }

    static VWAP(candles) {
        let cumTPV = 0, cumVol = 0;
        return candles.map(c => {
            const tp = (c.high + c.low + c.close) / 3;
            cumTPV += tp * (c.volume || 1);
            cumVol += (c.volume || 1);
            return cumVol > 0 ? cumTPV / cumVol : tp;
        });
    }

    static RSI(data, period = 14) {
        const res = new Array(data.length).fill(null);
        if (data.length < period + 1) return res;
        let gains = 0, losses = 0;
        for (let i = 1; i <= period; i++) {
            const diff = data[i] - data[i - 1];
            if (diff >= 0) gains += diff; else losses -= diff;
        }
        let avgGain = gains / period, avgLoss = losses / period;
        res[period] = 100 - (100 / (1 + (avgLoss === 0 ? 100 : avgGain / avgLoss)));
        for (let i = period + 1; i < data.length; i++) {
            const diff = data[i] - data[i - 1];
            avgGain = (avgGain * (period - 1) + (diff >= 0 ? diff : 0)) / period;
            avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
            res[i] = 100 - (100 / (1 + (avgLoss === 0 ? 100 : avgGain / avgLoss)));
        }
        return res;
    }

    static MACD(data, fast = 12, slow = 26, signal = 9) {
        const fEMA = this.EMA(data, fast), sEMA = this.EMA(data, slow);
        const macdLine = data.map((_, i) => (fEMA[i] !== null && sEMA[i] !== null) ? fEMA[i] - sEMA[i] : null);
        const validMACD = macdLine.filter(v => v !== null);
        const signalEMA = this.EMA(validMACD, signal);
        const signalLine = new Array(data.length).fill(null);
        let validIdx = 0;
        for (let i = 0; i < data.length; i++) {
            if (macdLine[i] !== null) { signalLine[i] = signalEMA[validIdx++]; }
        }
        const histogram = data.map((_, i) => (macdLine[i] !== null && signalLine[i] !== null) ? macdLine[i] - signalLine[i] : null);
        return { macd: macdLine, signal: signalLine, histogram };
    }

    static BollingerBands(data, period = 20, stdDevMult = 2) {
        const sma = this.SMA(data, period);
        const upper = new Array(data.length).fill(null);
        const lower = new Array(data.length).fill(null);
        for (let i = period - 1; i < data.length; i++) {
            let sumSq = 0;
            for (let j = i - period + 1; j <= i; j++) sumSq += Math.pow(data[j] - sma[i], 2);
            const std = Math.sqrt(sumSq / period);
            upper[i] = sma[i] + stdDevMult * std;
            lower[i] = sma[i] - stdDevMult * std;
        }
        return { upper, middle: sma, lower };
    }
}