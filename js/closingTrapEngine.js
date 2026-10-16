/* ============================================================
 * ClosingTrapEngine — 3:15-3:30 PM IST institutional trap detector
 * Flags:
 *   - Late sharp spike on LOW volume (likely trap before MTM margin call)
 *   - Reversal in last 3 bars after a directional run
 *   - Requires intraday data (≤15m). Returns INACTIVE on daily/after hours.
 * ============================================================ */
class ClosingTrapEngine {
    analyze(candles, tf = '15') {
        const nowIST = new Date(Date.now() + 5.5 * 3600 * 1000);
        const h = nowIST.getUTCHours(), m = nowIST.getUTCMinutes();
        const t = h * 60 + m; // minutes since midnight IST
        const inWindow = t >= (15 * 60 + 15) && t <= (15 * 60 + 30);
        const nearEOD  = t >= (14 * 60 + 45) && t <= (15 * 60 + 30);

        if (tf === 'D' || tf === '60') {
            return { trap: false, active: false, label: 'N/A (Daily/1H)', level: 'muted', direction: null };
        }

        if (!candles || candles.length < 10) {
            return { trap: false, active: inWindow, label: '—', level: 'muted', direction: null };
        }

        const n = candles.length;
        const last3 = candles.slice(-3);
        const last10 = candles.slice(-10);

        const vol10 = last10.reduce((s, c) => s + (c.volume || 0), 0) / 10;
        const lastVol = candles[n - 1].volume || 0;
        const dir10 = candles[n - 1].close - candles[n - 10].close;
        const dir3  = candles[n - 1].close - candles[n - 3].close;

        // Trap condition: trend in last 10 bars reverses hard in last 3 bars on <70% volume
        let direction = null;
        let trap = false;
        if (dir10 > 0 && dir3 < -Math.abs(dir10) * 0.35 && lastVol < vol10 * 0.9) {
            trap = true;
            direction = 'bear'; // bullish day, but late dump → sell trap
        } else if (dir10 < 0 && dir3 > Math.abs(dir10) * 0.35 && lastVol < vol10 * 0.9) {
            trap = true;
            direction = 'bull'; // bearish day, late spike → buy trap
        }

        let label, level;
        if (trap) {
            label = direction === 'bear' ? '🚨 SELL TRAP' : '🚨 BUY TRAP';
            level = direction === 'bear' ? 'danger' : 'success';
        } else if (inWindow) {
            label = '👀 WATCHING';
            level = 'warning';
        } else if (nearEOD) {
            label = '⏳ APPROACHING';
            level = 'muted';
        } else {
            label = `INACTIVE (3:15–3:30 PM IST)`;
            level = 'muted';
        }

        return { trap, active: inWindow, label, level, direction };
    }
}
window.ClosingTrapEngine = ClosingTrapEngine;
