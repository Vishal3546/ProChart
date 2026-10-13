class GreeksEngine {
    constructor() { this.riskFreeRate = 0.065; }
    static normalCDF(x) {
        const t = 1.0 / (1.0 + 0.2316419 * Math.abs(x));
        const d = 0.3989423 * Math.exp(-x * x / 2);
        const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
        return x > 0 ? 1 - prob : prob;
    }
    calculateGreeks(S, K, T, r, sigma, type = 'CE') {
        if (T <= 0.001) return { delta: 0.5, gamma: 0.01, theta: -10, vega: 1 };
        const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T));
        const d2 = d1 - sigma * Math.sqrt(T);
        const pdfD1 = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);

        const delta = type === 'CE' ? GreeksEngine.normalCDF(d1) : GreeksEngine.normalCDF(d1) - 1;
        const gamma = pdfD1 / (S * sigma * Math.sqrt(T));
        const theta = (-(S * pdfD1 * sigma) / (2 * Math.sqrt(T))) / 365;
        const vega = (S * pdfD1 * Math.sqrt(T)) / 100;

        return { delta: parseFloat(delta.toFixed(2)), gamma: parseFloat(gamma.toFixed(4)), theta: parseFloat(theta.toFixed(1)), vega: parseFloat(vega.toFixed(1)) };
    }
    generateComboSignal(ind, greeks) {
        let score = 75;
        return { finalScore: score, finalSignal: score >= 70 ? '🟢 BUY' : '🔴 SELL', finalColor: score >= 70 ? '#00c853' : '#ff1744' };
    }
}