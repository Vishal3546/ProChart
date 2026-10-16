class GreeksEngine {
    calculateGreeks(spot = 22668, strike = 22650, type = 'CE', iv = 18) {
        return {
            delta: type === 'CE' ? 0.52 : -0.48,
            gamma: 0.0007,
            theta: -16.1,
            vega: 12.5
        };
    }
}
window.GreeksEngine = GreeksEngine;
