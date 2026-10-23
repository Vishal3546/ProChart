/* ============================================================
 * FlagPatternEngine — Bull/Bear flags & pennants
 * Detects strong impulse (>=2 ATR move over <= 8 bars) followed by
 * a tight counter-trend channel (flag) sloping against the impulse.
 * ============================================================ */
class FlagPatternEngine {
    scan(candles) {
        if (!candles || candles.length < 30) {
            return { detected: false, label: '—', level: 'muted', dir: null };
        }
        const n = candles.length;
        // 🚀 TypedArrays (Zero Garbage Collection pause)
        const closes = new Float64Array(n);
        const highs  = new Float64Array(n);
        const lows   = new Float64Array(n);
        for (let i = 0; i < n; i++) {
            closes[i] = candles[i].close;
            highs[i]  = candles[i].high;
            lows[i]   = candles[i].low;
        }
        const atrArr = TechnicalIndicators.ATR(candles, 14) || [];
        const lastAtr = atrArr[atrArr.length - 1];
        const curAtr = (typeof lastAtr === 'object' && lastAtr !== null) ? lastAtr.value : lastAtr;
        if (!curAtr || !isFinite(curAtr) || curAtr <= 0) {
            return { detected: false, label: '⚪ NONE', level: 'muted', dir: null };
        }

        // Look back over last 25 bars for an impulse
        for (let impLen = 4; impLen <= 9; impLen++) {
            const start = n - 1 - impLen - 12; // impulse ends up to 12 bars back, then consolidation
            if (start < 1) continue;
            const impulseStart = start;
            const impulseEnd = start + impLen;
            const move = closes[impulseEnd] - closes[impulseStart];
            const moveAtr = Math.abs(move) / curAtr;
            if (moveAtr < 2.5) continue;

            const dir = move > 0 ? 'bull' : 'bear';
            // Consolidation: impulseEnd .. n-1
            const cHigh = Math.max(...highs.slice(impulseEnd, n));
            const cLow = Math.min(...lows.slice(impulseEnd, n));
            const cLen = n - impulseEnd;
            if (cLen < 3 || cLen > 12) continue;
            const cRange = cHigh - cLow;
            const cRangePct = cRange / Math.max(curAtr, 1e-9);
            if (cRangePct > 2.5) continue; // flag must be tight (<2.5 ATR)

            // Slope must drift counter-trend
            const cCloseStart = closes[impulseEnd];
            const cCloseEnd = closes[n - 1];
            const slope = (cCloseEnd - cCloseStart) / cCloseStart;
            const counterSlope = dir === 'bull' ? slope < 0.01 : slope > -0.01;
            if (!counterSlope) continue;

            // Breakout?
            if (dir === 'bull' && closes[n - 1] >= cHigh) {
                return { detected: true, label: '🚩 BULL FLAG BREAKOUT', level: 'success', dir };
            }
            if (dir === 'bear' && closes[n - 1] <= cLow) {
                return { detected: true, label: '🚩 BEAR FLAG BREAKDOWN', level: 'danger', dir };
            }
            return {
                detected: true,
                label: dir === 'bull' ? '🟡 BULL FLAG FORMING' : '🟡 BEAR FLAG FORMING',
                level: 'warning',
                dir,
            };
        }
        return { detected: false, label: '⚪ NONE', level: 'muted', dir: null };
    }
}
window.FlagPatternEngine = FlagPatternEngine;
