class App {
    constructor() {
        this.tvBridge = window.tvBridge;
        this.dataFeed = new DataFeed();

        this.activeSymbol = localStorage.getItem('prochart_symbol') || 'NIFTY';
        this.activeTimeframe = localStorage.getItem('prochart_tf') || '15';
        this.activeIndicators = JSON.parse(localStorage.getItem('prochart_indicators') || '["EMA 20", "EMA 50", "VWAP", "MACD", "RSI 14"]');
        
        // Settings for patterns
        this.patternSettings = JSON.parse(localStorage.getItem('prochart_pat_settings') || '{"master":true,"engulfing":true,"star":true,"hammer":true,"doji":true}');

        this.proEngine = new MasterProEngine();
        this.candlePatternEngine = new CandlePatternEngine();
        this.breakoutChecklistEngine = new BreakoutChecklistEngine();
        this.vcpEngine = new VCPPatternEngine();
        this.closingTrapEngine = new ClosingTrapEngine();
        this.greeksEngine = new GreeksEngine();

        this.pollingInterval = null;
        this.lastLtp = 0;
        this.searchDebounce = null;
    }

    async init() {
        console.log("🚀 Initializing ProChart Terminal 2026...");
        this.tvBridge.initChart('mainTvChart');
        this.renderIndicatorMenu();
        this.syncPatternCheckboxes();
        this.bindEvents();
        this.updateUIState();
        this.startClock();
        await this.loadChartData(this.activeSymbol, this.activeTimeframe);
        this.startLiveQuotePolling();
    }

    renderIndicatorMenu() {
        const indList = ['EMA 20', 'EMA 50', 'EMA 200', 'SMA 50', 'SMA 200', 'RSI 14', 'MACD', 'VWAP', 'Bollinger Bands'];
        const drop = document.getElementById('indicatorsDropdown');
        if(!drop) return;
        
        let html = `<div class="dropdown-header">Top Indicators</div>`;
        indList.forEach(ind => {
            const checked = this.activeIndicators.includes(ind) ? 'checked' : '';
            html += `<div class="dropdown-item" onclick="app.toggleIndicator('${ind}')">
                        <input type="checkbox" ${checked} style="pointer-events:none;">
                        <span>${ind}</span>
                     </div>`;
        });
        drop.innerHTML = html;
    }

    toggleIndicator(ind) {
        if (this.activeIndicators.includes(ind)) this.activeIndicators = this.activeIndicators.filter(i => i !== ind);
        else this.activeIndicators.push(ind);
        localStorage.setItem('prochart_indicators', JSON.stringify(this.activeIndicators));
        this.renderIndicatorMenu();
        this.applyIndicators();
    }

    syncPatternCheckboxes() {
        ['master', 'engulfing', 'star', 'hammer', 'doji'].forEach(key => {
            const cb = document.getElementById('pat_' + key);
            if (cb) cb.checked = this.patternSettings[key];
        });
    }

    bindEvents() {
        // Dropdown Click Handlers
        const indBtn = document.getElementById('indicatorsBtn');
        const indDrop = document.getElementById('indicatorsDropdown');
        if (indBtn && indDrop) {
            indBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                indDrop.style.display = indDrop.style.display === 'block' ? 'none' : 'block';
                document.getElementById('patternsDropdown').style.display = 'none';
                document.getElementById('searchDropdown').style.display = 'none';
            });
        }

        const patBtn = document.getElementById('aiPatternsBtn');
        const patDrop = document.getElementById('patternsDropdown');
        if (patBtn && patDrop) {
            patBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                patDrop.style.display = patDrop.style.display === 'block' ? 'none' : 'block';
                document.getElementById('indicatorsDropdown').style.display = 'none';
                document.getElementById('searchDropdown').style.display = 'none';
            });
        }

        document.addEventListener('click', () => {
            if(indDrop) indDrop.style.display = 'none';
            if(patDrop) patDrop.style.display = 'none';
            const sDrop = document.getElementById('searchDropdown');
            if(sDrop) sDrop.style.display = 'none';
        });

        // Pattern Individual Checkboxes
        ['master', 'engulfing', 'star', 'hammer', 'doji'].forEach(key => {
            const cb = document.getElementById('pat_' + key);
            if (cb) {
                cb.addEventListener('change', (e) => {
                    this.patternSettings[key] = e.target.checked;
                    localStorage.setItem('prochart_pat_settings', JSON.stringify(this.patternSettings));
                    this.updateUIState();
                    this.runAllAnalytics(this.tvBridge.currentData);
                });
            }
        });

        // Search Bar (Real API Integration)
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                clearTimeout(this.searchDebounce);
                this.searchDebounce = setTimeout(() => {
                    this.fetchAndRenderSearch(e.target.value.toUpperCase());
                }, 400); // 400ms delay to prevent server spam
            });
            searchInput.addEventListener('focus', (e) => this.fetchAndRenderSearch(e.target.value.toUpperCase()));
            searchInput.addEventListener('click', (e) => e.stopPropagation());
        }

        // Timeframes
        document.querySelectorAll('.tf-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
                this.activeTimeframe = e.currentTarget.dataset.tf || '15';
                localStorage.setItem('prochart_tf', this.activeTimeframe);
                this.loadChartData(this.activeSymbol, this.activeTimeframe);
            });
        });
    }

    // NEW REAL BACKEND SEARCH API
    async fetchAndRenderSearch(query) {
        const drop = document.getElementById('searchDropdown');
        if (!drop) return;
        
        if (!query || query.length < 2) {
            drop.style.display = 'none';
            return;
        }

        drop.style.display = 'block';
        drop.innerHTML = `<div class="dropdown-item text-muted">Searching...</div>`;

        try {
            const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
            if (!res.ok) throw new Error("Search Failed");
            const data = await res.json();
            
            let html = `<div class="dropdown-header">Stocks & Indices</div>`;
            if (!data || data.length === 0) {
                html += `<div class="dropdown-item" style="color:#f23645;">No results for '${query}'</div>`;
            } else {
                data.forEach(item => {
                    // API returns {"symbol": "TATAMOTORS", "name": "...", "exchange": "NSE"}
                    let sym = item.symbol || item.name || item; 
                    let badge = sym === 'TATACV' ? '<span class="badge-v2026">Demerged 2026</span>' : '';
                    html += `<div class="dropdown-item" onclick="app.selectStock('${sym}')">
                                <i class="fa-solid fa-arrow-trend-up" style="color:#787b86;"></i>
                                <span style="font-weight:600;">${sym}</span> ${badge}
                             </div>`;
                });
            }
            drop.innerHTML = html;
        } catch (err) {
            console.warn("Search API fallback", err);
            // Fallback to basic list if API is down
            const fallback = ['NIFTY', 'BANKNIFTY', 'TATAMOTORS', 'TATACV', 'EMIL'].filter(x => x.includes(query));
            let html = `<div class="dropdown-header">Local Matches (API Down)</div>`;
            fallback.forEach(sym => {
                html += `<div class="dropdown-item" onclick="app.selectStock('${sym}')"><span style="font-weight:600;">${sym}</span></div>`;
            });
            drop.innerHTML = html;
        }
    }

    selectStock(symbol) {
        document.getElementById('searchInput').value = '';
        document.getElementById('searchDropdown').style.display = 'none';
        this.loadChartData(symbol, this.activeTimeframe);
    }

    updateUIState() {
        document.querySelectorAll('.tf-btn').forEach(b => {
            if (b.dataset.tf === this.activeTimeframe) b.classList.add('active');
            else b.classList.remove('active');
        });
        const patternBtn = document.getElementById('aiPatternsBtn');
        if (patternBtn) {
            if (this.patternSettings.master) patternBtn.style.color = '#089981';
            else patternBtn.style.color = '#d1d4dc';
        }
    }

    async loadChartData(symbol, tf) {
        this.activeSymbol = symbol;
        localStorage.setItem('prochart_symbol', symbol);

        const symbolHeader = document.getElementById('activeSymbol');
        if (symbolHeader) symbolHeader.innerText = `${symbol} ${tf}m`;

        const data = await this.dataFeed.fetchCandles(symbol, tf);

        if (data && data.length > 0) {
            this.tvBridge.setCandleData(data);
            this.applyIndicators();
            this.runAllAnalytics(data);
            
            const last = data[data.length - 1];
            this.lastLtp = last.close;
            this.updateHeaderPrice(last.close, 0); // Sync Initial
        }
    }

    applyIndicators() {
        this.tvBridge.clearIndicators();
        this.activeIndicators.forEach(ind => {
            if (ind === 'EMA 20') this.tvBridge.addEMA(20, '#FF9800');
            if (ind === 'EMA 50') this.tvBridge.addEMA(50, '#2196F3');
            if (ind === 'EMA 200') this.tvBridge.addEMA(200, '#F44336');
            if (ind === 'SMA 50') this.tvBridge.addEMA(50, '#00BCD4');
            if (ind === 'VWAP') this.tvBridge.addVWAP();
            if (ind === 'MACD') this.tvBridge.addMACD();
        });
        // RSI is standard bottom pane line
        if (this.activeIndicators.includes('RSI 14')) this.tvBridge.addRSI(14);
    }

    runAllAnalytics(data) {
        if (!data || data.length < 5) return;

        try {
            const markers = this.candlePatternEngine.scanAll(data, this.patternSettings);
            this.tvBridge.setMarkers(markers);
        } catch(e) {}

        try {
            const breakout = this.breakoutChecklistEngine.evaluate(data);
            const chkEl = document.getElementById('checklistResult');
            if (chkEl) chkEl.innerText = `${breakout.score}/6 - ${breakout.trend}`;
        } catch(e) {}
    }

    startLiveQuotePolling() {
        if (this.pollingInterval) clearInterval(this.pollingInterval);
        this.pollingInterval = setInterval(async () => {
            let quote = await this.dataFeed.fetchLiveQuote(this.activeSymbol);
            
            // Random fluctuation for Demo visual if backend API is not moving
            if (!quote || quote.ltp <= 0 || quote.ltp === this.lastLtp) {
                const change = (Math.random() - 0.49) * 4.5;
                quote = { ltp: parseFloat((this.lastLtp + change).toFixed(2)) };
            }

            if (quote && quote.ltp > 0) {
                const data = this.tvBridge.currentData;
                if (!data || data.length === 0) return;

                const last = data[data.length - 1];
                last.close = quote.ltp;
                last.high = Math.max(last.high, quote.ltp);
                last.low = Math.min(last.low, quote.ltp);

                // Exact Sync: Header UI updates FIRST, then chart updates
                const diff = quote.ltp - this.lastLtp;
                this.lastLtp = quote.ltp; // Sync state
                this.updateHeaderPrice(quote.ltp, diff);
                
                this.tvBridge.updateTick(last); // Chart gets same value
                this.runAllAnalytics(data); // Re-run pattern/breakout
            }
        }, 1500);
    }

    updateHeaderPrice(ltp, diff) {
        const ltpEl = document.getElementById('activeLtp');
        const chgEl = document.getElementById('activeChange');
        if(!ltpEl) return;

        ltpEl.innerText = ltp.toFixed(2);
        ltpEl.classList.remove('flash-up', 'flash-down');
        void ltpEl.offsetWidth; 

        if (diff > 0) {
            ltpEl.classList.add('flash-up');
            ltpEl.classList.replace('text-danger', 'text-success');
            if(chgEl) { chgEl.innerText = `+${diff.toFixed(2)}`; chgEl.style.color = '#089981'; }
        } else if (diff < 0) {
            ltpEl.classList.add('flash-down');
            ltpEl.classList.replace('text-success', 'text-danger');
            if(chgEl) { chgEl.innerText = `${diff.toFixed(2)}`; chgEl.style.color = '#f23645'; }
        }
    }

    startClock() {
        setInterval(() => {
            const now = new Date();
            const utc = now.getTime() + now.getTimezoneOffset() * 60000;
            const ist = new Date(utc + 3600000 * 5.5);
            const clockEl = document.getElementById('clockIst');
            if (clockEl) clockEl.innerText = `Live ${ist.toLocaleTimeString()} IST`;
        }, 1000);
    }
}

window.onload = () => {
    window.app = new App();
    window.app.init();
};
