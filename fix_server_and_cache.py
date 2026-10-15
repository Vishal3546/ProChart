# ============================================
# ProChart Terminal™ - Scrip Cache & 422 Fix
# Local Disk Caching + Query Validation Fix + Undefined Guard
# ============================================

import os

server_code = """import os
import json
import time
import requests
import pyotp
import random
from datetime import datetime, timedelta
from dotenv import load_dotenv
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from SmartApi import SmartConnect

load_dotenv()

API_KEY = os.getenv("ANGEL_API_KEY", "")
CLIENT_CODE = os.getenv("ANGEL_CLIENT_CODE", "")
PIN = os.getenv("ANGEL_PIN", "")
TOTP_SECRET = os.getenv("ANGEL_TOTP_SECRET", "")

app = FastAPI(title="ProChart Terminal Engine")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

smart_api = None
session_data = None
scrip_master = []
SCRIP_CACHE_FILE = "scrip_master_cache.json"
SCRIP_MASTER_URL = "https://margincalculator.angelbroking.com/OpenAPI_Data/files/OpenAPIScripMaster.json"

POPULAR_TOKENS = [
    {"symbol": "NIFTY", "name": "NIFTY 50 INDEX", "token": "99926000", "exchange": "NSE"},
    {"symbol": "BANKNIFTY", "name": "BANK NIFTY INDEX", "token": "99926009", "exchange": "NSE"},
    {"symbol": "RELIANCE", "name": "RELIANCE INDUSTRIES", "token": "2885", "exchange": "NSE"},
    {"symbol": "HDFCBANK", "name": "HDFC BANK LTD", "token": "1333", "exchange": "NSE"},
    {"symbol": "TCS", "name": "TATA CONSULTANCY SERV LT", "token": "11536", "exchange": "NSE"},
    {"symbol": "INFY", "name": "INFOSYS LTD", "token": "1594", "exchange": "NSE"},
    {"symbol": "SBIN", "name": "STATE BANK OF INDIA", "token": "3045", "exchange": "NSE"},
    {"symbol": "TATAMOTORS", "name": "TATA MOTORS LIMITED", "token": "3456", "exchange": "NSE"},
    {"symbol": "ICICIBANK", "name": "ICICI BANK LTD", "token": "4963", "exchange": "NSE"},
    {"symbol": "ITC", "name": "ITC LIMITED", "token": "1660", "exchange": "NSE"}
]

@app.on_event("startup")
def startup_event():
    global smart_api, session_data, scrip_master
    
    # 1. INSTANT LOCAL DISK CACHE CHECK (Fast Startup!)
    if os.path.exists(SCRIP_CACHE_FILE) and (time.time() - os.path.getmtime(SCRIP_CACHE_FILE) < 86400):
        print("⚡ Loading Scrip Master from Local Cache (Instant 0.1s)...")
        try:
            with open(SCRIP_CACHE_FILE, "r", encoding="utf-8") as f:
                scrip_master = json.load(f)
            print(f"✅ INSTANT SUCCESS! Loaded {len(scrip_master)} Symbols from Cache.")
        except Exception as e:
            print("⚠️ Cache read error, fetching fresh online data...")

    # 2. ONLINE DOWNLOAD (Only if Cache not present)
    if not scrip_master:
        print("📥 Downloading Angel One Scrip Master (One-time setup)...")
        try:
            res = requests.get(SCRIP_MASTER_URL, timeout=30)
            if res.status_code == 200:
                raw = res.json()
                scrip_master = []
                for s in raw:
                    exch = s.get("exch_seg", "")
                    sym = s.get("symbol", "")
                    name = s.get("name", "")
                    if (exch == "NSE" and sym.endswith("-EQ")) or (exch == "BSE"):
                        scrip_master.append({
                            "symbol": sym.replace("-EQ", ""),
                            "name": name,
                            "token": str(s.get("token", "")),
                            "exchange": exch
                        })
                # Save Cache File
                with open(SCRIP_CACHE_FILE, "w", encoding="utf-8") as f:
                    json.dump(scrip_master, f)
                print(f"✅ DOWNLOAD SUCCESS! Saved {len(scrip_master)} Stocks to Local Cache.")
        except Exception as e:
            print(f"⚠️ Scrip Master Download Error: {e}")

    # 3. SmartAPI Login
    if API_KEY and CLIENT_CODE and PIN and TOTP_SECRET and API_KEY != "your_smartapi_key_here":
        try:
            totp = pyotp.TOTP(TOTP_SECRET).now()
            smart_api = SmartConnect(api_key=API_KEY)
            session_data = smart_api.generateSession(CLIENT_CODE, PIN, totp)
            if session_data and session_data.get("status"):
                print("✅ Angel One Login SUCCESSFUL! SmartAPI Connected.")
        except Exception as e:
            print("⚠️ SmartAPI Login Error:", e)

@app.get("/")
def root():
    return {"status": "online", "scrip_count": len(scrip_master)}

@app.get("/api/status")
def status():
    return {
        "status": "online",
        "angel_connected": smart_api is not None and session_data is not None and session_data.get("status", False),
        "symbols_count": len(scrip_master)
    }

@app.get("/api/search")
def search(q: str = ""):  # FIXED: Removed min_length=1 to prevent 422 Error
    query = q.strip().upper()
    if not query:
        return {"results": POPULAR_TOKENS}

    results = []
    # Fast Search
    for s in scrip_master:
        if query in s["symbol"].upper() or query in s["name"].upper():
            results.append(s)
            if len(results) >= 40:
                break

    return {"results": results}

@app.get("/api/candles")
def get_candles(symbol: str = "NIFTY", token: str = "99926000", exchange: str = "NSE", interval: str = "15"):
    # FIXED: Guard against 'undefined' string parameters
    if not symbol or symbol == "undefined":
        symbol = "NIFTY"
    if not token or token == "undefined":
        token = "99926000"

    is_live = smart_api is not None and session_data is not None and session_data.get("status", False)
    
    if is_live:
        try:
            interval_map = {"1":"ONE_MINUTE", "3":"THREE_MINUTE", "5":"FIVE_MINUTE", "15":"FIFTEEN_MINUTE", "30":"THIRTY_MINUTE", "60":"ONE_HOUR", "D":"ONE_DAY"}
            smart_int = interval_map.get(str(interval), "FIFTEEN_MINUTE")
            to_date = datetime.now()
            from_date = to_date - timedelta(days=30 if smart_int != "ONE_DAY" else 365)
            
            res = smart_api.getCandleData({
                "exchange": exchange, "symboltoken": str(token), "interval": smart_int,
                "fromdate": from_date.strftime("%Y-%m-%d %H:%M"), "todate": to_date.strftime("%Y-%m-%d %H:%M")
            })
            if res and res.get("status") and res.get("data"):
                candles = []
                for c in res["data"]:
                    dt = datetime.strptime(c[0][:19], "%Y-%m-%dT%H:%M:%S")
                    candles.append({"time": int(dt.timestamp() * 1000), "open": float(c[1]), "high": float(c[2]), "low": float(c[3]), "close": float(c[4]), "volume": int(c[5])})
                if candles:
                    return {"status": "success", "source": "AngelOne", "candles": candles}
        except Exception as e:
            print("⚠️ Candle fetch exception:", e)

    # High Fidelity Fallback Simulation
    base = POPULAR_TOKENS[0]["base"] if symbol == "NIFTY" else 1500.0
    now = int(time.time() * 1000)
    step = 15 * 60 * 1000
    candles = []
    p = base
    for i in range(160, 0, -1):
        change = (random.random() - 0.48) * (base * 0.0015)
        o = p
        c = o + change
        h = max(o, c) + random.random() * base * 0.0008
        l = min(o, c) - random.random() * base * 0.0008
        v = int(100000 + random.random() * 500000)
        candles.append({"time": now - i * step, "open": round(o, 2), "high": round(h, 2), "low": round(l, 2), "close": round(c, 2), "volume": v})
        p = c
    return {"status": "success", "source": "SimulatedPro", "candles": candles}
"""

with open("server.py", "w", encoding="utf-8") as f:
    f.write(server_code.strip())

print("✅ FIX APPLIED SUCCESSFULLY!")
print("1. Local Caching added (scrip_master_cache.json)")
print("2. Search 422 Error Fixed")
print("3. Undefined parameter guard added")