/* ============================================================
 * batchB_wrappers.js — Thin Main Thread Proxy Layer for Batch B
 * Bridges existing UI class instantiations to unified Worker results.
 * Engines return {} if Worker hasn't run yet (fail-open), so sync
 * rendering continues to work until first worker result arrives.
 * ============================================================ */
class MasterProEngine {
    analyze(candles) { return (window.analyticsBridge && window.analyticsBridge._latest && window.analyticsBridge._latest.masterPro) || {}; }
}
class NextCandlePredictor {
    analyze(candles) { return (window.analyticsBridge && window.analyticsBridge._latest && window.analyticsBridge._latest.nextCandle) || { direction: 'neutral', score: 0, confidence: 'low', factors: [] }; }
}
class OrderFlowAbsorptionEngine {
    scan(candles) { return (window.analyticsBridge && window.analyticsBridge._latest && window.analyticsBridge._latest.orderFlow) || { detected: false, label: '—', level: 'muted', signals: [] }; }
}
class PreMarketEngine {
    // Called with (h, l, c) by existing UI — returns worker pivots if available
    calculatePivots(h, l, c) { return (window.analyticsBridge && window.analyticsBridge._latest && window.analyticsBridge._latest.pivots) || null; }
    analyze(candles) { return this.calculatePivots(); }
}
class TradingPlanEngine {
    plan(candles, bias) { return (window.analyticsBridge && window.analyticsBridge._latest && window.analyticsBridge._latest.tradePlan) || { ready: false, reason: 'No strong bias yet' }; }
}
class TrendBiasEngine {
    analyze(candles) { return (window.analyticsBridge && window.analyticsBridge._latest && window.analyticsBridge._latest.trendBias) || { score: 0, label: 'NEUTRAL', level: 'muted', bias: 'neutral', factors: {} }; }
}
class VCPPatternEngine {
    scan(candles) { return (window.analyticsBridge && window.analyticsBridge._latest && window.analyticsBridge._latest.vcp) || { detected: false, label: '⚪ NO VCP', level: 'muted' }; }
}
window.MasterProEngine = MasterProEngine;
window.NextCandlePredictor = NextCandlePredictor;
window.OrderFlowAbsorptionEngine = OrderFlowAbsorptionEngine;
window.PreMarketEngine = PreMarketEngine;
window.TradingPlanEngine = TradingPlanEngine;
window.TrendBiasEngine = TrendBiasEngine;
window.VCPPatternEngine = VCPPatternEngine;
