@echo off


REM Check if Ollama is already running, if so, kill it first to apply new settings
taskkill /F /IM ollama.exe >nul 2>&1
taskkill /F /IM node.exe >nul 2>&1

REM Set the parallel variable for this session
set OLLAMA_NUM_PARALLEL=2
set OLLAMA_MAX_LOADED_MODELS=1

REM Start Ollama in a new window with a custom title
REM The first quoted string is the Window Title
start "Ollama Server" cmd /c "ollama serve"

REM Give Ollama 5 seconds to fully start up
echo Waiting 3 seconds for Ollama to initialize...
timeout /t 3 /nobreak >nul

echo ========================================
echo Starting MindCraft Bots...
echo ========================================

REM Start the bots (The title set at the top will apply to this window)
start /high node --max-old-space-size=8192 main.js
