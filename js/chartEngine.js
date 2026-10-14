class ChartEngine {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.volCanvas = document.getElementById('volumeChart');
        this.volCtx = this.volCanvas.getContext('2d');
        
        this.data = [];
        this.candleWidth = 10;
        this.candleSpacing = 4;
        this.offset = 0;
        this.chartType = 'candle';
        this.activeIndicators = ['ema20', 'bb'];
        this.patternsToDraw = [];
        this.crosshair = { x: 0, y: 0, visible: false };
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartOffset = 0;

        this.init();
    }

    init() {
        this.resize();
        window.addEventListener('resize', () => this.resize());
        this.setupEvents();
    }

    resize() {
        const parent = this.canvas.parentElement;
        const w = parent.clientWidth;
        const h = parent.clientHeight;
        
        this.canvas.width = w;
        this.canvas.height = h - 30;
        this.volCanvas.width = w;
        this.volCanvas.height = 60;
        this.render();
    }

    setupEvents() {
        this.canvas.addEventListener('mousedown', (e) => {
            this.isDragging = true;
            this.dragStartX = e.clientX;
            this.dragStartOffset = this.offset;
            this.canvas.style.cursor = 'grabbing';
        });

        window.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            this.crosshair.x = e.clientX - rect.left;
            this.crosshair.y = e.clientY - rect.top;
            this.crosshair.visible = true;

            if (this.isDragging) {
                const dx = e.clientX - this.dragStartX;
                const candleTotal = this.candleWidth + this.candleSpacing;
                this.offset = Math.max(0, Math.min(this.data.length - 10, this.dragStartOffset + Math.round(dx / candleTotal)));
            }

            this.render();
            this.updateCrosshairInfo();
        });

        window.addEventListener('mouseup', () => {
            this.isDragging = false;
            this.canvas.style.cursor = 'crosshair';
        });

        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            if (e.deltaY < 0) {
                this.candleWidth = Math.min(30, this.candleWidth + 1);
            } else {
                this.candleWidth = Math.max(3, this.candleWidth - 1);
            }
            this.render();
        }, { passive: false });

        this.canvas.addEventListener('mouseleave', () => {
            this.crosshair.visible = false;
            this.render();
            document.getElementById('crosshairInfo').style.display = 'none';
        });
    }

    setData(data) {
        this.data = data;
        this.offset = 0;
        this.render();
    }

    getVisibleCount() {
        return Math.floor((this.canvas.width - 70) / (this.candleWidth + this.candleSpacing));
    }

    render() {
        if (!this.data || this.data.length === 0) return;

        const ctx = this.ctx;
        const w = this.canvas.width - 70;
        const h = this.canvas.height;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        const visibleCount = this.getVisibleCount();
        const startIdx = Math.max(0, this.data.length - visibleCount - this.offset);
        const endIdx = Math.min(this.data.length, startIdx + visibleCount);
        const visibleData = this.data.slice(startIdx, endIdx);

        if (visibleData.length === 0) return;

        let minPrice = Infinity, maxPrice = -Infinity;
        visibleData.forEach(c => {
            if (c.low < minPrice) minPrice = c.low;
            if (c.high > maxPrice) maxPrice = c.high;
        });
        const range = (maxPrice - minPrice) || 1;

        const priceToY = (price) => h - 20 - ((price - minPrice) / range) * (h - 40);

        // 1. Grid Lines
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 5; i++) {
            const y = 20 + (h - 40) * (i / 4);
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }

        // 2. Active Indicators
        if (this.activeIndicators.includes('bb')) {
            const closes = this.data.map(c => c.close);
            const bb = TechnicalIndicators.BollingerBands(closes, 20, 2);
            ctx.strokeStyle = 'rgba(33, 150, 243, 0.5)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            visibleData.forEach((c, idx) => {
                const dataIdx = startIdx + idx;
                const x = idx * (this.candleWidth + this.candleSpacing) + this.candleWidth/2;
                if (bb.upper[dataIdx]) {
                    const yU = priceToY(bb.upper[dataIdx]);
                    if (idx === 0) ctx.moveTo(x, yU); else ctx.lineTo(x, yU);
                }
            });
            ctx.stroke();
        }

        if (this.activeIndicators.includes('ema20')) {
            const closes = this.data.map(c => c.close);
            const ema20 = TechnicalIndicators.EMA(closes, 20);
            ctx.strokeStyle = '#ff9100';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            visibleData.forEach((c, idx) => {
                const dataIdx = startIdx + idx;
                const x = idx * (this.candleWidth + this.candleSpacing) + this.candleWidth/2;
                if (ema20[dataIdx]) {
                    const y = priceToY(ema20[dataIdx]);
                    if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                }
            });
            ctx.stroke();
        }

        // 3. Candles / Line
        visibleData.forEach((c, idx) => {
            const x = idx * (this.candleWidth + this.candleSpacing) + this.candleWidth/2;
            const openY = priceToY(c.open);
            const closeY = priceToY(c.close);
            const highY = priceToY(c.high);
            const lowY = priceToY(c.low);
            const isBull = c.close >= c.open;

            const color = isBull ? '#00c853' : '#ff1744';
            ctx.strokeStyle = color;
            ctx.fillStyle = color;

            if (this.chartType === 'line') {
                if (idx === 0) ctx.beginPath(); ctx.moveTo(x, closeY);
                if (idx > 0) ctx.lineTo(x, closeY);
                if (idx === visibleData.length - 1) { ctx.strokeStyle = '#2196f3'; ctx.lineWidth = 2; ctx.stroke(); }
            } else {
                ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(x, highY); ctx.lineTo(x, lowY); ctx.stroke();

                const bodyTop = Math.min(openY, closeY);
                const bodyH = Math.max(Math.abs(closeY - openY), 1);
                ctx.fillRect(x - this.candleWidth/2, bodyTop, this.candleWidth, bodyH);
            }
        });

        // 4. Draw Pattern Badges
        this.patternsToDraw.forEach(p => {
            const dataIdx = p.index;
            if (dataIdx >= startIdx && dataIdx < endIdx) {
                const idx = dataIdx - startIdx;
                const x = idx * (this.candleWidth + this.candleSpacing) + this.candleWidth/2;
                const c = this.data[dataIdx];
                const y = p.signal === 'bullish' ? priceToY(c.low) + 15 : priceToY(c.high) - 15;

                ctx.fillStyle = p.signal === 'bullish' ? '#00c853' : '#ff1744';
                ctx.font = 'bold 9px JetBrains Mono';
                ctx.textAlign = 'center';
                ctx.fillText(p.name, x, y);
            }
        });

        // 5. Volume Bar Canvas
        this.renderVolume(visibleData);

        // 6. Right Price Scale
        this.renderPriceScale(minPrice, maxPrice);

        // 7. Crosshair
        if (this.crosshair.visible && this.crosshair.x <= w) {
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.moveTo(this.crosshair.x, 0); ctx.lineTo(this.crosshair.x, h); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, this.crosshair.y); ctx.lineTo(w, this.crosshair.y); ctx.stroke();
            ctx.setLineDash([]);

            const hoverPrice = maxPrice - ((this.crosshair.y - 20) / (h - 40)) * range;
            ctx.fillStyle = '#2196f3';
            ctx.fillRect(w, this.crosshair.y - 10, 70, 20);
            ctx.fillStyle = '#fff';
            ctx.font = '10px JetBrains Mono';
            ctx.fillText(hoverPrice.toFixed(2), w + 10, this.crosshair.y + 4);
        }

        // Current Price Line Tag
        const lastC = visibleData[visibleData.length - 1];
        if (lastC) {
            const lastY = priceToY(lastC.close);
            ctx.strokeStyle = lastC.close >= lastC.open ? '#00c853' : '#ff1744';
            ctx.setLineDash([2, 2]);
            ctx.beginPath(); ctx.moveTo(0, lastY); ctx.lineTo(w, lastY); ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    renderVolume(visibleData) {
        const vCtx = this.volCtx;
        const w = this.volCanvas.width - 70;
        const h = this.volCanvas.height;
        vCtx.clearRect(0, 0, this.volCanvas.width, h);

        let maxVol = 0;
        visibleData.forEach(c => { if (c.volume > maxVol) maxVol = c.volume; });
        if (!maxVol) return;

        visibleData.forEach((c, idx) => {
            const x = idx * (this.candleWidth + this.candleSpacing) + this.candleWidth/2;
            const barH = (c.volume / maxVol) * (h - 10);
            vCtx.fillStyle = c.close >= c.open ? 'rgba(0,200,83,0.3)' : 'rgba(255,23,68,0.3)';
            vCtx.fillRect(x - this.candleWidth/2, h - barH, this.candleWidth, barH);
        });
    }

    renderPriceScale(min, max) {
        const scaleEl = document.getElementById('priceScale');
        if (!scaleEl) return;
        scaleEl.innerHTML = '';

        for (let i = 0; i <= 4; i++) {
            const p = max - (i / 4) * (max - min);
            const div = document.createElement('div');
            div.className = 'price-label';
            div.style.position = 'absolute';
            div.style.top = (10 + (this.canvas.height - 40) * (i / 4)) + 'px';
            div.style.right = '5px';
            div.style.fontSize = '10px';
            div.style.fontFamily = 'monospace';
            div.style.color = '#94a3b8';
            div.textContent = p.toFixed(2);
            scaleEl.appendChild(div);
        }
    }

    updateCrosshairInfo() {
        const visibleCount = this.getVisibleCount();
        const startIdx = Math.max(0, this.data.length - visibleCount - this.offset);
        const idx = Math.floor(this.crosshair.x / (this.candleWidth + this.candleSpacing));
        const candle = this.data[startIdx + idx];

        if (candle) {
            const info = document.getElementById('crosshairInfo');
            info.style.display = 'flex';
            document.getElementById('ciOpen').textContent = candle.open.toFixed(2);
            document.getElementById('ciHigh').textContent = candle.high.toFixed(2);
            document.getElementById('ciLow').textContent = candle.low.toFixed(2);
            document.getElementById('ciClose').textContent = candle.close.toFixed(2);
            document.getElementById('ciVol').textContent = candle.volume.toLocaleString();
        }
    }
}