/* ============================================================
 * AnalyticsBridge — Main thread controller for unified Worker
 * 17 engines off-main-thread; 800ms stale-safe timeout; RAF coalescing
 * ============================================================ */
class AnalyticsBridge {
    constructor() {
        this._worker = null;
        this._reqId = 0;
        this._pending = new Map();
        this._latest = null;
        this._liveScheduled = false;
        this._init();
    }

    _init() {
        try {
            this._worker = new Worker('js/workers/analytics.worker.js');
            this._worker.onmessage = (e) => this._onMsg(e.data);
            this._worker.onerror = (err) => console.error('[AnalyticsWorker]', err);
        } catch (e) {
            console.warn('[AnalyticsBridge] Worker unavailable — sync engines remain active', e);
            this._worker = null;
        }
    }

    analyze(candles, opts = {}) {
        if (!candles || candles.length < 10) return Promise.resolve(this._latest);
        if (!this._worker) return Promise.resolve(this._latest);

        const id = ++this._reqId;
        let transferable;
        try { transferable = TypedCandleBuffer.fromCandles(candles).toTransferable(); }
        catch (e) { return Promise.resolve(this._latest); }

        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                this._pending.delete(id);
                resolve(this._latest);
            }, 800);
            this._pending.set(id, { resolve: (v) => { clearTimeout(timeout); resolve(v); } });
            try {
                this._worker.postMessage({
                    id, type: 'analyze', payload: transferable,
                    symbol: opts.symbol || '', tf: opts.tf || '15', opts: opts,
                }, [transferable.buffer]);
            } catch (e) {
                clearTimeout(timeout); this._pending.delete(id); resolve(this._latest);
            }
        });
    }

    analyzeLive(candles, opts = {}, onResult) {
        if (this._liveScheduled) return;
        this._liveScheduled = true;
        requestAnimationFrame(async () => {
            this._liveScheduled = false;
            const res = await this.analyze(candles, opts);
            if (res && typeof onResult === 'function') onResult(res);
        });
    }

    _onMsg(msg) {
        if (!msg || msg.type !== 'result') return;
        this._latest = msg.result;
        const p = this._pending.get(msg.id);
        if (p) { this._pending.delete(msg.id); p.resolve(msg.result); }
    }
}
window.AnalyticsBridge = AnalyticsBridge;
window.analyticsBridge = new AnalyticsBridge();
