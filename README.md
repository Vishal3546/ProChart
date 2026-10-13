# ProChart Terminal™

> **Advanced AI & Institutional Trading Terminal**

ProChart Terminal™ is a professional, high-performance web-based financial charting and market analysis platform designed for institutional traders, technical analysts, and active market participants.

---

## ✨ Features

- **Interactive High-Performance Charting**: Smooth canvas/SVG rendering with multi-timeframe support (1m, 3m, 5m, 15m, 30m, 1H, 4H, 1D).
- **Institutional Technical Indicators**:
  - Moving Averages (SMA, EMA)
  - Bollinger Bands
  - RSI (Relative Strength Index)
  - MACD, ATR, SuperTrend, VWAP
- **Advanced Pattern Recognition & Engines**:
  - Master Pro Engine
  - Breakout Checklist Engine
  - Candle Patterns Engine
  - Closing Trap Engine
  - Divergence Engine
  - Double Bottom & VCP Pattern Engines
  - Flag Pattern & Order Flow Absorption Engines
  - Pre-Market Gap & Range Analysis
- **Options Greeks & Derivatives Engine**: Real-time Delta, Gamma, Theta, Vega estimation and implied volatility dynamics.
- **Sleek Cyber-Dark Theme**: Built with custom typography (JetBrains Mono & Inter) and glassmorphic UI components.

---

## 🚀 Getting Started

### Prerequisites

No server or database setup required. Just a modern web browser!

### Running Locally

1. Clone the repository:
   ```bash
   git clone https://github.com/Vishal3546/ProChart.git
   ```

2. Open the directory:
   ```bash
   cd ProChart
   ```

3. Launch in your browser:
   - Double-click `index.html` to open directly in Chrome/Edge/Firefox, or
   - Use any static local server (e.g., Live Server in VS Code, `npx serve`, or `python -m http.server 8000`).

---

## 📁 Project Structure

```
ProChart/
├── css/
│   └── styles.css                    # Design system, themes & UI styles
├── js/
│   ├── app.js                        # Main application controller
│   ├── chartEngine.js                # Core charting and rendering logic
│   ├── dataFeed.js                   # Market data simulation and streams
│   ├── indicators.js                 # Technical indicators calculations
│   ├── greeksEngine.js               # Options Greeks analytics
│   ├── candlePatterns.js             # Candlestick pattern detection
│   ├── divergenceEngine.js           # RSI/MACD divergence detector
│   ├── breakoutChecklistEngine.js    # Breakout validation rules
│   ├── closingTrapEngine.js          # Closing session trap scanner
│   ├── vcpPatternEngine.js           # Volatility Contraction Pattern
│   ├── doubleBottomEngine.js         # Double bottom engine
│   ├── flagPatternEngine.js          # Flag & pennant pattern scanner
│   ├── masterProEngine.js            # Combined institutional signal aggregator
│   ├── orderFlowAbsorptionEngine.js  # Order flow absorption analytics
│   ├── patternScanner.js             # Multi-pattern scanner
│   └── preMarketEngine.js            # Pre-market gap analysis
├── index.html                        # Main terminal interface
└── README.md                         # Project documentation
```

---

## 🛠️ Tech Stack

- **HTML5 & CSS3** (Vanilla CSS with custom design tokens)
- **Modern JavaScript (ES6+)**
- **Font Awesome & Google Fonts** (JetBrains Mono & Inter)

---

## 📄 License

This project is licensed under the MIT License.
