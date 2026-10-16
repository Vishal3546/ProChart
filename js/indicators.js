const TechnicalIndicators = {
    SMA: function(data, period) {
        let res = [];
        for (let i = 0; i < data.length; i++) {
            if (i < period - 1) { res.push(null); continue; }
            let sum = 0;
            for (let j = 0; j < period; j++) sum += data[i - j].close;
            res.push(sum / period);
        }
        return res;
    },

    EMA: function(data, period) {
        let res = [];
        let k = 2 / (period + 1);
        let sma = 0;
        for (let i = 0; i < data.length; i++) {
            if (i < period - 1) { res.push(null); sma += data[i].close; } 
            else if (i === period - 1) { sma = (sma + data[i].close) / period; res.push(sma); } 
            else { res.push((data[i].close - res[i - 1]) * k + res[i - 1]); }
        }
        return res;
    },

    RSI: function(data, period = 14) {
        let res = [];
        let gains = 0, losses = 0;
        for (let i = 0; i < data.length; i++) {
            if (i === 0) { res.push(null); continue; }
            let diff = data[i].close - data[i - 1].close;
            if (i <= period) {
                if (diff > 0) gains += diff; else losses -= diff;
                if (i < period) res.push(null);
                else { let rs = (gains / period) / (losses / period || 1); res.push(100 - (100 / (1 + rs))); }
            } else {
                let g = diff > 0 ? diff : 0; let l = diff < 0 ? -diff : 0;
                gains = (gains * (period - 1) + g) / period;
                losses = (losses * (period - 1) + l) / period;
                let rs = gains / (losses || 1);
                res.push(100 - (100 / (1 + rs)));
            }
        }
        return res;
    },

    VWAP: function(data) {
        let res = [];
        let sumPV = 0, sumV = 0, currentDay = -1;
        for(let i=0; i<data.length; i++) {
            let ts = typeof data[i].time === 'string' ? new Date(data[i].time) : new Date(data[i].time * 1000);
            let day = ts.getDate();
            if(day !== currentDay) { sumPV = 0; sumV = 0; currentDay = day; } // Anchor daily
            let typ = (data[i].high + data[i].low + data[i].close) / 3;
            sumPV += typ * data[i].volume;
            sumV += data[i].volume;
            res.push(sumV === 0 ? data[i].close : sumPV / sumV);
        }
        return res;
    },

    MACD: function(data, fast = 12, slow = 26, signal = 9) {
        let fastEma = this.EMA(data, fast);
        let slowEma = this.EMA(data, slow);
        let macdLine = [];
        for(let i=0; i<data.length; i++) {
            if(fastEma[i] === null || slowEma[i] === null) { macdLine.push(null); } 
            else { macdLine.push(fastEma[i] - slowEma[i]); }
        }
        
        // Signal line is EMA of MACD Line
        let sigLine = [];
        let k = 2 / (signal + 1);
        let sma = 0, count = 0;
        for(let i=0; i<macdLine.length; i++) {
            if(macdLine[i] === null) { sigLine.push(null); }
            else {
                count++;
                if(count < signal) { sigLine.push(null); sma += macdLine[i]; }
                else if(count === signal) { sma = (sma + macdLine[i]) / signal; sigLine.push(sma); }
                else { sigLine.push((macdLine[i] - sigLine[i-1]) * k + sigLine[i-1]); }
            }
        }

        let hist = [];
        for(let i=0; i<macdLine.length; i++) {
            if(macdLine[i] === null || sigLine[i] === null) hist.push(null);
            else hist.push(macdLine[i] - sigLine[i]);
        }
        return { macd: macdLine, signal: sigLine, hist: hist };
    }
};
window.TechnicalIndicators = TechnicalIndicators;
