// TradingView-Grade Chart Engine v2.0
class ChartEngine {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.volCanvas = document.getElementById('volumeChart');
        this.volCtx = this.volCanvas.getContext('2d');
        
        this.data = [];
        this.candleWidth = 8;
        this.candleSpacing = 2;
        this.offset = 0;
        this.chartType = 'candle';
        this.activeIndicators = ['ema20'];
        this.patternsToDraw = [];
        this.crosshair = { x: 0, y: 0, visible: false };
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartOffset = 0;
        this.priceScaleWidth = 70;
        this.timeScaleHeight = 25;

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
        const dpr = window.devicePixelRatio || 1;
        
        // Main chart = 75% height, Volume = 20%, Time scale = 5%
        const chartH = Math.floor(h * 0.75);
        const volH = Math.floor(h * 0.20);
        
        this.canvas.width = w * dpr;
        this.canvas.height = chartH * dpr;
        this.canvas.style.width = w + 'px';
        this.canvas.style.height = chartH + 'px';
        this.ctx.scale(dpr, dpr);
        
        this.volCanvas.width = w * dpr;
        this.volCanvas.height = volH * dpr;
        this.volCanvas.style.width = w + 'px';
        this.volCanvas.style.height = volH + 'px';
        this.volCtx.scale(dpr, dpr);
        
        this.chartWidth = w;
        this.chartHeight = chartH;
        this.volHeight = volH;
        
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
            this.crosshair.visible = this.crosshair.x >= 0 && this.crosshair.x <= this.chartWidth - this.priceScaleWidth 
                                     && this.crosshair.y >= 0 && this.crosshair.y <= this.chartHeight;

            if (this.isDragging) {
                const dx = e.clientX - this.dragStartX;
                const candleTotal = this.candleWidth + this.candleSpacing;
                this.offset = Math.max(0, Math.min(this.data.length - 10, 
                    this.dragStartOffset + Math.round(dx / candleTotal)));
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
                this.candleWidth = Math.min(25, this.candleWidth + 1);
            } else {
                this.candleWidth = Math.max(2, this.candleWidth - 1);
            }
            this.render();
        }, { passive: false });

        this.canvas.addEventListener('mouseleave', () => {
            this.crosshair.visible = false;
            this.render();
            const info = document.getElementById('crosshairInfo');
            if (info) info.style.display = 'none';
        });
    }

    setData(data) {
        this.data = data || [];
        this.offset = 0;
        this.render();
    }

    getVisibleCount() {
        return Math.floor((this.chartWidth - this.priceScaleWidth) / (this.candleWidth + this.candleSpacing));
    }

    getVisibleData() {
        const count = this.getVisibleCount();
        const start = Math.max(0, this.data.length - count - this.offset);
        const end = Math.min(this.data.length, start + count);
        return { data: this.data.slice(start, end), startIdx: start, endIdx: end };
    }

    render() {
        if (!this.data || this.data.length === 0) return;

        const ctx = this.ctx;
        const chartW = this.chartWidth - this.priceScaleWidth;
        const chartH = this.chartHeight;
        
        ctx.clearRect(0, 0, this.chartWidth, chartH);
        
        const { data: visible, startIdx } = this.getVisibleData();
        if (visible.length === 0) return;

        // ===== PRICE RANGE WITH PROPER PADDING =====
        let minPrice = Infinity, maxPrice = -Infinity;
        visible.forEach(c => {
            if (c.low < minPrice) minPrice = c.low;
            if (c.high > maxPrice) maxPrice = c.high;
        });
        
        // Include indicators in range
        if (this.activeIndicators.includes('ema20') || this.activeIndicators.includes('ema50') || 
            this.activeIndicators.includes('ema200')) {
            const closes = this.data.map(c => c.close);
            [20, 50, 200].forEach(p => {
                if (this.activeIndicators.includes('ema' + p)) {
                    const ema = TechnicalIndicators.EMA(closes, p);
                    for (let i = startIdx; i < startIdx + visible.length; i++) {
                        if (ema[i] !== null && ema[i] !== undefined) {
                            if (ema[i] < minPrice) minPrice = ema[i];
                            if (ema[i] > maxPrice) maxPrice = ema[i];
                        }
                    }
                }
            });
        }
        
        if (this.activeIndicators.includes('bb')) {
            const closes = this.data.map(c => c.close);
            const bb = TechnicalIndicators.BollingerBands(closes, 20, 2);
            for (let i = startIdx; i < startIdx + visible.length; i++) {
                if (bb.upper[i] && bb.upper[i] > maxPrice) maxPrice = bb.upper[i];
                if (bb.lower[i] && bb.lower[i] < minPrice) minPrice = bb.lower[i];
            }
        }
        
        // Add 10% padding top & bottom
        const priceRange = maxPrice - minPrice;
        const padding = priceRange * 0.10;
        minPrice -= padding;
        maxPrice += padding;
        
        const range = (maxPrice - minPrice) || 1;
        const priceToY = (p) => 10 + ((maxPrice - p) / range) * (chartH - 20);

        // ===== GRID =====
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= 6; i++) {
            const y = 10 + ((chartH - 20) * i / 6);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(chartW, y);
            ctx.stroke();
        }

        // ===== BOLLINGER BANDS =====
        if (this.activeIndicators.includes('bb')) {
            const closes = this.data.map(c => c.close);
            const bb = TechnicalIndicators.BollingerBands(closes, 20, 2);
            this.drawLine(bb.upper, startIdx, visible.length, 'rgba(33,150,243,0.5)', priceToY);
            this.drawLine(bb.lower, startIdx, visible.length, 'rgba(33,150,243,0.5)', priceToY);
            this.drawLine(bb.middle, startIdx, visible.length, 'rgba(33,150,243,0.3)', priceToY, true);
        }

        // ===== EMAs =====
        const emaColors = { 20: '#ff9100', 50: '#00e5ff', 200: '#ea80fc' };
        [20, 50, 200].forEach(p => {
            if (this.activeIndicators.includes('ema' + p)) {
                const closes = this.data.map(c => c.close);
                const ema = TechnicalIndicators.EMA(closes, p);
                this.drawLine(ema, startIdx, visible.length, emaColors[p], priceToY);
            }
        });

        // ===== VWAP =====
        if (this.activeIndicators.includes('vwap')) {
            const vwap = TechnicalIndicators.VWAP(this.data);
            this.drawLine(vwap, startIdx, visible.length, '#ffd740', priceToY);
        }

        // ===== CANDLES =====
        visible.forEach((c, idx) => {
            const x = idx * (this.candleWidth + this.candleSpacing) + this.candleWidth / 2 + 5;
            const openY = priceToY(c.open);
            const closeY = priceToY(c.close);
            const highY = priceToY(c.high);
            const lowY = priceToY(c.low);
            const isBull = c.close >= c.open;
            const color = isBull ? '#26a69a' : '#ef5350';

            if (this.chartType === 'line') {
                return;
            }

            // Wick
            ctx.strokeStyle = color;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, highY);
            ctx.lineTo(x, lowY);
            ctx.stroke();

            // Body
            ctx.fillStyle = color;
            const bodyTop = Math.min(openY, closeY);
            const bodyH = Math.max(Math.abs(closeY - openY), 1);
            ctx.fillRect(x - this.candleWidth/2, bodyTop, this.candleWidth, bodyH);
        });

        // Line chart
        if (this.chartType === 'line') {
            ctx.strokeStyle = '#2196f3';
            ctx.lineWidth = 2;
            ctx.beginPath();
            visible.forEach((c, idx) => {
                const x = idx * (this.candleWidth + this.candleSpacing) + this.candleWidth/2 + 5;
                const y = priceToY(c.close);
                if (idx === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
            });
            ctx.stroke();
        }

        // ===== PATTERN MARKERS (ONLY LAST 3) =====
        const recentPatterns = this.patternsToDraw.slice(-3);
        recentPatterns.forEach(p => {
            const dataIdx = p.index;
            if (dataIdx >= startIdx && dataIdx < startIdx + visible.length) {
                const idx = dataIdx - startIdx;
                const x = idx * (this.candleWidth + this.candleSpacing) + this.candleWidth/2 + 5;
                const c = this.data[dataIdx];
                const isBull = p.signal === 'bullish';
                const y = isBull ? priceToY(c.low) + 20 : priceToY(c.high) - 20;

                // Arrow
                ctx.fillStyle = isBull ? '#26a69a' : '#ef5350';
                ctx.beginPath();
                if (isBull) {
                    ctx.moveTo(x, y - 10);
                    ctx.lineTo(x - 5, y - 2);
                    ctx.lineTo(x + 5, y - 2);
                } else {
                    ctx.moveTo(x, y + 10);
                    ctx.lineTo(x - 5, y + 2);
                    ctx.lineTo(x + 5, y + 2);
                }
                ctx.closePath();
                ctx.fill();

                // Label background
                const label = p.name;
                ctx.font = 'bold 10px Inter';
                const labelW = ctx.measureText(label).width + 8;
                ctx.fillStyle = isBull ? 'rgba(38,166,154,0.9)' : 'rgba(239,83,80,0.9)';
                ctx.fillRect(x - labelW/2, isBull ? y + 5 : y - 25, labelW, 18);
                
                ctx.fillStyle = '#fff';
                ctx.textAlign = 'center';
                ctx.fillText(label, x, isBull ? y + 17 : y - 13);
            }
        });

        // ===== VOLUME =====
        this.renderVolume(visible);

        // ===== PRICE SCALE =====
        this.renderPriceScale(minPrice, maxPrice, priceToY);

        // ===== TIME SCALE =====
        this.renderTimeScale(visible);

        // ===== CURRENT PRICE LINE =====
        const lastC = visible[visible.length - 1];
        if (lastC) {
            const lastY = priceToY(lastC.close);
            const isBull = lastC.close >= lastC.open;
            const color = isBull ? '#26a69a' : '#ef5350';
            
            ctx.strokeStyle = color;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(0, lastY);
            ctx.lineTo(chartW, lastY);
            ctx.stroke();
            ctx.setLineDash([]);
            
            // Price tag on right
            ctx.fillStyle = color;
            ctx.fillRect(chartW, lastY - 10, this.priceScaleWidth, 20);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 11px JetBrains Mono';
            ctx.textAlign = 'center';
            ctx.fillText(lastC.close.toFixed(2), chartW + this.priceScaleWidth/2, lastY + 4);
        }

        // ===== CROSSHAIR =====
        if (this.crosshair.visible) {
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.setLineDash([3, 3]);
            ctx.lineWidth = 1;
            
            ctx.beginPath();
            ctx.moveTo(this.crosshair.x, 0);
            ctx.lineTo(this.crosshair.x, chartH);
            ctx.stroke();
            
            ctx.beginPath();
            ctx.moveTo(0, this.crosshair.y);
            ctx.lineTo(chartW, this.crosshair.y);
            ctx.stroke();
            ctx.setLineDash([]);
            
            // Hover price tag
            const hoverPrice = maxPrice - ((this.crosshair.y - 10) / (chartH - 20)) * range;
            ctx.fillStyle = '#2962ff';
            ctx.fillRect(chartW, this.crosshair.y - 10, this.priceScaleWidth, 20);
            ctx.fillStyle = '#fff';
            ctx.font = '11px JetBrains Mono';
            ctx.textAlign = 'center';
            ctx.fillText(hoverPrice.toFixed(2), chartW + this.priceScaleWidth/2, this.crosshair.y + 4);
        }
    }

    drawLine(data, startIdx, length, color, priceToY, dashed = false) {
        const ctx = this.ctx;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        if (dashed) ctx.setLineDash([4, 4]);
        ctx.beginPath();
        let started = false;
        for (let i = 0; i < length; i++) {
            const dataIdx = startIdx + i;
            if (data[dataIdx] === null || data[dataIdx] === undefined) continue;
            const x = i * (this.candleWidth + this.candleSpacing) + this.candleWidth/2 + 5;
            const y = priceToY(data[dataIdx]);
            if (!started) { ctx.moveTo(x, y); started = true; }
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
        if (dashed) ctx.setLineDash([]);
    }

    renderVolume(visible) {
        const vCtx = this.volCtx;
        const w = this.chartWidth - this.priceScaleWidth;
        const h = this.volHeight;
        vCtx.clearRect(0, 0, this.chartWidth, h);

        let maxVol = 0;
        visible.forEach(c => { if (c.volume > maxVol) maxVol = c.volume; });
        if (!maxVol) return;

        visible.forEach((c, idx) => {
            const x = idx * (this.candleWidth + this.candleSpacing) + this.candleWidth/2 + 5;
            const barH = (c.volume / maxVol) * (h - 5);
            vCtx.fillStyle = c.close >= c.open ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)';
            vCtx.fillRect(x - this.candleWidth/2, h - barH, this.candleWidth, barH);
        });
    }

    renderPriceScale(min, max, priceToY) {
        const scaleEl = document.getElementById('priceScale');
        if (!scaleEl) return;
        scaleEl.innerHTML = '';
        
        const steps = 6;
        for (let i = 0; i <= steps; i++) {
            const p = max - (i / steps) * (max - min);
            const y = priceToY(p);
            const div = document.createElement('div');
            div.style.cssText = `position:absolute;top:${y - 7}px;right:5px;font-size:10px;font-family:JetBrains Mono;color:#787b86;`;
            div.textContent = p.toFixed(2);
            scaleEl.appendChild(div);
        }
    }

    renderTimeScale(visible) {
        const scaleEl = document.getElementById('timeScale');
        if (!scaleEl) return;
        scaleEl.innerHTML = '';
        
        const step = Math.max(1, Math.floor(visible.length / 8));
        for (let i = 0; i < visible.length; i += step) {
            const x = i * (this.candleWidth + this.candleSpacing) + this.candleWidth/2 + 5;
            const d = new Date(visible[i].time);
            const label = `${d.getDate()}/${d.getMonth()+1} ${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`;
            const div = document.createElement('div');
            div.style.cssText = `position:absolute;left:${x - 30}px;top:3px;font-size:10px;font-family:JetBrains Mono;color:#787b86;`;
            div.textContent = label;
            scaleEl.appendChild(div);
        }
    }

    updateCrosshairInfo() {
        if (!this.crosshair.visible) return;
        const { data: visible, startIdx } = this.getVisibleData();
        const idx = Math.floor((this.crosshair.x - 5) / (this.candleWidth + this.candleSpacing));
        const candle = visible[idx];
        if (candle) {
            const info = document.getElementById('crosshairInfo');
            if (info) {
                info.style.display = 'flex';
                document.getElementById('ciOpen').textContent = candle.open.toFixed(2);
                document.getElementById('ciHigh').textContent = candle.high.toFixed(2);
                document.getElementById('ciLow').textContent = candle.low.toFixed(2);
                document.getElementById('ciClose').textContent = candle.close.toFixed(2);
                document.getElementById('ciVol').textContent = candle.volume.toLocaleString();
            }
        }
    }
}