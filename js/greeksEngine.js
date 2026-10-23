/* ============================================================
 * GreeksEngine — Real Black-Scholes-Merton for European options
 * Inputs:
 *   spot, strike, iv (in % e.g., 18 = 18%), dte (days to expiry),
 *   type ('CE' or 'PE'), r (risk-free rate, default 6.75% for India),
 *   div (dividend yield, default 0)
 * Returns: delta, gamma, theta (per-day), vega (per 1% IV), rho
 * ============================================================ */
class GreeksEngine {
    constructor() {
        this.N = this._normalCDF.bind(this);
        this.n = this._normalPDF.bind(this);
    }
    _normalPDF(x) {
        return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
    }
    _normalCDF(x) {
        // Acklam's approximation (max error < 1e-7)
        const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741,
              a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
        const sign = x < 0 ? -1 : 1;
        const ax = Math.abs(x);
        const t = 1 / (1 + p * ax);
        const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-0.5 * ax * ax);
        return 0.5 * (1 + sign * y);
    }
    calculateGreeks(spot = 22668, strike = 22650, type = 'CE', ivPct = 18, dte = 7, r = 6.75, div = 0) {
        const S = Number(spot) || 0;
        const K = Number(strike) || 0;
        const sigma = (Number(ivPct) || 0) / 100;
        const T = Math.max(Number(dte) || 0, 1e-6) / 365;
        const R = (Number(r) || 0) / 100;
        const Q = (Number(div) || 0) / 100;

        // Sanity checks (IV >500% or absurd spot/strike = reject; fat-finger protection)
        if (S <= 0 || K <= 0 || sigma <= 0 || T <= 0 || sigma > 5 || S > 1e7 || K > 1e7) {
            return { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0, iv_pct: Number(ivPct), error: 'Invalid inputs' };
        }

        const sqrtT = Math.sqrt(T);
        const d1 = (Math.log(S / K) + (R - Q + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
        const d2 = d1 - sigma * sqrtT;
        const pdf = this.n(d1);
        const cdfD1 = this.N(d1);
        const cdfD2 = this.N(d2);
        const discR = Math.exp(-R * T);
        const discQ = Math.exp(-Q * T);

        let delta, gamma, theta, vega, rho;
        if (type === 'PE') {
            delta = -discQ * this.N(-d1);
            gamma = (discQ * pdf) / (S * sigma * sqrtT);
            theta = -(S * sigma * pdf * discQ) / (2 * sqrtT)
                    + R * K * discR * this.N(-d2)
                    - Q * S * discQ * this.N(-d1);
            rho = -K * T * discR * this.N(-d2) / 100;
        } else {
            delta = discQ * cdfD1;
            gamma = (discQ * pdf) / (S * sigma * sqrtT);
            theta = -(S * sigma * pdf * discQ) / (2 * sqrtT)
                    - R * K * discR * cdfD2
                    + Q * S * discQ * cdfD1;
            rho = K * T * discR * cdfD2 / 100;
        }
        vega = S * discQ * pdf * sqrtT / 100; // per 1% IV change
        const thetaPerDay = theta / 365;

        // Option fair value (Black-Scholes price)
        let price;
        if (type === 'PE') {
            price = K * discR * this.N(-d2) - S * discQ * this.N(-d1);
        } else {
            price = S * discQ * cdfD1 - K * discR * cdfD2;
        }
        const intrinsic = type === 'CE' ? Math.max(0, S - K) : Math.max(0, K - S);
        const timeValue = Math.max(0, price - intrinsic);

        return {
            delta: +delta.toFixed(4),
            gamma: +gamma.toFixed(6),
            theta: +thetaPerDay.toFixed(2),
            vega:  +vega.toFixed(2),
            rho:  +rho.toFixed(2),
            iv_pct: Number(ivPct),
            price: +price.toFixed(2),
            intrinsic: +intrinsic.toFixed(2),
            time_value: +timeValue.toFixed(2),
            moneyness: type === 'CE' ? (S >= K ? 'ITM' : 'OTM') : (S <= K ? 'ITM' : 'OTM'),
        };
    }
}
window.GreeksEngine = GreeksEngine;
