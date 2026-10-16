/* ============================================================
 * PreMarketEngine — Classic floor pivot calculator
 * Inputs: previous day H/L/C. Returns pivots + R1-R3, S1-S3.
 * (Helper; UI can expose later.)
 * ============================================================ */
class PreMarketEngine {
    calculatePivots(h, l, c) {
        const p = (h + l + c) / 3;
        return {
            pivot: p,
            r1: 2 * p - l,
            s1: 2 * p - h,
            r2: p + (h - l),
            s2: p - (h - l),
            r3: h + 2 * (p - l),
            s3: l - 2 * (h - p),
            bc: (h + l) / 2,  // daily midpoint (bc = "central pivot")
            tc: p + (p - l),  // kept for backwards compat
        };
    }
}
window.PreMarketEngine = PreMarketEngine;
