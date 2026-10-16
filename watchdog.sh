#!/bin/bash
# WorkBuddy 接入服务守护进程
#
# 每 60 秒检查一次接入服务，无响应则拉起；随 wb_service 一起启停。
# 启动：cd /root/workbuddy-bridge && nohup bash watchdog.sh >/dev/null 2>&1 &
# 停止：pkill -f 'watchdog.sh'
#
# 可用环境变量：
#   WORKBUDDY_BRIDGE_DIR  服务目录，默认 /root/workbuddy-bridge
#   WORKBUDDY_BRIDGE_URL  服务地址，默认 http://127.0.0.1:8787

SERVICE_DIR="${WORKBUDDY_BRIDGE_DIR:-/root/workbuddy-bridge}"
BASE_URL="${WORKBUDDY_BRIDGE_URL:-http://127.0.0.1:8787}"
INTERVAL=60
PID_FILE="$SERVICE_DIR/watchdog.pid"
LOG_FILE="$SERVICE_DIR/watchdog.log"

log_line() {
    echo "[$(date '+%F %T')] $1" >> "$LOG_FILE"
}

is_up() {
    curl -sS -m 5 "$BASE_URL/healthz" >/dev/null 2>&1
}

# 防重入：已有守护进程在运行则直接退出
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE" 2>/dev/null)
    if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
        log_line "守护进程已在运行：PID $OLD_PID"
        exit 0
    fi
fi
echo $$ > "$PID_FILE"

log_line "守护进程启动：PID $$，检查间隔 ${INTERVAL}s，服务目录 $SERVICE_DIR"

while true; do
    if ! is_up; then
        # 二次确认，排除瞬时抖动导致的误判
        sleep 5
        if ! is_up; then
            log_line "接入服务无响应，执行拉起"
            pkill -f '[n]ode server.mjs' >/dev/null 2>&1
            sleep 1
            if cd "$SERVICE_DIR" 2>/dev/null; then
                (nohup node server.mjs >> bridge.log 2>&1 &)
                sleep 3
                if is_up; then
                    log_line "接入服务已恢复"
                else
                    log_line "拉起失败，等待下一轮重试"
                fi
            else
                log_line "服务目录不可用：$SERVICE_DIR"
            fi
        fi
    fi
    sleep "$INTERVAL"
done
