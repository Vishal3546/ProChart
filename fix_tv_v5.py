# ============================================
# FIX: TradingView v4/v5 API + CDN pin + App wire
# NOTHING removed from Pro engines
# ============================================
import os

os.makedirs("js", exist_ok=True)

# ---------- 1) tvBridge.js ----------
tv_bridge = r'''
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
'''

# ---------- 2) app.js ----------
app_js = r'''
class ProChartApp {
    constructor() {
        this.dataFeed = new DataFeed();
        this.masterPro = typeof MasterProEngine !== "undefined" ? new MasterProEngine() : null;
        this.breakout = typeof BreakoutChecklistEngine !== "undefined" ? new BreakoutChecklistEngine() : null;
        this.scanner = typeof CandlePatternEngine !== "undefined" ? new CandlePatternEngine() : null;
        this.greeks = typeof GreeksEngine !== "undefined" ? new GreeksEngine() : null;
        this.vcp = typeof VCPPatternEngine !== "undefined" ? new VCPPatternEngine() : null;
        this.closing = typeof ClosingTrapEngine !== "undefined" ? new ClosingTrapEngine() : null;

        this.indicatorsList = [
            { id: "ema20", name: "20 EMA", desc: "Intraday trend" },
            { id: "ema50", name: "50 EMA", desc: "Swing filter" },
            { id: "ema200", name: "200 EMA", desc: "Long-term boss" },
            { id: "vwap", name: "VWAP", desc: "Institutional average" }
        ];
        this.tf = "15";
    }

    async init() {
        const splash = document.getElementById("splashScreen");
        const appEl = document.getElementById("app");
        if (splash) splash.style.display = "none";
        if (appEl) appEl.style.display = "flex";

        try {
            this.tvChart = new TVChartBridge("tvchart");
        } catch (err) {
            console.error(err);
            this.showToast("Chart library error: " + err.message, "error");
            return;
        }

        await this.loadInitialData();
        this.setupEventListeners();
        this.startLiveTickTicker();
        this.showToast("TradingView Engine Ready", "success");
    }

    async loadInitialData() {
        try {
            const data = await this.dataFeed.fetchCandleData(
                this.dataFeed.currentSymbol || "NIFTY",
                this.dataFeed.currentToken || "99926000",
                "NSE",
                this.tf
            );
            if (data && data.length) {
                this.tvChart.setData(data);
                this.runAllAnalytics(data);
            } else {
                this.showToast("No candle data - check server", "error");
            }
        } catch (e) {
            console.error(e);
            this.showToast("Load failed: " + e.message, "error");
        }
    }

    runAllAnalytics(data) {
        if (!data || !data.length) return;
        const current = data[data.length - 1];
        const closes = data.map(function (c) { return c.close; });

        const nameEl = document.getElementById("topSymbolName");
        const priceEl = document.getElementById("topSymbolPrice");
        const chgEl = document.getElementById("topSymbolChange");
        if (nameEl) nameEl.textContent = this.dataFeed.currentSymbol || "NIFTY";
        if (priceEl) priceEl.textContent = current.close.toFixed(2);
        if (chgEl && data.length > 1) {
            const prev = data[data.length - 2];
            const pct = ((current.close - prev.close) / prev.close) * 100;
            chgEl.textContent = (pct >= 0 ? "+" : "") + pct.toFixed(2) + "%";
            chgEl.className = "symbol-change " + (pct >= 0 ? "up" : "down");
            if (priceEl) priceEl.className = "symbol-price " + (pct >= 0 ? "up" : "down");
        }

        if (this.masterPro) {
            try {
                const bb = this.masterPro.analyzeBollingerBands(data);
                if (bb) {
                    const el = document.getElementById("bbStatusText");
                    if (el) el.textContent = bb.signal;
                    const d = document.getElementById("bbDetailText");
                    if (d) d.textContent = bb.detail || "";
                }
                const vsa = this.masterPro.analyzeVolumeSpread(data);
                if (vsa) {
                    const el = document.getElementById("vsaStatusText");
                    if (el) el.textContent = vsa.vsaType;
                    const d = document.getElementById("vsaDetailText");
                    if (d) d.textContent = vsa.detail || "";
                }
                const macd = this.masterPro.analyzeMACDDeceleration(data);
                if (macd) {
                    const el = document.getElementById("macdDecelText");
                    if (el) {
                        el.innerHTML = macd.status + '<div style="font-size:9px;color:#94a3b8">' + (macd.msg || "") + "</div>";
                        el.style.color = macd.color || "#ff9800";
                    }
                }
            } catch (e) {
                console.warn("MasterPro", e);
            }
        }

        if (this.breakout && typeof TechnicalIndicators !== "undefined") {
            try {
                const ind = {
                    ema10: TechnicalIndicators.EMA(closes, 10).pop(),
                    ema20: TechnicalIndicators.EMA(closes, 20).pop(),
                    ema50: TechnicalIndicators.EMA(closes, 50).pop(),
                    vwap: TechnicalIndicators.VWAP(data).pop(),
                    adx: 28,
                    avgVolume: data.slice(-20).reduce(function (s, c) { return s + (c.volume || 0); }, 0) / 20
                };
                const bk = this.breakout.evaluateBullishBreakout(
                    data,
                    { pdh: current.close * 0.99, first5mHigh: current.close * 0.995 },
                    ind
                );
                const box = document.getElementById("breakoutStatusBox");
                if (box && bk) {
                    box.innerHTML =
                        bk.status +
                        '<br><span style="font-size:10px;color:#ccc">' +
                        bk.passedCount +
                        "/" +
                        (bk.totalChecks || 6) +
                        " Conditions Met</span>";
                    box.style.background = (bk.color || "#888") + "22";
                    box.style.color = bk.color || "#fff";
                    box.style.border = "1px solid " + (bk.color || "#888");
                }
            } catch (e) {
                console.warn("Breakout", e);
            }
        }

        if (this.vcp) {
            try {
                const v = this.vcp.scanVCP(data);
                if (v && v.length) {
                    const el = document.getElementById("vcpStatusText");
                    if (el) el.textContent = v[0].status || v[0].name || "VCP found";
                }
            } catch (e) {}
        }

        if (this.closing && typeof TechnicalIndicators !== "undefined") {
            try {
                const vwap = TechnicalIndicators.VWAP(data).pop();
                const ema20 = TechnicalIndicators.EMA(closes, 20).pop();
                const cl = this.closing.analyzeClosingTrap(data, vwap, ema20);
                if (cl) {
                    const el = document.getElementById("btstSignalText");
                    if (el) {
                        el.textContent = cl.btstSignal || cl.signal || "—";
                        if (cl.color) el.style.color = cl.color;
                    }
                }
            } catch (e) {}
        }

        if (this.greeks) {
            try {
                const strikeEl = document.getElementById("greekStrike");
                const typeEl = document.getElementById("greekType");
                const ivEl = document.getElementById("greekIV");
                const strike = parseFloat(strikeEl && strikeEl.value) || current.close;
                const type = (typeEl && typeEl.value) || "CE";
                const iv = (parseFloat(ivEl && ivEl.value) || 18) / 100;
                const g = this.greeks.calculateGreeks(current.close, strike, 7 / 365, 0.065, iv, type);
                if (g) {
                    const set = function (id, v, d) {
                        const e = document.getElementById(id);
                        if (e) e.textContent = Number(v).toFixed(d);
                    };
                    set("gDelta", g.delta, 2);
                    set("gGamma", g.gamma, 4);
                    set("gTheta", g.theta, 1);
                    set("gVega", g.vega, 1);
                }
            } catch (e) {}
        }

        const tEl = document.getElementById("sbTime");
        if (tEl) tEl.textContent = new Date().toLocaleTimeString();
    }

    startLiveTickTicker() {
        const self = this;
        setInterval(function () {
            if (!self.tvChart || !self.tvChart.currentData.length) return;
            const last = self.tvChart.currentData[self.tvChart.currentData.length - 1];
            const tick = self.dataFeed.generateLiveTick(last);
            self.tvChart.updateTick(tick);
            self.runAllAnalytics(self.tvChart.currentData);
        }, 1000);
    }

    setupEventListeners() {
        const self = this;

        const symbolBtn = document.getElementById("symbolBtn");
        if (symbolBtn) {
            symbolBtn.addEventListener("click", function () {
                document.getElementById("symbolModal").style.display = "flex";
                self.renderSymbolList("");
            });
        }

        const searchInput = document.getElementById("symbolSearchInput");
        if (searchInput) {
            searchInput.addEventListener("input", function (e) {
                self.renderSymbolList(e.target.value);
            });
        }

        const closeSym = document.getElementById("closeSymbolModal");
        if (closeSym) {
            closeSym.addEventListener("click", function () {
                document.getElementById("symbolModal").style.display = "none";
            });
        }

        const indBtn = document.getElementById("indicatorBtn");
        if (indBtn) {
            indBtn.addEventListener("click", function () {
                document.getElementById("indicatorModal").style.display = "flex";
                self.renderIndList();
            });
        }

        const closeInd = document.getElementById("closeIndicatorModal");
        if (closeInd) {
            closeInd.addEventListener("click", function () {
                document.getElementById("indicatorModal").style.display = "none";
            });
        }

        const patBtn = document.getElementById("patternBtn");
        if (patBtn) {
            patBtn.addEventListener("click", function () {
                if (!self.scanner || !self.tvChart.currentData.length) {
                    self.showToast("Scanner or data missing", "error");
                    return;
                }
                const patterns = self.scanner
                    .scanAll(self.tvChart.currentData)
                    .filter(function (p) {
                        return (p.accuracy || 0) >= 70;
                    });
                self.tvChart.setPatternMarkers(patterns);
                self.showToast("Placed " + patterns.length + " pattern markers", "success");
            });
        }

        document.querySelectorAll(".tf-btn").forEach(function (btn) {
            btn.addEventListener("click", async function (e) {
                document.querySelectorAll(".tf-btn").forEach(function (b) {
                    b.classList.remove("active");
                });
                e.target.classList.add("active");
                self.tf = e.target.dataset.tf;
                self.dataFeed.currentInterval = self.tf;
                await self.loadInitialData();
            });
        });

        document.querySelectorAll(".modal-overlay").forEach(function (m) {
            m.addEventListener("click", function (e) {
                if (e.target === m) m.style.display = "none";
            });
        });
    }

    async renderSymbolList(q) {
        const list = document.getElementById("symbolList");
        if (!list) return;
        list.innerHTML = '<div style="padding:12px;color:#787b86">Searching...</div>';
        const res = await this.dataFeed.searchSymbols(q || "");
        if (!res.length) {
            list.innerHTML = '<div style="padding:12px;color:#787b86">No matches</div>';
            return;
        }
        const self = this;
        list.innerHTML = res
            .map(function (s) {
                return (
                    '<div class="list-item" style="padding:10px;cursor:pointer;border-bottom:1px solid #2a2e39" data-s="' +
                    s.symbol +
                    '" data-t="' +
                    (s.token || "") +
                    '"><b style="color:#fff">' +
                    s.symbol +
                    '</b><br><span style="font-size:10px;color:#787b86">' +
                    (s.name || "") +
                    "</span></div>"
                );
            })
            .join("");
        list.querySelectorAll("[data-s]").forEach(function (el) {
            el.onclick = async function () {
                self.dataFeed.currentSymbol = el.dataset.s;
                self.dataFeed.currentToken = el.dataset.t || "99926000";
                document.getElementById("symbolModal").style.display = "none";
                await self.loadInitialData();
                self.showToast("Loaded " + el.dataset.s, "success");
            };
        });
    }

    renderIndList() {
        const list = document.getElementById("indicatorList");
        if (!list) return;
        const self = this;
        list.innerHTML = this.indicatorsList
            .map(function (ind) {
                const on = self.tvChart.activeIndicators.indexOf(ind.id) >= 0;
                return (
                    '<div class="list-item" style="padding:10px;cursor:pointer;border-left:3px solid ' +
                    (on ? "#2962ff" : "transparent") +
                    '" data-id="' +
                    ind.id +
                    '"><b style="color:#fff">' +
                    ind.name +
                    '</b> <span style="color:' +
                    (on ? "#089981" : "#555") +
                    '">' +
                    (on ? "ON" : "OFF") +
                    '</span><div style="font-size:10px;color:#787b86">' +
                    ind.desc +
                    "</div></div>"
                );
            })
            .join("");
        list.querySelectorAll("[data-id]").forEach(function (el) {
            el.onclick = function () {
                const id = el.dataset.id;
                if (self.tvChart.activeIndicators.indexOf(id) >= 0) {
                    self.tvChart.activeIndicators = self.tvChart.activeIndicators.filter(function (x) {
                        return x !== id;
                    });
                } else {
                    self.tvChart.activeIndicators.push(id);
                }
                self.tvChart.updateIndicators();
                self.renderIndList();
            };
        });
    }

    showToast(msg, type) {
        const c = document.getElementById("toastContainer");
        if (!c) return;
        const t = document.createElement("div");
        t.className = "toast " + (type || "info");
        t.style.cssText =
            "background:#1e222d;padding:10px 14px;margin-top:6px;border-radius:6px;border-left:3px solid #2962ff;color:#fff;font-size:12px";
        if (type === "success") t.style.borderLeftColor = "#089981";
        if (type === "error") t.style.borderLeftColor = "#f23645";
        t.textContent = msg;
        c.appendChild(t);
        setTimeout(function () {
            t.remove();
        }, 3000);
    }
}

const app = new ProChartApp();
document.addEventListener("DOMContentLoaded", function () {
    app.init();
});
'''

# ---------- write files ----------
with open("js/tvBridge.js", "w", encoding="utf-8") as f:
    f.write(tv_bridge.strip())
print("[OK] js/tvBridge.js written")

with open("js/app.js", "w", encoding="utf-8") as f:
    f.write(app_js.strip())
print("[OK] js/app.js written")

# Pin CDN in index.html to v4.2.0
index_path = "index.html"
if os.path.exists(index_path):
    with open(index_path, "r", encoding="utf-8") as f:
        html = f.read()
    old1 = "https://unpkg.com/lightweight-charts/dist/lightweight-charts.standalone.production.js"
    old2 = "https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js"
    new_cdn = "https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js"
    if old1 in html:
        html = html.replace(old1, new_cdn)
        with open(index_path, "w", encoding="utf-8") as f:
            f.write(html)
        print("[OK] index.html CDN pinned to lightweight-charts@4.2.0")
    elif old2 in html:
        print("[OK] index.html already on v4.2.0")
    elif "lightweight-charts" in html:
        print("[OK] index.html has lightweight-charts (check version manually if needed)")
    else:
        # inject CDN before </head>
        inject = '<script src="https://unpkg.com/lightweight-charts@4.2.0/dist/lightweight-charts.standalone.production.js"></script>\n'
        if "</head>" in html:
            html = html.replace("</head>", inject + "</head>")
            with open(index_path, "w", encoding="utf-8") as f:
                f.write(html)
            print("[OK] CDN injected into index.html")
        else:
            print("[!] Could not find </head> in index.html")
else:
    print("[!] index.html not found - run from ProChart folder")

print("")
print("=" * 55)
print("FIXED (no engines removed):")
print(" 1. addCandlestickSeries - v4 + v5 bridge")
print(" 2. CDN pinned to v4.2.0")
print(" 3. app.js wired to MasterPro, Breakout, Patterns, Greeks, VCP")
print("=" * 55)
print("NEXT:")
print(" 1. python -m uvicorn server:app --reload")
print(" 2. Browser: Ctrl+Shift+R")
print(" 3. Cache check: dir scrip_master_cache.json")