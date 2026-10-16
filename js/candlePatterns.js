/* ============================================================
 * CandlePatternEngine — Strict candlestick pattern detection
 * - Anti-spam: min 4-bar gap between signals
 * - Context-aware: requires swing high/low
 * - Returns TradingView-lightweight-charts markers (time in seconds)
 * ============================================================ */
class CandlePatternEngine {
    scanAll(data, settings) {
        const markers = [];
        if (!data || data.length < 10 || !settings || !settings.master) return markers;

        let lastIndex = -5;
        for (let i = 5; i < data.length; i++) {
            if (i - lastIndex < 4) continue;

            const curr = data[i];
            const prev1 = data[i - 1];
            const prev2 = data[i - 2];

            const body = Math.abs(curr.close - curr.open);
            const totalRange = curr.high - curr.low;
            if (totalRange === 0) continue;

            const upperWick = curr.high - Math.max(curr.open, curr.close);
            const lowerWick = Math.min(curr.open, curr.close) - curr.low;

            // Swing pivot check over a 5-bar window centered on i (2 back + 2 fwd when possible)
            let isSwingLow = true, isSwingHigh = true;
            const from = Math.max(0, i - 4);
            const to   = Math.min(data.length - 1, i + 2);
            for (let j = from; j <= to; j++) {
                if (j === i) continue;
                if (data[j].low  < curr.low)  isSwingLow = false;
                if (data[j].high > curr.high) isSwingHigh = false;
            }

            const toSec = (t) => (typeof t === 'number' && t > 1e10) ? Math.floor(t / 1000) : (typeof t === 'number' ? Math.floor(t) : Math.floor(new Date(t).getTime() / 1000));
            const cTime = toSec(curr.time);

            // HAMMER / SHOOTING STAR
            if (settings.hammer) {
                if (isSwingLow && lowerWick >= body * 2.5 && upperWick <= body * 0.5 && body > totalRange * 0.1) {
                    markers.push({ time: cTime, position: 'belowBar', color: '#089981', shape: 'arrowUp',   text: '🔨 Hammer', size: 1 });
                    lastIndex = i; continue;
                }
                if (isSwingHigh && upperWick >= body * 2.5 && lowerWick <= body * 0.5 && body > totalRange * 0.1) {
                    markers.push({ time: cTime, position: 'aboveBar', color: '#f23645', shape: 'arrowDown', text: '💫 Shooting Star', size: 1 });
                    lastIndex = i; continue;
                }
            }

            // ENGULFING
            if (settings.engulfing) {
                if (isSwingLow && prev1.close < prev1.open && curr.close > curr.open &&
                    curr.close > prev1.open && curr.open < prev1.close) {
                    markers.push({ time: cTime, position: 'belowBar', color: '#089981', shape: 'arrowUp',   text: '🐂 Bull Engulf', size: 1 });
                    lastIndex = i; continue;
                }
                if (isSwingHigh && prev1.close > prev1.open && curr.close < curr.open &&
                    curr.close < prev1.open && curr.open > prev1.close) {
                    markers.push({ time: cTime, position: 'aboveBar', color: '#f23645', shape: 'arrowDown', text: '🐻 Bear Engulf', size: 1 });
                    lastIndex = i; continue;
                }
            }

            // MORNING / EVENING STAR
            if (settings.star) {
                const midBody = Math.abs(prev1.close - prev1.open);
                const p2Body  = Math.abs(prev2.close - prev2.open);
                if (isSwingLow && prev2.close < prev2.open && midBody < p2Body * 0.4 &&
                    curr.close > (prev2.open + prev2.close) / 2 && curr.close > curr.open) {
                    markers.push({ time: cTime, position: 'belowBar', color: '#2196F3', shape: 'arrowUp',   text: '🌅 Morning Star', size: 1 });
                    lastIndex = i; continue;
                }
                if (isSwingHigh && prev2.close > prev2.open && midBody < p2Body * 0.4 &&
                    curr.close < (prev2.open + prev2.close) / 2 && curr.close < curr.open) {
                    markers.push({ time: cTime, position: 'aboveBar', color: '#E91E63', shape: 'arrowDown', text: '🌆 Evening Star', size: 1 });
                    lastIndex = i; continue;
                }
            }

            // DOJI
            if (settings.doji) {
                if (body <= totalRange * 0.1 && (isSwingHigh || isSwingLow)) {
                    markers.push({
                        time: cTime,
                        position: isSwingHigh ? 'aboveBar' : 'belowBar',
                        color: '#FFC107', shape: 'circle', text: '⚖️ Doji', size: 1,
                    });
                    lastIndex = i; continue;
                }
            }
        }
        return markers.sort((a, b) => a.time - b.time);
    }
}
window.CandlePatternEngine = CandlePatternEngine;
