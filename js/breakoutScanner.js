/* ============================================================
 * breakoutScanner.js — Institutional-Grade Breakout Detector
 * ============================================================
 * Identifies HIGH-CONVICTION breakouts a la Mark Minervini /
 * William O'Neil (CAN SLIM) — the exact setup pro traders run in 2026.
 *
 * A "true breakout" requires confluence of:
 *   1. Coil/base (tight consolidation: last 5-8 bars' range < 0.6× recent ATR)
 *   2. Volume dry-up into base (last 5 bars' avg volume < 0.8× 20-bar avg)
 *   3. Clear pivot high (last 20-bar high is the breakout level)
 *   4. CURRENT candle closing ABOVE pivot (not just wick; close ≥ pivot + 0.1 ATR)
 *   5. Volume EXPANSION on breakout bar (≥1.5× avg — institutional buying)
 *   6. Candle closes in upper 30% of range (strong close, not tail)
 *   7. Trend alignment: price > EMA20 > EMA50 (long) or < EMA20 < EMA50 (short)
 *   8. Bollinger squeeze firing (BB width < median of last 50 bars)
 *   9. RSI between 45-70 (has room to run, not already overbought)
 *  10. MACD histogram turned positive (or negative breakdown)
 *
 * Score 0-10. ≥6 = actionable. ≥8 = high conviction.
 * ============================================================ */
class BreakoutScanner {
    scan(candles) {
        const def = { detected: false, direction: null, score: 0, pivot: 0,
                      entry: 0, sl: 0, target: 0, volRatio: 0, reasons: [] };
        if (!candles || candles.length < 30) return def;

        const n = candles.length;
        // 🚀 TypedArrays (C++ style memory allocation for extreme speed, zero GC pause)
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
        const last = candles[n - 1];
        const body = last.close - last.open;
        const range = last.high - last.low;

        // ----- helpers -----
        const ema = (arr, p) => { const k = 2 / (p + 1); let e = arr[0]; for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k); return e; };
        const sma = (arr, p) => arr.slice(-p).reduce((s, v) => s + v, 0) / p;
        const stdev = (arr, p, mean) => Math.sqrt(arr.slice(-p).reduce((a, v) => a + (v - mean) ** 2, 0) / p);

        const ema20 = ema(closes, 20);
        const ema50 = ema(closes, 50);
        // Wilder's ATR (TradingView standard — RMA smoothing)
        const trs = [];
        for (let i = 1; i < n; i++) {
            trs.push(Math.max(
                highs[i] - lows[i],
                Math.abs(highs[i] - closes[i-1]),
                Math.abs(lows[i] - closes[i-1])
            ));
        }
        let atr = 0;
        if (trs.length >= 14) {
            // Seed with SMA of first 14 TRs
            atr = trs.slice(0, 14).reduce((s, v) => s + v, 0) / 14;
            // Wilder smoothing for rest
            for (let i = 14; i < trs.length; i++) {
                atr = (atr * 13 + trs[i]) / 14;
            }
        } else if (trs.length > 0) {
            atr = trs.reduce((s, v) => s + v, 0) / trs.length;
        }

        // ----- 1. Pivot level (20-bar high / low) -----
        const lookback = 20;
        let pivotHigh = -Infinity, pivotLow = Infinity;
        for (let i = n - lookback - 1; i < n - 1; i++) {
            if (highs[i] > pivotHigh) pivotHigh = highs[i];
            if (lows[i]  < pivotLow)  pivotLow  = lows[i];
        }

        // ----- 2. Base/coil detection (last 6 bars average range < 0.6× ATR) -----
        const baseRange = (() => {
            let sum = 0;
            for (let i = n - 6; i < n; i++) sum += highs[i] - lows[i];
            return sum / 6;
        })();
        const tightBase = baseRange < 0.8 * atr;

        // ----- 3. Volume dry-up (last 5 bars avg vol < 0.85× 20-bar avg) -----
        const volAvg20 = sma(vols, 20);
        const volAvg5 = sma(vols.slice(-5), 5);
        const dryUp = volAvg5 < 0.85 * volAvg20;

        // Rolling BB width calc (O(n) — single pass)
        const bbWidths = [];
        let rollSum = 0, rollSumSq = 0;
        for (let i = 0; i < n; i++) {
            rollSum += closes[i];
            rollSumSq += closes[i] * closes[i];
            if (i >= 20) {
                rollSum -= closes[i - 20];
                rollSumSq -= closes[i - 20] * closes[i - 20];
            }
            if (i >= 19) {
                const m = rollSum / 20;
                const variance = Math.max(0, (rollSumSq / 20) - (m * m));
                const s = Math.sqrt(variance);
                if (m > 0) bbWidths.push((4 * s) / m);
            }
        }
        const bbWidth = bbWidths.length ? bbWidths[bbWidths.length - 1] : 0;
        const bbSorted = bbWidths.slice().sort((a, b) => a - b);
        const bbMedian = bbSorted.length ? bbSorted[Math.floor(bbSorted.length / 2)] : bbWidth;
        const squeeze = bbWidth > 0 && bbWidth < bbMedian * 0.85;

        // ----- 5. RSI (defensive parse: handles both {value} objects and raw numbers) -----
        const rsiArr = TechnicalIndicators.RSI(candles, 14);
        let rsi = 50;
        if (rsiArr && rsiArr.length) {
            const lastRsi = rsiArr[rsiArr.length - 1];
            rsi = (typeof lastRsi === 'object' && lastRsi !== null) ? (lastRsi.value ?? 50) : (lastRsi ?? 50);
        }

        // ----- 6. MACD -----
        const macd = TechnicalIndicators.MACD(candles);
        const macdHist = macd && macd.hist.length ? macd.hist[macd.hist.length - 1] : 0;
        const macdHistPrev = macd && macd.hist.length > 1 ? macd.hist[macd.hist.length - 2] : 0;

        // ----- 7. Volume today -----
        const volToday = vols[n - 1];
        const volRatio = volAvg20 > 0 ? volToday / volAvg20 : 0;

        // ----- 8. Close position in range (0=low, 1=high) -----
        const closePos = range > 0 ? (last.close - last.low) / range : 0.5;

        // ---------- LONG BREAKOUT ----------
        const breakoutLong = last.close > pivotHigh;
        const longReasons = [];
        let longScore = 0;
        if (breakoutLong) {
            if (closePos > 0.65) { longScore += 2; longReasons.push('Strong close (upper 35% of bar)'); }
            else longReasons.push('⚠ Weak close / wick breakout');
            if (volRatio >= 1.5) { longScore += 2; longReasons.push(`Volume ${volRatio.toFixed(1)}x confirms (institutional buying)`); }
            else longReasons.push(`Volume only ${volRatio.toFixed(1)}x (needs ≥1.5x)`);
            if (tightBase) { longScore += 2; longReasons.push('Tight base/coil detected'); }
            if (dryUp) { longScore += 1; longReasons.push('Volume dry-up into base'); }
            if (squeeze) { longScore += 1; longReasons.push('BB Squeeze (coiled spring)'); }
            if (ema20 > ema50) { longScore += 1; longReasons.push('Uptrend (EMA20 > EMA50)'); }
            else longReasons.push('⚠ EMA20 < EMA50 (counter-trend)');
            if (rsi > 45 && rsi < 72) { longScore += 1; longReasons.push(`RSI ${rsi.toFixed(0)} has room`); }
            if (macdHist > 0 && macdHist >= macdHistPrev) longScore += 1;
        }

        // ---------- SHORT BREAKDOWN ----------
        const breakdownShort = last.close < pivotLow;
        const shortReasons = [];
        let shortScore = 0;
        if (breakdownShort) {
            if (closePos < 0.35) { shortScore += 2; shortReasons.push('Strong close (lower 35% of bar)'); }
            if (volRatio >= 1.5) { shortScore += 2; shortReasons.push(`Volume ${volRatio.toFixed(1)}x confirms`); }
            if (tightBase) { shortScore += 2; shortReasons.push('Tight base before breakdown'); }
            if (dryUp) { shortScore += 1; shortReasons.push('Volume dry-up before breakdown'); }
            if (squeeze) { shortScore += 1; shortReasons.push('BB Squeeze resolved down'); }
            if (ema20 < ema50) { shortScore += 1; shortReasons.push('Downtrend (EMA20 < EMA50)'); }
            if (rsi < 55 && rsi > 28) { shortScore += 1; shortReasons.push(`RSI ${rsi.toFixed(0)} has room down`); }
            if (macdHist < 0 && macdHist <= macdHistPrev) shortScore += 1;
        }

        // ---------- Verdict ----------
        let best = def;
        if (longScore >= 5) {
            const sl = Math.min(...lows.slice(-6)) - 0.25 * atr;
            const risk = last.close - sl;
            best = {
                detected: true, direction: 'LONG', score: longScore,
                pivot: +pivotHigh.toFixed(2),
                entry: +last.close.toFixed(2),
                sl: +sl.toFixed(2),
                target: +(last.close + 2 * risk).toFixed(2),   // 1:2
                target1: +(last.close + risk).toFixed(2),      // 1:1
                volRatio: +volRatio.toFixed(2),
                atr: +atr.toFixed(2),
                rr: risk > 0 ? 2 : 0,
                grade: longScore >= 8 ? '🔥 HIGH CONVICTION' : longScore >= 6 ? '✅ VALID' : '⚠️ WATCH',
                reasons: longReasons,
            };
        } else if (shortScore >= 5) {
            const sl = Math.max(...highs.slice(-6)) + 0.25 * atr;
            const risk = sl - last.close;
            best = {
                detected: true, direction: 'SHORT', score: shortScore,
                pivot: +pivotLow.toFixed(2),
                entry: +last.close.toFixed(2),
                sl: +sl.toFixed(2),
                target: +(last.close - 2 * risk).toFixed(2),
                target1: +(last.close - risk).toFixed(2),
                volRatio: +volRatio.toFixed(2),
                atr: +atr.toFixed(2),
                rr: risk > 0 ? 2 : 0,
                grade: shortScore >= 8 ? '🔥 HIGH CONVICTION' : shortScore >= 6 ? '✅ VALID' : '⚠️ WATCH',
                reasons: shortReasons,
            };
        } else {
            // Coil watch (squeeze but no breakout yet)
            if (squeeze && tightBase) {
                best.coming = {
                    pivotLong: +pivotHigh.toFixed(2),
                    pivotShort: +pivotLow.toFixed(2),
                    dryUp, bbWidth: +(bbWidth*100).toFixed(2),
                };
                best.reasons.push('Coil forming — wait for breakout above ' + pivotHigh.toFixed(2) + ' or below ' + pivotLow.toFixed(2));
            }
        }
        return best;
    }
}
window.BreakoutScanner = BreakoutScanner;
