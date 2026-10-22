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
            el.id = 'ch-' + p.key;
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
            rightPriceScale: {
                borderColor: '#2b2b43',
                borderVisible: true,
                alignLabels: true,
                minimumWidth: 72,      // uniform across ALL panes for vertical grid alignment
                scaleMargins: { top: 0.05, bottom: 0.05 },
            },
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
                    if (!range || range.from == null || range.to == null) return;
                    if (range.from >= range.to) return;  // LWC would throw
                    this._syncing = true;
                    try { dstTS.setVisibleLogicalRange(range, true); } catch(_) {}
                    this._syncing = false;
                });
            });
        });
    }

    _syncResize() {
        const sync = () => {
            Object.entries(this.charts).forEach(([k, c]) => {
                const el = this.paneEls[k];
                c.applyOptions({ width: el.clientWidth, height: el.clientHeight });
            });
        };
        if (window.ResizeObserver) {
            this._resizeObserver = new ResizeObserver(sync);
            Object.values(this.paneEls).forEach(el => this._resizeObserver.observe(el));
        } else {
            window.addEventListener('resize', sync);
        }
        setTimeout(sync, 60);
        setTimeout(sync, 300);
    }

    // Axis alignment is handled by CSS (css/alignment.css) — every pane's right
    // axis column is forced to 80px via !important, giving pixel-perfect
    // vertical grid alignment regardless of label content or symbol.
    _syncAxisWidths() {}

    _updateAxisBadge(pane, value, color) {
        if (!this.paneEls[pane]) return;
        let badge = this.paneEls[pane].querySelector('.ch-axis-badge');
        if (value == null || !isFinite(value)) { if (badge) badge.remove(); return; }
        if (!badge) {
            badge = document.createElement('div');
            badge.className = 'ch-axis-badge';
            this.paneEls[pane].appendChild(badge);
        }
        badge.style.background = color;
        badge.textContent = value.toFixed(2);
        // RSI: position vertically proportional to 0-100; MACD: pinned near zero
        const h = this.paneEls[pane].clientHeight || 80;
        if (pane === 'rsi') {
            const top = h * 0.08 + (h * 0.84) * (1 - value / 100);
            badge.style.top = Math.max(4, Math.min(h - 20, top - 9)) + 'px';
            badge.style.bottom = 'auto';
        } else {
            badge.style.bottom = '28px';
            badge.style.top = 'auto';
        }
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

        // 2) VOLUME — right axis reserved width with INVISIBLE labels so vertical grid
        //    aligns perfectly with main/RSI/MACD panes (TradingView-pro look)
        this.charts.vol = this._makeChart('vol');
        this.series.vol = this.charts.vol.addSeries(LightweightCharts.HistogramSeries, {
            priceFormat: { type: 'volume' },
            priceScaleId: 'right',
            priceLineVisible: false,
            lastValueVisible: false,
        });
        this.charts.vol.priceScale('right').applyOptions({
            scaleMargins: { top: 0.3, bottom: 0 },
            borderVisible: true,
            borderColor: '#2b2b43',
            visible: true,
            textColor: 'transparent',   // hide numeric labels (200K etc.)
            drawTicks: false,            // hide tick marks
            minimumWidth: 72,            // MUST equal other panes — key to vertical alignment
        });

        // 3) RSI pane — safe autoscale with dashed 30/70 & dotted 50 reference lines
        this.charts.rsi = this._makeChart('rsi');
        this.series.rsi = this.charts.rsi.addSeries(LightweightCharts.LineSeries, {
            color: '#9c27b0', lineWidth: 2, priceScaleId: 'right',
            lastValueVisible: false, priceLineVisible: false,
        });
        this.charts.rsi.priceScale('right').applyOptions({
            scaleMargins: { top: 0.08, bottom: 0.08 },
            autoScale: true,
            minimumWidth: 72,
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
        this.series.macdHist = this.charts.macd.addSeries(LightweightCharts.HistogramSeries, { priceLineVisible: false, lastValueVisible: false });
        this.series.macdFast = this.charts.macd.addSeries(LightweightCharts.LineSeries, { color: '#2962FF', lineWidth: 2, priceLineVisible: false, lastValueVisible: false, title: 'MACD' });
        this.series.macdSlow = this.charts.macd.addSeries(LightweightCharts.LineSeries, { color: '#FF6D00', lineWidth: 2, priceLineVisible: false, lastValueVisible: false, title: 'Signal' });
        // Zero line on MACD (reference for bullish/bearish crossover)
        try {
            this.series.macdFast.createPriceLine({
                price: 0, color: '#787b86', lineWidth: 1,
                lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: false, title: '0',
            });
        } catch (e) {}
        this.charts.macd.priceScale('right').applyOptions({ scaleMargins: { top: 0.1, bottom: 0.1 }, minimumWidth: 72 });

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
        if (!this.series || !this.series.main) return;
        if (!data || !data.length) return;
        // Light cleaning: sort by time + drop clearly invalid rows, preserve all valid candles.
        // (Heavy filtering here was dropping large swathes of valid intraday candles.)
        const rows = [];
        const seen = new Set();
        for (const d of data) {
            if (!d) continue;
            const t = this._toSec(d.time);
            if (!(t > 0)) continue;
            const o = +d.open, h = +d.high, l = +d.low, c = +d.close;
            if (!isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c)) continue;
            if (!(h >= l) || !(o > 0) || !(c > 0)) continue;
            if (seen.has(t)) continue;
            seen.add(t);
            rows.push({ time: t, open: o, high: Math.max(o, h, c), low: Math.min(o, l, c), close: c, volume: d.volume });
        }
        if (rows.length < 2) return;
        rows.sort((a, b) => a.time - b.time);
        this.currentData = rows;
        const fmt = rows.map(d => ({ time: d.time, open: d.open, high: d.high, low: d.low, close: d.close }));
        const vFmt = rows.map(d => ({
            time: d.time, value: +(d.volume || 0),
            color: d.close >= d.open ? 'rgba(8,153,129,0.65)' : 'rgba(242,54,69,0.65)',
        }));
        try { this.series.main.setData(fmt); } catch(e) { console.warn('main.setData', e.message); }
        try { this.series.vol.setData(vFmt); } catch(e) { console.warn('vol.setData', e.message); }
        this._anchorToLatest(rows.length);
    }

    _anchorToLatest(n) {
        // Wait until after setData() has committed — rAF + timer ensures layout is ready
        // and sub-charts (RSI/MACD) have their data attached before touching timeScale.
        const apply = () => {
            if (!this.charts || !this.charts.main) return;
            if (!this.currentData || this.currentData.length < 2) return;
            const totalBars = this.currentData.length;
            // Clamp n to actual data length — RSI/MACD may have fewer bars (indicator warmup)
            const safeN = Math.min(n, totalBars);
            const barsVisible = Math.min(80, Math.max(20, safeN - 1));
            const fromIdx = Math.max(0, safeN - barsVisible);
            const toIdx = safeN - 1;
            if (fromIdx >= toIdx) return;  // invalid range — would throw in LWC
            const range = { from: fromIdx - 0.5, to: toIdx + 6 };
            ['main','vol','rsi','macd'].forEach(k => {
                if (!this.charts[k]) return;
                try { this.charts[k].timeScale().setVisibleLogicalRange(range); } catch (_) {}
                try { this.charts[k].timeScale().scrollToRealTime(); } catch (_) {}
            });
            try { this._syncAxisWidths(); } catch (_) {}
        };
        requestAnimationFrame(() => requestAnimationFrame(apply));
        setTimeout(apply, 80);
        setTimeout(apply, 350);
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
        const lastMacd = fastMap.length ? fastMap[fastMap.length - 1].value : null;
        this._updateAxisBadge('macd', lastMacd, '#2962FF');
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
            const mapped = this._mapArr(rsiData).filter(d => d.value != null && isFinite(d.value));
            this.series.rsi.setData(mapped);
            this.series.rsi.applyOptions({
                autoscaleInfoProvider: () => ({
                    priceRange: { minValue: 0, maxValue: 100 },
                    margins: { above: 4, below: 4 },
                }),
            });
            this._updateAxisBadge('rsi', mapped.length ? mapped[mapped.length - 1].value : null, '#9c27b0');
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
