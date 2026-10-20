# ============================================
# ProChart Terminal™ - Backend v2026.10 Production
# Fixes (Oct 2026):
#  - Bind to 127.0.0.1 only (security hardening)
#  - CORS tightened to localhost
#  - Static file serving so a single `uvicorn server:app` serves the UI
#  - IST timezone aware
#  - Lifespan API (modern FastAPI)
#  - Angel One SmartAPI session auto-refresh (23h)
#  - Quote + Candle endpoints with proper token/exchange routing
#  - Scrip master download/stream/cache
#  - Bounded candle cache (no memory leak)
# ============================================

import os
import json
import time
import asyncio
import socket
import uuid
import random
import threading
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import requests
import pyotp
from dotenv import load_dotenv
from fastapi import FastAPI, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, RedirectResponse, Response, StreamingResponse

# Professional scrip master loader (streaming download w/ progress, atomic save, daily 8:45 AM IST refresh)
from scrip_loader import (
    start_background_tasks as start_scrip_background,
    refresh_master as refresh_scrip_master,
    search as scrip_search,
    ready as scrip_ready,
    count as scrip_count,
    INDEX_FILE as SCRIP_INDEX_FILE,
    SCRIP_FILE as SCRIP_RAW_FILE,
)

# Live WebSocket client (SmartWebSocketV2, auto-reconnect, tick cache, forming candle builder)
from live_ws import live_ws, ex_type as ws_ex_type

# NSE holiday calendar (fetches official NSE list + fallback for Sat/Sun/holidays)
from nse_calendar import nse_calendar

# SmartApi SDK — try both capitalizations; graceful fallback if not installed.
# smartapi-python 1.5.5 ships as "SmartApi" (case-sensitive) on all platforms.
try:
    try:
        from SmartApi.smartConnect import SmartConnect  # canonical (1.5.5)
    except ImportError:
        from smartapi.smartConnect import SmartConnect  # older / flat wheels
except ImportError:
    SmartConnect = None

load_dotenv()

API_KEY = os.getenv("ANGEL_API_KEY", "")
CLIENT_CODE = os.getenv("ANGEL_CLIENT_CODE", "")
PIN = os.getenv("ANGEL_PIN", "")
TOTP_SECRET = os.getenv("ANGEL_TOTP_SECRET", "")

IST = timezone(timedelta(hours=5, minutes=30))

smart_api = None
session_data = None
jwt_token = None
feed_token = None
STATIC_DIR = os.path.dirname(os.path.abspath(__file__))

# Popular / featured tokens — only used as candle-simulation fallback & empty-query popular list
POPULAR_TOKENS = [
    {"symbol": "NIFTY",     "name": "NIFTY 50 INDEX",         "token": "99926000", "exchange": "NSE", "base": 22548.16},
    {"symbol": "BANKNIFTY", "name": "BANK NIFTY INDEX",       "token": "99926009", "exchange": "NSE", "base": 48200.50},
    {"symbol": "FINNIFTY",  "name": "FIN NIFTY INDEX",        "token": "99926037", "exchange": "NSE", "base": 23100.00},
    {"symbol": "SENSEX",    "name": "SENSEX INDEX",           "token": "99919000", "exchange": "BSE", "base": 74200.00},
    {"symbol": "RELIANCE",  "name": "RELIANCE INDUSTRIES",    "token": "2885",     "exchange": "NSE", "base": 2950.00},
    {"symbol": "HDFCBANK",  "name": "HDFC BANK LTD",          "token": "1333",     "exchange": "NSE", "base": 1450.25},
    {"symbol": "TCS",       "name": "TATA CONSULTANCY",       "token": "11536",    "exchange": "NSE", "base": 3980.10},
    {"symbol": "INFY",      "name": "INFOSYS LTD",            "token": "1594",     "exchange": "NSE", "base": 1520.45},
    {"symbol": "SBIN",      "name": "STATE BANK OF INDIA",    "token": "3045",     "exchange": "NSE", "base": 780.30},
    {"symbol": "TATASTEEL", "name": "TATA STEEL",             "token": "3499",     "exchange": "NSE", "base": 160.20},
    {"symbol": "ICICIBANK", "name": "ICICI BANK LTD",         "token": "4963",     "exchange": "NSE", "base": 1080.70},
    {"symbol": "BHARTIARTL","name": "BHARTI AIRTEL",          "token": "10999",    "exchange": "NSE", "base": 1650.00},
    {"symbol": "LT",        "name": "LARSEN & TOUBRO",        "token": "11483",    "exchange": "NSE", "base": 3700.00},
    {"symbol": "AXISBANK",  "name": "AXIS BANK",              "token": "5900",     "exchange": "NSE", "base": 1180.00},
    {"symbol": "ITC",       "name": "ITC LTD",                "token": "16675",    "exchange": "NSE", "base": 490.00},
    {"symbol": "HINDUNILVR","name": "HINDUSTAN UNILEVER",     "token": "1394",     "exchange": "NSE", "base": 2560.00},
    {"symbol": "MARUTI",    "name": "MARUTI SUZUKI",          "token": "13538",    "exchange": "NSE", "base": 11500.00},
    {"symbol": "ADANIENT",  "name": "ADANI ENTERPRISES",      "token": "694",      "exchange": "NSE", "base": 2400.00},
    {"symbol": "WIPRO",     "name": "WIPRO LTD",              "token": "3450",     "exchange": "NSE", "base": 520.00},
    {"symbol": "TECHM",     "name": "TECH MAHINDRA",          "token": "13538",    "exchange": "NSE", "base": 1520.00},
    {"symbol": "BAJFINANCE","name": "BAJAJ FINANCE",          "token": "11532",    "exchange": "NSE", "base": 6800.00},
    {"symbol": "ASIANPAINT","name": "ASIAN PAINTS",           "token": "236",      "exchange": "NSE", "base": 2900.00},
    {"symbol": "SUNPHARMA", "name": "SUN PHARMA",             "token": "16675",    "exchange": "NSE", "base": 1800.00},
    {"symbol": "ONGC",      "name": "OIL & NATURAL GAS",      "token": "2475",     "exchange": "NSE", "base": 260.00},
    {"symbol": "NTPC",      "name": "NTPC LTD",               "token": "20374",    "exchange": "NSE", "base": 370.00},
    {"symbol": "KOTAKBANK", "name": "KOTAK MAHINDRA BANK",    "token": "1922",     "exchange": "NSE", "base": 1780.00},
]


def get_local_ip():
    try:
        return socket.gethostbyname(socket.gethostname())
    except Exception:
        return "127.0.0.1"


def get_mac():
    return ":".join("{:02x}".format((uuid.getnode() >> i) & 0xff) for i in range(0, 48, 8))[::-1]


def login_smart_api():
    global smart_api, session_data, jwt_token, feed_token
    if SmartConnect is None:
        print("⚠️ SmartApi SDK not installed; running in simulated-only mode.")
        return False
    if not (API_KEY and CLIENT_CODE and PIN and TOTP_SECRET and API_KEY != "your_smartapi_key_here"):
        print("⚠️ Angel One credentials missing in .env; running in simulated-only mode.")
        return False
    try:
        totp = pyotp.TOTP(TOTP_SECRET).now()
        smart_api = SmartConnect(api_key=API_KEY)
        session_data = smart_api.generateSession(CLIENT_CODE, PIN, totp)
        if session_data and session_data.get("status"):
            jwt_token = session_data["data"]["jwtToken"]
            refreshToken = session_data["data"].get("refreshToken", "")
            # Feed token is required for WS V2. Some accounts return it directly,
            # others need a separate getfeedToken() call.
            ft = session_data["data"].get("feedToken")
            if not ft:
                try:
                    ft_res = smart_api.getfeedToken()
                    if isinstance(ft_res, dict) and ft_res.get("status"):
                        ft = ft_res["data"].get("feedToken")
                except Exception as e:
                    print(f"⚠️ getfeedToken() failed: {e}")
            feed_token = ft or ""
            print("✅ Angel One Login SUCCESSFUL!")
            # Start (or refresh) live WebSocket with fresh tokens
            if feed_token:
                live_ws.start(API_KEY, CLIENT_CODE, jwt_token, feed_token, mode=2)
                print("🔌 WebSocket starting (mode=2: Quote)...")
            else:
                print("⚠️ No feed_token received — WS disabled this session")
            return True
        print(f"⚠️ Angel One login failed: {session_data}")
    except Exception as e:
        print(f"⚠️ Login Error: {e}")
    return False


async def session_refresh_task():
    """Auto re-login every 23 hours to prevent silent 24hr expiry."""
    while True:
        await asyncio.sleep(23 * 3600)
        print("🔄 Auto-refreshing Angel One Session (23hr cycle)...")
        login_smart_api()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Start professional scrip-master background service:
    #  - instant load from local cache if present
    #  - streaming download with MB progress in terminal
    #  - atomic .part → final rename (no corrupt files)
    #  - daily 8:45 AM IST auto-refresh (Mon-Fri)
    #  - 3 retries with backoff on failure
    start_scrip_background()
    login_smart_api()
    task = asyncio.create_task(session_refresh_task())
    try:
        yield
    finally:
        task.cancel()
        live_ws.stop()
        print("🔌 WebSocket stopped")


app = FastAPI(title="ProChart Terminal Engine v2026.10", lifespan=lifespan)

# Security: only trust local origins; never `allow_origins=["*"]` with credentials
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8000",
        "http://127.0.0.1:8000",
        "http://localhost",
        "http://127.0.0.1",
        "null",  # for file:// testing
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# ---------- Static files (serve the UI directly from FastAPI) ----------
# Add cache-busting headers so dev changes aren't hidden behind 304 caching
@app.middleware("http")
async def no_cache_for_dev(request: Request, call_next):
    response: Response = await call_next(request)
    path = request.url.path
    if path.endswith((".js", ".css", ".html")) or path == "/":
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

app.mount("/css", StaticFiles(directory=os.path.join(STATIC_DIR, "css")), name="css")
app.mount("/js", StaticFiles(directory=os.path.join(STATIC_DIR, "js")), name="js")


@app.get("/favicon.ico")
@app.get("/favicon.svg")
def favicon():
    # Prefer SVG if user placed logo/favicon.svg, else .ico, else 204
    candidates = [
        "logo/favicon.svg", "favicon.svg",
        "logo/favicon.ico", "favicon.ico",
    ]
    for p in candidates:
        fp = os.path.join(STATIC_DIR, p)
        if os.path.exists(fp) and os.path.getsize(fp) > 50:
            return FileResponse(fp)
    return Response(status_code=204)

@app.get("/")
def root():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.get("/api/status")
def status():
    now_ist = datetime.now(IST)
    cal = nse_calendar.market_status()
    market_open = cal["market_open"]
    ws_stat = live_ws.status()
    return {
        "status": "online",
        "angel_connected": bool(smart_api and jwt_token),
        "ws": ws_stat,
        "symbols_count": scrip_count(),
        "scrip_loaded": scrip_ready(),
        "server_time": now_ist.strftime("%Y-%m-%d %H:%M:%S IST"),
        "market_open": market_open,
        "market_reason": cal["reason"],
        "is_holiday": cal["is_holiday"],
        "pre_open": cal.get("pre_open", False),
        "date": cal["date"],
        "weekday": cal["weekday"],
    }


@app.get("/api/search")
def search(q: str = "", type_filter: str = ""):
    """
    TradingView-style relevance-ranked search.
    Backed by professional scrip_loader:
      - Angel One OpenAPIScripMaster.json (correct angelone.in URL)
      - Stream-downloaded w/ progress, atomically saved
      - Daily 8:45 AM IST refresh
      - Local cache for instant startup
    """
    query = (q or "").strip()

    # Empty query → curated popular indices + large-caps (never empty)
    if not query:
        pop_syms = {p["symbol"].upper() for p in POPULAR_TOKENS}
        live = scrip_search("") or []
        # Merge popular tokens in case index hasn't loaded
        featured = [s for s in live if s["symbol"].upper() in pop_syms]
        if len(featured) < len(POPULAR_TOKENS):
            have = {f["symbol"].upper() for f in featured}
            for p in POPULAR_TOKENS:
                if p["symbol"].upper() not in have:
                    featured.append({"symbol": p["symbol"], "name": p["name"], "token": p["token"],
                                     "exchange": p["exchange"], "type": "INDEX" if "INDEX" in p["name"] else "EQ"})
                    have.add(p["symbol"].upper())
        return {"results": featured[:30], "loaded": scrip_ready(), "count": scrip_count()}

    results = scrip_search(query, limit=20)
    if results is None:
        # Index not loaded yet → graceful
        return {"results": [], "loaded": False, "message": "Stock list loading, try again in a few seconds..."}
    return {"results": results, "loaded": True, "count": scrip_count()}


@app.post("/api/admin/refresh_scrip")
def refresh_scrip():
    """Admin endpoint: force fresh scrip master download (runs in background)."""
    def _bg():
        ok = refresh_scrip_master(force=True)
        print(f"[admin] Force refresh {'OK' if ok else 'FAILED'}")
    threading.Thread(target=_bg, daemon=True).start()
    return {"status": "started", "count": scrip_count()}


# ---------- Candle cache with TTL + size limit + rate-limit backoff ----------
candle_cache = {}
quote_cache = {}
MAX_CACHE_SIZE = 50
QUOTE_TTL = 2.5          # quote cache TTL (seconds) — prevents hammering every poll
CANDLE_TTL = 5.0         # candle cache TTL
RATE_LIMIT_BACKOFF = 45  # after rate-limit, wait 45s before retrying
rate_limited_candles = {}
rate_limited_quotes = {}


def cache_cleanup():
    now = time.time()
    if len(candle_cache) > MAX_CACHE_SIZE:
        oldest = sorted(candle_cache.items(), key=lambda x: x[1][0])[: len(candle_cache) - MAX_CACHE_SIZE]
        for k, _ in oldest:
            del candle_cache[k]
    if len(quote_cache) > MAX_CACHE_SIZE * 2:
        oldest_q = sorted(quote_cache.items(), key=lambda x: x[1][0])[: len(quote_cache) - MAX_CACHE_SIZE * 2]
        for k, _ in oldest_q:
            del quote_cache[k]
    for d in (rate_limited_candles, rate_limited_quotes):
        for k in list(d.keys()):
            if d[k] < now:
                del d[k]


def _auth_headers():
    return {
        "Authorization": f"Bearer {jwt_token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "X-UserType": "USER",
        "X-SourceID": "WEB",
        "X-ClientLocalIP": get_local_ip(),
        "X-ClientPublicIP": get_local_ip(),
        "X-MACAddress": get_mac(),
        "X-PrivateKey": API_KEY,
    }


@app.get("/api/quote")
def get_quote(exchange: str = "NSE", token: str = "99926000", symbol: str = ""):
    """Real-time LTP quote. Accepts exchange+token (preferred) or falls back to symbol lookup."""
    exchange = (exchange or "NSE").strip()
    token = str(token or "").strip()

    if not token and symbol:
        for s in POPULAR_TOKENS:
            if s["symbol"].upper() == symbol.upper():
                exchange, token = s["exchange"], str(s["token"])
                break
    if not token:
        return {"status": False, "message": "No token resolved"}

    qkey = f"{exchange}:{token}"
    now_ts = time.time()

    # Rate-limit backoff: if Angel One blocked us recently, don't hammer
    if rate_limited_quotes.get(qkey, 0) > now_ts:
        # Return cache if present, else fail
        if qkey in quote_cache:
            ct, cd = quote_cache[qkey]
            return cd
        return {"status": False, "message": "Rate limited (backoff)", "rate_limited": True}

    # Serve fresh cached quote if within TTL
    if qkey in quote_cache:
        ct, cd = quote_cache[qkey]
        if now_ts - ct < QUOTE_TTL:
            return cd

    if not jwt_token:
        return {"status": False, "message": "Not logged in"}

    try:
        payload = {"mode": "FULL", "exchangeTokens": {exchange: [str(token)]}}
        url = "https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/quote/"
        res = requests.post(url, json=payload, headers=_auth_headers(), timeout=10)
        text = res.text or ""
        if "Access denied" in text or "exceeding access rate" in text:
            rate_limited_quotes[qkey] = now_ts + RATE_LIMIT_BACKOFF
            print(f"⚠️ Quote rate-limited for {qkey}, backoff {RATE_LIMIT_BACKOFF}s")
            if qkey in quote_cache:
                return quote_cache[qkey][1]
            return {"status": False, "message": "Rate limited", "rate_limited": True}
        data = res.json()
        if data.get("status") and data.get("data", {}).get("fetched"):
            q = data["data"]["fetched"][0]
            out = {
                "status": True,
                "ltp": float(q.get("ltp", 0) or 0),
                "open": float(q.get("open", 0) or 0),
                "high": float(q.get("high", 0) or 0),
                "low": float(q.get("low", 0) or 0),
                "close": float(q.get("close", 0) or 0),
                "volume": int(q.get("tradeVolume", 0) or 0),
                "netChange": float(q.get("netChange", 0) or 0),
                "percentChange": float(q.get("percentChange", 0) or 0),
            }
            quote_cache[qkey] = (now_ts, out)
            cache_cleanup()
            return out
    except Exception as e:
        print(f"⚠️ Quote fetch error: {e}")
    return {"status": False, "message": "Fetch failed"}


# ------------- LIVE WEBSOCKET ENDPOINTS -------------

@app.post("/api/ws/subscribe")
async def ws_subscribe(req: Request):
    """Tell the backend Angel WS to subscribe to exactly one token (for current chart)."""
    try:
        body = await req.json()
    except Exception:
        body = {}
    exchange = (body.get("exchange") or "NSE").strip().upper()
    token = str(body.get("token") or "").strip()
    if not token:
        return {"status": False, "message": "token required"}
    if not feed_token:
        return {"status": False, "message": "WS not available (check login/feedToken)", "ws": live_ws.status()}
    live_ws.subscribe_only(exchange, token)
    return {"status": True, "ws": live_ws.status()}


@app.get("/api/ws/status")
def ws_status():
    return live_ws.status()


@app.get("/api/ticks/stream")
async def ticks_stream(exchange: str = "NSE", token: str = "", interval: str = "15"):
    """
    Server-Sent Events (SSE) stream that pushes:
      - 'tick' events: every LTP tick (throttled to ~5/sec per client)
      - 'candle' events: whenever the forming candle changes (so the chart can update without polling)
    Browser connects via EventSource('/api/ticks/stream?exchange=NSE&token=2885&interval=15').
    """
    from fastapi.responses import StreamingResponse as _SR
    exchange = (exchange or "NSE").strip().upper()
    token = str(token or "").strip()
    et = ws_ex_type(exchange)

    async def event_gen():
        last_tick_ts = 0.0
        last_candle_key = None
        # Send initial status immediately so browser knows stream is alive
        yield f"event: status\ndata: {json.dumps(live_ws.status())}\n\n"
        # Kick off subscription if not yet done
        if token and feed_token:
            live_ws.subscribe(exchange, token)
        # Poll loop (non-blocking via asyncio.sleep)
        while True:
            await asyncio.sleep(0.2)  # 5 Hz throttle
            # Tick updates
            q = live_ws.quote(exchange, token)
            now_ts = time.time()
            if q and (now_ts - last_tick_ts) >= 0.25:
                last_tick_ts = now_ts
                payload = {
                    "ltp": q["ltp"], "day_open": q["day_open"],
                    "day_high": q["day_high"], "day_low": q["day_low"],
                    "volume": q["day_volume"], "oi": q.get("oi", 0),
                    "prev_close": q["prev_close"],
                    "ts": now_ts,
                }
                yield f"event: tick\ndata: {json.dumps(payload)}\n\n"
            # Forming candle updates (only when changed)
            fc = live_ws.forming_candle(exchange, token, interval)
            if fc:
                ck = f"{fc['time']}_{fc['close']}_{fc['volume']}"
                if ck != last_candle_key:
                    last_candle_key = ck
                    yield f"event: candle\ndata: {json.dumps(fc)}\n\n"

    headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    return _SR(event_gen(), headers=headers, media_type="text/event-stream")


@app.get("/api/candles")
def get_candles(
    symbol: str = "NIFTY",
    token: str = "99926000",
    exchange: str = "NSE",
    interval: str = "15",
):
    if not symbol or symbol in ("undefined", "null"):
        symbol = "NIFTY"
    if not token or token in ("undefined", "null", ""):
        token = "99926000"
    if not exchange or exchange in ("undefined", "null", ""):
        exchange = "NSE"

    # Try to resolve token/exchange from symbol if not provided
    if token == "99926000" and symbol.upper() != "NIFTY":
        for s in POPULAR_TOKENS:
            if s["symbol"].upper() == symbol.upper():
                token = str(s["token"])
                exchange = s["exchange"]
                break

    interval = str(interval)
    cache_key = f"{exchange}:{token}_{interval}"
    now_ts = time.time()

    # Market hours helper (NSE): Mon-Fri 09:15-15:30 IST
    now_ist = datetime.now(IST)
    cal = nse_calendar.market_status()
    market_open = cal["market_open"]

    # Serve cached data with TTL: longer TTL when market is closed or rate-limited
    if cache_key in candle_cache:
        cached_time, cached_data = candle_cache[cache_key]
        ttl = CANDLE_TTL if market_open else 999999  # after close, freeze forever
        if rate_limited_candles.get(cache_key, 0) > now_ts:
            return cached_data  # during backoff always serve cache
        if now_ts - cached_time < ttl:
            return cached_data

    is_live = bool(smart_api and jwt_token)
    live_ok = False
    if is_live and rate_limited_candles.get(cache_key, 0) <= now_ts:
        try:
            interval_map = {
                "1": "ONE_MINUTE", "3": "THREE_MINUTE", "5": "FIVE_MINUTE",
                "15": "FIFTEEN_MINUTE", "30": "THIRTY_MINUTE", "60": "ONE_HOUR", "D": "ONE_DAY",
            }
            smart_int = interval_map.get(interval, "FIFTEEN_MINUTE")
            to_date = now_ist
            # Candle history per TF (TradingView-style enough bars to fill screen)
            history_days = {
                "ONE_MINUTE": 5,       # ~375 bars
                "THREE_MINUTE": 10,    # ~1250 bars /3 = ~400
                "FIVE_MINUTE": 15,     # ~1125 bars
                "FIFTEEN_MINUTE": 30,  # ~450 bars
                "THIRTY_MINUTE": 60,   # ~450 bars
                "ONE_HOUR": 120,       # ~900 bars (4 months)
                "ONE_DAY": 730,        # ~500 bars (2 years)
            }.get(smart_int, 30)
            from_date = to_date - timedelta(days=history_days)

            res = smart_api.getCandleData({
                "exchange": exchange,
                "symboltoken": str(token),
                "interval": smart_int,
                "fromdate": from_date.strftime("%Y-%m-%d %H:%M"),
                "todate": to_date.strftime("%Y-%m-%d %H:%M"),
            })
            err_msg = ""
            if isinstance(res, dict) and not res.get("status"):
                err_msg = str(res.get("message", ""))
            # Detect plain-string rate-limit (SmartApi sometimes returns raw string)
            if isinstance(res, str) and ("Access denied" in res or "exceeding access rate" in res):
                err_msg = res
            if "Access denied" in err_msg or "exceeding access rate" in err_msg:
                rate_limited_candles[cache_key] = now_ts + RATE_LIMIT_BACKOFF
                print(f"⚠️ Candle rate-limited for {cache_key}, backoff {RATE_LIMIT_BACKOFF}s")
                if cache_key in candle_cache:
                    return candle_cache[cache_key][1]
            if res and isinstance(res, dict) and res.get("status") and res.get("data"):
                candles = []
                for c in res["data"]:
                    try:
                        if len(c) < 5: continue
                        if c[1] is None or c[2] is None or c[3] is None or c[4] is None: continue
                        o, h, l, cl = float(c[1]), float(c[2]), float(c[3]), float(c[4])
                        if not (o and h and l and cl): continue
                        if h < l or o <= 0 or cl <= 0: continue
                        dt = datetime.strptime(c[0][:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=IST)
                        vol = int(c[5]) if len(c) > 5 and c[5] else 0
                        candles.append({
                            "time": int(dt.timestamp()),
                            "open": o, "high": h, "low": l, "close": cl,
                            "volume": vol,
                        })
                    except (ValueError, TypeError, IndexError):
                        continue
                if candles:
                    out = {"status": "success", "source": "AngelOne", "candles": candles,
                           "market_open": market_open}
                    candle_cache[cache_key] = (now_ts, out)
                    cache_cleanup()
                    live_ok = True
                    return _merge_live_candle(out, exchange, token, interval, market_open)
        except Exception as e:
            msg = str(e)
            if "Access denied" in msg or "exceeding access rate" in msg:
                rate_limited_candles[cache_key] = now_ts + RATE_LIMIT_BACKOFF
                print(f"⚠️ Candle rate-limit (exception) for {cache_key}: {msg}")
                if cache_key in candle_cache:
                    return candle_cache[cache_key][1]
            print(f"⚠️ Candle Fetch Exception: {e}")

    # ---- Fallback: simulated realistic random walk ----
    # When market is closed or we already have a cached simulated snapshot, keep serving that
    # (no random jitter after hours — matches "frozen close" expectation).
    if cache_key in candle_cache:
        cached_time, cached_data = candle_cache[cache_key]
        # If cached and market closed / rate limited / live failed → reuse
        if cached_data and cached_data.get("candles"):
            if not market_open or cached_data.get("source") == "SimulatedPro":
                return cached_data

    interval_ms_map = {"1": 60, "3": 180, "5": 300, "15": 900, "30": 1800, "60": 3600, "D": 86400}
    step_s = interval_ms_map.get(interval, 900)

    base = 22548.16
    for item in POPULAR_TOKENS:
        if item["symbol"].upper() == symbol.upper():
            base = item.get("base", 1500.0)
            break

    count = 160
    end_ts = int(now_ts)
    end_ts = end_ts - (end_ts % step_s)
    start_time = end_ts - (count - 1) * step_s

    # When market is closed, produce a frozen close bar instead of random drift
    jitter = market_open  # True = random walk, False = flat at base
    candles = []
    p = base
    for i in range(count):
        if jitter:
            change = (random.random() - 0.5) * (base * 0.0018) * (1 + 0.3 * random.random())
        else:
            change = 0
        o = p
        c = o + change
        if jitter:
            h = max(o, c) + random.random() * base * 0.0007
            l = min(o, c) - random.random() * base * 0.0007
        else:
            h = max(o, c) + base * 0.0001
            l = min(o, c) - base * 0.0001
        v = int(100000 + (random.random() * 600000 if jitter else 0))
        candles.append({
            "time": int(start_time + i * step_s),
            "open": round(o, 2),
            "high": round(h, 2),
            "low": round(l, 2),
            "close": round(c, 2),
            "volume": v,
        })
        p = c

    out = {"status": "success", "source": "SimulatedPro", "candles": candles,
           "market_open": market_open}
    candle_cache[cache_key] = (now_ts, out)
    cache_cleanup()
    return _merge_live_candle(out, exchange, token, interval, market_open)


def _merge_live_candle(out: dict, exchange: str, token: str, interval: str, market_open: bool):
    """
    If the WebSocket has a forming candle for this exchange/token/tf, merge it onto the
    last historical candle (or append a new one if history is one bar behind).
    This makes the REST candle response itself reflect live WS data without requiring
    the frontend to wait for SSE.
    """
    if not out or not out.get("candles") or not market_open:
        return out
    try:
        fc = live_ws.forming_candle(exchange, token, interval)
        if not fc:
            return out
        cs = out["candles"]
        last = cs[-1]
        if last.get("time") == fc["time"]:
            # Same bucket → update last candle with live forming OHLCV
            last["open"] = fc["open"]
            last["high"] = max(last.get("high", fc["high"]), fc["high"])
            last["low"] = min(last.get("low", fc["low"]), fc["low"])
            last["close"] = fc["close"]
            # Volume from forming-candle is delta-vol since bucket start; add to prior close volume if any
            last["volume"] = int(fc["volume"] or last.get("volume", 0))
        elif fc["time"] > last.get("time", 0):
            # New bucket (history hasn't caught up yet) → append
            cs.append({
                "time": fc["time"], "open": fc["open"], "high": fc["high"],
                "low": fc["low"], "close": fc["close"], "volume": int(fc["volume"]),
            })
        out["candles"] = cs
        out["ws_live"] = True
    except Exception as e:
        print(f"⚠️ merge live candle failed: {e}")
    return out


if __name__ == "__main__":
    import uvicorn, logging, sys, signal, threading
    # On Windows, force SelectorEventLoop to avoid ProactorPipeTransport stack traces.
    # Python 3.14+ deprecates set_event_loop_policy; ProactorEventLoop is default, so only
    # apply on older Pythons where the Proactor bug exists.
    if sys.platform == "win32" and sys.version_info < (3, 14):
        try:
            asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
        except Exception:
            pass
    # Suppress noisy asyncio/uvicorn tracebacks (browser disconnect = normal)
    logging.getLogger("asyncio").setLevel(logging.CRITICAL)
    for _log in ("uvicorn.error", "uvicorn.access", "uvicorn"):
        logging.getLogger(_log).handlers = []  # reset; let uvicorn configure

    # Quiet ConnectionResetError spam on Windows proactor fallback
    def _quiet_asyncio_exc(loop, ctx):
        msg = ctx.get("message", "")
        exc = ctx.get("exception")
        if isinstance(exc, ConnectionResetError):
            return
        if isinstance(exc, OSError) and getattr(exc, "winerror", None) == 10054:
            return
        loop.default_exception_handler(ctx)
    try:
        loop = asyncio.new_event_loop()
        loop.set_exception_handler(_quiet_asyncio_exc)
        asyncio.set_event_loop(loop)
    except Exception:
        pass

    config = uvicorn.Config(app, host="127.0.0.1", port=8000, log_level="info",
                            loop="asyncio", access_log=True)
    server = uvicorn.Server(config)

    # Ensure clean Ctrl+C shutdown on Windows
    def _shutdown(*_a):
        if server.started and not server.should_exit:
            server.should_exit = True
            # Force exit after 4s if graceful hang
            def _force_exit():
                import time as _t
                _t.sleep(4)
                os._exit(0)
            threading.Thread(target=_force_exit, daemon=True).start()
    signal.signal(signal.SIGINT, _shutdown)
    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, _shutdown)

    try:
        server.run()
    except KeyboardInterrupt:
        os._exit(0)
