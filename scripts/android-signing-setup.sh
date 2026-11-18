#!/usr/bin/env bash
# CI 里使用:还原正式 keystore,或在 fork/无 secrets 场景下生成临时签名 keystore。
# 签名密码走 env var 直接进 Gradle(System.getenv),不写 keystore.properties,
# 避免 Java Properties 的反斜杠转义 + Gradle Kotlin DSL 的 `java` 名字冲突。
#
# 依赖环境变量(存在则还原正式签名):
#   ANDROID_KEYSTORE_BASE64     jks 文件的 base64
#   ANDROID_KEYSTORE_PASSWORD   storePassword(Gradle 侧 System.getenv 直接读)
#   ANDROID_KEY_ALIAS           keyAlias
#   ANDROID_KEY_PASSWORD        keyPassword
#
# 若上面任一缺失(典型:fork 仓库没有配置 secrets),则用 CI 自带的 keytool
# 生成一枚临时自签名 keystore,保证 debug/本地验证用 APK 也能构建成功。
# 调用时机:pnpm tauri android init 之后、build 之前
set -euo pipefail

ANDROID_DIR=src-tauri/gen/android
if [ ! -d "$ANDROID_DIR" ]; then
  echo "::error::$ANDROID_DIR not found (run 'tauri android init' first)"
  exit 1
fi

KEYSTORE="$ANDROID_DIR/app/fmodeck-release.jks"

if [ -n "${ANDROID_KEYSTORE_BASE64:-}" ] && \
   [ -n "${ANDROID_KEYSTORE_PASSWORD:-}" ] && \
   [ -n "${ANDROID_KEY_ALIAS:-}" ] && \
   [ -n "${ANDROID_KEY_PASSWORD:-}" ]; then
  echo "$ANDROID_KEYSTORE_BASE64" | base64 -d > "$KEYSTORE"
  echo "✓ keystore restored from secrets to $KEYSTORE"
else
  echo "::warning::签名 secrets 未配置，生成临时自签名 keystore（仅用于本地/验证安装）"
  if ! command -v keytool >/dev/null 2>&1; then
    echo "::error::keytool 不可用，无法生成临时 keystore（需 setup-java）"
    exit 1
  fi
  PW='FmoDeckAndroid2026'
  keytool -genkeypair -v -storetype JKS \
    -keystore "$KEYSTORE" \
    -alias fmodeck \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$PW" -keypass "$PW" \
    -dname "CN=FmoDeck, OU=FmoDeck, O=FmoDeck, L=Unknown, ST=Unknown, C=CN" >/dev/null 2>&1
  # GITHUB_ENV 中的值会覆盖 job 级 env 里的空 secrets，供 inject 脚本与 Gradle 读取
  {
    echo "ANDROID_KEYSTORE_PASSWORD=$PW"
    echo "ANDROID_KEY_ALIAS=fmodeck"
    echo "ANDROID_KEY_PASSWORD=$PW"
  } >> "${GITHUB_ENV:-/dev/null}"
  echo "✓ 临时 keystore 已生成：$KEYSTORE"
fi
