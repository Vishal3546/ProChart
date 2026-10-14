class ProChartApp {
    constructor() {
        this.dataFeed = new DataFeed();
        this.masterPro = new MasterProEngine();
        this.breakout = new BreakoutChecklistEngine();
        this.scanner = new CandlePatternEngine();
        this.greeks = new GreeksEngine();
        
        // 🔥 ALL 11 INDICATORS RESTORED
        this.indicatorsList = [
            { id: 'ema9', name: '9 EMA', desc: 'Fast Momentum', color: '#ff4081' },
            { id: 'ema20', name: '20 EMA', desc: 'Intraday Trend', color: '#ff9100' },
            { id: 'ema50', name: '50 EMA', desc: 'Swing Filter', color: '#00e5ff' },
            { id: 'ema100', name: '100 EMA', desc: 'Mid Trend', color: '#7c4dff' },
            { id: 'ema200', name: '200 EMA', desc: 'Long Term Boss', color: '#ea80fc' },
            { id: 'vwap', name: 'VWAP', desc: 'Institutional Avg', color: '#ffd740' },
            { id: 'bb', name: 'Bollinger Bands', desc: 'Volatility Squeeze', color: '#2196f3' },
            { id: 'rsi', name: 'RSI (14)', desc: 'Momentum', color: '#7c4dff' },
            { id: 'macd', name: 'MACD', desc: 'Trend & Histogram', color: '#00c853' },
            { id: 'atr', name: 'ATR', desc: 'Volatility Target', color: '#ff4081' },
            { id: 'stoch', name: 'Stochastic', desc: 'Overbought', color: '#ffd740' }
        ];
    }

    async init() {
        document.getElementById('splashScreen').style.display = 'none';
        document.getElementById('app').style.display = 'flex';
        this.chart = new ChartEngine('mainChart');
        const data = await this.dataFeed.fetchCandleData();
        this.chart.setData(data);
        this.runAllEngines(data);
        this.setupEventListeners();
    }

    runAllEngines(data) {
        if (!data || data.length === 0) return;
        
        // 1. MACD DECELERATION UPDATE
        const macd = this.masterPro.analyzeMACDDeceleration(data);
        const macdEl = document.getElementById('macdDecelText');
        if (macd && macdEl) {
            macdEl.innerHTML = `<div>${macd.status}</div><div style="font-size:9px;color:#94a3b8;margin-top:3px">${macd.msg}</div>`;
            macdEl.style.color = macd.color;
        }

        // 2. 6-POINT BREAKOUT UPDATE
        const closes = data.map(c => c.close);
        const ema10 = TechnicalIndicators.EMA(closes, 10).pop() || 0;
        const ema20 = TechnicalIndicators.EMA(closes, 20).pop() || 0;
        const ema50 = TechnicalIndicators.EMA(closes, 50).pop() || 0;
        const vwap = TechnicalIndicators.VWAP(data).pop() || 0;
        
        // Mock ADX for speed if missing
        const adx = 30; 
        const avgVol = data.slice(-20).reduce((s,c) => s+c.volume,0)/20;

        const current = data[data.length-1];
        const bk = this.breakout.evaluateBullishBreakout(data, {pdh: current.close*0.99, first5mHigh: current.close*0.995}, {
            ema10, ema20, ema50, vwap, adx, avgVolume: avgVol
        });
        
        const bkEl = document.getElementById('breakoutStatusBox');
        if (bkEl) {
            bkEl.innerHTML = `${bk.status} <br><span style="font-size:10px; color:#fff">${bk.passedCount}/${bk.totalChecks} Conditions Met</span>`;
            bkEl.style.backgroundColor = bk.color + '20';
            bkEl.style.color = bk.color;
            bkEl.style.border = `1px solid ${bk.color}`;
        }
        
        // 3. VSA & Bollinger
        const vsa = this.masterPro.analyzeVolumeSpread(data);
        if(vsa) {
            document.getElementById('vsaStatusText').textContent = vsa.vsaType;
            document.getElementById('vsaDetailText').textContent = vsa.detail;
        }
        const bb = this.masterPro.analyzeBollingerBands(data);
        if(bb) {
            document.getElementById('bbStatusText').textContent = bb.signal;
            document.getElementById('bbDetailText').textContent = bb.detail;
        }
    }

    setupEventListeners() {
        // SEARCH
        document.getElementById('symbolBtn')?.addEventListener('click', () => {
            document.getElementById('symbolModal').style.display = 'flex';
            this.renderSymbolList('');
        });
        document.getElementById('symbolSearchInput')?.addEventListener('input', (e) => {
            this.renderSymbolList(e.target.value);
        });
        
        // INDICATORS
        document.getElementById('indicatorBtn')?.addEventListener('click', () => {
            document.getElementById('indicatorModal').style.display = 'flex';
            this.renderIndicatorList('');
        });
        document.getElementById('indicatorSearchInput')?.addEventListener('input', (e) => {
            this.renderIndicatorList(e.target.value);
        });
        
        // MODAL CLOSE
        document.querySelectorAll('.modal-close').forEach(btn => btn.addEventListener('click', e => {
            e.target.closest('.modal-overlay').style.display = 'none';
        }));
    }

    async renderSymbolList(query) {
        const list = document.getElementById('symbolList');
        if(!list) return;
        list.innerHTML = '<div style="padding:10px;text-align:center;">Searching NSE/BSE...</div>';
        const results = await this.dataFeed.searchSymbols(query);
        list.innerHTML = '';
        if(results.length === 0) {
            list.innerHTML = '<div style="padding:10px;text-align:center;">No matches found</div>';
            return;
        }
        results.forEach(s => {
            const div = document.createElement('div');
            div.className = 'list-item';
            div.innerHTML = `<div><div class="item-title">${s.symbol}</div><div class="item-sub">${s.name}</div></div>`;
            div.onclick = async () => {
                document.getElementById('symbolModal').style.display = 'none';
                document.querySelector('.symbol-name').textContent = s.symbol;
                const data = await this.dataFeed.fetchCandleData(s.symbol, s.token);
                this.chart.setData(data);
                this.runAllEngines(data);
            };
            list.appendChild(div);
        });
    }

    renderIndicatorList(query) {
        const list = document.getElementById('indicatorList');
        if(!list) return;
        list.innerHTML = '';
        const q = query.toLowerCase();
        this.indicatorsList.filter(i => i.name.toLowerCase().includes(q)).forEach(ind => {
            const isActive = this.chart.activeIndicators.includes(ind.id);
            const div = document.createElement('div');
            div.className = 'list-item';
            div.style.borderLeft = isActive ? `4px solid ${ind.color}` : 'none';
            div.innerHTML = `<div><div class="item-title">${ind.name}</div><div class="item-sub">${ind.desc}</div></div>`;
            div.onclick = () => {
                if(isActive) this.chart.activeIndicators = this.chart.activeIndicators.filter(i => i !== ind.id);
                else this.chart.activeIndicators.push(ind.id);
                this.chart.render();
                this.renderIndicatorList(query);
            };
            list.appendChild(div);
        });
    }
}
const app = new ProChartApp();
document.addEventListener('DOMContentLoaded', () => app.init());