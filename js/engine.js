// MATH & INDICATORS
class Indicators {
    static EMA(data, period) {
        let res = new Array(data.length).fill(null);
        if(data.length < period) return res;
        let sum=0, mult=2/(period+1);
        for(let i=0; i<period; i++) sum+=data[i];
        res[period-1] = sum/period;
        for(let i=period; i<data.length; i++) res[i] = (data[i] - res[i-1])*mult + res[i-1];
        return res;
    }
    static RSI(data, period=14) {
        let res = new Array(data.length).fill(null);
        if(data.length <= period) return res;
        let gains=0, losses=0;
        for(let i=1; i<=period; i++) {
            let diff = data[i] - data[i-1];
            if(diff>0) gains+=diff; else losses-=diff;
        }
        let avgG = gains/period, avgL = losses/period;
        res[period] = 100 - (100/(1+(avgL===0?100:avgG/avgL)));
        for(let i=period+1; i<data.length; i++) {
            let diff = data[i] - data[i-1];
            avgG = (avgG*(period-1) + (diff>0?diff:0))/period;
            avgL = (avgL*(period-1) + (diff<0?-diff:0))/period;
            res[i] = 100 - (100/(1+(avgL===0?100:avgG/avgL)));
        }
        return res;
    }
}

// STRICT PATTERN LOGIC (FIX FOR OVERLAPPING FALSE POSITIVES)
class PatternScanner {
    static isDowntrend(data, idx) {
        if(idx < 5) return false;
        return data[idx].close < data[idx-5].close && data[idx-1].close < data[idx-3].close;
    }
    static scan(data) {
        let patterns = [];
        for(let i=5; i<data.length; i++) {
            let c = data[i], p = data[i-1];
            let cBody = Math.abs(c.close - c.open), cRange = c.high - c.low;
            let pBody = Math.abs(p.close - p.open);
            
            // Strict Engulfing (Must be in downtrend, body must fully engulf, p must be red, c must be green)
            if(this.isDowntrend(data, i) && p.close < p.open && c.close > c.open) {
                if(c.close > p.open && c.open < p.close && cBody > pBody * 1.5) {
                    patterns.push({idx: i, name: "Bullish Engulfing", code: "E", color: "#089981"});
                }
            }
            // Strict Hammer (Must be in downtrend, long lower wick, small body)
            let lWick = Math.min(c.open, c.close) - c.low;
            if(this.isDowntrend(data, i) && cBody < cRange * 0.3 && lWick > cBody * 2) {
                // Ensure we don't spam patterns on the same candle
                if(!patterns.find(x => x.idx === i)) {
                    patterns.push({idx: i, name: "Hammer", code: "H", color: "#089981"});
                }
            }
        }
        return patterns;
    }
}

// TRADINGVIEW STYLE CANVAS RENDERER
class ChartEngine {
    constructor() {
        this.canvas = document.getElementById('mainCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.lCanvas = document.getElementById('lowerCanvas');
        this.lCtx = this.lCanvas.getContext('2d');
        this.data = [];
        this.cw = 6; // candle width
        this.sp = 2; // spacing
        this.offset = 0;
        this.inds = ['ema20', 'rsi']; // Default active
        this.patterns = [];
        
        window.onresize = () => this.resize();
        
        // Dragging Logic
        this.isDrag = false; this.startX = 0; this.startOff = 0;
        this.canvas.onmousedown = e => { this.isDrag = true; this.startX = e.clientX; this.startOff = this.offset; };
        window.onmouseup = () => this.isDrag = false;
        window.onmousemove = e => {
            if(this.isDrag) {
                let dx = e.clientX - this.startX;
                this.offset = Math.max(0, Math.min(this.data.length - 10, this.startOff + Math.round(dx / (this.cw+this.sp))));
                this.render();
            }
            this.updateCrosshair(e);
        };
        this.canvas.onwheel = e => {
            this.cw = Math.max(2, Math.min(20, this.cw + (e.deltaY < 0 ? 1 : -1)));
            this.render();
        };
    }
    
    resize() {
        let hasLower = this.inds.includes('rsi');
        document.getElementById('lowerWrapper').style.display = hasLower ? 'block' : 'none';
        
        this.w = this.canvas.parentElement.clientWidth;
        this.h = this.canvas.parentElement.clientHeight;
        this.canvas.width = this.w; this.canvas.height = this.h;
        
        if(hasLower) {
            this.lw = this.lCanvas.parentElement.clientWidth;
            this.lh = this.lCanvas.parentElement.clientHeight;
            this.lCanvas.width = this.lw; this.lCanvas.height = this.lh;
        }
        this.render();
    }
    
    setData(data) { this.data = data; this.offset = 0; this.patterns = []; this.resize(); }
    
    render() {
        if(!this.data.length) return;
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.w, this.h);
        
        let visCount = Math.floor((this.w - 60) / (this.cw + this.sp));
        let sIdx = Math.max(0, this.data.length - visCount - this.offset);
        let visData = this.data.slice(sIdx, sIdx + visCount);
        if(!visData.length) return;

        // Auto Scale Y-Axis
        let minP = Infinity, maxP = -Infinity, maxV = 0;
        visData.forEach(c => {
            if(c.low < minP) minP = c.low;
            if(c.high > maxP) maxP = c.high;
            if(c.volume > maxV) maxV = c.volume;
        });
        
        let pad = (maxP - minP) * 0.1; minP -= pad; maxP += pad;
        let range = maxP - minP || 1;
        const getY = p => 10 + ((maxP - p) / range) * (this.h - 30);
        
        // Draw Grid & Y-Axis Labels
        ctx.strokeStyle = '#1f2933'; ctx.fillStyle = '#787b86'; ctx.font = '11px sans-serif';
        ctx.beginPath();
        for(let i=0; i<=5; i++) {
            let p = maxP - (i/5)*range;
            let y = getY(p);
            ctx.moveTo(0, Math.round(y)+0.5); ctx.lineTo(this.w-60, Math.round(y)+0.5);
            ctx.fillText(p.toFixed(2), this.w-55, y+4);
        }
        ctx.stroke();

        // Draw EMA
        if(this.inds.includes('ema20')) {
            let ema = Indicators.EMA(this.data.map(c=>c.close), 20);
            ctx.strokeStyle = '#2962ff'; ctx.lineWidth = 1.5; ctx.beginPath();
            let started = false;
            for(let i=0; i<visData.length; i++) {
                let val = ema[sIdx+i];
                if(!val) continue;
                let x = i * (this.cw+this.sp) + this.cw/2;
                if(!started) { ctx.moveTo(x, getY(val)); started=true; }
                else ctx.lineTo(x, getY(val));
            }
            ctx.stroke();
        }

        // Draw Candles & Volume
        visData.forEach((c, i) => {
            let x = Math.round(i * (this.cw+this.sp) + this.cw/2) + 0.5;
            let color = c.close >= c.open ? '#089981' : '#f23645';
            
            // Volume
            let vH = (c.volume / maxV) * (this.h * 0.2);
            ctx.fillStyle = c.close >= c.open ? 'rgba(8,153,129,0.3)' : 'rgba(242,54,69,0.3)';
            ctx.fillRect(x - this.cw/2, this.h - vH, this.cw, vH);
            
            // Candle
            ctx.strokeStyle = color; ctx.fillStyle = color;
            ctx.beginPath(); ctx.moveTo(x, getY(c.high)); ctx.lineTo(x, getY(c.low)); ctx.stroke();
            let bodyTop = Math.min(getY(c.open), getY(c.close));
            let bodyH = Math.max(Math.abs(getY(c.close) - getY(c.open)), 1);
            ctx.fillRect(x - this.cw/2, bodyTop, this.cw, bodyH);
            
            // Clean Pattern Markers
            let pat = this.patterns.find(p => p.idx === sIdx + i);
            if(pat) {
                let py = getY(c.low) + 15;
                ctx.fillStyle = pat.color;
                ctx.fillText("[" + pat.code + "]", x, py); // Draws [E] or [H] instead of long text!
            }
        });
        
        // Draw RSI Lower Panel
        if(this.inds.includes('rsi')) {
            this.renderRSI(sIdx, visData.length);
        }
    }
    
    renderRSI(sIdx, len) {
        const ctx = this.lCtx;
        ctx.clearRect(0, 0, this.lw, this.lh);
        let rsi = Indicators.RSI(this.data.map(c=>c.close), 14);
        
        const getY = p => ((100 - p) / 100) * (this.lh - 20) + 10;
        
        // Lines & Labels for RSI 70, 50, 30
        ctx.strokeStyle = '#2a2e39'; ctx.fillStyle = '#787b86'; ctx.font = '11px sans-serif';
        [70, 50, 30].forEach(p => {
            let y = Math.round(getY(p))+0.5;
            ctx.beginPath(); ctx.setLineDash(p===50?[]:[2,2]);
            ctx.moveTo(0, y); ctx.lineTo(this.lw-60, y); ctx.stroke();
            ctx.fillText(p, this.lw-50, y+4);
        });
        ctx.setLineDash([]);
        
        ctx.strokeStyle = '#9d28f0'; ctx.lineWidth = 1.5; ctx.beginPath();
        let started = false;
        for(let i=0; i<len; i++) {
            let val = rsi[sIdx+i];
            if(!val) continue;
            let x = i * (this.cw+this.sp) + this.cw/2;
            if(!started) { ctx.moveTo(x, getY(val)); started=true; }
            else ctx.lineTo(x, getY(val));
        }
        ctx.stroke();
    }
    
    updateCrosshair(e) {
        if(!this.data.length) return;
        let rect = this.canvas.getBoundingClientRect();
        let cx = e.clientX - rect.left;
        let visCount = Math.floor((this.w - 60) / (this.cw + this.sp));
        let sIdx = Math.max(0, this.data.length - visCount - this.offset);
        
        let idx = Math.floor(cx / (this.cw + this.sp));
        let c = this.data[sIdx + idx];
        if(c) {
            document.getElementById('legO').textContent = c.open.toFixed(2);
            document.getElementById('legH').textContent = c.high.toFixed(2);
            document.getElementById('legL').textContent = c.low.toFixed(2);
            document.getElementById('legC').textContent = c.close.toFixed(2);
            
            let color = c.close >= c.open ? 'val-green' : 'val-red';
            document.getElementById('legO').className = color;
            document.getElementById('legC').className = color;
        }
    }
}