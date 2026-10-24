/* ============================================================
 * batchB_wrappers.js — Thin Main Thread Proxy Layer for Batch B
 * Bridges existing UI class instantiations to unified Worker results.
 * Every wrapper returns a FULLY SHAPED default object so UI code can
 * safely destructure .label / .level / .score / .factors / .entry etc.
 * BEFORE the first worker result arrives — no TypeError crashes.
 * ============================================================ */
const _MP_DEF = {
    score: 0, label: '—', level: 'muted',
    squeeze: { label: '—', level: 'muted' },
    vsa:     { label: '—', level: 'muted' },
    macd:    { label: '—', level: 'muted' },
    rsi:     { label: '—', level: 'muted' },
};
const _NC_DEF = { direction: 'neutral', score: 0, confidence: 'low', factors: [] };
const _OF_DEF = { detected: false, label: '—', level: 'muted', signals: [] };
const _TB_DEF = { score: 0, label: '⚪ NEUTRAL / CHOP', level: 'muted', bias: 'neutral', factors: { vwap: 0, ema: 0, rsi: 0 } };
const _TP_DEF = { ready: false, reason: 'No strong bias yet', direction: 'NEUTRAL', actionable: false, pending: false, ltp: 0, entry: 0, entryReason: '—', sl: 0, slReason: '—', t1: 0, t2: 0, t1Reason: '—', risk_per_share: 0, rr1: 0, rr2: 0, dist_pct: 0, atr: 0, qty_at_risk: 0, capital_used: 100000, risk_pct: 1, verdict: 'Awaiting data' };
const _VCP_DEF = { detected: false, label: '⚪ NO VCP', level: 'muted' };
const _PM_DEF = { pivot: 0, r1: 0, s1: 0, bc: 0, tc: 0, cprWidth: 0 };

class MasterProEngine {
    analyze(candles) {
        const w = window.analyticsBridge && window.analyticsBridge._latest;
        const r = w && w.masterPro;
        if (!r) return _MP_DEF;
        return Object.assign({}, _MP_DEF, r, {
            squeeze: Object.assign({}, _MP_DEF.squeeze, r.squeeze || {}),
            vsa:     Object.assign({}, _MP_DEF.vsa,     r.vsa     || {}),
            macd:    Object.assign({}, _MP_DEF.macd,    r.macd    || {}),
            rsi:     Object.assign({}, _MP_DEF.rsi,     r.rsi     || {}),
        });
    }
}
class NextCandlePredictor {
    analyze(candles) {
        const w = window.analyticsBridge && window.analyticsBridge._latest;
        return Object.assign({}, _NC_DEF, (w && w.nextCandle) || {});
    }
}
class OrderFlowAbsorptionEngine {
    scan(candles) {
        const w = window.analyticsBridge && window.analyticsBridge._latest;
        return Object.assign({}, _OF_DEF, (w && w.orderFlow) || {});
    }
}
class PreMarketEngine {
    calculatePivots(h, l, c) {
        const w = window.analyticsBridge && window.analyticsBridge._latest;
        return Object.assign({}, _PM_DEF, (w && w.pivots) || {});
    }
    analyze(candles) { return this.calculatePivots(); }
}
class TradingPlanEngine {
    plan(candles, bias) {
        const w = window.analyticsBridge && window.analyticsBridge._latest;
        return Object.assign({}, _TP_DEF, (w && w.tradePlan) || {});
    }
}
class TrendBiasEngine {
    analyze(candles) {
        const w = window.analyticsBridge && window.analyticsBridge._latest;
        const r = w && w.trendBias;
        if (!r) return _TB_DEF;
        return Object.assign({}, _TB_DEF, r, { factors: Object.assign({}, _TB_DEF.factors, r.factors || {}) });
    }
}
class VCPPatternEngine {
    scan(candles) {
        const w = window.analyticsBridge && window.analyticsBridge._latest;
        return Object.assign({}, _VCP_DEF, (w && w.vcp) || {});
    }
}

window.MasterProEngine = MasterProEngine;
window.NextCandlePredictor = NextCandlePredictor;
window.OrderFlowAbsorptionEngine = OrderFlowAbsorptionEngine;
window.PreMarketEngine = PreMarketEngine;
window.TradingPlanEngine = TradingPlanEngine;
window.TrendBiasEngine = TrendBiasEngine;
window.VCPPatternEngine = VCPPatternEngine;
