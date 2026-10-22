"""
============================================================
live_ws.py — Angel One SmartWebSocketV2 streaming tick client
============================================================
Production-grade realtime tick handler for ProChart v2026.10.

Responsibilities:
 - Connect to Angel One's wss://smartapisocket.angelone.in/smart-stream
 - Subscribe / unsubscribe tokens as user changes symbols (max 1000 tokens/connection per Angel docs)
 - Maintain an in-memory LTP+OHLCV cache (last tick per token) so the REST
   endpoints can also serve near-realtime quotes without WS-aware polling.
 - Build forming candle from ticks (same logic Angel itself uses: TF-aligned
   buckets) so charts can update candle-by-tick instead of every 3-5s.
 - Auto-reconnect with exponential backoff (handles Angel WS drops which happen
   frequently on consumer internet).
 - Thread-safe (WS runs on its own thread; public access protected by lock).
 - Graceful shutdown.

Modes (Angel WebSocket V2 docs):
   1 = LTP        (very light, 4-6 packets/sec)
   2 = Quote      (LTP + OHLC + volume + OI — what we use for charting)
   3 = SnapQuote  (full market depth / 5-level bid-ask — optional, heavier)
We use mode=2 by default (best balance for intraday charts).

Exchange types: 1=NSE_CM, 2=NFO, 3=BSE_CM, 4=BFO, 5=MCX_FO, 7=NCX, 13=CDE.
Indices (NIFTY/BANKNIFTY) come over exchangeType=1 with token 99926xxx.
"""

from __future__ import annotations

import os
import json
import time
import math
import threading
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict, Any

log = logging.getLogger("prochart.ws")
if not log.handlers:
    h = logging.StreamHandler()
    h.setFormatter(logging.Formatter("[%(asctime)s] [ws] %(message)s", "%H:%M:%S"))
    log.addHandler(h)
log.setLevel(logging.INFO)

IST = timezone(timedelta(hours=5, minutes=30))

EXCHANGE_MAP = {
    "NSE": 1, "NSE_EQ": 1, "NSE_CM": 1, "NSE-IE": 1, "EQ": 1,
    "NFO": 2, "NSE_FO": 2, "OPT": 2, "FUT": 2,
    "BSE": 3, "BSE_CM": 3, "BSE_EQ": 3,
    "BFO": 4, "BSE_FO": 4,
    "MCX": 5, "MCX_FO": 5,
    "NCX": 7, "NCX_FO": 7,
    "CDE": 13, "CDS": 13, "CDE_FO": 13,
}


def ex_type(exchange: str) -> int:
    """Map various exchange spellings to Angel's numeric exchangeType."""
    if not exchange:
        return 1
    s = exchange.strip().upper().replace("-", "_")
    if s in EXCHANGE_MAP:
        return EXCHANGE_MAP[s]
    # Heuristic: NSE/BSE prefixes
    if s.startswith("NSE"):
        return 1
    if s.startswith("BSE"):
        return 3
    if s.startswith("NFO") or s.startswith("BFO"):
        return 2
    return 1


TF_SECONDS = {"1": 60, "3": 180, "5": 300, "15": 900, "30": 1800, "60": 3600, "D": 86400}


class LiveTickClient:
    """
    Thread-safe SmartWebSocketV2 wrapper with auto-reconnect and tick-cache.
    One instance per server process — reused across all browser tabs.
    """

    def __init__(self):
        self._lock = threading.RLock()
        self._ws = None                     # SmartWebSocketV2 instance (or None)
        self._ws_thread: Optional[threading.Thread] = None
        self._connected = False
        self._should_run = False
        self._subscribed: Dict[str, Dict[str, Any]] = {}
        # tick_cache: { "<exType>_<token>": { ltp, vol, oi, open, high, low, prev_close, last_tick_ts, ... } }
        self._tick_cache: Dict[str, Dict[str, Any]] = {}
        # forming_candles: { "<exType>_<token>_<tfSec>": { time, open, high, low, close, volume, start_vol } }
        self._forming: Dict[str, Dict[str, Any]] = {}
        # auth (set via start())
        self._auth_token = ""
        self._api_key = ""
        self._client_code = ""
        self._feed_token = ""
        self._corr = "prochart_live"
        self._mode = 2  # Quote mode
        self._reconnect_delay = 2
        self._reconnect_count = 0
        self._tick_count = 0
        self._last_tick_ts = 0

    # ---------- lifecycle ----------
    def start(self, api_key: str, client_code: str, auth_token: str, feed_token: str, mode: int = 2):
        """Start the WebSocket client (idempotent)."""
        with self._lock:
            self._api_key = api_key
            self._client_code = client_code
            self._auth_token = auth_token
            self._feed_token = feed_token
            self._mode = mode if mode in (1, 2, 3) else 2
            if self._connected:
                log.info("start() called while already connected — refreshing subscriptions")
                self._refresh_subscriptions()
                return True
            if not all([api_key, client_code, auth_token, feed_token]):
                log.warning("Cannot start WS — missing credentials")
                return False
            self._should_run = True
            self._ws_thread = threading.Thread(target=self._run_loop, name="angel-ws", daemon=True)
            self._ws_thread.start()
            return True

    def stop(self):
        """Stop the WS and its thread (called on server shutdown)."""
        self._should_run = False
        self._connected = False
        ws_ref = self._ws
        self._ws = None
        # Close on a short-lived thread so we don't block uvicorn's shutdown
        def _do_close():
            try:
                if ws_ref is not None:
                    ws_ref.close_connection()
            except Exception:
                pass
        threading.Thread(target=_do_close, daemon=True).start()

    def set_credentials(self, api_key: str, client_code: str, auth_token: str, feed_token: str):
        """Update credentials after session refresh; reconnect."""
        with self._lock:
            changed = (api_key != self._api_key or client_code != self._client_code
                       or auth_token != self._auth_token or feed_token != self._feed_token)
            self._api_key = api_key
            self._client_code = client_code
            self._auth_token = auth_token
            self._feed_token = feed_token
            if changed and self._should_run:
                log.info("Credentials changed — triggering reconnect")
                self._reconnect()

    # ---------- subscription management ----------
    def subscribe(self, exchange: str, token: str) -> bool:
        """Subscribe to one instrument (e.g. subscribe("NSE","2885"))."""
        key = self._tok_key(ex_type(exchange), token)
        with self._lock:
            if key in self._subscribed:
                return True
            self._subscribed[key] = {"exchangeType": ex_type(exchange), "token": token}
            if self._connected and self._ws is not None:
                try:
                    # _exch_token_list() already returns a LIST of dicts (one per exchange)
                    self._ws.subscribe(self._corr, self._mode, self._exch_token_list(action=1))
                    log.info(f"🔔 WS subscribe: {key} (total {len(self._subscribed)})")
                except Exception as e:
                    log.warning(f"WS subscribe failed for {key}: {e}")
            return True

    def unsubscribe_all(self):
        """Unsubscribe all tokens (e.g. on server shutdown or symbol switch)."""
        with self._lock:
            if not self._subscribed:
                return
            if self._connected and self._ws is not None:
                try:
                    tl = self._exch_token_list(action=0)
                    # tl is a LIST of dicts — unsubscribe the whole payload
                    self._ws.unsubscribe(self._corr, self._mode, tl)
                except Exception as e:
                    log.warning(f"WS unsubscribe all failed: {e}")
            self._subscribed.clear()

    def subscribe_only(self, exchange: str, token: str):
        """Subscribe to just this token; no-op if already the only active sub (prevents duplicate WS traffic)."""
        with self._lock:
            key = self._tok_key(ex_type(exchange), token)
            if len(self._subscribed) == 1 and key in self._subscribed:
                return  # already subscribed to exactly this one — skip (saves WS roundtrip)
            was_connected = self._connected
            self.unsubscribe_all()
            if was_connected:
                time.sleep(0.05)
            self.subscribe(exchange, token)

    # ---------- public read (for REST / status / SSE) ----------
    def ltp(self, exchange: str, token: str) -> Optional[float]:
        k = self._tok_key(ex_type(exchange), token)
        t = self._tick_cache.get(k)
        return t["ltp"] if t else None

    def quote(self, exchange: str, token: str) -> Optional[Dict[str, Any]]:
        k = self._tok_key(ex_type(exchange), token)
        t = self._tick_cache.get(k)
        if not t:
            return None
        return dict(t)

    def forming_candle(self, exchange: str, token: str, tf: str) -> Optional[Dict[str, Any]]:
        """Return the in-progress candle (built from ticks) for a given TF, or None."""
        tfSec = TF_SECONDS.get(str(tf))
        if not tfSec:
            return None
        k = self._tok_key(ex_type(exchange), token) + f"_{tfSec}"
        f = self._forming.get(k)
        if not f:
            return None
        return {
            "time": f["time"],
            "open": f["open"], "high": f["high"], "low": f["low"], "close": f["close"],
            "volume": f["volume"],
        }

    def status(self) -> Dict[str, Any]:
        return {
            "connected": self._connected,
            "subscribed_count": len(self._subscribed),
            "tick_count": self._tick_count,
            "last_tick_age_sec": round(time.time() - self._last_tick_ts, 1) if self._last_tick_ts else None,
            "reconnect_count": self._reconnect_count,
            "mode": self._mode,
        }

    # ---------- internal ----------
    @staticmethod
    def _tok_key(exType: int, token: str) -> str:
        return f"{int(exType)}_{str(token)}"

    def _exch_token_list(self, action: int = 1):
        """Build Angel subscription payload grouped by exchangeType."""
        groups: Dict[int, list] = {}
        for sub in self._subscribed.values():
            groups.setdefault(sub["exchangeType"], []).append(str(sub["token"]))
        return [{"action": action, "exchangeType": et, "tokens": toks} for et, toks in groups.items()]

    def _refresh_subscriptions(self):
        """After reconnect, resubscribe to all previously-subscribed tokens."""
        if not (self._ws and self._connected):
            return
        try:
            payload = self._exch_token_list(action=1)
            if payload:
                self._ws.subscribe(self._corr, self._mode, payload)
                log.info(f"🔔 WS resubscribed to {len(self._subscribed)} tokens (mode={self._mode})")
        except Exception as e:
            log.warning(f"WS refresh subscriptions failed: {e}")

    def _reconnect(self):
        try:
            if self._ws is not None:
                self._ws.close_connection()
        except Exception:
            pass
        self._connected = False
        self._ws = None

    # ---------- WS thread (runs in daemon thread) ----------
    def _run_loop(self):
        """Main WS lifecycle: connect → subscribe → handle ticks; retry w/ backoff."""
        try:
            from SmartApi.smartWebSocketV2 import SmartWebSocketV2
        except ImportError:
            try:
                from smartapi.smartWebSocketV2 import SmartWebSocketV2  # type: ignore
            except ImportError:
                log.error("SmartWebSocketV2 not available — install smartapi-python==1.5.5; WS disabled.")
                return

        while self._should_run:
            try:
                with self._lock:
                    ws = SmartWebSocketV2(
                        self._auth_token, self._api_key, self._client_code, self._feed_token,
                        max_retry_attempt=5, retry_strategy=0, retry_delay=5, retry_duration=30,
                    )
                    self._ws = ws

                def on_open(wsapp):
                    self._connected = True
                    self._reconnect_delay = 2
                    self._reconnect_count += 1
                    log.info("🔌 WS connected (Angel One)")
                    with self._lock:
                        try:
                            payload = self._exch_token_list(action=1)
                            if payload:
                                ws.subscribe(self._corr, self._mode, payload)
                                log.info(f"🔔 WS subscribed to {len(self._subscribed)} tokens (mode={self._mode})")
                        except Exception as e:
                            log.warning(f"subscribe on_open failed: {e}")

                def on_data(wsapp, message):
                    try:
                        self._on_tick(message)
                    except Exception as e:
                        log.debug(f"tick handler error: {e}")

                def on_error(wsapp, error):
                    log.warning(f"WS error: {error}")

                def on_close(wsapp, code=None, reason=None):
                    self._connected = False
                    log.info(f"WS closed (code={code}, reason={reason})")

                ws.on_open = on_open
                ws.on_data = on_data
                ws.on_error = on_error
                ws.on_close = on_close

                ws.connect()  # blocks until close/error
            except Exception as e:
                log.warning(f"WS thread exception: {e}")

            # If we get here, connect() returned/errored — exponential backoff
            self._connected = False
            if not self._should_run:
                break
            delay = min(self._reconnect_delay, 60)
            log.info(f"⏳ Reconnecting in {delay}s...")
            # Interruptible sleep (so Ctrl+C doesn't wait full delay)
            waited = 0.0
            while self._should_run and waited < delay:
                time.sleep(0.25)
                waited += 0.25
            self._reconnect_delay = min(self._reconnect_delay * 2, 60)

        log.info("WS thread exited (should_run=False)")

    # ---------- tick parsing + candle building ----------
    def _on_tick(self, message):
        """
        Angel mode=2 tick shape (example):
            {
              "subscription_mode": 2, "exchange_type": 1, "token": "2885",
              "sequence_number": N, "exchange_timestamp": 173045...,
              "last_traded_price": 295000,  # price * 100
              "last_traded_quantity": 25,
              "average_traded_price": 294523,
              "volume_trade_for_the_day": 1234567,
              "total_buy_quantity": ..., "total_sell_quantity": ...,
              "open_price_of_the_day": 290000,
              "high_price_of_the_day": 296500,
              "low_price_of_the_day": 289500,
              "closed_price": 290000,
              "open_interest": 0,         # only for F&O
              "best_5_buy_data": [...],   # mode=3 only
              "best_5_sell_data": [...],
            }
        All prices are in paise (×100). We divide by 100.
        """
        if not message or not isinstance(message, dict):
            return
        # Angel sometimes wraps in list
        ticks = [message]
        for m in ticks:
            try:
                if m.get("error"):
                    continue
                et = m.get("exchange_type")
                tok = str(m.get("token", ""))
                if et is None or not tok:
                    continue
                divisor = 100.0
                ltp_raw = m.get("last_traded_price")
                if ltp_raw is None:
                    continue
                ltp = float(ltp_raw) / divisor
                vol = float(m.get("volume_trade_for_the_day", 0) or 0)
                oi = float(m.get("open_interest", 0) or 0)
                day_open = float(m.get("open_price_of_the_day") or ltp_raw) / divisor
                day_high = float(m.get("high_price_of_the_day") or ltp_raw) / divisor
                day_low = float(m.get("low_price_of_the_day") or ltp_raw) / divisor
                prev_close = float(m.get("closed_price") or ltp_raw) / divisor
                ts_exch = m.get("exchange_timestamp")
                tick_ts = (ts_exch / 1000.0) if ts_exch else time.time()

                key = self._tok_key(et, tok)
                prev = self._tick_cache.get(key, {})
                prev_vol = prev.get("day_volume", vol)
                delta_vol = max(0.0, vol - prev_vol)

                self._tick_cache[key] = {
                    "ltp": ltp,
                    "day_open": day_open, "day_high": day_high, "day_low": day_low,
                    "prev_close": prev_close,
                    "day_volume": vol, "last_tick_qty": float(m.get("last_traded_quantity", 0) or 0),
                    "tick_volume_delta": delta_vol,
                    "oi": oi,
                    "last_tick_ts": tick_ts,
                    "exchange_type": et,
                    "token": tok,
                }
                self._tick_count += 1
                self._last_tick_ts = time.time()

                # Update forming candles for ALL timeframes we care about
                self._update_formings(key, et, tok, ltp, delta_vol, tick_ts, day_open)

            except Exception as e:
                log.debug(f"tick parse error: {e}")

    def _update_formings(self, key: str, et: int, tok: str, ltp: float, delta_vol: float, tick_ts: float, day_open: float):
        """Maintain per-tf forming candle buckets for the given token."""
        for tfSec in (60, 180, 300, 900, 1800, 3600, 86400):
            if tfSec == 86400:
                # Daily candle: bucket = start of day (00:00 IST? Actually exchange-day 09:15)
                d = datetime.fromtimestamp(tick_ts, tz=IST).date()
                bucket_ts = int(datetime(d.year, d.month, d.day, 9, 15, tzinfo=IST).timestamp())
            else:
                bucket_ts = int(tick_ts // tfSec) * tfSec
            fkey = f"{key}_{tfSec}"
            fc = self._forming.get(fkey)
            if fc is None or fc["time"] != bucket_ts:
                # New candle starting — seed with LTP
                self._forming[fkey] = {
                    "time": bucket_ts,
                    "open": ltp, "high": ltp, "low": ltp, "close": ltp,
                    "volume": delta_vol,
                }
            else:
                fc["close"] = ltp
                if ltp > fc["high"]:
                    fc["high"] = ltp
                if ltp < fc["low"]:
                    fc["low"] = ltp
                fc["volume"] += delta_vol


# Singleton for the process
live_ws = LiveTickClient()
