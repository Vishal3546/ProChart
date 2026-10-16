/* ============================================================
 * DataFeed — client-side API client (v2026.10)
 * Works whether page is opened from FastAPI (same-origin) or file://
 * (falls back to http://127.0.0.1:8000 when file://).
 * Returns candles with UNIX-second timestamps.
 * ============================================================ */
class DataFeed {
    constructor() {
        // When served from FastAPI, use relative URLs (works through reverse proxies too).
        // When opened from file:// (double-clicked), fall back to localhost.
        if (window.location.protocol === 'file:') {
            this.baseUrl = 'http://127.0.0.1:8000';
        } else {
            this.baseUrl = '';  // same origin
        }
    }

    async fetchCandles(symbol, tf, meta = {}) {
        return await this.fetchCandleData(symbol, tf, meta);
    }

    async fetchCandleData(symbol = 'NIFTY', timeframe = '15', meta = {}) {
        try {
            const params = new URLSearchParams({
                symbol: symbol || 'NIFTY',
                interval: timeframe,
            });
            if (meta.token)    params.set('token', meta.token);
            if (meta.exchange) params.set('exchange', meta.exchange);

            const url = `${this.baseUrl}/api/candles?${params.toString()}`;
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            if (data && data.status === 'success' && Array.isArray(data.candles) && data.candles.length > 0) {
                return { candles: this.formatCandles(data.candles), source: data.source || 'unknown' };
            }
            // Fallback
            return { candles: this.generateFallbackCandles(timeframe), source: 'SimulatedPro' };
        } catch (err) {
            console.warn('API candle fetch failed, using fallback generator:', err.message);
            return { candles: this.generateFallbackCandles(timeframe), source: 'SimulatedPro' };
        }
    }

    async fetchLiveQuote(symbol = 'NIFTY', meta = {}) {
        try {
            const params = new URLSearchParams({ symbol });
            if (meta.token)    params.set('token', meta.token);
            if (meta.exchange) params.set('exchange', meta.exchange);
            const url = `${this.baseUrl}/api/quote?${params.toString()}`;
            const res = await fetch(url);
            if (!res.ok) return null;
            return await res.json();
        } catch (err) {
            return null;
        }
    }

    async fetchStatus() {
        try {
            const url = `${this.baseUrl}/api/status`;
            const res = await fetch(url);
            if (!res.ok) return null;
            return await res.json();
        } catch (e) { return null; }
    }

    async search(q) {
        try {
            const url = `${this.baseUrl}/api/search?q=${encodeURIComponent(q || '')}`;
            const res = await fetch(url);
            if (!res.ok) return [];
            const data = await res.json();
            return Array.isArray(data.results) ? data.results : [];
        } catch (e) { return []; }
    }

    formatCandles(rawCandles) {
        return rawCandles.map(c => ({
            time: c.time,  // already UNIX seconds from server; strings also handled downstream
            open: parseFloat(c.open !== undefined ? c.open : c[1]),
            high: parseFloat(c.high !== undefined ? c.high : c[2]),
            low: parseFloat(c.low !== undefined ? c.low : c[3]),
            close: parseFloat(c.close !== undefined ? c.close : c[4]),
            volume: parseFloat(c.volume !== undefined ? c.volume : (c[5] || 0)),
        }));
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
