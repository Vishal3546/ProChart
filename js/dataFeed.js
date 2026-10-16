class DataFeed {
    constructor() {
        const host = window.location.hostname || '127.0.0.1';
        this.baseUrl = `${window.location.protocol}//${host}:8000`;
    }

    async fetchCandles(symbol = 'NIFTY', timeframe = '15') {
        return await this.fetchCandleData(symbol, timeframe);
    }

    async fetchCandleData(symbol = 'NIFTY', timeframe = '15') {
        try {
            const url = `${this.baseUrl}/api/candles?symbol=${encodeURIComponent(symbol)}&interval=${timeframe}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            
            let candles = [];
            if (Array.isArray(data)) candles = data;
            else if (data.status && Array.isArray(data.data)) candles = data.data;

            if (candles.length > 0) return this.formatCandles(candles);
            return this.generateFallbackCandles(timeframe);
        } catch (err) {
            console.warn("API candle fetch failed, using fallback generator:", err.message);
            return this.generateFallbackCandles(timeframe);
        }
    }

    async fetchLiveQuote(symbol = 'NIFTY') {
        try {
            const url = `${this.baseUrl}/api/quote?symbol=${encodeURIComponent(symbol)}`;
            const res = await fetch(url);
            if (!res.ok) return null;
            return await res.json();
        } catch (err) {
            return null;
        }
    }

    formatCandles(rawCandles) {
        return rawCandles.map(c => ({
            time: c.time || c[0],
            open: parseFloat(c.open !== undefined ? c.open : c[1]),
            high: parseFloat(c.high !== undefined ? c.high : c[2]),
            low: parseFloat(c.low !== undefined ? c.low : c[3]),
            close: parseFloat(c.close !== undefined ? c.close : c[4]),
            volume: parseFloat(c.volume !== undefined ? c.volume : (c[5] || 1000))
        }));
    }

    generateFallbackCandles(tf = '15') {
        const count = 150;
        let candles = [];
        let basePrice = 22668;
        const now = new Date();
        const tfMsMap = { '1': 60000, '3': 180000, '5': 300000, '15': 900000, '30': 1800000, '60': 3600000, 'D': 86400000 };
        const stepMs = tfMsMap[tf] || 900000;
        let startTime = new Date(now.getTime() - (count * stepMs));

        for (let i = 0; i < count; i++) {
            let currentTs = new Date(startTime.getTime() + (i * stepMs)).toISOString();
            let open = basePrice + (Math.random() - 0.49) * 15;
            let high = open + Math.random() * 20;
            let low = open - Math.random() * 20;
            let close = low + Math.random() * (high - low);
            let volume = Math.floor(Math.random() * 8000) + 2000;
            basePrice = close;

            candles.push({
                time: currentTs,
                open: parseFloat(open.toFixed(2)),
                high: parseFloat(high.toFixed(2)),
                low: parseFloat(low.toFixed(2)),
                close: parseFloat(close.toFixed(2)),
                volume: volume
            });
        }
        return candles;
    }
}
window.DataFeed = DataFeed;
