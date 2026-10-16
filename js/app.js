class ProChartApp {
    constructor() {
        this.dataFeed = new DataFeed();
        this.masterPro = new MasterProEngine();
        this.breakout = new BreakoutChecklistEngine();
        this.scanner = new CandlePatternEngine();
        this.greeks = new GreeksEngine();
        this.vcp = new VCPPatternEngine();
        this.closing = new ClosingTrapEngine();

        this.indicatorsList = [
            { id: 'ema20', name: '20 EMA', desc: 'Intraday trend' },
            { id: 'ema50', name: '50 EMA', desc: 'Swing filter' },
            { id: 'ema200', name: '200 EMA', desc: 'Long-term' },
            { id: 'vwap', name: 'VWAP', desc: 'Institutional avg' },
            { id: 'rsi', name: 'RSI (14)', desc: 'Momentum 0-100' }
        ];
        this.currentSymbol = "NIFTY";
        this.currentToken = "99926000";
        this.currentExchange = "NSE";
        this.currentTimeframe = "15";
    }

    async init() {
        document.getElementById('splashScreen').style.display = 'none';
        document.getElementById('app').style.display = 'flex';
        try {
            this.tvChart = new TVChartBridge('mainTvChart');
        } catch (e) {
            alert("Chart error: " + e.message);
            return;
        }
        await this.loadInitialData();
        this.setupEventListeners();
        this.startLiveQuotePolling();  // AUDIT FIX: Real polling, not fake random
    }

    async loadInitialData() {
        const data = await this.dataFeed.fetchCandleData(
            this.currentSymbol, this.currentToken, this.currentExchange, this.currentTimeframe
        );
        if (data && data.length) {
            this.tvChart.setData(data);
            this.runAllAnalytics(data);
        }
    }

    runAllAnalytics(data) {
        if (!data || !data.length) return;
        const cur = data[data.length - 1];
        const closes = data.map(c => c.close);

        document.getElementById('topSymbolName').textContent = this.currentSymbol;
        document.getElementById('legSymbol').textContent = this.currentSymbol;
        document.getElementById('topSymbolPrice').textContent = cur.close.toFixed(2);

        if (data.length > 1) {
            const prev = data[data.length - 2];
            const pct = ((cur.close - prev.close) / prev.close) * 100;
            const el = document.getElementById('topSymbolChange');
            el.textContent = (pct >= 0 ? '+' : '') + pct.toFixed(2) + '%';
            el.className = 'symbol-change ' + (pct >= 0 ? 'up' : 'down');
        }

        const bb = this.masterPro.analyzeBollingerBands(data);
        if (bb) document.getElementById('bbStatusText').textContent = bb.signal;
        const vsa = this.masterPro.analyzeVolumeSpread(data);
        if (vsa) document.getElementById('vsaStatusText').textContent = vsa.vsaType;
        const macd = this.masterPro.analyzeMACDDeceleration(data);
        if (macd) {
            const el = document.getElementById('macdDecelText');
            el.innerHTML = macd.status + `<div style="font-size:9px;color:#94a3b8">${macd.msg || ''}</div>`;
            el.style.color = macd.color;
        }

        // AUDIT FIX: Real ADX calculation
        const realADX = TechnicalIndicators.ADX(data, 14) || 0;
        const ind = {
            ema10: TechnicalIndicators.EMA(closes, 10).pop(),
            ema20: TechnicalIndicators.EMA(closes, 20).pop(),
            ema50: TechnicalIndicators.EMA(closes, 50).pop(),
            vwap: TechnicalIndicators.VWAP(data).pop(),
            adx: realADX,
            avgVolume: data.slice(-20).reduce((s, c) => s + (c.volume || 0), 0) / 20
        };
        const bk = this.breakout.evaluateBullishBreakout(data, {}, ind);
        const box = document.getElementById('breakoutStatusBox');
        if (box && bk) {
            box.innerHTML = bk.status + `<br><span style="font-size:10px;color:#ccc">${bk.passedCount}/6 (ADX: ${realADX.toFixed(1)})</span>`;
            box.style.background = (bk.color || '#888') + '22';
            box.style.color = bk.color;
        }

        const v = this.vcp.scanVCP(data);
        if (v && v.length) {
            const el = document.getElementById('vcpStatusText');
            el.textContent = v[0].status;
            el.style.color = v[0].color;
        }

        const cl = this.closing.analyzeClosingTrap(data, ind.vwap, ind.ema20);
        if (cl) {
            const el = document.getElementById('btstSignalText');
            el.textContent = cl.btstSignal;
            el.style.color = cl.color;
        }

        const strike = parseFloat(document.getElementById('greekStrike')?.value) || cur.close;
        const type = document.getElementById('greekType')?.value || 'CE';
        const iv = (parseFloat(document.getElementById('greekIV')?.value) || 18) / 100;
        const g = this.greeks.calculateGreeks(cur.close, strike, 7/365, 0.065, iv, type);
        if (g) {
            document.getElementById('gDelta').textContent = g.delta.toFixed(2);
            document.getElementById('gGamma').textContent = g.gamma.toFixed(4);
            document.getElementById('gTheta').textContent = g.theta.toFixed(1);
            document.getElementById('gVega').textContent = g.vega.toFixed(1);
        }

        document.getElementById('sbTime').textContent = new Date().toLocaleTimeString();
    }

    isMarketOpenIST() {
        const now = new Date();
        const utc = now.getTime() + now.getTimezoneOffset() * 60000;
        const ist = new Date(utc + 3600000 * 5.5);
        const day = ist.getDay();
        if (day === 0 || day === 6) return false;
        const m = ist.getHours() * 60 + ist.getMinutes();
        return m >= 555 && m <= 930;
    }

    // AUDIT CRITICAL FIX: REAL Angel Quote Polling (replaces fake random walk)
    startLiveQuotePolling() {
        setInterval(async () => {
            if (!this.tvChart || !this.tvChart.currentData.length) return;

            if (this.isMarketOpenIST()) {
                const quote = await this.dataFeed.fetchLiveQuote();
                if (quote && quote.status && quote.ltp > 0) {
                    const last = this.tvChart.currentData[this.tvChart.currentData.length - 1];
                    const updated = {
                        time: last.time,
                        open: last.open,
                        high: Math.max(last.high, quote.ltp),
                        low: Math.min(last.low, quote.ltp),
                        close: quote.ltp,
                        volume: quote.volume || last.volume
                    };
                    last.close = quote.ltp;
                    last.high = updated.high;
                    last.low = updated.low;
                    last.volume = updated.volume;
                    this.tvChart.updateTick(updated);
                    this.runAllAnalytics(this.tvChart.currentData);
                }
            } else {
                const st = document.getElementById('sbMarketStatus');
                if (st) st.innerHTML = '<span style="color:#ff1744;font-weight:bold;">🔴 Market Closed</span>';
            }
        }, 3000);  // 3 sec polling to respect rate limits
    }

    setupEventListeners() {
        document.getElementById('symbolBtn').onclick = () => {
            document.getElementById('symbolModal').style.display = 'flex';
            this.renderSymbolList('');
        };
        document.getElementById('symbolSearchInput').oninput = e => this.renderSymbolList(e.target.value);
        document.getElementById('closeSymbolModal').onclick = () => document.getElementById('symbolModal').style.display = 'none';
        document.getElementById('indicatorBtn').onclick = () => {
            document.getElementById('indicatorModal').style.display = 'flex';
            this.renderIndList();
        };
        document.getElementById('closeIndicatorModal').onclick = () => document.getElementById('indicatorModal').style.display = 'none';
        document.getElementById('patternBtn').onclick = () => {
            const pats = this.scanner.scanAll(this.tvChart.currentData).filter(p => p.accuracy >= 75);
            this.tvChart.setPatternMarkers(pats);
            this.toast(`Placed ${pats.length} patterns`, 'ok');
        };
        document.querySelectorAll('.tf-btn').forEach(btn => {
            btn.onclick = async e => {
                document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
                e.target.classList.add('active');
                this.currentTimeframe = e.target.dataset.tf;
                document.getElementById('legTF').textContent = this.currentTimeframe + 'm';
                await this.loadInitialData();
            };
        });
        document.querySelectorAll('.modal-overlay').forEach(m => {
            m.onclick = e => { if (e.target === m) m.style.display = 'none'; };
        });
    }

    async renderSymbolList(q) {
        const list = document.getElementById('symbolList');
        list.innerHTML = '<div style="padding:12px;color:#787b86">Searching...</div>';
        const res = await this.dataFeed.searchSymbols(q || '');
        if (!res.length) { list.innerHTML = '<div style="padding:12px;color:#787b86">No matches</div>'; return; }
        list.innerHTML = res.map(s => `
            <div class="list-item" data-s="${s.symbol}" data-t="${s.token}" data-e="${s.exchange || 'NSE'}">
                <div><b style="color:#fff">${s.symbol}</b><br><span style="font-size:10px;color:#787b86">${s.name || ''}</span></div>
            </div>
        `).join('');
        list.querySelectorAll('[data-s]').forEach(el => {
            el.onclick = async () => {
                this.currentSymbol = el.dataset.s;
                this.currentToken = el.dataset.t;
                this.currentExchange = el.dataset.e;
                document.getElementById('symbolModal').style.display = 'none';
                await this.loadInitialData();
                this.toast('Loaded ' + this.currentSymbol, 'ok');
            };
        });
    }

    renderIndList() {
        const list = document.getElementById('indicatorList');
        list.innerHTML = this.indicatorsList.map(ind => {
            const on = this.tvChart.activeIndicators.includes(ind.id);
            return `<div class="list-item" data-id="${ind.id}" style="border-left:3px solid ${on ? '#2962ff' : 'transparent'}">
                <b style="color:#fff">${ind.name}</b> <span style="color:${on ? '#089981' : '#555'}">${on ? 'ON' : 'OFF'}</span>
                <div style="font-size:10px;color:#787b86">${ind.desc}</div>
            </div>`;
        }).join('');
        list.querySelectorAll('[data-id]').forEach(el => {
            el.onclick = () => {
                const id = el.dataset.id;
                if (this.tvChart.activeIndicators.includes(id)) {
                    this.tvChart.activeIndicators = this.tvChart.activeIndicators.filter(x => x !== id);
                } else {
                    this.tvChart.activeIndicators.push(id);
                }
                this.tvChart.updateIndicators();
                this.renderIndList();
            };
        });
    }

    toast(msg, type) {
        const c = document.getElementById('toastContainer');
        const t = document.createElement('div');
        t.className = 'toast';
        if (type === 'ok') t.style.borderLeftColor = '#089981';
        t.textContent = msg;
        c.appendChild(t);
        setTimeout(() => t.remove(), 3000);
    }
}

const app = new ProChartApp();
document.addEventListener('DOMContentLoaded', () => app.init());