# Builds the Android app pointed at your hosted backend and puts it where the
# website serves it (frontend/public/downloads/AgriFair.apk).
#
#   cd mobile
#   powershell -ExecutionPolicy Bypass -File tool\build_release_apk.ps1 https://agrifair-api.onrender.com/api
#
# Then commit the APK and push; Vercel redeploys and the website's
# "Download the app" button hands out the new build.
param([Parameter(Mandatory = $true)][string]$ApiUrl)
$ErrorActionPreference = 'Stop'

if (-not ($ApiUrl.StartsWith('https://') -and $ApiUrl.EndsWith('/api'))) {
  Write-Error 'The URL must start with https:// and end with /api.'
}

Set-Location (Join-Path $PSScriptRoot '..')

flutter pub get
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

flutter build apk --release `
  --target-platform android-arm,android-arm64 `
  "--dart-define=API_BASE_URL=$ApiUrl"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

New-Item -ItemType Directory -Force -Path ..\frontend\public\downloads | Out-Null
Copy-Item build\app\outputs\flutter-apk\app-release.apk ..\frontend\public\downloads\AgriFair.apk -Force
Write-Host "Done: frontend/public/downloads/AgriFair.apk now talks to $ApiUrl"
