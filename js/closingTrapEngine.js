/* ============================================================
 * ClosingTrapEngine (v2026.10)
 * ============================================================
 * Detects institutional "trap" spikes ONLY during the final
 * 3:15-3:30 PM IST window (last 15 min of NSE session).
 * Outside that window returns INACTIVE (no false signals).
 * Requirements: intraday TF (1/3/5/15/30m), not daily.
 * ============================================================ */
class ClosingTrapEngine {
    analyze(candles, tf = '15') {
        const nowIST = new Date(Date.now() + 5.5 * 3600 * 1000);
        const h = nowIST.getUTCHours(), m = nowIST.getUTCMinutes();
        const t = h * 60 + m;
        const inWindow = t >= (15 * 60 + 15) && t <= (15 * 60 + 30);
        const nearEOD  = t >= (14 * 60 + 45) && t <  (15 * 60 + 15);

        if (tf === 'D' || tf === '60') {
            return { trap: false, active: false, label: 'N/A', level: 'muted', direction: null };
        }

        if (!candles || candles.length < 10) {
            return { trap: false, active: inWindow, label: inWindow ? 'WATCHING' : '-', level: 'muted', direction: null };
        }

        const n = candles.length;
        const last10 = candles.slice(-10);
        const lastVol = candles[n - 1].volume || 0;
        const vol10 = last10.reduce((s, c) => s + (c.volume || 0), 0) / 10;
        const dir10 = candles[n - 1].close - candles[n - 10].close;
        const dir3  = candles[n - 1].close - candles[n - 3].close;

        // Trap ONLY fires in the 3:15-3:30 window
        let trap = false, direction = null;
        if (inWindow) {
            if (dir10 > 0 && dir3 < -Math.abs(dir10) * 0.35 && lastVol < vol10 * 0.9) {
                trap = true; direction = 'bear';
            } else if (dir10 < 0 && dir3 > Math.abs(dir10) * 0.35 && lastVol < vol10 * 0.9) {
                trap = true; direction = 'bull';
            }
        }

        let label, level;
        if (trap) {
            label = direction === 'bear' ? 'SELL TRAP' : 'BUY TRAP';
            level = direction === 'bear' ? 'danger' : 'success';
        } else if (inWindow) {
            label = 'WATCHING';
            level = 'warning';
        } else if (nearEOD) {
            label = 'APPROACHING';
            level = 'muted';
        } else {
            label = 'INACTIVE (3:15-3:30 PM IST)';
            level = 'muted';
        }

        return { trap, active: inWindow, label, level, direction };
    }
}
window.ClosingTrapEngine = ClosingTrapEngine;
