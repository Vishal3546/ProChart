class MasterProEngine {
    analyzeBollingerBands(data) {
        if(data.length < 50) return null;
        const closes = data.map(c => c.close);
        const bb = TechnicalIndicators.BollingerBands(closes, 20, 2);
        const curUpper = bb.upper[bb.upper.length-1];
        const curLower = bb.lower[bb.lower.length-1];
        const curMid = bb.middle[bb.middle.length-1];
        
        const bw = (curUpper - curLower) / curMid;
        if(bw < 0.015) return { signal: '⚡ SQUEEZE DETECTED', detail: `Bandwidth tight (${(bw*100).toFixed(2)}%). Blast loading!` };
        if(closes[closes.length-1] > curMid) return { signal: '🟢 BUY BIAS', detail: 'Price > 20 SMA. Trend is UP.' };
        return { signal: '🔴 SELL BIAS', detail: 'Price < 20 SMA. Trend is DOWN.' };
    }

    analyzeVolumeSpread(data) {
        if(data.length < 20) return null;
        const current = data[data.length-1];
        const avgVol = data.slice(-21, -1).reduce((s, c) => s + c.volume, 0) / 20;
        const volRatio = current.volume / avgVol;
        
        if(volRatio > 1.5) return { vsaType: '🔥 HIGH VOLUME BLAZE', detail: `Volume ${volRatio.toFixed(1)}x average. Real Move!` };
        if(volRatio < 0.7) return { vsaType: '🪤 LOW VOLUME TRAP', detail: `Volume ${volRatio.toFixed(1)}x average. Fake Breakout likely.` };
        return { vsaType: '📊 NORMAL VOLUME', detail: 'Volume is average. Trend is neutral.' };
    }

    // 🔥 REAL MACD DECELERATION LOGIC RESTORED
    analyzeMACDDeceleration(data) {
        if(data.length < 30) return null;
        const closes = data.map(c => c.close);
        const macd = TechnicalIndicators.MACD(closes, 12, 26, 9);
        const hist = macd.histogram;
        const h1 = hist[hist.length-1]; // Current
        const h2 = hist[hist.length-2]; // Prev
        
        if (h2 > 0 && h1 < h2 && h1 > 0) {
            return { status: '⚠️ BULLISH DECELERATION', color: '#ff9100', msg: 'Green Hist Shrinking. Buyers tired.' };
        } else if (h2 < 0 && h1 > h2 && h1 < 0) {
            return { status: '🚀 BEARISH DECELERATION', color: '#00e5ff', msg: 'Red Hist Shrinking. Sellers tired.' };
        } else if (h1 > 0) {
            return { status: '🟢 STRONG BULLISH', color: '#00c853', msg: 'MACD Histogram Growing Green.' };
        } else {
            return { status: '🔴 STRONG BEARISH', color: '#ff1744', msg: 'MACD Histogram Growing Red.' };
        }
    }
}