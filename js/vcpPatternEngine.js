/* ============================================================
 * VCPPatternEngine — Mark Minervini Volatility Contraction Pattern
 * Looks for 2-3 successive pivot highs with contracting ranges
 * and diminishing volume, plus a tight consolidation.
 * ============================================================ */
class VCPPatternEngine {
    scan(candles) {
        if (!candles || candles.length < 60) {
            return { detected: false, label: 'INSUFF DATA', level: 'muted', details: null };
        }
        const n = candles.length;
        const closes = candles.map(c => c.close);
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const vols = candles.map(c => c.volume || 0);
        const atr = TechnicalIndicators.ATR(candles, 14);

        // Find recent swing highs over last 60 bars (prominent pivots)
        const pivots = [];
        for (let i = n - 5; i >= Math.max(20, n - 60); i--) {
            const w = 3;
            let isPivot = true;
            for (let j = 1; j <= w; j++) {
                if (highs[i] <= highs[i - j] || highs[i] <= highs[i + j]) { isPivot = false; break; }
            }
            if (isPivot) pivots.push({ i, val: highs[i] });
            if (pivots.length >= 3) break;
        }
        pivots.reverse();
        if (pivots.length < 2) {
            return { detected: false, label: 'NO PIVOTS', level: 'muted', details: null };
        }

        // Contraction: ranges between pivots shrink, and volume dries up
        const contractions = [];
        for (let k = 1; k < pivots.length; k++) {
            const prev = pivots[k - 1];
            const cur = pivots[k];
            const segHigh = Math.max(...highs.slice(prev.i, cur.i + 1));
            const segLow = Math.min(...lows.slice(prev.i, cur.i + 1));
            const rangePct = (segHigh - segLow) / segLow;
            const segVol = vols.slice(prev.i, cur.i + 1).reduce((a, b) => a + b, 0) / (cur.i - prev.i + 1);
            contractions.push({ rangePct, avgVol: segVol });
        }

        let contractingRanges = true;
        let contractingVol = true;
        for (let k = 1; k < contractions.length; k++) {
            if (contractions[k].rangePct > contractions[k - 1].rangePct * 1.05) contractingRanges = false;
            if (contractions[k].avgVol > contractions[k - 1].avgVol * 1.1) contractingVol = false;
        }

        // Tightness: recent ATR% < median ATR% over lookback
        const atrPcts = [];
        for (let i = 30; i < n; i++) {
            if (atr[i] != null) atrPcts.push(atr[i] / closes[i]);
        }
        const sorted = atrPcts.slice().sort((a, b) => a - b);
        const med = sorted[Math.floor(sorted.length / 2)];
        const curAtrPct = atr[n - 1] / closes[n - 1];
        const tight = curAtrPct < med * 0.8;

        // Price near top of base (within 5% of pivot high)
        const lastPivot = pivots[pivots.length - 1].val;
        const nearTop = closes[n - 1] >= lastPivot * 0.95;

        const detected = contractingRanges && tight && nearTop;

        // Build label
        let label, level;
        if (detected && contractingVol) { label = '🟢 VALID VCP'; level = 'success'; }
        else if (contractingRanges && tight) { label = '🟡 VCP (W/O VOL DRY-UP)'; level = 'warning'; }
        else if (contractingRanges) { label = '🟡 CONTRACTING'; level = 'warning'; }
        else { label = '⚪ NO VCP'; level = 'muted'; }

        return {
            detected,
            label,
            level,
            details: {
                pivots: pivots.length,
                contractions: contractions.length,
                contractingRanges,
                contractingVol,
                tight,
                nearTop,
                curAtrPct: (curAtrPct * 100).toFixed(2) + '%',
            },
        };
    }
}
window.VCPPatternEngine = VCPPatternEngine;
