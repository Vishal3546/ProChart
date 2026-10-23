/* ============================================================
 * idbCache.js — TradingView-grade async candle store
 * IndexedDB + in-memory LRU hot layer
 * Versioned keys, non-blocking, multi-symbol safe
 * ============================================================ */
const IDB_NAME = 'ProChartTerminal';
const IDB_VER = 5;
const STORE = 'candles';
const META_STORE = 'meta';
const MAX_RAM_ENTRIES = 24; // hot LRU

class IDBCache {
    constructor() {
        this._db = null;
        this._ram = new Map(); // key -> {candles, ts, tf}
        this._opening = null;
    }

    async open() {
        if (this._db) return this._db;
        if (this._opening) return this._opening;
        this._opening = new Promise((resolve, reject) => {
            const req = indexedDB.open(IDB_NAME, IDB_VER);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE)) {
                    const s = db.createObjectStore(STORE, { keyPath: 'key' });
                    s.createIndex('by_sym', 'symbol', { unique: false });
                    s.createIndex('by_ts', 'updatedAt', { unique: false });
                }
                if (!db.objectStoreNames.contains(META_STORE)) {
                    db.createObjectStore(META_STORE, { keyPath: 'key' });
                }
            };
            req.onsuccess = () => {
                this._db = req.result;
                this._opening = null;
                resolve(this._db);
            };
            req.onerror = () => {
                this._opening = null;
                reject(req.error);
            };
        });
        return this._opening;
    }

    _key(symbol, tf) {
        // Sync with DataFeed cache version — bumps auto-purge old IDB entries on version upgrade
        const ver = (window.dataFeed && window.dataFeed._cacheVersion && window.dataFeed._cacheVersion()) || 'v39';
        return `${ver}:${symbol}:${tf}`;
    }

    async get(symbol, tf) {
        const k = this._key(symbol, tf);
        // 1) RAM hit (0ms)
        if (this._ram.has(k)) {
            const hit = this._ram.get(k);
            // refresh LRU order
            this._ram.delete(k);
            this._ram.set(k, hit);
            return hit.candles;
        }
        // 2) IDB
        try {
            const db = await this.open();
            const candles = await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE, 'readonly');
                const req = tx.objectStore(STORE).get(k);
                req.onsuccess = () => resolve(req.result ? req.result.candles : null);
                req.onerror = () => reject(req.error);
            });
            if (candles && candles.length) {
                this._putRam(k, candles, tf);
                return candles;
            }
        } catch (e) {
            console.warn('[IDB] get failed', e);
        }
        return null;
    }

    async set(symbol, tf, candles) {
        if (!candles || !candles.length) return;
        const k = this._key(symbol, tf);
        this._putRam(k, candles, tf);
        try {
            const db = await this.open();
            await new Promise((resolve, reject) => {
                const tx = db.transaction(STORE, 'readwrite');
                tx.objectStore(STORE).put({
                    key: k,
                    symbol,
                    tf,
                    candles,
                    updatedAt: Date.now(),
                    count: candles.length,
                });
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            });
        } catch (e) {
            console.warn('[IDB] set failed', e);
        }
    }

    _putRam(k, candles, tf) {
        if (this._ram.size >= MAX_RAM_ENTRIES) {
            // evict oldest
            const first = this._ram.keys().next().value;
            this._ram.delete(first);
        }
        this._ram.set(k, { candles, tf, ts: Date.now() });
    }

    async invalidate(symbol, tf = null) {
        if (tf) {
            const k = this._key(symbol, tf);
            this._ram.delete(k);
            try {
                const db = await this.open();
                await new Promise((resolve) => {
                    const tx = db.transaction(STORE, 'readwrite');
                    tx.objectStore(STORE).delete(k);
                    tx.oncomplete = () => resolve();
                });
            } catch (_) {}
            return;
        }
        // all TFs for symbol
        for (const k of [...this._ram.keys()]) {
            if (k.includes(`:${symbol}:`)) this._ram.delete(k);
        }
        try {
            const db = await this.open();
            const tx = db.transaction(STORE, 'readwrite');
            const idx = tx.objectStore(STORE).index('by_sym');
            const req = idx.openCursor(IDBKeyRange.only(symbol));
            req.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                }
            };
        } catch (_) {}
    }

    /** Non-blocking warm on boot */
    async warm(symbol, tfs = ['1', '5', '15', '60', 'D']) {
        await Promise.all(tfs.map((tf) => this.get(symbol, tf)));
    }
}

window.idbCache = new IDBCache();
