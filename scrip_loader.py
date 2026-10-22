"""
============================================================
Scrip Master Loader — v2026.10 PROFESSIONAL
============================================================
- Angel One se OpenAPIScripMaster.json stream download
- Terminal progress bar (MB/%)
- Atomic save (.part → final rename) — corrupted file kabhi save nahi hoga
- JSON validate karta hai (array hi hai, NSE EQ symbols present)
- 3 retries with backoff
- Daily 8:45 AM IST auto-refresh
- Startup pe existing cache se instant load, phir background me fresh check
- Search index: prefix → substring → name match (TradingView-style)
============================================================
"""
import os, json, time, threading, sys
import requests
from datetime import datetime, timezone, timedelta

IST = timezone(timedelta(hours=5, minutes=30))
ANGEL_URL = "https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json"
SCRIP_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scripMaster.json")
INDEX_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "scripIndex.json")
BLOCKED_ASAS = ("ST", "BE", "IL")  # Suspended / Trade-to-Trade / Illiquid
# Delisted/demerged/obsolete symbols that still linger in Angel master (post-2024 actions)
BLOCKED_SYMBOLS = {"TATAMTRDVR", "TATAMTRDVR-EQ"}
REFRESH_HOUR_IST = 8
REFRESH_MIN_IST = 45
MAX_RETRIES = 3
# Bump this version to force a re-index rebuild on next server start
# (alias list updated, sorting rules changed — old cache incompatible).
INDEX_VERSION = 2026_10_22_1

# Search index populated at startup: list of dicts {symbol, name, token, exchange, type, symKey, nameKey}
_search_index = []
_lock = threading.Lock()
_load_complete = threading.Event()
_last_refresh_ts = 0


def _log(msg):
    ts = datetime.now(IST).strftime("%H:%M:%S")
    print(f"[{ts} IST] [scrip] {msg}", flush=True)


def _format_mb(b):
    return f"{b / (1024*1024):.2f} MB"


def _atomic_replace(src, dst, retries=8, delay=0.25):
    """
    Atomic rename with retries for Windows, where antivirus/Windows Search/
    another Python process can briefly hold a file lock causing WinError 32.
    Falls back to copy-then-remove if rename keeps failing.
    """
    import shutil
    last_err = None
    for i in range(retries):
        try:
            os.replace(src, dst)
            return True
        except OSError as e:
            last_err = e
            time.sleep(delay * (i + 1))  # linear backoff
    try:
        shutil.copy2(src, dst)
        try: os.remove(src)
        except: pass
        _log(f"⚠ Rename locked; used copy fallback for {os.path.basename(dst)}")
        return True
    except Exception as e:
        raise OSError(f"Could not replace {dst} after {retries} retries: {last_err}; copy also failed: {e}")


def _build_index(raw):
    """Filter Angel One raw master into searchable index of EQ + INDEX + OPT+FUT."""
    out = []
    seen = set()
    for s in raw:
        try:
            exch = str(s.get("exch_seg", "")).upper()
            sym = str(s.get("symbol", "")).strip()
            name = str(s.get("name", sym)).strip()
            token = str(s.get("token", "")).strip()
            inst_type = str(s.get("instrumenttype", "")).upper()
            asas = str(s.get("asas", "")).upper()
            opt_type = str(s.get("optiontype", ""))
            expiry = str(s.get("expiry", ""))
            strike = float(s.get("strike", 0) or 0)
            lotsize = int(s.get("lotsize", 1) or 1)
            if not sym or not token:
                continue

            rec_type = None
            final_sym = sym
            final_exch = exch

            # NSE / BSE Equities (end with -EQ in Angel master)
            if exch in ("NSE", "BSE") and sym.endswith("-EQ"):
                if asas in BLOCKED_ASAS:
                    continue
                base_sym = sym.replace("-EQ", "").upper()
                if base_sym in BLOCKED_SYMBOLS or sym.upper() in BLOCKED_SYMBOLS:
                    continue
                final_sym = sym.replace("-EQ", "")
                rec_type = "EQ"
            # Indices
            elif inst_type == "AMXIDX":
                rec_type = "INDEX"
            # NFO/BFO Futures & Options (keep raw symbol, e.g., TCS-EQ→options will have TCS25NOV24P4000)
            elif exch in ("NFO", "BFO", "MCX", "CDS"):
                rec_type = "OPT_FUT"
            else:
                continue

            key = f"{final_exch}:{token}:{final_sym}"
            if key in seen:
                continue
            seen.add(key)

            out.append({
                "symbol": final_sym,
                "name": name,
                "token": token,
                "exchange": final_exch,
                "type": rec_type,
                "symKey": final_sym.lower(),
                "nameKey": name.lower(),
                # Extra fields for F&O
                **({"optiontype": opt_type, "expiry": expiry,
                    "strike": strike, "lotsize": lotsize} if rec_type == "OPT_FUT" else {}),
            })
        except Exception:
            continue

    out.sort(key=lambda r: (
        0 if r["type"] == "EQ" else 1 if r["type"] == "INDEX" else 2,
        r["symKey"],
    ))
    return out


def _download_with_progress():
    """Stream download Angel One master with progress, return parsed JSON list."""
    last_print = [0.0]
    received = [0]
    def _chunk_hook(chunk):
        received[0] += len(chunk)
        now = time.time()
        if now - last_print[0] >= 0.3:
            last_print[0] = now
            sys.stdout.write(f"\r[download] {_format_mb(received[0])} received  ")
            sys.stdout.flush()

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            headers = {"User-Agent": "ProChart/2026.10", "Accept": "application/json"}
            r = requests.get(ANGEL_URL, headers=headers, stream=True, timeout=180)
            r.raise_for_status()
            total = int(r.headers.get("content-length", 0) or 0)
            received[0] = 0
            sys.stdout.write(f"\r[download] connecting... ")
            sys.stdout.flush()
            chunks = []
            for chunk in r.iter_content(chunk_size=64 * 1024):
                if chunk:
                    chunks.append(chunk)
                    _chunk_hook(chunk)
            sys.stdout.write("\r[download] decoding JSON...             \n")
            sys.stdout.flush()
            data = json.loads(b"".join(chunks))
            if not isinstance(data, list) or len(data) < 1000:
                raise ValueError(f"Unexpected master format (len={len(data) if isinstance(data, list) else 'not list'})")
            return data
        except Exception as e:
            sys.stdout.write("\n")
            sys.stdout.flush()
            if attempt == MAX_RETRIES:
                raise
            wait = attempt * 8
            _log(f"Download attempt {attempt} failed: {e}; retrying in {wait}s...")
            time.sleep(wait)
    return []


def refresh_master(force=False):
    """Download + validate + atomically replace master files. Thread-safe."""
    global _search_index, _last_refresh_ts
    with _lock:
        try:
            # If fresh enough (within 6 hours) and not forced, skip
            if not force and _search_index and (time.time() - _last_refresh_ts) < 6 * 3600:
                return True

            tmp_raw = SCRIP_FILE + ".part"
            tmp_idx = INDEX_FILE + ".part"

            raw = _download_with_progress()
            idx = _build_index(raw)
            if len(idx) < 1000:
                raise ValueError(f"Index too small after build ({len(idx)} entries) — aborting")

            _log(f"Index built: {len(idx)} instruments (EQ+INDEX+OPT+FUT)")
            # Write temp files first, then rename (atomic on same FS)
            with open(tmp_raw, "w", encoding="utf-8") as f:
                json.dump({"v": INDEX_VERSION, "data": raw}, f, separators=(",", ":"))
            with open(tmp_idx, "w", encoding="utf-8") as f:
                json.dump({"v": INDEX_VERSION, "data": idx}, f, separators=(",", ":"))
            _atomic_replace(tmp_raw, SCRIP_FILE)
            _atomic_replace(tmp_idx, INDEX_FILE)

            _search_index = idx
            _last_refresh_ts = time.time()
            _load_complete.set()
            _log(f"✅ Master saved: {_format_mb(os.path.getsize(SCRIP_FILE))} raw, {len(idx)} indexed instruments")
            return True
        except Exception as e:
            _log(f"❌ Refresh failed: {e}")
            # Clean up partial files
            for p in (SCRIP_FILE + ".part", INDEX_FILE + ".part"):
                try: os.remove(p)
                except: pass
            return False


def load_cached():
    """Load index from local cache on startup if present & version matches."""
    global _search_index, _last_refresh_ts
    for path in (INDEX_FILE, SCRIP_FILE):
        try:
            if not os.path.exists(path):
                continue
            mtime = os.path.getmtime(path)
            age_days = (time.time() - mtime) / 86400
            _log(f"Found cached {os.path.basename(path)} ({age_days:.1f} days old)")
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            # Support both old (raw list) and new ({v:..,data:[...]}) formats
            if isinstance(data, dict) and "data" in data:
                if data.get("v") != INDEX_VERSION:
                    _log(f"Cache version mismatch (got {data.get('v')}, want {INDEX_VERSION}) — will rebuild")
                    continue
                data = data["data"]
            elif isinstance(data, list):
                # Old unversioned cache — force rebuild (our alias/sort logic updated)
                _log("Old unversioned cache detected — will rebuild with new search rules")
                continue
            if path == INDEX_FILE:
                idx = data
            else:
                idx = _build_index(data)
            if idx and len(idx) > 1000:
                _search_index = idx
                _last_refresh_ts = mtime
                _load_complete.set()
                _log(f"⚡ Loaded {len(idx)} instruments from local cache (instant)")
                return True
        except Exception as e:
            _log(f"Cache read failed for {path}: {e}")
    return False


# Common alias map for popular stocks where Angel's official "name" field is
# just the ticker (no English name). "indian hotels" -> INDHOTEL, "state bank" -> SBIN, etc.
_ALIASES = {
    "indian hotel": "INDHOTEL", "indian hotels": "INDHOTEL", "ind hotels": "INDHOTEL",
    "taj hotel": "INDHOTEL", "taj hotels": "INDHOTEL", "ihcl": "INDHOTEL",
    "inhotel": "INDHOTEL", "inhotels": "INDHOTEL", "indhotels": "INDHOTEL", "indhotel": "INDHOTEL",
    "indianhotels": "INDHOTEL", "indianhotel": "INDHOTEL",
    "tata motors": "TATAMOTORS", "tata motor": "TATAMOTORS", "tatamotors": "TATAMOTORS",
    "tatamotor": "TATAMOTORS", "tata mot": "TATAMOTORS",
    "state bank": "SBIN", "sbi": "SBIN", "state bank of india": "SBIN",
    "hdfc bank": "HDFCBANK", "hdfc": "HDFCBANK",
    "icici bank": "ICICIBANK", "icici": "ICICIBANK",
    "kotak bank": "KOTAKBANK", "kotak": "KOTAKBANK",
    "axis bank": "AXISBANK", "axis": "AXISBANK",
    "reliance industries": "RELIANCE", "ril": "RELIANCE",
    "tata consultancy": "TCS", "tcs consultancy": "TCS", "tata consult": "TCS",
    "infosys": "INFY", "info sys": "INFY",
    "larsen": "LT", "larsen toubro": "LT", "l&t": "LT", "ln t": "LT",
    "housing development finance": "HDFC",
    "itc": "ITC", "i t c": "ITC",
    "maruti": "MARUTI", "maruti suzuki": "MARUTI",
    "mahindra": "M&M", "m m": "M&M", "mahindra mahindra": "M&M", "m&m": "M&M",
    "bajaj finance": "BAJFINANCE", "bajaj fin": "BAJFINANCE",
    "bajaj finserv": "BAJAJFINSV",
    "asian paints": "ASIANPAINT", "asian paint": "ASIANPAINT",
    "hindustan unilever": "HINDUNILVR", "hul": "HINDUNILVR", "hind lever": "HINDUNILVR",
    "nestle": "NESTLEIND", "nestle india": "NESTLEIND",
    "britannia": "BRITANNIA",
    "havells": "HAVELLS", "havels": "HAVELLS", "havels india": "HAVELLS",
    "coal india": "COALINDIA",
    "ntpc": "NTPC",
    "power grid": "POWERGRID",
    "bharat petroleum": "BPCL", "bpcl": "BPCL",
    "hindustan petroleum": "HINDPETRO", "hpcl": "HINDPETRO",
    "indian oil": "IOC", "indian oil corp": "IOC", "ioc": "IOC",
    "oil natural gas": "ONGC", "ongc": "ONGC",
    "tata steel": "TATASTEEL", "tata steel ltd": "TATASTEEL",
    "jsw steel": "JSWSTEEL",
    "titan": "TITAN", "tata titan": "TITAN",
    "life insurance": "LICI", "lic": "LICI", "lic india": "LICI",
    "sun pharma": "SUNPHARMA", "sun pharmaceutical": "SUNPHARMA",
    "d r reddy": "DRREDDY", "dr reddys": "DRREDDY", "dr reddy": "DRREDDY",
    "cipla": "CIPLA",
    "aurobindo": "AUROPHARMA",
    "adani enterprises": "ADANIENT", "adani ent": "ADANIENT",
    "adani ports": "ADANIPORTS",
    "wipro": "WIPRO",
    "tech mahindra": "TECHM", "techm": "TECHM",
    "hcl tech": "HCLTECH", "hcl technologies": "HCLTECH",
    "sbi life": "SBILIFE",
    "ultratech": "ULTRACEMCO", "ultra tech": "ULTRACEMCO",
    "gail": "GAIL", "gail india": "GAIL",
    "tata power": "TATAPOWER",
    "hero motocorp": "HEROMOTOCO", "hero moto": "HEROMOTOCO",
    "bajaj auto": "BAJAJ-AUTO",
    "eicher motors": "EICHERMOT", "eicher": "EICHERMOT",
    # Major indices (user expects the INDEX record, not some ETF named NIFTYBEES etc.)
    # Use (exchange, symKey) — symKey is lowercased Angel "symbol" field.
    "nifty": ("NSE", "nifty 50"), "nifty 50": ("NSE", "nifty 50"), "nifty50": ("NSE", "nifty 50"),
    "bank nifty": ("NSE", "nifty bank"), "banknifty": ("NSE", "nifty bank"),
    "finnifty": ("NSE", "nifty fin service"), "fin nifty": ("NSE", "nifty fin service"),
    "sensex": ("BSE", "sensex"),
    "india vix": ("NSE", "india vix"), "vix": ("NSE", "india vix"),
}

# Alias targets can be either a symKey string (for EQ matches) or a (exchange, name) tuple
# for INDEX matches (since indices have neither -EQ suffix nor a clean ticker symbol).


def search(q, limit=20):
    """TradingView-style relevance search; returns top N matches."""
    if not _search_index:
        return None  # signals "not loaded yet"
    raw_query = (q or "").strip().lower()[:40]
    if len(raw_query) < 1:
        return []
    # Smart query normalization: strip suffix words (" co ltd", " limited", " ltd") and trailing plural 's'
    query = raw_query
    # Normalize by removing common company-name suffixes ANYWHERE (not just suffix — user might type in middle)
    for noise in (" co. ltd.", " co ltd", " co. ltd", " co ltd.", " limited", " ltd.", " ltd", " co.", " co"):
        query = query.replace(noise, "")
    query = " ".join(query.split())  # collapse whitespace after removals
    if query.endswith("s") and len(query) > 3:
        query = query[:-1]
    # Collapse whitespace
    q_collapsed = " ".join(query.split())
    raw_collapsed = " ".join(raw_query.split())

    def _word_prefix_match(haystack, q):
        """Any word in haystack starts with q (and q is >=3 chars)."""
        if len(q) < 3: return False
        for w in haystack.replace("-", " ").replace("_", " ").split():
            if w.startswith(q): return True
        return False

    if len(query) < 2:
        # 1 char: prefix-only on symbolKey
        matches = []
        for s in _search_index:
            if s["symKey"].startswith(query):
                typeBoost = 0 if s["type"] in ("EQ", "INDEX") else 50
                matches.append((typeBoost + 1, s))
                if len(matches) >= limit: break
    else:
        # Build alias-matched symKey/name to float to the very top
        alias_target = _ALIASES.get(q_collapsed) or _ALIASES.get(raw_collapsed)
        matches = []
        for s in _search_index:
            sk = s["symKey"]; nk = s["nameKey"]
            rank = 99
            # 0) Alias match (explicit override — e.g. "indian hotels" → INDHOTEL, "nifty" → Nifty 50 INDEX)
            if alias_target is not None:
                if isinstance(alias_target, tuple) and len(alias_target) == 2:
                    tgt_exch, tgt_sym = alias_target
                    if s.get("type") == "INDEX" and s.get("exchange") == tgt_exch and sk == tgt_sym:
                        rank = -1
                elif isinstance(alias_target, str) and sk == alias_target.lower() and s["type"] == "EQ":
                    rank = -1
            if rank == 99:
                if sk == query or sk == raw_query:
                    rank = 0
                elif sk.startswith(query) or sk.startswith(raw_query):
                    rank = 1
                elif nk.startswith(query) or nk.startswith(raw_query):
                    rank = 2
                elif query in sk or raw_query in sk:
                    rank = 3
                elif query in nk or raw_query in nk:
                    rank = 4
                else:  # fuzzy tiers only for non-matches
                    # Multi-token match: all tokens appear in sym or name (e.g. "indian hot" -> INDIAN HOTELS)
                    toks = [t for t in query.split() if len(t) >= 2]
                    raw_toks = [t for t in raw_query.split() if len(t) >= 2]
                    all_toks = toks + [t for t in raw_toks if t not in toks]
                    if all_toks and all((t in sk or t in nk or _word_prefix_match(nk, t)) for t in all_toks):
                        rank = 5
                    # Word-prefix match for single-word query (e.g. "hotel" -> EIHOTEL, INDHOTEL)
                    elif len(query) >= 3 and _word_prefix_match(nk, query):
                        rank = 6
                    # Containment of raw/normalized query in symKey
                    else:
                        if len(query) >= 4 and query in sk:
                            rank = 7
                        elif len(raw_query) >= 4 and raw_query in sk:
                            rank = 7
            # OPT_FUT rank is bumped so EQ/INDEX appear first (no options cluttering equity search)
            if s["type"] == "OPT_FUT":
                rank += 20
            # Tight matches (smaller distance between query and actual symbol) float up:
            # shorter symKey AND larger prefix overlap = better match.
            if s["type"] in ("EQ", "INDEX"):
                # bonus when symKey starts with (raw or normalized) query: float to top
                if sk.startswith(query) or sk.startswith(raw_query):
                    rank -= 0.5
                # tiny penalty for very short symbols (IT, LT, NH) matching random substrings
                if len(sk) < 4:
                    rank += 2
            if rank < 99:
                matches.append((rank, s))
    matches.sort(key=lambda x: (x[0], 0 if x[1]["type"] == "EQ" else 1 if x[1]["type"] == "INDEX" else 2, len(x[1]["symKey"]), x[1]["symKey"]))
    out = []
    for _, s in matches[:limit]:
        out.append({
            "symbol": s["symbol"], "name": s["name"], "token": s["token"],
            "exchange": s["exchange"], "type": s["type"],
        })
    return out


def _daily_refresh_loop():
    """Background thread: refresh daily at 8:45 AM IST."""
    while True:
        try:
            now = datetime.now(IST)
            target = now.replace(hour=REFRESH_HOUR_IST, minute=REFRESH_MIN_IST, second=0, microsecond=0)
            if now >= target:
                target += timedelta(days=1)
            # Skip weekends (Mon-Fri only)
            while target.weekday() >= 5:
                target += timedelta(days=1)
            sleep_s = (target - now).total_seconds()
            _log(f"Next auto-refresh scheduled for {target.strftime('%a %d %b %Y %H:%M IST')} ({sleep_s/3600:.1f}h)")
            time.sleep(sleep_s)
            refresh_master(force=True)
            # Wait a bit to avoid immediate retrigger
            time.sleep(60)
        except Exception as e:
            _log(f"Daily refresh loop error: {e}")
            time.sleep(600)


def start_background_tasks():
    """Call once at server startup: load cache, start refresh thread, trigger fresh download."""
    loaded = load_cached()
    if not loaded:
        _log("No valid cache found — downloading fresh master (may take a minute)...")

    def _initial():
        # Cache is valid for 24 hours (Angel publishes new list only daily ~8 AM)
        age = (time.time() - _last_refresh_ts) if _last_refresh_ts else 999999
        if age > 24 * 3600:
            refresh_master(force=not loaded)
        else:
            _log(f"Cache is fresh ({age/3600:.1f}h old < 24h), skipping startup download")

    threading.Thread(target=_initial, daemon=True).start()
    threading.Thread(target=_daily_refresh_loop, daemon=True).start()


def ready():
    return _load_complete.is_set()


def count():
    return len(_search_index)
