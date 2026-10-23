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
        this._pendingLoadTimer = null;   // debounce
        this._pendingLoadAbort = null;   // AbortController
        this._lastGoodPrice = {};        // symbol -> last known good close (fallback baseline)
        this._liveInitDone = false;      // don't fire candles until WS has had a moment

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
        this.nextCandlePredictor = new NextCandlePredictor();
        this.trendBiasEngine = new TrendBiasEngine();
        this.tradingPlanEngine = new TradingPlanEngine();
        this.breakoutScanner = new BreakoutScanner();
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
        // Set up leader election FIRST (startLiveQuotePolling sets _isLeaderTab/_passiveTab atomically).
        // connectLiveStream + WS subscribe + candle fetch happen ONLY for the leader tab — prevents
        // the "3 tabs all hammer Angel at once" WAF-storm root cause.
        this.startLiveQuotePolling();
        // Note: connectLiveStream / WS subscribe / candle fetch are triggered inside startLiveQuotePolling
        // after the startup stagger + leader election completes, OR when focus is gained.
        // INSTANT chart from localStorage cache (TradingView-style — zero delay)
        try {
            const cached = this.dataFeed._loadLocalCache(this.activeSymbol, this.activeTimeframe);
            if (cached && cached.length) {
                this.tvBridge.setCandleData(cached);
                this.source = 'LocalCache';
                this.setConnectionStatus(false, 'LocalCache');
                requestAnimationFrame(() => { this.applyIndicators(); this.runAllAnalytics(cached); });
                const last = cached[cached.length-1];
                this.prevClose = last.close; this.lastLtp = last.close;
                this.updateHeaderPrice(last.close, 0, last.close);
            }
        } catch(e){}
        // Staggered live candle fetch: wait for first WS tick or 5s whichever first,
        // then fire candles. Server throttle handles the rest.
        await new Promise(resolve => {
            const done = () => { this._initCandleWait=null; resolve(); };
            this._initCandleWait = done;
            // Wait is handled inside leader election callback; this is just a safety fallback
            setTimeout(done, 12000);
        });
        // If leader election already fired loadChartData this is a no-op; safety net only.
        if (this._isLeaderTab && this._candlesLoaded !== true) {
            await this.loadChartData(this.activeSymbol, this.activeTimeframe, { firstLoad: true });
        }
    }

    // --------------- LIVE WS (SSE) ---------------
    connectLiveStream() {
        if (this._passiveTab || this._isLeaderTab === false) return;
        const symKey = `${this.activeExchange}:${this.activeToken}`;
        const fullKey = `${symKey}:${this.activeTimeframe}`;

        // Skip ENTIRELY if already subscribed to same (token+TF) — idempotent fast path
        if (this._lastSubKey === fullKey && this.liveEventSource && this.liveEventSource.readyState === 1) {
            return;
        }
        // Also skip if we switched to this TF VERY recently (<1.5s ago) — SSE is still establishing
        if (this._lastSubKey === fullKey && (Date.now()-(this._lastSubAt||0)) < 1500) return;

        // Always close old SSE first
        if (this.liveEventSource) {
            try { this.liveEventSource.close(); } catch (e) {}
            this.liveEventSource = null;
        }
        // Only call unsubscribe if we actually HAD an old SSE (avoid pointless POST on first-load)
        if (this._lastSubKey) {
            try { fetch('/api/ws/unsubscribe', { method:'POST', cache:'no-store' }).catch(()=>{}); } catch(e){}
        }

        const tokenChanged = (this._lastSubSymKey !== symKey);
        this._lastSubKey = fullKey;
        this._lastSubSymKey = symKey;
        this._lastSubAt = Date.now();

        if (tokenChanged) {
            try {
                fetch('/api/ws/subscribe', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ exchange: this.activeExchange, token: this.activeToken }),
                    cache: 'no-store',
                }).then(r => r.json()).then(j => {
                    if (j.status && j.ws && j.ws.connected) {
                        console.log(`🔌 Live WS subscribed: ${symKey} (${j.ws.subscribed_count} token(s))`);
                    }
                }).catch(() => {});
            } catch (e) {}
        }

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
        const prevClose = this.prevClose || t.prev_close || t.ltp;
        this.lastLtp = t.ltp;
        this._lastWsTickAt = Date.now();
        // Resolve initial candle wait if this is the first live tick
        if (this._initCandleWait) { const cb = this._initCandleWait; this._initCandleWait = null; cb(); }
        this.updateHeaderPrice(t.ltp, t.ltp - prevClose);
        const spot = document.getElementById('greekSpot');
        if (spot) spot.value = t.ltp.toFixed(2);
        // Up → green, Down → red (no pulse animation; static color only)
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
                const tf = e.currentTarget.dataset.tf || '15';
                if (tf === this.activeTimeframe) return;  // already on that TF — nothing to do
                document.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
                e.currentTarget.classList.add('active');
                this.activeTimeframe = tf;
                localStorage.setItem('prochart_tf', this.activeTimeframe);
                // Debounce 800ms + abort previous fetch (avoids hammering Angel on rapid TF clicks)
                if (this._pendingLoadTimer) clearTimeout(this._pendingLoadTimer);
                if (this._pendingLoadAbort) this._pendingLoadAbort.abort();
                this._pendingLoadAbort = new AbortController();
                const abortSig = this._pendingLoadAbort.signal;
                this._pendingLoadTimer = setTimeout(() => {
                    if (abortSig.aborted) return;
                    this.loadChartData(this.activeSymbol, this.activeTimeframe);
                }, 800);
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
        const calReason = (this.calendarReason || '').toUpperCase();
        const holidayMode = this.isHoliday || calReason.includes('HOLIDAY') || calReason.includes('WEEKEND') || calReason.includes('CLOSED');
        const isPassive = sourceLabel === 'PassiveTab';
        this.isLiveConnected = !!status && this.marketOpen && !holidayMode && !isPassive;
        this.source = isPassive ? 'PassiveTab' : sourceLabel || (status ? (wsOn ? 'AngelOne+WS' : 'AngelOne') : 'SimulatedPro');
        const badge = document.getElementById('connBadge');
        const txt = document.getElementById('connText');
        const foot = document.getElementById('engineFooter');
        const dot = document.getElementById('connDot');
        const live = !!status && this.marketOpen && !holidayMode && !isPassive;
        const closed = (!!status && !this.marketOpen) || holidayMode;
        if (badge && txt) {
            badge.classList.remove('conn-live','conn-sim','conn-off');
            if (isPassive)    { badge.classList.add('conn-sim'); txt.textContent = '◐ ANOTHER TAB ACTIVE'; }
            else if (live && wsOn) { badge.classList.add('conn-live'); txt.textContent = '⚡ LIVE TICKS'; }
            else if (live)    { badge.classList.add('conn-live'); txt.textContent = 'LIVE ANGEL ONE'; }
            else if (closed)  { badge.classList.add('conn-off');  txt.textContent = 'MARKET CLOSED'; }
            else              { badge.classList.add('conn-sim');  txt.textContent = 'SIMULATED'; }
        }
        if (foot) {
            const label = isPassive       ? '◐ Passive — click here to take over'
                        : (wsOn && live) ? '⚡ WebSocket LIVE'
                        : live           ? '🟢 Angel One REST'
                        : closed         ? '🔴 Market Closed'
                        :                  '🟡 Simulated Feed';
            foot.textContent = `v2026.10 Engine • ${label} • ${this.source}`;
        }
        if (dot) dot.className = isPassive ? 'dot-yellow' : (wsOn && live) ? 'dot-green' : closed ? 'dot-red' : 'dot-yellow';
    }

    refreshStatusBadge() {
        // Call this whenever marketOpen flips so the badge updates without a full reload
        this.setConnectionStatus(this.source === 'AngelOne', this.source);
    }

    async checkServerStatus() {
        const s = await this.dataFeed.fetchStatus();
        if (s && s.status === 'online') {
            this.marketOpen = s.market_open !== false;
            this.isHoliday = !!s.is_holiday;
            this.calendarReason = s.market_reason || '';
            this.setConnectionStatus(!!s.angel_connected, s.angel_connected ? 'AngelOne' : 'SimulatedPro');
            if (!s.angel_connected) {
                this.toast('Angel One not connected — showing simulated data. Add .env credentials for live feed.', 'warn');
            } else if (this.isHoliday) {
                this.toast(`Market closed: ${this.calendarReason} — live ticks unavailable today`, 'info');
            } else {
                this.toast('Connected to Angel One SmartAPI ✅', 'success');
            }
        } else {
            this.marketOpen = false;
            this.isHoliday = false;
            this.setConnectionStatus(false, 'SimulatedPro');
            this.toast('Backend not reachable. Run: python server.py  — showing simulated data.', 'error');
        }
    }

    async loadChartData(symbol, tf, opts = {}) {
        const isRetry = !!opts.retry;
        const isFirstLoad = !!opts.firstLoad;
        this.activeSymbol = symbol;
        this.activeTimeframe = tf;
        localStorage.setItem('prochart_symbol', symbol);
        localStorage.setItem('prochart_tf', tf);

        const label = tf === 'D' ? 'D' : `${tf}m`;
        const symHeader = document.getElementById('activeSymbol');
        if (symHeader) symHeader.innerText = `${symbol} ${label}`;

        // Passive tab: do NOT make API calls — show cache only, defer to leader tab
        if (this._isLeaderTab === false && !isFirstLoad) {
            const cached = this.dataFeed._loadLocalCache(symbol, tf);
            if (cached && cached.length >= 10) {
                const sane = this._sanitizeCandles(cached, symbol);
                this.tvBridge.setCandleData(sane);
                requestAnimationFrame(() => { this.applyIndicators(); this.runAllAnalytics(sane); });
                const last = sane[sane.length-1];
                this.lastLtp = last.close; this.prevClose = this._findDayOpen(sane, tf);
                this.updateHeaderPrice(last.close, last.close - this.prevClose, this.prevClose);
            }
            this.setConnectionStatus(false, 'PassiveTab');
            return;
        }

        // ----- INSTANT CHART: TradingView-style — render localStorage cache FIRST (if exists & fresh)
        // but ONLY for the SAME symbol+tf as last visit (don't show INDHOTEL cache for IGIL).
        const lastCachedSym = localStorage.getItem('prochart_symbol');
        const lastCachedTf  = localStorage.getItem('prochart_tf');
        const sameSymbol    = lastCachedSym === symbol;
        const instantCache  = sameSymbol ? this.dataFeed._loadLocalCache(symbol, tf) : null;
        const hadInstant    = !!(instantCache && instantCache.length);
        if (hadInstant) {
            const saneInst = this._sanitizeCandles(instantCache, symbol);
            // Safety: if cache last price wildly diverges from header LTP (different stock / stale), skip
            const cacheLast = saneInst[saneInst.length - 1].close;
            const priceOk = !this.lastLtp || !isFinite(this.lastLtp) || this.lastLtp <= 0
                || Math.abs(cacheLast - this.lastLtp) / this.lastLtp < 0.15;  // <15% divergence
            if (priceOk && saneInst.length >= 10) {
                this._lastGoodPrice[symbol] = cacheLast;
                this.tvBridge.setCandleData(saneInst);
                requestAnimationFrame(() => { this.applyIndicators(); this.runAllAnalytics(saneInst); });
                const last = saneInst[saneInst.length - 1];
                this.lastLtp = last.close;
                this.prevClose = this._findDayOpen(saneInst, tf);
                this.updateHeaderPrice(last.close, last.close - this.prevClose, this.prevClose);
                this.setConnectionStatus(false, 'Cached');
                const sp = document.getElementById('greekSpot'); if (sp) sp.value = last.close.toFixed(2);
            }
        } else if (!isRetry) {
            // No cache — show subtle "loading" pill, keep PREVIOUS chart visible for continuity
            const el = document.getElementById('trendBiasResult');
            if (el) { el.textContent = '⏳ Loading...'; el.className = 'bias-badge bias-neutral'; }
        }

        // WS subscription: only change when SYMBOL changes; pure TF switch keeps same WS tick stream
        if (!isRetry) {
            // Abort all prior in-flight candle fetches (critical! prevents stale responses
            // from older TF/symbol overwriting the newly requested fresh data)
            this.dataFeed && this.dataFeed.abortAllCandles && this.dataFeed.abortAllCandles();
            this.connectLiveStream();
        }

        const meta = { token: this.activeToken, exchange: this.activeExchange };
        let cd;
        try {
            cd = await this.dataFeed.fetchCandles(symbol, tf, meta);
        } catch (e) {
            if (e && e.name === 'AbortError') return;  // newer click superseded us
            return;
        }
        let candles = cd.candles;
        const source = cd.source;
        if (typeof cd.market_open === 'boolean') this.marketOpen = cd.market_open;
        this.source = source;
        this.setConnectionStatus(source === 'AngelOne', source);

        candles = this._sanitizeCandles(candles, symbol);

        // IMPORTANT: always accept real AngelOne data even if instant cache was shown
        // (fresh server data is truth). Accept fallback/cache/simulated only if we have nothing
        // better rendered yet OR the data length is substantial (>=30 bars).
        const haveSubstantial = candles && candles.length >= 30;
        const isFreshAngel = source === 'AngelOne';
        if (!candles || candles.length < 2) {
            const inCooldown = cd && cd.cooldown;
            const el = document.getElementById('trendBiasResult');
            if (el && !hadInstant) {
                el.textContent = inCooldown ? '⏳ Waiting for AngelOne (rate-limit cool-down)...' : '⏳ Loading candles...';
                el.className = 'bias-badge bias-neutral';
            }
            clearTimeout(this._retryLoadTimer);
            this._retryCount = (this._retryCount || 0) + 1;
            // If in cooldown, wait the full cooldown period (don't spam retries that will just 429 again)
            let waitMs;
            if (inCooldown && cd.retryAfterMs) {
                waitMs = Math.min(cd.retryAfterMs + 500, 60000);
                this._retryCount = 0;  // don't escalate backoff during cooldown wait
            } else {
                waitMs = Math.min(2000 * this._retryCount, 15000);
            }
            this._retryLoadTimer = setTimeout(() => this.loadChartData(symbol, tf, { retry: true }), waitMs);
            return;
        }
        // Render fresh data ALWAYS when AngelOne, or when nothing is shown yet
        if (isFreshAngel || haveSubstantial || !hadInstant) {
            this.tvBridge.setCandleData(candles);
            requestAnimationFrame(() => {
                this.applyIndicators();
                this.runAllAnalytics(candles);
            });
            const last = candles[candles.length - 1];
            this.prevClose = this._findDayOpen(candles, tf);
            this.lastLtp = last.close;
            const sp = document.getElementById('greekSpot'); if (sp && this.lastLtp) sp.value = this.lastLtp.toFixed(2);
            this.updateHeaderPrice(last.close, last.close - this.prevClose, this.prevClose);
            const btn = document.getElementById('greekCalcBtn'); if (btn) btn.click();
        }
        this._retryCount = 0;
    }

    /** Strip extreme outlier candles (>50% gap AND single-bar spike = high<next_low or low>next_high) */
    _sanitizeCandles(candles, symbol) {
        if (!candles || candles.length <= 5) return candles || [];
        const sane = [candles[0]];
        for (let i = 1; i < candles.length - 1; i++) {
            const c = candles[i], prev = candles[i-1], nxt = candles[i+1];
            if (!c || !prev || !nxt) { sane.push(c); continue; }
            const upGapPct = (c.high - Math.max(prev.high, nxt.high)) / Math.max(prev.close, nxt.close);
            const dnGapPct = (Math.min(prev.low, nxt.low) - c.low) / Math.min(prev.close, nxt.close);
            // Drop candle only if it spikes >50% AWAY from both neighbours and immediately
            // reverses (classic one-bar data corruption — not a real move).
            if (c.high > Math.max(prev.high, nxt.high) && upGapPct > 0.5 && c.close < c.high * 0.6) {
                continue;
            }
            if (c.low < Math.min(prev.low, nxt.low) && dnGapPct > 0.5 && c.close > c.low * 1.6) {
                continue;
            }
            sane.push(c);
        }
        sane.push(candles[candles.length - 1]);
        if (symbol && sane.length) this._lastGoodPrice[symbol] = sane[sane.length-1].close;
        return sane;
    }

    /** Find today's day-open from a candle array (first bar >= 09:15 IST intraday, prev-day close for D) */
    _findDayOpen(candles, tf) {
        if (!candles || !candles.length) return candles?.[0]?.open || 0;
        if (tf === 'D') return candles.length > 1 ? candles[candles.length-2].close : candles[0].open;
        const now = new Date();
        const istOffset = 5.5*3600*1000;
        const istNow = new Date(now.getTime()+istOffset);
        const istY = istNow.getUTCFullYear(), istM = istNow.getUTCMonth(), istD = istNow.getUTCDate();
        const dayStart = Date.UTC(istY, istM, istD, 3, 45, 0);
        for (let i=0; i<candles.length; i++) {
            if (candles[i].time*1000 >= dayStart) return candles[i].open;
        }
        return candles[0].open;
    }

    applyIndicators() {
        if (!this.tvBridge || !this.tvBridge.currentData || this.tvBridge.currentData.length < 5) return;
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

        // Skip noisy analytics on simulated data / market closed / holidays —
        // random-walk fallback generates false BUY ABSORPTION / W-BOTTOM / VCP
        // signals that aren't real. Show dashboard metrics but suppress signal
        // feed push.
        const isRealData = this.source === 'AngelOne' && this.marketOpen && !this.isHoliday;

        // Candle patterns (markers are harmless visual overlays)
        try {
            const markers = this.candlePatternEngine.scanAll(data, this.patternSettings);
            this.tvBridge.setMarkers(markers);
        } catch (e) { console.warn('candlePatterns err', e); }

        // Master Pro dashboard — always show values, but skip feed push when not live
        try {
            const mp = this.proEngine.analyze(data);
            this._setMetric('signalSqueeze', mp.squeeze.label, mp.squeeze.level);
            this._setMetric('signalVsa', mp.vsa.label, mp.vsa.level);
            this._setMetric('signalMacd', mp.macd.label, mp.macd.level);
            this._setMetric('signalRsi', mp.rsi.label, mp.rsi.level);
            if (isRealData) this._pushFeed(`MASTER: ${mp.macd.label} / ${mp.vsa.label}`, mp.score >= 1 ? 'bull' : (mp.score <= -1 ? 'bear' : 'neut'), 'master');
        } catch (e) { console.warn('masterPro err', e); }

        // Breakout checklist
        try {
            const bo = this.breakoutEngine.evaluate(data);
            const chk = document.getElementById('checklistResult');
            if (chk) {
                chk.className = `checklist-status text-${bo.level === 'muted' ? 'muted' : bo.level}`;
                chk.innerHTML = `<div>${bo.trend}</div><div style="margin-top:4px;font-size:11px;opacity:0.8;">${bo.score}/6 — ${bo.reasons.join(' • ')}</div>`;
            }
            if (isRealData && bo.score >= 5) this._pushFeed(`Breakout: ${bo.trend}`, 'bull', 'bo');
        } catch (e) { console.warn('breakout err', e); }

        // VCP
        if (this.patternSettings.vcp) {
            try {
                const v = this.vcpEngine.scan(data);
                this._setMetric('vcpResult', v.label, v.level);
                if (isRealData && v.detected) this._pushFeed(`VCP: ${v.label}`, 'bull', 'vcp');
            } catch (e) {}
        } else { this._setMetric('vcpResult', '⚪ OFF', 'muted'); }

        // Double bottom/top
        if (this.patternSettings.dbl) {
            try {
                const d = this.dblEngine.scan(data);
                this._setMetric('dblResult', d.label, d.level);
                if (isRealData && d.detected) this._pushFeed(`${d.pattern}: ${d.label}`, d.level === 'success' ? 'bull' : 'bear', 'dbl');
            } catch (e) {}
        } else { this._setMetric('dblResult', '⚪ OFF', 'muted'); }

        // Flags
        if (this.patternSettings.flag) {
            try {
                const f = this.flagEngine.scan(data);
                this._setMetric('flagResult', f.label, f.level);
                if (isRealData && f.detected) this._pushFeed(`Flag: ${f.label}`, f.dir === 'bull' ? 'bull' : 'bear', 'flag');
            } catch (e) {}
        } else { this._setMetric('flagResult', '⚪ OFF', 'muted'); }

        // Divergence (needs RSI values)
        if (this.patternSettings.div) {
            try {
                const rsiArr = TechnicalIndicators.RSI(data, 14);
                const d = this.divEngine.scanDivergences(data, rsiArr);
                this._setMetric('divResult', d.label, d.level);
                if (isRealData && d.detected) this._pushFeed(`Divergence: ${d.label}`, d.direction === 'bullish' ? 'bull' : 'bear', 'div');
            } catch (e) {}
        } else { this._setMetric('divResult', '⚪ OFF', 'muted'); }

        // Closing trap
        if (this.patternSettings.trap) {
            try {
                const t = this.closingTrapEngine.analyze(data, this.activeTimeframe);
                this._setMetric('trapResult', t.label, t.level);
                if (isRealData && t.trap) this._pushFeed(`Trap: ${t.label}`, t.direction === 'bull' ? 'bull' : 'bear', 'trap');
            } catch (e) {}
        } else { this._setMetric('trapResult', '⚪ OFF', 'muted'); }

        // Absorption
        if (this.patternSettings.abs) {
            try {
                const a = this.absEngine.scan(data);
                this._setMetric('absResult', a.label, a.level);
                if (isRealData && a.detected && a.signals.length) {
                    const last = a.signals[a.signals.length - 1];
                    this._pushFeed(`Absorption: ${last.text}`, last.level === 'danger' ? 'bear' : 'bull', 'abs');
                }
            } catch (e) {}
        } else { this._setMetric('absResult', '⚪ OFF', 'muted'); }

        // Big candle forming (live momentum detector) — always on
        try {
            const bc = this.bigCandleDetector.analyze(data, this.activeTimeframe);
            this._setMetric('bigCandleResult', bc.label, bc.level);
            if (isRealData && bc.fresh) {
                const volTxt = bc.volRatio ? ` (vol ${bc.volRatio.toFixed(1)}x)` : '';
                this._pushFeed(`${bc.dir === 'bull' ? '🚀' : '🔻'} Big ${bc.dir} candle ${bc.magnitude.toFixed(1)}x forming${volTxt}`, bc.dir, 'big');
                this.toast(`Big ${bc.dir} candle forming!`, bc.dir === 'bull' ? 'success' : 'danger', 3000);
            }
        } catch (e) {}

        // Trend Bias (VWAP + EMA20/50 + RSI composite score)
        let tb = { label: '—', level: 'muted', bias: 'neutral', factors: {}, score: 0 };
        try {
            tb = this.trendBiasEngine.analyze(data);
            const el = document.getElementById('trendBiasResult');
            if (el) {
                el.textContent = tb.label;
                el.className = 'bias-badge';
                const map = { success: 'bias-bull', danger: 'bias-bear', muted: 'bias-neutral', info: 'bias-bull', warning: 'bias-bear' };
                el.classList.add(map[tb.level] || 'bias-neutral');
            }
            const bd = document.getElementById('trendBiasBreakdown');
            if (bd) {
                const f = tb.factors;
                const line = (name, v, bullTxt, bearTxt) => {
                    const cls = v > 0 ? 'bias-fbull' : v < 0 ? 'bias-fbear' : 'bias-fneutral';
                    const txt = v > 0 ? bullTxt : bearTxt;
                    return `<div class="${cls}">${name}: ${txt}</div>`;
                };
                bd.innerHTML = [
                    line('VWAP',  f.vwap,  'above ✓', 'below ✗'),
                    line('EMA',   f.ema,   '20>50 ✓', '20<50 ✗'),
                    line('RSI',   f.rsi,   '>50 ✓', '<50 ✗'),
                ].join('');
            }
            // Optional: tint chart background subtly when bias is strong
            const chartWrap = document.getElementById('mainTvChart');
            if (chartWrap) {
                chartWrap.classList.remove('bg-bull', 'bg-bear');
                if (tb.bias === 'bull' && tb.score >= 2.5) chartWrap.classList.add('bg-bull');
                else if (tb.bias === 'bear' && tb.score <= -2.5) chartWrap.classList.add('bg-bear');
            }
        } catch (e) { console.warn('trendBias err', e); }

        // Trading plan (entry/sl/target) when bias is strong
        try {
            const plan = this.tradingPlanEngine.plan(data, tb);
            const el = document.getElementById('tradePlanResult');
            if (el && plan.ready) {
                const sideColor = plan.direction === 'LONG' ? '#089981' : '#f23645';
                const actionTxt = plan.actionable ? '<span style="color:#ffae00;font-weight:700">⚡ ACTION NOW</span>' : `⏳ Pending (${Math.abs(plan.dist_pct).toFixed(2)}% away)`;
                el.innerHTML = `
                    <div style="font-size:13px;font-weight:800;color:${sideColor};margin-bottom:6px;text-align:center;">
                        ${plan.direction} — ${actionTxt}
                    </div>
                    <div class="plan-row"><span>Entry</span><b style="color:#ffd700">${plan.entry.toFixed(2)}</b><span class="plan-sub">${plan.entryReason}</span></div>
                    <div class="plan-row"><span>Stop Loss</span><b style="color:#f23645">${plan.sl.toFixed(2)}</b><span class="plan-sub">${plan.slReason}</span></div>
                    <div class="plan-row"><span>Target 1</span><b style="color:#089981">${plan.t1.toFixed(2)}</b><span class="plan-sub">${plan.t1Reason}</span></div>
                    <div class="plan-row"><span>Target 2</span><b style="color:#2962ff">${plan.t2.toFixed(2)}</b><span class="plan-sub">1:2 RR</span></div>
                    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px;margin-top:8px;font-size:10px;text-align:center;font-family:'JetBrains Mono',monospace;">
                        <div>ATR<br><b>${plan.atr.toFixed(2)}</b></div>
                        <div>RR1<br><b style="color:${plan.rr1>=1.5?'#089981':'#f23645'}">1:${plan.rr1.toFixed(2)}</b></div>
                        <div>RR2<br><b style="color:${plan.rr2>=2?'#089981':'#ffae00'}">1:${plan.rr2.toFixed(2)}</b></div>
                    </div>
                    <div style="font-size:10px;text-align:center;margin-top:6px;font-weight:700;color:${plan.rr1>=1.5?'#089981':'#f23645'};">${plan.verdict}</div>
                    <div style="font-size:10px;opacity:0.75;text-align:center;margin-top:4px;">Qty (₹1L capital @ 1% risk): <b style="color:#fff">${plan.qty_1pct_risk_cap_1L}</b> shares</div>
                `;
                el.className = '';
            } else if (el) {
                el.innerHTML = `<div style="font-size:11px;text-align:center;opacity:0.7;padding:12px 6px;">${plan && plan.reason ? plan.reason : 'No strong bias yet'}</div>`;
                el.className = 'plan-empty';
            }
        } catch (e) { console.warn('tradePlan err', e); }

        // Breakout Scanner — detects VCP/coil breakouts with institutional volume
        try {
            const bo = this.breakoutScanner.scan(data);
            const el = document.getElementById('breakoutResult');
            if (!el) { /* skip */ }
            else if (bo.detected) {
                const color = bo.direction === 'LONG' ? '#089981' : '#f23645';
                const arrow = bo.direction === 'LONG' ? '▲' : '▼';
                el.innerHTML = `
                    <div style="font-size:14px;font-weight:800;color:${color};text-align:center;margin-bottom:6px;">
                        ${arrow} ${bo.direction} BREAKOUT ${bo.grade}
                    </div>
                    <div class="plan-row"><span>Pivot</span><b>${bo.pivot.toFixed(2)}</b></div>
                    <div class="plan-row"><span>Entry</span><b style="color:#ffd700">${bo.entry.toFixed(2)}</b></div>
                    <div class="plan-row"><span>Stop Loss</span><b style="color:#f23645">${bo.sl.toFixed(2)}</b></div>
                    <div class="plan-row"><span>Target 1</span><b style="color:#089981">${bo.target1.toFixed(2)}</b></div>
                    <div class="plan-row"><span>Target 2</span><b style="color:#2962ff">${bo.target.toFixed(2)}</b></div>
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px;margin-top:6px;font-size:10px;text-align:center;font-family:'JetBrains Mono',monospace;">
                        <div>Vol<br><b style="color:${bo.volRatio>=1.5?'#089981':'#ffae00'}">${bo.volRatio.toFixed(1)}x</b></div>
                        <div>Score<br><b>${bo.score}/10</b></div>
                    </div>
                    <div style="font-size:9px;opacity:0.8;margin-top:6px;padding-top:6px;border-top:1px dashed rgba(120,123,134,0.2);">
                        ${bo.reasons.slice(0,3).map(r => '• '+r).join('<br>')}
                    </div>
                `;
                el.className = '';
                // Toast alert on FIRST detection (dedup by key)
                const key = `${this.activeSymbol}_${this.activeTimeframe}_${bo.direction}_${bo.pivot.toFixed(0)}`;
                if (!this.lastSignalByKey[key] && isRealData && bo.score >= 7) {
                    this.lastSignalByKey[key] = Date.now();
                    this.toast(`${bo.direction} BREAKOUT on ${this.activeSymbol} @ ${bo.entry.toFixed(2)}`, bo.direction === 'LONG' ? 'success' : 'danger', 4000);
                    this._pushFeed(`🚀 ${this.activeSymbol} ${bo.direction} BREAKOUT (score ${bo.score}/10, vol ${bo.volRatio.toFixed(1)}x)`, bo.direction.toLowerCase(), 'bo2');
                }
            } else if (bo.coming) {
                el.innerHTML = `
                    <div style="font-size:11px;text-align:center;color:#ffae00;font-weight:700;margin-bottom:4px;">
                        🌀 COIL / SQUEEZE BUILDING
                    </div>
                    <div style="font-size:10px;opacity:0.9;font-family:'JetBrains Mono',monospace;">
                        Watch Pivot ▲ <b>${bo.coming.pivotLong.toFixed(2)}</b><br>
                        Or breakdown ▼ <b>${bo.coming.pivotShort.toFixed(2)}</b><br>
                        BB width ${bo.coming.bbWidth.toFixed(2)}% — tight coil
                    </div>
                `;
                el.className = '';
            } else {
                el.textContent = 'No breakout setup yet';
                el.className = 'plan-empty';
            }
        } catch (e) { console.warn('breakoutScan err', e); }

        // Next candle AI forecast
        try {
            const nc = this.nextCandlePredictor.analyze(data);
            let label = '—', level = 'muted';
            if (nc.direction === 'bull') {
                label = `🟢 BULL ${nc.confidence.toUpperCase()} (${nc.score >= 0 ? '+' : ''}${nc.score})`;
                level = nc.confidence === 'high' ? 'success' : nc.confidence === 'med' ? 'info' : 'muted';
            } else if (nc.direction === 'bear') {
                label = `🔴 BEAR ${nc.confidence.toUpperCase()} (${nc.score})`;
                level = nc.confidence === 'high' ? 'danger' : nc.confidence === 'med' ? 'warning' : 'muted';
            } else {
                label = `⚪ NEUTRAL (${nc.score})`;
                level = 'muted';
            }
            this._setMetric('nextCandleResult', label, level);
            const reasons = document.getElementById('nextCandleReasons');
            if (reasons) {
                reasons.innerHTML = (nc.factors || []).slice(0, 3).map(f =>
                    `<div style="font-size:10px;opacity:0.75;padding:1px 0;">• ${f}</div>`).join('');
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
        this._stopPolling();
        // Aggressive single-tab leader election via BroadcastChannel:
        //  - Tabs send periodic heartbeat with their random tab ID + timestamp
        //  - Oldest (earliest claimed leader) stays leader
        //  - Leader makes ALL candle/quote/WS calls; passive tabs read from localStorage
        //    via a shared tick broadcast channel (future work). For now passive tabs show
        //    last cached data with a "Passive tab — switch to this tab for live data" hint.
        this._tabId = Math.random().toString(36).slice(2, 9);
        this._isLeaderTab = false;  // start passive; claim leadership after lock acquisition
        this._passiveTab = true;
        try {
            this._tabChan = new BroadcastChannel('prochart-leader');
            this._tabChan.onmessage = (e) => {
                if (!e.data || !e.data.type) return;
                const isClaim = e.data.type === 'claim' || e.data.type === 'heartbeat';
                if (isClaim && e.data.id !== this._tabId) {
                    // Yield if another live leader exists (has claimed recently, within 6s)
                    const age = Date.now() - (e.data.ts || 0);
                    if (age < 6000 && this._isLeaderTab && e.data.id !== this._tabId) {
                        // Only yield if other tab is ALSO claiming leader (not just random)
                        if (e.data.leader) {
                            console.log(`🔀 Tab ${this._tabId} yielding to leader ${e.data.id}`);
                            this._isLeaderTab = false; this._passiveTab = true;
                            if (this.liveEventSource) { try { this.liveEventSource.close(); } catch(_){} this.liveEventSource=null; }
                            if (this.pollingInterval) { clearTimeout(this.pollingInterval); this.pollingInterval=null; }
                            try { fetch('/api/ws/unsubscribe',{method:'POST',cache:'no-store'}).catch(()=>{}); } catch(_){}
                            this.setConnectionStatus(false, 'PassiveTab');
                        }
                    }
                }
            };
            // Atomic leader lock via localStorage: winner is whichever tab writes the lock first.
            // Random startup stagger (0-800ms) + lock check prevents all-3-tabs-writing-at-once race.
            const _acquireLeader = () => {
                const LOCK_KEY = 'prochart_leader_lock';
                const now = Date.now();
                let lock = null;
                try { lock = JSON.parse(localStorage.getItem(LOCK_KEY) || 'null'); } catch(_){}
                const lockAge = lock ? (now - (lock.ts || 0)) : 999999;
                // Stale lock (>7s old = dead tab) — claim it
                if (!lock || lockAge > 7000 || lock.id === this._tabId) {
                    this._claimedAt = now;
                    this._isLeaderTab = true; this._passiveTab = false;
                    localStorage.setItem(LOCK_KEY, JSON.stringify({id:this._tabId, ts:now}));
                } else {
                    this._isLeaderTab = false; this._passiveTab = true;
                    this.setConnectionStatus(false, 'PassiveTab');
                }
            };
            // Stagger startup 0-700ms so tabs don't race lock on simultaneous load
            const _startDelay = Math.floor(Math.random() * 700);
            setTimeout(() => {
                _acquireLeader();
                // If we won leadership, open WS/SSE and fire initial fetch
                if (this._isLeaderTab) {
                    if (this._tabChan) this._tabChan.postMessage({type:'claim', id:this._tabId, ts:this._claimedAt, leader:true});
                    this.connectLiveStream();
                    // Staggered candle fetch — give WS 3s to establish
                    setTimeout(() => {
                        this.loadChartData(this.activeSymbol, this.activeTimeframe, { firstLoad: true });
                    }, 3000);
                } else {
                    this.setConnectionStatus(false, 'PassiveTab');
                    // Try reading cache immediately for the passive tab overlay
                    try {
                        const cached = this.dataFeed._loadLocalCache(this.activeSymbol, this.activeTimeframe);
                        if (cached && cached.length) {
                            const sane = this._sanitizeCandles(cached, this.activeSymbol);
                            this.tvBridge.setCandleData(sane);
                            requestAnimationFrame(() => { this.applyIndicators(); this.runAllAnalytics(sane); });
                            const last = sane[sane.length-1];
                            this.lastLtp = last.close; this.prevClose = this._findDayOpen(sane, this.activeTimeframe);
                            this.updateHeaderPrice(last.close, last.close - this.prevClose, this.prevClose);
                        }
                    } catch(_){}
                }
                // Heartbeat every 3s — refresh localStorage lock + BC ping
                this._hbTimer = setInterval(() => {
                    const LK = 'prochart_leader_lock';
                    const now2 = Date.now();
                    if (this._isLeaderTab) {
                        localStorage.setItem(LK, JSON.stringify({id:this._tabId, ts:now2}));
                        try { this._tabChan.postMessage({type:'heartbeat', id:this._tabId, ts:now2, leader:true}); } catch(_){}
                    } else {
                        // Check if leader died (no heartbeat for >7s) — take over
                        let lk = null;
                        try { lk = JSON.parse(localStorage.getItem(LK) || 'null'); } catch(_){}
                        if (!lk || (now2 - (lk.ts||0)) > 7000) {
                            console.log(`👑 Tab ${this._tabId} taking over leadership (old leader dead)`);
                            _acquireLeader();
                            if (this._isLeaderTab) {
                                this.connectLiveStream();
                                this.loadChartData(this.activeSymbol, this.activeTimeframe, {retry:true});
                            }
                        }
                    }
                }, 3000);
            }, _startDelay);

            window.addEventListener('focus', () => {
                // Focus gain → force-take leadership (user is looking at this tab)
                this._passiveTab = false; this._isLeaderTab = true; this._claimedAt = Date.now();
                localStorage.setItem('prochart_leader_lock', JSON.stringify({id:this._tabId, ts:Date.now()}));
                try { this._tabChan.postMessage({type:'claim', id:this._tabId, ts:this._claimedAt, leader:true}); } catch(_){}
                this.connectLiveStream();
                this.loadChartData(this.activeSymbol, this.activeTimeframe, { retry: true });
            });
            // Release lock on unload
            window.addEventListener('beforeunload', () => {
                try {
                    const lk = JSON.parse(localStorage.getItem('prochart_leader_lock')||'null');
                    if (lk && lk.id === this._tabId) localStorage.removeItem('prochart_leader_lock');
                } catch(_){}
            });
        } catch(e) { this._isLeaderTab = true; this._passiveTab = false; /* fallback if BC unavailable */ }

        // Global singleton guard (prevents 2 App instances polling after dev reload)
        if (window.__prochartPoller && window.__prochartPoller !== this) {
            try { window.__prochartPoller._stopPolling(); } catch (e) {}
        }
        window.__prochartPoller = this;

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
                // Only REST-poll quote if SSE/WS hasn't delivered a tick in last 5s (saves API calls)
                const wsFresh = this.lastLtp && (Date.now() - (this._lastWsTickAt||0)) < 5000;
                if (this.isLiveConnected && this.marketOpen && !wsFresh) {
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
            // Quote polling is a SANITY FALLBACK ONLY when SSE/WS drops.
            // When WS is live we use tick events to update LTP — NO REST calls.
            const baseMs = this.liveWsConnected ? 60000 : 15000;  // 60s when live, 15s fallback
            const ms = Math.max(baseMs, backoffMs);
            this.refreshStatusBadge();
            this.pollingInterval = setTimeout(async () => { await tick(); schedule(); }, ms);
        };
        // First tick after a generous delay (WS + candles fully loaded by then)
        setTimeout(tick, 15000);
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
    window._app = window.app;
    window.app.init();
});
