# ProChart Terminal™ v2026.10

> **Advanced AI & Institutional Trading Terminal** — Angel One SmartAPI + Lightweight Charts + a battery of institutional pattern & options engines.

ProChart Terminal™ is a professional, high-performance web-based financial charting and market-analysis platform built for active NSE / BSE / NFO traders.

---

## ✨ Features (v2026.10)

- **Real-time Angel One SmartAPI** candlestick & quote streaming (with smart fallback to simulated data when not logged in).
- **Interactive charting** powered by TradingView's Lightweight Charts v5 with multi-timeframe support (1m / 3m / 5m / 15m / 30m / 1H / 1D).
- **Institutional indicators**:
  - SMA, EMA (20/50/200)
  - Bollinger Bands (with %b / squeeze detection)
  - RSI 14, MACD (12,26,9), VWAP (session-anchored IST 9:15 AM)
  - ATR, SuperTrend (10,3)
- **AI / Institutional Pattern Engines** (all wired to the live sidebar and signal feed):
  - 🕯 Candlestick patterns (Hammer, Shooting Star, Engulfing, Morning/Evening Star, Doji) — swing-context aware
  - 👑 Master Pro Dashboard — Bollinger Squeeze, Wyckoff VSA, MACD acceleration, RSI regime
  - ✅ 6-Point Breakout Checklist (EMA stack, 20-bar BO, volume, RSI, strong close)
  - 🛡 Mark Minervini **VCP** (volatility contraction pattern with volume dry-up)
  - 💠 **Double Bottom / Double Top** (W & M patterns with measured move targets)
  - 🚩 **Bull / Bear Flags & Pennants** (impulse + tight counter-trend channel)
  - 🔀 **RSI Divergence** (bullish / bearish swing pivots)
  - 🕒 **3:25 PM Closing Trap** (late-day institutional exhaustion, IST-aware)
  - 🧽 **Order-Flow Absorption** (exhaustion / climax / rejection candles)
- **Options Greeks** — real **Black–Scholes–Merton** calculator (Δ, Γ, Θ-per-day, ν-per-1%-IV, ρ).
- **Live connection badge** — clearly shows whether data is LIVE (Angel One) or SIMULATED.
- **Live Signal Feed** (sidebar) — timestamped alerts from every engine.
- **Cyber-Dark Theme** with Inter + JetBrains Mono typography, smooth flash-on-tick animations, toast notifications.
- **Security-hardened backend**: binds to `127.0.0.1` only, CORS locked to localhost, static UI served directly from FastAPI.

---

## 🚀 Quick Start

### 1. Clone & install

```bash
git clone https://github.com/Vishal3546/ProChart.git
cd ProChart

python -m venv .venv
# Windows:  .venv\Scripts\activate
# Linux/Mac: source .venv/bin/activate

pip install -r requirements.txt
```

### 2. (Optional) Configure Angel One credentials

Copy `.env.example` to `.env` and fill in your Angel One SmartAPI key, client code, PIN, and TOTP secret:

```
ANGEL_API_KEY=your_api_key
ANGEL_CLIENT_CODE=ABCD1234
ANGEL_PIN=123456
ANGEL_TOTP_SECRET=BASE32SECRET
```

If you skip this, the terminal still works perfectly with a realistic simulated feed.

### 3. Run the server

```bash
python server.py
# or: uvicorn server:app --host 127.0.0.1 --port 8000
```

Now open **http://127.0.0.1:8000** in Chrome / Edge / Firefox. That's it.

> The first launch downloads the ~35 MB Angel One scrip master automatically (cached locally).

---

## 📁 Project Structure

```
ProChart/
├── index.html                    # Main terminal UI
├── server.py                     # FastAPI backend (Angel One bridge)
├── requirements.txt              # Python dependencies
├── .env.example                  # Sample credential file
├── scripMaster.json              # (downloaded at first run) — Angel One instrument master
├── css/
│   └── styles.css                # Design system (cyber-dark theme)
└── js/
    ├── app.js                    # Main controller
    ├── tvBridge.js               # Lightweight Charts v5 wrapper
    ├── dataFeed.js               # API client (relative URLs + file:// fallback)
    ├── indicators.js             # SMA/EMA/RSI/MACD/VWAP/BB/ATR/SuperTrend/StDev
    ├── candlePatterns.js         # Hammer/Engulfing/Star/Doji
    ├── masterProEngine.js        # Squeeze/VSA/MACD/RSI regime aggregator
    ├── breakoutChecklistEngine.js# 6-point institutional breakout checklist
    ├── vcpPatternEngine.js       # Minervini VCP
    ├── doubleBottomEngine.js     # Double Bottom / Double Top
    ├── flagPatternEngine.js      # Bull/Bear flags & pennants
    ├── divergenceEngine.js       # RSI bullish/bearish divergence
    ├── closingTrapEngine.js      # 3:15–3:30 PM IST trap detector
    ├── orderFlowAbsorptionEngine.js  # Absorption / climax / rejection
    ├── greeksEngine.js           # Black-Scholes-Merton Greeks calculator
    └── preMarketEngine.js        # Pivot-point helper
```

---

## 🔒 Security Notes

- Backend binds to **127.0.0.1** only (not reachable from LAN/internet).
- CORS is locked to `localhost` / `127.0.0.1`; `allow_credentials` is disabled.
- Credentials live in `.env` (never committed).
- The scrip master is downloaded over HTTPS on first run and cached locally.

---

## 🛠️ Tech Stack

- **Frontend**: Vanilla HTML5/CSS3/ES6+ JavaScript, Lightweight Charts v5.2.1, Font Awesome, Google Fonts (Inter + JetBrains Mono).
- **Backend**: Python 3.10+ with FastAPI + Uvicorn, SmartAPI Python SDK for Angel One.
- **Analytics**: Custom pure-JS technical-indicator library (no external numerics dependency).

---

## 📄 License

MIT
