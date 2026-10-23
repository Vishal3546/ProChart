/* ============================================================
 * DoubleBottomEngine — Detects Double Bottoms & Double Tops
 * Criteria:
 *   - Two swing lows within 1-3% of each other (W bottom)
 *   - Separated by a peak (neckline) at least 3% above
 *   - Neckline broken on confirming candle
 * ============================================================ */
class DoubleBottomEngine {
    scan(candles) {
        if (!candles || candles.length < 40) {
            return { detected: false, pattern: null, label: '—', level: 'muted' };
        }
        const n = candles.length;
        // 🚀 TypedArrays (Zero Garbage Collection pause — hardware-level speed)
        const closes = new Float64Array(n);
        const highs  = new Float64Array(n);
        const lows   = new Float64Array(n);
        const vols   = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            closes[i] = candles[i].close;
            highs[i]  = candles[i].high;
            lows[i]   = candles[i].low;
            vols[i]   = candles[i].volume || 0;
        }

        // Find swing lows over last 60 bars (asymmetric window near current bar)
        const lows_arr = [];
        const look = Math.min(60, n - 3);
        for (let i = n - 2; i >= n - look; i--) {
            const wL = 3;
            const wR = Math.min(3, n - 1 - i); // shrink right-window near current bar
            if (wR < 1) continue;
            let isPivot = true;
            for (let j = 1; j <= wL; j++) {
                if (i - j < 0 || lows[i] >= lows[i - j]) { isPivot = false; break; }
            }
            if (isPivot) {
                for (let j = 1; j <= wR; j++) {
                    if (lows[i] >= lows[i + j]) { isPivot = false; break; }
                }
            }
            if (isPivot) lows_arr.push({ i, val: lows[i] });
            if (lows_arr.length >= 4) break;
        }
        lows_arr.sort((a, b) => a.i - b.i);

        // Check pairs
        for (let a = 0; a < lows_arr.length - 1; a++) {
            for (let b = a + 1; b < lows_arr.length; b++) {
                const A = lows_arr[a], B = lows_arr[b];
                if (B.i - A.i < 5 || B.i - A.i > 35) continue;
                const depthDiff = Math.abs(A.val - B.val) / Math.min(A.val, B.val);
                if (depthDiff > 0.025) continue; // two lows within 2.5%
                const neckline = Math.max(...highs.slice(A.i, B.i + 1));
                if (neckline < Math.max(A.val, B.val) * 1.02) continue; // neckline >= 2% above
                // Confirmation: close above neckline after B
                const after = closes.slice(B.i);
                const confirmed = after.some(p => p >= neckline);
                const near = closes[n - 1] >= neckline * 0.99;
                if (confirmed || near) {
                    return {
                        detected: true,
                        pattern: 'DOUBLE BOTTOM',
                        label: '🟢 W-BOTTOM',
                        level: 'success',
                        target: neckline + (neckline - Math.min(A.val, B.val)),
                    };
                }
            }
        }

        // Mirror: double top (same asymmetric window)
        const highs_arr = [];
        for (let i = n - 2; i >= n - look; i--) {
            const wL = 3;
            const wR = Math.min(3, n - 1 - i);
            if (wR < 1) continue;
            let isPivot = true;
            for (let j = 1; j <= wL; j++) {
                if (i - j < 0 || highs[i] <= highs[i - j]) { isPivot = false; break; }
            }
            if (isPivot) {
                for (let j = 1; j <= wR; j++) {
                    if (highs[i] <= highs[i + j]) { isPivot = false; break; }
                }
            }
            if (isPivot) highs_arr.push({ i, val: highs[i] });
            if (highs_arr.length >= 4) break;
        }
        highs_arr.sort((a, b) => a.i - b.i);
        for (let a = 0; a < highs_arr.length - 1; a++) {
            for (let b = a + 1; b < highs_arr.length; b++) {
                const A = highs_arr[a], B = highs_arr[b];
                if (B.i - A.i < 5 || B.i - A.i > 35) continue;
                const topDiff = Math.abs(A.val - B.val) / Math.max(A.val, B.val);
                if (topDiff > 0.025) continue;
                const neckline = Math.min(...lows.slice(A.i, B.i + 1));
                if (neckline > Math.min(A.val, B.val) * 0.98) continue;
                const after = closes.slice(B.i);
                const confirmed = after.some(p => p <= neckline);
                if (confirmed) {
                    return {
                        detected: true,
                        pattern: 'DOUBLE TOP',
                        label: '🔴 M-TOP',
                        level: 'danger',
                        target: neckline - (Math.max(A.val, B.val) - neckline),
                    };
                }
            }
        }

        return { detected: false, pattern: null, label: '⚪ NONE', level: 'muted' };
    }
}
window.DoubleBottomEngine = DoubleBottomEngine;
