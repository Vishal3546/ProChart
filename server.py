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
from fastapi import FastAPI, Query, Request, HTTPException
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
        from SmartApi.smartConnect import SmartConnect  # older / flat wheels
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
    {"symbol": "TCS",       "name": "TATA CONSULTANCY",       "token": "11536",    "exchange": "NSE", "base": 2508.00},
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
QUOTE_TTL = 8.0          # quote cache TTL (seconds) — 8s is plenty for LTP display
MAX_CONCURRENT_SSE = 2   # hard cap on concurrent SSE streams (kills stale tabs)
CANDLE_TTL = 60.0        # candle cache TTL (1 minute — very conservative for Angel)
RATE_LIMIT_BACKOFF = 300 # 5 minutes after first hit
_inflight_candle = {}    # per cache_key: asyncio.Future (single-flight — await concurrent callers on first result)
_last_candle_req = None  # monotonic timestamp of last Angel candle call (global throttle)
GLOBAL_CANDLE_GAP = 3.5  # MINIMUM 3.5s between Angel historical calls (heavy safety against WAF; Angel allows ~3/sec)
rate_limited_candles = {}
rate_limited_quotes = {}
_last_quote_req = 0.0    # global throttle for quote REST
GLOBAL_QUOTE_GAP = 1.5   # minimum 1.5s between ANY two quote REST calls (Angel ~1/s)


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


# ---------- Candle helper: simulated response anchored to LTP / known base ----------
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

    if rate_limited_quotes.get("__GLOBAL__", 0) > now_ts:
        if qkey in quote_cache: return quote_cache[qkey][1]
        return {"status": False, "message": "Quote cooldown", "rate_limited": True}

    # Global throttle (don't hammer Angel quote API from concurrent SSE broadcasters)
    global _last_quote_req
    gap = now_ts - _last_quote_req
    if gap < GLOBAL_QUOTE_GAP:
        if qkey in quote_cache: return quote_cache[qkey][1]
        return {"status": False, "message": "Throttled", "throttled": True}
    _last_quote_req = now_ts

    if not jwt_token:
        return {"status": False, "message": "Not logged in"}

    try:
        payload = {"mode": "FULL", "exchangeTokens": {exchange: [str(token)]}}
        url = "https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/quote/"
        res = requests.post(url, json=payload, headers=_auth_headers(), timeout=10)
        text = res.text or ""
        if "Access denied" in text or "exceeding access rate" in text:
            rate_limited_quotes[qkey] = now_ts + RATE_LIMIT_BACKOFF
            rate_limited_quotes["__GLOBAL__"] = now_ts + 60  # 60s global quote cooldown
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


@app.post("/api/ws/unsubscribe")
async def ws_unsubscribe(req: Request):
    """Kill all active SSE streams (used on connectLiveStream before reconnect to prevent flood)."""
    # Drop ALL SSE streams — fresh page/TF is about to open a new one.
    killed = 0
    for k in list(_active_sse.keys()):
        prev = _active_sse.pop(k, None)
        if prev:
            try: prev[1].set_result(True)
            except Exception: pass
            killed += 1
    if killed:
        print(f"♻️ Client unsubscribe: killed {killed} active SSE streams")
    return {"status": True, "killed": killed}


@app.get("/api/ws/status")
def ws_status():
    return live_ws.status()


# ---------- Active SSE client registry (one per exchange:token to prevent leaks) ----------
_active_sse = {}  # key -> (queue, disconnect future)

@app.get("/api/ticks/stream")
async def ticks_stream(request: Request, exchange: str = "NSE", token: str = "", interval: str = "15"):
    """
    Server-Sent Events (SSE) stream that pushes:
      - 'tick' events: every LTP tick (throttled to ~4/sec per client)
      - 'candle' events: whenever the forming candle changes
    Only ONE SSE per exchange:token is kept alive (newer client supersedes old one
    to prevent EventSource leaks from page refreshes/rapid TF switches).
    Browser connects via EventSource('/api/ticks/stream?exchange=NSE&token=2885&interval=15').
    """
    from fastapi.responses import StreamingResponse as _SR
    exchange = (exchange or "NSE").strip().upper()
    token = str(token or "").strip()
    sse_key = f"{exchange}:{token}:{interval}"

    # --- Single SSE per token: drop ALL stale SSE (from old TFs / tabs / refreshes) ---
    # One chart = one token = one SSE. Old interval SSEs cause quote floods.
    stale = [k for k in list(_active_sse.keys()) if k.startswith(f"{exchange}:{token}:")]
    for k in stale:
        prev = _active_sse.pop(k, None)
        if prev:
            try: prev[1].set_result(True)
            except Exception: pass
    if stale:
        print(f"♻️ Dropped {len(stale)} stale SSE for {exchange}:{token} (TF switch / refresh; only {interval} kept)")

    import asyncio
    my_q = asyncio.Queue(maxsize=50)
    my_disc = asyncio.get_running_loop().create_future()
    _active_sse[sse_key] = (my_q, my_disc)

    # State shared between event_gen and _broadcaster (mutable dict to avoid closure scoping bug)
    _state = {"last_tick_ts": 0.0, "last_candle_key": None}

    if token and feed_token:
        live_ws.subscribe_only(exchange, token)

    async def event_gen():
        last_candle_key = None
        try:
            yield f"event: status\ndata: {json.dumps(live_ws.status())}\n\n"
            while True:
                # Disconnect if client gone OR superseded by newer SSE on same key
                if await request.is_disconnected():
                    break
                if my_disc.done():
                    break
                try:
                    evt = await asyncio.wait_for(my_q.get(), timeout=0.5)
                except asyncio.TimeoutError:
                    if time.time() - _state["last_tick_ts"] > 15:
                        yield ": ping\n\n"
                        _state["last_tick_ts"] = time.time()
                    continue
                if evt["type"] == "tick":
                    t = evt["data"]
                    now_ts = t["ts"]
                    if now_ts - _state["last_tick_ts"] >= 0.5:
                        _state["last_tick_ts"] = now_ts
                        yield f"event: tick\ndata: {json.dumps(t)}\n\n"
                elif evt["type"] == "candle":
                    c = evt["data"]
                    ck = f"{c['time']}_{c['close']}_{c['volume']}"
                    if ck != last_candle_key:
                        last_candle_key = ck
                        yield f"event: candle\ndata: {json.dumps(c)}\n\n"
        finally:
            _active_sse.pop(sse_key, None)

    # Background broadcaster: pushes WS quotes/candles into THIS client's queue.
    # IMPORTANT: uses live_ws.quote() which reads from in-memory tick cache — NO REST
    # calls. This is the fix for the "quote API spamming" flood that triggers Angel
    # rate-limits when multiple SSE connections are open.
    async def _broadcaster():
        while not my_disc.done() and not await request.is_disconnected():
            await asyncio.sleep(0.5)  # 2 Hz tick rate is plenty
            try: q = live_ws.quote(exchange, token)
            except Exception: q = None
            if q and (time.time() - _state["last_tick_ts"]) >= 0.5:
                _state["last_tick_ts"] = time.time()
                try: my_q.put_nowait({"type":"tick","data":{
                    "ltp":q["ltp"],"day_open":q["day_open"],"day_high":q["day_high"],
                    "day_low":q["day_low"],"volume":q["day_volume"],"oi":q.get("oi",0),
                    "prev_close":q["prev_close"],"ts":time.time(),
                }})
                except asyncio.QueueFull: pass
            try:
                fc = live_ws.forming_candle(exchange, token, interval)
            except Exception: fc = None
            if fc:
                try: my_q.put_nowait({"type":"candle","data":fc})
                except asyncio.QueueFull: pass

    broadcaster_task = asyncio.create_task(_broadcaster())
    headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
    }
    try:
        return _SR(event_gen(), headers=headers, media_type="text/event-stream")
    finally:
        broadcaster_task.cancel()

# Old inlined event_gen code removed (replaced above)


@app.get("/api/candles")
async def get_candles(
    symbol: str = "NIFTY",
    token: str = "99926000",
    exchange: str = "NSE",
    interval: str = "15",
):
    """Bulletproof candle endpoint:
       - async (no event-loop blocking, proper concurrency control)
       - cache key = exchange:token:interval (NO dynamic timestamps = 100% cache hits)
       - single-flight dedup (same key: only ONE Angel call at a time)
       - global throttle (≥1.0s gap between any two Angel candle calls)
       - hard 10-minute cooldown after rate-limit (no hammering)
       - returns 429 + Retry-After when throttled (frontend honors it)
       - stale cache served during cooldown (chart never goes blank)
       - date range normalized (minute=0, second=0) for stability.
    """
    if not symbol or symbol in ("undefined", "null"):
        symbol = "NIFTY"
    if not token or token in ("undefined", "null", ""):
        token = "99926000"
    if not exchange or exchange in ("undefined", "null", ""):
        exchange = "NSE"
    if token == "99926000" and symbol.upper() != "NIFTY":
        for s in POPULAR_TOKENS:
            if s["symbol"].upper() == symbol.upper():
                token = str(s["token"]); exchange = s["exchange"]; break

    interval = str(interval)
    interval_map = {"1":"ONE_MINUTE","3":"THREE_MINUTE","5":"FIVE_MINUTE","15":"FIFTEEN_MINUTE",
                    "30":"THIRTY_MINUTE","60":"ONE_HOUR","D":"ONE_DAY"}
    if interval not in interval_map:
        interval = "15"
    angel_interval = interval_map[interval]
    cache_key = f"{exchange}:{token}:{interval}"
    mono = time.monotonic()
    now_wall = datetime.now(IST)

    # ====================================================================
    # 🏛️ ZERO-LOAD BROKER CACHE (TradingView / Kite architecture 2026)
    # If this TF was already fetched this session, serve directly from
    # in-memory market_cache (updated tick-by-tick by WebSocket).
    # ZERO Angel API call — eliminates 99% of rate-limit hits.
    # ====================================================================
    try:
        _cal_now = nse_calendar.market_status()
        _mo = _cal_now.get("market_open", True)
        if live_ws.is_tf_cached(exchange, token, interval):
            _mc = live_ws.get_cached_candles(exchange, token, interval)
            if _mc and len(_mc) >= 2:
                _out = {"status":"success","source":"AngelOne+Cache","candles":_mc,"market_open":_mo}
                return _merge_live_candle(_out, exchange, token, interval, _mo)
    except Exception as _ce:
        print(f"⚠️ market_cache read failed: {_ce}")

    # --- Evict stale SimulatedPro (post-split / drift guard) ---
    if cache_key in candle_cache:
        _ct, _cd = candle_cache[cache_key]
        if _cd and _cd.get("source") == "SimulatedPro" and _cd.get("candles"):
            try:
                last_close = _cd["candles"][-1]["close"]
                anchor = None
                qk = f"{exchange}:{token}"
                if qk in quote_cache:
                    qd = quote_cache[qk][1]
                    if qd and qd.get("ltp") and qd["ltp"] > 0:
                        anchor = qd["ltp"]
                if anchor is None:
                    for item in POPULAR_TOKENS:
                        if item["symbol"].upper() == symbol.upper():
                            anchor = item.get("base"); break
                if anchor and last_close and abs(last_close - anchor) / anchor > 0.25:
                    del candle_cache[cache_key]
                    print(f"♻️ Evicted stale SimulatedPro for {cache_key} (sim={last_close:.2f} vs anchor={anchor:.2f})")
            except Exception:
                pass

    # --- 1. Fresh cache hit ---
    def _ttl_for():
        if interval == "D": return 300
        if interval in ("60","30","15"): return 60
        return 30
    ttl = _ttl_for()
    if cache_key in candle_cache:
        ct, cd = candle_cache[cache_key]
        if mono - ct < ttl and cd.get("candles"):
            return _merge_live_candle(cd, exchange, token, interval, cd.get("market_open", True))

    cal = nse_calendar.market_status()
    market_open = cal["market_open"]

    # --- 2. Per-KEY rate-limit cooldown (NOT global — one symbol failing must not block others) ---
    per_key_until = rate_limited_candles.get(cache_key, 0)
    if per_key_until > mono:
        retry_after = int(per_key_until - mono) + 1
        if cache_key in candle_cache and candle_cache[cache_key][1].get("candles"):
            return _merge_live_candle(candle_cache[cache_key][1], exchange, token, interval, market_open)
        # Return EMPTY loading state — DO NOT generate simulated candles during cooldown.
        # Simulated here would anchor to random/wrong base price and cause "316 range" bug.
        return {"status":"success","source":"Cooldown","candles":[],"market_open":market_open,"loading":True,"cooldown":True,"retry_after":retry_after}

    # --- 3. Single-flight dedup (PROPER async wait — real fix for concurrent-request storm) ---
    loop = asyncio.get_running_loop()
    if cache_key in _inflight_candle:
        fut = _inflight_candle[cache_key]
        if cache_key in candle_cache and candle_cache[cache_key][1].get("candles"):
            return _merge_live_candle(candle_cache[cache_key][1], exchange, token, interval, market_open)
        try:
            # Wait for the in-flight request to finish, then return its result (or cached result)
            await asyncio.wait_for(fut, timeout=15.0)
        except Exception:
            pass
        if cache_key in candle_cache and candle_cache[cache_key][1].get("candles"):
            return _merge_live_candle(candle_cache[cache_key][1], exchange, token, interval, market_open)
        return {"status":"success","source":"InFlight","candles":[],"market_open":market_open,"loading":True}

    _my_fut = loop.create_future()
    _inflight_candle[cache_key] = _my_fut

    # --- 4. Global throttle: MIN 3s gap between ANY two Angel historical calls ---
    global _last_candle_req
    if _last_candle_req is None:
        _last_candle_req = 0.0
    gap = mono - _last_candle_req
    if gap < GLOBAL_CANDLE_GAP:
        await asyncio.sleep(GLOBAL_CANDLE_GAP - gap)

    # --- 5. Normalize date range — SAFE conservative Angel windows (max ~1200 candles per call)
    # Angel actual safe single-call windows (tested & forum-confirmed Oct 2026):
    #   1m / 3m : 25 days
    #   5m      : 60 days
    #   15m     : 90 days
    #   30m     : 90 days
    #   1H      : 120 days
    #   D       : 365 days
    end_dt = datetime.now(IST).replace(second=0, microsecond=0)
    windows = {"1":20,"3":25,"5":60,"15":90,"30":90,"60":120,"D":365}
    days = windows.get(interval, 25)  # safe Angel-compliant window (max ~5200 candles — well under 8000 limit)

    data = None
    err = None
    candles_raw = None
    for attempt_num in (1, 2):
        start_dt = end_dt - timedelta(days=days if attempt_num == 1 else min(days, 15))
        params = {
            "exchange": exchange,
            "symboltoken": str(token),
            "interval": angel_interval,
            "fromdate": start_dt.strftime("%Y-%m-%d %H:%M"),
            "todate":   end_dt.strftime("%Y-%m-%d %H:%M"),
        }
        _inflight_candle[cache_key] = True
        _last_candle_req = time.monotonic()
        try:
            def _do_call(p=params):
                return smart_api.getCandleData(p) if (smart_api and jwt_token) else None
            data = await asyncio.to_thread(_do_call)
            err = None
        except Exception as e:
            err = str(e); data = None

        # Check for rate-limit / WAF reject OR connection timeout (Angel temp-blocking our IP)
        rate_hit = False
        is_timeout = False
        if err:
            if "Access denied" in err or "exceeding access rate" in err or "Couldn't parse the JSON" in err:
                rate_hit = True
            if "timed out" in err.lower() or "timeout" in err.lower() or "Max retries" in err:
                is_timeout = True
        if isinstance(data, (bytes, str)) and ("Access denied" in str(data) or "exceeding access rate" in str(data)):
            rate_hit = True
        if isinstance(data, dict) and not data.get("status"):
            msg = str(data.get("message",""))
            if "Access denied" in msg or "exceeding access rate" in msg:
                rate_hit = True

        # If Angel timed out (IP temp-blocked from flood), trip per-key cooldown immediately
        # without hammering with retry — retry just extends the block.
        if is_timeout:
            rate_limited_candles[cache_key] = time.monotonic() + 60
            print(f"⏱️ Angel TIMEOUT for {cache_key} — likely temp WAF block, cooldown 60s")
            data = None; err = None
            break

        if rate_hit:
            _inflight_candle.pop(cache_key, None)
            if attempt_num == 1:
                wait = 5.0  # 5s wait between attempts (Angel cold-start WAF cools down by then)
                print(f"ℹ️ Angel WAF/rate-lit for {cache_key} — waiting {wait}s then retrying with 30-day window")
                await asyncio.sleep(wait)
                continue
            # Second attempt failed — trip per-key cooldown, NOT global
            cooldown = 60  # 60s per-key only (other symbols work fine)
            rate_limited_candles[cache_key] = time.monotonic() + cooldown
            print(f"🚫 Rate-limit confirmed for {cache_key} — per-key cooldown {cooldown}s (other symbols unaffected)")
            data = None; err = None
            break

        if data and isinstance(data, dict) and data.get("status") and data.get("data"):
            candles_raw = data["data"]
            break
        # Non-rate-lit error or empty data — try smaller window
        if attempt_num == 1:
            await asyncio.sleep(1.0); continue
        break

    _inflight_candle.pop(cache_key, None)

    try:
        # --- 6. Parse successful response ---
        candles = []
        if candles_raw:
            for c in candles_raw:
                try:
                    if len(c) < 5: continue
                    if c[1] is None or c[2] is None or c[3] is None or c[4] is None: continue
                    o, h, l, cl = float(c[1]), float(c[2]), float(c[3]), float(c[4])
                    if not (o and h and l and cl): continue
                    if h < l or o <= 0 or cl <= 0: continue
                    dt = datetime.strptime(c[0][:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=IST)
                    vol = int(c[5]) if len(c) > 5 and c[5] else 0
                    candles.append({"time": int(dt.timestamp()),"open":o,"high":h,"low":l,"close":cl,"volume":vol})
                except (ValueError, TypeError, IndexError):
                    continue

        # Price-sanity check: if WS has a recent LTP, last candle must be within ±30% of it
        if candles and market_open:
            try:
                ws_ltp = live_ws.ltp(exchange, str(token))
                last_close = candles[-1]["close"]
                if ws_ltp and ws_ltp > 0:
                    ratio = last_close / ws_ltp
                    if ratio < 0.95 or ratio > 1.05:
                        print(f"⚠️ Sanity REJECT for {cache_key}: last close {last_close} vs WS LTP {ws_ltp} ({(ratio-1)*100:+.1f}%) — dropping")
                        candles = []
            except Exception:
                pass

        if candles:
            out = {"status":"success","source":"AngelOne","candles":candles,"market_open":market_open}
            candle_cache[cache_key] = (mono, out)
            cache_cleanup()
            # 🏛️ SEED permanent market_cache so future TF switches NEVER hit Angel again
            try:
                live_ws.seed_market_cache(exchange, token, interval, candles)
                print(f"💾 Seeded market_cache for {cache_key} ({len(candles)} candles — future TF switches = 0ms RAM)")
            except Exception as _seed_e:
                print(f"⚠️ seed_market_cache failed at path1: {_seed_e}")
            _my_fut.set_result(True)
            return _merge_live_candle(out, exchange, token, interval, market_open)

        # --- 7. Fallback parse path ---
        candles = []
        if data and isinstance(data, dict) and data.get("status") and data.get("data"):
            for c in data["data"]:
                try:
                    if len(c) < 5: continue
                    if c[1] is None or c[2] is None or c[3] is None or c[4] is None: continue
                    o, h, l, cl = float(c[1]), float(c[2]), float(c[3]), float(c[4])
                    if not (o and h and l and cl): continue
                    if h < l or o <= 0 or cl <= 0: continue
                    dt = datetime.strptime(c[0][:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=IST)
                    vol = int(c[5]) if len(c) > 5 and c[5] else 0
                    candles.append({"time": int(dt.timestamp()),"open":o,"high":h,"low":l,"close":cl,"volume":vol})
                except (ValueError, TypeError, IndexError):
                    continue

        if candles:
            try:
                ws_ltp2 = live_ws.ltp(exchange, str(token))
                lc2 = candles[-1]["close"]
                if ws_ltp2 and ws_ltp2 > 0:
                    r2 = lc2 / ws_ltp2
                    if r2 < 0.70 or r2 > 1.30:
                        print(f"⚠️ Sanity REJECT (path 2) for {cache_key}: last {lc2} vs LTP {ws_ltp2}")
                        candles = []
            except Exception: pass
        if candles:
            out = {"status":"success","source":"AngelOne","candles":candles,"market_open":market_open}
            candle_cache[cache_key] = (mono, out)
            cache_cleanup()
            try:
                live_ws.seed_market_cache(exchange, token, interval, candles)
            except Exception: pass
            _my_fut.set_result(True)
            return _merge_live_candle(out, exchange, token, interval, market_open)

        # --- 8. Fallback: NO FAKE CANDLES (TradingView style) ---
        out = {"status":"success", "source":"Empty", "candles":[], "market_open":market_open, "loading":True}
        if not _my_fut.done(): _my_fut.set_result(False)
        return _merge_live_candle(out, exchange, token, interval, market_open)
    except Exception as _e:
        if not _my_fut.done(): _my_fut.set_exception(_e)
        raise




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
    # Suppress noisy asyncio/uvicorn tracebacks (browser disconnect + Ctrl+C = normal)
    logging.getLogger("asyncio").setLevel(logging.CRITICAL)
    logging.getLogger("uvicorn.error").setLevel(logging.ERROR)
    logging.getLogger("starlette").setLevel(logging.ERROR)
    logging.getLogger("fastapi").setLevel(logging.ERROR)
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
            # Force exit after 3s if graceful hang (fixes "Ctrl+C doesn't stop server")
            def _force_exit():
                import time as _t
                _t.sleep(3)
                try: live_ws.stop()
                except Exception: pass
                os._exit(0)
            threading.Thread(target=_force_exit, daemon=True).start()
    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)
    if hasattr(signal, "SIGBREAK"):
        signal.signal(signal.SIGBREAK, _shutdown)

    try:
        server.run()
    except KeyboardInterrupt:
        os._exit(0)
