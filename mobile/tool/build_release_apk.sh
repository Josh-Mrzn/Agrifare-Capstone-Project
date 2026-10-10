#!/usr/bin/env bash
# Builds the Android app pointed at your hosted backend and puts it where the
# website serves it (frontend/public/downloads/AgriFair.apk).
#
#   ./tool/build_release_apk.sh https://agrifair-api.onrender.com/api
#
# Then commit the APK and push; Vercel redeploys and the website's
# "Download the app" button hands out the new build.
set -euo pipefail

API_URL="${1:-}"
if [[ -z "$API_URL" || "$API_URL" != https://*/api ]]; then
  echo "Usage: $0 https://<your-backend-host>/api" >&2
  echo "The URL must start with https:// and end with /api." >&2
  exit 1
fi

cd "$(dirname "$0")/.."

flutter pub get
flutter build apk --release \
  --target-platform android-arm,android-arm64 \
  --dart-define=API_BASE_URL="$API_URL"

mkdir -p ../frontend/public/downloads
cp build/app/outputs/flutter-apk/app-release.apk ../frontend/public/downloads/AgriFair.apk
echo "Done: frontend/public/downloads/AgriFair.apk now talks to $API_URL"
