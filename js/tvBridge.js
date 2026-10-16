class TVBridge {
    constructor() {
        this.chart = null;
        this.mainSeries = null;
        this.volumeSeries = null;
        this.rsiSeries = null;
        this.vwapSeries = null;
        this.macdFast = null;
        this.macdSlow = null;
        this.macdHist = null;
        this.emas = {};
        this.currentData = [];
    }

    initChart(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';

        this.chart = LightweightCharts.createChart(container, {
            layout: { background: { color: '#131722' }, textColor: '#d1d4dc' },
            grid: { vertLines: { color: '#1f2933', style: 1 }, horzLines: { color: '#1f2933', style: 1 } },
            crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
            timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#2b2b43' }
        });

        // 1. CANDLE PANE (Top 45%)
        this.mainSeries = this.chart.addSeries(LightweightCharts.CandlestickSeries, {
            upColor: '#089981', downColor: '#f23645', borderVisible: false, wickUpColor: '#089981', wickDownColor: '#f23645'
        });
        this.chart.priceScale('right').applyOptions({ scaleMargins: { top: 0.02, bottom: 0.50 }, borderColor: '#2b2b43', autoScale: true });

        // 2. VOLUME PANE (52% to 65%)
        this.volumeSeries = this.chart.addSeries(LightweightCharts.HistogramSeries, { priceFormat: { type: 'volume' }, priceScaleId: 'vol_scale' });
        this.chart.priceScale('vol_scale').applyOptions({ scaleMargins: { top: 0.52, bottom: 0.35 }, visible: false });

        // 3. RSI PANE (68% to 82%)
        this.rsiSeries = this.chart.addSeries(LightweightCharts.LineSeries, { color: '#9c27b0', lineWidth: 2, priceScaleId: 'rsi_scale' });
        this.chart.priceScale('rsi_scale').applyOptions({ scaleMargins: { top: 0.68, bottom: 0.18 }, visible: true, borderColor: '#2b2b43' });
        try {
            this.rsiSeries.createPriceLine({ price: 70, color: '#f23645', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed });
            this.rsiSeries.createPriceLine({ price: 30, color: '#089981', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed });
        } catch(e){}

        // 4. MACD PANE (85% to 100%)
        this.chart.priceScale('macd_scale').applyOptions({ scaleMargins: { top: 0.85, bottom: 0.02 }, visible: true, borderColor: '#2b2b43' });
    }

    setCandleData(data) {
        if (!this.mainSeries || !data || data.length === 0) return;
        this.currentData = data;
        
        const formatted = data.map(d => ({
            time: typeof d.time === 'string' ? Math.floor(new Date(d.time).getTime() / 1000) : d.time,
            open: d.open, high: d.high, low: d.low, close: d.close
        })).sort((a,b) => a.time - b.time);

        this.mainSeries.setData(formatted);

        const volData = data.map(d => ({
            time: typeof d.time === 'string' ? Math.floor(new Date(d.time).getTime() / 1000) : d.time,
            value: d.volume,
            color: d.close >= d.open ? 'rgba(8, 153, 129, 0.4)' : 'rgba(242, 54, 69, 0.4)'
        })).sort((a,b) => a.time - b.time);

        this.volumeSeries.setData(volData);
    }

    updateTick(candle) {
        if (!this.mainSeries) return;
        const ts = typeof candle.time === 'string' ? Math.floor(new Date(candle.time).getTime() / 1000) : candle.time;
        this.mainSeries.update({ time: ts, open: candle.open, high: candle.high, low: candle.low, close: candle.close });
        this.volumeSeries.update({
            time: ts, value: candle.volume,
            color: candle.close >= candle.open ? 'rgba(8, 153, 129, 0.4)' : 'rgba(242, 54, 69, 0.4)'
        });
    }

    addEMA(period, color) {
        if (this.emas[period]) this.chart.removeSeries(this.emas[period]);
        const emaData = TechnicalIndicators.EMA(this.currentData, period);
        const series = this.chart.addSeries(LightweightCharts.LineSeries, { color: color, lineWidth: 2, crosshairMarkerVisible: false });
        const mapped = this.currentData.map((d, i) => ({
            time: typeof d.time === 'string' ? Math.floor(new Date(d.time).getTime() / 1000) : d.time,
            value: emaData[i]
        })).filter(x => x.value !== null).sort((a,b) => a.time - b.time);
        series.setData(mapped);
        this.emas[period] = series;
    }

    addVWAP() {
        if (this.vwapSeries) this.chart.removeSeries(this.vwapSeries);
        const vwapData = TechnicalIndicators.VWAP(this.currentData);
        this.vwapSeries = this.chart.addSeries(LightweightCharts.LineSeries, { color: '#E040FB', lineWidth: 2, crosshairMarkerVisible: false });
        const mapped = this.currentData.map((d, i) => ({
            time: typeof d.time === 'string' ? Math.floor(new Date(d.time).getTime() / 1000) : d.time,
            value: vwapData[i]
        })).filter(x => x.value !== null).sort((a,b) => a.time - b.time);
        this.vwapSeries.setData(mapped);
    }

    addMACD() {
        if (this.macdFast) this.chart.removeSeries(this.macdFast);
        if (this.macdSlow) this.chart.removeSeries(this.macdSlow);
        if (this.macdHist) this.chart.removeSeries(this.macdHist);

        const macdObj = TechnicalIndicators.MACD(this.currentData);
        
        this.macdHist = this.chart.addSeries(LightweightCharts.HistogramSeries, { priceScaleId: 'macd_scale' });
        this.macdFast = this.chart.addSeries(LightweightCharts.LineSeries, { color: '#2962FF', lineWidth: 2, priceScaleId: 'macd_scale' });
        this.macdSlow = this.chart.addSeries(LightweightCharts.LineSeries, { color: '#FF6D00', lineWidth: 2, priceScaleId: 'macd_scale' });

        const histMap = [], fastMap = [], slowMap = [];
        this.currentData.forEach((d, i) => {
            let ts = typeof d.time === 'string' ? Math.floor(new Date(d.time).getTime() / 1000) : d.time;
            if (macdObj.hist[i] !== null) histMap.push({ time: ts, value: macdObj.hist[i], color: macdObj.hist[i] >= 0 ? '#089981' : '#f23645' });
            if (macdObj.macd[i] !== null) fastMap.push({ time: ts, value: macdObj.macd[i] });
            if (macdObj.signal[i] !== null) slowMap.push({ time: ts, value: macdObj.signal[i] });
        });

        this.macdHist.setData(histMap.sort((a,b)=>a.time-b.time));
        this.macdFast.setData(fastMap.sort((a,b)=>a.time-b.time));
        this.macdSlow.setData(slowMap.sort((a,b)=>a.time-b.time));
    }

    addRSI(period = 14) {
        if (!this.rsiSeries) {
            this.rsiSeries = this.chart.addSeries(LightweightCharts.LineSeries, { color: '#9c27b0', lineWidth: 2, priceScaleId: 'rsi_scale' });
        }
        const rsiData = TechnicalIndicators.RSI(this.currentData, period);
        const mapped = this.currentData.map((d, i) => ({
            time: typeof d.time === 'string' ? Math.floor(new Date(d.time).getTime() / 1000) : d.time,
            value: rsiData[i]
        })).filter(x => x.value !== null).sort((a,b) => a.time - b.time);
        this.rsiSeries.setData(mapped);
    }

    clearIndicators() {
        Object.keys(this.emas).forEach(p => { if (this.emas[p]) this.chart.removeSeries(this.emas[p]); });
        this.emas = {};
        if (this.vwapSeries) { this.chart.removeSeries(this.vwapSeries); this.vwapSeries = null; }
        if (this.macdFast) { this.chart.removeSeries(this.macdFast); this.macdFast = null; }
        if (this.macdSlow) { this.chart.removeSeries(this.macdSlow); this.macdSlow = null; }
        if (this.macdHist) { this.chart.removeSeries(this.macdHist); this.macdHist = null; }
        // Note: RSI is cleared by re-setting data rather than removal to keep dashed lines intact.
    }

    setMarkers(markersData) {
        if (!this.mainSeries || !Array.isArray(markersData)) return;
        try {
            const formatted = markersData.map(m => ({
                time: typeof m.time === 'string' ? Math.floor(new Date(m.time).getTime() / 1000) : m.time,
                position: m.position, color: m.color, shape: m.shape, text: m.text, size: 1
            })).filter(m => !isNaN(m.time)).sort((a,b) => a.time - b.time);

            if (typeof this.mainSeries.setMarkers === 'function') this.mainSeries.setMarkers(formatted);
        } catch (err) {}
    }
}
window.tvBridge = new TVBridge();
