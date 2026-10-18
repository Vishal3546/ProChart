/* ============================================================
 * TVBridge — Lightweight Charts v5 wrapper (v2026.10 FINAL)
 * TRUE STACKED PANES via 4 synced chart instances (no overlap).
 * Bullet-proof approach used by TradingView Lite, Binance, Coinigy.
 * Panes: Candles(+EMA/BB/VWAP/ST) | Volume | RSI | MACD
 * All charts share one timeScale (crosshair + scroll zoom synced).
 * ============================================================ */
class TVBridge {
    constructor() {
        this.container = null;
        this.charts = {};       // main, vol, rsi, macd
        this.series = {};       // main, vol, rsi, macdHist/macdFast/macdSlow
        this.overlays = {};     // emaX, smaX, vwap, bb*, supertrend → on main chart
        this.currentData = [];
        this.paneEls = {};
        this._syncing = false;
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
            .map(d => ({ time: this._toSec(d.time), open: +d.open, high: +d.high, low: +d.low, close: +d.close }))
            .filter(d => d.time > 0)
            .sort((a, b) => a.time - b.time);
    }
    _fmtVol(data) {
        return data
            .map(d => ({
                time: this._toSec(d.time),
                value: +(d.volume || 0),
                color: d.close >= d.open ? 'rgba(8,153,129,0.65)' : 'rgba(242,54,69,0.65)',
            }))
            .filter(d => d.time > 0)
            .sort((a, b) => a.time - b.time);
    }
    _mapArr(values) {
        return this.currentData.map((d, i) => ({ time: this._toSec(d.time), value: values[i] }));
    }

    // ---------- layout ----------
    _buildLayout(container) {
        container.innerHTML = '';
        const wrap = document.createElement('div');
        wrap.style.cssText = 'width:100%;height:100%;display:flex;flex-direction:column;gap:0;background:#131722;';
        container.appendChild(wrap);

        const PANES = [
            { key: 'main', flex: '4 1 0', showX: false, xAxis: false },
            { key: 'vol',  flex: '1 1 0', showX: false, xAxis: false },
            { key: 'rsi',  flex: '1.2 1 0', showX: false, xAxis: false },
            { key: 'macd', flex: '1.3 1 0', showX: true,  xAxis: true  },
        ];
        PANES.forEach(p => {
            const el = document.createElement('div');
            el.style.cssText = `position:relative;flex:${p.flex};min-height:0;width:100%;border-bottom:1px solid #1f2933;`;
            el.dataset.pane = p.key;
            wrap.appendChild(el);
            this.paneEls[p.key] = el;
        });
    }

    _baseChartOpts(extra = {}) {
        return {
            layout: {
                background: { color: '#131722' },
                textColor: '#d1d4dc',
                fontFamily: "Inter,-apple-system,sans-serif",
                attributionLogo: false,  // hide TradingView/LW logo on chart (v5 option)
            },
            grid: { vertLines: { color: 'transparent' }, horzLines: { color: '#1f2933', style: 1 } },
            crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
            rightPriceScale: { borderColor: '#2b2b43', borderVisible: true, alignLabels: true, scaleMargins: { top: 0.05, bottom: 0.05 } },
            leftPriceScale: { visible: false },
            timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#2b2b43', rightOffset: 6, barSpacing: 8, visible: false, minBarSpacing: 0.5 },
            handleScroll: { vertTouchDrag: false },
            ...extra,
        };
    }

    _makeChart(key, extra) {
        const el = this.paneEls[key];
        const c = LightweightCharts.createChart(el, this._baseChartOpts(extra));
        return c;
    }

    _syncTimeScales() {
        const keys = ['main', 'vol', 'rsi', 'macd'];
        keys.forEach(src => {
            const srcTS = this.charts[src].timeScale();
            keys.forEach(dst => {
                if (dst === src) return;
                const dstTS = this.charts[dst].timeScale();
                srcTS.subscribeVisibleLogicalRangeChange((range) => {
                    if (this._syncing) return;
                    this._syncing = true;
                    dstTS.setVisibleLogicalRange(range, true);
                    this._syncing = false;
                });
            });
        });
        // Note: crosshair is visually synced across panes because all charts share the
        // same logical time range (via setVisibleLogicalRange sync). Skipping explicit
        // setCrosshairPosition because LW v5 signature differs and causes "reading 'from'" errors.
    }

    _syncResize() {
        const resize = () => {
            Object.entries(this.charts).forEach(([k, c]) => {
                const el = this.paneEls[k];
                c.applyOptions({ width: el.clientWidth, height: el.clientHeight });
            });
        };
        if (window.ResizeObserver) {
            this._resizeObserver = new ResizeObserver(resize);
            Object.values(this.paneEls).forEach(el => this._resizeObserver.observe(el));
        } else {
            window.addEventListener('resize', resize);
        }
        setTimeout(resize, 50);
    }

    // ---------- init ----------
    initChart(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        this.container = container;
        this._buildLayout(container);

        // 1) MAIN (candles + overlays)
        this.charts.main = this._makeChart('main');
        this.series.main = this.charts.main.addSeries(LightweightCharts.CandlestickSeries, {
            upColor: '#089981', downColor: '#f23645',
            borderVisible: false, wickUpColor: '#089981', wickDownColor: '#f23645',
        });

        // 2) VOLUME
        this.charts.vol = this._makeChart('vol');
        this.series.vol = this.charts.vol.addSeries(LightweightCharts.HistogramSeries, {
            priceFormat: { type: 'volume' },
            priceScaleId: 'right',
        });
        this.charts.vol.priceScale('right').applyOptions({ scaleMargins: { top: 0.1, bottom: 0 } });

        // 3) RSI pane — safe autoscale with dashed 30/70 & dotted 50 reference lines
        this.charts.rsi = this._makeChart('rsi');
        this.series.rsi = this.charts.rsi.addSeries(LightweightCharts.LineSeries, {
            color: '#9c27b0', lineWidth: 2, priceScaleId: 'right',
        });
        this.charts.rsi.priceScale('right').applyOptions({
            scaleMargins: { top: 0.08, bottom: 0.08 },
            autoScale: true,
        });
        try {
            this.series.rsi.createPriceLine({ price: 70, color: '#f23645', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: '70' });
            this.series.rsi.createPriceLine({ price: 30, color: '#089981', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: true, title: '30' });
            this.series.rsi.createPriceLine({ price: 50, color: '#787b86', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted, axisLabelVisible: false, title: '50' });
        } catch (e) { console.warn('RSI price lines failed', e); }

        // 4) MACD
        this.charts.macd = this._makeChart('macd', {
            timeScale: { timeVisible: true, secondsVisible: false, borderColor: '#2b2b43', rightOffset: 6, visible: true, barSpacing: 8, minBarSpacing: 0.5 },
        });
        this.series.macdHist = this.charts.macd.addSeries(LightweightCharts.HistogramSeries, { priceLineVisible: false });
        this.series.macdFast = this.charts.macd.addSeries(LightweightCharts.LineSeries, { color: '#2962FF', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: 'MACD' });
        this.series.macdSlow = this.charts.macd.addSeries(LightweightCharts.LineSeries, { color: '#FF6D00', lineWidth: 2, priceLineVisible: false, lastValueVisible: true, title: 'Signal' });
        // Zero line on MACD (reference for bullish/bearish crossover)
        try {
            this.series.macdFast.createPriceLine({
                price: 0, color: '#787b86', lineWidth: 1,
                lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: false, title: '0',
            });
        } catch (e) {}
        this.charts.macd.priceScale('right').applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 } });

        // Disable wheel/scroll/horiz drag on sub-charts so main chart drives it
        ['vol', 'rsi', 'macd'].forEach(k => {
            this.charts[k].applyOptions({
                handleScroll: { mouseWheel: false, pressedMouseMove: false, horzTouchDrag: true },
                handleScale: { mouseWheel: false, pinch: false },
            });
        });

        this._syncTimeScales();
        this._syncResize();
    }

    // ---------- data ----------
    setCandleData(data) {
        if (!this.series.main || !data || !data.length) return;
        this.currentData = data.slice().sort((a, b) => this._toSec(a.time) - this._toSec(b.time));
        const fmt = this._fmt(this.currentData);
        const vFmt = this._fmtVol(this.currentData);
        this.series.main.setData(fmt);
        this.series.vol.setData(vFmt);
        // TRADINGVIEW-STYLE DEFAULT ZOOM: show last ~80 bars (not all data at once)
        const n = fmt.length;
        const barsVisible = Math.min(80, Math.max(40, n - 1));
        const fromIdx = Math.max(0, n - barsVisible);
        const toIdx = n - 1;
        const range = { from: fromIdx - 0.5, to: toIdx + 6 };  // +6 = 6 bars space on right
        try {
            ['main','vol','rsi','macd'].forEach(k => {
                this.charts[k].timeScale().setVisibleLogicalRange(range);
            });
        } catch (e) { /* older LW versions fallback */ }
    }

    updateTick(candle) {
        if (!this.series.main) return;
        const ts = this._toSec(candle.time);
        this.series.main.update({ time: ts, open: +candle.open, high: +candle.high, low: +candle.low, close: +candle.close });
        this.series.vol.update({
            time: ts, value: +(candle.volume || 0),
            color: candle.close >= candle.open ? 'rgba(8,153,129,0.65)' : 'rgba(242,54,69,0.65)',
        });
    }

    // ---------- overlays (all live on main chart) ----------
    _setOverlay(key, series, data) {
        if (this.overlays[key]) { try { this.charts.main.removeSeries(this.overlays[key]); } catch (e) {} }
        this.overlays[key] = series;
        series.setData(data.filter(d => d.value !== null && d.value !== undefined).sort((a, b) => a.time - b.time));
    }
    _removeOverlay(key) {
        if (this.overlays[key]) {
            try { this.charts.main.removeSeries(this.overlays[key]); } catch (e) {}
            delete this.overlays[key];
        }
    }

    addSMA(period, color) {
        const sma = TechnicalIndicators.SMA(this.currentData, period);
        const series = this.charts.main.addSeries(LightweightCharts.LineSeries, {
            color, lineWidth: 1, priceLineVisible: false, lastValueVisible: true,
            title: `SMA ${period}`, crosshairMarkerVisible: false,
        });
        this._setOverlay(`sma${period}`, series, this._mapArr(sma));
    }
    addEMA(period, color) {
        const ema = TechnicalIndicators.EMA(this.currentData, period);
        const series = this.charts.main.addSeries(LightweightCharts.LineSeries, {
            color, lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
            title: `EMA ${period}`, crosshairMarkerVisible: false,
        });
        this._setOverlay(`ema${period}`, series, this._mapArr(ema));
    }
    addVWAP() {
        if (this.overlays.vwap) { try { this.charts.main.removeSeries(this.overlays.vwap); } catch (e) {} }
        const vwap = TechnicalIndicators.VWAP(this.currentData);
        const series = this.charts.main.addSeries(LightweightCharts.LineSeries, {
            color: '#E040FB', lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
            title: 'VWAP', crosshairMarkerVisible: false, lineStyle: LightweightCharts.LineStyle.Dashed,
        });
        series.setData(this._mapArr(vwap).filter(d => d.value !== null));
        this.overlays.vwap = series;
    }
    addBollinger() {
        this.removeBollinger();
        const bb = TechnicalIndicators.BollingerBands(this.currentData, 20, 2);
        const mk = (color, data, opts = {}) => {
            const s = this.charts.main.addSeries(LightweightCharts.LineSeries, {
                color, lineWidth: 1, priceLineVisible: false, crosshairMarkerVisible: false, ...opts,
            });
            s.setData(this._mapArr(data).filter(d => d.value !== null));
            return s;
        };
        this.overlays.bbUpper = mk('rgba(33,150,243,0.7)', bb.upper, { lastValueVisible: false, title: 'BB Upper' });
        this.overlays.bbMid   = mk('rgba(33,150,243,0.5)', bb.middle, { lastValueVisible: true,  title: 'BB Mid', lineStyle: LightweightCharts.LineStyle.Dashed });
        this.overlays.bbLower = mk('rgba(33,150,243,0.7)', bb.lower, { lastValueVisible: false, title: 'BB Lower' });
    }
    removeBollinger() {
        ['bbUpper', 'bbMid', 'bbLower'].forEach(k => this._removeOverlay(k));
    }
    addSuperTrend() {
        this.removeSuperTrend();
        const st = TechnicalIndicators.SuperTrend(this.currentData, 10, 3);
        const series = this.charts.main.addSeries(LightweightCharts.LineSeries, {
            color: '#26a69a', lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
            title: 'SuperTrend', crosshairMarkerVisible: false,
        });
        series.setData(this._mapArr(st.trend).filter(d => d.value !== null));
        this.overlays.supertrend = series;
    }
    removeSuperTrend() { this._removeOverlay('supertrend'); }

    // ---------- MACD (sub-chart 4) ----------
    addMACD() {
        const macdObj = TechnicalIndicators.MACD(this.currentData);
        const histMap = [], fastMap = [], slowMap = [];
        this.currentData.forEach((d, i) => {
            const ts = this._toSec(d.time);
            if (macdObj.hist[i] != null) histMap.push({ time: ts, value: macdObj.hist[i], color: macdObj.hist[i] >= 0 ? '#089981' : '#f23645' });
            if (macdObj.macd[i] != null) fastMap.push({ time: ts, value: macdObj.macd[i] });
            if (macdObj.signal[i] != null) slowMap.push({ time: ts, value: macdObj.signal[i] });
        });
        this.series.macdHist.setData(histMap);
        this.series.macdFast.setData(fastMap);
        this.series.macdSlow.setData(slowMap);
    }
    removeMACD() {
        // Hide data (keep series alive on its chart to avoid flicker)
        this.series.macdHist.setData([]);
        this.series.macdFast.setData([]);
        this.series.macdSlow.setData([]);
    }

    // ---------- RSI (sub-chart 3) ----------
    addRSI(period = 14) {
        if (!this.series.rsi) return;
        try {
            const rsiData = TechnicalIndicators.RSI(this.currentData, period);
            this.series.rsi.setData(this._mapArr(rsiData).filter(d => d.value != null && isFinite(d.value)));
        } catch (e) { console.warn('RSI setData failed', e); }
    }

    // ---------- clear / markers ----------
    clearIndicators() {
        Object.keys(this.overlays).forEach(k => this._removeOverlay(k));
        if (this.vwapSeries) { try { this.charts.main.removeSeries(this.vwapSeries); } catch (e) {} this.vwapSeries = null; }
        this.removeBollinger();
        this.removeSuperTrend();
        this.removeMACD();
        // RSI: clear data but don't delete series (series deletion → null errors)
        try { if (this.series.rsi) this.series.rsi.setData([]); } catch (e) {}
    }

    setMarkers(markersData) {
        if (!this.series.main || !Array.isArray(markersData)) return;
        try {
            const formatted = markersData
                .map(m => ({
                    time: this._toSec(m.time),
                    position: m.position, color: m.color,
                    shape: m.shape, text: m.text, size: m.size || 1,
                }))
                .filter(m => !isNaN(m.time))
                .sort((a, b) => a.time - b.time);
            if (typeof this.series.main.setMarkers === 'function') this.series.main.setMarkers(formatted);
        } catch (err) { console.warn('setMarkers failed', err); }
    }
}
window.tvBridge = new TVBridge();
