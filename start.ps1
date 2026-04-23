#Requires -Version 5.1
# Thin wrapper: launches the Python dev supervisor. The supervisor handles the
# Ctrl+C restart / double-tap exit logic reliably (see dev_supervisor.py).
$ErrorActionPreference = "Continue"

Set-Location -Path $PSScriptRoot

$venvPython = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    Write-Error "Venv python not found at $venvPython. Create it: py -3.11 -m venv .venv"
    exit 1
}
if (-not (Test-Path "dist\index.html")) {
    Write-Warning "dist\index.html not found - frontend will 404. Run 'pnpm install; pnpm build' first."
}

# Ensure Ollama is reachable on 11434. If not, spawn `ollama serve` in its own
# window so it keeps running across supervisor Ctrl+C restarts (restarting the
# app shouldn't force a 14B model reload).
$ollamaUp = $false
try {
    $r = Invoke-WebRequest -Uri "http://localhost:11434/api/tags" -UseBasicParsing -TimeoutSec 1 -ErrorAction Stop
    $ollamaUp = $r.StatusCode -eq 200
} catch {}

if ($ollamaUp) {
    Write-Host "Ollama already running on :11434" -ForegroundColor Green
} else {
    $ollamaExe = (Get-Command ollama -ErrorAction SilentlyContinue).Source
    if ($ollamaExe) {
        Write-Host "Starting Ollama in a new window..." -ForegroundColor Cyan
        Start-Process -FilePath $ollamaExe -ArgumentList "serve" -WindowStyle Normal
        Start-Sleep -Seconds 2
    } else {
        Write-Warning "ollama not on PATH - TTS normalization will be skipped. Install from https://ollama.com/download."
    }
}

& $venvPython (Join-Path $PSScriptRoot "dev_supervisor.py")
