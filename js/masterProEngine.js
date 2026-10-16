class MasterProEngine {
    analyzeBollingerBands(data) {
        if (data.length < 50) return null;
        const closes = data.map(c => c.close);
        const bb = TechnicalIndicators.BollingerBands(closes, 20, 2);
        const u = bb.upper[bb.upper.length-1];
        const l = bb.lower[bb.lower.length-1];
        const m = bb.middle[bb.middle.length-1];
        if (!u || !l || !m) return null;
        const bw = (u - l) / m;
        if (bw < 0.015) return { signal: '⚡ SQUEEZE', detail: `BW: ${(bw*100).toFixed(2)}%` };
        if (closes[closes.length-1] > m) return { signal: '🟢 BUY BIAS', detail: 'Above 20 SMA' };
        return { signal: '🔴 SELL BIAS', detail: 'Below 20 SMA' };
    }

    analyzeVolumeSpread(data) {
        if (data.length < 20) return null;
        const cur = data[data.length-1];
        const avg = data.slice(-21, -1).reduce((s, c) => s + c.volume, 0) / 20;
        const ratio = cur.volume / avg;
        if (ratio > 1.5) return { vsaType: '🔥 HIGH VOLUME', detail: `${ratio.toFixed(1)}x avg` };
        if (ratio < 0.7) return { vsaType: '🪤 LOW VOLUME TRAP', detail: `${ratio.toFixed(1)}x avg` };
        return { vsaType: '📊 NORMAL VOLUME', detail: `${ratio.toFixed(1)}x avg` };
    }

    analyzeMACDDeceleration(data) {
        if (data.length < 30) return null;
        const closes = data.map(c => c.close);
        const macd = TechnicalIndicators.MACD(closes);
        const h = macd.histogram;
        const h1 = h[h.length-1], h2 = h[h.length-2];
        if (h1 == null || h2 == null) return { status: '⏳ Warming up', color: '#787b86', msg: 'Insufficient data' };
        if (h2 > 0 && h1 < h2 && h1 > 0) return { status: '⚠️ BULLISH DECEL', color: '#ff9100', msg: 'Buyers tiring' };
        if (h2 < 0 && h1 > h2 && h1 < 0) return { status: '🚀 BEARISH DECEL', color: '#00e5ff', msg: 'Sellers tiring' };
        if (h1 > 0) return { status: '🟢 BULLISH', color: '#00c853', msg: 'Histogram growing green' };
        return { status: '🔴 BEARISH', color: '#ff1744', msg: 'Histogram growing red' };
    }
}