/* ============================================================
 * MasterProEngine — Institutional-grade signal aggregator
 * Combines: Bollinger Squeeze, Wyckoff VSA, MACD momentum, RSI regime
 * ============================================================ */
class MasterProEngine {
    analyze(candles) {
        if (!candles || candles.length < 30) {
            return {
                squeeze: { active: false, label: '—', level: 'muted' },
                vsa:     { label: '—', level: 'muted' },
                macd:    { label: '—', level: 'muted' },
                rsi:     { label: '—', level: 'muted' },
                score:   0,
            };
        }

        // 1) BOLLINGER SQUEEZE: BB-width vs Keltner width (simple dual-band proxy)
        const bb = TechnicalIndicators.BollingerBands(candles, 20, 2);
        const atr = TechnicalIndicators.ATR(candles, 20);
        const n = candles.length;
        const widths = [];
        for (let i = 60; i < n; i++) {
            if (bb.width[i] != null) widths.push(bb.width[i]);
        }
        const curW = bb.width[n - 1];
        const avgW = widths.length ? widths.reduce((a, b) => a + b, 0) / widths.length : curW;
        const minW = widths.length ? Math.min(...widths.slice(-60)) : curW;
        let squeezeLabel = 'NORMAL';
        let squeezeLevel = 'muted';
        let squeezeActive = false;
        if (curW < avgW * 0.55 || curW <= minW * 1.1) {
            squeezeLabel = '⚡ SQUEEZE';
            squeezeLevel = 'warning';
            squeezeActive = true;
        } else if (curW > avgW * 1.5) {
            squeezeLabel = '🌋 EXPANSION';
            squeezeLevel = 'info';
        } else {
            squeezeLabel = 'NORMAL';
            squeezeLevel = 'muted';
        }

        // 2) WYCKOFF VSA: compare last candle volume to 20-period avg + body vs range
        const vols = candles.slice(-20).map(c => c.volume || 0);
        const avgVol = vols.reduce((a, b) => a + b, 0) / vols.length;
        const last = candles[n - 1];
        const volRatio = (last.volume || 0) / Math.max(avgVol, 1);
        const body = Math.abs(last.close - last.open);
        const range = Math.max(last.high - last.low, 1e-9);
        const closeLoc = (last.close - last.low) / range; // 0=L, 1=H
        let vsaLabel = 'NORMAL VOLUME';
        let vsaLevel = 'muted';
        if (volRatio >= 1.8 && closeLoc > 0.75) { vsaLabel = '🔥 CLIMACTIC BUYING'; vsaLevel = 'success'; }
        else if (volRatio >= 1.8 && closeLoc < 0.25) { vsaLabel = '💥 CLIMACTIC SELLING'; vsaLevel = 'danger'; }
        else if (volRatio >= 1.5 && closeLoc > 0.6 && body < range * 0.4) { vsaLabel = '🧽 ABSORPTION'; vsaLevel = 'info'; }
        else if (volRatio <= 0.6) { vsaLabel = '🧊 LOW VOL / DRY-UP'; vsaLevel = 'warning'; }
        else { vsaLabel = 'NORMAL VOLUME'; vsaLevel = 'muted'; }

        // 3) MACD MOMENTUM: histogram slope + sign
        const macd = TechnicalIndicators.MACD(candles);
        let macdLabel = 'NEUTRAL';
        let macdLevel = 'muted';
        const h = macd.hist[n - 1], hPrev = macd.hist[n - 2], hPrev2 = macd.hist[n - 3];
        if (h != null && hPrev != null) {
            if (h > 0 && h > hPrev)       { macdLabel = '🟢 BULLISH ACCEL'; macdLevel = 'success'; }
            else if (h > 0 && h < hPrev)  { macdLabel = '🟡 BULL DECEL';    macdLevel = 'warning'; }
            else if (h < 0 && h < hPrev)  { macdLabel = '🔴 BEARISH ACCEL'; macdLevel = 'danger'; }
            else if (h < 0 && h > hPrev)  { macdLabel = '🟠 BEAR DECEL';    macdLevel = 'warning'; }
            if (hPrev2 != null && ((h > 0 && hPrev <= 0) || (h < 0 && hPrev >= 0))) {
                macdLabel = h > 0 ? '✨ BULL CROSSOVER' : '⚠️ BEAR CROSSOVER';
                macdLevel = h > 0 ? 'success' : 'danger';
            }
        }

        // 4) RSI REGIME (must be valid 0-100 number; early bars return 0 which is not an oversold signal)
        const rsiArr = TechnicalIndicators.RSI(candles, 14);
        let rsi = rsiArr[n - 1];
        if (!isFinite(rsi) || rsi <= 0 || rsi >= 100) rsi = 50;  // invalid / not enough data → neutral
        let rsiLabel = 'NEUTRAL';
        let rsiLevel = 'muted';
        if (rsi >= 70)      { rsiLabel = '🔥 OVERBOUGHT'; rsiLevel = 'danger'; }
        else if (rsi >= 60) { rsiLabel = '↗ BULL ZONE';   rsiLevel = 'success'; }
        else if (rsi <= 30) { rsiLabel = '🧊 OVERSOLD';   rsiLevel = 'success'; }
        else if (rsi <= 40) { rsiLabel = '↘ BEAR ZONE';   rsiLevel = 'danger'; }
        else                { rsiLabel = '➡ NEUTRAL';     rsiLevel = 'muted'; }

        // Composite score (-4 to +4)
        let score = 0;
        if (squeezeActive) score += 0; // squeeze is direction-neutral
        if (vsaLevel === 'success') score += 1;
        if (vsaLevel === 'danger') score -= 1;
        if (macdLevel === 'success') score += 1;
        if (macdLevel === 'danger') score -= 1;
        if (rsiLevel === 'success' && rsi != null && rsi <= 35) score += 1;
        if (rsiLevel === 'danger' && rsi != null && rsi >= 65) score -= 1;

        return {
            squeeze: { active: squeezeActive, label: squeezeLabel, level: squeezeLevel },
            vsa:     { label: vsaLabel, level: vsaLevel },
            macd:    { label: macdLabel, level: macdLevel },
            rsi:     { label: rsiLabel, level: rsiLevel, value: rsi },
            score,
        };
    }
}
window.MasterProEngine = MasterProEngine;
