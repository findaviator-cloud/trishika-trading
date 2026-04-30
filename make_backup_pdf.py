from fpdf import FPDF
from datetime import datetime
import os

critical_files = [
    "test_next_bar_strategy.py",
    "test_regression.py",
    "param_sweep.py",
    "walk_forward.py",
    "healthcheck.sh",
    "run_backtest.py",
    "src/strategy/donchian.js",
    "src/strategy/live_signal_writer.js",
    "src/strategy/monitor.js",
    "server.js",
    "ecosystem.config.cjs",
    "start_trishika.sh",
    "src/routes/crypto.js",
    "src/candle/index.js",
]

class BackupPDF(FPDF):
    def header(self):
        self.set_font("Courier", "B", 10)
        self.cell(0, 8, "TRISHIKA TRADING - CODE BACKUP", align="C")
        self.ln(5)

    def footer(self):
        self.set_y(-15)
        self.set_font("Courier", "", 8)
        self.cell(0, 10, f"Page {self.page_no()}", align="C")

pdf = BackupPDF()
pdf.set_auto_page_break(auto=True, margin=15)
pdf.add_page()

pdf.set_font("Courier", "B", 14)
pdf.cell(0, 10, "TRISHIKA TRADING", new_x="LMARGIN", new_y="NEXT", align="C")
pdf.cell(0, 10, "Complete Code Backup", new_x="LMARGIN", new_y="NEXT", align="C")
pdf.set_font("Courier", "", 10)
pdf.cell(0, 8, f"Date: {datetime.now().strftime('%Y-%m-%d %H:%M')}", new_x="LMARGIN", new_y="NEXT", align="C")

pdf.ln(10)
pdf.set_font("Courier", "B", 11)
pdf.cell(0, 8, "PRODUCTION CONFIGS", new_x="LMARGIN", new_y="NEXT")
pdf.set_font("Courier", "", 9)

for line in [
    "ETH daily: ls_sma100, don=20, atr_len=14, atr_mult=2.0, sma=100, risk_pct=0.005",
    "  OOS: 33% profit rate, 0.35% mean DD",
    "SOL daily: short_only, don=20, atr_len=14, atr_mult=2.0, risk_pct=0.005",
    "  OOS: 67% profit rate, ~2.3% mean DD",
    "Regression: equity=979.06, trades=13",
    "Daily command: bash healthcheck.sh",
    "",
    "NEW PC SETUP:",
    "  1. pip install pandas numpy fpdf2",
    "  2. npm install",
    "  3. python test_regression.py  (must PASS)",
    "  4. pm2 start ecosystem.config.cjs",
    "  5. bash healthcheck.sh",
    "",
    "Re-create .env manually:",
    "  EXECUTION_ENABLED=true",
    "  EXECUTION_MODE=paper",
    "  ALERT_WEBHOOK_URL=<your webhook>",
    "",
    "FILE INDEX:",
]:
    pdf.cell(0, 5, line, new_x="LMARGIN", new_y="NEXT")

for i, path in enumerate(critical_files, 1):
    exists = "OK" if os.path.exists(path) else "MISSING"
    pdf.cell(0, 5, f"  {i:>2}. {path:<45} [{exists}]", new_x="LMARGIN", new_y="NEXT")

for path in critical_files:
    if not os.path.exists(path):
        continue

    pdf.add_page()
    pdf.set_font("Courier", "B", 10)
    pdf.set_fill_color(220, 220, 220)
    pdf.cell(0, 8, f"FILE: {path}", new_x="LMARGIN", new_y="NEXT", fill=True)
    pdf.set_font("Courier", "", 7)

    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.rstrip().replace("\t", "    ")
            safe = line[:120].encode("latin-1", "replace").decode("latin-1")
            pdf.cell(0, 4, safe, new_x="LMARGIN", new_y="NEXT")

out = f"trishika_backup_{datetime.now().strftime('%Y%m%d')}.pdf"
pdf.output(out)
print(f"PDF saved: {out} ({os.path.getsize(out)//1024} KB) pages={pdf.page_no()}")
