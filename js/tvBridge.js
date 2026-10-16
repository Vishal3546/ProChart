class TVChartBridge {
    constructor(containerId) {
        const el = document.getElementById(containerId);
        if (!el) throw new Error("Container missing: " + containerId);
        if (typeof LightweightCharts === 'undefined') throw new Error("TradingView CDN not loaded");

        this.chart = LightweightCharts.createChart(el, {
            layout: { background: { type: 'solid', color: '#131722' }, textColor: '#d1d4dc' },
            grid: { vertLines: { color: '#1f2933' }, horzLines: { color: '#1f2933' } },
            crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
            rightPriceScale: { borderColor: '#2a2e39', scaleMargins: { top: 0.05, bottom: 0.25 } },
            timeScale: { borderColor: '#2a2e39', timeVisible: true, secondsVisible: false },
            width: el.clientWidth, height: el.clientHeight
        });

        // v5.2.1 Native API (addSeries with Series Type)
        this.isV5 = typeof this.chart.addSeries === 'function' && typeof LightweightCharts.CandlestickSeries !== 'undefined';

        if (this.isV5) {
            this.candleSeries = this.chart.addSeries(LightweightCharts.CandlestickSeries, {
                upColor: '#089981', downColor: '#f23645', borderVisible: false,
                wickUpColor: '#089981', wickDownColor: '#f23645'
            });
            this.volumeSeries = this.chart.addSeries(LightweightCharts.HistogramSeries, {
                priceFormat: { type: 'volume' }, priceScaleId: 'vol'
            });
            this.ema20 = this.chart.addSeries(LightweightCharts.LineSeries, { color: '#ff9800', lineWidth: 2 });
            this.ema50 = this.chart.addSeries(LightweightCharts.LineSeries, { color: '#00e5ff', lineWidth: 2 });
            this.ema200 = this.chart.addSeries(LightweightCharts.LineSeries, { color: '#ea80fc', lineWidth: 2 });
            this.vwap = this.chart.addSeries(LightweightCharts.LineSeries, { color: '#ffd740', lineWidth: 2, lineStyle: 2 });
            this.rsi = this.chart.addSeries(LightweightCharts.LineSeries, { color: '#9c27b0', lineWidth: 2, priceScaleId: 'rsi' });
            this.rsi70 = this.chart.addSeries(LightweightCharts.LineSeries, { color: 'rgba(242,54,69,0.5)', lineWidth: 1, lineStyle: 2, priceScaleId: 'rsi' });
            this.rsi30 = this.chart.addSeries(LightweightCharts.LineSeries, { color: 'rgba(8,153,129,0.5)', lineWidth: 1, lineStyle: 2, priceScaleId: 'rsi' });
        } else {
            // Fallback for v4
            this.candleSeries = this.chart.addCandlestickSeries({ upColor: '#089981', downColor: '#f23645', borderVisible: false });
            this.volumeSeries = this.chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol' });
            this.ema20 = this.chart.addLineSeries({ color: '#ff9800', lineWidth: 2 });
            this.ema50 = this.chart.addLineSeries({ color: '#00e5ff', lineWidth: 2 });
            this.ema200 = this.chart.addLineSeries({ color: '#ea80fc', lineWidth: 2 });
            this.vwap = this.chart.addLineSeries({ color: '#ffd740', lineWidth: 2, lineStyle: 2 });
            this.rsi = this.chart.addLineSeries({ color: '#9c27b0', lineWidth: 2, priceScaleId: 'rsi' });
            this.rsi70 = this.chart.addLineSeries({ color: 'rgba(242,54,69,0.5)', lineWidth: 1, lineStyle: 2, priceScaleId: 'rsi' });
            this.rsi30 = this.chart.addLineSeries({ color: 'rgba(8,153,129,0.5)', lineWidth: 1, lineStyle: 2, priceScaleId: 'rsi' });
        }

        this.chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.75, bottom: 0 } });
        this.chart.priceScale('rsi').applyOptions({ scaleMargins: { top: 0.80, bottom: 0.02 } });

        this.activeIndicators = ['ema20'];
        this.currentData = [];

        window.addEventListener('resize', () => {
            this.chart.applyOptions({ width: el.clientWidth, height: el.clientHeight });
        });
    }

    setData(data) {
        if (!data || !data.length) return;
        this.currentData = data;
        this.candleSeries.setData(data.map(c => ({
            time: Math.floor(c.time / 1000), open: c.open, high: c.high, low: c.low, close: c.close
        })));
        this.volumeSeries.setData(data.map(c => ({
            time: Math.floor(c.time / 1000), value: c.volume || 0,
            color: c.close >= c.open ? 'rgba(8,153,129,0.4)' : 'rgba(242,54,69,0.4)'
        })));
        this.updateIndicators();
        this.chart.timeScale().fitContent();
    }

    updateTick(candle) {
        if (!candle) return;
        const t = Math.floor(candle.time / 1000);
        this.candleSeries.update({ time: t, open: candle.open, high: candle.high, low: candle.low, close: candle.close });
        this.volumeSeries.update({
            time: t, value: candle.volume || 0,
            color: candle.close >= candle.open ? 'rgba(8,153,129,0.4)' : 'rgba(242,54,69,0.4)'
        });
        this.updateIndicators();
    }

    updateIndicators() {
        if (!this.currentData.length) return;
        const closes = this.currentData.map(c => c.close);
        const times = this.currentData.map(c => Math.floor(c.time / 1000));
        const toLine = (arr) => arr.map((v, i) => v != null && !isNaN(v) ? { time: times[i], value: v } : null).filter(x => x);

        this.ema20.setData(this.activeIndicators.includes('ema20') ? toLine(TechnicalIndicators.EMA(closes, 20)) : []);
        this.ema50.setData(this.activeIndicators.includes('ema50') ? toLine(TechnicalIndicators.EMA(closes, 50)) : []);
        this.ema200.setData(this.activeIndicators.includes('ema200') ? toLine(TechnicalIndicators.EMA(closes, 200)) : []);
        this.vwap.setData(this.activeIndicators.includes('vwap') ? toLine(TechnicalIndicators.VWAP(this.currentData)) : []);

        if (this.activeIndicators.includes('rsi')) {
            this.rsi.setData(toLine(TechnicalIndicators.RSI(closes, 14)));
            this.rsi70.setData(times.map(t => ({ time: t, value: 70 })));
            this.rsi30.setData(times.map(t => ({ time: t, value: 30 })));
        } else {
            this.rsi.setData([]); this.rsi70.setData([]); this.rsi30.setData([]);
        }
        this.updateLegend();
    }

    updateLegend() {
        const box = document.getElementById('legIndicators');
        if (!box || !this.currentData.length) return;
        const closes = this.currentData.map(c => c.close);
        let html = '';
        const on = this.activeIndicators;
        if (on.includes('ema20')) { const v = TechnicalIndicators.EMA(closes, 20).pop(); html += `<div style="color:#ff9800">EMA 20: ${v ? v.toFixed(2) : '-'}</div>`; }
        if (on.includes('ema50')) { const v = TechnicalIndicators.EMA(closes, 50).pop(); html += `<div style="color:#00e5ff">EMA 50: ${v ? v.toFixed(2) : '-'}</div>`; }
        if (on.includes('ema200')) { const v = TechnicalIndicators.EMA(closes, 200).pop(); html += `<div style="color:#ea80fc">EMA 200: ${v ? v.toFixed(2) : '-'}</div>`; }
        if (on.includes('vwap')) { const v = TechnicalIndicators.VWAP(this.currentData).pop(); html += `<div style="color:#ffd740">VWAP: ${v ? v.toFixed(2) : '-'}</div>`; }
        if (on.includes('rsi')) { const v = TechnicalIndicators.RSI(closes, 14).pop(); html += `<div style="color:#9c27b0">RSI 14: ${v ? v.toFixed(2) : '-'}</div>`; }
        box.innerHTML = html;
    }

    setPatternMarkers(patterns) {
        if (!patterns || !this.currentData.length) { this.candleSeries.setMarkers([]); return; }
        const markers = patterns.map(p => {
            const c = this.currentData[p.index];
            if (!c) return null;
            const bull = p.signal === 'bullish';
            let tag = p.name.includes('Engulf') ? 'E' : p.name.includes('Hammer') ? 'H' : 'P';
            return {
                time: Math.floor(c.time / 1000),
                position: bull ? 'belowBar' : 'aboveBar',
                color: bull ? '#089981' : '#f23645',
                shape: bull ? 'arrowUp' : 'arrowDown',
                text: tag
            };
        }).filter(x => x).sort((a, b) => a.time - b.time);
        this.candleSeries.setMarkers(markers);
    }
}