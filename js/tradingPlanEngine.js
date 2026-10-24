/* ============================================================
 * tradingPlanEngine.js — Entry / Stop-Loss / Target calculator (v2026.10)
 * v42: Bulletproof defaults, finite-number guarantees, RR sanity
 * ============================================================ */
class TradingPlanEngine {
    plan(candles, bias) {
        const fallback = {
            ready: false,
            reason: 'No strong bias — wait',
            direction: 'NEUTRAL',
            actionable: false, pending: false,
            ltp: 0, entry: 0, entryReason: '—',
            sl: 0, slReason: '—',
            t1: 0, t2: 0, t1Reason: '—',
            risk_per_share: 0, rr1: 0, rr2: 0, dist_pct: 0, atr: 0,
            qty_at_risk: 0, capital_used: 100000, risk_pct: 1,
            verdict: 'Wait for signal'
        };

        if (!candles || !Array.isArray(candles) || candles.length < 20 || !bias || bias.bias === 'neutral') {
            return fallback;
        }

        const n = candles.length;
        const closes = candles.map(c => Number(c.close) || 0);
        const highs = candles.map(c => Number(c.high) || 0);
        const lows = candles.map(c => Number(c.low) || 0);
        const last = candles[n - 1];
        const ltp = last ? Number(last.close) || 0 : 0;
        if (ltp <= 0) return fallback;

        const ema = (arr, p) => {
            const k = 2 / (p + 1);
            let e = arr[0] || 0;
            for (let i = 1; i < arr.length; i++) e = (arr[i] || 0) * k + e * (1 - k);
            return e;
        };

        const ema20 = ema(closes, 20);

        let vwap = ltp;
        if (window.TechnicalIndicators && typeof window.TechnicalIndicators.VWAP === 'function') {
            try {
                const vwapArr = window.TechnicalIndicators.VWAP(candles) || [];
                const lastVwap = vwapArr.length ? vwapArr[vwapArr.length - 1] : null;
                if (lastVwap != null && isFinite(lastVwap) && lastVwap > 0) vwap = lastVwap;
            } catch (_) {}
        }

        const trs = [];
        for (let i = 1; i < n; i++) {
            trs.push(Math.max(
                highs[i] - lows[i],
                Math.abs(highs[i] - closes[i - 1]),
                Math.abs(lows[i] - closes[i - 1])
            ));
        }
        const atrP = Math.min(14, trs.length);
        let atr = trs.length ? trs.slice(-atrP).reduce((s, x) => s + x, 0) / atrP : 0;
        if (!isFinite(atr) || atr <= 0) atr = ltp * 0.01; // 1% fallback ATR

        const pivotWindow = 2;
        let swingLow = Infinity, swingHigh = -Infinity;
        const startI = Math.max(pivotWindow + 1, n - Math.min(25, n));
        for (let i = startI; i < n - pivotWindow; i++) {
            let isSL = true, isSH = true;
            for (let k = i - pivotWindow; k <= i + pivotWindow; k++) {
                if (k === i) continue;
                if (lows[k] < lows[i]) isSL = false;
                if (highs[k] > highs[i]) isSH = false;
            }
            if (isSL && lows[i] < swingLow) swingLow = lows[i];
            if (isSH && highs[i] > swingHigh) swingHigh = highs[i];
        }
        if (!isFinite(swingLow)) swingLow = Math.min(...lows.slice(-10));
        if (!isFinite(swingHigh)) swingHigh = Math.max(...highs.slice(-10));

        const isBull = bias.bias === 'bull';
        let entry = ltp, sl = 0, t1 = 0, t2 = 0;
        let entryReason = '', slReason = '', t1Reason = '';

        if (isBull) {
            const belowLtp = [ema20, vwap].filter(x => isFinite(x) && x < ltp && x > 0);
            entry = belowLtp.length ? Math.max(...belowLtp) : ltp;
            entryReason = Math.abs(entry - ltp) < (atr * 0.2) ? 'Breakout / momentum' : 'Pullback zone';

            sl = swingLow - 0.25 * atr;
            if (!isFinite(sl) || sl >= entry) sl = entry - 1.5 * atr;
            slReason = `Swing low ${swingLow.toFixed(2)} - 0.25 ATR`;

            t1 = Math.max(swingHigh + 0.5 * atr, entry + 1.5 * (entry - sl));
            t1Reason = 'Target 1 (1.5x Risk)';
            t2 = entry + (entry - sl) * 2.0;
        } else {
            const aboveLtp = [ema20, vwap].filter(x => isFinite(x) && x > ltp);
            entry = aboveLtp.length ? Math.min(...aboveLtp) : ltp;
            entryReason = Math.abs(entry - ltp) < (atr * 0.2) ? 'Breakdown / momentum' : 'Pullback zone';

            sl = swingHigh + 0.25 * atr;
            if (!isFinite(sl) || sl <= entry) sl = entry + 1.5 * atr;
            slReason = `Swing high ${swingHigh.toFixed(2)} + 0.25 ATR`;

            t1 = Math.min(swingLow - 0.5 * atr, entry - 1.5 * (sl - entry));
            t1Reason = 'Target 1 (1.5x Risk)';
            t2 = entry - (sl - entry) * 2.0;
        }

        // Final finite-guards on every numeric field
        const _safe = (v, fb) => (isFinite(v) ? v : fb);
        entry = _safe(entry, ltp);
        sl = _safe(sl, isBull ? ltp - atr : ltp + atr);
        t1 = _safe(t1, isBull ? ltp + atr : ltp - atr);
        t2 = _safe(t2, isBull ? ltp + 2 * atr : ltp - 2 * atr);

        const risk = Math.abs(entry - sl);
        const reward1 = Math.abs(t1 - entry);
        const reward2 = Math.abs(t2 - entry);
        const rr1 = risk > 0 ? reward1 / risk : 0;
        const rr2 = risk > 0 ? reward2 / risk : 0;

        const distPct = ltp > 0 ? ((entry - ltp) / ltp) * 100 : 0;
        const actionable = Math.abs(distPct) < 0.6;

        const capital = (window.USER_CAPITAL && isFinite(window.USER_CAPITAL)) ? window.USER_CAPITAL : 100000;
        const riskPct = (window.USER_RISK_PCT && isFinite(window.USER_RISK_PCT)) ? window.USER_RISK_PCT : 0.01;
        const qty = risk > 0 ? Math.floor((capital * riskPct) / risk) : 0;

        return {
            ready: true,
            direction: isBull ? 'LONG' : 'SHORT',
            actionable, pending: !actionable,
            ltp: +ltp.toFixed(2),
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
            verdict: rr1 >= 1.5 ? '✅ High probability setup (RR ≥ 1.5)' : '⚠️ Marginal setup',
        };
    }
}
window.TradingPlanEngine = TradingPlanEngine;
