#!/bin/sh
# --dart-define 값을 Info.plist가 읽는 빌드 설정으로 옮긴다.
#
# Flutter는 dart-define을 Generated.xcconfig의 DART_DEFINES에
# (base64("KEY=VALUE")를 쉼표로 이어) 넣는다. Xcode 스킴 Build 사전 작업이
# 이 스크립트를 실행해 ios/Flutter/DartDefines.xcconfig를 만들고,
# Debug/Release.xcconfig가 그 파일을 #include? 한다.
#
# Info.plist에서 쓰는 값:
#   KAKAO_NATIVE_APP_KEY   → URL 스킴 kakao$(KAKAO_NATIVE_APP_KEY)
#   NAVER_CLIENT_ID / NAVER_CLIENT_SECRET / NAVER_CLIENT_NAME / NAVER_URL_SCHEME
#   GOOGLE_IOS_CLIENT_ID / GOOGLE_SERVER_CLIENT_ID
#   GOOGLE_REVERSED_CLIENT_ID (GOOGLE_IOS_CLIENT_ID를 뒤집어 계산)
# 자세한 내용: docs/SOCIAL_LOGIN_SETUP.md
set -e

OUT="${SRCROOT:-$(dirname "$0")/..}/Flutter/DartDefines.xcconfig"
ALLOWED="KAKAO_NATIVE_APP_KEY NAVER_CLIENT_ID NAVER_CLIENT_SECRET NAVER_CLIENT_NAME NAVER_URL_SCHEME GOOGLE_IOS_CLIENT_ID GOOGLE_SERVER_CLIENT_ID"

: > "$OUT"
echo "// 자동 생성 파일(ios/scripts/dart_defines_to_xcconfig.sh). 직접 고치지 마세요." >> "$OUT"

IOS_CLIENT_ID=""
OLD_IFS="$IFS"
IFS=','
for encoded in $DART_DEFINES; do
  IFS="$OLD_IFS"
  decoded=$(echo "$encoded" | base64 --decode 2>/dev/null || echo "$encoded" | base64 -D 2>/dev/null || true)
  key="${decoded%%=*}"
  value="${decoded#*=}"
  for allowed in $ALLOWED; do
    if [ "$key" = "$allowed" ]; then
      # xcconfig에서 //는 주석이라 이스케이프한다.
      escaped=$(printf '%s' "$value" | sed 's#//#/$()/#g')
      echo "$key=$escaped" >> "$OUT"
      if [ "$key" = "GOOGLE_IOS_CLIENT_ID" ]; then IOS_CLIENT_ID="$value"; fi
    fi
  done
  IFS=','
done
IFS="$OLD_IFS"

# 123-abc.apps.googleusercontent.com → com.googleusercontent.apps.123-abc
if [ -n "$IOS_CLIENT_ID" ]; then
  reversed=$(echo "$IOS_CLIENT_ID" | awk -F. '{for (i=NF; i>0; i--) printf "%s%s", $i, (i>1 ? "." : "")}')
  echo "GOOGLE_REVERSED_CLIENT_ID=$reversed" >> "$OUT"
fi
