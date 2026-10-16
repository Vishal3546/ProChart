class GreeksEngine {
    constructor() { this.r = 0.065; }
    static normCDF(x) {
        const t = 1 / (1 + 0.2316419 * Math.abs(x));
        const d = 0.3989423 * Math.exp(-x * x / 2);
        const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
        return x > 0 ? 1 - p : p;
    }
    calculateGreeks(S, K, T, r, sigma, type) {
        if (T <= 0.001) return { delta: 0.5, gamma: 0.01, theta: -10, vega: 1 };
        const d1 = (Math.log(S/K) + (r + sigma*sigma/2)*T) / (sigma*Math.sqrt(T));
        const d2 = d1 - sigma*Math.sqrt(T);
        const pdf = Math.exp(-0.5*d1*d1) / Math.sqrt(2*Math.PI);
        const delta = type === 'CE' ? GreeksEngine.normCDF(d1) : GreeksEngine.normCDF(d1) - 1;
        const gamma = pdf / (S * sigma * Math.sqrt(T));
        const theta = (-(S * pdf * sigma) / (2 * Math.sqrt(T))) / 365;
        const vega = (S * pdf * Math.sqrt(T)) / 100;
        return {
            delta: parseFloat(delta.toFixed(2)),
            gamma: parseFloat(gamma.toFixed(4)),
            theta: parseFloat(theta.toFixed(1)),
            vega: parseFloat(vega.toFixed(1))
        };
    }
}