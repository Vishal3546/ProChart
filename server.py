# ============================================
# ProChart Terminal™ - Backend v2026 Production
# Fixes: Lifespan API, IST Timezone, Session Auto-Refresh, Quote API, Options Filter
# ============================================

import os
import json
import time
import asyncio
import requests
import pyotp
import random
import socket
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from dotenv import load_dotenv
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from SmartApi import SmartConnect

load_dotenv()

API_KEY = os.getenv("ANGEL_API_KEY", "")
CLIENT_CODE = os.getenv("ANGEL_CLIENT_CODE", "")
PIN = os.getenv("ANGEL_PIN", "")
TOTP_SECRET = os.getenv("ANGEL_TOTP_SECRET", "")

IST = timezone(timedelta(hours=5, minutes=30))

smart_api = None
session_data = None
jwt_token = None
scrip_master = []
SCRIP_FILE = "scripMaster.json"

POPULAR_TOKENS = [
    {"symbol": "NIFTY", "name": "NIFTY 50 INDEX", "token": "99926000", "exchange": "NSE", "base": 22548.16},
    {"symbol": "BANKNIFTY", "name": "BANK NIFTY INDEX", "token": "99926009", "exchange": "NSE", "base": 48200.50},
    {"symbol": "FINNIFTY", "name": "FIN NIFTY INDEX", "token": "99926037", "exchange": "NSE", "base": 23100.00},
    {"symbol": "SENSEX", "name": "SENSEX INDEX", "token": "99919000", "exchange": "BSE", "base": 74200.00},
    {"symbol": "EMIL", "name": "ELECTRONICS MART INDIA LTD", "token": "19409", "exchange": "NSE", "base": 215.40},
    {"symbol": "PRAKASH", "name": "PRAKASH INDUSTRIES LTD", "token": "2741", "exchange": "NSE", "base": 185.80},
    {"symbol": "RELIANCE", "name": "RELIANCE INDUSTRIES LTD", "token": "2885", "exchange": "NSE", "base": 2950.00},
    {"symbol": "HDFCBANK", "name": "HDFC BANK LTD", "token": "1333", "exchange": "NSE", "base": 1450.25},
    {"symbol": "TCS", "name": "TATA CONSULTANCY SERV LT", "token": "11536", "exchange": "NSE", "base": 3980.10},
    {"symbol": "INFY", "name": "INFOSYS LTD", "token": "1594", "exchange": "NSE", "base": 1520.45},
    {"symbol": "SBIN", "name": "STATE BANK OF INDIA", "token": "3045", "exchange": "NSE", "base": 780.30},
    {"symbol": "TATAMOTORS", "name": "TATA MOTORS LIMITED", "token": "3456", "exchange": "NSE", "base": 950.60},
    {"symbol": "TATASTEEL", "name": "TATA STEEL LIMITED", "token": "3499", "exchange": "NSE", "base": 160.20},
    {"symbol": "ICICIBANK", "name": "ICICI BANK LTD", "token": "4963", "exchange": "NSE", "base": 1080.70}
]

def get_local_ip():
    try: return socket.gethostbyname(socket.gethostname())
    except: return "127.0.0.1"

def get_mac():
    return ":".join(["{:02x}".format((uuid.getnode() >> i) & 0xff) for i in range(0,48,8)][::-1])

def load_local_scrip_master():
    global scrip_master
    if os.path.exists(SCRIP_FILE):
        try:
            with open(SCRIP_FILE, "r", encoding="utf-8") as f:
                raw = json.load(f)
                scrip_master = []
                for s in raw:
                    exch = s.get("exch_seg", "")
                    sym = str(s.get("symbol", ""))
                    name = str(s.get("name", ""))
                    token = str(s.get("token", ""))
                    # Audit Fix: Allow Options (NFO/BFO) + Equity + Indices for Greeks feature
                    if exch in ["NSE", "BSE", "INDICES"] and (sym.endswith("-EQ") or exch == "INDICES"):
                        scrip_master.append({
                            "symbol": sym.replace("-EQ", ""),
                            "symbol_upper": sym.replace("-EQ", "").upper(),
                            "name_upper": name.upper(),
                            "name": name,
                            "token": token,
                            "exchange": exch,
                            "type": "EQ" if sym.endswith("-EQ") else "INDEX"
                        })
                    elif exch in ["NFO", "BFO", "MCX", "CDS"]:
                        scrip_master.append({
                            "symbol": sym,
                            "symbol_upper": sym.upper(),
                            "name_upper": name.upper(),
                            "name": name,
                            "token": token,
                            "exchange": exch,
                            "type": "OPT_FUT"
                        })
            print(f"✅ Loaded {len(scrip_master)} Instruments (EQ+INDEX+OPT+FUT)")
            return True
        except Exception as e:
            print(f"⚠️ Cache read error: {e}")
    return False

def download_scrip_master_stream():
    global scrip_master
    print("📥 Downloading Angel One Scrip Master...")
    headers = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}
    url = "https://margincalculator.angelone.in/OpenAPI_Data/files/OpenAPIScripMaster.json"
    try:
        res = requests.get(url, headers=headers, stream=True, timeout=120)
        if res.status_code == 200:
            with open(SCRIP_FILE, "wb") as f:
                for chunk in res.iter_content(chunk_size=1024*1024):
                    if chunk: f.write(chunk)
            print("✅ Stream Download Complete!")
            load_local_scrip_master()
    except Exception as e:
        print(f"⚠️ Download error: {e}")

def login_smart_api():
    global smart_api, session_data, jwt_token
    if not (API_KEY and CLIENT_CODE and PIN and TOTP_SECRET and API_KEY != "your_smartapi_key_here"):
        return False
    try:
        totp = pyotp.TOTP(TOTP_SECRET).now()
        smart_api = SmartConnect(api_key=API_KEY)
        session_data = smart_api.generateSession(CLIENT_CODE, PIN, totp)
        if session_data and session_data.get("status"):
            jwt_token = session_data["data"]["jwtToken"]
            print("✅ Angel One Login SUCCESSFUL!")
            return True
    except Exception as e:
        print(f"⚠️ Login Error: {e}")
    return False

async def session_refresh_task():
    """Audit Fix: Auto re-login every 23 hours to prevent silent 24hr expiry"""
    while True:
        await asyncio.sleep(23 * 3600)
        print("🔄 Auto-refreshing Angel One Session (23hr cycle)...")
        login_smart_api()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Audit Fix: Modern lifespan replaces deprecated on_event("startup")
    if not (os.path.exists(SCRIP_FILE) and load_local_scrip_master()):
        download_scrip_master_stream()
    login_smart_api()
    task = asyncio.create_task(session_refresh_task())
    yield
    task.cancel()

app = FastAPI(title="ProChart Terminal Engine v2026", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

@app.get("/")
def root():
    return {"status": "online", "scrip_count": len(scrip_master) or len(POPULAR_TOKENS)}

@app.get("/api/status")
def status():
    return {
        "status": "online",
        "angel_connected": smart_api is not None and jwt_token is not None,
        "symbols_count": len(scrip_master) or len(POPULAR_TOKENS)
    }

@app.get("/api/search")
def search(q: str = ""):
    query = q.strip().upper()
    if not query:
        return {"results": POPULAR_TOKENS}

    results = []
    seen_tokens = set()
    for s in POPULAR_TOKENS:
        if query in s["symbol"].upper() or query in s["name"].upper():
            results.append(s)
            seen_tokens.add(s["token"])

    # Audit Fix: Use precomputed symbol_upper + set-based dedup
    if scrip_master:
        for s in scrip_master:
            if query in s["symbol_upper"] or query in s["name_upper"]:
                if s["token"] not in seen_tokens:
                    results.append({
                        "symbol": s["symbol"],
                        "name": s["name"],
                        "token": s["token"],
                        "exchange": s["exchange"]
                    })
                    seen_tokens.add(s["token"])
                if len(results) >= 40:
                    break
    return {"results": results}

# Audit Fix: Candle cache with TTL + size limit (memory leak fix)
candle_cache = {}
MAX_CACHE_SIZE = 50

def cache_cleanup():
    if len(candle_cache) > MAX_CACHE_SIZE:
        oldest = sorted(candle_cache.items(), key=lambda x: x[1][0])[:len(candle_cache) - MAX_CACHE_SIZE]
        for k, _ in oldest:
            del candle_cache[k]

@app.get("/api/quote")
def get_quote(exchange: str = "NSE", token: str = "99926000"):
    """Audit Fix: Real-time LTP quote from Angel One for live ticks"""
    if not jwt_token:
        return {"status": False, "message": "Not logged in"}
    try:
        headers = {
            "Authorization": f"Bearer {jwt_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-UserType": "USER",
            "X-SourceID": "WEB",
            "X-ClientLocalIP": get_local_ip(),
            "X-ClientPublicIP": get_local_ip(),
            "X-MACAddress": get_mac(),
            "X-PrivateKey": API_KEY
        }
        payload = {"mode": "FULL", "exchangeTokens": {exchange: [str(token)]}}
        url = "https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/quote/"
        res = requests.post(url, json=payload, headers=headers, timeout=10)
        data = res.json()
        if data.get("status") and data.get("data", {}).get("fetched"):
            q = data["data"]["fetched"][0]
            return {
                "status": True,
                "ltp": q.get("ltp", 0),
                "open": q.get("open", 0),
                "high": q.get("high", 0),
                "low": q.get("low", 0),
                "close": q.get("close", 0),
                "volume": q.get("tradeVolume", 0),
                "netChange": q.get("netChange", 0),
                "percentChange": q.get("percentChange", 0)
            }
    except Exception as e:
        print(f"⚠️ Quote fetch error: {e}")
    return {"status": False, "message": "Fetch failed"}

@app.get("/api/candles")
def get_candles(symbol: str = "NIFTY", token: str = "99926000", exchange: str = "NSE", interval: str = "15"):
    if not symbol or symbol in ["undefined", "null"]: symbol = "NIFTY"
    if not token or token in ["undefined", "null"]: token = "99926000"
    if not exchange or exchange in ["undefined", "null"]: exchange = "NSE"

    cache_key = f"{token}_{interval}"
    now_ts = time.time()

    if cache_key in candle_cache:
        cached_time, cached_data = candle_cache[cache_key]
        if now_ts - cached_time < 3.0:
            return cached_data

    is_live = smart_api is not None and jwt_token is not None

    if is_live:
        try:
            interval_map = {
                "1": "ONE_MINUTE", "3": "THREE_MINUTE", "5": "FIVE_MINUTE",
                "15": "FIFTEEN_MINUTE", "30": "THIRTY_MINUTE", "60": "ONE_HOUR", "D": "ONE_DAY"
            }
            smart_int = interval_map.get(str(interval), "FIFTEEN_MINUTE")
            to_date = datetime.now(IST)
            from_date = to_date - timedelta(days=30 if smart_int != "ONE_DAY" else 500)

            res = smart_api.getCandleData({
                "exchange": exchange,
                "symboltoken": str(token),
                "interval": smart_int,
                "fromdate": from_date.strftime("%Y-%m-%d %H:%M"),
                "todate": to_date.strftime("%Y-%m-%d %H:%M")
            })
            if res and isinstance(res, dict) and res.get("status") and res.get("data"):
                candles = []
                for c in res["data"]:
                    # Audit Fix: IST timezone-aware parsing
                    dt = datetime.strptime(c[0][:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=IST)
                    candles.append({
                        "time": int(dt.timestamp() * 1000),
                        "open": float(c[1]), "high": float(c[2]),
                        "low": float(c[3]), "close": float(c[4]),
                        "volume": int(c[5]) if len(c) > 5 and c[5] else 0
                    })
                if candles:
                    out = {"status": "success", "source": "AngelOne", "candles": candles}
                    candle_cache[cache_key] = (now_ts, out)
                    cache_cleanup()
                    return out
        except Exception as e:
            print(f"⚠️ Candle Fetch Exception: {e}")

    # Audit Fix: Dynamic interval step
    interval_ms_map = {"1": 60000, "3": 180000, "5": 300000, "15": 900000,
                       "30": 1800000, "60": 3600000, "D": 86400000}
    step = interval_ms_map.get(str(interval), 900000)

    base = 22548.16
    for item in POPULAR_TOKENS:
        if item["symbol"].upper() == symbol.upper():
            base = item.get("base", 1500.0)
            break

    start_time = int(time.time() * 1000) - (160 * step)
    candles = []
    p = base
    for i in range(160):
        change = (random.random() - 0.48) * (base * 0.0015)
        o = p
        c = o + change
        h = max(o, c) + random.random() * base * 0.0008
        l = min(o, c) - random.random() * base * 0.0008
        v = int(100000 + random.random() * 500000)
        candles.append({
            "time": start_time + i * step,
            "open": round(o, 2), "high": round(h, 2),
            "low": round(l, 2), "close": round(c, 2),
            "volume": v
        })
        p = c
    out = {"status": "success", "source": "SimulatedPro", "candles": candles}
    candle_cache[cache_key] = (now_ts, out)
    cache_cleanup()
    return out