class ChartEngine {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.volCanvas = document.getElementById('volumeChart');
        this.volCtx = this.volCanvas.getContext('2d');
        this.data = [];
        this.candleWidth = 10;
        this.candleSpacing = 3;
        this.chartType = 'candle';
        this.activeIndicators = [];
        this.init();
    }
    init() { this.resize(); window.addEventListener('resize', () => this.resize()); }
    resize() {
        const w = this.canvas.parentElement.clientWidth;
        const h = this.canvas.parentElement.clientHeight - 30;
        this.canvas.width = w; this.canvas.height = h;
        this.volCanvas.width = w; this.volCanvas.height = 60;
        this.render();
    }
    setData(data) { this.data = data; this.render(); }
    render() {
        if (!this.data.length) return;
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        let min = Infinity, max = -Infinity;
        this.data.forEach(c => { if (c.low < min) min = c.low; if (c.high > max) max = c.high; });
        const range = max - min || 1;

        // Draw Candles
        this.data.forEach((c, i) => {
            const x = i * (this.candleWidth + this.candleSpacing) + 20;
            const openY = this.canvas.height - ((c.open - min) / range) * (this.canvas.height - 40) - 20;
            const closeY = this.canvas.height - ((c.close - min) / range) * (this.canvas.height - 40) - 20;
            const highY = this.canvas.height - ((c.high - min) / range) * (this.canvas.height - 40) - 20;
            const lowY = this.canvas.height - ((c.low - min) / range) * (this.canvas.height - 40) - 20;

            const isBull = c.close >= c.open;
            ctx.strokeStyle = isBull ? '#00c853' : '#ff1744';
            ctx.fillStyle = isBull ? '#00c853' : '#ff1744';

            ctx.beginPath(); ctx.moveTo(x, highY); ctx.lineTo(x, lowY); ctx.stroke();
            ctx.fillRect(x - this.candleWidth/2, Math.min(openY, closeY), this.candleWidth, Math.max(Math.abs(closeY - openY), 1));
        });
    }
}