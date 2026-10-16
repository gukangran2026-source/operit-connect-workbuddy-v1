"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerToolPkg = registerToolPkg;
exports.onWorkbuddyPromptFinalize = onWorkbuddyPromptFinalize;
const workbuddy_ui_js = __importDefault(require("./ui/workbuddy/index.ui.js"));
const WORKBUDDY_ROUTE = "toolpkg:com.operit.dsh_connect_workbuddy:ui:workbuddy_home";
const BRIDGE_DEFAULT_URL = "http://127.0.0.1:8787";
const BRIDGE_DEFAULT_DIR = "/root/workbuddy-bridge";
const BRIDGE_HOOK_ID = "workbuddy_service_watch";
/** 服务拉起失败时的重试间隔，避免每条消息都重复执行终端命令。 */
const BRIDGE_START_RETRY_INTERVAL_MS = 30000;
let lastBridgeStartAttemptMs = 0;
function readBridgeEnv(key) {
    if (typeof getEnv !== "function") {
        return "";
    }
    try {
        const value = getEnv(key);
        return value === undefined || value === null ? "" : String(value).trim();
    }
    catch (error) {
        return "";
    }
}
function bridgeBaseUrl() {
    const raw = readBridgeEnv("WORKBUDDY_BRIDGE_URL");
    return (raw !== "" ? raw : BRIDGE_DEFAULT_URL).replace(/\/+$/, "");
}
function bridgeServiceDir() {
    const raw = readBridgeEnv("WORKBUDDY_BRIDGE_DIR");
    return (raw !== "" ? raw : BRIDGE_DEFAULT_DIR).replace(/\/+$/, "");
}
async function isBridgeUp() {
    try {
        const response = await Tools.Net.http({
            url: bridgeBaseUrl() + "/healthz",
            method: "GET",
            responseType: "text",
            connect_timeout: 2500,
            read_timeout: 2500
        });
        return Boolean(response && response.statusCode === 200);
    }
    catch (error) {
        return false;
    }
}
/**
 * 拉起接入服务，并确保守护进程在运行。
 * 仅在服务不可达时调用，正常路径不会产生终端开销。
 */
async function startBridgeService() {
    const dir = bridgeServiceDir();
    const base = bridgeBaseUrl();
    const command = [
        "cd " + dir,
        "(nohup node server.mjs >> bridge.log 2>&1 &)",
        "sleep 3",
        "if ! pgrep -f '[w]atchdog.sh' >/dev/null 2>&1 ; then (nohup bash watchdog.sh >/dev/null 2>&1 &) ; fi",
        "curl -sS -m 3 " + base + "/healthz >/dev/null 2>&1 && echo BRIDGE_UP || echo BRIDGE_DOWN"
    ].join(" ; ");
    try {
        const session = await Tools.System.terminal.create("workbuddy_service_watch");
        await Tools.System.terminal.exec(session.sessionId, command, 9000);
        return true;
    }
    catch (error) {
        return false;
    }
}
/**
 * 发消息前钩子：每次向模型发起请求前确认接入服务可用，不可用则拉起。
 * 只处理 before_send_to_model 阶段，其余阶段直接放行，不修改提示词内容。
 */
async function onWorkbuddyPromptFinalize(input) {
    try {
        const payload = input && input.eventPayload ? input.eventPayload : {};
        const stage = String(payload.stage !== undefined && payload.stage !== null
            ? payload.stage
            : (input && input.eventName ? input.eventName : ""));
        if (stage !== "before_send_to_model") {
            return null;
        }
        if (!(await isBridgeUp())) {
            const now = Date.now();
            if (now - lastBridgeStartAttemptMs >= BRIDGE_START_RETRY_INTERVAL_MS) {
                lastBridgeStartAttemptMs = now;
                await startBridgeService();
            }
        }
    }
    catch (error) {
        /* 钩子异常不得影响消息发送 */
    }
    return null;
}
function registerToolPkg() {
    ToolPkg.registerUiRoute({
        id: "workbuddy_home",
        route: WORKBUDDY_ROUTE,
        runtime: "compose_dsl",
        screen: workbuddy_ui_js.default,
        params: {},
        keepAlive: true,
        title: {
            zh: "WorkBuddy 接入",
            en: "WorkBuddy Connect",
        },
    });

    ToolPkg.registerNavigationEntry({
        id: "workbuddy_sidebar_entry",
        route: WORKBUDDY_ROUTE,
        surface: "main_sidebar_plugins",
        title: {
            zh: "WorkBuddy",
            en: "WorkBuddy",
        },
        icon: "computer",
        order: 200,
    });
    ToolPkg.registerPromptFinalizeHook({
        id: BRIDGE_HOOK_ID,
        function: onWorkbuddyPromptFinalize,
    });
    return true;
}