/* ============================================================
 * TVBridge — Lightweight Charts v5 wrapper (v2026.10)
 * Panes: Candles + Volume | RSI | MACD
 * Indicators: SMA, EMA, Bollinger Bands, VWAP, SuperTrend
 * Timestamps: works with UNIX seconds in/out; ms inputs auto-divided.
 * ============================================================ */
class TVBridge {
    constructor() {
        this.chart = null;
        this.mainSeries = null;
        this.volumeSeries = null;
        this.rsiSeries = null;
        this.vwapSeries = null;
        this.bbUpper = null;
        this.bbLower = null;
        this.bbMid = null;
        this.supertrendSeries = null;
        this.macdFast = null;
        this.macdSlow = null;
        this.macdHist = null;
        this.overlays = {};   // key: "ema20"/"sma50" → series
        this.currentData = [];
        this._resizeObserver = null;
    }

    // ---------- utilities ----------
    _toSec(t) {
        if (t == null) return 0;
        if (typeof t === 'string') return Math.floor(new Date(t).getTime() / 1000);
        if (typeof t === 'number') return t > 1e10 ? Math.floor(t / 1000) : Math.floor(t);
        return Math.floor(new Date(t).getTime() / 1000);
    }
    _fmt(data) {
        return data
            .map(d => ({
                time: this._toSec(d.time),
                open: +d.open, high: +d.high, low: +d.low, close: +d.close,
            }))
            .filter(d => d.time > 0)
            .sort((a, b) => a.time - b.time);
    }
    _fmtVol(data) {
        return data
            .map(d => ({
                time: this._toSec(d.time),
                value: +(d.volume || 0),
                color: d.close >= d.open ? 'rgba(8,153,129,0.45)' : 'rgba(242,54,69,0.45)',
            }))
            .filter(d => d.time > 0)
            .sort((a, b) => a.time - b.time);
    }

    // ---------- init ----------
    initChart(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';

        this.chart = LightweightCharts.createChart(container, {
            layout: {
                background: { color: '#131722' },
                textColor: '#d1d4dc',
                fontFamily: "Inter, -apple-system, sans-serif",
            },
            grid: {
                vertLines: { color: '#1f2933', style: 1 },
                horzLines: { color: '#1f2933', style: 1 },
            },
            crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
            rightPriceScale: { borderColor: '#2b2b43' },
            timeScale: {
                timeVisible: true,
                secondsVisible: false,
                borderColor: '#2b2b43',
                rightOffset: 5,
            },
        });

        // 1) Main candlestick pane
        this.mainSeries = this.chart.addSeries(LightweightCharts.CandlestickSeries, {
            upColor: '#089981', downColor: '#f23645',
            borderVisible: false, wickUpColor: '#089981', wickDownColor: '#f23645',
        });
        this.chart.priceScale('right').applyOptions({
            scaleMargins: { top: 0.02, bottom: 0.52 },
            borderColor: '#2b2b43',
            autoScale: true,
        });

        // 2) Volume (overlaid on main pane area, its own scale)
        this.volumeSeries = this.chart.addSeries(LightweightCharts.HistogramSeries, {
            priceFormat: { type: 'volume' },
            priceScaleId: 'vol',
        });
        this.chart.priceScale('vol').applyOptions({
            scaleMargins: { top: 0.78, bottom: 0.0 },
            visible: false,
        });

        // 3) RSI pane
        this.rsiSeries = this.chart.addSeries(LightweightCharts.LineSeries, {
            color: '#9c27b0', lineWidth: 2,
            priceScaleId: 'rsi',
        });
        this.chart.priceScale('rsi').applyOptions({
            scaleMargins: { top: 0.72, bottom: 0.12 },
            visible: true,
            borderColor: '#2b2b43',
        });
        try {
            this.rsiSeries.createPriceLine({ price: 70, color: '#f23645', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: '70' });
            this.rsiSeries.createPriceLine({ price: 30, color: '#089981', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: '30' });
            this.rsiSeries.createPriceLine({ price: 50, color: '#787b86', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted, axisLabelVisible: false, title: '50' });
        } catch (e) { /* v5 API differences: ignore */ }

        // Resize observer so chart always fills its container
        if (window.ResizeObserver) {
            this._resizeObserver = new ResizeObserver(() => {
                const rect = container.getBoundingClientRect();
                this.chart.applyOptions({ width: rect.width, height: rect.height });
            });
            this._resizeObserver.observe(container);
        } else {
            window.addEventListener('resize', () => {
                const rect = container.getBoundingClientRect();
                this.chart.applyOptions({ width: rect.width, height: rect.height });
            });
        }
    }

    // ---------- data ----------
    setCandleData(data) {
        if (!this.mainSeries || !data || !data.length) return;
        this.currentData = data.slice().sort((a, b) => this._toSec(a.time) - this._toSec(b.time));
        const fmt = this._fmt(this.currentData);
        this.mainSeries.setData(fmt);
        this.volumeSeries.setData(this._fmtVol(this.currentData));
        this.chart.timeScale().fitContent();
    }

    updateTick(candle) {
        if (!this.mainSeries) return;
        const ts = this._toSec(candle.time);
        this.mainSeries.update({ time: ts, open: +candle.open, high: +candle.high, low: +candle.low, close: +candle.close });
        this.volumeSeries.update({
            time: ts, value: +(candle.volume || 0),
            color: candle.close >= candle.open ? 'rgba(8,153,129,0.45)' : 'rgba(242,54,69,0.45)',
        });
    }

    // ---------- overlays ----------
    _setOverlay(key, series, data) {
        if (this.overlays[key]) {
            try { this.chart.removeSeries(this.overlays[key]); } catch (e) {}
        }
        this.overlays[key] = series;
        series.setData(data.filter(d => d.value !== null && d.value !== undefined).sort((a, b) => a.time - b.time));
    }
    _removeOverlay(key) {
        if (this.overlays[key]) {
            try { this.chart.removeSeries(this.overlays[key]); } catch (e) {}
            delete this.overlays[key];
        }
    }
    _mapArr(values) {
        return this.currentData.map((d, i) => ({ time: this._toSec(d.time), value: values[i] }));
    }

    addSMA(period, color) {
        const sma = TechnicalIndicators.SMA(this.currentData, period);
        const series = this.chart.addSeries(LightweightCharts.LineSeries, { color, lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: `SMA ${period}`, crosshairMarkerVisible: false });
        this._setOverlay(`sma${period}`, series, this._mapArr(sma));
    }
    addEMA(period, color) {
        const ema = TechnicalIndicators.EMA(this.currentData, period);
        const series = this.chart.addSeries(LightweightCharts.LineSeries, { color, lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: `EMA ${period}`, crosshairMarkerVisible: false });
        this._setOverlay(`ema${period}`, series, this._mapArr(ema));
    }
    addVWAP() {
        if (this.vwapSeries) { try { this.chart.removeSeries(this.vwapSeries); } catch (e) {} }
        const vwap = TechnicalIndicators.VWAP(this.currentData);
        this.vwapSeries = this.chart.addSeries(LightweightCharts.LineSeries, {
            color: '#E040FB', lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
            title: 'VWAP', crosshairMarkerVisible: false, lineStyle: LightweightCharts.LineStyle.Dashed,
        });
        this.vwapSeries.setData(this._mapArr(vwap).filter(d => d.value !== null));
    }
    addBollinger() {
        this.removeBollinger();
        const bb = TechnicalIndicators.BollingerBands(this.currentData, 20, 2);
        this.bbUpper = this.chart.addSeries(LightweightCharts.LineSeries, { color: 'rgba(33,150,243,0.7)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: 'BB Upper' });
        this.bbMid   = this.chart.addSeries(LightweightCharts.LineSeries, { color: 'rgba(33,150,243,0.5)', lineWidth: 1, priceLineVisible: false, lastValueVisible: true, title: 'BB Mid', crosshairMarkerVisible: false, lineStyle: LightweightCharts.LineStyle.Dashed });
        this.bbLower = this.chart.addSeries(LightweightCharts.LineSeries, { color: 'rgba(33,150,243,0.7)', lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, title: 'BB Lower' });
        this.bbUpper.setData(this._mapArr(bb.upper).filter(d => d.value !== null));
        this.bbMid.setData(this._mapArr(bb.middle).filter(d => d.value !== null));
        this.bbLower.setData(this._mapArr(bb.lower).filter(d => d.value !== null));
    }
    removeBollinger() {
        [this.bbUpper, this.bbMid, this.bbLower].forEach((s, idx) => {
            if (s) { try { this.chart.removeSeries(s); } catch (e) {} }
        });
        this.bbUpper = this.bbMid = this.bbLower = null;
    }
    addSuperTrend() {
        this.removeSuperTrend();
        const st = TechnicalIndicators.SuperTrend(this.currentData, 10, 3);
        // Colour segments green/red by direction — lightweight-charts single-line series can't change color mid-stream, so approximate with one color & markers. Instead use one line.
        this.supertrendSeries = this.chart.addSeries(LightweightCharts.LineSeries, { color: '#26a69a', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: 'SuperTrend', crosshairMarkerVisible: false });
        this.supertrendSeries.setData(this._mapArr(st.trend).filter(d => d.value !== null));
    }
    removeSuperTrend() {
        if (this.supertrendSeries) { try { this.chart.removeSeries(this.supertrendSeries); } catch (e) {} this.supertrendSeries = null; }
    }

    // ---------- MACD pane ----------
    addMACD() {
        this.removeMACD();
        // Ensure macd price scale exists before configuring margins
        this.macdHist = this.chart.addSeries(LightweightCharts.HistogramSeries, { priceScaleId: 'macd', priceLineVisible: false });
        this.macdFast = this.chart.addSeries(LightweightCharts.LineSeries, { color: '#2962FF', lineWidth: 2, priceScaleId: 'macd', priceLineVisible: false, lastValueVisible: true, title: 'MACD' });
        this.macdSlow = this.chart.addSeries(LightweightCharts.LineSeries, { color: '#FF6D00', lineWidth: 2, priceScaleId: 'macd', priceLineVisible: false, lastValueVisible: true, title: 'Signal' });

        try {
            this.chart.priceScale('macd').applyOptions({
                scaleMargins: { top: 0.88, bottom: 0.00 },
                visible: true, borderColor: '#2b2b43',
            });
        } catch (e) {}

        const macdObj = TechnicalIndicators.MACD(this.currentData);
        const histMap = [], fastMap = [], slowMap = [];
        this.currentData.forEach((d, i) => {
            const ts = this._toSec(d.time);
            if (macdObj.hist[i] != null) histMap.push({ time: ts, value: macdObj.hist[i], color: macdObj.hist[i] >= 0 ? '#089981' : '#f23645' });
            if (macdObj.macd[i] != null) fastMap.push({ time: ts, value: macdObj.macd[i] });
            if (macdObj.signal[i] != null) slowMap.push({ time: ts, value: macdObj.signal[i] });
        });
        this.macdHist.setData(histMap);
        this.macdFast.setData(fastMap);
        this.macdSlow.setData(slowMap);
    }
    removeMACD() {
        [this.macdFast, this.macdSlow, this.macdHist].forEach(s => {
            if (s) { try { this.chart.removeSeries(s); } catch (e) {} }
        });
        this.macdFast = this.macdSlow = this.macdHist = null;
    }

    // ---------- RSI ----------
    addRSI(period = 14) {
        if (!this.rsiSeries) {
            this.rsiSeries = this.chart.addSeries(LightweightCharts.LineSeries, { color: '#9c27b0', lineWidth: 2, priceScaleId: 'rsi' });
        }
        const rsiData = TechnicalIndicators.RSI(this.currentData, period);
        this.rsiSeries.setData(this._mapArr(rsiData).filter(d => d.value !== null));
    }

    // ---------- clear / markers ----------
    clearIndicators() {
        Object.keys(this.overlays).forEach(k => this._removeOverlay(k));
        if (this.vwapSeries) { try { this.chart.removeSeries(this.vwapSeries); } catch (e) {} this.vwapSeries = null; }
        this.removeBollinger();
        this.removeSuperTrend();
        this.removeMACD();
        // RSI is kept (pane + dashed lines); re-render when added
    }

    setMarkers(markersData) {
        if (!this.mainSeries || !Array.isArray(markersData)) return;
        try {
            const formatted = markersData
                .map(m => ({
                    time: this._toSec(m.time),
                    position: m.position, color: m.color,
                    shape: m.shape, text: m.text, size: m.size || 1,
                }))
                .filter(m => !isNaN(m.time))
                .sort((a, b) => a.time - b.time);
            if (typeof this.mainSeries.setMarkers === 'function') this.mainSeries.setMarkers(formatted);
        } catch (err) { console.warn('setMarkers failed', err); }
    }
}
window.tvBridge = new TVBridge();
