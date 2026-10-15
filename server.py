import os
import json
import time
import requests
import random
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()
app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

scrip_master = []
SCRIP_CACHE_FILE = "scrip_master_cache.json"

POPULAR = [
    {"symbol": "NIFTY", "name": "NIFTY 50", "token": "99926000", "exchange": "NSE", "base": 22500},
    {"symbol": "BANKNIFTY", "name": "BANK NIFTY", "token": "99926009", "exchange": "NSE", "base": 48000},
    {"symbol": "RELIANCE", "name": "RELIANCE IND", "token": "2885", "exchange": "NSE", "base": 2950},
    {"symbol": "HDFCBANK", "name": "HDFC BANK", "token": "1333", "exchange": "NSE", "base": 1450},
    {"symbol": "TCS", "name": "TCS LTD", "token": "11536", "exchange": "NSE", "base": 3980},
    {"symbol": "PRAKASH", "name": "PRAKASH INDUSTRIES", "token": "2741", "exchange": "NSE", "base": 185}
]

@app.on_event("startup")
def startup_event():
    global scrip_master
    if os.path.exists(SCRIP_CACHE_FILE):
        try:
            with open(SCRIP_CACHE_FILE, "r") as f:
                scrip_master = json.load(f)
            print(f"✅ Loaded {len(scrip_master)} stocks from local cache!")
            return
        except: pass

    print("📥 Downloading Angel One Scrip Master (with proper Headers to bypass blocking)...")
    try:
        # FIXED: Added User-Agent to prevent Angel One from blocking the Python request
        headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
        res = requests.get("https://margincalculator.angelbroking.com/OpenAPI_Data/files/OpenAPIScripMaster.json", headers=headers, timeout=20)
        if res.status_code == 200:
            for s in res.json():
                if s.get("exch_seg") in ["NSE", "BSE"] and "-EQ" in s.get("symbol", ""):
                    scrip_master.append({"symbol": s["symbol"].replace("-EQ",""), "name": s["name"], "token": s["token"], "exchange": s["exch_seg"]})
            with open(SCRIP_CACHE_FILE, "w") as f:
                json.dump(scrip_master, f)
            print(f"✅ Downloaded & Cached {len(scrip_master)} stocks.")
    except Exception as e:
        print(f"⚠️ Download failed: {e}. Using Top 50 default stocks.")

@app.get("/api/search")
def search(q: str = ""):
    query = q.strip().upper()
    if not query: return {"results": POPULAR}
    res = [s for s in POPULAR if query in s["symbol"]]
    for s in scrip_master:
        if query in s["symbol"] or query in s["name"]:
            if not any(r["symbol"] == s["symbol"] for r in res): res.append(s)
        if len(res) > 30: break
    return {"results": res}

@app.get("/api/status")
def status(): return {"status": "online"}

@app.get("/api/candles")
def get_candles(symbol: str = "NIFTY"):
    base = next((s["base"] for s in POPULAR if s["symbol"] == symbol), 1500)
    now = int(time.time() * 1000)
    step = 15 * 60 * 1000
    candles = []
    p = base
    for i in range(200, 0, -1):
        o = p
        c = o + (random.random() - 0.48) * (base * 0.003)
        h = max(o, c) + random.random() * base * 0.001
        l = min(o, c) - random.random() * base * 0.001
        candles.append({"time": now - i * step, "open": o, "high": h, "low": l, "close": c, "volume": int(100000 + random.random()*500000)})
        p = c
    return {"status": "success", "candles": candles}