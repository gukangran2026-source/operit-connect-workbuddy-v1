#!/bin/bash
# 打包并部署 ToolPkg 到 Operit。
#
# 关键点：把 .toolpkg 复制到 packages 目录**不会**让 Operit 立刻加载它。
# 宿主在启动时扫描一次，之后需要发一条调试广播才会重新扫描并重新注册工具。
# 不发广播就会出现「UI 是新的、工具还是旧的」，表现为
# `操作失败：Tool not found: <新工具名>`。
#
# 广播的 am 命令只能在 Android shell 里跑（proot 没有 /system 挂载），
# 所以脚本做完打包与推送后会打印出需要执行的广播命令。
#
# 用法：
#   bash deploy.sh              # 打包 + 推送 + 提示广播
#   bash deploy.sh --no-build   # 跳过打包，只推送现有包

set -u

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
PKG_NAME="operit-connect-workbuddy.toolpkg"
TOOLPKG_SRC="$PROJECT_DIR/toolpkg"
PKG_FILE="$PROJECT_DIR/$PKG_NAME"
DOWNLOAD_DIR="/sdcard/Download"
APP_PACKAGE="com.ai.assistance.operit"
PACKAGES_DIR="/sdcard/Android/data/$APP_PACKAGE/files/packages"

BROADCAST_ACTION="$APP_PACKAGE.DEBUG_REFRESH_PACKAGES"
BROADCAST_CMD="am broadcast -a $BROADCAST_ACTION -p $APP_PACKAGE --ez reactivate_active_packages true"

BUILD=1
[ "${1:-}" = "--no-build" ] && BUILD=0

echo "=== 1. 打包 ==="
if [ "$BUILD" = "1" ]; then
    rm -f "$PKG_FILE"
    (cd "$TOOLPKG_SRC" && zip -r -X "$PKG_FILE" . -x '.*' >/dev/null 2>&1) || {
        echo "打包失败"
        exit 1
    }
    echo "  已生成 $PKG_NAME"
else
    [ -f "$PKG_FILE" ] || { echo "  包不存在，请先打包"; exit 1; }
    echo "  跳过打包"
fi

VERSION=$(grep -o '"version": *"[^"]*"' "$TOOLPKG_SRC/manifest.json" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
PKG_ID=$(grep -o '"toolpkg_id": *"[^"]*"' "$TOOLPKG_SRC/manifest.json" | head -1 | sed 's/.*"\([^"]*\)"$/\1/')
SIZE=$(stat -c %s "$PKG_FILE")
HASH=$(sha256sum "$PKG_FILE" | cut -d' ' -f1)

echo "  toolpkg_id = $PKG_ID"
echo "  version    = $VERSION"
echo "  大小       = $SIZE 字节"
echo "  sha256     = $HASH"

echo
echo "=== 2. 完整性校验 ==="
if unzip -t "$PKG_FILE" >/dev/null 2>&1; then
    echo "  zip 结构 OK"
else
    echo "  zip 结构损坏"
    exit 1
fi

echo
echo "=== 3. 推送到设备 ==="
cp "$PKG_FILE" "$DOWNLOAD_DIR/$PKG_NAME" && echo "  -> $DOWNLOAD_DIR/$PKG_NAME"
cp "$PKG_FILE" "$PACKAGES_DIR/$PKG_ID.toolpkg" && echo "  -> $PACKAGES_DIR/$PKG_ID.toolpkg"

echo
echo "=== 4. 让 Operit 重新加载（需要你在 Android shell 里执行）==="
echo "  下面这条命令必须在 Android shell（super_admin:shell）里跑，"
echo "  proot 里没有 /system 挂载，am 不可用："
echo
echo "    $BROADCAST_CMD"
echo
echo "  执行后宿主会重新扫描 packages 目录、注销旧工具、"
echo "  按新的 METADATA 重新注册子包工具。"
echo
echo "  验证方法（Android shell）："
echo "    PID=\$(pgrep -f '$APP_PACKAGE\$' | head -1)"
echo "    logcat -d --pid=\$PID | grep PackageDebugRefreshReceiver"
echo "  出现 'Reactivated packages: ... workbuddy_tools' 即为成功。"
echo
echo "  另一种等效做法：重启 Operit 应用（会一并杀掉 proot 里的服务，"
echo "  但 /etc/profile.d/00-workbuddy-autostart.sh 会在下次开终端时拉回来）。"
