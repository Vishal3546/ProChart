/* ============================================================
 * TypedCandleBuffer — TradingView-style SoA (Structure of Arrays)
 * OHLC packed in Float64Array for cache-friendly SIMD-like access
 * Layout per candle: [time, open, high, low, close, volume] = 6 slots
 * ============================================================ */
const CANDLE_STRIDE = 6;
const OFF_TIME = 0, OFF_O = 1, OFF_H = 2, OFF_L = 3, OFF_C = 4, OFF_V = 5;

class TypedCandleBuffer {
    constructor(capacity = 512) {
        this.capacity = capacity;
        this.length = 0;
        this._buf = new Float64Array(capacity * CANDLE_STRIDE);
    }

    static fromCandles(candles) {
        const t = new TypedCandleBuffer(candles.length);
        t.load(candles);
        return t;
    }

    load(candles) {
        if (candles.length > this.capacity) this._resize(candles.length);
        const b = this._buf;
        for (let i = 0; i < candles.length; i++) {
            const c = candles[i];
            const o = i * CANDLE_STRIDE;
            b[o + OFF_TIME] = this._toSec(c.time);
            b[o + OFF_O] = +c.open;
            b[o + OFF_H] = +c.high;
            b[o + OFF_L] = +c.low;
            b[o + OFF_C] = +c.close;
            b[o + OFF_V] = +(c.volume || 0);
        }
        this.length = candles.length;
        return this;
    }

    _resize(n) {
        const next = Math.max(n, this.capacity * 2);
        const nb = new Float64Array(next * CANDLE_STRIDE);
        nb.set(this._buf.subarray(0, this.length * CANDLE_STRIDE));
        this._buf = nb;
        this.capacity = next;
    }

    _toSec(t) {
        if (typeof t === 'number') return t > 1e10 ? Math.floor(t / 1000) : Math.floor(t);
        if (t && typeof t === 'object' && t.year)
            return Math.floor(Date.UTC(t.year, (t.month || 1) - 1, t.day || 1) / 1000);
        return Math.floor(new Date(t).getTime() / 1000);
    }

    /** Zero-copy views (no GC) — engines use these */
    get times()  { return this._view(OFF_TIME); }
    get opens()  { return this._view(OFF_O); }
    get highs()  { return this._view(OFF_H); }
    get lows()   { return this._view(OFF_L); }
    get closes() { return this._view(OFF_C); }
    get vols()   { return this._view(OFF_V); }

    _view(offset) {
        const n = this.length;
        const out = new Float64Array(n);
        const b = this._buf;
        for (let i = 0; i < n; i++) out[i] = b[i * CANDLE_STRIDE + offset];
        return out;
    }

    /** Transferable payload for Worker (zero-copy postMessage) */
    toTransferable() {
        const copy = this._buf.slice(0, this.length * CANDLE_STRIDE);
        return {
            buffer: copy.buffer,
            length: this.length,
            stride: CANDLE_STRIDE,
        };
    }

    static fromTransferable(payload) {
        const t = new TypedCandleBuffer(payload.length);
        t._buf = new Float64Array(payload.buffer);
        t.length = payload.length;
        t.capacity = payload.length;
        return t;
    }

    toCandleObjects() {
        const out = new Array(this.length);
        const b = this._buf;
        for (let i = 0; i < this.length; i++) {
            const o = i * CANDLE_STRIDE;
            out[i] = {
                time: b[o + OFF_TIME],
                open: b[o + OFF_O],
                high: b[o + OFF_H],
                low: b[o + OFF_L],
                close: b[o + OFF_C],
                volume: b[o + OFF_V],
            };
        }
        return out;
    }
}

window.TypedCandleBuffer = TypedCandleBuffer;
window.CANDLE_STRIDE = CANDLE_STRIDE;
