# ============================================
# ProChart Terminal™ - Backend v2026.10
# ============================================

import os
import json
import time
import asyncio
import socket
import uuid
import random
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone

import requests
import pyotp
from dotenv import load_dotenv
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

try:
    try:
        from SmartApi.smartConnect import SmartConnect
    except ImportError:
        from SmartApi.smartConnect import SmartConnect
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
scrip_master = []
SCRIP_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scripMaster.json")
STATIC_DIR = os.path.dirname(os.path.abspath(__file__))

POPULAR_TOKENS = [
    {"symbol": "NIFTY",     "name": "NIFTY 50 INDEX",        "token": "99926000", "exchange": "NSE", "base": 22548.16},
    {"symbol": "BANKNIFTY", "name": "BANK NIFTY INDEX",      "token": "99926009", "exchange": "NSE", "base": 48200.50},
    {"symbol": "FINNIFTY",  "name": "FIN NIFTY INDEX",       "token": "99926037", "exchange": "NSE", "base": 23100.00},
    {"symbol": "SENSEX",    "name": "SENSEX INDEX",          "token": "99919000", "exchange": "BSE", "base": 74200.00},
    {"symbol": "RELIANCE",  "name": "RELIANCE INDUSTRIES",   "token": "2885",     "exchange": "NSE", "base": 2950.00},
    {"symbol": "HDFCBANK",  "name": "HDFC BANK LTD",         "token": "1333",     "exchange": "NSE", "base": 1450.25},
    {"symbol": "TCS",       "name": "TATA CONSULTANCY",      "token": "11536",    "exchange": "NSE", "base": 3980.10},
    {"symbol": "INFY",      "name": "INFOSYS LTD",           "token": "1594",     "exchange": "NSE", "base": 1520.45},
    {"symbol": "SBIN",      "name": "STATE BANK OF INDIA",   "token": "3045",     "exchange": "NSE", "base": 780.30},
    {"symbol": "TATAMOTORS","name": "TATA MOTORS",           "token": "3456",     "exchange": "NSE", "base": 950.60},
    {"symbol": "TATASTEEL", "name": "TATA STEEL",            "token": "3499",     "exchange": "NSE", "base": 160.20},
    {"symbol": "ICICIBANK", "name": "ICICI BANK LTD",        "token": "4963",     "exchange": "NSE", "base": 1080.70},
]


def get_local_ip():
    try:
        return socket.gethostbyname(socket.gethostname())
    except Exception:
        return "127.0.0.1"


def get_mac():
    return ":".join("{:02x}".format((uuid.getnode() >> i) & 0xff) for i in range(0, 48, 8))[::-1]


def load_local_scrip_master():
    global scrip_master
    if not os.path.exists(SCRIP_FILE):
        return False
    try:
        with open(SCRIP_FILE, "r", encoding="utf-8") as f:
            raw = json.load(f)
        scrip_master = []
        for s in raw:
            exch = s.get("exch_seg", "")
            sym = str(s.get("symbol", ""))
            name = str(s.get("name", ""))
            token = str(s.get("token", ""))
            inst_type = s.get("instrumenttype", "")

            if exch in ("NSE", "BSE") and (sym.endswith("-EQ") or inst_type in ("AMXIDX",)):
                scrip_master.append({
                    "symbol": sym.replace("-EQ", ""),
                    "symbol_upper": sym.replace("-EQ", "").upper(),
                    "name_upper": name.upper(),
                    "name": name,
                    "token": token,
                    "exchange": "NSE" if inst_type == "AMXIDX" and exch == "NSE" else exch,
                    "type": "INDEX" if inst_type == "AMXIDX" else "EQ",
                })
            elif exch in ("NFO", "BFO", "MCX", "CDS"):
                scrip_master.append({
                    "symbol": sym,
                    "symbol_upper": sym.upper(),
                    "name_upper": name.upper(),
                    "name": name,
                    "token": token,
                    "exchange": exch,
                    "type": "OPT_FUT",
                })
        print(f"✅ Loaded {len(scrip_master)} Instruments")
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
            tmp = SCRIP_FILE + ".tmp"
            with open(tmp, "wb") as f:
                for chunk in res.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        f.write(chunk)
            os.replace(tmp, SCRIP_FILE)
            print("✅ Download Complete!")
            load_local_scrip_master()
    except Exception as e:
        print(f"⚠️ Download error: {e}")


def login_smart_api():
    global smart_api, session_data, jwt_token
    if SmartConnect is None:
        print("⚠️ SmartApi SDK not installed; simulated-only mode.")
        return False
    if not (API_KEY and CLIENT_CODE and PIN and TOTP_SECRET and API_KEY != "your_smartapi_key_here"):
        print("⚠️ Angel One credentials missing in .env; simulated-only mode.")
        return False
    try:
        totp = pyotp.TOTP(TOTP_SECRET).now()
        smart_api = SmartConnect(api_key=API_KEY)
        session_data = smart_api.generateSession(CLIENT_CODE, PIN, totp)
        if session_data and session_data.get("status"):
            jwt_token = session_data["data"]["jwtToken"]
            print("✅ Angel One Login SUCCESSFUL!")
            return True
        print(f"⚠️ Login failed: {session_data}")
    except Exception as e:
        print(f"⚠️ Login Error: {e}")
    return False


async def session_refresh_task():
    while True:
        await asyncio.sleep(23 * 3600)
        print("🔄 Auto-refreshing Angel One session...")
        login_smart_api()


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not (os.path.exists(SCRIP_FILE) and load_local_scrip_master()):
        download_scrip_master_stream()
    login_smart_api()
    task = asyncio.create_task(session_refresh_task())
    try:
        yield
    finally:
        task.cancel()


app = FastAPI(title="ProChart Terminal v2026.10", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:8000", "http://127.0.0.1:8000",
        "http://localhost", "http://127.0.0.1", "null",
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

app.mount("/css", StaticFiles(directory=os.path.join(STATIC_DIR, "css")), name="css")
app.mount("/js",  StaticFiles(directory=os.path.join(STATIC_DIR, "js")),  name="js")


@app.get("/")
def root():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


@app.get("/favicon.ico")
def favicon():
    f = os.path.join(STATIC_DIR, "favicon.ico")
    if os.path.exists(f):
        return FileResponse(f, media_type="image/x-icon")
    return FileResponse(os.path.join(STATIC_DIR, "index.html"), status_code=204)


@app.get("/api/status")
def status():
    return {
        "status": "online",
        "angel_connected": bool(smart_api and jwt_token),
        "symbols_count": len(scrip_master) or len(POPULAR_TOKENS),
        "server_time": datetime.now(IST).strftime("%Y-%m-%d %H:%M:%S IST"),
    }


@app.get("/api/search")
def search(q: str = ""):
    query = q.strip().upper()
    if not query:
        return {"results": POPULAR_TOKENS}
    results, seen = [], set()
    for s in POPULAR_TOKENS:
        if query in s["symbol"].upper() or query in s["name"].upper():
            results.append(s)
            seen.add(f"{s['exchange']}:{s['token']}")
    if scrip_master:
        for s in scrip_master:
            if query in s["symbol_upper"] or query in s["name_upper"]:
                key = f"{s['exchange']}:{s['token']}"
                if key in seen:
                    continue
                results.append({
                    "symbol": s["symbol"], "name": s["name"],
                    "token": s["token"], "exchange": s["exchange"],
                    "type": s.get("type", "EQ"),
                })
                seen.add(key)
                if len(results) >= 50:
                    break
    return {"results": results}


candle_cache = {}
MAX_CACHE_SIZE = 50


def cache_cleanup():
    if len(candle_cache) > MAX_CACHE_SIZE:
        oldest = sorted(candle_cache.items(), key=lambda x: x[1][0])[:len(candle_cache) - MAX_CACHE_SIZE]
        for k, _ in oldest:
            del candle_cache[k]


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
    exchange = (exchange or "NSE").strip()
    token = str(token or "").strip()
    if not token and symbol:
        for s in POPULAR_TOKENS:
            if s["symbol"].upper() == symbol.upper():
                exchange, token = s["exchange"], str(s["token"])
                break
    if not token:
        return {"status": False, "message": "No token resolved"}
    if not jwt_token:
        return {"status": False, "message": "Not logged in"}
    try:
        payload = {"mode": "FULL", "exchangeTokens": {exchange: [str(token)]}}
        url = "https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/quote/"
        res = requests.post(url, json=payload, headers=_auth_headers(), timeout=10)
        data = res.json()
        if data.get("status") and data.get("data", {}).get("fetched"):
            q = data["data"]["fetched"][0]
            return {
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
    except Exception as e:
        print(f"⚠️ Quote fetch error: {e}")
    return {"status": False, "message": "Fetch failed"}


@app.get("/api/candles")
def get_candles(symbol: str = "NIFTY", token: str = "99926000", exchange: str = "NSE", interval: str = "15"):
    if not symbol or symbol in ("undefined", "null"): symbol = "NIFTY"
    if not token or token in ("undefined", "null", ""): token = "99926000"
    if not exchange or exchange in ("undefined", "null", ""): exchange = "NSE"
    interval = str(interval)

    if token == "99926000" and symbol.upper() != "NIFTY":
        for s in POPULAR_TOKENS:
            if s["symbol"].upper() == symbol.upper():
                token, exchange = str(s["token"]), s["exchange"]
                break

    cache_key = f"{exchange}:{token}_{interval}"
    now_ts = time.time()
    if cache_key in candle_cache:
        ct, cd = candle_cache[cache_key]
        if now_ts - ct < 3.0:
            return cd

    is_live = bool(smart_api and jwt_token)
    if is_live:
        try:
            interval_map = {
                "1": "ONE_MINUTE", "3": "THREE_MINUTE", "5": "FIVE_MINUTE",
                "15": "FIFTEEN_MINUTE", "30": "THIRTY_MINUTE", "60": "ONE_HOUR", "D": "ONE_DAY",
            }
            smart_int = interval_map.get(interval, "FIFTEEN_MINUTE")
            to_date = datetime.now(IST)
            from_date = to_date - timedelta(days=30 if smart_int != "ONE_DAY" else 500)
            res = smart_api.getCandleData({
                "exchange": exchange,
                "symboltoken": str(token),
                "interval": smart_int,
                "fromdate": from_date.strftime("%Y-%m-%d %H:%M"),
                "todate": to_date.strftime("%Y-%m-%d %H:%M"),
            })
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
                    except Exception:
                        continue
                if candles:
                    out = {"status": "success", "source": "AngelOne", "candles": candles}
                    candle_cache[cache_key] = (now_ts, out)
                    cache_cleanup()
                    return out
        except Exception as e:
            print(f"⚠️ Candle Fetch Exception: {e}")

    interval_ms_map = {"1": 60, "3": 180, "5": 300, "15": 900, "30": 1800, "60": 3600, "D": 86400}
    step_s = interval_ms_map.get(interval, 900)
    base = 22548.16
    for item in POPULAR_TOKENS:
        if item["symbol"].upper() == symbol.upper():
            base = item.get("base", 1500.0)
            break

    count = 160
    end_ts = int(datetime.now(IST).timestamp())
    end_ts = end_ts - (end_ts % step_s)
    start_time = end_ts - (count - 1) * step_s

    candles = []
    p = base
    for i in range(count):
        change = (random.random() - 0.5) * (base * 0.0018) * (1 + 0.3 * random.random())
        o = p
        c = o + change
        h = max(o, c) + random.random() * base * 0.0007
        l = min(o, c) - random.random() * base * 0.0007
        v = int(100000 + random.random() * 600000)
        candles.append({
            "time": int(start_time + i * step_s),
            "open": round(o, 2), "high": round(h, 2),
            "low": round(l, 2), "close": round(c, 2),
            "volume": v,
        })
        p = c

    out = {"status": "success", "source": "SimulatedPro", "candles": candles}
    candle_cache[cache_key] = (now_ts, out)
    cache_cleanup()
    return out


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="info")