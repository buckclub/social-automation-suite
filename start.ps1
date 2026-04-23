#Requires -Version 5.1
# Dev loop: Ctrl+C restarts the server, Ctrl+C x2 (within 2s) exits.
$ErrorActionPreference = "Continue"

Set-Location -Path $PSScriptRoot

$probePython = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"
if (-not (Test-Path $probePython)) {
    Write-Error "Venv python not found at $probePython. Create it: py -3.11 -m venv .venv"
    exit 1
}
if (-not (Test-Path "dist\index.html")) {
    Write-Warning "dist\index.html not found - frontend will 404. Run 'pnpm install; pnpm build' first."
}

# Ctrl+C handler: first press cancels (python dies, loop continues); second within 2s exits.
$global:RtR_LastBreak = [DateTime]::MinValue
try {
    $cancelHandler = [System.ConsoleCancelEventHandler] {
        param($s, $e)
        $now = [DateTime]::Now
        if (($now - $global:RtR_LastBreak).TotalSeconds -lt 2) {
            $e.Cancel = $false
        } else {
            $e.Cancel = $true
            $global:RtR_LastBreak = $now
        }
    }
    [Console]::add_CancelKeyPress($cancelHandler)
} catch {
    Write-Warning "Could not install Ctrl+C handler; loop may exit on first Ctrl+C. $_"
}

Write-Host ""
Write-Host "Reddit-to-Reels dev loop" -ForegroundColor Cyan
Write-Host "  Ctrl+C        -> restart server" -ForegroundColor DarkCyan
Write-Host "  Ctrl+C x2     -> exit loop (within 2s)" -ForegroundColor DarkCyan
Write-Host ""

while ($true) {
    # Recompute every iteration so nothing in the previous run can null this out.
    $pythonExe = Join-Path $PSScriptRoot ".venv\Scripts\python.exe"

    $existing = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
    if ($existing) {
        $occupyingPids = ($existing | Select-Object -ExpandProperty OwningProcess -Unique) -join ","
        Write-Host "! Port 8000 already in use by PID(s): $occupyingPids - the server will fail to bind." -ForegroundColor Red
    }

    Write-Host "> Starting server on http://localhost:8000 ..." -ForegroundColor Green
    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    & $pythonExe run_server.py
    $code = $LASTEXITCODE
    $sw.Stop()

    $pause = if ($sw.Elapsed.TotalSeconds -lt 2) { 4 } else { 1 }
    Write-Host ("< Server stopped (exit={0}, ran {1:N1}s). Restarting in {2}s (Ctrl+C again to exit)..." -f $code, $sw.Elapsed.TotalSeconds, $pause) -ForegroundColor Yellow
    Start-Sleep -Seconds $pause
}
