/* ============================================================
 * BigCandleDetector (v2026.10)
 * Detects an oversized candle *while it is forming* (live),
 * so the trader can enter on momentum.
 * Rules (TradingView/ICT momentum candle):
 *  - Body size (|close-open|) >= 1.8x avg of last 10 closed-candle bodies
 *  - Candle must be >50% complete (so we don't fire at first tick)
 *  - Volume >= 1.2x avg volume (confirms institutional participation)
 *  - Fires at most ONCE per forming candle (per TF) using internal cooldown key
 * ============================================================ */
class BigCandleDetector {
    constructor() {
        this.lastFireKey = null;   // ts+dir cooldown
    }

    analyze(candles, tf = '15') {
        const defaults = { forming: false, label: '—', level: 'muted', dir: null, magnitude: 0 };
        if (!candles || candles.length < 12) return defaults;

        const tfMinMap = { '1':1,'3':3,'5':5,'15':15,'30':30,'60':60,'D':1440 };
        const tfMin = tfMinMap[tf] || 15;
        const tfSec = tfMin * 60;

        const last = candles[candles.length - 1];
        const body = Math.abs(last.close - last.open);
        const dir = last.close >= last.open ? 'bull' : 'bear';

        // Avg body + volume of prior 10 *closed* candles (exclude current)
        const prior = candles.slice(-11, -1);
        const avgBody = prior.reduce((s, c) => s + Math.abs(c.close - c.open), 0) / prior.length;
        const avgVol  = prior.reduce((s, c) => s + (c.volume || 0), 0) / prior.length;

        // Need meaningful avgBody — else skip (all-doji base = no signal)
        if (avgBody <= 0 || avgVol <= 0) {
            return { ...defaults, magnitude: 0, volRatio: 0 };
        }

        // Normalize last.time to seconds (handles ms, s, or {year,month,day} business-day objects from LWC v5)
        const _toSec = (t) => {
            if (typeof t === 'number') return t > 1e10 ? Math.floor(t / 1000) : Math.floor(t);
            if (t && typeof t === 'object' && t.year) return Math.floor(new Date(t.year, (t.month||1)-1, t.day||1).getTime() / 1000);
            return Math.floor(new Date(t).getTime() / 1000);
        };
        const lastTimeSec = _toSec(last.time);
        const now = Math.floor(Date.now() / 1000);
        const sinceStart = Math.max(0, now - lastTimeSec);
        const pct = tfSec > 0 ? Math.min(sinceStart / tfSec, 1) : 1;

        // Don't fire at <40% (too early — noise) or >95% (candle already closed)
        const forming = pct >= 0.4 && pct < 0.95;
        const mag = body / avgBody;
        const volRatio = (last.volume || 0) / avgVol;
        const bigEnough = mag >= 1.8 && volRatio >= 1.2;

        const key = `${last.time}_${dir}`;
        if (forming && bigEnough) {
            if (this.lastFireKey === key) {
                return { forming: true, alreadyFired: true, label: `${dir === 'bull' ? '▲' : '▼'} BIG ${dir.toUpperCase()} ${mag.toFixed(1)}x`, level: dir === 'bull' ? 'success' : 'danger', dir, magnitude: mag, volRatio };
            }
            this.lastFireKey = key;
            return { forming: true, fresh: true, label: `${dir === 'bull' ? '▲' : '▼'} BIG ${dir.toUpperCase()} ${mag.toFixed(1)}x forming!`, level: dir === 'bull' ? 'success' : 'danger', dir, magnitude: mag, volRatio };
        }
        // Reset cooldown when candle closes (time moves to new bar)
        if (pct >= 1) { this.lastFireKey = null; }
        return { ...defaults, magnitude: mag, volRatio };
    }
}
window.BigCandleDetector = BigCandleDetector;
