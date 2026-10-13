class DataFeed {
    constructor() {
        this.symbols = {
            'NIFTY50': { name: 'NIFTY 50', base: 22456.80 },
            'BANKNIFTY': { name: 'BANK NIFTY', base: 48200.50 },
            'RELIANCE': { name: 'RELIANCE', base: 2980.00 }
        };
        this.currentSymbol = 'NIFTY50';
    }

    generateData(count = 150) {
        const config = this.symbols[this.currentSymbol] || this.symbols['NIFTY50'];
        const data = [];
        let price = config.base;
        const now = Date.now();

        for (let i = count; i >= 0; i--) {
            const change = (Math.random() - 0.48) * 12;
            const open = price;
            const close = open + change;
            const high = Math.max(open, close) + Math.random() * 6;
            const low = Math.min(open, close) - Math.random() * 6;
            const volume = Math.round(100000 + Math.random() * 400000);
            price = close;

            data.push({
                time: now - i * 60000,
                open: parseFloat(open.toFixed(2)),
                high: parseFloat(high.toFixed(2)),
                low: parseFloat(low.toFixed(2)),
                close: parseFloat(close.toFixed(2)),
                volume
            });
        }
        return data;
    }

    generateLiveTick(lastCandle) {
        const tick = (Math.random() - 0.49) * 3;
        const newClose = parseFloat((lastCandle.close + tick).toFixed(2));
        lastCandle.close = newClose;
        lastCandle.high = Math.max(lastCandle.high, newClose);
        lastCandle.low = Math.min(lastCandle.low, newClose);
        lastCandle.volume += Math.round(Math.random() * 1500);
        return lastCandle;
    }
}