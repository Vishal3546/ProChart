/* ============================================================
 * DataFeed — client-side API client (v2026.10)
 * Works whether page is opened from FastAPI (same-origin) or file://
 * (falls back to http://127.0.0.1:8000 when file://).
 * Returns candles with UNIX-second timestamps.
 * ============================================================ */
class DataFeed {
    constructor() {
        if (window.location.protocol === 'file:') {
            this.baseUrl = 'http://127.0.0.1:8000';
        } else {
            this.baseUrl = '';
        }
        this._candleInFlight = new Map();  // per-key: Promise (single-flight)
        this._candleCooldownUntil = 0;     // ms timestamp
        this._candleAbort = new Map();     // per-key AbortController to cancel stale fetches on TF switch
        this._quoteInFlight = null;        // Promise dedupe
        this._lastQuoteKey = null;
        this._lastQuoteAt = 0;
    }

    /** Cancel any in-flight candle fetch for a specific key (called on TF/symbol switch) */
    abortCandle(key) {
        const ctrl = this._candleAbort.get(key);
        if (ctrl) { try { ctrl.abort(); } catch(_){} this._candleAbort.delete(key); }
    }
    /** Cancel ALL in-flight candle fetches (called on page nav/unload) */
    abortAllCandles() {
        for (const ctrl of this._candleAbort.values()) { try { ctrl.abort(); } catch(_){} }
        this._candleAbort.clear();
    }

    async fetchCandles(symbol, tf, meta = {}) {
        return await this.fetchCandleData(symbol, tf, meta);
    }

    async fetchCandleData(symbol = 'NIFTY', timeframe = '15', meta = {}) {
        const token = meta.token || '';
        const exchange = meta.exchange || 'NSE';
        const cKey = `${exchange}:${token}:${timeframe}`;

        // --- Global client-side cooldown (don't hammer if server said 429) ---
        const now = Date.now();
        if (now < this._candleCooldownUntil) {
            if (this._candleInFlight.has(cKey)) return this._candleInFlight.get(cKey);
            // Return empty/loading instead of fake NIFTY candles
            return { candles: [], source: 'SimulatedPro', cooldown: true, loading: true };
        }

        // --- Single-flight: if same key already fetching, reuse promise ---
        if (this._candleInFlight.has(cKey)) return this._candleInFlight.get(cKey);

        const p = (async () => {
            // Create our own AbortController for this request so we can cancel stale fetches
            // on TF/symbol switch (TradingView-style instant cancellation)
            const ctrl = new AbortController();
            this._candleAbort.set(cKey, ctrl);
            try {
                const params = new URLSearchParams({ symbol: symbol || 'NIFTY', interval: timeframe });
                if (meta.token) params.set('token', meta.token);
                if (meta.exchange) params.set('exchange', meta.exchange);
                const url = `${this.baseUrl}/api/candles?${params.toString()}`;
                const fopt = { cache: 'no-store', signal: ctrl.signal };
                const res = await fetch(url, fopt);
                if (res.status === 429) {
                    let retry = 30;
                    try { const j = await res.json(); retry = (j && j.detail && j.detail.retry_after) || parseInt(res.headers.get('Retry-After')) || 30; } catch(_){}
                    this._candleCooldownUntil = Date.now() + retry * 1000;
                    console.warn(`Candle 429 — cooling down ${retry}s for ${cKey}`);
                    const cached = this._loadLocalCache(symbol, timeframe);
                    if (cached && cached.length) return { candles: cached, source: 'LocalCache', stale: true };
                    // Graceful fallback instead of throwing
                    const lastLtp = window._app && window._app._lastGoodPrice && window._app._lastGoodPrice[symbol];
                    return { candles: this.generateFallbackCandles(timeframe, lastLtp), source: 'SimulatedPro', cooldown: true };
                }
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                // REJECT simulated/cooldown/inflight responses when we don't already have good data on screen —
                // server returns anchored random-walk candles that drift and look NOTHING like real price,
                // which causes the "30m chart shows 307 when price is 359" corruption. Better to show empty/loading
                // than fake data anchored to a stale price.
                const isFake = data && data.source && (data.source === 'SimulatedPro' || data.source === 'Cooldown' || data.source === 'InFlight');
                if (data && data.status === 'success' && Array.isArray(data.candles) && data.candles.length > 0 && !isFake) {
                    const candles = this.formatCandles(data.candles);
                    if (data.source === 'AngelOne') this._saveLocalCache(symbol, timeframe, candles);
                    return { candles, source: data.source || 'unknown' };
                }
                if (isFake) {
                    // Fake/cooldown data: use localStorage cache if available; otherwise return loading (no fake render)
                    const cached = this._loadLocalCache(symbol, timeframe);
                    if (cached && cached.length) return { candles: cached, source: 'LocalCache', stale: true };
                    return { candles: [], source: data.source, loading: true, cooldown: data.source === 'Cooldown' };
                }
                // Empty success or other: fall back to cache
                const cached = this._loadLocalCache(symbol, timeframe);
                if (cached && cached.length) return { candles: cached, source: 'LocalCache', stale: true };
                return { candles: [], source: 'empty', loading: true };
            } catch (err) {
                if (err && err.name === 'AbortError') { throw err; }  // caller handles abort
                console.warn('API candle fetch failed, using fallback:', err.message);
                const lastLtp = window._app && window._app._lastGoodPrice && window._app._lastGoodPrice[symbol];
                return { candles: this.generateFallbackCandles(timeframe, lastLtp), source: 'SimulatedPro' };
            } finally {
                this._candleInFlight.delete(cKey);
                this._candleAbort.delete(cKey);
            }
        })();
        this._candleInFlight.set(cKey, p);
        return p;
    }

    async fetchLiveQuote(symbol = 'NIFTY', meta = {}) {
        const token = meta.token || '';
        const exchange = meta.exchange || 'NSE';
        const key = `${exchange}:${token}`;
        const now = Date.now();
        // Dedupe: same quote within 2s → return in-flight / skip
        if (key === this._lastQuoteKey && now - this._lastQuoteAt < 2000 && this._quoteInFlight) {
            return this._quoteInFlight;
        }
        this._lastQuoteKey = key;
        this._lastQuoteAt = now;
        this._quoteInFlight = (async () => {
            try {
                const params = new URLSearchParams({ symbol });
                if (meta.token)    params.set('token', meta.token);
                if (meta.exchange) params.set('exchange', meta.exchange);
                const url = `${this.baseUrl}/api/quote?${params.toString()}`;
                const res = await fetch(url, { cache: 'no-store' });
                if (!res.ok) return null;
                return await res.json();
            } catch (err) { return null; }
        })();
        return this._quoteInFlight;
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
            const res = await fetch(url, { cache: 'no-store' });
            if (!res.ok) return [];
            const data = await res.json();
            return {
                results: Array.isArray(data.results) ? data.results : [],
                loaded: data.loaded !== false,
                message: data.message || '',
            };
        } catch (e) { return { results: [], loaded: false, message: 'Search error' }; }
    }

    // ---------- localStorage candle cache (TradingView-style instant chart load) ----------
    _cacheKey(symbol, tf) { return `pc_cdl_${symbol}_${tf}`; }
    _saveLocalCache(symbol, tf, candles) {
        try {
            // Trim to last 500 candles & store (localStorage ~5MB limit)
            const trimmed = candles.slice(-500);
            localStorage.setItem(this._cacheKey(symbol, tf), JSON.stringify({ t: Date.now(), c: trimmed }));
        } catch(e) {}
    }
    _loadLocalCache(symbol, tf) {
        try {
            const raw = localStorage.getItem(this._cacheKey(symbol, tf));
            if (!raw) return null;
            const obj = JSON.parse(raw);
            if (!obj || !obj.c || !Array.isArray(obj.c)) return null;
            // Use cache if < 24h old (intraday) or < 7 days (daily)
            const age = Date.now() - (obj.t || 0);
            const maxAge = tf === 'D' ? 7*86400*1000 : 8*3600*1000;  // 8h intraday, 7d daily
            if (age > maxAge) return null;
            return this.formatCandles(obj.c);
        } catch(e) { return null; }
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

    generateFallbackCandles(tf = '15', anchorPrice = null) {
        const count = 180;
        const candles = [];
        const now = Math.floor(Date.now() / 1000);
        const tfSecMap = { '1': 60, '3': 180, '5': 300, '15': 900, '30': 1800, '60': 3600, 'D': 86400 };
        const step = tfSecMap[tf] || 900;
        const endTs = now - (now % step);
        const startTs = endTs - (count - 1) * step;
        // Use anchor price if known (e.g. last LTP from a prior good load),
        // otherwise fall back to NIFTY default for the very first load.
        let basePrice = (anchorPrice && anchorPrice > 0) ? anchorPrice : 22668.42;

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
