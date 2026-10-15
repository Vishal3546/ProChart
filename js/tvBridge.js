// ProChart - TradingView Bridge (v4 + v5 Compatible)

class TVChartBridge {
    constructor(containerId) {
        const container = document.getElementById(containerId);
        if (!container) throw new Error("Chart container not found: " + containerId);
        if (typeof LightweightCharts === "undefined") {
            throw new Error("LightweightCharts library not loaded. Check CDN script tag.");
        }

        this.chart = LightweightCharts.createChart(container, {
            layout: {
                background: { type: "solid", color: "#131722" },
                textColor: "#d1d4dc",
                fontFamily: "Inter, sans-serif"
            },
            grid: {
                vertLines: { color: "#1f2933" },
                horzLines: { color: "#1f2933" }
            },
            crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
            rightPriceScale: { borderColor: "#2a2e39", autoScale: true },
            timeScale: {
                borderColor: "#2a2e39",
                timeVisible: true,
                secondsVisible: false
            },
            width: container.clientWidth || 800,
            height: container.clientHeight || 500
        });

        this._isV5 =
            typeof this.chart.addSeries === "function" &&
            typeof LightweightCharts.CandlestickSeries !== "undefined";

        if (this._isV5) {
            this.candleSeries = this.chart.addSeries(LightweightCharts.CandlestickSeries, {
                upColor: "#089981",
                downColor: "#f23645",
                borderVisible: false,
                wickUpColor: "#089981",
                wickDownColor: "#f23645"
            });
            this.volumeSeries = this.chart.addSeries(LightweightCharts.HistogramSeries, {
                priceFormat: { type: "volume" },
                priceScaleId: "vol",
                color: "rgba(8,153,129,0.4)"
            });
            this.chart.priceScale("vol").applyOptions({
                scaleMargins: { top: 0.8, bottom: 0 }
            });
            this.ema20Series = this.chart.addSeries(LightweightCharts.LineSeries, {
                color: "#ff9800", lineWidth: 2, title: "EMA20"
            });
            this.ema50Series = this.chart.addSeries(LightweightCharts.LineSeries, {
                color: "#2962ff", lineWidth: 2, title: "EMA50"
            });
            this.ema200Series = this.chart.addSeries(LightweightCharts.LineSeries, {
                color: "#ea80fc", lineWidth: 2, title: "EMA200"
            });
            this.vwapSeries = this.chart.addSeries(LightweightCharts.LineSeries, {
                color: "#ffd740", lineWidth: 2, lineStyle: 2, title: "VWAP"
            });
        } else {
            this.candleSeries = this.chart.addCandlestickSeries({
                upColor: "#089981",
                downColor: "#f23645",
                borderVisible: false,
                wickUpColor: "#089981",
                wickDownColor: "#f23645"
            });
            this.volumeSeries = this.chart.addHistogramSeries({
                priceFormat: { type: "volume" },
                priceScaleId: "",
                scaleMargins: { top: 0.8, bottom: 0 }
            });
            this.ema20Series = this.chart.addLineSeries({ color: "#ff9800", lineWidth: 2 });
            this.ema50Series = this.chart.addLineSeries({ color: "#2962ff", lineWidth: 2 });
            this.ema200Series = this.chart.addLineSeries({ color: "#ea80fc", lineWidth: 2 });
            this.vwapSeries = this.chart.addLineSeries({ color: "#ffd740", lineWidth: 2, lineStyle: 2 });
        }

        this.activeIndicators = ["ema20"];
        this.currentData = [];

        window.addEventListener("resize", () => {
            if (!container) return;
            this.chart.applyOptions({
                width: container.clientWidth,
                height: container.clientHeight
            });
        });
    }

    setData(data) {
        if (!data || !data.length) return;
        this.currentData = data;

        const candles = data.map(function (c) {
            return {
                time: Math.floor(c.time / 1000),
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close
            };
        });
        this.candleSeries.setData(candles);

        this.volumeSeries.setData(
            data.map(function (c) {
                return {
                    time: Math.floor(c.time / 1000),
                    value: c.volume || 0,
                    color: c.close >= c.open ? "rgba(8,153,129,0.4)" : "rgba(242,54,69,0.4)"
                };
            })
        );

        this.updateIndicators();
        this.chart.timeScale().fitContent();
    }

    updateTick(candle) {
        if (!candle) return;
        const t = Math.floor(candle.time / 1000);
        this.candleSeries.update({
            time: t,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close
        });
        this.volumeSeries.update({
            time: t,
            value: candle.volume || 0,
            color: candle.close >= candle.open ? "rgba(8,153,129,0.4)" : "rgba(242,54,69,0.4)"
        });
        this.updateIndicators();
    }

    updateIndicators() {
        if (!this.currentData.length) return;
        if (typeof TechnicalIndicators === "undefined") return;

        const closes = this.currentData.map(function (c) { return c.close; });
        const times = this.currentData.map(function (c) { return Math.floor(c.time / 1000); });

        const toLine = function (arr) {
            const out = [];
            for (let i = 0; i < arr.length; i++) {
                if (arr[i] != null && !isNaN(arr[i])) {
                    out.push({ time: times[i], value: arr[i] });
                }
            }
            return out;
        };

        this.ema20Series.setData(
            this.activeIndicators.indexOf("ema20") >= 0 ? toLine(TechnicalIndicators.EMA(closes, 20)) : []
        );
        this.ema50Series.setData(
            this.activeIndicators.indexOf("ema50") >= 0 ? toLine(TechnicalIndicators.EMA(closes, 50)) : []
        );
        this.ema200Series.setData(
            this.activeIndicators.indexOf("ema200") >= 0 ? toLine(TechnicalIndicators.EMA(closes, 200)) : []
        );
        this.vwapSeries.setData(
            this.activeIndicators.indexOf("vwap") >= 0 ? toLine(TechnicalIndicators.VWAP(this.currentData)) : []
        );
    }

    setPatternMarkers(patterns) {
        if (!patterns || !this.currentData.length) {
            this.candleSeries.setMarkers([]);
            return;
        }
        const markers = [];
        const self = this;
        patterns.forEach(function (p) {
            const c = self.currentData[p.index];
            if (!c) return;
            const bull = p.signal === "bullish";
            let tag = "P";
            if (p.name && p.name.indexOf("Engulf") >= 0) tag = "E";
            else if (p.name && p.name.indexOf("Hammer") >= 0) tag = "H";
            else if (p.name && p.name.indexOf("Star") >= 0) tag = "S";
            else if (p.name && p.name.indexOf("Doji") >= 0) tag = "D";
            markers.push({
                time: Math.floor(c.time / 1000),
                position: bull ? "belowBar" : "aboveBar",
                color: bull ? "#089981" : "#f23645",
                shape: bull ? "arrowUp" : "arrowDown",
                text: tag
            });
        });
        markers.sort(function (a, b) { return a.time - b.time; });
        this.candleSeries.setMarkers(markers);
    }
}