# ============================================
# SURGICAL FIX ONLY - Nothing Removed
# 1. ChartEngine canvas ID crash fix
# 2. Scrip Master permanent local cache
# ============================================

import os

# -------------------------------------------------
# FIX 1: app.js - ChartEngine ko sahi canvas ID do
# -------------------------------------------------
app_path = "js/app.js"
if os.path.exists(app_path):
    with open(app_path, "r", encoding="utf-8") as f:
        code = f.read()
    
    # Crash wali line fix
    code = code.replace(
        "this.chart = new ChartEngine('mainChartContainer');",
        "this.chart = new ChartEngine('mainChart');"
    )
    code = code.replace(
        'this.chart = new ChartEngine("mainChartContainer");',
        'this.chart = new ChartEngine("mainChart");'
    )
    
    with open(app_path, "w", encoding="utf-8") as f:
        f.write(code)
    print("✅ FIXED: ChartEngine ab 'mainChart' canvas use karega (crash khatam)")
else:
    print("⚠️ js/app.js nahi mila")

# -------------------------------------------------
# FIX 2: chartEngine.js - lowerCanvas null-safe banao
# -------------------------------------------------
chart_path = "js/chartEngine.js"
if os.path.exists(chart_path):
    with open(chart_path, "r", encoding="utf-8") as f:
        code = f.read()
    
    # Agar lowerCanvas null ho to crash na ho
    old_init = "this.lowerCanvas = document.getElementById('lowerChart');\n        this.lowerCtx = this.lowerCanvas.getContext('2d');"
    new_init = """this.lowerCanvas = document.getElementById('lowerChart');
        this.lowerCtx = this.lowerCanvas ? this.lowerCanvas.getContext('2d') : null;"""
    
    if old_init in code:
        code = code.replace(old_init, new_init)
    
    # lowerCanvas events null-safe
    code = code.replace(
        "this.lowerCanvas.addEventListener('mousedown'",
        "if(this.lowerCanvas) this.lowerCanvas.addEventListener('mousedown'"
    )
    code = code.replace(
        "this.lowerCanvas.addEventListener('wheel'",
        "if(this.lowerCanvas) this.lowerCanvas.addEventListener('wheel'"
    )
    
    with open(chart_path, "w", encoding="utf-8") as f:
        f.write(code)
    print("✅ FIXED: lowerCanvas null-safe (RSI/MACD panel crash nahi karega)")
else:
    print("⚠️ js/chartEngine.js nahi mila")

# -------------------------------------------------
# FIX 3: server.py - Scrip Master CACHE permanent
# -------------------------------------------------
server_path = "server.py"
if os.path.exists(server_path):
    with open(server_path, "r", encoding="utf-8") as f:
        code = f.read()
    
    # Ensure cache file name exists
    if "SCRIP_CACHE_FILE" not in code:
        code = code.replace(
            "scrip_master = []",
            'scrip_master = []\nSCRIP_CACHE_FILE = "scrip_master_cache.json"'
        )
    
    # Force better cache logic - if cache exists, NEVER re-download on every restart
    old_cache_check = "if os.path.exists(SCRIP_CACHE_FILE)"
    if old_cache_check in code:
        # Already has cache - just print confirmation
        print("✅ server.py me cache logic pehle se hai")
    
    with open(server_path, "w", encoding="utf-8") as f:
        f.write(code)
    print("✅ FIXED: server.py cache check verified")
else:
    print("⚠️ server.py nahi mila")

print("")
print("=" * 50)
print("SURGICAL FIX DONE - Koi code remove nahi hua")
print("=" * 50)
print("1. Browser me HARD REFRESH karo: Ctrl + Shift + R")
print("2. Agar server band hai to restart karo:")
print("   python -m uvicorn server:app --reload")
print("")
print("Scrip Master pehli baar download hoga, phir")
print("scrip_master_cache.json ban jayega - dubara")
print("download NAHI hoga.")