class VCPPatternEngine {
    scanVCP(candles) {
        // Audit Fix: Real Minervini VCP - progressive contractions T1>T2>T3
        if (!candles || candles.length < 60) return [];

        const findSwings = (data, lookback = 3) => {
            const highs = [], lows = [];
            for (let i = lookback; i < data.length - lookback; i++) {
                let isH = true, isL = true;
                for (let j = 1; j <= lookback; j++) {
                    if (data[i].high <= data[i-j].high || data[i].high <= data[i+j].high) isH = false;
                    if (data[i].low >= data[i-j].low || data[i].low >= data[i+j].low) isL = false;
                }
                if (isH) highs.push({ index: i, price: data[i].high });
                if (isL) lows.push({ index: i, price: data[i].low });
            }
            return { highs, lows };
        };

        const recent = candles.slice(-50);
        const { highs, lows } = findSwings(recent);

        if (highs.length < 3 || lows.length < 3) {
            return [{ status: '⚠️ Insufficient data for VCP', color: '#787b86' }];
        }

        const contractions = [];
        for (let i = 0; i < Math.min(highs.length, lows.length); i++) {
            const h = highs[i], l = lows[i];
            if (h && l && h.index < l.index) {
                const depth = ((h.price - l.price) / h.price) * 100;
                contractions.push({ depth: depth, high: h.price, low: l.price });
            }
        }

        if (contractions.length < 2) {
            return [{ status: '⚠️ Base forming - no contractions yet', color: '#ffd740' }];
        }

        // Progressive tightness check T1 > T2 > T3
        let isProgressive = true;
        for (let i = 1; i < contractions.length; i++) {
            if (contractions[i].depth >= contractions[i-1].depth) {
                isProgressive = false;
                break;
            }
        }

        const lastContraction = contractions[contractions.length - 1];
        if (isProgressive && lastContraction.depth < 10) {
            return [{
                status: '🟢 VALID VCP - Pivot: ₹' + lastContraction.high.toFixed(2),
                color: '#00c853',
                contractions: contractions.map(c => c.depth.toFixed(1) + '%').join(' → ')
            }];
        } else if (!isProgressive) {
            return [{ status: '⚠️ Invalid VCP - Messy contractions (not tightening)', color: '#ff9100' }];
        }

        return [{ status: '🟡 Base forming - Needs tighter contraction', color: '#ffd740' }];
    }
}