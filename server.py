import os
import requests
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()
app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

scrip_master = []
SCRIP_MASTER_URL = "https://margincalculator.angelbroking.com/OpenAPI_Data/files/OpenAPIScripMaster.json"

@app.on_event("startup")
def startup_event():
    global scrip_master
    print("🚀 Downloading Angel One Scrip Master (Please wait 5-10 seconds)...")
    try:
        res = requests.get(SCRIP_MASTER_URL, timeout=20)
        if res.status_code == 200:
            raw = res.json()
            # LOAD ALL NSE EQUITY + BSE EQUITY
            for s in raw:
                exch = s.get("exch_seg", "")
                sym = s.get("symbol", "")
                name = s.get("name", "")
                if (exch == "NSE" and sym.endswith("-EQ")) or (exch == "BSE"):
                    scrip_master.append({
                        "symbol": sym.replace("-EQ", ""),
                        "name": name,
                        "token": s.get("token", ""),
                        "exchange": exch
                    })
            print(f"✅ SUCCESS! Loaded {len(scrip_master)} Stocks from Angel One.")
    except Exception as e:
        print(f"⚠️ Failed to load Scrip Master: {e}")

@app.get("/api/search")
def search(q: str = Query("", min_length=1)):
    query = q.strip().upper()
    results = []
    
    for s in scrip_master:
        if query in s["symbol"].upper() or query in s["name"].upper():
            results.append(s)
            if len(results) >= 50: # Give top 50 results
                break
                
    return {"results": results}

@app.get("/api/status")
def status():
    return {"status": "online", "symbols_loaded": len(scrip_master)}

@app.get("/api/candles")
def mock_candles(symbol: str="NIFTY"):
    # Keeping simulated fallback for UI testing if credentials not set
    import time, random
    base = 1500 if symbol != "NIFTY" else 22500
    now = int(time.time() * 1000)
    step = 15 * 60 * 1000
    candles = []
    p = base
    for i in range(150, 0, -1):
        change = (random.random() - 0.48) * (base * 0.002)
        o = p
        c = o + change
        h = max(o, c) + random.random() * base * 0.001
        l = min(o, c) - random.random() * base * 0.001
        candles.append({"time": now - i * step, "open": o, "high": h, "low": l, "close": c, "volume": int(100000 + random.random()*500000)})
        p = c
    return {"status": "success", "candles": candles}