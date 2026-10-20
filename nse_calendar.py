"""
nse_calendar.py — NSE trading-holiday calendar
==============================================
Fetches NSE's official market holiday list once at startup and caches it locally
for a year. Correctly reports market_closed even when Angel WebSocket is still
connected (WS stays up on holidays — ticks don't flow but connection remains).

Data sources (tried in order):
  1. NSE official api: https://www.nseindia.com/api/holiday-master?type=trading
  2. Fallback: static curated list of national holidays (Mahurat trading flagged separately)
  3. Weekend (Sat/Sun) always closed.

The calendar covers equity (NSE CM) segment — our primary use case. Currency /
commodity segments sometimes have different holidays; we don't trade those from
ProChart so equity calendar is fine.
"""

from __future__ import annotations

import os
import json
import time
import logging
from datetime import date, datetime, timezone, timedelta
from typing import Set, Optional

log = logging.getLogger("prochart.calendar")

IST = timezone(timedelta(hours=5, minutes=30))
CAL_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "nse_holidays.json")

# Fallback holiday list for CM (equity cash) segment — major trading holidays 2026
# (used only if NSE api is unreachable on first run; refreshed once NSE responds).
# Dates are YYYY-MM-DD strings.
_FALLBACK_2026 = [
    "2026-01-26",  # Republic Day
    "2026-02-19",  # Chhatrapati Shivaji Maharaj Jayanti
    "2026-03-03",  # Maha Shivaratri
    "2026-03-20",  # Holi
    "2026-03-31",  # Id-Ul-Fitr
    "2026-04-03",  # Good Friday
    "2026-04-14",  # Dr. Ambedkar Jayanti
    "2026-05-01",  # Maharashtra Day
    "2026-05-27",  # Id-Uz-Zuha (Bakrid)
    "2026-08-15",  # Independence Day
    "2026-08-26",  # Ganesh Chaturthi
    "2026-10-02",  # Gandhi Jayanti
    "2026-10-20",  # Dussehra (Vijayadashami) — TODAY
    "2026-10-28",  # Balipratipada
    "2026-11-04",  # Guru Nanak Jayanti
    "2026-11-07",  # Laxmi Pujan (Diwali) — note: Mahurat trading in evening
    "2026-12-25",  # Christmas
]
_FALLBACK_2027 = [
    "2027-01-26", "2027-02-26", "2027-03-08", "2027-03-29", "2027-03-30",
    "2027-04-02", "2027-04-14", "2027-05-01", "2027-05-17", "2027-08-15",
    "2027-09-15", "2027-10-02", "2027-10-10", "2027-10-19", "2027-10-28",
    "2027-11-01", "2027-12-25",
]
_MAHURAT_TRADING_2026 = {"2026-11-07": ("18:30", "19:40")}  # Laxmi Pujan evening window
_MAHURAT_TRADING_2027: dict = {}


class NSECalendar:
    def __init__(self, cache_path: str = CAL_FILE):
        self.cache_path = cache_path
        self._holidays: Set[str] = set()
        self._mahurat: dict = {}
        self._last_fetch: float = 0
        self._loaded_from = "init"
        self._load_cache_or_fetch()

    # ---------- public API ----------
    def is_trading_day(self, d: Optional[date] = None) -> bool:
        d = d or datetime.now(IST).date()
        if d.weekday() >= 5:  # Sat/Sun
            return False
        if d.isoformat() in self._holidays:
            # Check for mahurat trading window (special 1hr evening session)
            if d.isoformat() in self._mahurat:
                # Consider it a trading day only inside the mahurat window
                now = datetime.now(IST).time()
                open_t = datetime.strptime(self._mahurat[d.isoformat()][0], "%H:%M").time()
                close_t = datetime.strptime(self._mahurat[d.isoformat()][1], "%H:%M").time()
                return open_t <= now <= close_t
            return False
        return True

    def market_status(self) -> dict:
        now = datetime.now(IST)
        d = now.date()
        wd = d.weekday()
        hhmm = now.hour * 100 + now.minute
        weekend = wd >= 5
        holiday = d.isoformat() in self._holidays
        in_mahurat = False
        mahurat_msg = None
        if holiday and d.isoformat() in self._mahurat:
            open_t = datetime.strptime(self._mahurat[d.isoformat()][0], "%H:%M").time()
            close_t = datetime.strptime(self._mahurat[d.isoformat()][1], "%H:%M").time()
            if open_t <= now.time() <= close_t:
                in_mahurat = True
                holiday = False
            elif now.time() < open_t:
                mahurat_msg = f"Mahurat Trading {self._mahurat[d.isoformat()][0]}-{self._mahurat[d.isoformat()][1]} IST"
        regular_open = (915 <= hhmm < 1530)
        pre_open = (900 <= hhmm < 915)
        market_open = not weekend and not holiday and (regular_open or in_mahurat)
        if weekend:
            reason = "Weekend"
        elif holiday:
            reason = "Holiday" + (f" — {mahurat_msg}" if mahurat_msg else "")
        elif pre_open:
            reason = "Pre-Open"
        elif market_open:
            reason = "OPEN"
        elif hhmm < 915:
            reason = "Pre-Market"
        else:
            reason = "Closed"
        return {
            "market_open": market_open,
            "is_holiday": holiday or weekend,
            "pre_open": pre_open,
            "reason": reason,
            "date": d.isoformat(),
            "weekday": d.strftime("%A"),
            "holiday_count_loaded": len(self._holidays),
            "source": self._loaded_from,
        }

    def force_refresh(self) -> bool:
        return self._fetch_remote(force=True)

    # ---------- internals ----------
    def _load_cache_or_fetch(self):
        # First seed with fallbacks so we never have an empty holiday set
        self._holidays = set(_FALLBACK_2026) | set(_FALLBACK_2027)
        self._mahurat = {**_MAHURAT_TRADING_2026, **_MAHURAT_TRADING_2027}
        self._loaded_from = "fallback"
        # Try to load cached file if fresh (within 7 days)
        try:
            if os.path.exists(self.cache_path):
                mtime = os.path.getmtime(self.cache_path)
                with open(self.cache_path, "r") as f:
                    cached = json.load(f)
                if (time.time() - mtime) < 7 * 86400:
                    self._holidays = set(cached.get("holidays", []))
                    self._mahurat = cached.get("mahurat", {})
                    self._last_fetch = mtime
                    self._loaded_from = "cache"
                    log.info(f"📅 Loaded {len(self._holidays)} holidays from local cache")
                    return
        except Exception as e:
            log.warning(f"calendar cache read failed: {e}")
        # Try remote fetch (non-blocking thread)
        import threading
        threading.Thread(target=self._fetch_remote, daemon=True).start()

    def _fetch_remote(self, force: bool = False) -> bool:
        try:
            import requests
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "application/json",
                "Referer": "https://www.nseindia.com/",
            }
            s = requests.Session()
            # NSE requires visiting the homepage first to set cookies
            try:
                s.get("https://www.nseindia.com/market-data/holiday-calendar",
                      headers=headers, timeout=8)
            except Exception:
                pass
            r = s.get("https://www.nseindia.com/api/holiday-master?type=trading",
                      headers=headers, timeout=10)
            if r.status_code != 200:
                log.warning(f"NSE calendar HTTP {r.status_code} — using fallback")
                return False
            data = r.json()
            trading_holidays = set()
            # NSE returns { "CM": [ {tradingDate, description, ...}, ... ], "FO": [...], ... }
            cm_list = []
            if isinstance(data, dict):
                cm_list = data.get("CM", []) or data.get("Equity", []) or []
            for h in cm_list:
                try:
                    d = h.get("tradingDate") or h.get("date")
                    if d:
                        # Format: "20-Oct-2026" or "2026-10-20"
                        for fmt in ("%d-%b-%Y", "%Y-%m-%d"):
                            try:
                                parsed = datetime.strptime(d, fmt).date()
                                trading_holidays.add(parsed.isoformat())
                                break
                            except ValueError:
                                continue
                except Exception:
                    continue
            if not trading_holidays:
                log.warning("NSE holiday list empty — keeping fallback")
                return False
            # Merge fallbacks for future years NSE list might not include
            merged = set(trading_holidays)
            for fallback in (_FALLBACK_2026, _FALLBACK_2027):
                for d in fallback:
                    if d[:4] >= str(date.today().year):
                        merged.add(d)
            self._holidays = merged
            self._last_fetch = time.time()
            self._loaded_from = "nse_api"
            try:
                tmp = self.cache_path + ".part"
                with open(tmp, "w") as f:
                    json.dump({"holidays": sorted(merged),
                               "mahurat": {**_MAHURAT_TRADING_2026, **_MAHURAT_TRADING_2027},
                               "fetched_at": self._last_fetch}, f)
                os.replace(tmp, self.cache_path)
            except Exception as e:
                log.warning(f"calendar cache write failed: {e}")
            log.info(f"📅 NSE holidays fetched: {len(merged)} dates")
            return True
        except Exception as e:
            log.warning(f"NSE calendar fetch failed (using fallback): {e}")
            return False


nse_calendar = NSECalendar()


def market_open_now() -> bool:
    return nse_calendar.market_status()["market_open"]


if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO)
    s = nse_calendar.market_status()
    print(json.dumps(s, indent=2))
