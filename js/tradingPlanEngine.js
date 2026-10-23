/* ============================================================
 * tradingPlanEngine.js — Entry / Stop-Loss / Target calculator
 * ============================================================
 * Given a bias direction (bull/bear) from TrendBiasEngine, computes
 * professional-style trade plan:
 *   - Entry zone  : pullback to nearest anchor (EMA20/VWAP/pivot)
 *   - Stop Loss   : recent swing low/high (with buffer) OR ATR-based
 *   - Target 1    : nearest resistance/support (Bollinger band or pivot)
 *   - Target 2    : 1:2 RR extension
 *   - RR ratio    : reward / risk (skip if < 1.5)
 *   - Position size suggestion (% of capital at 1% risk rule)
 *
 * Works on any timeframe. ATR is used for buffer sizes.
 * ============================================================ */
class TradingPlanEngine {
    plan(candles, bias) {
        if (!candles || candles.length < 30 || !bias || bias.bias === 'neutral') {
            return { ready: false, reason: 'No strong bias — wait' };
        }
        const n = candles.length;
        const closes = candles.map(c => c.close);
        const highs = candles.map(c => c.high);
        const lows = candles.map(c => c.low);
        const last = candles[n - 1];
        const ltp = last.close;

        // --- Indicators ---
        const ema = (arr, p) => {
            const k = 2 / (p + 1);
            let e = arr[0];
            for (let i = 1; i < arr.length; i++) e = arr[i] * k + e * (1 - k);
            return e;
        };
        const ema20 = ema(closes, 20);
        const ema50 = ema(closes, 50);
        const mid = closes.slice(-20).reduce((s, v) => s + v, 0) / 20;
        const sd = Math.sqrt(closes.slice(-20).reduce((s, v) => s + (v - mid) ** 2, 0) / 20);
        const bbUpper = mid + 2 * sd;
        const bbLower = mid - 2 * sd;
        // VWAP — session-anchored (TradingView standard)
        let vwap = ltp;
        if (window.TechnicalIndicators && TechnicalIndicators.VWAP) {
            const vwapArr = TechnicalIndicators.VWAP(candles);
            const lastVwap = vwapArr[vwapArr.length - 1];
            if (isFinite(lastVwap) && lastVwap > 0) vwap = lastVwap;
        } else {
            // Fallback: last 75 bars (approximates 1 session on 5m TF)
            let pv = 0, v = 0;
            const lookback = Math.min(75, n);
            for (let i = n - lookback; i < n; i++) {
                const tp = (highs[i] + lows[i] + closes[i]) / 3;
                const vol = candles[i].volume || 0;
                pv += tp * vol; v += vol;
            }
            vwap = v ? pv / v : ltp;
        }
        // ATR(14)
        const trs = [];
        for (let i = 1; i < n; i++) {
            trs.push(Math.max(highs[i] - lows[i],
                Math.abs(highs[i] - closes[i - 1]),
                Math.abs(lows[i] - closes[i - 1])));
        }
        const atrP = Math.min(14, trs.length);
        let atr = trs.slice(-atrP).reduce((s, x) => s + x, 0) / atrP;

        // Swing low/high: detect PROPER swing pivot (not just min/max of lookback window).
        // A swing low is a bar whose low is LOWER than 2 bars on either side.
        // A swing high is a bar whose high is HIGHER than 2 bars on either side.
        const pivotWindow = 2;
        let swingLow = Infinity, swingHigh = -Infinity;
        for (let i = n - Math.min(25, n); i < n - pivotWindow; i++) {
            if (i <= pivotWindow) continue;
            let isSL = true, isSH = true;
            for (let k = i - pivotWindow; k <= i + pivotWindow; k++) {
                if (k === i) continue;
                if (lows[k] < lows[i]) isSL = false;
                if (highs[k] > highs[i]) isSH = false;
            }
            if (isSL && lows[i] < swingLow) swingLow = lows[i];
            if (isSH && highs[i] > swingHigh) swingHigh = highs[i];
        }
        // Fallback: if no proper pivot detected in window, use bar-count lookback min/max
        // BUT for longs we look at LOWS of last 10 bars (not last 8) to find the support below LTP
        if (!isFinite(swingLow)) {
            swingLow = Math.min(...lows.slice(-10));
        }
        if (!isFinite(swingHigh)) {
            swingHigh = Math.max(...highs.slice(-10));
        }

        const isBull = bias.bias === 'bull';
        let entry, sl, t1, t2, entryReason, slReason, t1Reason;

        // --- Guard against ATR=0 (new/illiquid/too-few bars): can't compute a plan ---
        if (!isFinite(atr) || atr <= 0) {
            return { ready: false, reason: 'Not enough bars / ATR=0 — switch timeframe or wait' };
        }

        if (isBull) {
            // --- LONG plan: SL MUST be below entry, T2 MUST be above T1 ---
            // Entry: pullback to EMA20 OR VWAP (pick the closer of the two that is BELOW LTP,
            // i.e. price hasn't broken too far away). If both are above (extended),
            // buy current LTP (momentum breakout trade).
            const belowLtp = [ema20, vwap].filter(x => x < ltp);
            entry = belowLtp.length ? Math.max(...belowLtp) : ltp;
            entryReason = entry.toFixed(2) === ltp.toFixed(2) ? 'Breakout / momentum' :
                          (entry.toFixed(2) === ema20.toFixed(2) ? 'EMA20 pullback' : 'VWAP pullback');
            // SL: below nearest valid swing low with ATR buffer. If calculated SL ends up
            // ABOVE entry (edge case), fall back to entry - 1.5*ATR.
            sl = swingLow - 0.25 * atr;
            let slDegraded = false;
            if (sl >= entry) { sl = entry - 1.5 * atr; slDegraded = true; }
            slReason = slDegraded
                ? `1.5 ATR stop (no valid swing low below entry ${entry.toFixed(2)})`
                : `Swing low ${swingLow.toFixed(2)} - 0.25 ATR`;
            // T1: nearest resistance above entry (BB upper or recent swing high, whichever is closer)
            t1 = Math.min(bbUpper, swingHigh + 0.5 * atr);
            if (t1 <= entry) t1 = entry + Math.max(atr, (entry - sl) * 1.5);  // safety floor
            t1Reason = 'BB upper / swing high';
            // T2: fixed 1:2 RR extension (MUST be above T1)
            t2 = entry + (entry - sl) * 2;
            if (t2 <= t1) t2 = t1 + Math.abs(t1 - entry);  // safety
        } else {
            // --- SHORT plan: SL MUST be above entry, T2 MUST be below T1 ---
            const aboveLtp = [ema20, vwap].filter(x => x > ltp);
            entry = aboveLtp.length ? Math.min(...aboveLtp) : ltp;
            entryReason = entry.toFixed(2) === ltp.toFixed(2) ? 'Breakdown / momentum' :
                          (entry.toFixed(2) === ema20.toFixed(2) ? 'EMA20 pullback' : 'VWAP pullback');
            sl = swingHigh + 0.25 * atr;
            let slDegraded = false;
            if (sl <= entry) { sl = entry + 1.5 * atr; slDegraded = true; }
            slReason = slDegraded
                ? `1.5 ATR stop (no valid swing high above entry ${entry.toFixed(2)})`
                : `Swing high ${swingHigh.toFixed(2)} + 0.25 ATR`;
            t1 = Math.max(bbLower, swingLow - 0.5 * atr);
            if (t1 >= entry) t1 = entry - Math.max(atr, (sl - entry) * 1.5);
            t1Reason = 'BB lower / swing low';
            t2 = entry - (sl - entry) * 2;
            if (t2 >= t1) t2 = t1 - Math.abs(entry - t1);
        }

        const risk = Math.abs(entry - sl);
        const reward1 = Math.abs(t1 - entry);
        const reward2 = Math.abs(t2 - entry);
        const rr1 = risk > 0 ? reward1 / risk : 0;
        const rr2 = risk > 0 ? reward2 / risk : 0;

        // Entry distance from LTP — is setup actionable now or pending?
        const distPct = ((entry - ltp) / ltp) * 100;
        const actionable = Math.abs(distPct) < 0.6;  // within 0.6% of LTP
        const pending = !actionable;

        // 1% risk rule: configurable capital / risk % (reads window.USER_CAPITAL if set)
        const capital = window.USER_CAPITAL || 100000;
        const riskPct = window.USER_RISK_PCT || 0.01;  // 1% default per trade
        const riskPerShare = Math.abs(entry - sl);
        const qty = riskPerShare > 0 ? Math.floor((capital * riskPct) / riskPerShare) : 0;

        return {
            ready: true,
            direction: isBull ? 'LONG' : 'SHORT',
            actionable, pending,
            ltp: ltp,
            entry: +entry.toFixed(2),
            entryReason,
            sl: +sl.toFixed(2),
            slReason,
            t1: +t1.toFixed(2),
            t2: +t2.toFixed(2),
            t1Reason,
            risk_per_share: +risk.toFixed(2),
            rr1: +rr1.toFixed(2),
            rr2: +rr2.toFixed(2),
            dist_pct: +distPct.toFixed(2),
            atr: +atr.toFixed(2),
            qty_at_risk: qty,
            capital_used: capital,
            risk_pct: +(riskPct * 100).toFixed(2),
            verdict: rr1 >= 1.5 ? '✅ High probability setup (RR ≥ 1.5)' :
                     rr1 >= 1.0 ? '⚠️ Marginal setup (RR 1:1)' :
                     '❌ Skip — RR too low',
        };
    }
}
window.TradingPlanEngine = TradingPlanEngine;
