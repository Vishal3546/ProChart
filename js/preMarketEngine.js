class PreMarketEngine {
    calculatePivots(h, l, c) {
        const p = (h + l + c) / 3;
        return { pivot: p, r1: 2*p - l, s1: 2*p - h, tc: p + (p - l), bc: p - (p - l) };
    }
}