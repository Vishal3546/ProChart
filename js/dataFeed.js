/* ============================================================
 * DataFeed — client API client (v2026.10)
 * Same-origin when served from FastAPI; file:// fallback to localhost.
 * Returns UNIX-second candles; sanitizes NaN/invalid rows.
 * ============================================================ */
class DataFeed {
    constructor() {
        if (window.location.protocol === 'file:') {
            this.baseUrl = 'http://127.0.0.1:8000';
        } else {
            this.baseUrl = '';
        }
    }

    async fetchCandles(symbol, tf, meta = {}) {
        return await this.fetchCandleData(symbol, tf, meta);
    }

    async fetchCandleData(symbol = 'NIFTY', timeframe = '15', meta = {}) {
        try {
            const params = new URLSearchParams({ symbol: symbol || 'NIFTY', interval: timeframe });
            if (meta.token)    params.set('token', meta.token);
            if (meta.exchange) params.set('exchange', meta.exchange);

            const res = await fetch(`${this.baseUrl}/api/candles?${params.toString()}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            if (data && data.status === 'success' && Array.isArray(data.candles) && data.candles.length > 0) {
                return { candles: this.formatCandles(data.candles), source: data.source || 'unknown' };
            }
            return { candles: this.generateFallbackCandles(timeframe), source: 'SimulatedPro' };
        } catch (err) {
            console.warn('API candle fetch failed, using fallback:', err.message);
            return { candles: this.generateFallbackCandles(timeframe), source: 'SimulatedPro' };
        }
    }

    async fetchLiveQuote(symbol = 'NIFTY', meta = {}) {
        try {
            const params = new URLSearchParams({ symbol });
            if (meta.token)    params.set('token', meta.token);
            if (meta.exchange) params.set('exchange', meta.exchange);
            const res = await fetch(`${this.baseUrl}/api/quote?${params.toString()}`);
            if (!res.ok) return null;
            return await res.json();
        } catch (e) { return null; }
    }

    async fetchStatus() {
        try {
            const res = await fetch(`${this.baseUrl}/api/status`);
            if (!res.ok) return null;
            return await res.json();
        } catch (e) { return null; }
    }

    async search(q) {
        try {
            const res = await fetch(`${this.baseUrl}/api/search?q=${encodeURIComponent(q || '')}`);
            if (!res.ok) return [];
            const data = await res.json();
            return Array.isArray(data.results) ? data.results : [];
        } catch (e) { return []; }
    }

    formatCandles(rawCandles) {
        return rawCandles
            .filter(c => c && c.open != null && c.high != null && c.low != null && c.close != null)
            .map(c => ({
                time: c.time,
                open: parseFloat(c.open !== undefined ? c.open : c[1]),
                high: parseFloat(c.high !== undefined ? c.high : c[2]),
                low: parseFloat(c.low !== undefined ? c.low : c[3]),
                close: parseFloat(c.close !== undefined ? c.close : c[4]),
                volume: parseFloat(c.volume !== undefined ? c.volume : (c[5] || 0)),
            }))
            .filter(c => isFinite(c.open) && isFinite(c.high) && isFinite(c.low) && isFinite(c.close) &&
                         c.high >= c.low && c.high > 0 && c.low > 0);
    }

    generateFallbackCandles(tf = '15') {
        const count = 180;
        const candles = [];
        const now = Math.floor(Date.now() / 1000);
        const tfSecMap = { '1': 60, '3': 180, '5': 300, '15': 900, '30': 1800, '60': 3600, 'D': 86400 };
        const step = tfSecMap[tf] || 900;
        const endTs = now - (now % step);
        const startTs = endTs - (count - 1) * step;
        let basePrice = 22668.42;

        for (let i = 0; i < count; i++) {
            const drift = (Math.random() - 0.5) * basePrice * 0.002;
            const open = basePrice;
            const close = open + drift;
            const high = Math.max(open, close) + Math.random() * basePrice * 0.0008;
            const low = Math.min(open, close) - Math.random() * basePrice * 0.0008;
            const volume = Math.floor(100000 + Math.random() * 700000);
            candles.push({
                time: startTs + i * step,
                open: +open.toFixed(2), high: +high.toFixed(2),
                low: +low.toFixed(2), close: +close.toFixed(2),
                volume,
            });
            basePrice = close;
        }
        return candles;
    }
}
window.DataFeed = DataFeed;