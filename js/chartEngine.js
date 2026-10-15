class ChartEngine {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.volCanvas = document.getElementById('volumeChart');
        this.volCtx = this.volCanvas.getContext('2d');
        this.lowerCanvas = document.getElementById('lowerChart');
        this.lowerCtx = this.lowerCanvas ? this.lowerCanvas.getContext('2d') : null;
        
        this.data = [];
        this.candleWidth = 8;
        this.candleSpacing = 2;
        this.offset = 0;
        this.chartType = 'candle';
        this.activeIndicators = ['ema20', 'rsi']; // RSI default added to test
        this.patternsToDraw = [];
        this.crosshair = { x: 0, y: 0, visible: false };
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartOffset = 0;
        this.priceScaleWidth = 70;
        
        this.init();
    }

    init() { this.resize(); window.addEventListener('resize', () => this.resize()); this.setupEvents(); }

    resize() {
        const parent = document.getElementById('chartWrapper');
        const w = parent.clientWidth;
        const h = parent.clientHeight - 30; // 30px for time scale
        const dpr = window.devicePixelRatio || 1;
        
        const hasLowerPanel = this.activeIndicators.includes('rsi') || this.activeIndicators.includes('macd');
        
        const mainH = hasLowerPanel ? Math.floor(h * 0.75) : h;
        const lowerH = hasLowerPanel ? Math.floor(h * 0.25) : 0;

        document.getElementById('mainChartContainer').style.height = `${mainH}px`;
        document.getElementById('lowerChartContainer').style.display = hasLowerPanel ? 'block' : 'none';
        document.getElementById('lowerPriceScale').style.display = hasLowerPanel ? 'block' : 'none';

        this.canvas.width = w * dpr; this.canvas.height = mainH * dpr;
        this.canvas.style.width = `${w}px`; this.canvas.style.height = `${mainH}px`;
        this.ctx.scale(dpr, dpr);
        
        this.volCanvas.width = w * dpr; this.volCanvas.height = 60 * dpr;
        this.volCanvas.style.width = `${w}px`; this.volCanvas.style.height = '60px';
        this.volCtx.scale(dpr, dpr);

        if(hasLowerPanel) {
            this.lowerCanvas.width = w * dpr; this.lowerCanvas.height = lowerH * dpr;
            this.lowerCanvas.style.width = `${w}px`; this.lowerCanvas.style.height = `${lowerH}px`;
            this.lowerCtx.scale(dpr, dpr);
        }
        
        this.chartWidth = w; this.mainHeight = mainH; this.lowerHeight = lowerH;
        this.render();
    }

    setupEvents() {
        const handleDrag = (e) => {
            if (this.isDragging) {
                const dx = e.clientX - this.dragStartX;
                const candleTotal = this.candleWidth + this.candleSpacing;
                this.offset = Math.max(0, Math.min(this.data.length - 10, this.dragStartOffset + Math.round(dx / candleTotal)));
            }
        };

        this.canvas.addEventListener('mousedown', (e) => { this.isDragging = true; this.dragStartX = e.clientX; this.dragStartOffset = this.offset; });
        if(this.lowerCanvas) this.lowerCanvas.addEventListener('mousedown', (e) => { this.isDragging = true; this.dragStartX = e.clientX; this.dragStartOffset = this.offset; });

        window.addEventListener('mousemove', (e) => {
            const rect = this.canvas.getBoundingClientRect();
            this.crosshair.x = e.clientX - rect.left;
            this.crosshair.y = e.clientY - rect.top;
            this.crosshair.visible = this.crosshair.x >= 0 && this.crosshair.x <= this.chartWidth - this.priceScaleWidth;
            handleDrag(e);
            this.render();
            this.updateCrosshairInfo();
        });

        window.addEventListener('mouseup', () => { this.isDragging = false; });

        const handleZoom = (e) => {
            e.preventDefault();
            this.candleWidth = e.deltaY < 0 ? Math.min(25, this.candleWidth + 1) : Math.max(2, this.candleWidth - 1);
            this.render();
        };

        this.canvas.addEventListener('wheel', handleZoom, { passive: false });
        if(this.lowerCanvas) this.lowerCanvas.addEventListener('wheel', handleZoom, { passive: false });
    }

    setData(data) { this.data = data || []; this.offset = 0; this.render(); }

    getVisibleData() {
        const count = Math.floor((this.chartWidth - this.priceScaleWidth) / (this.candleWidth + this.candleSpacing));
        const start = Math.max(0, this.data.length - count - this.offset);
        return { data: this.data.slice(start, start + count), startIdx: start, visibleCount: count };
    }

    render() {
        if (!this.data.length) return;
        this.ctx.clearRect(0, 0, this.chartWidth, this.mainHeight);
        
        const { data: visible, startIdx } = this.getVisibleData();
        if (!visible.length) return;

        // ===== MAIN CHART Y-AXIS SCALE =====
        let minP = Infinity, maxP = -Infinity;
        visible.forEach(c => { if(c.low < minP) minP = c.low; if(c.high > maxP) maxP = c.high; });
        
        // Include EMA in scale
        const closes = this.data.map(c => c.close);
        if(this.activeIndicators.includes('ema20')) {
            const ema = TechnicalIndicators.EMA(closes, 20);
            for(let i=startIdx; i<startIdx+visible.length; i++) {
                if(ema[i] < minP) minP = ema[i]; if(ema[i] > maxP) maxP = ema[i];
            }
        }
        
        const pad = (maxP - minP) * 0.10; minP -= pad; maxP += pad;
        const range = maxP - minP || 1;
        const priceToY = (p) => 10 + ((maxP - p) / range) * (this.mainHeight - 20);

        // ===== DRAW CANDLES & EMA =====
        if(this.activeIndicators.includes('ema20')) {
            this.drawLine(this.ctx, TechnicalIndicators.EMA(closes, 20), startIdx, visible.length, '#ff9100', priceToY);
        }

        visible.forEach((c, idx) => {
            const x = idx * (this.candleWidth + this.candleSpacing) + this.candleWidth / 2 + 5;
            const openY = priceToY(c.open), closeY = priceToY(c.close);
            const highY = priceToY(c.high), lowY = priceToY(c.low);
            const color = c.close >= c.open ? '#26a69a' : '#ef5350';

            this.ctx.strokeStyle = color; this.ctx.fillStyle = color;
            this.ctx.lineWidth = 1;
            this.ctx.beginPath(); this.ctx.moveTo(x, highY); this.ctx.lineTo(x, lowY); this.ctx.stroke();
            this.ctx.fillRect(x - this.candleWidth/2, Math.min(openY, closeY), this.candleWidth, Math.max(Math.abs(closeY - openY), 1));
        });

        // ===== PATTERN MARKERS =====
        this.patternsToDraw.forEach(p => {
            if(p.index >= startIdx && p.index < startIdx + visible.length) {
                const x = (p.index - startIdx) * (this.candleWidth + this.candleSpacing) + this.candleWidth/2 + 5;
                const y = p.signal === 'bullish' ? priceToY(this.data[p.index].low) + 20 : priceToY(this.data[p.index].high) - 20;
                this.ctx.fillStyle = p.signal === 'bullish' ? '#26a69a' : '#ef5350';
                this.ctx.font = '10px Arial'; this.ctx.textAlign = 'center';
                this.ctx.fillText(p.name, x, y);
            }
        });

        // ===== VOLUME =====
        this.volCtx.clearRect(0,0, this.chartWidth, 60);
        let maxVol = Math.max(...visible.map(c=>c.volume));
        if(maxVol) {
            visible.forEach((c, idx) => {
                const x = idx * (this.candleWidth + this.candleSpacing) + this.candleWidth/2 + 5;
                const h = (c.volume / maxVol) * 55;
                this.volCtx.fillStyle = c.close >= c.open ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)';
                this.volCtx.fillRect(x - this.candleWidth/2, 60 - h, this.candleWidth, h);
            });
        }

        this.renderPriceScale('priceScale', minP, maxP, priceToY);
        
        // ===== LOWER PANEL (RSI / MACD) =====
        if(this.activeIndicators.includes('rsi') || this.activeIndicators.includes('macd')) {
            this.renderLowerPanel(closes, startIdx, visible.length);
        }

        // Crosshair
        if (this.crosshair.visible) {
            this.ctx.strokeStyle = 'rgba(255,255,255,0.3)'; this.ctx.setLineDash([3,3]);
            this.ctx.beginPath(); this.ctx.moveTo(this.crosshair.x, 0); this.ctx.lineTo(this.crosshair.x, this.mainHeight); this.ctx.stroke();
            this.ctx.beginPath(); this.ctx.moveTo(0, this.crosshair.y); this.ctx.lineTo(this.chartWidth-70, this.crosshair.y); this.ctx.stroke();
            this.ctx.setLineDash([]);
        }
    }

    renderLowerPanel(closes, startIdx, length) {
        const ctx = this.lowerCtx;
        ctx.clearRect(0, 0, this.chartWidth, this.lowerHeight);
        const w = this.chartWidth - 70;
        
        if (this.activeIndicators.includes('rsi')) {
            const rsi = TechnicalIndicators.RSI(closes, 14);
            const valToY = (v) => this.lowerHeight - (v / 100) * this.lowerHeight;
            
            // Draw 70 & 30 Lines
            ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.setLineDash([2,2]);
            ctx.beginPath(); ctx.moveTo(0, valToY(70)); ctx.lineTo(w, valToY(70)); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, valToY(30)); ctx.lineTo(w, valToY(30)); ctx.stroke();
            ctx.setLineDash([]);
            
            this.drawLine(ctx, rsi, startIdx, length, '#7c4dff', valToY);
            this.renderPriceScale('lowerPriceScale', 0, 100, valToY);
        } 
        else if (this.activeIndicators.includes('macd')) {
            const macd = TechnicalIndicators.MACD(closes);
            let maxV = 0.001;
            for(let i=startIdx; i<startIdx+length; i++) {
                if(Math.abs(macd.macd[i]) > maxV) maxV = Math.abs(macd.macd[i]);
                if(Math.abs(macd.histogram[i]) > maxV) maxV = Math.abs(macd.histogram[i]);
            }
            const valToY = (v) => (this.lowerHeight/2) - (v / maxV) * (this.lowerHeight/2 - 5);
            
            // Zero Line
            ctx.strokeStyle = 'rgba(255,255,255,0.2)';
            ctx.beginPath(); ctx.moveTo(0, valToY(0)); ctx.lineTo(w, valToY(0)); ctx.stroke();
            
            // Histogram
            for(let i=0; i<length; i++) {
                const v = macd.histogram[startIdx+i];
                if(!v) continue;
                const x = i * (this.candleWidth + this.candleSpacing) + this.candleWidth/2 + 5;
                ctx.fillStyle = v >= 0 ? '#26a69a' : '#ef5350';
                ctx.fillRect(x - this.candleWidth/2, valToY(v>0?v:0), this.candleWidth, Math.abs(valToY(v) - valToY(0)));
            }
            
            this.drawLine(ctx, macd.macd, startIdx, length, '#2196f3', valToY);
            this.drawLine(ctx, macd.signal, startIdx, length, '#ff9100', valToY);
            this.renderPriceScale('lowerPriceScale', -maxV, maxV, valToY);
        }
    }

    drawLine(ctx, data, startIdx, length, color, valToY) {
        ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
        let started = false;
        for (let i = 0; i < length; i++) {
            const v = data[startIdx + i];
            if (v === null || v === undefined) continue;
            const x = i * (this.candleWidth + this.candleSpacing) + this.candleWidth/2 + 5;
            const y = valToY(v);
            if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    renderPriceScale(id, min, max, valToY) {
        const el = document.getElementById(id);
        if(!el) return;
        el.innerHTML = '';
        for(let i=1; i<=4; i++) {
            const val = min + (i/5)*(max-min);
            const div = document.createElement('div');
            div.style.cssText = `position:absolute; right:5px; top:${valToY(val)-6}px; font-size:10px; color:#787b86; font-family:monospace;`;
            div.textContent = val.toFixed(2);
            el.appendChild(div);
        }
    }
    
    updateCrosshairInfo() {
        const { data: visible, startIdx } = this.getVisibleData();
        const idx = Math.floor((this.crosshair.x - 5) / (this.candleWidth + this.candleSpacing));
        const c = visible[idx];
        if(c) {
            document.getElementById('crosshairInfo').style.display = 'flex';
            document.getElementById('ciOpen').textContent = c.open.toFixed(2);
            document.getElementById('ciHigh').textContent = c.high.toFixed(2);
            document.getElementById('ciLow').textContent = c.low.toFixed(2);
            document.getElementById('ciClose').textContent = c.close.toFixed(2);
        }
    }
}