class CandlePatternEngine {
    scanAll(data, settings) {
        let markers = [];
        if (!data || data.length < 10 || !settings.master) return markers;

        let lastIndex = -5; 

        for (let i = 5; i < data.length - 1; i++) {
            if (i - lastIndex < 4) continue; 

            let curr = data[i];
            let prev1 = data[i-1];
            let prev2 = data[i-2];

            let body = Math.abs(curr.close - curr.open);
            let totalRange = curr.high - curr.low;
            if (totalRange === 0) continue;

            let upperWick = curr.high - Math.max(curr.open, curr.close);
            let lowerWick = Math.min(curr.open, curr.close) - curr.low;

            let isSwingLow = true, isSwingHigh = true;
            for (let j = i-4; j <= i; j++) {
                if (data[j].low < curr.low) isSwingLow = false;
                if (data[j].high > curr.high) isSwingHigh = false;
            }

            // 1. HAMMER & SHOOTING STAR
            if (settings.hammer) {
                if (isSwingLow && lowerWick >= (body * 2.5) && upperWick <= (body * 0.4) && body > 0) {
                    markers.push({ time: curr.time, position: 'belowBar', color: '#089981', shape: 'arrowUp', text: '🔨 Hammer' });
                    lastIndex = i; continue;
                }
                if (isSwingHigh && upperWick >= (body * 2.5) && lowerWick <= (body * 0.4) && body > 0) {
                    markers.push({ time: curr.time, position: 'aboveBar', color: '#f23645', shape: 'arrowDown', text: '💫 Shooting Star' });
                    lastIndex = i; continue;
                }
            }

            // 2. ENGULFING
            if (settings.engulfing) {
                if (isSwingLow && prev1.close < prev1.open && curr.close > curr.open && curr.close >= prev1.open && curr.open <= prev1.close) {
                    markers.push({ time: curr.time, position: 'belowBar', color: '#089981', shape: 'arrowUp', text: '🐂 Bull Engulf' });
                    lastIndex = i; continue;
                }
                if (isSwingHigh && prev1.close > prev1.open && curr.close < curr.open && curr.close <= prev1.open && curr.open >= prev1.close) {
                    markers.push({ time: curr.time, position: 'aboveBar', color: '#f23645', shape: 'arrowDown', text: '🐻 Bear Engulf' });
                    lastIndex = i; continue;
                }
            }

            // 3. MORNING/EVENING STAR
            if (settings.star) {
                if (isSwingLow && prev2.close < prev2.open && Math.abs(prev1.close - prev1.open) < (Math.abs(prev2.close - prev2.open) * 0.3) && curr.close > ((prev2.open + prev2.close) / 2)) {
                    markers.push({ time: curr.time, position: 'belowBar', color: '#2196F3', shape: 'arrowUp', text: '🌅 Morning Star' });
                    lastIndex = i; continue;
                }
                if (isSwingHigh && prev2.close > prev2.open && Math.abs(prev1.close - prev1.open) < (Math.abs(prev2.close - prev2.open) * 0.3) && curr.close < ((prev2.open + prev2.close) / 2)) {
                    markers.push({ time: curr.time, position: 'aboveBar', color: '#E91E63', shape: 'arrowDown', text: '🌆 Evening Star' });
                    lastIndex = i; continue;
                }
            }

            // 4. DOJI
            if (settings.doji) {
                if (body <= (totalRange * 0.08) && (isSwingHigh || isSwingLow)) {
                    markers.push({ time: curr.time, position: isSwingHigh ? 'aboveBar' : 'belowBar', color: '#FFC107', shape: 'circle', text: '⚖️ Doji' });
                    lastIndex = i; continue;
                }
            }
        }
        return markers;
    }
}
window.CandlePatternEngine = CandlePatternEngine;
