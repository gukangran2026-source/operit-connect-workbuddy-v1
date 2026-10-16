/* METADATA
{
    "name": "connect_workbuddy",
    "version": "4.6.0",
    "author": ["gukangran2026-source"],
    "display_name": {
        "zh": "operit-connect-workbuddy",
        "en": "operit-connect-workbuddy"
    },
    "description": {
        "zh": "把本机登录的 WorkBuddy 模型接入 Operit，并提供账号、积分与模型概览。国内版与国际版两个区域可并行使用。本项目改编自 dingminhua/dsh-connect-workbuddy（MIT）。",
        "en": "Connect locally signed-in WorkBuddy models to Operit, with account, credits and model overview. Both regions run in parallel. Adapted from dingminhua/dsh-connect-workbuddy (MIT)."
    },
    "enabledByDefault": true,
    "category": "Network",
    "env": [
        {
            "name": "WORKBUDDY_BRIDGE_URL",
            "description": {
                "zh": "接入服务地址，默认 http://127.0.0.1:8787",
                "en": "Bridge base URL, default http://127.0.0.1:8787"
            },
            "required": false
        },
        {
            "name": "WORKBUDDY_BRIDGE_KEY",
            "description": {
                "zh": "接入服务 API Key，留空自动从服务端 config.json 读取",
                "en": "Bridge API key; empty reads it from the server config.json automatically"
            },
            "required": false
        },
        {
            "name": "WORKBUDDY_BRIDGE_DIR",
            "description": {
                "zh": "接入服务目录，默认 /root/workbuddy-bridge",
                "en": "Bridge service directory, default /root/workbuddy-bridge"
            },
            "required": false
        }
    ],
    "tools": [
        {
            "name": "wb_status",
            "description": {
                "zh": "查看 WorkBuddy 接入服务运行状态，以及国内版与国际版的登录情况。",
                "en": "Show bridge service status and sign-in state for both regions."
            },
            "parameters": []
        },
        {
            "name": "wb_login",
            "description": {
                "zh": "发起指定区域的账号登录，返回浏览器授权链接。",
                "en": "Start sign-in for a region and return the authorization link."
            },
            "parameters": [
                {
                    "name": "region",
                    "description": { "zh": "区域：cn 国内版，global 国际版，默认 cn", "en": "Region: cn or global, default cn" },
                    "type": "string",
                    "required": false
                }
            ]
        },
        {
            "name": "wb_login_poll",
            "description": {
                "zh": "查询登录会话是否完成。完成后凭据自动保存。",
                "en": "Poll a sign-in session; credentials are saved on completion."
            },
            "parameters": [
                {
                    "name": "login_id",
                    "description": { "zh": "登录会话 ID", "en": "Sign-in session ID" },
                    "type": "string",
                    "required": true
                }
            ]
        },
        {
            "name": "wb_models",
            "description": {
                "zh": "列出指定区域账号可用的模型清单。",
                "en": "List models available to the account of a region."
            },
            "parameters": [
                {
                    "name": "region",
                    "description": { "zh": "区域：cn 国内版，global 国际版，默认 cn", "en": "Region: cn or global, default cn" },
                    "type": "string",
                    "required": false
                },
                {
                    "name": "refresh",
                    "description": { "zh": "是否强制重新拉取上游模型目录", "en": "Force refresh the upstream catalog" },
                    "type": "boolean",
                    "required": false
                }
            ]
        },
        {
            "name": "wb_chat",
            "description": {
                "zh": "直接调用指定区域的 WorkBuddy 模型完成一次对话。",
                "en": "Send one chat turn to a WorkBuddy model of the given region."
            },
            "parameters": [
                {
                    "name": "prompt",
                    "description": { "zh": "提问内容", "en": "Prompt" },
                    "type": "string",
                    "required": true
                },
                {
                    "name": "model",
                    "description": { "zh": "模型 ID，留空由上游决定", "en": "Model ID; empty lets upstream decide" },
                    "type": "string",
                    "required": false
                },
                {
                    "name": "region",
                    "description": { "zh": "区域：cn 国内版，global 国际版，默认 cn", "en": "Region: cn or global, default cn" },
                    "type": "string",
                    "required": false
                }
            ]
        },
        {
            "name": "wb_credits",
            "description": {
                "zh": "查询指定区域账号的剩余积分。只读，不消耗积分。",
                "en": "Query remaining credits for one region. Read-only."
            },
            "parameters": [
                {
                    "name": "region",
                    "description": { "zh": "区域：cn 国内版，global 国际版，默认 cn", "en": "Region: cn or global, default cn" },
                    "type": "string",
                    "required": false
                }
            ]
        },
        {
            "name": "wb_service",
            "description": {
                "zh": "查看、启动、停止或重启本机接入服务与守护进程。",
                "en": "Check, start, stop or restart the local bridge service and its watchdog."
            },
            "parameters": [
                {
                    "name": "action",
                    "description": { "zh": "操作：status 查看，start 启动，stop 停止，restart 重启", "en": "Action: status, start, stop or restart" },
                    "type": "string",
                    "required": true
                }
            ]
        },
        {
            "name": "wb_copy",
            "description": {
                "zh": "把文本写入系统剪贴板。",
                "en": "Copy text to the system clipboard."
            },
            "parameters": [
                {
                    "name": "text",
                    "description": { "zh": "要复制的文本", "en": "Text to copy" },
                    "type": "string",
                    "required": true
                }
            ]
        },
        {
            "name": "wb_open",
            "description": {
                "zh": "用系统浏览器打开一个网址。",
                "en": "Open a URL in the system browser."
            },
            "parameters": [
                {
                    "name": "url",
                    "description": { "zh": "要打开的网址", "en": "URL to open" },
                    "type": "string",
                    "required": true
                }
            ]
        },
        {
            "name": "wb_sync_config",
            "description": {
                "zh": "把指定区域的模型清单同步为 Operit 模型配置，免手动填写。已存在同名配置时更新。",
                "en": "Sync a region's model list into an Operit model config; update the same-named config when present."
            },
            "parameters": [
                {
                    "name": "region",
                    "description": { "zh": "区域：cn 国内版，global 国际版，默认 cn", "en": "Region: cn or global, default cn" },
                    "type": "string",
                    "required": false
                }
            ]
        }
    ]
}*/
const WorkBuddyConnect = (function () {
    const DEFAULT_BASE = "http://127.0.0.1:8787";
    const DEFAULT_DIR = "/root/workbuddy-bridge";
    const REGION_LABELS = { cn: "国内版", global: "国际版" };

    function readEnv(key) {
        if (typeof getEnv !== "function") return undefined;
        try {
            const value = getEnv(key);
            return value === undefined || value === null ? undefined : String(value);
        } catch (error) {
            return undefined;
        }
    }

    function baseUrl() {
        const raw = readEnv("WORKBUDDY_BRIDGE_URL");
        const value = raw !== undefined && raw.trim() !== "" ? raw.trim() : DEFAULT_BASE;
        return value.replace(/\/+$/, "");
    }

    function serviceDir() {
        const raw = readEnv("WORKBUDDY_BRIDGE_DIR");
        return raw !== undefined && raw.trim() !== "" ? raw.trim().replace(/\/+$/, "") : DEFAULT_DIR;
    }

    let cachedKey;

    /**
     * 解析接入服务 API Key。优先级：
     *   1) 环境变量 WORKBUDDY_BRIDGE_KEY
     *   2) 服务端 config.json 中的 apiKey（自动读取，用户无需手填）
     * 结果会缓存；force=true 时强制重读（用于服务端换 key 后的重试）。
     */
    async function resolveApiKey(force) {
        const raw = readEnv("WORKBUDDY_BRIDGE_KEY");
        if (raw !== undefined && raw.trim() !== "") return raw.trim();
        if (force !== true && cachedKey !== undefined) return cachedKey;
        let key = "";
        try {
            const session = await Tools.System.terminal.create("workbuddy_bridge_key");
            const result = await Tools.System.terminal.exec(session.sessionId, `cat ${serviceDir()}/config.json`, 15000);
            const text = String(result.output === undefined || result.output === null ? "" : result.output);
            const parsed = JSON.parse(text);
            if (parsed !== null && typeof parsed === "object" && typeof parsed.apiKey === "string") {
                key = parsed.apiKey;
            }
        } catch (error) {
            key = "";
        }
        cachedKey = key;
        return key;
    }

    function normalizeRegion(value) {
        return String(value === undefined || value === null ? "" : value).trim().toLowerCase() === "global" ? "global" : "cn";
    }

    /** 积分与余额是浮点数，去掉二进制浮点误差留下的长尾。 */
    function formatNumber(value) {
        const numeric = typeof value === "number" ? value : Number(value);
        if (Number.isFinite(numeric) !== true) {
            return String(value);
        }
        const rounded = Math.round(numeric * 100) / 100;
        return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
    }

    function fail(prefix, error) {
        return { success: false, message: `${prefix}：${String(error)}` };
    }

    /** 写入系统剪贴板；不可用时返回 false，不抛异常。 */
    function copyToClipboard(text) {
        try {
            const ActivityThread = Java.type("android.app.ActivityThread");
            const application = ActivityThread.currentApplication();
            const appContext = application.getApplicationContext();
            const clipboard = appContext.getSystemService("clipboard");
            const ClipData = Java.type("android.content.ClipData");
            clipboard.setPrimaryClip(ClipData.newPlainText("workbuddy", text));
            return true;
        } catch (error) {
            return false;
        }
    }

    /** 用系统浏览器打开网址；失败返回 false，不抛异常。 */
    function openUrl(url) {
        try {
            const ActivityThread = Java.type("android.app.ActivityThread");
            const application = ActivityThread.currentApplication();
            const IntentClass = Java.type("android.content.Intent");
            const UriClass = Java.type("android.net.Uri");
            const intent = IntentClass.newInstance();
            intent.setAction(IntentClass.ACTION_VIEW);
            intent.setData(UriClass.parse(url));
            intent.addFlags(IntentClass.FLAG_ACTIVITY_NEW_TASK);
            application.startActivity(intent);
            return true;
        } catch (error) {
            return false;
        }
    }

    async function call(method, path, options) {
        const opts = options === undefined ? {} : options;
        const send = async (key) => {
            const headers = {};
            if (opts.auth === true && key !== "") headers.Authorization = `Bearer ${key}`;
            const request = {
                url: `${baseUrl()}${path}`,
                method: method,
                headers: headers,
                responseType: "text",
                connect_timeout: 8000,
                read_timeout: opts.readTimeout === undefined ? 60000 : opts.readTimeout
            };
            if (opts.body !== undefined) request.body = opts.body;
            const result = await Tools.Net.http(request);
            let json;
            try {
                json = JSON.parse(result.content);
            } catch (error) {
                json = undefined;
            }
            return {
                statusCode: result.statusCode,
                text: result.content === undefined || result.content === null ? "" : String(result.content),
                json: json
            };
        };
        let key = "";
        if (opts.auth === true) key = await resolveApiKey(false);
        let response = await send(key);
        /* 服务端 key 变更后自愈：401 时强制重读一次 config.json 再试 */
        if (opts.auth === true && response.statusCode === 401) {
            key = await resolveApiKey(true);
            response = await send(key);
        }
        return response;
    }

    async function wb_status() {
        let response;
        try {
            response = await call("GET", "/healthz");
        } catch (error) {
            return fail("接入服务不可达，先确认 workbuddy-bridge 已启动", error);
        }
        if (response.statusCode !== 200 || response.json === undefined) {
            return { success: false, message: `接入服务响应异常：HTTP ${response.statusCode}` };
        }
        const regions = response.json.regions === undefined ? {} : response.json.regions;
        const lines = [];
        for (const region of ["cn", "global"]) {
            const info = regions[region] === undefined ? {} : regions[region];
            if (info.signedIn === true) {
                lines.push(`${REGION_LABELS[region]}：已登录，账号 ${info.account === undefined || info.account === null ? "未知" : info.account}，凭据域 ${info.domain === undefined || info.domain === null ? "未知" : info.domain}`);
            } else {
                lines.push(`${REGION_LABELS[region]}：未登录`);
            }
        }
        return { success: true, message: `接入服务正常。\n${lines.join("\n")}`, data: response.json };
    }

    async function wb_login(params) {
        const region = normalizeRegion(params === undefined ? undefined : params.region);
        let response;
        try {
            response = await call("POST", "/admin/login", { body: { region: region } });
        } catch (error) {
            return fail("发起登录失败", error);
        }
        if (response.json === undefined || response.json.verificationUri === undefined) {
            const reason = response.json !== undefined && response.json.error !== undefined ? response.json.error : `HTTP ${response.statusCode}`;
            return { success: false, message: `发起登录失败：${reason}` };
        }
        const copied = copyToClipboard(response.json.verificationUri);
        return {
            success: true,
            message: `${REGION_LABELS[region]}登录已发起，授权链接${copied ? "已写入剪贴板" : "如下"}：\n${response.json.verificationUri}\n会话 ID ${response.json.loginId}，有效期 ${response.json.expiresIn} 秒`,
            data: { ...response.json, copiedToClipboard: copied }
        };
    }

    async function wb_login_poll(params) {
        const loginId = String(params === undefined || params.login_id === undefined ? "" : params.login_id).trim();
        if (loginId === "") return { success: false, message: "缺少参数：login_id" };
        let response;
        try {
            response = await call("GET", `/admin/login/poll?id=${encodeURIComponent(loginId)}`);
        } catch (error) {
            return fail("查询登录状态失败", error);
        }
        if (response.json === undefined) return { success: false, message: `查询登录状态失败：HTTP ${response.statusCode}` };
        if (response.json.done !== true) return { success: true, message: "登录尚未完成，稍后再查", data: response.json };
        if (response.json.error !== undefined) return { success: false, message: `登录失败：${response.json.error}`, data: response.json };
        const account = response.json.account === undefined ? {} : response.json.account;
        const name = account.nickname !== undefined && account.nickname !== "" ? account.nickname : account.uid;
        return {
            success: true,
            message: `登录成功，账号 ${name === undefined || name === null || name === "" ? "未知" : name}，凭据域 ${account.domain === undefined ? "未知" : account.domain}`,
            data: response.json
        };
    }

    async function wb_models(params) {
        const region = normalizeRegion(params === undefined ? undefined : params.region);
        const force = params !== undefined && params.refresh === true;
        const path = force ? `/${region}/admin/catalog?refresh=1` : `/${region}/admin/catalog`;
        let response;
        try {
            response = await call("GET", path, { auth: true });
        } catch (error) {
            return fail("读取模型目录失败", error);
        }
        if (response.json === undefined || Array.isArray(response.json.models) !== true) {
            const reason = response.json !== undefined && response.json.error !== undefined ? response.json.error.message : `HTTP ${response.statusCode}`;
            return { success: false, message: `读取模型目录失败：${reason}` };
        }
        const models = response.json.models;
        if (models.length === 0) return { success: true, message: `${REGION_LABELS[region]}没有可用模型`, data: response.json };
        const lines = models.map((model) => {
            const context = model.contextWindow === undefined ? "未知" : model.contextWindow;
            const credits = model.credits === undefined || model.credits === null ? "" : `  倍率 ${model.credits}`;
            const promo = model.promotion === undefined || model.promotion === null ? "" : `  ${model.promotion.label}`;
            return `${model.id}  上下文 ${context}${credits}${promo}`;
        });
        return {
            success: true,
            message: `${REGION_LABELS[region]}可用模型 ${models.length} 个：\n${lines.join("\n")}`,
            data: response.json
        };
    }

    async function wb_chat(params) {
        const prompt = String(params === undefined || params.prompt === undefined ? "" : params.prompt).trim();
        if (prompt === "") return { success: false, message: "缺少参数：prompt" };
        const region = normalizeRegion(params.region);
        const body = {
            messages: [{ role: "user", content: prompt }],
            stream: false
        };
        const model = params.model === undefined ? "" : String(params.model).trim();
        if (model !== "") body.model = model;
        let response;
        try {
            response = await call("POST", `/${region}/v1/chat/completions`, { auth: true, body: body, readTimeout: 180000 });
        } catch (error) {
            return fail("调用模型失败", error);
        }
        if (response.json === undefined || Array.isArray(response.json.choices) !== true) {
            let reason = `HTTP ${response.statusCode}`;
            if (response.json !== undefined && response.json.error !== undefined && response.json.error.message !== undefined) {
                reason = response.json.error.message;
            }
            return { success: false, message: `调用模型失败：${reason}` };
        }
        const choice = response.json.choices[0] === undefined ? {} : response.json.choices[0];
        const message = choice.message === undefined ? {} : choice.message;
        const content = message.content === undefined ? "" : String(message.content);
        if (content === "") return { success: false, message: "调用模型失败：上游返回空内容" };
        return { success: true, message: content, data: response.json };
    }

    async function wb_credits(params) {
        const region = normalizeRegion(params === undefined ? undefined : params.region);
        let response;
        try {
            response = await call("GET", `/${region}/admin/credits`, { auth: true });
        } catch (error) {
            return fail("查询积分失败", error);
        }
        if (response.json === undefined || typeof response.json.total !== "number") {
            const reason = response.json !== undefined && response.json.error !== undefined ? response.json.error.message : `HTTP ${response.statusCode}`;
            return { success: false, message: `查询积分失败：${reason}` };
        }
        const data = response.json;
        const packages = Array.isArray(data.packages) ? data.packages : [];
        const lines = packages.map((item) => {
            const expiry = typeof item.expiresAt === "string" ? `，到期 ${item.expiresAt.slice(0, 10)}` : "";
            return `${item.packageName}：剩余 ${formatNumber(item.remain)}${expiry}`;
        });
        const who = data.account === undefined || data.account === null ? "" : data.account;
        const head = `${REGION_LABELS[region]}账号 ${who} 剩余积分合计 ${formatNumber(data.total)}`;
        return { success: true, message: lines.length > 0 ? `${head}\n${lines.join("\n")}` : head, data: data };
    }

    /** 把模型清单同步为 Operit 模型配置，免手动填写。同名配置存在时更新。 */
    async function wb_sync_config(params) {
        const region = normalizeRegion(params === undefined ? undefined : params.region);
        if (typeof toolCall !== "function") {
            return { success: false, message: "同步模型配置失败：当前运行时不支持调用宿主工具" };
        }
        let response;
        try {
            response = await call("GET", `/${region}/admin/catalog?refresh=1`, { auth: true });
        } catch (error) {
            return fail("同步模型配置失败", error);
        }
        if (response.json === undefined || Array.isArray(response.json.models) !== true) {
            const reason = response.json !== undefined && response.json.error !== undefined ? response.json.error.message : `HTTP ${response.statusCode}`;
            return { success: false, message: `同步模型配置失败：${reason}` };
        }
        const models = response.json.models;
        if (models.length === 0) {
            return { success: false, message: `同步模型配置失败：${REGION_LABELS[region]}没有可用模型` };
        }
        const modelIds = models.map((model) => model.id);
        /* Operit 的 context_length 是倍率，实际 token = 倍率 × 1024；按该区域模型的最大窗口写入。 */
        const windows = models
            .map((model) => (typeof model.contextWindow === "number" && model.contextWindow > 0 ? model.contextWindow : 0))
            .filter((value) => value > 0);
        const maxWindow = windows.length > 0 ? Math.max.apply(null, windows) : 0;
        const contextMultiplier = maxWindow > 0 ? Math.floor(maxWindow / 1024) : 0;
        const targetName = `WorkBuddy ${REGION_LABELS[region]}`;
        let existing;
        try {
            const listed = await toolCall("list_model_configs", {});
            const configs = listed !== null && typeof listed === "object" && Array.isArray(listed.configs) ? listed.configs : [];
            existing = configs.find((item) => item !== null && typeof item === "object" && item.name === targetName);
        } catch (error) {
            return fail("同步模型配置失败：读取现有配置出错", error);
        }
        const payload = {
            name: targetName,
            api_provider_type: "OPENAI_GENERIC",
            api_endpoint: `${baseUrl()}/${region}/v1`,
            api_key: await resolveApiKey(false),
            model_name: modelIds.join(","),
            max_tokens_enabled: true,
            max_tokens: 64000,
            enable_tool_call: true
        };
        if (contextMultiplier > 0) {
            payload.context_length = contextMultiplier;
            payload.max_context_length = contextMultiplier;
        }
        try {
            if (existing !== undefined) {
                payload.config_id = existing.id;
                await toolCall("update_model_config", payload);
                return {
                    success: true,
                    message: `已更新模型配置 ${targetName}，共 ${modelIds.length} 个模型，上下文倍率 ${contextMultiplier}`,
                    data: { action: "updated", configId: existing.id, modelCount: modelIds.length }
                };
            }
            const created = await toolCall("create_model_config", payload);
            const configId = created !== null && typeof created === "object" && created.data !== undefined && created.data.config !== undefined ? created.data.config.id : "";
            return {
                success: true,
                message: `已创建模型配置 ${targetName}，共 ${modelIds.length} 个模型，上下文倍率 ${contextMultiplier}`,
                data: { action: "created", configId: configId, modelCount: modelIds.length }
            };
        } catch (error) {
            return fail("同步模型配置失败：写入配置出错", error);
        }
    }

    /** 在接入服务终端会话中执行一条命令并返回输出。 */
    async function runServiceCommand(command, timeoutMs) {
        const session = await Tools.System.terminal.create("connect_workbuddy");
        const result = await Tools.System.terminal.exec(session.sessionId, command, timeoutMs === undefined ? 45000 : timeoutMs);
        return typeof result.output === "string"
            ? result.output
            : String(result.output === undefined || result.output === null ? "" : result.output);
    }

    /* 用 [w] 规避 pgrep/pkill 匹配到命令自身的问题 */
    const WATCHDOG_PROBE = "pgrep -f '[w]atchdog.sh' >/dev/null 2>&1 && echo WATCHDOG_UP || echo WATCHDOG_DOWN";
    const WATCHDOG_STOP = "pkill -f '[w]atchdog.sh' >/dev/null 2>&1";
    const WATCHDOG_ENSURE = "if ! pgrep -f '[w]atchdog.sh' >/dev/null 2>&1 ; then (nohup bash watchdog.sh >/dev/null 2>&1 &) ; fi";

    async function wb_service(params) {
        const action = String(params === undefined || params.action === undefined ? "" : params.action).trim().toLowerCase();
        const dir = serviceDir();
        const stopCommand = `${WATCHDOG_STOP} ; pkill -f '[n]ode server.mjs' >/dev/null 2>&1 ; sleep 1 ; ${WATCHDOG_PROBE} ; echo stopped`;
        const startCommand = `cd ${dir} && if ! curl -sS -m 3 ${baseUrl()}/healthz >/dev/null 2>&1 ; then (nohup node server.mjs >> bridge.log 2>&1 &) ; sleep 2 ; fi ; ${WATCHDOG_ENSURE} ; sleep 1 ; ${WATCHDOG_PROBE} ; curl -sS -m 5 ${baseUrl()}/healthz ; echo`;
        if (action === "status") {
            let serviceUp = false;
            let serviceData;
            try {
                const response = await call("GET", "/healthz");
                if (response.statusCode === 200) {
                    serviceUp = true;
                    serviceData = response.json;
                }
            } catch (error) {
                /* 服务未运行，走下面的失败分支 */
            }
            let watchdogUp = false;
            try {
                const probe = await runServiceCommand(WATCHDOG_PROBE, 10000);
                watchdogUp = probe.indexOf("WATCHDOG_UP") >= 0;
            } catch (error) {
                /* 终端不可用时只报告服务状态 */
            }
            return {
                success: serviceUp,
                message: `接入服务${serviceUp ? "正在运行" : "未运行"}。守护进程${watchdogUp ? "运行中" : "未运行"}。`,
                data: serviceData
            };
        }
        if (action !== "start" && action !== "stop" && action !== "restart") {
            return { success: false, message: "action 必须是 status、start、stop 或 restart" };
        }
        const command = action === "stop" ? stopCommand : action === "start" ? startCommand : `${stopCommand} ; ${startCommand}`;
        let output = "";
        try {
            output = await runServiceCommand(command, 45000);
        } catch (error) {
            return fail("服务操作失败", error);
        }
        await new Promise((resolve) => setTimeout(resolve, 1500));
        const watchdogUp = output.indexOf("WATCHDOG_UP") >= 0;
        if (action === "stop") {
            let stopped = false;
            try {
                const response = await call("GET", "/healthz");
                stopped = response.statusCode !== 200;
            } catch (error) {
                stopped = true;
            }
            const ok = stopped && !watchdogUp;
            return {
                success: ok,
                message: ok
                    ? "接入服务与守护进程已停止。"
                    : `停止命令已执行，接入服务${stopped ? "已停止" : "仍在响应"}，守护进程${watchdogUp ? "仍在运行" : "已停止"}。`,
                data: { output: output.slice(0, 300) }
            };
        }
        let response;
        try {
            response = await call("GET", "/healthz");
        } catch (error) {
            return { success: false, message: `服务启动失败：${output.slice(0, 400)}` };
        }
        if (response.statusCode !== 200) return { success: false, message: `服务启动失败：${output.slice(0, 400)}` };
        return {
            success: true,
            message: `接入服务已${action === "restart" ? "重启" : "启动"}，守护进程${watchdogUp ? "运行中" : "未运行"}。`,
            data: response.json
        };
    }

    async function wb_copy(params) {
        const text = String(params === undefined || params.text === undefined ? "" : params.text).trim();
        if (text === "") {
            return { success: false, message: "缺少参数：text" };
        }
        if (copyToClipboard(text) !== true) {
            return { success: false, message: "复制失败：剪贴板不可用" };
        }
        return { success: true, message: "已写入剪贴板。" };
    }

    async function wb_open(params) {
        const url = String(params === undefined || params.url === undefined ? "" : params.url).trim();
        if (url === "") {
            return { success: false, message: "缺少参数：url" };
        }
        if (openUrl(url) !== true) {
            return { success: false, message: "打开失败：没有可处理该链接的应用" };
        }
        return { success: true, message: "已用系统浏览器打开。" };
    }

    async function main() {
        return await wb_status();
    }

    function wrap(func) {
        return async function (params) {
            try {
                return await func(params === undefined ? {} : params);
            } catch (error) {
                return { success: false, message: `工具执行失败：${error && error.message !== undefined ? error.message : String(error)}` };
            }
        };
    }

    return {
        wb_status: wrap(wb_status),
        wb_login: wrap(wb_login),
        wb_login_poll: wrap(wb_login_poll),
        wb_models: wrap(wb_models),
        wb_chat: wrap(wb_chat),
        wb_credits: wrap(wb_credits),
        wb_service: wrap(wb_service),
        wb_copy: wrap(wb_copy),
        wb_open: wrap(wb_open),
        wb_sync_config: wrap(wb_sync_config),
        main: main
    };
})();
exports.wb_status = WorkBuddyConnect.wb_status;
exports.wb_login = WorkBuddyConnect.wb_login;
exports.wb_login_poll = WorkBuddyConnect.wb_login_poll;
exports.wb_models = WorkBuddyConnect.wb_models;
exports.wb_chat = WorkBuddyConnect.wb_chat;
exports.wb_credits = WorkBuddyConnect.wb_credits;
exports.wb_service = WorkBuddyConnect.wb_service;
exports.wb_copy = WorkBuddyConnect.wb_copy;
exports.wb_open = WorkBuddyConnect.wb_open;
exports.wb_sync_config = WorkBuddyConnect.wb_sync_config;
exports.main = WorkBuddyConnect.main;