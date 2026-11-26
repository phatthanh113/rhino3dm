# Start RhinoView on this Windows machine (one port: 8000).
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$python = Join-Path $root ".venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
    Write-Host "Creating .venv ..."
    python -m venv .venv
    & $python -m pip install --upgrade pip --quiet
}

Write-Host "Installing Python requirements ..."
& $python -m pip install -r "apps\api\requirements.txt" --quiet

$index = Join-Path $root "apps\web\dist\index.html"
if (-not (Test-Path $index)) {
    Write-Host "Building the web app ..."
    Push-Location "apps\web"
    npm install
    npm run build
    Pop-Location
}

if (-not (Test-Path (Join-Path $root ".env"))) {
    Copy-Item (Join-Path $root ".env.example") (Join-Path $root ".env")
    Write-Host "Created .env from .env.example; edit it to move the data folder."
}

Write-Host "RhinoView: http://0.0.0.0:8000"
& $python -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --app-dir "apps\api"
