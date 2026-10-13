class DataFeed {
    constructor() {
        this.symbols = { 'NIFTY50': { name: 'NIFTY 50', base: 22500 } };
    }
    generateData(count = 200) {
        const data = []; let p = 22500;
        for (let i = 0; i < count; i++) {
            const change = (Math.random() - 0.48) * 15;
            const o = p, c = o + change;
            const h = Math.max(o, c) + Math.random() * 5, l = Math.min(o, c) - Math.random() * 5;
            p = c;
            data.push({ time: Date.now() - (count - i) * 600000, open: o, high: h, low: l, close: c, volume: Math.round(Math.random() * 500000) });
        }
        return data;
    }
}