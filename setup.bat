@echo off
REM ─── GO TO PROJECT FOLDER FIRST ──────────────────
cd /d "%~dp0"
echo [INFO] Working directory: %CD%
echo.
echo ================================================
echo   Trishika Trading Engine - Secure Setup
echo ================================================
echo.

REM ─── CHECK IF .env EXISTS ────────────────────────
if exist .env (
    echo [INFO] .env file already exists
    echo [WARN] Edit it manually if you need to update keys
    goto :INSTALL
)

REM ─── CREATE .env FILE ────────────────────────────
echo [INFO] Creating .env file...
echo.

set /p GROQ_KEY=Enter your GROQ API Key: 
set /p ANGEL_KEY=Enter your Angel One API Key: 
set /p ANGEL_SECRET=Enter your Angel One Secret Key: 
set /p ANGEL_CLIENT=Enter your Angel One Client ID: 
set /p ANGEL_PIN=Enter your Angel One PIN: 
set /p ANGEL_TOTP=Enter your Angel One TOTP Secret: 
set /p TWELVE_KEY=Enter your Twelve Data API Key: 

(
echo # ─── AI ─────────────────────────────────────
echo GROQ_API_KEY=%GROQ_KEY%
echo OLLAMA_URL=http://localhost:11434/api/chat
echo OLLAMA_MODEL=llama3.1:8b
echo FAST_MODEL=tinyllama
echo.
echo # ─── ANGEL ONE ──────────────────────────────
echo ANGEL_API_KEY=%ANGEL_KEY%
echo ANGEL_SECRET=%ANGEL_SECRET%
echo ANGEL_CLIENT_ID=%ANGEL_CLIENT%
echo ANGEL_PIN=%ANGEL_PIN%
echo ANGEL_TOTP_SECRET=%ANGEL_TOTP%
echo.
echo # ─── TWELVE DATA ────────────────────────────
echo TWELVE_DATA_KEY=%TWELVE_KEY%
echo.
echo # ─── SERVER ──────────────────────────────────
echo PORT=3000
echo CANDLE_MS=5000
echo MAX_CANDLES=200
echo ANALYSIS_MS=25000
echo RATE_LIMIT=30
echo ALLOWED_ORIGIN=*
) > .env

echo.
echo [OK] .env created!
echo [WARN] Never share or commit this file!
echo.

findstr /c:".env" .gitignore >nul 2>&1
if errorlevel 1 (
    echo .env >> .gitignore
    echo [OK] .env added to .gitignore
)

:INSTALL
echo.
echo ================================================
echo   Installing dependencies...
echo ================================================
call npm install

echo.
echo ================================================
echo   Setup Complete!
echo   Run: node server.js
echo   Open: http://localhost:3000
echo ================================================
pause
