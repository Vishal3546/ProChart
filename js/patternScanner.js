class PatternScanner {
    constructor() { this.engine = new CandlePatternEngine(); }
    scan(candles) { return { patterns: this.engine.scanAll(candles) }; }
}