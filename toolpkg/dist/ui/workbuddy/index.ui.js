"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.default = Screen;

const SUB_PACKAGE = "workbuddy_tools";
const REGION_LABELS = { cn: "国内版", global: "国际版" };
const SETTLE_MS = 250;

let subPackageReady = false;

function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorTextOf(error) {
    if (error && typeof error.message === "string" && error.message !== "") {
        return error.message;
    }
    return String(error === undefined || error === null ? "未知错误" : error);
}

/** 子包工具经由宿主返回时可能是 JSON 字符串，这里统一还原成对象。 */
function normalizeToolResult(raw) {
    if (typeof raw !== "string") {
        return raw;
    }
    const text = raw.trim();
    if (text === "" || (text.charAt(0) !== "{" && text.charAt(0) !== "[")) {
        return raw;
    }
    try {
        return JSON.parse(text);
    } catch (error) {
        return raw;
    }
}

function messageOf(result, fallback) {
    if (result === undefined || result === null) {
        return fallback;
    }
    if (typeof result === "string") {
        return result === "" ? fallback : result;
    }
    if (typeof result.message === "string" && result.message !== "") {
        return result.message;
    }
    try {
        return JSON.stringify(result);
    } catch (error) {
        return fallback;
    }
}

function successOf(result) {
    return typeof result === "object" && result !== null && result.success === true;
}

function dataOf(result) {
    if (typeof result !== "object" || result === null) {
        return {};
    }
    return typeof result.data === "object" && result.data !== null ? result.data : {};
}

function useStateValue(ctx, key, initialValue) {
    const pair = ctx.useState(key, initialValue);
    return { value: pair[0], set: pair[1] };
}

function parseModels(json) {
    if (typeof json !== "string" || json === "") {
        return [];
    }
    try {
        const parsed = JSON.parse(json);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        return [];
    }
}
/** 积分是浮点数，去掉二进制浮点误差留下的长尾。 */
function formatCredits(value) {
    const rounded = Math.round(value * 100) / 100;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

async function ensureSubPackage(ctx, packageName) {
    if (subPackageReady) {
        return;
    }
    try {
        if (typeof ctx.isPackageImported === "function") {
            const imported = !!(await ctx.isPackageImported(packageName));
            if (!imported && typeof ctx.importPackage === "function") {
                const result = await ctx.importPackage(packageName);
                const message = String(result === undefined || result === null ? "" : result).toLowerCase();
                if (message.indexOf("error") >= 0 || message.indexOf("failed") >= 0 || message.indexOf("not found") >= 0) {
                    throw new Error(String(result));
                }
            }
        }
        if (typeof ctx.usePackage === "function") {
            await ctx.usePackage(packageName);
        }
        await delay(SETTLE_MS);
        subPackageReady = true;
    } catch (error) {
        throw new Error(`子包 ${packageName} 不可用：${errorTextOf(error)}`);
    }
}

function makeRegionState(ctx, region) {
    return {
        accountText: useStateValue(ctx, `${region}_accountText`, ""),
        signedIn: useStateValue(ctx, `${region}_signedIn`, false),
        loginUrl: useStateValue(ctx, `${region}_loginUrl`, ""),
        loginId: useStateValue(ctx, `${region}_loginId`, ""),
        creditsText: useStateValue(ctx, `${region}_creditsText`, ""),
        creditsDetail: useStateValue(ctx, `${region}_creditsDetail`, ""),
        modelsJson: useStateValue(ctx, `${region}_modelsJson`, ""),
        modelsExpanded: useStateValue(ctx, `${region}_modelsExpanded`, false),
        busy: useStateValue(ctx, `${region}_busy`, ""),
        error: useStateValue(ctx, `${region}_error`, ""),
    };
}

function Screen(ctx) {
    const tabState = useStateValue(ctx, "tab", "cn");
    const detailTitleState = useStateValue(ctx, "detailTitle", "");
    const detailBodyState = useStateValue(ctx, "detailBody", "");
    const serviceOkState = useStateValue(ctx, "serviceOk", false);
    const serviceTextState = useStateValue(ctx, "serviceText", "");
    const serviceBusyState = useStateValue(ctx, "serviceBusy", "");
    const serviceErrorState = useStateValue(ctx, "serviceError", "");
    const regionState = {
        cn: makeRegionState(ctx, "cn"),
        global: makeRegionState(ctx, "global"),
    };

    const showDetail = (title, body) => {
        detailTitleState.set(title);
        detailBodyState.set(body === "" ? "无内容" : body);
    };

    const closeDetail = () => {
        detailTitleState.set("");
        detailBodyState.set("");
    };

    const callToolOnce = async (toolName, params) => {
        const candidates = [];
        const addCandidate = (value) => {
            const name = typeof value === "string" ? value.trim() : "";
            if (name !== "" && candidates.indexOf(name) === -1) {
                candidates.push(name);
            }
        };
        if (typeof ctx.resolveToolName === "function") {
            try {
                addCandidate(await ctx.resolveToolName({ packageName: SUB_PACKAGE, toolName: toolName, preferImported: true }));
            } catch (error) {
                /* 解析失败时退回按名字直接调用 */
            }
        }
        addCandidate(`${SUB_PACKAGE}:${toolName}`);
        addCandidate(toolName);
        let lastError = "";
        for (const candidate of candidates) {
            try {
                return normalizeToolResult(await ctx.callTool(candidate, params === undefined ? {} : params));
            } catch (error) {
                lastError = errorTextOf(error);
            }
        }
        throw new Error(lastError === "" ? "工具调用失败" : lastError);
    };

    const callTool = async (toolName, params) => {
        await ensureSubPackage(ctx, SUB_PACKAGE);
        try {
            return await callToolOnce(toolName, params);
        } catch (error) {
            if (errorTextOf(error).toLowerCase().indexOf("not found") === -1) {
                throw error;
            }
            subPackageReady = false;
            await ensureSubPackage(ctx, SUB_PACKAGE);
            return await callToolOnce(toolName, params);
        }
    };

    const runService = async (label, task) => {
        serviceBusyState.set(label);
        serviceErrorState.set("");
        try {
            await task();
        } catch (error) {
            serviceErrorState.set(`操作失败：${errorTextOf(error)}`);
        } finally {
            serviceBusyState.set("");
        }
    };

    const runRegion = async (region, label, task) => {
        const st = regionState[region];
        st.busy.set(label);
        st.error.set("");
        try {
            await task();
        } catch (error) {
            st.error.set(`操作失败：${errorTextOf(error)}`);
        } finally {
            st.busy.set("");
        }
    };

    const syncService = async () => {
        const result = await callTool("wb_status");
        serviceOkState.set(successOf(result));
        serviceTextState.set(successOf(result) ? "接入服务正在运行" : messageOf(result, "接入服务无响应"));
    };

    const refreshService = () => runService("刷新", syncService);

    const controlService = (action) =>
        runService(action === "start" ? "启动" : "重启", async () => {
            await callTool("wb_service", { action: action });
            await syncService();
        });

    /** 读取某区域的账号状态与积分。 */
    const syncRegion = async (region) => {
        const st = regionState[region];
        const result = await callTool("wb_status");
        const regions = dataOf(result).regions;
        const info = typeof regions === "object" && regions !== null && typeof regions[region] === "object" && regions[region] !== null ? regions[region] : {};
        const signedIn = info.signedIn === true;
        st.signedIn.set(signedIn);
        if (signedIn) {
            const who = info.account === undefined || info.account === null ? "" : String(info.account);
            const domain = info.domain === undefined || info.domain === null ? "" : String(info.domain);
            st.accountText.set(`${who} @ ${domain}`);
        } else {
            st.accountText.set("未登录");
            st.creditsText.set("—");
            st.creditsDetail.set("");
        }
        serviceOkState.set(successOf(result));
        serviceTextState.set(successOf(result) ? "接入服务正在运行" : messageOf(result, "接入服务无响应"));
        if (!signedIn) {
            return;
        }
        try {
            const credits = await callTool("wb_credits", { region: region });
            const data = dataOf(credits);
            const total = typeof data.total === "number" ? data.total : undefined;
            st.creditsText.set(total === undefined ? "积分未知" : formatCredits(total));
            st.creditsDetail.set(messageOf(credits, "无明细"));
        } catch (error) {
            st.creditsText.set("积分读取失败");
            st.creditsDetail.set(`积分读取失败：${errorTextOf(error)}`);
        }
    };

    const refreshRegion = (region) => runRegion(region, "刷新状态", () => syncRegion(region));

    const startLogin = (region) =>
        runRegion(region, "发起登录", async () => {
            const st = regionState[region];
            const result = await callTool("wb_login", { region: region });
            if (successOf(result) !== true) {
                st.error.set(`发起登录失败：${messageOf(result, "接入服务无响应")}`);
                return;
            }
            const data = dataOf(result);
            st.loginUrl.set(typeof data.verificationUri === "string" ? data.verificationUri : "");
            st.loginId.set(typeof data.loginId === "string" ? data.loginId : "");
        });

    const openAuthUrl = (region) =>
        runRegion(region, "打开授权页", async () => {
            const st = regionState[region];
            if (st.loginUrl.value === "") {
                st.error.set("先发起一次登录");
                return;
            }
            const result = await callTool("wb_open", { url: st.loginUrl.value });
            if (successOf(result) !== true) {
                st.error.set(`打开授权页失败：${messageOf(result, "无响应")}`);
            }
        });

    const copyLoginUrl = (region) =>
        runRegion(region, "复制链接", async () => {
            const st = regionState[region];
            if (st.loginUrl.value === "") {
                st.error.set("先发起一次登录");
                return;
            }
            await callTool("wb_copy", { text: st.loginUrl.value });
        });

    const confirmLogin = (region) =>
        runRegion(region, "确认登录", async () => {
            const st = regionState[region];
            if (st.loginId.value === "") {
                st.error.set("先发起一次登录");
                return;
            }
            const result = await callTool("wb_login_poll", { login_id: st.loginId.value });
            const data = dataOf(result);
            if (successOf(result) !== true || data.done !== true) {
                st.error.set(`登录未完成：${messageOf(result, "稍后再试")}`);
                return;
            }
            st.loginUrl.set("");
            st.loginId.set("");
            await syncRegion(region);
            await loadModels(region, true);
            await syncConfig(region, true);
        });

    const loadModels = (region, silent) =>
        runRegion(region, "读取模型", async () => {
            const st = regionState[region];
            const result = await callTool("wb_models", { region: region, refresh: true });
            const data = dataOf(result);
            const models = Array.isArray(data.models) ? data.models : [];
            st.modelsJson.set(JSON.stringify(models));
            st.modelsExpanded.set(true);
            if (models.length === 0 && silent !== true) {
                st.error.set(`读取模型清单失败：${messageOf(result, "无可用模型")}`);
            }
        });

    const syncConfig = (region, silent) =>
        runRegion(region, "同步配置", async () => {
            const st = regionState[region];
            const result = await callTool("wb_sync_config", { region: region });
            if (successOf(result) !== true) {
                if (silent !== true) {
                    st.error.set(`同步配置失败：${messageOf(result, "无响应")}`);
                }
                return;
            }
            showDetail(`${REGION_LABELS[region]}模型配置`, messageOf(result, "已同步"));
        });

    const toggleModels = (region) => {
        const st = regionState[region];
        st.modelsExpanded.set(st.modelsExpanded.value !== true);
    };

    const busyButton = (label, onClick, layout) =>
        ctx.UI.Button(
            Object.assign(
                {
                    enabled: false,
                    onClick: onClick,
                    disabledContainerColor: "surfaceVariant",
                    disabledContentColor: "onSurfaceVariant",
                },
                layout === undefined ? { fillMaxWidth: true } : layout
            ),
            [
                ctx.UI.Row({ verticalAlignment: "center", horizontalArrangement: "center" }, [
                    ctx.UI.CircularProgressIndicator({ width: 16, height: 16, strokeWidth: 2, color: "primary" }),
                    ctx.UI.Spacer({ width: 8 }),
                    ctx.UI.Text({ text: label }),
                ]),
            ]
        );

    const tabItem = (key, label) => {
        const selected = tabState.value === key;
        return ctx.UI.Tab({
            selected: selected,
            onClick: () => {
                tabState.set(key);
                refreshRegion(key);
            },
            content: [
                ctx.UI.Text({
                    text: label,
                    style: "titleSmall",
                    fontWeight: selected ? "bold" : "normal",
                }),
            ],
        });
    };

    const detailChip = (title, body) =>
        ctx.UI.TextButton({
            text: "详情",
            onClick: () => showDetail(title, body),
        });

    const serviceCard = ctx.UI.Card({ fillMaxWidth: true }, [
        ctx.UI.Column({ padding: 16, spacing: 12 }, [
            ctx.UI.Row({ verticalAlignment: "center" }, [
                ctx.UI.Icon({
                    name: serviceOkState.value ? "checkCircle" : "error",
                    tint: serviceOkState.value ? "primary" : "error",
                }),
                ctx.UI.Spacer({ width: 10 }),
                ctx.UI.Column({ weight: 1, spacing: 2 }, [
                    ctx.UI.Text({
                        text: serviceOkState.value ? "接入服务正常" : "接入服务未响应",
                        style: "titleSmall",
                        fontWeight: "semiBold",
                        color: serviceOkState.value ? "onSurface" : "error",
                    }),
                    ctx.UI.Text({
                        text: serviceTextState.value === "" ? "尚未读取状态" : serviceTextState.value,
                        style: "labelMedium",
                        color: "onSurfaceVariant",
                    }),
                ]),
            ]),
            ctx.UI.Row({ fillMaxWidth: true, verticalAlignment: "center" }, [
                ctx.UI.Button({ text: "启动服务", weight: 1, onClick: () => controlService("start") }),
                ctx.UI.Spacer({ width: 4 }),
                ctx.UI.TextButton({ text: "重启", onClick: () => controlService("restart") }),
                ctx.UI.TextButton({
                    text: serviceBusyState.value === "刷新" ? "读取中" : "刷新",
                    onClick: refreshService,
                }),
            ]),
        ]),
    ]);

    const accountCard = (region) => {
        const st = regionState[region];
        const children = [
            ctx.UI.Row({ fillMaxWidth: true, verticalAlignment: "center" }, [
                ctx.UI.Icon({ name: "person", tint: "primary" }),
                ctx.UI.Spacer({ width: 10 }),
                ctx.UI.Column({ weight: 1, spacing: 2 }, [
                    ctx.UI.Text({ text: `${REGION_LABELS[region]}账号`, style: "labelMedium", color: "onSurfaceVariant" }),
                    ctx.UI.Text({
                        text: st.accountText.value === "" ? "尚未读取" : st.accountText.value,
                        style: "bodyLarge",
                        color: st.signedIn.value ? "onSurface" : "onSurfaceVariant",
                        maxLines: 1,
                        overflow: "ellipsis",
                    }),
                ]),
                ctx.UI.Spacer({ width: 12 }),
                ctx.UI.Column({ horizontalAlignment: "end", spacing: 2 }, [
                    ctx.UI.Text({
                        text: st.creditsText.value === "" ? "—" : st.creditsText.value,
                        style: "headlineSmall",
                        fontWeight: "bold",
                        color: "primary",
                        maxLines: 1,
                        overflow: "ellipsis",
                    }),
                    ctx.UI.Text({ text: "剩余积分", style: "labelSmall", color: "onSurfaceVariant" }),
                ]),
            ]),
            ctx.UI.Row({ verticalAlignment: "center" }, [
                detailChip(
                    `${REGION_LABELS[region]}账号`,
                    `账号：${st.accountText.value === "" ? "未知" : st.accountText.value}\n积分：${st.creditsText.value === "" ? "未知" : st.creditsText.value}\n\n${st.creditsDetail.value === "" ? "无积分明细" : st.creditsDetail.value}`
                ),
                ctx.UI.Spacer({ weight: 1 }),
                st.busy.value === "刷新状态"
                    ? busyButton("刷新中", () => refreshRegion(region))
                    : ctx.UI.TextButton({ text: "刷新", onClick: () => refreshRegion(region) }),
            ]),
            ctx.UI.HorizontalDivider(),
            ctx.UI.Row({ fillMaxWidth: true }, [
                ctx.UI.OutlinedButton({ text: "发起登录", weight: 1, onClick: () => startLogin(region) }),
                ctx.UI.Spacer({ width: 8 }),
                ctx.UI.OutlinedButton({ text: "读取模型", weight: 1, onClick: () => loadModels(region, false) }),
            ]),
        ];
        if (st.loginUrl.value !== "") {
            children.push(
                ctx.UI.Row({ padding: { vertical: 6 }, verticalAlignment: "center" }, [
                    ctx.UI.Icon({ name: "checkCircle", tint: "primary" }),
                    ctx.UI.Spacer({ width: 10 }),
                    ctx.UI.Text({ text: "授权链接已写入剪贴板", style: "labelLarge", color: "primary" }),
                ])
            );
            children.push(ctx.UI.Text({ text: st.loginUrl.value, style: "bodySmall", color: "primary", maxLines: 2, overflow: "ellipsis" }));
            children.push(
                ctx.UI.Row({ fillMaxWidth: true }, [
                    ctx.UI.Button({ text: "打开授权页", weight: 1, onClick: () => openAuthUrl(region) }),
                    ctx.UI.Spacer({ width: 8 }),
                    st.busy.value === "确认登录"
                        ? busyButton("确认中", () => confirmLogin(region), { weight: 1 })
                        : ctx.UI.Button({ text: "确认登录", weight: 1, onClick: () => confirmLogin(region) }),
                ])
            );
            children.push(ctx.UI.TextButton({ text: "重新复制链接", fillMaxWidth: true, onClick: () => copyLoginUrl(region) }));
        }
        return ctx.UI.Card({ fillMaxWidth: true }, [ctx.UI.Column({ padding: 16, spacing: 12 }, children)]);
    };

    const modelRow = (region, model) => {
        const id = model === null || model === undefined || model.id === undefined ? "未知模型" : String(model.id);
        const credits = model !== null && model !== undefined && model.credits !== undefined && model.credits !== null ? String(model.credits) : "";
        const promotion = model !== null && model !== undefined && model.promotion !== null && model.promotion !== undefined ? model.promotion : undefined;
        const promoLabel = promotion !== undefined && promotion !== null && typeof promotion.label === "string" ? promotion.label : "";
        const running = promotion !== undefined && promotion !== null && promotion.inWindow === true ? "进行中" : "";
        const until = promotion !== undefined && promotion !== null && typeof promotion.until === "string" ? `至 ${promotion.until}` : "";
        const meta = [credits, promoLabel, running, until].filter((item) => item !== "").join(" · ");
        const context = model !== null && model !== undefined && model.contextWindow !== undefined ? `上下文 ${model.contextWindow}` : "";
        const body = [
            `模型 ${id}`,
            context,
            credits === "" ? "" : `倍率 ${credits}`,
            promoLabel === "" ? "无活动" : `活动 ${promoLabel}${running === "" ? "" : `（${running}）`}${until === "" ? "" : ` ${until}`}`,
        ].filter((item) => item !== "").join("\n");
        return ctx.UI.Row({ fillMaxWidth: true, verticalAlignment: "center", padding: { vertical: 6 } }, [
            ctx.UI.Column({ weight: 1, spacing: 3 }, [
                ctx.UI.Text({ text: id, style: "bodyMedium", fontWeight: "semiBold", maxLines: 1, overflow: "ellipsis" }),
                ctx.UI.Text({
                    text: meta === "" ? "无倍率信息" : meta,
                    style: "labelMedium",
                    color: "onSurfaceVariant",
                    maxLines: 1,
                    overflow: "ellipsis",
                }),
            ]),
            ctx.UI.Spacer({ width: 10 }),
            detailChip(`${REGION_LABELS[region]}模型`, body),
        ]);
    };

    const modelsCard = (region) => {
        const st = regionState[region];
        const models = parseModels(st.modelsJson.value);
        const expanded = st.modelsExpanded.value === true;
        const children = [
            ctx.UI.Row({ fillMaxWidth: true, verticalAlignment: "center" }, [
                ctx.UI.Icon({ name: "list", tint: "primary" }),
                ctx.UI.Spacer({ width: 10 }),
                ctx.UI.Text({ text: `${REGION_LABELS[region]}可用模型`, style: "titleMedium", fontWeight: "semiBold" }),
                ctx.UI.Spacer({ width: 8 }),
                models.length === 0
                    ? ctx.UI.Text({ text: "未读取", style: "labelMedium", color: "onSurfaceVariant" })
                    : ctx.UI.Badge({ content: ctx.UI.Text({ text: String(models.length), style: "labelSmall" }) }),
                ctx.UI.Spacer({ weight: 1 }),
                ctx.UI.TextButton({
                    text: expanded ? "收起" : "展开",
                    onClick: () => toggleModels(region),
                }),
            ]),
        ];
        if (expanded) {
            children.push(ctx.UI.HorizontalDivider());
            if (models.length === 0) {
                children.push(
                    ctx.UI.Column({ padding: { vertical: 10 }, spacing: 4 }, [
                        ctx.UI.Text({ text: "尚未读取模型清单", style: "bodyMedium", color: "onSurfaceVariant" }),
                        ctx.UI.Text({ text: "点下方按钮从上游拉取当前可用模型与实时倍率。", style: "labelMedium", color: "onSurfaceVariant" }),
                    ])
                );
            } else {
                for (let index = 0; index < models.length; index += 1) {
                    children.push(modelRow(region, models[index]));
                    if (index < models.length - 1) {
                        children.push(ctx.UI.HorizontalDivider());
                    }
                }
            }
        }
        children.push(ctx.UI.HorizontalDivider());
        children.push(
            ctx.UI.Row({ fillMaxWidth: true }, [
                st.busy.value === "读取模型"
                    ? busyButton("读取中", () => loadModels(region, false), { weight: 1 })
                    : ctx.UI.OutlinedButton({ text: "读取模型清单", weight: 1, onClick: () => loadModels(region, false) }),
                ctx.UI.Spacer({ width: 8 }),
                st.busy.value === "同步配置"
                    ? busyButton("同步中", () => syncConfig(region, false), { weight: 1 })
                    : ctx.UI.Button({ text: "同步到配置", weight: 1, onClick: () => syncConfig(region, false) }),
            ])
        );
        children.push(
            ctx.UI.Text({
                text: "倍率来自上游接口实时数据，活动规则来自官方公告，接口不返回，过期后需更新。",
                style: "labelSmall",
                color: "onSurfaceVariant",
            })
        );
        return ctx.UI.Card({ fillMaxWidth: true }, [ctx.UI.Column({ padding: 16, spacing: 12 }, children)]);
    };

    const errorCard = (region) => {
        const st = regionState[region];
        if (st.error.value === "") {
            return null;
        }
        return ctx.UI.Surface(
            {
                fillMaxWidth: true,
                containerColor: "errorContainer",
                contentColor: "onErrorContainer",
                shape: { type: "rounded", cornerRadius: 12 },
            },
            [
                ctx.UI.Row({ padding: 14, verticalAlignment: "center" }, [
                    ctx.UI.Icon({ name: "error" }),
                    ctx.UI.Spacer({ width: 10 }),
                    ctx.UI.Text({ text: st.error.value, style: "bodyMedium" }),
                ]),
            ]
        );
    };

    const active = tabState.value === "global" ? "global" : "cn";
    const children = [
        ctx.UI.Column({ spacing: 6 }, [
            ctx.UI.Row({ verticalAlignment: "center" }, [
                ctx.UI.Icon({ name: "computer", tint: "primary" }),
                ctx.UI.Spacer({ width: 10 }),
                ctx.UI.Text({ text: "WorkBuddy 接入", style: "headlineSmall", fontWeight: "bold", maxLines: 1, overflow: "ellipsis" }),
            ]),
            ctx.UI.Text({
                text: "国内版与国际版凭据各自独立保存，服务未运行时自动拉起。",
                style: "bodySmall",
                color: "onSurfaceVariant",
            }),
        ]),
        serviceCard,
        ctx.UI.PrimaryTabRow({
            selectedTabIndex: active === "global" ? 1 : 0,
            tabs: [tabItem("cn", "国内版"), tabItem("global", "国际版")],
        }),
        accountCard(active),
        modelsCard(active),
    ];

    const err = errorCard(active);
    if (err !== null) {
        children.push(err);
    }

    if (serviceErrorState.value !== "") {
        children.push(
            ctx.UI.Surface(
                {
                    fillMaxWidth: true,
                    containerColor: "errorContainer",
                    contentColor: "onErrorContainer",
                    shape: { type: "rounded", cornerRadius: 12 },
                },
                [
                    ctx.UI.Row({ padding: 14, verticalAlignment: "center" }, [
                        ctx.UI.Icon({ name: "error" }),
                        ctx.UI.Spacer({ width: 10 }),
                        ctx.UI.Text({ text: serviceErrorState.value, style: "bodyMedium" }),
                    ]),
                ]
            )
        );
    }

    if (detailTitleState.value !== "") {
        children.push(
            ctx.UI.AlertDialog({
                title: detailTitleState.value,
                text: detailBodyState.value,
                confirmText: "关闭",
                onConfirm: closeDetail,
                onDismissRequest: closeDetail,
            })
        );
    }

    return ctx.UI.LazyColumn(
        {
            onLoad: async () => {
                try {
                    const probe = await callTool("wb_status");
                    if (successOf(probe) !== true) {
                        await callTool("wb_service", { action: "start" });
                    }
                } catch (error) {
                    try {
                        await callTool("wb_service", { action: "start" });
                    } catch (innerError) {
                        /* 拉起失败由服务卡片显示 */
                    }
                }
                await runService("刷新", async () => {
                    await syncService();
                    await syncRegion(active);
                });
            },
            fillMaxSize: true,
            padding: 16,
            spacing: 16,
        },
        children
    );
}