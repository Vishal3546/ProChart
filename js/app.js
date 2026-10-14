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