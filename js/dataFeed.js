class DataFeed {
    constructor() {
        this.backendUrl = "http://127.0.0.1:8000";
        this.currentSymbol = "NIFTY";
        this.currentToken = "99926000";
        this.currentExchange = "NSE";
        this.currentInterval = "15";
    }
    async searchSymbols(q) {
        try {
            const r = await fetch(this.backendUrl + "/api/search?q=" + encodeURIComponent(q || ""));
            return (await r.json()).results || [];
        } catch (e) { return []; }
    }
    async fetchCandleData(symbol, token, exchange, interval) {
        this.currentSymbol = symbol || "NIFTY";
        this.currentToken = token || "99926000";
        this.currentExchange = exchange || "NSE";
        this.currentInterval = interval || "15";
        try {
            const url = `${this.backendUrl}/api/candles?symbol=${this.currentSymbol}&token=${this.currentToken}&exchange=${this.currentExchange}&interval=${this.currentInterval}`;
            const r = await fetch(url);
            const d = await r.json();
            if (d.candles && d.candles.length) return d.candles;
        } catch (e) { console.error(e); }
        return [];
    }
    // Audit Fix: REAL quote polling (not fake random walk!)
    async fetchLiveQuote() {
        try {
            const url = `${this.backendUrl}/api/quote?exchange=${this.currentExchange}&token=${this.currentToken}`;
            const r = await fetch(url);
            return await r.json();
        } catch (e) { return null; }
    }
}