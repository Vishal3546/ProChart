# ============================================
# ProChart Terminal™ - Direct Folder Rebuilder
# Writes pristine, complete code directly into current folder
# ============================================

import os

# Create css and js folders in current working directory
os.makedirs("css", exist_ok=True)
os.makedirs("js", exist_ok=True)

files = {}

# -------------------------------------------------------------
# 1. INDEX.HTML
# -------------------------------------------------------------
files["index.html"] = """<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ProChart Terminal™ - Advanced Trading Platform 2026</title>
    <link rel="stylesheet" href="css/styles.css">
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
</head>
<body>
    <!-- SPLASH SCREEN -->
    <div id="splashScreen" class="splash-screen">
        <div class="splash-content">
            <div class="splash-logo">
                <div class="logo-icon"><i class="fas fa-chart-line"></i></div>
                <h1>ProChart Terminal™</h1>
                <p>Advanced AI & Institutional Trading Terminal 2026</p>
            </div>
            <div class="splash-loader">
                <div class="loader-bar"><div class="loader-fill"></div></div>
                <span class="loader-text">Loading Institutional Engines & Equities...</span>
            </div>
        </div>
    </div>

    <!-- MAIN APP CONTAINER -->
    <div id="app" class="app-container" style="display:none;">
        
        <!-- TOP NAVBAR -->
        <nav class="top-navbar">
            <div class="nav-left">
                <div class="logo"><i class="fas fa-chart-line"></i><span>ProChart<sup>™</sup></span></div>
                <div class="symbol-selector">
                    <button id="symbolBtn" class="symbol-btn" title="Search Stocks & Indices">
                        <span class="symbol-name">NIFTY 50</span>
                        <span class="symbol-price up" id="currentPrice">22,456.80</span>
                        <span class="symbol-change up" id="priceChange">+1.24%</span>
                        <i class="fas fa-chevron-down"></i>
                    </button>
                </div>
                <div class="timeframe-selector" id="timeframeSelector">
                    <button class="tf-btn" data-tf="1">1m</button>
                    <button class="tf-btn" data-tf="3">3m</button>
                    <button class="tf-btn" data-tf="5">5m</button>
                    <button class="tf-btn active" data-tf="15">15m</button>
                    <button class="tf-btn" data-tf="30">30m</button>
                    <button class="tf-btn" data-tf="60">1H</button>
                    <button class="tf-btn" data-tf="240">4H</button>
                    <button class="tf-btn" data-tf="D">1D</button>
                </div>
            </div>
            <div class="nav-center">
                <div class="chart-type-selector">
                    <button class="ct-btn active" data-type="candle" title="Candlestick"><i class="fas fa-grip-lines-vertical"></i></button>
                    <button class="ct-btn" data-type="heikinashi" title="Heikin Ashi"><i class="fas fa-bars"></i></button>
                    <button class="ct-btn" data-type="line" title="Line Chart"><i class="fas fa-chart-line"></i></button>
                    <button class="ct-btn" data-type="area" title="Area Chart"><i class="fas fa-chart-area"></i></button>
                </div>
            </div>
            <div class="nav-right">
                <button class="nav-btn" id="indicatorBtn"><i class="fas fa-wave-square"></i><span>Indicators</span></button>
                <button class="nav-btn" id="patternBtn"><i class="fas fa-searchengin"></i><span>Patterns</span></button>
                <div class="nav-divider"></div>
                <button class="nav-btn icon-only" id="fullscreenBtn" title="Fullscreen"><i class="fas fa-expand"></i></button>
                <button class="nav-btn icon-only" id="themeToggle" title="Toggle Theme"><i class="fas fa-moon"></i></button>
            </div>
        </nav>

        <!-- MAIN WORKSPACE -->
        <div class="main-content">
            <!-- LEFT TOOLBAR -->
            <div class="left-toolbar">
                <div class="tool-group">
                    <button class="tool-btn active" data-tool="crosshair" title="Crosshair"><i class="fas fa-crosshairs"></i></button>
                    <button class="tool-btn" data-tool="trendline" title="Trend Line"><i class="fas fa-minus" style="transform:rotate(-30deg)"></i></button>
                    <button class="tool-btn" data-tool="horizontal" title="Horizontal Line"><i class="fas fa-minus"></i></button>
                    <button class="tool-btn" data-tool="fib" title="Fibonacci"><i class="fas fa-percentage"></i></button>
                </div>
            </div>

            <!-- CHART AREA -->
            <div class="chart-wrapper">
                <div class="indicator-labels" id="indicatorLabels"></div>
                
                <canvas id="mainChart"></canvas>
                <canvas id="volumeChart"></canvas>

                <div class="crosshair-info" id="crosshairInfo" style="display:none;">
                    <div class="ci-row"><span>O:</span><span id="ciOpen">-</span></div>
                    <div class="ci-row"><span>H:</span><span id="ciHigh">-</span></div>
                    <div class="ci-row"><span>L:</span><span id="ciLow">-</span></div>
                    <div class="ci-row"><span>C:</span><span id="ciClose">-</span></div>
                    <div class="ci-row"><span>V:</span><span id="ciVol">-</span></div>
                </div>

                <div class="price-scale" id="priceScale"></div>
                <div class="time-scale" id="timeScale"></div>
            </div>

            <!-- RIGHT ANALYTICS PANEL -->
            <div class="right-panel" id="rightPanel">
                
                <!-- MASTER PRO DASHBOARD -->
                <div class="panel-section">
                    <div class="panel-header">
                        <h3><i class="fas fa-crown" style="color:#ffd740"></i> Master Pro Dashboard</h3>
                        <span class="badge" id="psychologyStatus" style="background:#00c853; font-size:9px; color:#000; padding:2px 6px; border-radius:3px; font-weight:bold;">Active</span>
                    </div>
                    <div class="panel-body">
                        <div class="pro-card">
                            <div class="card-title">BOLLINGER BAND SQUEEZE</div>
                            <div id="bbStatusText" class="card-val" style="color:var(--accent-cyan);">Scanning...</div>
                            <div id="bbDetailText" class="card-sub">-</div>
                        </div>
                        <div class="pro-card">
                            <div class="card-title">WYCKOFF VSA (VOLUME FUEL)</div>
                            <div id="vsaStatusText" class="card-val" style="color:var(--bull-color);">Analyzing...</div>
                            <div id="vsaDetailText" class="card-sub">-</div>
                        </div>
                        <div class="pro-card">
                            <div class="card-title">MACD HISTOGRAM DECELERATION</div>
                            <div id="macdDecelText" class="card-val" style="color:var(--accent-orange);">Tracking...</div>
                        </div>
                        <button id="simulateSLHitBtn" class="danger-btn">🚨 Register SL Hit (Circuit Breaker)</button>
                    </div>
                </div>

                <!-- OPTIONS GREEKS PANEL -->
                <div class="panel-section">
                    <div class="panel-header">
                        <h3><i class="fas fa-atom" style="color:#2196f3"></i> Options Greeks</h3>
                    </div>
                    <div class="panel-body">
                        <div class="greeks-inputs">
                            <div class="input-group"><label>Strike</label><input type="number" id="greekStrike" value="22500" step="50"></div>
                            <div class="input-group"><label>Type</label><select id="greekType"><option value="CE">CE (Call)</option><option value="PE">PE (Put)</option></select></div>
                            <div class="input-group"><label>IV %</label><input type="number" id="greekIV" value="18" step="0.5"></div>
                        </div>

                        <div class="greeks-display">
                            <div class="greek-card delta">
                                <div class="greek-symbol">Δ</div><div class="greek-name">Delta</div>
                                <div class="greek-value" id="gDelta">0.55</div>
                            </div>
                            <div class="greek-card gamma">
                                <div class="greek-symbol">Γ</div><div class="greek-name">Gamma</div>
                                <div class="greek-value" id="gGamma">0.045</div>
                            </div>
                            <div class="greek-card theta">
                                <div class="greek-symbol">Θ</div><div class="greek-name">Theta</div>
                                <div class="greek-value" id="gTheta">-12.5</div>
                            </div>
                            <div class="greek-card vega">
                                <div class="greek-symbol">ν</div><div class="greek-name">Vega</div>
                                <div class="greek-value" id="gVega">14.2</div>
                            </div>
                        </div>

                        <div class="combo-signal">
                            <div class="combo-header"><span>🎯 Combo Score</span><span class="combo-score" id="comboScore">75%</span></div>
                            <div class="combo-verdict" id="comboVerdict">🟢 BUY</div>
                        </div>
                    </div>
                </div>

                <!-- BREAKOUT CHECKLIST -->
                <div class="panel-section">
                    <div class="panel-header">
                        <h3><i class="fas fa-tasks"></i> 6-Point Breakout Checklist</h3>
                    </div>
                    <div class="panel-body">
                        <div id="breakoutStatusBox" class="breakout-box">Checking...</div>
                    </div>
                </div>

                <!-- PATTERN RESULTS -->
                <div class="panel-section">
                    <div class="panel-header">
                        <h3><i class="fas fa-searchengin"></i> AI Pattern Scanner</h3>
                    </div>
                    <div class="panel-body">
                        <div class="pattern-results" id="patternResults">Click 'Patterns' in top bar to scan</div>
                    </div>
                </div>

            </div>
        </div>

        <!-- STATUS BAR -->
        <div class="status-bar">
            <div class="sb-left">
                <span class="sb-item"><i class="fas fa-circle" style="color:#00c853;font-size:8px"></i> Live Ticks</span>
                <span class="sb-item" id="sbTime"></span>
            </div>
            <div class="sb-right">
                <span class="sb-item">Pro Engine v8.0</span>
            </div>
        </div>

        <!-- SEARCH SYMBOL MODAL -->
        <div class="modal-overlay" id="symbolModal" style="display:none;">
            <div class="modal">
                <div class="modal-header">
                    <h2><i class="fas fa-search"></i> Search Stocks & Indices</h2>
                    <button class="modal-close" id="closeSymbolModal"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body">
                    <div class="search-input-wrapper">
                        <i class="fas fa-search"></i>
                        <input type="text" id="symbolSearchInput" placeholder="Search Nifty, Reliance, HDFC, TCS...">
                    </div>
                    <div id="symbolList" class="modal-list"></div>
                </div>
            </div>
        </div>

        <!-- INDICATORS MODAL -->
        <div class="modal-overlay" id="indicatorModal" style="display:none;">
            <div class="modal">
                <div class="modal-header">
                    <h2><i class="fas fa-wave-square"></i> Technical Indicators</h2>
                    <button class="modal-close" id="closeIndicatorModal"><i class="fas fa-times"></i></button>
                </div>
                <div class="modal-body">
                    <div class="search-input-wrapper">
                        <i class="fas fa-search"></i>
                        <input type="text" id="indicatorSearchInput" placeholder="Search EMA, VWAP, Bollinger, RSI, MACD...">
                    </div>
                    <div id="indicatorList" class="modal-list"></div>
                </div>
            </div>
        </div>

        <!-- TOAST CONTAINER -->
        <div class="toast-container" id="toastContainer"></div>
    </div>

    <!-- JAVASCRIPT FILES -->
    <script src="js/candlePatterns.js"></script>
    <script src="js/indicators.js"></script>
    <script src="js/greeksEngine.js"></script>
    <script src="js/divergenceEngine.js"></script>
    <script src="js/flagPatternEngine.js"></script>
    <script src="js/preMarketEngine.js"></script>
    <script src="js/doubleBottomEngine.js"></script>
    <script src="js/breakoutChecklistEngine.js"></script>
    <script src="js/orderFlowAbsorptionEngine.js"></script>
    <script src="js/vcpPatternEngine.js"></script>
    <script src="js/closingTrapEngine.js"></script>
    <script src="js/masterProEngine.js"></script>
    <script src="js/chartEngine.js"></script>
    <script src="js/patternScanner.js"></script>
    <script src="js/dataFeed.js"></script>
    <script src="js/app.js"></script>
</body>
</html>
"""

# -------------------------------------------------------------
# 2. CSS/STYLES.CSS (Fixes Modal Popups & Overlay)
# -------------------------------------------------------------
files["css/styles.css"] = """/* ProChart Terminal™ - Complete CSS 2026 */
:root {
    --bg-primary: #0a0e17;
    --bg-secondary: #111827;
    --bg-tertiary: #1a2332;
    --border-color: #1e293b;
    --text-primary: #e2e8f0;
    --text-secondary: #94a3b8;
    --text-muted: #64748b;
    --bull-color: #00c853;
    --bull-bg: rgba(0, 200, 83, 0.1);
    --bear-color: #ff1744;
    --bear-bg: rgba(255, 23, 68, 0.1);
    --accent-blue: #2196f3;
    --accent-orange: #ff9100;
    --accent-cyan: #00e5ff;
    --accent-gold: #ffd740;
    --font-mono: 'JetBrains Mono', monospace;
    --font-sans: 'Inter', sans-serif;
    --radius-md: 8px;
}

* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: var(--font-sans); background: var(--bg-primary); color: var(--text-primary); overflow: hidden; height: 100vh; width: 100vw; display: flex; flex-direction: column; }

/* SPLASH SCREEN */
.splash-screen { position: fixed; inset: 0; background: #0a0e17; display: flex; align-items: center; justify-content: center; z-index: 10000; }
.splash-content { text-align: center; }
.logo-icon { width: 70px; height: 70px; border-radius: 18px; background: linear-gradient(135deg, var(--accent-blue), #7c4dff); display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; font-size: 32px; color: white; }
.splash-logo h1 { font-size: 28px; font-weight: 800; margin-bottom: 6px; }
.splash-loader { margin-top: 30px; width: 280px; }
.loader-bar { height: 3px; background: var(--bg-tertiary); border-radius: 3px; overflow: hidden; }
.loader-fill { height: 100%; background: linear-gradient(90deg, var(--accent-blue), var(--accent-cyan)); animation: loaderAnim 1.2s ease forwards; width: 0%; }
@keyframes loaderAnim { to { width: 100%; } }
.loader-text { display: block; margin-top: 10px; color: var(--text-muted); font-size: 11px; font-family: var(--font-mono); }

/* NAVBAR */
.app-container { display: flex; flex-direction: column; height: 100vh; width: 100vw; }
.top-navbar { display: flex; align-items: center; justify-content: space-between; height: 50px; background: var(--bg-secondary); border-bottom: 1px solid var(--border-color); padding: 0 15px; flex-shrink: 0; }
.nav-left, .nav-center, .nav-right { display: flex; align-items: center; gap: 8px; }
.logo { font-size: 16px; font-weight: 800; color: var(--accent-blue); margin-right: 10px; }

.symbol-btn { display: flex; align-items: center; gap: 10px; padding: 6px 14px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: var(--radius-md); color: #fff; cursor: pointer; transition: 0.2s; }
.symbol-btn:hover { background: #2a3a4e; border-color: var(--accent-blue); }
.symbol-name { font-weight: bold; font-size: 13px; }
.symbol-price.up { color: var(--bull-color); } .symbol-price.down { color: var(--bear-color); }
.symbol-change { font-size: 11px; padding: 2px 6px; border-radius: 4px; }
.symbol-change.up { background: var(--bull-bg); color: var(--bull-color); }
.symbol-change.down { background: var(--bear-bg); color: var(--bear-color); }

.timeframe-selector, .chart-type-selector { display: flex; gap: 2px; padding: 3px; background: var(--bg-tertiary); border-radius: var(--radius-md); }
.tf-btn, .ct-btn { padding: 4px 8px; border: none; background: transparent; color: var(--text-secondary); font-size: 11px; font-weight: 600; font-family: var(--font-mono); border-radius: 4px; cursor: pointer; }
.tf-btn.active, .ct-btn.active { background: var(--accent-blue); color: white; }

.nav-btn { display: flex; align-items: center; gap: 6px; padding: 6px 12px; border: 1px solid var(--border-color); background: var(--bg-tertiary); color: var(--text-primary); font-size: 12px; border-radius: var(--radius-md); cursor: pointer; font-weight: 600; }
.nav-btn:hover { border-color: var(--accent-blue); color: var(--accent-blue); }

/* MAIN CONTENT */
.main-content { display: flex; flex: 1; overflow: hidden; }
.left-toolbar { width: 44px; background: var(--bg-secondary); border-right: 1px solid var(--border-color); display: flex; flex-direction: column; align-items: center; padding-top: 10px; gap: 6px; flex-shrink: 0; }
.tool-btn { width: 34px; height: 34px; border: none; background: transparent; color: var(--text-secondary); border-radius: 6px; cursor: pointer; }
.tool-btn.active, .tool-btn:hover { color: var(--accent-blue); background: rgba(33,150,243,0.1); }

.chart-wrapper { flex: 1; position: relative; background: var(--bg-primary); overflow: hidden; }
#mainChart { width: 100%; cursor: crosshair; }
#volumeChart { width: 100%; position: absolute; bottom: 30px; left: 0; pointer-events: none; }

.crosshair-info { position: absolute; top: 10px; left: 15px; z-index: 10; display: flex; gap: 12px; font-family: var(--font-mono); font-size: 11px; background: rgba(10,14,23,0.85); padding: 5px 12px; border-radius: 4px; backdrop-filter: blur(8px); border: 1px solid var(--border-color); }
.price-scale { position: absolute; top: 0; right: 0; width: 70px; height: calc(100% - 30px); background: var(--bg-secondary); border-left: 1px solid var(--border-color); }
.time-scale { position: absolute; bottom: 0; left: 0; right: 70px; height: 30px; background: var(--bg-secondary); border-top: 1px solid var(--border-color); }

.right-panel { width: 320px; background: var(--bg-secondary); border-left: 1px solid var(--border-color); display: flex; flex-direction: column; overflow-y: auto; flex-shrink: 0; }
.panel-section { border-bottom: 1px solid var(--border-color); padding: 12px 15px; }
.panel-header { font-size: 13px; font-weight: 700; margin-bottom: 10px; display: flex; justify-content: space-between; align-items: center; color: var(--accent-blue); }

.pro-card { background: var(--bg-tertiary); padding: 8px 10px; border-radius: 6px; margin-bottom: 6px; border: 1px solid var(--border-color); }
.card-title { font-size: 9px; color: var(--text-muted); font-weight: 700; }
.card-val { font-size: 11px; font-weight: 800; margin-top: 2px; }
.card-sub { font-size: 9px; color: var(--text-secondary); margin-top: 2px; line-height: 1.3; }
.danger-btn { width: 100%; padding: 6px; background: var(--bear-bg); border: 1px solid var(--bear-color); color: var(--bear-color); font-weight: 700; border-radius: 6px; font-size: 10px; cursor: pointer; margin-top: 4px; }

.greeks-inputs { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 6px; margin-bottom: 8px; }
.greeks-inputs input, .greeks-inputs select { width: 100%; padding: 4px 6px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 4px; color: var(--text-primary); font-size: 10px; outline: none; }
.greeks-display { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 8px; }
.greek-card { background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 6px; padding: 6px; text-align: center; }
.greek-symbol { font-size: 16px; font-weight: 800; }
.greek-value { font-family: var(--font-mono); font-size: 14px; font-weight: 700; margin: 2px 0; }

.combo-signal { background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 6px; padding: 8px; }
.combo-header { display: flex; justify-content: space-between; font-size: 10px; font-weight: 700; }
.combo-verdict { font-size: 15px; font-weight: 800; text-align: center; padding: 4px; margin: 4px 0; border-radius: 4px; background: rgba(0,200,83,0.1); }

.breakout-box { padding: 8px; border-radius: 6px; background: var(--bg-tertiary); font-size: 10px; font-weight: 700; text-align: center; }

/* =====================================================
   FIXED MODALS (SCREEN CENTER POPUPS)
   ===================================================== */
.modal-overlay { 
    position: fixed; 
    inset: 0; 
    background: rgba(0,0,0,0.8); 
    backdrop-filter: blur(5px); 
    display: flex; 
    justify-content: center; 
    align-items: center; 
    z-index: 99999; 
}
.modal { 
    background: var(--bg-secondary); 
    width: 480px; 
    max-height: 80vh; 
    border-radius: 12px; 
    border: 1px solid var(--border-color); 
    display: flex; 
    flex-direction: column; 
    box-shadow: 0 15px 50px rgba(0,0,0,0.6); 
    overflow: hidden;
}
.modal-header { 
    padding: 16px 20px; 
    border-bottom: 1px solid var(--border-color); 
    display: flex; 
    justify-content: space-between; 
    align-items: center; 
    background: var(--bg-tertiary);
}
.modal-header h2 { font-size: 15px; font-weight: 700; display: flex; align-items: center; gap: 10px; color: var(--accent-blue); }
.modal-close { background: none; border: none; color: var(--text-muted); font-size: 18px; cursor: pointer; padding: 4px 8px; border-radius: 4px; }
.modal-close:hover { color: var(--bear-color); background: var(--bear-bg); }
.modal-body { padding: 16px 20px; overflow-y: auto; max-height: calc(80vh - 60px); }

/* Search Inputs in Modal */
.search-input-wrapper { display: flex; align-items: center; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 6px; padding: 0 12px; margin-bottom: 15px; }
.search-input-wrapper i { color: var(--text-muted); font-size: 14px; }
.search-input-wrapper input { width: 100%; padding: 10px 12px; background: transparent; border: none; color: #fff; font-size: 13px; outline: none; font-family: var(--font-sans); }

/* List Items in Modal */
.modal-list { display: flex; flex-direction: column; gap: 6px; }
.list-item { display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: 6px; cursor: pointer; transition: 0.2s; }
.list-item:hover { border-color: var(--accent-blue); background: #1e293b; }
.list-item .item-title { font-weight: 700; font-size: 13px; color: #fff; }
.list-item .item-sub { font-size: 10px; color: var(--text-muted); margin-top: 2px; }
.list-item .item-price { font-family: var(--font-mono); font-weight: 700; font-size: 13px; color: var(--bull-color); }

.status-bar { display: flex; align-items: center; justify-content: space-between; height: 26px; padding: 0 15px; background: var(--bg-secondary); border-top: 1px solid var(--border-color); font-size: 10px; font-family: var(--font-mono); color: var(--text-muted); flex-shrink: 0; }
.toast-container { position: fixed; bottom: 35px; right: 20px; z-index: 100000; display: flex; flex-direction: column; gap: 8px; }
.toast { padding: 10px 16px; background: var(--bg-tertiary); color: #fff; border-left: 4px solid var(--accent-blue); border-radius: 6px; font-size: 12px; box-shadow: 0 8px 24px rgba(0,0,0,0.4); backdrop-filter: blur(10px); border-top: 1px solid var(--border-color); }
"""

# -------------------------------------------------------------
# 3. JS/DATAFEED.JS (Includes Real Equities & Stocks)
# -------------------------------------------------------------
files["js/dataFeed.js"] = """class DataFeed {
    constructor() {
        this.symbols = {
            'NIFTY50': { name: 'Nifty 50 Index', base: 22548.16, exchange: 'NSE' },
            'BANKNIFTY': { name: 'Bank Nifty Index', base: 48200.50, exchange: 'NSE' },
            'RELIANCE': { name: 'Reliance Industries', base: 2950.00, exchange: 'NSE' },
            'HDFCBANK': { name: 'HDFC Bank Ltd.', base: 1450.25, exchange: 'NSE' },
            'TCS': { name: 'Tata Consultancy', base: 3980.10, exchange: 'NSE' },
            'INFY': { name: 'Infosys Ltd.', base: 1520.45, exchange: 'NSE' },
            'ICICIBANK': { name: 'ICICI Bank', base: 1080.70, exchange: 'NSE' },
            'SBIN': { name: 'State Bank of India', base: 780.30, exchange: 'NSE' },
            'TATAMOTORS': { name: 'Tata Motors', base: 950.60, exchange: 'NSE' },
            'ITC': { name: 'ITC Limited', base: 420.80, exchange: 'NSE' }
        };
        this.currentSymbol = 'NIFTY50';
    }

    generateData(count = 160) {
        const config = this.symbols[this.currentSymbol] || this.symbols['NIFTY50'];
        const data = [];
        let price = config.base;
        const now = Date.now();

        for (let i = count; i >= 0; i--) {
            const change = (Math.random() - 0.48) * (config.base * 0.001);
            const open = price;
            const close = open + change;
            const high = Math.max(open, close) + Math.random() * (config.base * 0.0005);
            const low = Math.min(open, close) - Math.random() * (config.base * 0.0005);
            const volume = Math.round(100000 + Math.random() * 500000);
            price = close;

            data.push({
                time: now - i * 60000,
                open: parseFloat(open.toFixed(2)),
                high: parseFloat(high.toFixed(2)),
                low: parseFloat(low.toFixed(2)),
                close: parseFloat(close.toFixed(2)),
                volume
            });
        }
        return data;
    }

    generateLiveTick(lastCandle) {
        const tick = (Math.random() - 0.49) * (lastCandle.close * 0.0002);
        const newClose = parseFloat((lastCandle.close + tick).toFixed(2));
        lastCandle.close = newClose;
        lastCandle.high = Math.max(lastCandle.high, newClose);
        lastCandle.low = Math.min(lastCandle.low, newClose);
        lastCandle.volume += Math.round(Math.random() * 1200);
        return lastCandle;
    }
}
"""

# -------------------------------------------------------------
# 4. JS/CHARTENGINE.JS (Interactive Canvas Engine)
# -------------------------------------------------------------
files["js/chartEngine.js"] = """class ChartEngine {
    constructor(canvasId) {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.volCanvas = document.getElementById('volumeChart');
        this.volCtx = this.volCanvas.getContext('2d');
        
        this.data = [];
        this.candleWidth = 10;
        this.candleSpacing = 4;
        this.offset = 0;
        this.chartType = 'candle';
        this.activeIndicators = ['ema20', 'bb'];
        this.patternsToDraw = [];
        this.crosshair = { x: 0, y: 0, visible: false };
        this.isDragging = false;
        this.dragStartX = 0;
        this.dragStartOffset = 0;

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
        
        this.canvas.width = w;
        this.canvas.height = h - 30;
        this.volCanvas.width = w;
        this.volCanvas.height = 60;
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
            this.crosshair.visible = true;

            if (this.isDragging) {
                const dx = e.clientX - this.dragStartX;
                const candleTotal = this.candleWidth + this.candleSpacing;
                this.offset = Math.max(0, Math.min(this.data.length - 10, this.dragStartOffset + Math.round(dx / candleTotal)));
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
                this.candleWidth = Math.min(30, this.candleWidth + 1);
            } else {
                this.candleWidth = Math.max(3, this.candleWidth - 1);
            }
            this.render();
        }, { passive: false });

        this.canvas.addEventListener('mouseleave', () => {
            this.crosshair.visible = false;
            this.render();
            document.getElementById('crosshairInfo').style.display = 'none';
        });
    }

    setData(data) {
        this.data = data;
        this.offset = 0;
        this.render();
    }

    getVisibleCount() {
        return Math.floor((this.canvas.width - 70) / (this.candleWidth + this.candleSpacing));
    }

    render() {
        if (!this.data || this.data.length === 0) return;

        const ctx = this.ctx;
        const w = this.canvas.width - 70;
        const h = this.canvas.height;
        ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

        const visibleCount = this.getVisibleCount();
        const startIdx = Math.max(0, this.data.length - visibleCount - this.offset);
        const endIdx = Math.min(this.data.length, startIdx + visibleCount);
        const visibleData = this.data.slice(startIdx, endIdx);

        if (visibleData.length === 0) return;

        let minPrice = Infinity, maxPrice = -Infinity;
        visibleData.forEach(c => {
            if (c.low < minPrice) minPrice = c.low;
            if (c.high > maxPrice) maxPrice = c.high;
        });
        const range = (maxPrice - minPrice) || 1;

        const priceToY = (price) => h - 20 - ((price - minPrice) / range) * (h - 40);

        // 1. Grid Lines
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 1;
        for (let i = 0; i < 5; i++) {
            const y = 20 + (h - 40) * (i / 4);
            ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        }

        // 2. Active Indicators
        if (this.activeIndicators.includes('bb')) {
            const closes = this.data.map(c => c.close);
            const bb = TechnicalIndicators.BollingerBands(closes, 20, 2);
            ctx.strokeStyle = 'rgba(33, 150, 243, 0.5)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            visibleData.forEach((c, idx) => {
                const dataIdx = startIdx + idx;
                const x = idx * (this.candleWidth + this.candleSpacing) + this.candleWidth/2;
                if (bb.upper[dataIdx]) {
                    const yU = priceToY(bb.upper[dataIdx]);
                    if (idx === 0) ctx.moveTo(x, yU); else ctx.lineTo(x, yU);
                }
            });
            ctx.stroke();
        }

        if (this.activeIndicators.includes('ema20')) {
            const closes = this.data.map(c => c.close);
            const ema20 = TechnicalIndicators.EMA(closes, 20);
            ctx.strokeStyle = '#ff9100';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            visibleData.forEach((c, idx) => {
                const dataIdx = startIdx + idx;
                const x = idx * (this.candleWidth + this.candleSpacing) + this.candleWidth/2;
                if (ema20[dataIdx]) {
                    const y = priceToY(ema20[dataIdx]);
                    if (idx === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
                }
            });
            ctx.stroke();
        }

        // 3. Candles / Line
        visibleData.forEach((c, idx) => {
            const x = idx * (this.candleWidth + this.candleSpacing) + this.candleWidth/2;
            const openY = priceToY(c.open);
            const closeY = priceToY(c.close);
            const highY = priceToY(c.high);
            const lowY = priceToY(c.low);
            const isBull = c.close >= c.open;

            const color = isBull ? '#00c853' : '#ff1744';
            ctx.strokeStyle = color;
            ctx.fillStyle = color;

            if (this.chartType === 'line') {
                if (idx === 0) ctx.beginPath(); ctx.moveTo(x, closeY);
                if (idx > 0) ctx.lineTo(x, closeY);
                if (idx === visibleData.length - 1) { ctx.strokeStyle = '#2196f3'; ctx.lineWidth = 2; ctx.stroke(); }
            } else {
                ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(x, highY); ctx.lineTo(x, lowY); ctx.stroke();

                const bodyTop = Math.min(openY, closeY);
                const bodyH = Math.max(Math.abs(closeY - openY), 1);
                ctx.fillRect(x - this.candleWidth/2, bodyTop, this.candleWidth, bodyH);
            }
        });

        // 4. Draw Pattern Badges
        this.patternsToDraw.forEach(p => {
            const dataIdx = p.index;
            if (dataIdx >= startIdx && dataIdx < endIdx) {
                const idx = dataIdx - startIdx;
                const x = idx * (this.candleWidth + this.candleSpacing) + this.candleWidth/2;
                const c = this.data[dataIdx];
                const y = p.signal === 'bullish' ? priceToY(c.low) + 15 : priceToY(c.high) - 15;

                ctx.fillStyle = p.signal === 'bullish' ? '#00c853' : '#ff1744';
                ctx.font = 'bold 9px JetBrains Mono';
                ctx.textAlign = 'center';
                ctx.fillText(p.name, x, y);
            }
        });

        // 5. Volume Bar Canvas
        this.renderVolume(visibleData);

        // 6. Right Price Scale
        this.renderPriceScale(minPrice, maxPrice);

        // 7. Crosshair
        if (this.crosshair.visible && this.crosshair.x <= w) {
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.moveTo(this.crosshair.x, 0); ctx.lineTo(this.crosshair.x, h); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, this.crosshair.y); ctx.lineTo(w, this.crosshair.y); ctx.stroke();
            ctx.setLineDash([]);

            const hoverPrice = maxPrice - ((this.crosshair.y - 20) / (h - 40)) * range;
            ctx.fillStyle = '#2196f3';
            ctx.fillRect(w, this.crosshair.y - 10, 70, 20);
            ctx.fillStyle = '#fff';
            ctx.font = '10px JetBrains Mono';
            ctx.fillText(hoverPrice.toFixed(2), w + 10, this.crosshair.y + 4);
        }

        // Current Price Line Tag
        const lastC = visibleData[visibleData.length - 1];
        if (lastC) {
            const lastY = priceToY(lastC.close);
            ctx.strokeStyle = lastC.close >= lastC.open ? '#00c853' : '#ff1744';
            ctx.setLineDash([2, 2]);
            ctx.beginPath(); ctx.moveTo(0, lastY); ctx.lineTo(w, lastY); ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    renderVolume(visibleData) {
        const vCtx = this.volCtx;
        const w = this.volCanvas.width - 70;
        const h = this.volCanvas.height;
        vCtx.clearRect(0, 0, this.volCanvas.width, h);

        let maxVol = 0;
        visibleData.forEach(c => { if (c.volume > maxVol) maxVol = c.volume; });
        if (!maxVol) return;

        visibleData.forEach((c, idx) => {
            const x = idx * (this.candleWidth + this.candleSpacing) + this.candleWidth/2;
            const barH = (c.volume / maxVol) * (h - 10);
            vCtx.fillStyle = c.close >= c.open ? 'rgba(0,200,83,0.3)' : 'rgba(255,23,68,0.3)';
            vCtx.fillRect(x - this.candleWidth/2, h - barH, this.candleWidth, barH);
        });
    }

    renderPriceScale(min, max) {
        const scaleEl = document.getElementById('priceScale');
        if (!scaleEl) return;
        scaleEl.innerHTML = '';

        for (let i = 0; i <= 4; i++) {
            const p = max - (i / 4) * (max - min);
            const div = document.createElement('div');
            div.className = 'price-label';
            div.style.position = 'absolute';
            div.style.top = (10 + (this.canvas.height - 40) * (i / 4)) + 'px';
            div.style.right = '5px';
            div.style.fontSize = '10px';
            div.style.fontFamily = 'monospace';
            div.style.color = '#94a3b8';
            div.textContent = p.toFixed(2);
            scaleEl.appendChild(div);
        }
    }

    updateCrosshairInfo() {
        const visibleCount = this.getVisibleCount();
        const startIdx = Math.max(0, this.data.length - visibleCount - this.offset);
        const idx = Math.floor(this.crosshair.x / (this.candleWidth + this.candleSpacing));
        const candle = this.data[startIdx + idx];

        if (candle) {
            const info = document.getElementById('crosshairInfo');
            info.style.display = 'flex';
            document.getElementById('ciOpen').textContent = candle.open.toFixed(2);
            document.getElementById('ciHigh').textContent = candle.high.toFixed(2);
            document.getElementById('ciLow').textContent = candle.low.toFixed(2);
            document.getElementById('ciClose').textContent = candle.close.toFixed(2);
            document.getElementById('ciVol').textContent = candle.volume.toLocaleString();
        }
    }
}
"""

# -------------------------------------------------------------
# 5. JS/APP.JS (Connects Modals, Search, Stock List & Patterns)
# -------------------------------------------------------------
files["js/app.js"] = """class ProChartApp {
    constructor() {
        this.dataFeed = new DataFeed();
        this.greeks = new GreeksEngine();
        this.divergence = new DivergenceEngine();
        this.breakout = new BreakoutChecklistEngine();
        this.vcp = new VCPPatternEngine();
        this.closing = new ClosingTrapEngine();
        this.masterPro = new MasterProEngine();
        this.scanner = new CandlePatternEngine();
        
        // 15+ Comprehensive Indicators List
        this.indicatorsList = [
            { id: 'ema20', name: '20 EMA', desc: 'Intraday Trend Filter', color: '#ff9100' },
            { id: 'ema50', name: '50 EMA', desc: 'Swing Trend Filter', color: '#00e5ff' },
            { id: 'ema200', name: '200 EMA', desc: 'Long Term Boss', color: '#ea80fc' },
            { id: 'vwap', name: 'VWAP', desc: 'Institutional Average', color: '#ffd740' },
            { id: 'bb', name: 'Bollinger Bands (20, 2)', desc: 'Volatility Squeeze', color: '#2196f3' },
            { id: 'rsi', name: 'RSI (14)', desc: 'Momentum & Divergence', color: '#7c4dff' },
            { id: 'macd', name: 'MACD (12, 26, 9)', desc: 'Histogram Deceleration', color: '#00c853' },
            { id: 'supertrend', name: 'SuperTrend (10, 3)', desc: 'Trend Following', color: '#00e5ff' },
            { id: 'atr', name: 'ATR (14)', desc: 'Average True Range', color: '#ff4081' },
            { id: 'stoch', name: 'Stochastic Oscillator', desc: 'Overbought/Oversold', color: '#ffd740' },
            { id: 'ichimoku', name: 'Ichimoku Cloud', desc: 'Trend & Support', color: '#69f0ae' }
        ];

        this.liveTimer = null;
    }

    init() {
        setTimeout(() => {
            document.getElementById('splashScreen').style.display = 'none';
            document.getElementById('app').style.display = 'flex';
            
            this.chart = new ChartEngine('mainChart');
            this.loadInitialData();
            this.setupEventListeners();
            this.startLiveTickTicker();
            this.showToast('🚀 ProChart Terminal™ Ready! Live Ticks Active.', 'success');
        }, 1000);
    }

    loadInitialData() {
        const data = this.dataFeed.generateData(180);
        this.chart.setData(data);
        this.runAllEngines(data);
    }

    runAllEngines(data) {
        const lastC = data[data.length - 1];

        // 1. Update Top Bar Price
        const sym = this.dataFeed.symbols[this.dataFeed.currentSymbol];
        document.querySelector('.symbol-name').textContent = sym ? sym.name : this.dataFeed.currentSymbol;
        document.getElementById('currentPrice').textContent = lastC.close.toFixed(2);
        
        // 2. Master Pro Analysis
        const bb = this.masterPro.analyzeBollingerBands(data);
        if (bb) {
            document.getElementById('bbStatusText').textContent = bb.signal;
            document.getElementById('bbDetailText').textContent = bb.detail;
        }

        const vsa = this.masterPro.analyzeVolumeSpread(data);
        if (vsa) {
            document.getElementById('vsaStatusText').textContent = vsa.vsaType;
            document.getElementById('vsaDetailText').textContent = vsa.detail;
        }

        // 3. Calculate Options Greeks Live
        this.updateGreeks(lastC.close);

        // 4. Breakout Checklist
        const bk = this.breakout.evaluateBullishBreakout(data, { pdh: lastC.close - 10, first5mHigh: lastC.close - 5 }, {});
        const box = document.getElementById('breakoutStatusBox');
        if (box) {
            box.textContent = bk.status;
            box.style.background = bk.color + '25';
            box.style.color = bk.color;
        }
    }

    updateGreeks(spotPrice) {
        const strike = parseFloat(document.getElementById('greekStrike')?.value || spotPrice);
        const type = document.getElementById('greekType')?.value || 'CE';
        const iv = parseFloat(document.getElementById('greekIV')?.value || 18) / 100;

        const g = this.greeks.calculateGreeks(spotPrice, strike, 7/365, 0.065, iv, type);
        
        if(document.getElementById('gDelta')) {
            document.getElementById('gDelta').textContent = g.delta;
            document.getElementById('gGamma').textContent = g.gamma;
            document.getElementById('gTheta').textContent = g.theta;
            document.getElementById('gVega').textContent = g.vega;
        }

        const combo = this.greeks.generateComboSignal({}, g);
        document.getElementById('comboScore').textContent = `${combo.finalScore}%`;
        document.getElementById('comboVerdict').textContent = combo.finalSignal;
        document.getElementById('comboVerdict').style.color = combo.finalColor;
    }

    startLiveTickTicker() {
        if (this.liveTimer) clearInterval(this.liveTimer);
        this.liveTimer = setInterval(() => {
            if (this.chart.data.length === 0) return;
            
            const lastCandle = this.chart.data[this.chart.data.length - 1];
            this.dataFeed.generateLiveTick(lastCandle);
            
            this.chart.render();
            this.runAllEngines(this.chart.data);
            this.updateClock();
        }, 1000);
    }

    setupEventListeners() {
        // ==========================================
        // 1. SEARCH STOCKS & EQUITIES MODAL
        // ==========================================
        document.getElementById('symbolBtn')?.addEventListener('click', () => {
            document.getElementById('symbolModal').style.display = 'flex';
            this.renderSymbolList('');
        });

        document.getElementById('closeSymbolModal')?.addEventListener('click', () => {
            document.getElementById('symbolModal').style.display = 'none';
        });

        document.getElementById('symbolSearchInput')?.addEventListener('input', (e) => {
            this.renderSymbolList(e.target.value.toLowerCase());
        });

        // ==========================================
        // 2. INDICATORS MODAL
        // ==========================================
        document.getElementById('indicatorBtn')?.addEventListener('click', () => {
            document.getElementById('indicatorModal').style.display = 'flex';
            this.renderIndicatorList('');
        });

        document.getElementById('closeIndicatorModal')?.addEventListener('click', () => {
            document.getElementById('indicatorModal').style.display = 'none';
        });

        document.getElementById('indicatorSearchInput')?.addEventListener('input', (e) => {
            this.renderIndicatorList(e.target.value.toLowerCase());
        });

        // ==========================================
        // 3. AI PATTERN SCANNER BUTTON
        // ==========================================
        document.getElementById('patternBtn')?.addEventListener('click', () => {
            const patterns = this.scanner.scanAll(this.chart.data);
            if (patterns.length > 0) {
                this.chart.patternsToDraw = patterns;
                this.chart.render();
                this.renderPatternResults(patterns);
                this.showToast(`🔥 Found ${patterns.length} Patterns! Marked on Chart.`, 'success');
            } else {
                this.showToast('No strong patterns found in visible range.', 'info');
            }
        });

        // Timeframe Buttons
        document.querySelectorAll('.tf-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.loadInitialData();
                this.showToast(`Timeframe changed to ${e.target.textContent}`, 'info');
            });
        });

        // Chart Type Buttons
        document.querySelectorAll('.ct-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.ct-btn').forEach(b => b.classList.remove('active'));
                const target = e.currentTarget;
                target.classList.add('active');
                this.chart.chartType = target.dataset.type;
                this.chart.render();
            });
        });

        // Close Modals on Overlay Click
        document.querySelectorAll('.modal-overlay').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.style.display = 'none';
            });
        });
    }

    renderSymbolList(query) {
        const list = document.getElementById('symbolList');
        if (!list) return;
        list.innerHTML = '';

        const symbols = Object.entries(this.dataFeed.symbols);
        const filtered = symbols.filter(([key, val]) => key.toLowerCase().includes(query) || val.name.toLowerCase().includes(query));

        filtered.forEach(([key, val]) => {
            const item = document.createElement('div');
            item.className = 'list-item';
            item.innerHTML = `
                <div>
                    <div class="item-title">${key}</div>
                    <div class="item-sub">${val.name} • ${val.exchange}</div>
                </div>
                <div class="item-price">₹${val.base.toFixed(2)}</div>
            `;
            item.addEventListener('click', () => {
                this.dataFeed.currentSymbol = key;
                this.loadInitialData();
                document.getElementById('symbolModal').style.display = 'none';
                this.showToast(`Loaded ${val.name} Chart`, 'success');
            });
            list.appendChild(item);
        });
    }

    renderIndicatorList(query) {
        const list = document.getElementById('indicatorList');
        if (!list) return;
        list.innerHTML = '';

        const filtered = this.indicatorsList.filter(ind => ind.name.toLowerCase().includes(query) || ind.desc.toLowerCase().includes(query));

        filtered.forEach(ind => {
            const isActive = this.chart.activeIndicators.includes(ind.id);
            const item = document.createElement('div');
            item.className = 'list-item';
            item.style.borderLeft = isActive ? `4px solid ${ind.color}` : '4px solid transparent';
            item.innerHTML = `
                <div>
                    <div class="item-title">${ind.name}</div>
                    <div class="item-sub">${ind.desc}</div>
                </div>
                <div style="color: ${isActive ? 'var(--bull-color)' : 'var(--text-muted)'}">
                    <i class="fas ${isActive ? 'fa-check-circle' : 'fa-plus-circle'}"></i>
                </div>
            `;
            item.addEventListener('click', () => {
                if (isActive) {
                    this.chart.activeIndicators = this.chart.activeIndicators.filter(i => i !== ind.id);
                    this.showToast(`${ind.name} Removed`, 'info');
                } else {
                    this.chart.activeIndicators.push(ind.id);
                    this.showToast(`${ind.name} Added`, 'success');
                }
                this.chart.render();
                this.renderIndicatorList(query);
            });
            list.appendChild(item);
        });
    }

    renderPatternResults(patterns) {
        const container = document.getElementById('patternResults');
        if (!container) return;
        container.innerHTML = patterns.map(p => `
            <div class="pro-card">
                <div style="display:flex;justify-content:space-between;">
                    <b>${p.signal === 'bullish' ? '🟢' : '🔴'} ${p.name}</b>
                    <span style="color:var(--bull-color)">${p.accuracy}%</span>
                </div>
                <div class="card-sub">${p.description}</div>
            </div>
        `).join('');
    }

    updateClock() {
        const now = new Date();
        document.getElementById('sbTime').textContent = now.toLocaleTimeString();
    }

    showToast(msg, type = 'info') {
        const c = document.getElementById('toastContainer');
        if (!c) return;
        const t = document.createElement('div');
        t.className = `toast ${type}`;
        t.innerHTML = `<i class="fas fa-info-circle"></i> ${msg}`;
        c.appendChild(t);
        setTimeout(() => t.remove(), 3000);
    }
}

const app = new ProChartApp();
document.addEventListener('DOMContentLoaded', () => app.init());
"""

# Overwrite files
for file_path, content in files.items():
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(content.strip())
    print(f"  [+] Rebuilt: {file_path}")

print("\n========================================================")
print("🎉 REBUILD COMPLETE! All Modals & Search Bars Restored!")
print("========================================================")