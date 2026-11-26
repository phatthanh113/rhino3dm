# Rebuild the React app that FastAPI serves from apps\web\dist.
$ErrorActionPreference = "Stop"

Push-Location (Join-Path $PSScriptRoot "..\apps\web")
npm install
npm run build
Pop-Location

Write-Host "Web app rebuilt: apps\web\dist"
