# ProChart Terminal™ v2026.10

Professional-grade intraday charting terminal for NSE/BSE/NFO — powered by
Angel One SmartAPI, WebSocket live ticks, and AI pattern/scoring engines.

## Features

- **Real-time charts** via SmartWebSocketV2 (tick-by-tick forming candles)
- **REST fallback** with automatic reconnect and 24h scrip-master cache
- **TradingView-style UI** with stacked panes (Price | Volume | RSI | MACD)
- **Indicators**: EMA 20/50/200, SMA 50/200, Bollinger Bands, VWAP, SuperTrend, RSI 14, MACD
- **Options Greeks** calculator (Delta/Gamma/Theta/Vega/Rho/IV%) with auto-ATM
- **Master Pro Dashboard** (Squeeze, Wyckoff VSA, MACD momentum, RSI regime)
- **Institutional Scans**: Minervini VCP, Double Bottom/Top, Flags/Pennants, RSI Divergence, Order-Flow Absorption, Closing Trap (3:15-3:30 IST)
- **Big Candle detector** (live momentum alert when forming candle is ≥1.8× avg body)
- **AI Next-Candle Predictor** — 7-factor confluence score (EMA/MACD/RSI/BB/VWAP/momentum/volume) with probability & confidence
- **6-Point Breakout Checklist**
- **Search** with EQ/INDEX priority over F&O option strikes (<10ms in-memory)
- **NSE holiday calendar** (official API + fallback — accurate market-closed detection including Mahurat trading)
- **Daily 8:45 AM IST auto-refresh** of scrip master
- **Windows file-lock retry** with copy fallback

## Quick Start

```powershell
pip install -r requirements.txt
# create .env with your Angel One credentials (see .env.example)
python server.py
# then open http://127.0.0.1:8000
```

## Keyboard / Controls

- `1 3 5 15 30 1H 1D` — timeframe switch
- `Ctrl+Shift+R` — hard-refresh browser (after any code update)
- Click `⟳` — manual candle refresh
- Type in search box — auto search (350ms debounce, 1 char minimum)

## Credentials (.env)

```
ANGEL_API_KEY=your_api_key
ANGEL_CLIENT_CODE=your_client_code
ANGEL_PIN=your_pin
ANGEL_TOTP_SECRET=your_totp_base32_secret
```

## Architecture

| File | Purpose |
|---|---|
| `server.py` | FastAPI backend — Angel session, candle/quote REST, SSE tick stream |
| `live_ws.py` | SmartWebSocketV2 client — tick cache, forming-candle builder, auto-reconnect |
| `scrip_loader.py` | Streaming download + atomic save + 24h cache + daily cron |
| `nse_calendar.py` | Official NSE holiday list + Sat/Sun + Mahurat window |
| `js/tvBridge.js` | LightweightCharts v5 chart engine with synced panes |
| `js/app.js` | UI orchestration, analytics wiring, SSE consumption |
| `js/*.js` | Individual scan/indicator/predictor engines |

## Version

v2026.10 (Oct 20, 2026) — production release.
