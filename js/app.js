class ProChartApp {
    constructor() {
        this.dataFeed = new DataFeed();
        this.greeks = new GreeksEngine();
        this.divergence = new DivergenceEngine();
        this.breakout = new BreakoutChecklistEngine();
        this.vcp = new VCPPatternEngine();
        this.closing = new ClosingTrapEngine();
        this.masterPro = new MasterProEngine();
    }
    async init() {
        setTimeout(() => {
            document.getElementById('splashScreen').style.display = 'none';
            document.getElementById('app').style.display = 'flex';
            this.chart = new ChartEngine('mainChart');
            const data = this.dataFeed.generateData();
            this.chart.setData(data);
            this.runAnalysis(data);
        }, 1500);
    }
    runAnalysis(data) {
        // Run Master Pro
        const bb = this.masterPro.analyzeBollingerBands(data);
        document.getElementById('bbStatusText').textContent = bb.signal;
        document.getElementById('bbDetailText').textContent = bb.detail;

        const vsa = this.masterPro.analyzeVolumeSpread(data);
        document.getElementById('vsaStatusText').textContent = vsa.vsaType;
        document.getElementById('vsaDetailText').textContent = vsa.detail;

        // Run Greeks
        const lastPrice = data[data.length - 1].close;
        const g = this.greeks.calculateGreeks(lastPrice, 22500, 7/365, 0.065, 0.18, 'CE');
        document.getElementById('gDelta').textContent = g.delta;
        document.getElementById('gGamma').textContent = g.gamma;
        document.getElementById('gTheta').textContent = g.theta;
        document.getElementById('gVega').textContent = g.vega;

        // Run Breakout Checklist
        const bk = this.breakout.evaluateBullishBreakout(data, { pdh: 22600, first5mHigh: 22550 }, {});
        document.getElementById('breakoutStatusBox').textContent = bk.status;
        document.getElementById('breakoutStatusBox').style.background = bk.color + '20';

        // Run VCP & Closing
        const vcp = this.vcp.scanVCP(data);
        if (vcp.length) {
            document.getElementById('vcpStatusText').textContent = vcp[0].status;
            document.getElementById('vcpDetailText').textContent = vcp[0].description;
        }

        const cl = this.closing.analyzeClosingTrap(data, lastPrice - 10, lastPrice - 5);
        document.getElementById('btstSignalText').textContent = cl.btstSignal;
        document.getElementById('btstDetailText').textContent = cl.detail;
    }
    showToast(msg, type='info') {
        const c = document.getElementById('toastContainer');
        const t = document.createElement('div');
        t.className = `toast ${type}`;
        t.textContent = msg;
        c.appendChild(t);
        setTimeout(() => t.remove(), 3500);
    }
}

const app = new ProChartApp();
document.addEventListener('DOMContentLoaded', () => app.init());