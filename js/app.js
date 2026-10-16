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
        this.greeksEngine = new GreeksEngine();

        this.pollingInterval = null;
        this.lastLtp = 0;
        this.prevClose = 0;
        this.searchDebounce = null;
        this.isLiveConnected = false;
        this.source = 'SimulatedPro';
        this.signalFeed = [];
        this.lastSignalKey = '';
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
        this.startLiveQuotePolling();
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
                    // master override: toggling master flips all to match if turning off
                    if (key === 'master' && !e.target.checked) {
                        ['engulfing','star','hammer','doji','vcp','dbl','flag','div','trap','abs'].forEach(k => {
                            this.patternSettings[k] = false;
                            const c = document.getElementById('pat_' + k); if (c) c.checked = false;
                        });
                    }
                    localStorage.setItem('prochart_pat_settings', JSON.stringify(this.patternSettings));
                    this.updateUIState();
                    this.runAllAnalytics(this.tvBridge.currentData);
                });
            }
        });

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
        const calc = () => {
            const spot = parseFloat(document.getElementById('greekSpot')?.value) || this.lastLtp || 22668;
            const strike = parseFloat(document.getElementById('greekStrike')?.value) || 22650;
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
            if (this.lastLtp > 0) document.getElementById('greekSpot').value = this.lastLtp.toFixed(2);
        };
        btn.addEventListener('click', calc);
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
            // Show popular list on focus with empty query
            const popular = await this.dataFeed.search('');
            drop.style.display = 'block';
            drop.innerHTML = this._renderSearchResults(popular, 'Popular');
            return;
        }
        if (q.length < 2) { drop.style.display = 'none'; return; }

        drop.style.display = 'block';
        drop.innerHTML = `<div class="dropdown-item text-muted"><i class="fa-solid fa-spinner fa-spin"></i> Searching…</div>`;

        const results = await this.dataFeed.search(q);
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
        this.isLiveConnected = !!status;
        this.source = sourceLabel || (status ? 'AngelOne' : 'SimulatedPro');
        const badge = document.getElementById('connBadge');
        const txt = document.getElementById('connText');
        const foot = document.getElementById('engineFooter');
        const dot = document.getElementById('connDot');
        if (badge && txt) {
            badge.classList.remove('conn-live','conn-sim','conn-off');
            if (status) { badge.classList.add('conn-live'); txt.textContent = 'LIVE ANGEL ONE'; }
            else { badge.classList.add('conn-sim'); txt.textContent = 'SIMULATED'; }
        }
        if (foot) foot.textContent = `v2026.10 Engine • ${status ? '🟢 Angel One Live' : '🟡 Simulated Feed'} • ${this.source}`;
        if (dot) dot.className = status ? 'dot-green' : 'dot-green';
    }

    async checkServerStatus() {
        const s = await this.dataFeed.fetchStatus();
        if (s && s.status === 'online') {
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

        const meta = { token: this.activeToken, exchange: this.activeExchange };
        const { candles, source } = await this.dataFeed.fetchCandles(symbol, tf, meta);
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
        // De-dupe: same key+text within last 10s → skip
        const sig = `${key}:${text}`;
        if (sig === this.lastSignalKey) return;
        this.lastSignalKey = sig;
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
    startLiveQuotePolling() {
        if (this.pollingInterval) clearInterval(this.pollingInterval);
        const tick = async () => {
            const meta = { token: this.activeToken, exchange: this.activeExchange };
            let quote = await this.dataFeed.fetchLiveQuote(this.activeSymbol, meta);
            const data = this.tvBridge.currentData;
            if (!data || !data.length) return;
            const last = data[data.length - 1];

            const stepSec = ({'1':60,'3':180,'5':300,'15':900,'30':1800,'60':3600,'D':86400})[this.activeTimeframe] || 900;
            const nowSec = Math.floor(Date.now() / 1000);
            const lastTs = this.tvBridge._toSec(last.time);
            const newBar = (nowSec - lastTs) >= stepSec;

            if (quote && quote.status && quote.ltp > 0) {
                if (newBar) {
                    // Roll new candle
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
            } else {
                // Fallback: gentle random walk to keep UI alive (only in simulation)
                if (this.source === 'SimulatedPro') {
                    const change = (Math.random() - 0.5) * Math.max(last.close * 0.0008, 0.5);
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
                }
            }

            const lastCandle = data[data.length - 1];
            this.tvBridge.updateTick(lastCandle);

            // Update header
            const ltp = lastCandle.close;
            const prev = this.prevClose || data[Math.max(0, data.length - 2)].close;
            const diff = ltp - prev;
            this.lastLtp = ltp;
            this.updateHeaderPrice(ltp, diff, prev);

            // Only re-run analytics on new bar (avoids re-scanning every 1.5s)
            if (newBar) this.runAllAnalytics(data);
        };
        this.pollingInterval = setInterval(tick, 1500);
        // First tick quickly
        setTimeout(tick, 400);
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
