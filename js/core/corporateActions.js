/* ============================================================
 * CorporateActionsEngine — Split / Bonus / Dividend adjuster
 * Angel One daily history is usually pre-adjusted; this engine
 * is the safety net for raw feeds + manual corporate events.
 * TradingView method: backward adjustment from latest action.
 * ============================================================ */
class CorporateActionsEngine {
    constructor() {
        // symbol -> [{exDate: 'YYYY-MM-DD', type:'split'|'bonus'|'div', ratio, factor}]
        this._actions = new Map();
        this._loadBuiltins();
    }

    _loadBuiltins() {
        // Known major NSE actions (extend as needed)
        // factor: post-split price scale. 1:1 bonus => factor 0.5 on pre-ex history
        this.register('RELIANCE', [
            // example placeholders — replace with real ex-dates when known
            // { exDate: '2017-09-07', type: 'split', ratio: '1:1', factor: 0.5 },
        ]);
    }

    register(symbol, actions) {
        const sorted = (actions || []).slice().sort((a, b) =>
            a.exDate < b.exDate ? 1 : -1 // latest first
        );
        this._actions.set(String(symbol).toUpperCase(), sorted);
    }

    /** Compute cumulative factor for a candle timestamp (seconds) */
    _factorAt(symbol, timeSec) {
        const list = this._actions.get(String(symbol).toUpperCase());
        if (!list || !list.length) return 1;
        const d = new Date(timeSec * 1000);
        // IST calendar date
        const ist = new Date(d.getTime() + 5.5 * 3600 * 1000);
        const iso = ist.toISOString().slice(0, 10);
        let f = 1;
        for (const a of list) {
            // prices strictly before exDate get multiplied by factor
            if (iso < a.exDate) f *= a.factor;
        }
        return f;
    }

    /**
     * Adjust OHLC array in-place style (returns new array)
     * Volume is scaled inversely for splits/bonus so VWAP stays sane
     */
    adjust(symbol, candles) {
        if (!candles || !candles.length) return candles || [];
        const list = this._actions.get(String(symbol).toUpperCase());
        if (!list || !list.length) return candles;

        const out = new Array(candles.length);
        for (let i = 0; i < candles.length; i++) {
            const c = candles[i];
            const t = typeof c.time === 'number'
                ? (c.time > 1e10 ? Math.floor(c.time / 1000) : c.time)
                : Math.floor(new Date(c.time).getTime() / 1000);
            const f = this._factorAt(symbol, t);
            if (f === 1) {
                out[i] = c;
            } else {
                out[i] = {
                    time: c.time,
                    open: +(c.open * f).toFixed(4),
                    high: +(c.high * f).toFixed(4),
                    low: +(c.low * f).toFixed(4),
                    close: +(c.close * f).toFixed(4),
                    volume: Math.round((c.volume || 0) / f),
                };
            }
        }
        return out;
    }

    /** Detect suspicious unadjusted jump (split not registered) */
    detectUnadjustedSplit(candles) {
        if (!candles || candles.length < 5) return null;
        for (let i = 1; i < candles.length; i++) {
            const prev = candles[i - 1].close;
            const cur = candles[i].open;
            if (prev <= 0) continue;
            const ratio = cur / prev;
            if (ratio > 0.45 && ratio < 0.55) {
                return { index: i, type: 'split_1_1', ratio, time: candles[i].time };
            }
            if (ratio > 0.30 && ratio < 0.36) {
                return { index: i, type: 'split_1_2', ratio, time: candles[i].time };
            }
            if (ratio > 1.9 && ratio < 2.1) {
                return { index: i, type: 'reverse_2_1', ratio, time: candles[i].time };
            }
        }
        return null;
    }
}

window.CorporateActionsEngine = CorporateActionsEngine;
window.corporateActions = new CorporateActionsEngine();
