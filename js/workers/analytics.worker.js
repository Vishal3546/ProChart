/* ============================================================
 * analytics.worker.js — Off-main-thread engine cluster
 * TradingView Oct 2026 pattern: SoA buffers + pure functions
 * ============================================================ */
const STRIDE = 6;
const O_T = 0, O_O = 1, O_H = 2, O_L = 3, O_C = 4, O_V = 5;

function unpack(payload) {
    const b = new Float64Array(payload.buffer);
    const n = payload.length;
    const times = new Float64Array(n);
    const opens = new Float64Array(n);
    const highs = new Float64Array(n);
    const lows = new Float64Array(n);
    const closes = new Float64Array(n);
    const vols = new Float64Array(n);
    for (let i = 0; i < n; i++) {
        const o = i * STRIDE;
        times[i] = b[o + O_T];
        opens[i] = b[o + O_O];
        highs[i] = b[o + O_H];
        lows[i] = b[o + O_L];
        closes[i] = b[o + O_C];
        vols[i] = b[o + O_V];
    }
    return { n, times, opens, highs, lows, closes, vols, buf: b };
}

/* ---------- Core indicators (TypedArray native) ---------- */
function emaArr(src, p) {
    const n = src.length;
    const out = new Float64Array(n);
    const k = 2 / (p + 1);
    out[0] = src[0];
    for (let i = 1; i < n; i++) out[i] = src[i] * k + out[i - 1] * (1 - k);
    return out;
}

function rmaATR(highs, lows, closes, p = 14) {
    const n = closes.length;
    const out = new Float64Array(n);
    if (n < 2) return out;
    const tr = new Float64Array(n);
    tr[0] = highs[0] - lows[0];
    for (let i = 1; i < n; i++) {
        tr[i] = Math.max(
            highs[i] - lows[i],
            Math.abs(highs[i] - closes[i - 1]),
            Math.abs(lows[i] - closes[i - 1])
        );
    }
    if (n <= p) {
        let s = 0;
        for (let i = 0; i < n; i++) s += tr[i];
        const a = s / n;
        out.fill(a);
        return out;
    }
    let atr = 0;
    for (let i = 0; i < p; i++) atr += tr[i];
    atr /= p;
    for (let i = 0; i < p; i++) out[i] = atr;
    for (let i = p; i < n; i++) {
        atr = (atr * (p - 1) + tr[i]) / p;
        out[i] = atr;
    }
    return out;
}

function rsiArr(closes, p = 14) {
    const n = closes.length;
    const out = new Float64Array(n);
    out.fill(NaN);
    if (n <= p) return out;
    let avgG = 0, avgL = 0;
    for (let i = 1; i <= p; i++) {
        const d = closes[i] - closes[i - 1];
        if (d >= 0) avgG += d; else avgL -= d;
    }
    avgG /= p; avgL /= p;
    out[p] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
    for (let i = p + 1; i < n; i++) {
        const d = closes[i] - closes[i - 1];
        const g = d > 0 ? d : 0;
        const l = d < 0 ? -d : 0;
        avgG = (avgG * (p - 1) + g) / p;
        avgL = (avgL * (p - 1) + l) / p;
        out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
    }
    return out;
}

function macdHist(closes) {
    const e12 = emaArr(closes, 12);
    const e26 = emaArr(closes, 26);
    const n = closes.length;
    const macd = new Float64Array(n);
    for (let i = 0; i < n; i++) macd[i] = e12[i] - e26[i];
    const signal = emaArr(macd, 9);
    const hist = new Float64Array(n);
    for (let i = 0; i < n; i++) hist[i] = macd[i] - signal[i];
    return hist;
}

function smaLast(arr, p, end) {
    const start = Math.max(0, end - p + 1);
    let s = 0, c = 0;
    for (let i = start; i <= end; i++) { s += arr[i]; c++; }
    return c ? s / c : 0;
}

/* ---------- Engines ---------- */
function evalChecklist(d) {
    const { n, highs, lows, closes, vols } = d;
    if (n < 30) return { score: 0, total: 6, trend: 'INSUFFICIENT DATA', reasons: [], level: 'muted' };
    const ema20 = emaArr(closes, 20);
    const ema50 = emaArr(closes, 50);
    const rsi = rsiArr(closes, 14);
    const c = n - 1;
    const reasons = [];
    let score = 0;

    let high20 = -Infinity, volSum = 0;
    for (let i = n - 20; i < n; i++) {
        if (i < 0) continue;
        if (highs[i] > high20) high20 = highs[i];
        volSum += vols[i];
    }
    const avgVol20 = volSum / 20;
    let low20 = Infinity;
    for (let i = n - 20; i < n; i++) { if (i >= 0 && lows[i] < low20) low20 = lows[i]; }
    const rng20 = high20 - low20 || 1;

    if (closes[c] > ema20[c]) { score++; reasons.push('Above EMA20'); }
    if (ema20[c] > ema50[c]) { score++; reasons.push('EMA20>EMA50'); }
    if (closes[c] >= high20 - rng20 * 0.002) { score++; reasons.push('20-bar breakout'); }
    if (vols[c] >= avgVol20 * 1.5) { score++; reasons.push('Vol +50%'); }
    const r = rsi[c];
    if (isFinite(r) && r >= 55 && r <= 78) { score++; reasons.push(`RSI ${r.toFixed(0)}`); }
    const bodyRange = Math.max(highs[c] - lows[c], 1e-9);
    if ((closes[c] - lows[c]) / bodyRange >= 0.65) { score++; reasons.push('Strong close'); }

    let trend, level;
    if (score >= 5) { trend = '🚀 STRONG BULL BREAKOUT'; level = 'success'; }
    else if (score >= 4) { trend = '✅ BULLISH BREAKOUT'; level = 'success'; }
    else if (score === 3) { trend = '⚡ SET-UP FORMING'; level = 'warning'; }
    else if (score === 2) { trend = '➡ NEUTRAL / CHOP'; level = 'muted'; }
    else { trend = '❌ BEARISH / REJECTION'; level = 'danger'; }

    return { score, total: 6, trend, reasons, level };
}

function scanBreakout(d) {
    const def = { detected: false, direction: null, score: 0, pivot: 0, entry: 0, sl: 0, target: 0, volRatio: 0, reasons: [] };
    const { n, highs, lows, closes, vols } = d;
    if (n < 30) return def;

    const atrA = rmaATR(highs, lows, closes, 14);
    const atr = atrA[n - 1] || 0;
    const ema20 = emaArr(closes, 20);
    const ema50 = emaArr(closes, 50);
    const rsi = rsiArr(closes, 14);
    const hist = macdHist(closes);

    let pivotHigh = -Infinity, pivotLow = Infinity;
    for (let i = n - 21; i < n - 1; i++) {
        if (i < 0) continue;
        if (highs[i] > pivotHigh) pivotHigh = highs[i];
        if (lows[i] < pivotLow) pivotLow = lows[i];
    }

    let baseRange = 0;
    for (let i = n - 6; i < n; i++) baseRange += highs[i] - lows[i];
    baseRange /= 6;
    const tightBase = atr > 0 && baseRange < 0.8 * atr;

    const volAvg20 = smaLast(vols, 20, n - 1);
    const volAvg5 = smaLast(vols, 5, n - 1);
    const dryUp = volAvg5 < 0.85 * volAvg20;
    const volRatio = volAvg20 > 0 ? vols[n - 1] / volAvg20 : 0;

    // Rolling BB width median (O(n))
    const bbWidths = [];
    let rollSum = 0, rollSq = 0;
    for (let i = 0; i < n; i++) {
        rollSum += closes[i];
        rollSq += closes[i] * closes[i];
        if (i >= 20) {
            rollSum -= closes[i - 20];
            rollSq -= closes[i - 20] * closes[i - 20];
        }
        if (i >= 19) {
            const m = rollSum / 20;
            const v = Math.max(0, rollSq / 20 - m * m);
            if (m > 0) bbWidths.push((4 * Math.sqrt(v)) / m);
        }
    }
    const bbWidth = bbWidths.length ? bbWidths[bbWidths.length - 1] : 0;
    const sorted = bbWidths.slice().sort((a, b) => a - b);
    const bbMedian = sorted.length ? sorted[sorted.length >> 1] : bbWidth;
    const squeeze = bbWidth > 0 && bbWidth < bbMedian * 0.85;

    const last = n - 1;
    const range = highs[last] - lows[last];
    const closePos = range > 0 ? (closes[last] - lows[last]) / range : 0.5;
    const r = rsi[last];
    const macdH = hist[last];
    const macdHp = last > 0 ? hist[last - 1] : 0;

    let longScore = 0, shortScore = 0;
    const longReasons = [], shortReasons = [];

    if (closes[last] > pivotHigh) {
        if (closePos > 0.65) { longScore += 2; longReasons.push('Strong close (upper 35%)'); }
        else longReasons.push('⚠ Weak close / wick breakout');
        if (volRatio >= 1.5) { longScore += 2; longReasons.push(`Volume ${volRatio.toFixed(1)}x`); }
        else longReasons.push(`Volume only ${volRatio.toFixed(1)}x`);
        if (tightBase) { longScore += 2; longReasons.push('Tight base/coil'); }
        if (dryUp) { longScore += 1; longReasons.push('Volume dry-up'); }
        if (squeeze) { longScore += 1; longReasons.push('BB Squeeze'); }
        if (ema20[last] > ema50[last]) { longScore += 1; longReasons.push('EMA20>EMA50'); }
        if (isFinite(r) && r > 45 && r < 72) { longScore += 1; longReasons.push(`RSI ${r.toFixed(0)}`); }
        if (macdH > 0 && macdH >= macdHp) longScore += 1;
    }

    if (closes[last] < pivotLow) {
        if (closePos < 0.35) { shortScore += 2; shortReasons.push('Strong close (lower 35%)'); }
        if (volRatio >= 1.5) { shortScore += 2; shortReasons.push(`Volume ${volRatio.toFixed(1)}x`); }
        if (tightBase) { shortScore += 2; shortReasons.push('Tight base'); }
        if (dryUp) shortScore += 1;
        if (squeeze) shortScore += 1;
        if (ema20[last] < ema50[last]) shortScore += 1;
        if (isFinite(r) && r < 55 && r > 28) shortScore += 1;
        if (macdH < 0 && macdH <= macdHp) shortScore += 1;
    }

    if (longScore >= 5) {
        let slBase = Infinity;
        for (let i = n - 6; i < n; i++) if (lows[i] < slBase) slBase = lows[i];
        const sl = slBase - 0.25 * atr;
        const risk = closes[last] - sl;
        return {
            detected: true, direction: 'LONG', score: longScore,
            pivot: +pivotHigh.toFixed(2), entry: +closes[last].toFixed(2),
            sl: +sl.toFixed(2), target: +(closes[last] + 2 * risk).toFixed(2),
            target1: +(closes[last] + risk).toFixed(2),
            volRatio: +volRatio.toFixed(2), atr: +atr.toFixed(2), rr: risk > 0 ? 2 : 0,
            grade: longScore >= 8 ? '🔥 HIGH CONVICTION' : longScore >= 6 ? '✅ VALID' : '⚠️ WATCH',
            reasons: longReasons,
        };
    }
    if (shortScore >= 5) {
        let slBase = -Infinity;
        for (let i = n - 6; i < n; i++) if (highs[i] > slBase) slBase = highs[i];
        const sl = slBase + 0.25 * atr;
        const risk = sl - closes[last];
        return {
            detected: true, direction: 'SHORT', score: shortScore,
            pivot: +pivotLow.toFixed(2), entry: +closes[last].toFixed(2),
            sl: +sl.toFixed(2), target: +(closes[last] - 2 * risk).toFixed(2),
            target1: +(closes[last] - risk).toFixed(2),
            volRatio: +volRatio.toFixed(2), atr: +atr.toFixed(2), rr: risk > 0 ? 2 : 0,
            grade: shortScore >= 8 ? '🔥 HIGH CONVICTION' : shortScore >= 6 ? '✅ VALID' : '⚠️ WATCH',
            reasons: shortReasons,
        };
    }
    if (squeeze && tightBase) {
        return {
            ...def,
            reasons: [`Coil forming — wait breakout above ${pivotHigh.toFixed(2)} or below ${pivotLow.toFixed(2)}`],
            coming: { pivotLong: +pivotHigh.toFixed(2), pivotShort: +pivotLow.toFixed(2), dryUp },
        };
    }
    return def;
}

function bigCandle(d, tf) {
    const defaults = { forming: false, label: '—', level: 'muted', dir: null, magnitude: 0 };
    const { n, times, opens, closes, vols } = d;
    if (n < 12) return defaults;
    const tfMinMap = { '1': 1, '3': 3, '5': 5, '15': 15, '30': 30, '60': 60, 'D': 1440 };
    const tfSec = (tfMinMap[tf] || 15) * 60;
    const body = Math.abs(closes[n - 1] - opens[n - 1]);
    const dir = closes[n - 1] >= opens[n - 1] ? 'bull' : 'bear';
    let sumB = 0, sumV = 0;
    for (let i = n - 11; i < n - 1; i++) {
        sumB += Math.abs(closes[i] - opens[i]);
        sumV += vols[i];
    }
    const avgBody = sumB / 10;
    const avgVol = sumV / 10;
    if (avgBody <= 0 || avgVol <= 0) return { ...defaults, magnitude: 0, volRatio: 0 };

    const now = Math.floor(Date.now() / 1000);
    const since = Math.max(0, now - times[n - 1]);
    const pct = tfSec > 0 ? Math.min(since / tfSec, 1) : 1;
    const forming = pct >= 0.4 && pct < 0.95;
    const mag = body / avgBody;
    const volRatio = vols[n - 1] / avgVol;
    const bigEnough = mag >= 1.8 && volRatio >= 1.2;

    if (forming && bigEnough) {
        return {
            forming: true, fresh: true,
            label: `${dir === 'bull' ? '▲' : '▼'} BIG ${dir.toUpperCase()} ${mag.toFixed(1)}x forming!`,
            level: dir === 'bull' ? 'success' : 'danger',
            dir, magnitude: mag, volRatio,
        };
    }
    return { ...defaults, magnitude: mag, volRatio };
}

function candlePatterns(d, settings) {
    const markers = [];
    if (!settings || !settings.master) return markers;
    const { n, times, opens, highs, lows, closes } = d;
    if (n < 10) return markers;
    let lastIndex = -5;
    for (let i = 5; i < n; i++) {
        if (i - lastIndex < 4) continue;
        const body = Math.abs(closes[i] - opens[i]);
        const totalRange = highs[i] - lows[i];
        if (totalRange === 0) continue;
        const upperWick = highs[i] - Math.max(opens[i], closes[i]);
        const lowerWick = Math.min(opens[i], closes[i]) - lows[i];

        let isSwingLow = true, isSwingHigh = true;
        const from = Math.max(0, i - 4);
        const to = Math.min(n - 1, i + 2);
        for (let j = from; j <= to; j++) {
            if (j === i) continue;
            if (lows[j] < lows[i]) isSwingLow = false;
            if (highs[j] > highs[i]) isSwingHigh = false;
        }
        const cTime = times[i];

        if (settings.hammer) {
            if (isSwingLow && lowerWick >= body * 2.5 && upperWick <= body * 0.5 && body > totalRange * 0.1) {
                markers.push({ time: cTime, position: 'belowBar', color: '#089981', shape: 'arrowUp', text: '🔨 Hammer', size: 1 });
                lastIndex = i; continue;
            }
            if (isSwingHigh && upperWick >= body * 2.5 && lowerWick <= body * 0.5 && body > totalRange * 0.1) {
                markers.push({ time: cTime, position: 'aboveBar', color: '#f23645', shape: 'arrowDown', text: '💫 Shooting Star', size: 1 });
                lastIndex = i; continue;
            }
        }
        if (settings.engulfing) {
            if (isSwingLow && closes[i - 1] < opens[i - 1] && closes[i] > opens[i] &&
                closes[i] > opens[i - 1] && opens[i] < closes[i - 1]) {
                markers.push({ time: cTime, position: 'belowBar', color: '#089981', shape: 'arrowUp', text: '🐂 Bull Engulf', size: 1 });
                lastIndex = i; continue;
            }
            if (isSwingHigh && closes[i - 1] > opens[i - 1] && closes[i] < opens[i] &&
                closes[i] < opens[i - 1] && opens[i] > closes[i - 1]) {
                markers.push({ time: cTime, position: 'aboveBar', color: '#f23645', shape: 'arrowDown', text: '🐻 Bear Engulf', size: 1 });
                lastIndex = i; continue;
            }
        }
        if (settings.star && i >= 2) {
            const midBody = Math.abs(closes[i - 1] - opens[i - 1]);
            const p2Body = Math.abs(closes[i - 2] - opens[i - 2]);
            if (isSwingLow && closes[i - 2] < opens[i - 2] && midBody < p2Body * 0.4 &&
                closes[i] > (opens[i - 2] + closes[i - 2]) / 2 && closes[i] > opens[i]) {
                markers.push({ time: cTime, position: 'belowBar', color: '#2196F3', shape: 'arrowUp', text: '🌅 Morning Star', size: 1 });
                lastIndex = i; continue;
            }
            if (isSwingHigh && closes[i - 2] > opens[i - 2] && midBody < p2Body * 0.4 &&
                closes[i] < (opens[i - 2] + closes[i - 2]) / 2 && closes[i] < opens[i]) {
                markers.push({ time: cTime, position: 'aboveBar', color: '#E91E63', shape: 'arrowDown', text: '🌆 Evening Star', size: 1 });
                lastIndex = i; continue;
            }
        }
        if (settings.doji) {
            if (body <= totalRange * 0.1 && (isSwingHigh || isSwingLow)) {
                markers.push({
                    time: cTime,
                    position: isSwingHigh ? 'aboveBar' : 'belowBar',
                    color: '#FFC107', shape: 'circle', text: '⚖️ Doji', size: 1,
                });
                lastIndex = i;
            }
        }
    }
    return markers;
}

function closingTrap(d, tf) {
    const nowIST = new Date(Date.now() + 5.5 * 3600 * 1000);
    const t = nowIST.getUTCHours() * 60 + nowIST.getUTCMinutes();
    const inWindow = t >= (15 * 60 + 15) && t <= (15 * 60 + 30);
    const nearEOD = t >= (14 * 60 + 45) && t < (15 * 60 + 15);
    if (tf === 'D' || tf === '60')
        return { trap: false, active: false, label: 'N/A', level: 'muted', direction: null };
    const { n, closes, vols } = d;
    if (n < 10)
        return { trap: false, active: inWindow, label: inWindow ? 'WATCHING' : '-', level: 'muted', direction: null };

    let vol10 = 0;
    for (let i = n - 10; i < n; i++) vol10 += vols[i];
    vol10 /= 10;
    const dir10 = closes[n - 1] - closes[n - 10];
    const dir3 = closes[n - 1] - closes[n - 3];
    let trap = false, direction = null;
    if (inWindow) {
        if (dir10 > 0 && dir3 < -Math.abs(dir10) * 0.35 && vols[n - 1] < vol10 * 0.9) {
            trap = true; direction = 'bear';
        } else if (dir10 < 0 && dir3 > Math.abs(dir10) * 0.35 && vols[n - 1] < vol10 * 0.9) {
            trap = true; direction = 'bull';
        }
    }
    let label, level;
    if (trap) {
        label = direction === 'bear' ? 'SELL TRAP' : 'BUY TRAP';
        level = direction === 'bear' ? 'danger' : 'success';
    } else if (inWindow) { label = 'WATCHING'; level = 'warning'; }
    else if (nearEOD) { label = 'APPROACHING'; level = 'muted'; }
    else { label = 'INACTIVE (3:15-3:30 PM IST)'; level = 'muted'; }
    return { trap, active: inWindow, label, level, direction };
}

function divergences(d) {
    const out = { detected: false, label: '⚪ NONE', level: 'muted', direction: null, details: null };
    const { n, highs, lows, closes } = d;
    if (n < 30) return out;
    const rsi = rsiArr(closes, 14);
    const look = Math.min(60, n);
    const start = n - look;
    const pivotLows = [], pivotHighs = [];
    for (let i = start + 3; i < n - 2; i++) {
        let isLL = true, isHH = true;
        for (let j = 1; j <= 3; j++) {
            if (lows[i] >= lows[i - j] || lows[i] >= lows[i + j]) isLL = false;
            if (highs[i] <= highs[i - j] || highs[i] <= highs[i + j]) isHH = false;
        }
        if (isLL && isFinite(rsi[i])) pivotLows.push({ i, price: lows[i], rsi: rsi[i] });
        if (isHH && isFinite(rsi[i])) pivotHighs.push({ i, price: highs[i], rsi: rsi[i] });
    }
    if (pivotLows.length >= 2) {
        const prev = pivotLows[pivotLows.length - 2];
        const cur = pivotLows[pivotLows.length - 1];
        if (cur.price < prev.price && cur.rsi > prev.rsi + 2) {
            return { detected: true, label: '🟢 BULL DIV', level: 'success', direction: 'bullish', details: { prev, cur } };
        }
    }
    if (pivotHighs.length >= 2) {
        const prev = pivotHighs[pivotHighs.length - 2];
        const cur = pivotHighs[pivotHighs.length - 1];
        if (cur.price > prev.price && cur.rsi < prev.rsi - 2) {
            return { detected: true, label: '🔴 BEAR DIV', level: 'danger', direction: 'bearish', details: { prev, cur } };
        }
    }
    return out;
}

function doubleBottom(d) {
    const { n, highs, lows, closes } = d;
    if (n < 40) return { detected: false, pattern: null, label: '—', level: 'muted' };
    const look = Math.min(60, n - 3);
    const lowsArr = [];
    for (let i = n - 2; i >= n - look; i--) {
        const wL = 3, wR = Math.min(3, n - 1 - i);
        if (wR < 1) continue;
        let ok = true;
        for (let j = 1; j <= wL && ok; j++) if (i - j < 0 || lows[i] >= lows[i - j]) ok = false;
        for (let j = 1; j <= wR && ok; j++) if (lows[i] >= lows[i + j]) ok = false;
        if (ok) lowsArr.push({ i, val: lows[i] });
        if (lowsArr.length >= 4) break;
    }
    lowsArr.sort((a, b) => a.i - b.i);
    for (let a = 0; a < lowsArr.length - 1; a++) {
        for (let b = a + 1; b < lowsArr.length; b++) {
            const A = lowsArr[a], B = lowsArr[b];
            if (B.i - A.i < 5 || B.i - A.i > 35) continue;
            if (Math.abs(A.val - B.val) / Math.min(A.val, B.val) > 0.025) continue;
            let neckline = -Infinity;
            for (let k = A.i; k <= B.i; k++) if (highs[k] > neckline) neckline = highs[k];
            if (neckline < Math.max(A.val, B.val) * 1.02) continue;
            let confirmed = false;
            for (let k = B.i; k < n; k++) if (closes[k] >= neckline) { confirmed = true; break; }
            const near = closes[n - 1] >= neckline * 0.99;
            if (confirmed || near) {
                return {
                    detected: true, pattern: 'DOUBLE BOTTOM', label: '🟢 W-BOTTOM', level: 'success',
                    target: neckline + (neckline - Math.min(A.val, B.val)),
                };
            }
        }
    }
    // double top
    const highsArr = [];
    for (let i = n - 2; i >= n - look; i--) {
        const wL = 3, wR = Math.min(3, n - 1 - i);
        if (wR < 1) continue;
        let ok = true;
        for (let j = 1; j <= wL && ok; j++) if (i - j < 0 || highs[i] <= highs[i - j]) ok = false;
        for (let j = 1; j <= wR && ok; j++) if (highs[i] <= highs[i + j]) ok = false;
        if (ok) highsArr.push({ i, val: highs[i] });
        if (highsArr.length >= 4) break;
    }
    highsArr.sort((a, b) => a.i - b.i);
    for (let a = 0; a < highsArr.length - 1; a++) {
        for (let b = a + 1; b < highsArr.length; b++) {
            const A = highsArr[a], B = highsArr[b];
            if (B.i - A.i < 5 || B.i - A.i > 35) continue;
            if (Math.abs(A.val - B.val) / Math.max(A.val, B.val) > 0.025) continue;
            let neckline = Infinity;
            for (let k = A.i; k <= B.i; k++) if (lows[k] < neckline) neckline = lows[k];
            if (neckline > Math.min(A.val, B.val) * 0.98) continue;
            let confirmed = false;
            for (let k = B.i; k < n; k++) if (closes[k] <= neckline) { confirmed = true; break; }
            if (confirmed) {
                return {
                    detected: true, pattern: 'DOUBLE TOP', label: '🔴 M-TOP', level: 'danger',
                    target: neckline - (Math.max(A.val, B.val) - neckline),
                };
            }
        }
    }
    return { detected: false, pattern: null, label: '⚪ NONE', level: 'muted' };
}

function flagPattern(d) {
    const { n, highs, lows, closes } = d;
    if (n < 30) return { detected: false, label: '—', level: 'muted', dir: null };
    const atrA = rmaATR(highs, lows, closes, 14);
    const curAtr = atrA[n - 1];
    if (!curAtr || curAtr <= 0) return { detected: false, label: '⚪ NONE', level: 'muted', dir: null };

    for (let impLen = 4; impLen <= 9; impLen++) {
        const start = n - 1 - impLen - 12;
        if (start < 1) continue;
        const impulseEnd = start + impLen;
        const move = closes[impulseEnd] - closes[start];
        if (Math.abs(move) / curAtr < 2.5) continue;
        const dir = move > 0 ? 'bull' : 'bear';
        const cLen = n - impulseEnd;
        if (cLen < 3 || cLen > 12) continue;
        let cHigh = -Infinity, cLow = Infinity;
        for (let i = impulseEnd; i < n; i++) {
            if (highs[i] > cHigh) cHigh = highs[i];
            if (lows[i] < cLow) cLow = lows[i];
        }
        if ((cHigh - cLow) / curAtr > 2.5) continue;
        const slope = (closes[n - 1] - closes[impulseEnd]) / closes[impulseEnd];
        const counter = dir === 'bull' ? slope < 0.01 : slope > -0.01;
        if (!counter) continue;
        if (dir === 'bull' && closes[n - 1] >= cHigh)
            return { detected: true, label: '🚩 BULL FLAG BREAKOUT', level: 'success', dir };
        if (dir === 'bear' && closes[n - 1] <= cLow)
            return { detected: true, label: '🚩 BEAR FLAG BREAKDOWN', level: 'danger', dir };
        return {
            detected: true,
            label: dir === 'bull' ? '🟡 BULL FLAG FORMING' : '🟡 BEAR FLAG FORMING',
            level: 'warning', dir,
        };
    }
    return { detected: false, label: '⚪ NONE', level: 'muted', dir: null };
}

/* ---------- Message handler ---------- */
self.onmessage = (e) => {
    const msg = e.data;
    if (!msg || msg.type !== 'analyze') return;
    try {
        const d = unpack(msg.payload);
        const tf = msg.tf || '15';
        const settings = { master: true, hammer: true, engulfing: true, star: true, doji: true };
        const result = {
            checklist: evalChecklist(d),
            breakout: scanBreakout(d),
            bigCandle: bigCandle(d, tf),
            patterns: candlePatterns(d, settings),
            closingTrap: closingTrap(d, tf),
            divergence: divergences(d),
            doubleBottom: doubleBottom(d),
            flag: flagPattern(d),
            meta: { n: d.n, tf, symbol: msg.symbol || '', ts: Date.now() },
        };
        self.postMessage({ type: 'result', id: msg.id, result });
    } catch (err) {
        self.postMessage({ type: 'result', id: msg.id, result: null, error: String(err) });
    }
};
