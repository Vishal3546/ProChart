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
        // VWAP
        let pv = 0, v = 0;
        for (let i = 0; i < n; i++) {
            const tp = (highs[i] + lows[i] + closes[i]) / 3;
            const vol = candles[i].volume || 0;
            pv += tp * vol; v += vol;
        }
        const vwap = v ? pv / v : ltp;
        // ATR(14)
        const trs = [];
        for (let i = 1; i < n; i++) {
            trs.push(Math.max(highs[i] - lows[i],
                Math.abs(highs[i] - closes[i - 1]),
                Math.abs(lows[i] - closes[i - 1])));
        }
        const atrP = Math.min(14, trs.length);
        let atr = trs.slice(-atrP).reduce((s, x) => s + x, 0) / atrP;

        // Swing low/high over last 8 bars
        const lookback = Math.min(8, n - 1);
        let swingLow = Infinity, swingHigh = -Infinity;
        for (let i = n - lookback; i < n; i++) {
            if (lows[i] < swingLow) swingLow = lows[i];
            if (highs[i] > swingHigh) swingHigh = highs[i];
        }

        const isBull = bias.bias === 'bull';
        let entry, sl, t1, t2, entryReason, slReason, t1Reason;

        if (isBull) {
            // Entry: pullback to EMA20 or VWAP (whichever is closer to LTP but below)
            const candidates = [ema20, vwap].filter(x => x < ltp);
            entry = candidates.length ? Math.max(...candidates) : Math.min(ema20, vwap);
            entryReason = entry.toFixed(2) === ema20.toFixed(2) ? 'EMA20 pullback' : 'VWAP pullback';
            // Stop: below recent swing low with ATR buffer
            sl = swingLow - 0.25 * atr;
            slReason = `Swing low ${swingLow.toFixed(2)} - 0.25 ATR`;
            // Target 1: BB upper or recent high (nearest resistance above LTP)
            t1 = Math.min(bbUpper, swingHigh + 0.5 * atr);
            t1 = Math.max(t1, ltp + atr);  // at least 1 ATR away
            t1Reason = 'BB upper / swing high';
            t2 = ltp + (ltp - sl) * 2;     // 1:2 RR
        } else {
            // BEAR plan
            const candidates = [ema20, vwap].filter(x => x > ltp);
            entry = candidates.length ? Math.min(...candidates) : Math.max(ema20, vwap);
            entryReason = entry.toFixed(2) === ema20.toFixed(2) ? 'EMA20 pullback' : 'VWAP pullback';
            sl = swingHigh + 0.25 * atr;
            slReason = `Swing high ${swingHigh.toFixed(2)} + 0.25 ATR`;
            t1 = Math.max(bbLower, swingLow - 0.5 * atr);
            t1 = Math.min(t1, ltp - atr);
            t1Reason = 'BB lower / swing low';
            t2 = ltp - (sl - ltp) * 2;
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

        // 1% risk rule: how many shares/contracts for ₹1,00,000 capital risking 1%?
        const capital = 100000;
        const riskPerShare = Math.abs(entry - sl);
        const qty = riskPerShare > 0 ? Math.floor((capital * 0.01) / riskPerShare) : 0;

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
            qty_1pct_risk_cap_1L: qty,
            verdict: rr1 >= 1.5 ? '✅ High probability setup (RR ≥ 1.5)' :
                     rr1 >= 1.0 ? '⚠️ Marginal setup (RR 1:1)' :
                     '❌ Skip — RR too low',
        };
    }
}
window.TradingPlanEngine = TradingPlanEngine;
