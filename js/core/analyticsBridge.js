/* ============================================================
 * AnalyticsBridge — Main thread controller for analytics.worker
 * TradingView pattern: heavy math off-thread, UI updates via RAF
 * ============================================================ */
class AnalyticsBridge {
    constructor() {
        this._worker = null;
        this._reqId = 0;
        this._pending = new Map();
        this._latest = null;
        this._destroyed = false;
        this._liveScheduled = false;
        this._init();
    }

    _init() {
        try {
            this._worker = new Worker('js/workers/analytics.worker.js');
            this._worker.onmessage = (e) => this._onMsg(e.data);
            this._worker.onerror = (err) => {
                console.error('[AnalyticsWorker]', err);
            };
        } catch (e) {
            console.warn('[AnalyticsBridge] Worker unavailable, fallback sync mode', e);
            this._worker = null;
        }
    }

    /**
     * @param {Array} candles - raw OHLC objects
     * @param {object} opts - { symbol, tf, engines?: string[] }
     * @returns {Promise<object>} aggregated engine results
     */
    analyze(candles, opts = {}) {
        if (!candles || candles.length < 10) {
            return Promise.resolve(null);
        }

        // No worker → tiny sync fallback using window engines if present
        if (!this._worker) {
            return Promise.resolve(this._syncFallback(candles, opts));
        }

        const id = ++this._reqId;
        let transferable;
        try {
            transferable = TypedCandleBuffer.fromCandles(candles).toTransferable();
        } catch (e) {
            return Promise.resolve(this._syncFallback(candles, opts));
        }

        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                this._pending.delete(id);
                resolve(this._latest); // stale-safe
            }, 800);

            this._pending.set(id, {
                resolve: (v) => {
                    clearTimeout(timeout);
                    resolve(v);
                },
            });

            try {
                this._worker.postMessage(
                    {
                        id,
                        type: 'analyze',
                        payload: transferable,
                        symbol: opts.symbol || '',
                        tf: opts.tf || '15',
                        engines: opts.engines || null,
                    },
                    [transferable.buffer] // zero-copy transfer
                );
            } catch (e) {
                clearTimeout(timeout);
                this._pending.delete(id);
                resolve(this._syncFallback(candles, opts));
            }
        });
    }

    /** Fire-and-forget live tick re-scan (coalesced via RAF) */
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
        if (p) {
            this._pending.delete(msg.id);
            p.resolve(msg.result);
        }
    }

    _syncFallback(candles, opts) {
        const tf = opts.tf || '15';
        const out = {};
        try {
            if (window.BreakoutChecklistEngine)
                out.checklist = new BreakoutChecklistEngine().evaluate(candles);
            if (window.BreakoutScanner)
                out.breakout = new BreakoutScanner().scan(candles);
            if (window.BigCandleDetector)
                out.bigCandle = new BigCandleDetector().analyze(candles, tf);
            if (window.CandlePatternEngine)
                out.patterns = new CandlePatternEngine().scanAll(candles, opts.patternSettings || { master: true, hammer: true, engulfing: true, star: true, doji: true });
            if (window.ClosingTrapEngine)
                out.closingTrap = new ClosingTrapEngine().analyze(candles, tf);
            if (window.DivergenceEngine && window.TechnicalIndicators) {
                const rsi = TechnicalIndicators.RSI(candles, 14);
                out.divergence = new DivergenceEngine().scanDivergences(candles, rsi);
            }
            if (window.DoubleBottomEngine)
                out.doubleBottom = new DoubleBottomEngine().scan(candles);
            if (window.FlagPatternEngine)
                out.flag = new FlagPatternEngine().scan(candles);
        } catch (e) {
            console.warn('[AnalyticsBridge] sync fallback error', e);
        }
        return out;
    }

    destroy() {
        this._destroyed = true;
        this._pending.clear();
        if (this._worker) {
            this._worker.terminate();
            this._worker = null;
        }
    }
}

window.AnalyticsBridge = AnalyticsBridge;
window.analyticsBridge = new AnalyticsBridge();
