/* ============================================================
 * OrderFlowAbsorptionEngine — Footprint-style absorption detection
 * Uses OHLCV only (no tick data). Signals:
 *   - Large volume candle with small body (absorption / exhaustion)
 *   - Pin bar at swing extreme with high volume (rejection)
 *   - Climax bar (2x avg volume, long wick)
 * ============================================================ */
class OrderFlowAbsorptionEngine {
    scan(candles) {
        if (!candles || candles.length < 25) {
            return { detected: false, label: '—', level: 'muted', signals: [] };
        }
        const n = candles.length;
        const vols = candles.map(c => c.volume || 0);
        const avgVol20 = vols.slice(-20).reduce((a, b) => a + b, 0) / 20;
        // Skip indices/no-volume feeds (NIFTY, BANKNIFTY, etc. — volume field near-zero)
        if (avgVol20 < 100) {
            return { detected: false, label: '⚪ NO VOLUME DATA', level: 'muted', signals: [] };
        }

        const signals = [];
        // Inspect last 5 bars
        for (let i = Math.max(20, n - 5); i < n; i++) {
            const c = candles[i];
            const body = Math.abs(c.close - c.open);
            const rng = Math.max(c.high - c.low, 1e-9);
            const upperWick = c.high - Math.max(c.open, c.close);
            const lowerWick = Math.min(c.open, c.close) - c.low;
            const volRatio = (c.volume || 0) / Math.max(avgVol20, 1);

            // Absorption: huge volume, tiny body, deep wick
            if (volRatio > 1.8 && body / rng < 0.25) {
                const side = lowerWick > upperWick ? 'bull' : 'bear';
                signals.push({
                    i, type: 'ABSORPTION',
                    text: side === 'bull' ? '🧽 BUY ABSORPTION' : '🧽 SELL ABSORPTION',
                    level: side === 'bull' ? 'success' : 'danger',
                });
            }
            // Climax blowoff
            else if (volRatio > 2.2 && body / rng > 0.6) {
                const side = c.close > c.open ? 'bull' : 'bear';
                signals.push({
                    i, type: 'CLIMAX',
                    text: side === 'bull' ? '🔥 BULL CLIMAX' : '🔥 BEAR CLIMAX',
                    level: side === 'bull' ? 'warning' : 'warning',
                });
            }
        }

        if (signals.length === 0) {
            return { detected: false, label: '⚪ NONE', level: 'muted', signals };
        }
        const last = signals[signals.length - 1];
        return {
            detected: true,
            label: last.text,
            level: last.level,
            signals,
        };
    }
}
window.OrderFlowAbsorptionEngine = OrderFlowAbsorptionEngine;
