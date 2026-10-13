class ProChartApp {
    constructor() {
        this.dataFeed = new DataFeed();
        this.greeks = new GreeksEngine();
        this.divergence = new DivergenceEngine();
        this.breakout = new BreakoutChecklistEngine();
        this.vcp = new VCPPatternEngine();
        this.closing = new ClosingTrapEngine();
        this.masterPro = new MasterProEngine();
        this.scanner = new CandlePatternEngine();
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
            this.showToast('🚀 ProChart Terminal™ LIVE! Mouse Drag & Zoom Active.', 'success');
        }, 1200);
    }

    loadInitialData() {
        const data = this.dataFeed.generateData(180);
        this.chart.setData(data);
        this.runAllEngines(data);
    }

    runAllEngines(data) {
        const lastC = data[data.length - 1];

        // 1. Update Price Displays
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

        // 4. Breakout Checklist (Image 4)
        const bk = this.breakout.evaluateBullishBreakout(data, { pdh: lastC.close - 10, first5mHigh: lastC.close - 5 }, {});
        const box = document.getElementById('breakoutStatusBox');
        if (box) {
            box.textContent = bk.status;
            box.style.background = bk.color + '25';
            box.style.color = bk.color;
        }

        // 5. VCP & Closing Trap
        const vcp = this.vcp.scanVCP(data);
        if (vcp.length) {
            document.getElementById('vcpStatusText').textContent = vcp[0].status;
            document.getElementById('vcpDetailText').textContent = vcp[0].description;
        }

        const cl = this.closing.analyzeClosingTrap(data, lastC.close - 8, lastC.close - 3);
        if (cl) {
            document.getElementById('btstSignalText').textContent = cl.btstSignal;
            document.getElementById('btstSignalText').style.color = cl.color;
            document.getElementById('btstDetailText').textContent = cl.detail;
        }

        // 6. Divergence Scanner
        const rsi = TechnicalIndicators.RSI(data.map(c => c.close), 14);
        const divs = this.divergence.scanDivergences(data, rsi);
        this.renderDivergences(divs);

        // 7. Candle Patterns
        const patterns = this.scanner.scanAll(data);
        this.renderPatterns(patterns);
    }

    updateGreeks(spotPrice) {
        const strike = parseFloat(document.getElementById('greekStrike')?.value || spotPrice);
        const type = document.getElementById('greekType')?.value || 'CE';
        const iv = parseFloat(document.getElementById('greekIV')?.value || 18) / 100;

        const g = this.greeks.calculateGreeks(spotPrice, strike, 7/365, 0.065, iv, type);
        
        document.getElementById('gDelta').textContent = g.delta;
        document.getElementById('gGamma').textContent = g.gamma;
        document.getElementById('gTheta').textContent = g.theta;
        document.getElementById('gVega').textContent = g.vega;

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
        }, 1000); // Ticks every 1 second!
    }

    setupEventListeners() {
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

        // Greeks Input Change
        ['greekStrike', 'greekType', 'greekIV'].forEach(id => {
            document.getElementById(id)?.addEventListener('input', () => {
                const lastClose = this.chart.data[this.chart.data.length - 1]?.close || 22500;
                this.updateGreeks(lastClose);
            });
        });

        // SL Hit Circuit Breaker
        document.getElementById('simulateSLHitBtn')?.addEventListener('click', () => {
            const res = this.masterPro.registerStopLossHit();
            if (res.locked) {
                alert(res.message);
                document.getElementById('psychologyStatus').textContent = 'LOCKED 🛑';
                document.getElementById('psychologyStatus').style.background = '#ff1744';
            } else {
                this.showToast(res.message, 'warning');
            }
        });

        // Theme Toggle
        document.getElementById('themeToggle')?.addEventListener('click', () => {
            const html = document.documentElement;
            const isDark = html.dataset.theme === 'dark';
            html.dataset.theme = isDark ? 'light' : 'dark';
            this.showToast(`Theme switched to ${isDark ? 'Light' : 'Dark'}`, 'info');
        });

        // Indicator Modal
        document.getElementById('indicatorBtn')?.addEventListener('click', () => {
            document.getElementById('indicatorModal').style.display = 'flex';
            this.populateIndicators();
        });

        document.getElementById('closeIndicatorModal')?.addEventListener('click', () => {
            document.getElementById('indicatorModal').style.display = 'none';
        });
    }

    populateIndicators() {
        const list = document.getElementById('indicatorList');
        if (!list) return;
        list.innerHTML = `
            <div class="pro-card" style="cursor:pointer;" onclick="app.toggleInd('bb')">
                <b>Bollinger Bands (20, 2)</b> - Volatility Squeeze & Band Walk
            </div>
            <div class="pro-card" style="cursor:pointer;" onclick="app.toggleInd('ema20')">
                <b>20 EMA Line</b> - Dynamic Trend Filter
            </div>
        `;
    }

    toggleInd(name) {
        if (this.chart.activeIndicators.includes(name)) {
            this.chart.activeIndicators = this.chart.activeIndicators.filter(i => i !== name);
            this.showToast(`${name.toUpperCase()} Removed`, 'info');
        } else {
            this.chart.activeIndicators.push(name);
            this.showToast(`${name.toUpperCase()} Added to Chart`, 'success');
        }
        this.chart.render();
    }

    renderDivergences(divs) {
        const container = document.getElementById('divergenceResults');
        if (!container) return;
        container.innerHTML = divs.map(d => `
            <div class="pro-card" style="border-left:3px solid ${d.color}">
                <b>${d.icon} ${d.name}</b> (${d.accuracy}%)
                <div style="font-size:9px;color:var(--text-muted)">Price: ${d.startPrice.toFixed(1)} → ${d.endPrice.toFixed(1)}</div>
            </div>
        `).join('');
    }

    renderPatterns(patterns) {
        const container = document.getElementById('patternResults');
        if (!container) return;
        container.innerHTML = patterns.slice(0, 5).map(p => `
            <div class="pro-card">
                <b>${p.signal === 'bullish' ? '🟢' : '🔴'} ${p.name}</b> (${p.accuracy}%)
                <div style="font-size:9px;color:var(--text-muted)">${p.description}</div>
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
        t.textContent = msg;
        c.appendChild(t);
        setTimeout(() => t.remove(), 3000);
    }
}

const app = new ProChartApp();
document.addEventListener('DOMContentLoaded', () => app.init());