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
        this._candleCooldownUntil = 0;     // global cooldown ms timestamp
        this._perKeyCooldown = new Map();  // per-cacheKey cooldown until ms timestamp
        this._candleAbort = new Map();     // per-key AbortController
        this._localCache = new Map();      // in-memory RAM cache (key -> candles)
        this._purged = false;
        // Purge old-version caches immediately on startup
        this._purgeOldCaches && this._purgeOldCaches();
    }

    /** Returns ms until cooldown expires for given key, 0 if safe to call */
    _cooldownMsFor(cKey) {
        const now = Date.now();
        const g = Math.max(0, this._candleCooldownUntil - now);
        const pk = Math.max(0, (this._perKeyCooldown.get(cKey) || 0) - now);
        // Opportunistic housekeeping — purge expired cooldowns to prevent slow Map growth
        if (this._perKeyCooldown.size > 50) {
            for (const [k, v] of this._perKeyCooldown.entries()) {
                if (v < now) this._perKeyCooldown.delete(k);
            }
        }
        return Math.max(g, pk);
    }

    /** Cancel any in-flight candle fetch for a specific key (called on TF/symbol switch) */
    abortCandle(key) {
        const ctrl = this._candleAbort.get(key);
        if (ctrl) { try { ctrl.abort(); } catch(_){} this._candleAbort.delete(key); }
        // Also clear the in-flight promise so the next request starts FRESH
        // (prevents returning an aborted promise to new callers)
        this._candleInFlight.delete(key);
    }
    /** Cancel ALL in-flight candle fetches (called on page nav/unload) */
    abortAllCandles() {
        for (const ctrl of this._candleAbort.values()) { try { ctrl.abort(); } catch(_){} }
        this._candleAbort.clear();
        this._candleInFlight.clear();
    }

    async fetchCandles(symbol, tf, meta = {}) {
        return await this.fetchCandleData(symbol, tf, meta);
    }

    async fetchCandleData(symbol = 'NIFTY', timeframe = '15', meta = {}) {
        const token = meta.token || '';
        const exchange = meta.exchange || 'NSE';
        const cKey = `${exchange}:${token}:${timeframe}`;

        // 1. Check local RAM cache first (0ms)
        let cached = this._loadLocalCache(symbol, timeframe);
        if (!cached && window.idbCache) {
            // 2. Check IndexedDB async store if RAM missed
            try {
                const idbData = await window.idbCache.get(symbol, timeframe);
                if (idbData && idbData.length >= 20) {
                    cached = this.formatCandles(idbData);
                    const key = `${symbol}_${timeframe}`;
                    this._localCache.set(key, cached);
                }
            } catch (e) {}
        }

        const now = Date.now();
        // Respect PER-KEY cooldown (server told us this exact key is rate-limited — don't hammer)
        const pkUntil = this._perKeyCooldown.get(cKey) || 0;
        const cdMs = Math.max(0, this._candleCooldownUntil - now, pkUntil - now);
        if (cdMs > 500) {
            if (cached && cached.length) return { candles: cached, source: 'LocalCache', stale: true };
            // Double check IDB if RAM was empty during cooldown
            if (window.idbCache) {
                try {
                    const idbCandles = await window.idbCache.get(symbol, timeframe);
                    if (idbCandles && idbCandles.length) {
                        const fc = this.formatCandles(idbCandles);
                        return { candles: fc, source: 'IDBCache', stale: true, cooldown: true };
                    }
                } catch (e) {}
            }
            return { candles: [], source: 'Cooldown', loading: true, cooldown: true, retryAfterMs: cdMs };
        }

        // Single-flight dedup
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
                    try { const j = await res.json();
                        retry = (j && j.detail && j.detail.retry_after) || parseInt(res.headers.get('Retry-After')) || 30;
                        // If server returned a per-key hint, honour it
                        if (j && j.detail && j.detail.key === cKey) {
                            this._perKeyCooldown.set(cKey, Date.now() + retry * 1000);
                        }
                    } catch(_){}
                    // Set both global + per-key cooldown to be safe
                    this._perKeyCooldown.set(cKey, Date.now() + retry * 1000);
                    console.warn(`Candle 429 — cooling down ${retry}s for ${cKey}`);
                    // Try RAM/localStorage first
                    cached = cached || this._loadLocalCache(symbol, timeframe);
                    if (cached && cached.length) return { candles: cached, source: 'LocalCache', stale: true };
                    // Fall back to IndexedDB on cooldown (blank chart prevention)
                    if (window.idbCache) {
                        try {
                            const idbCandles = await window.idbCache.get(symbol, timeframe);
                            if (idbCandles && idbCandles.length) {
                                const fc = this.formatCandles(idbCandles);
                                return { candles: fc, source: 'IDBCache', stale: true, cooldown: true };
                            }
                        } catch (e) {}
                    }
                    return { candles: [], source: 'Cooldown', loading: true, cooldown: true, retryAfterMs: retry*1000 };
                }
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
                // REJECT simulated/cooldown/inflight responses when we don't already have good data on screen —
                // server returns anchored random-walk candles that drift and look NOTHING like real price,
                // which causes the "30m chart shows 307 when price is 359" corruption. Better to show empty/loading
                // than fake data anchored to a stale price.
                const isFake = data && data.source && (data.source === 'SimulatedPro' || data.source === 'Cooldown' || data.source === 'InFlight');
                if (data && data.status === 'success' && Array.isArray(data.candles) && data.candles.length > 0 && !isFake) {
                    let candles = this.formatCandles(data.candles);

                    // Price-divergence sanity: don't save to cache if last candle is >25% off known LTP
                    // (defense in depth — server already does this check too)
                    let sane = true;
                    try {
                        const ltp = window._app && (window._app.lastLtp || (window._app._lastGoodPrice && window._app._lastGoodPrice[symbol]));
                        if (ltp && ltp > 0 && candles.length > 0) {
                            const lc = candles[candles.length-1].close;
                            const r = lc / ltp;
                            if (r < 0.95 || r > 1.05) {
                                const pct = ((r-1)*100).toFixed(1);
                            console.warn('⚠️ Client sanity REJECT ' + cKey + ': last close ' + lc + ' vs LTP ' + ltp + ' (' + pct + '%) — NOT caching');
                                sane = false;
                            }
                        }
                    } catch(_){}
                    if (data.source === 'AngelOne' && sane) this._saveLocalCache(symbol, timeframe, candles);
                    return { candles, source: data.source || 'unknown', sanityRejected: !sane };
                }
                if (isFake) {
                    // Server sent fake/cooldown/inflight — set per-key cooldown to prevent retries hammering
                    if (data.source === 'Cooldown') this._perKeyCooldown.set(cKey, Date.now() + 30000);
                    cached = cached || this._loadLocalCache(symbol, timeframe);
                    if (cached && cached.length) return { candles: cached, source: 'LocalCache', stale: true };
                    return { candles: [], source: data.source, loading: true, cooldown: data.source === 'Cooldown' };
                }
                // Empty success or other: fall back to cache
                cached = cached || this._loadLocalCache(symbol, timeframe);
                if (cached && cached.length) return { candles: cached, source: 'LocalCache', stale: true };
                return { candles: [], source: 'empty', loading: true };
            } catch (err) {
                if (err && err.name === 'AbortError') { throw err; }
                console.warn('API candle fetch failed:', err.message);
                // NO FAKE CANDLES! Use Cache or Return Empty
                cached = cached || this._loadLocalCache(symbol, timeframe);
                if (cached && cached.length) return { candles: cached, source: 'LocalCache', stale: true };
                return { candles: [], source: 'Error', loading: false };
            } finally {
                this._candleInFlight.delete(cKey);
                this._candleAbort.delete(cKey);
            }
        })();
        this._candleInFlight.set(cKey, p);
        return p;
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
            if (!res.ok) return { results: [], loaded: false, message: `HTTP ${res.status}` };
            const data = await res.json();
            return {
                results: Array.isArray(data.results) ? data.results : [],
                loaded: data.loaded !== false,
                message: data.message || '',
            };
        } catch (e) { return { results: [], loaded: false, message: 'Search error' }; }
    }

    // ---------- localStorage candle cache (TradingView-style instant chart load) ----------
    // CACHE_VERSION bump karo jab bhi candle format change karein — purani corrupt cache
    // auto-reject ho jayegi (308-range wali purani cache ki tarah bugs prevent karta hai).
    _cacheVersion() { return 'v44'; }
    _cacheKey(symbol, tf) { return `pc_cdl_${this._cacheVersion()}_${symbol}_${tf}`; }
    _saveLocalCache(symbol, tf, candles) {
        if (!candles || !candles.length) return;

        // 1. Corporate Actions Adjustment (Splits / Bonus / Dividends)
        let adjusted = candles;
        try {
            if (window.corporateActions) {
                const sus = window.corporateActions.detectUnadjustedSplit(candles);
                if (sus) console.warn('[CorporateActions] Possible unregistered split for', symbol, sus);
                adjusted = window.corporateActions.adjust(symbol, candles);
            }
        } catch (_) {}

        // 2. In-memory RAM cache (instant, existing behaviour)
        const key = `${symbol}_${tf}`;
        this._localCache.set(key, adjusted);

        // 3. Async IndexedDB Write (Multi-GB persistent store, 0ms main thread block)
        try {
            if (window.idbCache) {
                window.idbCache.set(symbol, tf, adjusted).catch(() => {});
            }
        } catch (_) {}

        // 4. Synchronous LocalStorage Fallback (trim to 500 bars — browser ~5MB cap)
        try {
            localStorage.setItem(this._cacheKey(symbol, tf), JSON.stringify({ t: Date.now(), c: adjusted.slice(-500) }));
        } catch(e) {}
    }
    _loadLocalCache(symbol, tf) {
        // 1) In-memory RAM cache (instant hit)
        const key = `${symbol}_${tf}`;
        const mem = this._localCache.get(key);
        if (mem && mem.length) return mem;
        // 2) localStorage (versioned)
        try {
            // Also wipe ANY old-format (non-versioned) caches on sight — prevents stale
            // simulated data from previous versions from leaking onto charts.
            this._purgeOldCaches();
            const raw = localStorage.getItem(this._cacheKey(symbol, tf));
            if (!raw) return null;
            const obj = JSON.parse(raw);
            if (!obj || !obj.c || !Array.isArray(obj.c)) return null;
            const age = Date.now() - (obj.t || 0);
            const maxAge = tf === 'D' ? 7*86400*1000 : 8*3600*1000;
            if (age > maxAge) return null;
            const parsed = this.formatCandles(obj.c);
            if (parsed && parsed.length) this._localCache.set(key, parsed); // promote to RAM
            return parsed;
        } catch(e) { return null; }
    }
    _purgeOldCaches() {
        if (this._purged) return;
        this._purged = true;
        try {
            const toRemove = [];
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                if (!k) continue;
                if (k.startsWith('pc_cdl_') && !k.startsWith(`pc_cdl_${this._cacheVersion()}_`)) {
                    toRemove.push(k);
                }
            }
            toRemove.forEach(k => { try { localStorage.removeItem(k); } catch(_){} });
            if (toRemove.length) console.log(`🧹 Purged ${toRemove.length} stale candle caches from older versions`);
        } catch(_) {}
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
}
window.DataFeed = DataFeed;
