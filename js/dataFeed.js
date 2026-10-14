// ============================================
// ProChart Terminal™ - Real Data Feed Engine
// Connects UI to Python FastAPI + Angel One SmartAPI
// ============================================

class DataFeed {
    constructor() {
        this.backendUrl = "http://127.0.0.1:8000";
        this.wsUrl = "ws://127.0.0.1:8000/ws/live";
        this.currentSymbol = "NIFTY";
        this.currentToken = "99926000";
        this.currentInterval = "15";
        this.ws = null;
        this.isAngelConnected = false;
        
        this.symbols = {
            'NIFTY': { name: 'NIFTY 50', base: 22548.16, token: '99926000', exchange: 'NSE' },
            'BANKNIFTY': { name: 'BANK NIFTY', base: 48200.50, token: '99926009', exchange: 'NSE' },
            'RELIANCE': { name: 'RELIANCE INDUSTRIES', base: 2950.00, token: '2885', exchange: 'NSE' },
            'HDFCBANK': { name: 'HDFC BANK LTD', base: 1450.25, token: '1333', exchange: 'NSE' },
            'TCS': { name: 'TATA CONSULTANCY SERV LT', base: 3980.10, token: '11536', exchange: 'NSE' },
            'INFY': { name: 'INFOSYS LTD', base: 1520.45, token: '1594', exchange: 'NSE' },
            'SBIN': { name: 'STATE BANK OF INDIA', base: 780.30, token: '3045', exchange: 'NSE' },
            'ICICIBANK': { name: 'ICICI BANK LTD', base: 1080.70, token: '4963', exchange: 'NSE' },
            'TATAMOTORS': { name: 'TATA MOTORS LIMITED', base: 950.60, token: '3456', exchange: 'NSE' },
            'ITC': { name: 'ITC LIMITED', base: 420.80, token: '1660', exchange: 'NSE' }
        };

        this.checkBackendStatus();
    }

    async checkBackendStatus() {
        try {
            const res = await fetch(`${this.backendUrl}/api/status`);
            const data = await res.json();
            this.isAngelConnected = data.angel_connected;
            console.log("🔌 ProChart Backend Connected! Status:", data);
        } catch (e) {
            console.warn("⚠️ Python Server offline on http://127.0.0.1:8000. Running in local mode.");
        }
    }

    async searchSymbols(query) {
        try {
            const res = await fetch(`${this.backendUrl}/api/search?q=${encodeURIComponent(query)}`);
            const data = await res.json();
            if (data.results && data.results.length > 0) {
                return data.results;
            }
        } catch (e) {
            console.error("Symbol Search Error:", e);
        }

        // Fallback local search
        return Object.entries(this.symbols)
            .filter(([key, val]) => key.toLowerCase().includes(query.toLowerCase()) || val.name.toLowerCase().includes(query.toLowerCase()))
            .map(([key, val]) => ({ symbol: key, name: val.name, token: val.token, exchange: val.exchange, price: val.base }));
    }

    async fetchCandleData(symbol = this.currentSymbol, token = this.currentToken, interval = this.currentInterval) {
        this.currentSymbol = symbol;
        this.currentToken = token;
        this.currentInterval = interval;

        try {
            const res = await fetch(`${this.backendUrl}/api/candles?symbol=${symbol}&token=${token}&interval=${interval}`);
            const data = await res.json();
            if (data.status === "success" && data.candles && data.candles.length > 0) {
                console.log(`✅ Loaded ${data.candles.length} Candles from ${data.source}`);
                return data.candles;
            }
        } catch (e) {
            console.error("Candle Fetch Error:", e);
        }

        return this.generateFallbackCandles();
    }

    generateFallbackCandles() {
        const data = [];
        let p = this.symbols[this.currentSymbol]?.base || 22548.16;
        const now = Date.now();
        for (let i = 160; i >= 0; i--) {
            const change = (Math.random() - 0.48) * (p * 0.001);
            const o = p, c = o + change;
            const h = Math.max(o, c) + Math.random() * (p * 0.0005);
            const l = Math.min(o, c) - Math.random() * (p * 0.0005);
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
        lastCandle.volume += Math.round(Math.random() * 800);
        return lastCandle;
    }
}