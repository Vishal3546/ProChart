// DataFeed with Angel One Live LTP
class DataFeed {
    constructor() {
        this.backendUrl = "http://127.0.0.1:8000";
        this.currentSymbol = "NIFTY";
        this.currentToken = "99926000";
        this.currentExchange = "NSE";
        this.currentInterval = "15";
        this.isAngelConnected = false;
        this.checkBackendStatus();
    }

    async checkBackendStatus() {
        try {
            const res = await fetch(`${this.backendUrl}/api/status`);
            const data = await res.json();
            this.isAngelConnected = data.angel_connected;
            console.log("Backend:", data);
        } catch (e) {
            console.warn("Backend offline");
        }
    }

    async searchSymbols(query) {
        try {
            const res = await fetch(`${this.backendUrl}/api/search?q=${encodeURIComponent(query)}`);
            const data = await res.json();
            return data.results || [];
        } catch (e) {
            console.error("Search error:", e);
            return [];
        }
    }

    async fetchCandleData(symbol, token, exchange = "NSE", interval = "15") {
        this.currentSymbol = symbol;
        this.currentToken = token;
        this.currentExchange = exchange;
        this.currentInterval = interval;

        try {
            const url = `${this.backendUrl}/api/candles?symbol=${symbol}&token=${token}&exchange=${exchange}&interval=${interval}`;
            const res = await fetch(url);
            const data = await res.json();
            if (data.status === "success" && data.candles && data.candles.length > 0) {
                console.log(`Loaded ${data.candles.length} candles from ${data.source}`);
                return data.candles;
            }
        } catch (e) {
            console.error("Candle Fetch Error:", e);
        }
        return [];
    }

    async fetchLiveQuote() {
        try {
            const res = await fetch(`${this.backendUrl}/api/quote?exchange=${this.currentExchange}&token=${this.currentToken}`);
            return await res.json();
        } catch (e) {
            return null;
        }
    }

    generateData(count = 150) {
        return this.generateFallbackCandles(count);
    }

    generateFallbackCandles(count = 150) {
        const data = [];
        let p = 22500;
        const now = Date.now();
        for (let i = count; i >= 0; i--) {
            const change = (Math.random() - 0.48) * 15;
            const o = p, c = o + change;
            const h = Math.max(o, c) + Math.random() * 5;
            const l = Math.min(o, c) - Math.random() * 5;
            p = c;
            data.push({
                time: now - i * 900000,
                open: parseFloat(o.toFixed(2)),
                high: parseFloat(h.toFixed(2)),
                low: parseFloat(l.toFixed(2)),
                close: parseFloat(c.toFixed(2)),
                volume: Math.round(100000 + Math.random() * 400000)
            });
        }
        return data;
    }

    generateLiveTick(lastCandle) {
        const tick = (Math.random() - 0.49) * (lastCandle.close * 0.0002);
        const newClose = parseFloat((lastCandle.close + tick).toFixed(2));
        lastCandle.close = newClose;
        lastCandle.high = Math.max(lastCandle.high, newClose);
        lastCandle.low = Math.min(lastCandle.low, newClose);
        lastCandle.volume += Math.round(Math.random() * 500);
        return lastCandle;
    }
}