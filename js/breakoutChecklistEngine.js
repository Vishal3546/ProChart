class BreakoutChecklistEngine {
    getRealPDH(candles) {
        // Audit Fix: Real PDH from previous trading day
        if (!candles || candles.length < 2) return null;
        const lastDate = new Date(candles[candles.length-1].time).toDateString();
        const prevDay = candles.filter(c => new Date(c.time).toDateString() !== lastDate);
        if (!prevDay.length) return null;
        const lastPrevDate = new Date(prevDay[prevDay.length-1].time).toDateString();
        const prevDayOnly = prevDay.filter(c => new Date(c.time).toDateString() === lastPrevDate);
        return Math.max(...prevDayOnly.map(c => c.high));
    }

    getFirst5mHigh(candles) {
        if (!candles || candles.length < 5) return null;
        const todayDate = new Date(candles[candles.length-1].time).toDateString();
        const today = candles.filter(c => new Date(c.time).toDateString() === todayDate);
        if (today.length < 1) return null;
        const first5 = today.slice(0, 5);
        return Math.max(...first5.map(c => c.high));
    }

    evaluateBullishBreakout(candles, dayData, ind) {
        if (!candles || candles.length < 20) {
            return { status: 'Checking...', color: '#787b86', passedCount: 0, totalChecks: 6 };
        }

        const current = candles[candles.length - 1];
        const realPDH = this.getRealPDH(candles) || dayData.pdh;
        const real5mHigh = this.getFirst5mHigh(candles) || dayData.first5mHigh;

        const passed1 = current.close > realPDH;
        const passed2 = current.close > real5mHigh;
        const passed3 = ind.ema10 && ind.ema20 && ind.ema50 ? (ind.ema10 > ind.ema20 && ind.ema20 > ind.ema50) : false;
        const passed4 = ind.vwap ? current.close > ind.vwap : false;
        const passed5 = (ind.adx || 0) > 25;
        const passed6 = current.volume > (ind.avgVolume || 100000) * 1.5;

        const checks = [passed1, passed2, passed3, passed4, passed5, passed6];
        const passedCount = checks.filter(Boolean).length;

        let status, color;
        if (passedCount >= 5) {
            status = '🚀 HIGH PROBABILITY BREAKOUT'; color = '#00c853';
        } else if (passedCount >= 3) {
            status = '🟡 NEUTRAL / CONSOLIDATION'; color = '#ffd740';
        } else {
            status = '⚠️ FAKE BREAKOUT TRAP'; color = '#ff1744';
        }

        return { status, color, passedCount, totalChecks: 6 };
    }
}