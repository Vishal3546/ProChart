/* ============================================================
 * App — Main controller for ProChart Terminal v2026.10
 * - Wires all engines to UI
 * - Handles polling, search, timeframe, indicators, patterns
 * - Uses relative API (same-origin) with file:// fallback
 * ============================================================ */
class App {
    constructor() {
        this.tvBridge = window.tvBridge;
        this.dataFeed = new DataFeed();

        this.activeSymbol = localStorage.getItem('prochart_symbol') || 'NIFTY';
        this.activeToken = localStorage.getItem('prochart_token') || '99926000';
        this.activeExchange = localStorage.getItem('prochart_exchange') || 'NSE';
        this.activeTimeframe = localStorage.getItem('prochart_tf') || '15';

        const defaultInds = ['EMA 20', 'EMA 50', 'VWAP', 'MACD', 'RSI 14'];
        try { this.activeIndicators = JSON.parse(localStorage.getItem('prochart_indicators')) || defaultInds; }
        catch (e) { this.activeIndicators = defaultInds.slice(); }

        const defaultPat = { master: true, engulfing: true, star: true, hammer: true, doji: true,
                             vcp: true, dbl: true, flag: true, div: true, trap: true, abs: true };
        try { this.patternSettings = Object.assign({}, defaultPat, JSON.parse(localStorage.getItem('prochart_pat_settings')) || {}); }
        catch (e) { this.patternSettings = defaultPat; }

        // Engines
        this.proEngine = new MasterProEngine();
        this.candlePatternEngine = new CandlePatternEngine();
        this.breakoutEngine = new BreakoutChecklistEngine();
        this.vcpEngine = new VCPPatternEngine();
        this.dblEngine = new DoubleBottomEngine();
        this.flagEngine = new FlagPatternEngine();
        this.divEngine = new DivergenceEngine();
        this.closingTrapEngine = new ClosingTrapEngine();
        this.absEngine = new OrderFlowAbsorptionEngine();
        this.bigCandleDetector = new BigCandleDetector();
        this.greeksEngine = new GreeksEngine();

        this.pollingInterval = null;
        this.lastLtp = 0;
        this.prevClose = 0;
        this.searchDebounce = null;
        this.isLiveConnected = false;
        this.source = 'SimulatedPro';
        this.marketOpen = true;
        this.signalFeed = [];
        this.lastSignalByKey = {};   // key → last pushed text (dedup per-channel)
        this.pollInFlight = false;
        this.liveEventSource = null;
        this.liveWsConnected = false;
        this.lastTickVolume = 0;
    }

    async init() {
        console.log('🚀 Initializing ProChart Terminal 2026.10...');
        this.tvBridge.initChart('mainTvChart');
        this.renderIndicatorMenu();
        this.syncPatternCheckboxes();
        this.bindEvents();
        this.bindGreeksUI();
        this.updateUIState();
        this.startClock();
        await this.checkServerStatus();
        await this.loadChartData(this.activeSymbol, this.activeTimeframe);
        this.connectLiveStream();   // WebSocket-backed SSE (realtime)
        this.startLiveQuotePolling();  // fallback/poll every 10s for LTP sanity
    }

    // --------------- LIVE WS (SSE) ---------------
    connectLiveStream() {
        if (this.liveEventSource) {
            try { this.liveEventSource.close(); } catch (e) {}
            this.liveEventSource = null;
        }
        // Kick off backend WS subscription to current token
        try {
            fetch('/api/ws/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ exchange: this.activeExchange, token: this.activeToken }),
                cache: 'no-store',
            }).then(r => r.json()).then(j => {
                if (j.status && j.ws && j.ws.connected) {
                    console.log(`🔌 Live WS subscribed: ${this.activeExchange}:${this.activeToken} (${j.ws.subscribed_count} token(s))`);
                } else {
                    console.warn('⚠️ Live WS subscribe:', j.message || 'no feed token yet — falling back to polling');
                }
            }).catch(() => {});
        } catch (e) {}

        const url = `/api/ticks/stream?exchange=${encodeURIComponent(this.activeExchange)}&token=${encodeURIComponent(this.activeToken)}&interval=${encodeURIComponent(this.activeTimeframe)}`;
        try {
            const es = new EventSource(url);
            this.liveEventSource = es;
            es.addEventListener('status', (ev) => {
                try {
                    const s = JSON.parse(ev.data);
                    this.liveWsConnected = !!s.connected;
                    this.setConnectionStatus(s.connected ? true : this.isLiveConnected, s.connected ? 'AngelOne+WS' : this.source);
                } catch (e) {}
            });
            es.addEventListener('tick', (ev) => {
                try {
                    const t = JSON.parse(ev.data);
                    this._onLiveTick(t);
                } catch (e) {}
            });
            es.addEventListener('candle', (ev) => {
                try {
                    const c = JSON.parse(ev.data);
                    this._onLiveCandle(c);
                } catch (e) {}
            });
            es.onerror = () => {
                // Browser auto-reconnects EventSource; don't spam logs.
                this.liveWsConnected = false;
            };
        } catch (e) {
            console.warn('SSE not supported, polling only:', e);
        }
    }

    _onLiveTick(t) {
        if (!t || !t.ltp) return;
        this.lastLtp = t.ltp;
        const prev = this.prevClose || t.prev_close || t.ltp;
        this.updateHeaderPrice(t.ltp, t.ltp - prev);
        const spot = document.getElementById('greekSpot');
        if (spot) spot.value = t.ltp.toFixed(2);
        // Show live indicator dot on LTP badge when WS is flowing
        const lh = document.getElementById('liveHeart');
        if (lh) lh.style.opacity = '1';
        // Reset heartbeat dot after 1s
        clearTimeout(this._hbT);
        this._hbT = setTimeout(() => { if (lh) lh.style.opacity = '0.4'; }, 1200);
    }

    _onLiveCandle(c) {
        if (!c) return;
        // Push forming candle into the bridge (updates the last bar + volume in-place)
        this.tvBridge.updateTick({
            time: c.time, open: c.open, high: c.high, low: c.low,
            close: c.close, volume: c.volume || 0,
        });
        // Keep currentData in sync for analytics
        if (this.tvBridge.currentData && this.tvBridge.currentData.length) {
            const data = this.tvBridge.currentData;
            const last = data[data.length - 1];
            if (last && last.time === c.time) {
                last.open = c.open; last.high = c.high; last.low = c.low;
                last.close = c.close; last.volume = c.volume || 0;
            } else if (c.time > last.time) {
                data.push({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume || 0 });
            }
        }
        // Throttled analytics re-run (max ~1/sec to avoid CPU burn)
        if (!this._liveAnalT || Date.now() - this._liveAnalT > 1000) {
            this._liveAnalT = Date.now();
            this.applyIndicators();
            this.runAllAnalytics(this.tvBridge.currentData);
            const btn = document.getElementById('greekCalcBtn'); if (btn) btn.click();
        }
    }

    // --------------- MENUS ---------------
    renderIndicatorMenu() {
        const indList = ['EMA 20', 'EMA 50', 'EMA 200', 'SMA 50', 'SMA 200', 'Bollinger Bands', 'VWAP', 'SuperTrend', 'RSI 14', 'MACD'];
        const drop = document.getElementById('indicatorsDropdown');
        if (!drop) return;
        let html = `<div class="dropdown-header">Indicators</div>`;
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
        this.runAllAnalytics(this.tvBridge.currentData);
    }

    syncPatternCheckboxes() {
        ['master','engulfing','star','hammer','doji','vcp','dbl','flag','div','trap','abs'].forEach(key => {
            const cb = document.getElementById('pat_' + key);
            if (cb) cb.checked = !!this.patternSettings[key];
        });
    }

    // --------------- EVENTS ---------------
    bindEvents() {
        const indBtn = document.getElementById('indicatorsBtn');
        const indDrop = document.getElementById('indicatorsDropdown');
        const patBtn = document.getElementById('aiPatternsBtn');
        const patDrop = document.getElementById('patternsDropdown');

        if (indBtn && indDrop) {
            indBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                indDrop.style.display = indDrop.style.display === 'block' ? 'none' : 'block';
                if (patDrop) patDrop.style.display = 'none';
                const s = document.getElementById('searchDropdown'); if (s) s.style.display = 'none';
            });
        }
        if (patBtn && patDrop) {
            patBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                patDrop.style.display = patDrop.style.display === 'block' ? 'none' : 'block';
                if (indDrop) indDrop.style.display = 'none';
                const s = document.getElementById('searchDropdown'); if (s) s.style.display = 'none';
            });
        }
        document.addEventListener('click', () => {
            if (indDrop) indDrop.style.display = 'none';
            if (patDrop) patDrop.style.display = 'none';
            const s = document.getElementById('searchDropdown'); if (s) s.style.display = 'none';
        });

        ['master','engulfing','star','hammer','doji','vcp','dbl','flag','div','trap','abs'].forEach(key => {
            const cb = document.getElementById('pat_' + key);
            if (cb) {
                cb.addEventListener('change', (e) => {
                    this.patternSettings[key] = e.target.checked;
                    // MASTER toggle = turn all sub-scanners ON/OFF together
                    if (key === 'master') {
                        ['engulfing','star','hammer','doji','vcp','dbl','flag','div','trap','abs'].forEach(k => {
                            this.patternSettings[k] = e.target.checked;
                            const c = document.getElementById('pat_' + k); if (c) c.checked = e.target.checked;
                        });
                    } else {
                        // If user turns any single scanner ON, keep master ON; if all OFF, set master OFF
                        const anyOn = ['engulfing','star','hammer','doji','vcp','dbl','flag','div','trap','abs']
                                        .some(k => this.patternSettings[k]);
                        this.patternSettings.master = anyOn;
                        const mcb = document.getElementById('pat_master'); if (mcb) mcb.checked = anyOn;
                    }
                    localStorage.setItem('prochart_pat_settings', JSON.stringify(this.patternSettings));
                    this.updateUIState();
                    this.runAllAnalytics(this.tvBridge.currentData);
                });
            }
        });

        // Manual refresh button (rounded)
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this._manualRefresh(refreshBtn));
        }

        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                clearTimeout(this.searchDebounce);
                this.searchDebounce = setTimeout(() => this.fetchAndRenderSearch(e.target.value), 350);
            });
            searchInput.addEventListener('focus', (e) => this.fetchAndRenderSearch(e.target.value));
            searchInput.addEventListener('click', (e) => e.stopPropagation());
        }

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

    bindGreeksUI() {
        const btn = document.getElementById('greekCalcBtn');
        if (!btn) return;

        // Strike step-size per underlying (proper ATM rounding)
        this._strikeStep = () => {
            const s = (this.activeSymbol || '').toUpperCase();
            if (s === 'BANKNIFTY') return 100;
            if (s === 'FINNIFTY') return 50;
            if (s === 'MIDCPNIFTY') return 25;
            if (s === 'SENSEX') return 100;
            if (s === 'NIFTY') return 50;
            return 0; // equities → nearest rupee = spot
        };
        this._atmStrike = (spot) => {
            if (!spot || spot <= 0) return spot;
            const step = this._strikeStep();
            if (step <= 0) return Math.round(spot);
            return Math.round(spot / step) * step;
        };

        const calc = () => {
            const spot = parseFloat(document.getElementById('greekSpot')?.value) || this.lastLtp || 22668;
            // Auto-snap strike to ATM unless user manually overrode
            const strikeEl = document.getElementById('greekStrike');
            let strike = parseFloat(strikeEl?.value);
            const autoMode = !strikeEl || strikeEl.dataset.auto !== '0';
            if (!strike || autoMode) {
                strike = this._atmStrike(spot);
                if (strikeEl) { strikeEl.value = strike; strikeEl.dataset.auto = '1'; }
            }
            const type = document.getElementById('greekType')?.value || 'CE';
            const iv = parseFloat(document.getElementById('greekIv')?.value) || 18;
            const dte = parseFloat(document.getElementById('greekDte')?.value) || 7;
            const g = this.greeksEngine.calculateGreeks(spot, strike, type, iv, dte);
            const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = (v == null ? '—' : v); };
            set('greekDelta', g.delta.toFixed(3));
            set('greekGamma', g.gamma.toFixed(5));
            set('greekTheta', g.theta.toFixed(2));
            set('greekVega', g.vega.toFixed(2));
            set('greekRho', g.rho.toFixed(3));
            set('greekIvDisp', g.iv_pct.toFixed(1) + '%');
            // Keep spot in sync with LTP
            if (this.lastLtp > 0) {
                const sp = document.getElementById('greekSpot');
                if (sp) sp.value = this.lastLtp.toFixed(2);
                if (strikeEl && strikeEl.dataset.auto !== '0') {
                    strikeEl.value = this._atmStrike(this.lastLtp);
                }
            }
        };
        btn.addEventListener('click', calc);
        // Mark strike as manual when user edits it
        if (document.getElementById('greekStrike')) {
            document.getElementById('greekStrike').addEventListener('input', (e) => {
                e.target.dataset.auto = '0';
            });
        }
        ['greekSpot','greekStrike','greekType','greekIv','greekDte'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.addEventListener('change', calc);
        });
        // Auto-calc once on first data load
        setTimeout(calc, 1500);
    }

    // --------------- SEARCH ---------------
    async fetchAndRenderSearch(query) {
        const drop = document.getElementById('searchDropdown');
        if (!drop) return;
        const q = (query || '').trim();
        if (q.length < 1) {
            const data = await this.dataFeed.search('');
            drop.style.display = 'block';
            drop.innerHTML = this._renderSearchResults(data.results || [], 'Popular');
            return;
        }

        drop.style.display = 'block';
        drop.innerHTML = `<div class="dropdown-item text-muted"><i class="fa-solid fa-spinner fa-spin"></i> Searching…</div>`;

        const data = await this.dataFeed.search(q);
        const results = data.results || [];
        if (!data.loaded && !results.length) {
            drop.innerHTML = `<div class="dropdown-item text-muted"><i class="fa-solid fa-spinner fa-spin"></i> Loading stock list (first run may take 30-60s)…</div>`;
            return;
        }
        drop.innerHTML = this._renderSearchResults(results, `Results for "${q}"`, q);
    }
    _renderSearchResults(list, header, query = '') {
        let html = `<div class="dropdown-header">${header}</div>`;
        if (!list || list.length === 0) {
            html += `<div class="dropdown-item text-muted">No results for "${query}"</div>`;
            return html;
        }
        list.forEach(item => {
            const sym = item.symbol || item.name;
            const fullName = item.name || sym;
            const exch = item.exchange || '';
            const typeTag = item.type === 'OPT_FUT' ? '<span class="sym-exch" style="background:#9c27b0;">F&O</span>' :
                            item.type === 'INDEX'   ? '<span class="sym-exch" style="background:#2962ff;">IDX</span>' :
                            '<span class="sym-exch">EQ</span>';
            html += `<div class="dropdown-item" data-token="${item.token}" data-exchange="${item.exchange}" data-symbol="${sym}">
                <i class="fa-solid fa-arrow-trend-up" style="color:#787b86;"></i>
                <span class="sym-name">${sym}</span>
                <span class="sym-full" title="${fullName}">${fullName}</span>
                <span class="sym-exch">${exch}</span>
                ${typeTag}
            </div>`;
        });
        // Attach click handlers (event delegation)
        setTimeout(() => {
            const drop = document.getElementById('searchDropdown');
            if (!drop) return;
            drop.querySelectorAll('.dropdown-item[data-symbol]').forEach(el => {
                el.addEventListener('click', (ev) => {
                    ev.stopPropagation();
                    this.selectStock(el.dataset.symbol, el.dataset.token, el.dataset.exchange);
                });
            });
        }, 0);
        return html;
    }

    selectStock(symbol, token, exchange) {
        const sIn = document.getElementById('searchInput'); if (sIn) sIn.value = '';
        const d = document.getElementById('searchDropdown'); if (d) d.style.display = 'none';
        if (token)    { this.activeToken = token;    localStorage.setItem('prochart_token', token); }
        if (exchange) { this.activeExchange = exchange; localStorage.setItem('prochart_exchange', exchange); }
        this.loadChartData(symbol, this.activeTimeframe);
    }

    // --------------- UI ---------------
    updateUIState() {
        document.querySelectorAll('.tf-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.tf === this.activeTimeframe);
        });
        const patBtn = document.getElementById('aiPatternsBtn');
        if (patBtn) patBtn.style.color = this.patternSettings.master ? '#089981' : '#d1d4dc';
    }

    setConnectionStatus(status, sourceLabel) {
        const wsOn = this.liveWsConnected;
        this.isLiveConnected = !!status && this.marketOpen;
        this.source = sourceLabel || (status ? (wsOn ? 'AngelOne+WS' : 'AngelOne') : 'SimulatedPro');
        const badge = document.getElementById('connBadge');
        const txt = document.getElementById('connText');
        const foot = document.getElementById('engineFooter');
        const dot = document.getElementById('connDot');
        const live = !!status && this.marketOpen;
        const closed = !!status && !this.marketOpen;
        if (badge && txt) {
            badge.classList.remove('conn-live','conn-sim','conn-off');
            if (live && wsOn) { badge.classList.add('conn-live'); txt.textContent = '⚡ LIVE TICKS'; }
            else if (live)    { badge.classList.add('conn-live'); txt.textContent = 'LIVE ANGEL ONE'; }
            else if (closed)  { badge.classList.add('conn-off'); txt.textContent = 'MARKET CLOSED'; }
            else              { badge.classList.add('conn-sim'); txt.textContent = 'SIMULATED'; }
        }
        if (foot) foot.textContent = `v2026.10 Engine • ${wsOn && live ? '⚡ WebSocket LIVE' : live ? '🟢 Angel One REST' : closed ? '🔴 Market Closed' : '🟡 Simulated Feed'} • ${this.source}`;
        if (dot) dot.className = (wsOn && live) ? 'dot-green' : live ? 'dot-yellow' : closed ? 'dot-red' : 'dot-yellow';
    }

    refreshStatusBadge() {
        // Call this whenever marketOpen flips so the badge updates without a full reload
        this.setConnectionStatus(this.source === 'AngelOne', this.source);
    }

    async checkServerStatus() {
        const s = await this.dataFeed.fetchStatus();
        if (s && s.status === 'online') {
            const prev = this.marketOpen;
            this.marketOpen = s.market_open !== false;
            if (this.marketOpen !== prev) this.refreshStatusBadge();
            this.setConnectionStatus(!!s.angel_connected, s.angel_connected ? 'AngelOne' : 'SimulatedPro');
            if (!s.angel_connected) {
                this.toast('Angel One not connected — showing simulated data. Add .env credentials for live feed.', 'warn');
            } else {
                this.toast('Connected to Angel One SmartAPI ✅', 'success');
            }
        } else {
            this.setConnectionStatus(false, 'SimulatedPro');
            this.toast('Backend not reachable. Run: python server.py  — showing simulated data.', 'error');
        }
    }

    async loadChartData(symbol, tf) {
        this.activeSymbol = symbol;
        localStorage.setItem('prochart_symbol', symbol);

        const label = tf === 'D' ? 'D' : `${tf}m`;
        const symHeader = document.getElementById('activeSymbol');
        if (symHeader) symHeader.innerText = `${symbol} ${label}`;

        // Resubscribe live WS to new token/timeframe
        this.connectLiveStream();

        const meta = { token: this.activeToken, exchange: this.activeExchange };
        const cd = await this.dataFeed.fetchCandles(symbol, tf, meta);
        const candles = cd.candles;
        const source = cd.source;
        if (typeof cd.market_open === 'boolean') this.marketOpen = cd.market_open;
        this.source = source;
        this.setConnectionStatus(source === 'AngelOne', source);

        if (candles && candles.length > 0) {
            this.tvBridge.setCandleData(candles);
            this.applyIndicators();
            this.runAllAnalytics(candles);
            const last = candles[candles.length - 1];
            this.prevClose = candles.length > 1 ? candles[candles.length - 2].close : last.open;
            this.lastLtp = last.close;
            // Update greeks spot
            const spot = document.getElementById('greekSpot'); if (spot && this.lastLtp) spot.value = this.lastLtp.toFixed(2);
            this.updateHeaderPrice(last.close, last.close - this.prevClose);
            // Initial greeks calc
            const btn = document.getElementById('greekCalcBtn'); if (btn) btn.click();
        }
    }

    applyIndicators() {
        this.tvBridge.clearIndicators();
        // Clear & re-add selected overlays
        this.activeIndicators.forEach(ind => {
            if (ind === 'EMA 20')  this.tvBridge.addEMA(20, '#FF9800');
            if (ind === 'EMA 50')  this.tvBridge.addEMA(50, '#2196F3');
            if (ind === 'EMA 200') this.tvBridge.addEMA(200, '#F44336');
            if (ind === 'SMA 50')  this.tvBridge.addSMA(50, '#00BCD4');
            if (ind === 'SMA 200') this.tvBridge.addSMA(200, '#CDDC39');
            if (ind === 'Bollinger Bands') this.tvBridge.addBollinger();
            if (ind === 'VWAP') this.tvBridge.addVWAP();
            if (ind === 'SuperTrend') this.tvBridge.addSuperTrend();
            if (ind === 'MACD') this.tvBridge.addMACD();
        });
        if (this.activeIndicators.includes('RSI 14')) this.tvBridge.addRSI(14);
    }

    runAllAnalytics(data) {
        if (!data || data.length < 5) return;

        // Candle patterns
        try {
            const markers = this.candlePatternEngine.scanAll(data, this.patternSettings);
            this.tvBridge.setMarkers(markers);
        } catch (e) { console.warn('candlePatterns err', e); }

        // Master Pro dashboard
        try {
            const mp = this.proEngine.analyze(data);
            this._setMetric('signalSqueeze', mp.squeeze.label, mp.squeeze.level);
            this._setMetric('signalVsa', mp.vsa.label, mp.vsa.level);
            this._setMetric('signalMacd', mp.macd.label, mp.macd.level);
            this._setMetric('signalRsi', mp.rsi.label, mp.rsi.level);
            this._pushFeed(`MASTER: ${mp.macd.label} / ${mp.vsa.label}`, mp.score >= 1 ? 'bull' : (mp.score <= -1 ? 'bear' : 'neut'), 'master');
        } catch (e) { console.warn('masterPro err', e); }

        // Breakout checklist
        try {
            const bo = this.breakoutEngine.evaluate(data);
            const chk = document.getElementById('checklistResult');
            if (chk) {
                chk.className = `checklist-status text-${bo.level === 'muted' ? 'muted' : bo.level}`;
                chk.innerHTML = `<div>${bo.trend}</div><div style="margin-top:4px;font-size:11px;opacity:0.8;">${bo.score}/6 — ${bo.reasons.join(' • ')}</div>`;
            }
            if (bo.score >= 5) this._pushFeed(`Breakout: ${bo.trend}`, 'bull', 'bo');
        } catch (e) { console.warn('breakout err', e); }

        // VCP
        if (this.patternSettings.vcp) {
            try {
                const v = this.vcpEngine.scan(data);
                this._setMetric('vcpResult', v.label, v.level);
                if (v.detected) this._pushFeed(`VCP: ${v.label}`, 'bull', 'vcp');
            } catch (e) {}
        } else { this._setMetric('vcpResult', '⚪ OFF', 'muted'); }

        // Double bottom/top
        if (this.patternSettings.dbl) {
            try {
                const d = this.dblEngine.scan(data);
                this._setMetric('dblResult', d.label, d.level);
                if (d.detected) this._pushFeed(`${d.pattern}: ${d.label}`, d.level === 'success' ? 'bull' : 'bear', 'dbl');
            } catch (e) {}
        } else { this._setMetric('dblResult', '⚪ OFF', 'muted'); }

        // Flags
        if (this.patternSettings.flag) {
            try {
                const f = this.flagEngine.scan(data);
                this._setMetric('flagResult', f.label, f.level);
                if (f.detected) this._pushFeed(`Flag: ${f.label}`, f.dir === 'bull' ? 'bull' : 'bear', 'flag');
            } catch (e) {}
        } else { this._setMetric('flagResult', '⚪ OFF', 'muted'); }

        // Divergence (needs RSI values)
        if (this.patternSettings.div) {
            try {
                const rsiArr = TechnicalIndicators.RSI(data, 14);
                const d = this.divEngine.scanDivergences(data, rsiArr);
                this._setMetric('divResult', d.label, d.level);
                if (d.detected) this._pushFeed(`Divergence: ${d.label}`, d.direction === 'bullish' ? 'bull' : 'bear', 'div');
            } catch (e) {}
        } else { this._setMetric('divResult', '⚪ OFF', 'muted'); }

        // Closing trap
        if (this.patternSettings.trap) {
            try {
                const t = this.closingTrapEngine.analyze(data, this.activeTimeframe);
                this._setMetric('trapResult', t.label, t.level);
                if (t.trap) this._pushFeed(`Trap: ${t.label}`, t.direction === 'bull' ? 'bull' : 'bear', 'trap');
            } catch (e) {}
        } else { this._setMetric('trapResult', '⚪ OFF', 'muted'); }

        // Absorption
        if (this.patternSettings.abs) {
            try {
                const a = this.absEngine.scan(data);
                this._setMetric('absResult', a.label, a.level);
                if (a.detected && a.signals.length) {
                    const last = a.signals[a.signals.length - 1];
                    this._pushFeed(`Absorption: ${last.text}`, last.level === 'danger' ? 'bear' : 'bull', 'abs');
                }
            } catch (e) {}
        } else { this._setMetric('absResult', '⚪ OFF', 'muted'); }

        // Big candle forming (live momentum detector) — always on
        try {
            const bc = this.bigCandleDetector.analyze(data, this.activeTimeframe);
            this._setMetric('bigCandleResult', bc.label, bc.level);
            if (bc.fresh) {
                const volTxt = bc.volRatio ? ` (vol ${bc.volRatio.toFixed(1)}x)` : '';
                this._pushFeed(`${bc.dir === 'bull' ? '🚀' : '🔻'} Big ${bc.dir} candle ${bc.magnitude.toFixed(1)}x forming${volTxt}`, bc.dir, 'big');
                this.toast(`Big ${bc.dir} candle forming!`, bc.dir === 'bull' ? 'success' : 'danger', 3000);
            }
        } catch (e) {}
    }

    _setMetric(id, text, level) {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = text;
        el.className = 'metric-val';
        const map = {
            success: 'text-success', danger: 'text-danger', warning: 'text-warning',
            info: 'text-info', muted: 'text-muted', primary: 'text-primary',
        };
        if (map[level]) el.classList.add(map[level]);
    }

    _pushFeed(text, kind = 'neut', key = '') {
        // Per-channel deduplication: same key+text as last → skip
        const channel = key || 'generic';
        if (this.lastSignalByKey[channel] === text) return;
        this.lastSignalByKey[channel] = text;
        const now = new Date(Date.now() + 5.5 * 3600 * 1000);
        const ts = now.toISOString().substr(11, 8) + ' IST';
        this.signalFeed.unshift({ ts, text, kind });
        if (this.signalFeed.length > 40) this.signalFeed.pop();
        this._renderFeed();
    }
    _renderFeed() {
        const el = document.getElementById('signalFeed');
        if (!el) return;
        el.innerHTML = this.signalFeed.map(s =>
            `<div class="sig-entry ${s.kind}"><span class="sig-time">${s.ts}</span><span class="sig-text">${s.text}</span></div>`
        ).join('');
    }

    // --------------- POLLING ---------------
    _stopPolling() {
        if (this.pollingInterval) {
            clearTimeout(this.pollingInterval);
            this.pollingInterval = null;
        }
        this._pollInFlight = false;
    }
    startLiveQuotePolling() {
        // Guard against double-start (page refresh / symbol switch / init re-runs)
        this._stopPolling();
        // Global singleton guard (prevents 2 App instances polling after dev reload)
        if (window.__prochartPoller && window.__prochartPoller !== this) {
            try { window.__prochartPoller._stopPolling(); } catch (e) {}
        }
        window.__prochartPoller = this;

        // Clean up on page hide (stops in-flight timer before refresh so new page starts clean)
        window.addEventListener('pagehide', () => this._stopPolling(), { once: true });
        window.addEventListener('beforeunload', () => this._stopPolling(), { once: true });

        let backoffMs = 0;     // after rate-limit / error, back off
        const stepSecFor = tf => ({'1':60,'3':180,'5':300,'15':900,'30':1800,'60':3600,'D':86400})[tf] || 900;

        const tick = async () => {
            if (this._pollInFlight) return;
            this._pollInFlight = true;
            try {
                const meta = { token: this.activeToken, exchange: this.activeExchange };
                const data = this.tvBridge.currentData;
                if (!data || !data.length) { return; }
                const last = data[data.length - 1];

                const stepSec = stepSecFor(this.activeTimeframe);
                const nowSec = Math.floor(Date.now() / 1000);
                const lastTs = this.tvBridge._toSec(last.time);
                const newBar = (nowSec - lastTs) >= stepSec;

                let quote = null, moved = false;
                if (this.isLiveConnected && this.marketOpen) {
                    quote = await this.dataFeed.fetchLiveQuote(this.activeSymbol, meta);
                }

                // Detect server-side rate-limit → back off
                if (quote && quote.rate_limited) {
                    backoffMs = 30000;
                    quote = null;
                } else if (!quote || !quote.status) {
                    // Failure (no data / market closed) → small extra backoff
                    if (backoffMs < 5000) backoffMs = this.marketOpen ? 5000 : 0;
                } else {
                    backoffMs = 0;
                }

                if (quote && quote.status && quote.ltp > 0) {
                    if (newBar) {
                        const o = last.close;
                        data.push({
                            time: lastTs + stepSec,
                            open: o, high: quote.ltp, low: quote.ltp, close: quote.ltp,
                            volume: quote.volume || 0,
                        });
                        if (data.length > 500) data.shift();
                    } else {
                        last.close = quote.ltp;
                        last.high = Math.max(last.high, quote.ltp);
                        last.low = Math.min(last.low, quote.ltp);
                        if (quote.volume) last.volume = quote.volume;
                    }
                    moved = true;
                } else if (this.source === 'SimulatedPro' && this.marketOpen) {
                    // Random walk ONLY when market is open and we're in simulation mode
                    const change = (Math.random() - 0.5) * Math.max(last.close * 0.0006, 0.3);
                    if (newBar) {
                        const o = last.close;
                        const c = o + change;
                        data.push({
                            time: lastTs + stepSec,
                            open: o, high: Math.max(o, c), low: Math.min(o, c), close: c,
                            volume: Math.floor(100000 + Math.random() * 600000),
                        });
                        if (data.length > 500) data.shift();
                    } else {
                        last.close = +(last.close + change).toFixed(2);
                        last.high = Math.max(last.high, last.close);
                        last.low = Math.min(last.low, last.close);
                    }
                    moved = true;
                }
                // After market close (or live but no quote): freeze — no random drift.

                const lastCandle = data[data.length - 1];
                if (moved) this.tvBridge.updateTick(lastCandle);

                const ltp = lastCandle.close;
                const base = this.prevClose || data[0].open || ltp;
                const diff = ltp - base;
                this.lastLtp = ltp;
                this.updateHeaderPrice(ltp, diff, base);

                if (newBar) this.runAllAnalytics(data);
            } finally {
                this._pollInFlight = false;
            }
        };

        const schedule = () => {
            const baseMs = this.marketOpen ? 3000 : 15000;
            const ms = Math.max(baseMs, backoffMs);
            // Refresh badge each loop (catches market open→close transition)
            this.refreshStatusBadge();
            this.pollingInterval = setTimeout(async () => { await tick(); schedule(); }, ms);
        };
        // First tick after small delay (gives time for candles to load)
        setTimeout(tick, 1500);
        schedule();
    }

    // Manual refresh: reload candles + re-run analytics (with visual spinner)
    async _manualRefresh(btn) {
        if (!btn) return;
        const orig = btn.innerHTML;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        btn.disabled = true;
        try {
            // Force cache bust: server will return fresh candles
            await this.loadChartData(this.activeSymbol, this.activeTimeframe);
            this.toast('Data refreshed ✅', 'success', 2000);
        } catch (e) {
            this.toast('Refresh failed', 'error', 2000);
        } finally {
            setTimeout(() => { btn.innerHTML = orig; btn.disabled = false; }, 400);
        }
    }

    updateHeaderPrice(ltp, diff, prevClose) {
        const ltpEl = document.getElementById('activeLtp');
        const chgEl = document.getElementById('activeChange');
        const prev = prevClose || this.prevClose || ltp;
        if (ltpEl) {
            ltpEl.innerText = ltp.toFixed(2);
            ltpEl.classList.remove('flash-up', 'flash-down', 'text-success', 'text-danger');
            void ltpEl.offsetWidth;
            if (diff > 0) {
                ltpEl.classList.add('flash-up', 'text-success');
            } else if (diff < 0) {
                ltpEl.classList.add('flash-down', 'text-danger');
            } else {
                ltpEl.classList.add('text-muted');
            }
        }
        if (chgEl) {
            const pct = prev ? (diff / prev) * 100 : 0;
            chgEl.innerText = `${diff >= 0 ? '+' : ''}${diff.toFixed(2)} (${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%)`;
            chgEl.style.color = diff > 0 ? '#089981' : (diff < 0 ? '#f23645' : '#787b86');
        }
    }

    startClock() {
        setInterval(() => {
            const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
            const clockEl = document.getElementById('clockIst');
            if (clockEl) clockEl.innerText = `Live ${ist.toISOString().substr(11, 8)} IST`;
        }, 1000);
    }

    // --------------- TOASTS ---------------
    toast(msg, type = 'info', duration = 4000) {
        const container = document.getElementById('toastContainer');
        if (!container) return;
        const el = document.createElement('div');
        el.className = `toast ${type}`;
        el.textContent = msg;
        container.appendChild(el);
        setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, duration);
    }
}

window.addEventListener('load', () => {
    window.app = new App();
    window.app.init();
});
