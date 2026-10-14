class BreakoutChecklistEngine {
    // 🔥 REAL 6-POINT MATH LOGIC RESTORED
    evaluateBullishBreakout(candles, dayData, ind) {
        const current = candles[candles.length - 1];
        
        const passed1 = current.close > dayData.pdh;
        const passed2 = current.close > dayData.first5mHigh;
        const passed3 = ind.ema10 > ind.ema20 && ind.ema20 > ind.ema50;
        const passed4 = ind.vwap ? current.close > ind.vwap : true;
        const passed5 = ind.adx > 25;
        const passed6 = current.volume > ind.avgVolume * 1.5;

        const checks = [passed1, passed2, passed3, passed4, passed5, passed6];
        const passedCount = checks.filter(Boolean).length;
        
        let status, color;
        if (passedCount >= 5) {
            status = '🚀 HIGH PROBABILITY BREAKOUT'; color = '#00c853';
        } else if (passedCount >= 3) {
            status = '🟡 NEUTRAL / WAITING'; color = '#ffd740';
        } else {
            status = '⚠️ FAKE BREAKOUT TRAP'; color = '#ff1744';
        }

        return { status, color, passedCount, totalChecks: 6 };
    }
}