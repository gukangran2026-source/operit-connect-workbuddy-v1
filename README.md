# operit-connect-workbuddy

把 DSH Connect WorkBuddy 改编到 Operit AI 上。

让 Operit 直接使用本机已登录的 WorkBuddy 账号，国内版与国际版两个区域并行可用。

## 项目来源

本项目**改编自** [dingminhua/dsh-connect-workbuddy](https://github.com/dingminhua/dsh-connect-workbuddy)（MIT，Copyright (c) 2026 LaoDing），并非原创项目。

原插件是 DeepSeek Harness 专用插件，依赖 cordis 宿主进程加载，与 Operit 的 QuickJS 运行时没有共同加载接口，无法直接搬运代码。因此本项目采取的方式是：抽取原插件的上游调用逻辑，剥离 DSH / cordis / React 依赖，重建为「本机反代服务 + Operit ToolPkg」两部分，两者通过本机 HTTP 通信。

上游协议、鉴权头约定、token 刷新机制均对齐原插件的实现。原插件作者 dingminhua 的版权与许可声明按 MIT 条款完整保留，见 [LICENSE](LICENSE)。

## 架构

项目由两个部分组成。

**第一部分：本机反代服务 `server.mjs`**

零依赖纯 Node 实现，只使用 Node 内置模块。对外提供 OpenAI 兼容接口，对内调用 WorkBuddy 上游。

暴露的端点：

- `GET /healthz` — 服务状态与双区域登录态
- `GET /{region}/v1/models` — 模型清单，OpenAI 格式
- `POST /{region}/v1/chat/completions` — 对话，支持流式与非流式
- `POST /admin/login` — 发起登录，返回授权链接
- `GET /admin/login/poll` — 轮询换取 token
- `GET /admin/catalog` — 模型目录，含倍率与活动信息
- `GET /admin/credits` — 积分查询，只读

`region` 取值 `cn` 或 `global`，两者凭据分离存储，互不覆盖。

**第二部分：Operit ToolPkg 插件 `toolpkg/`**

在 Operit 侧边栏注册入口，提供图形界面与 12 个工具：

- `wb_status` — 查看服务与双区域登录状态
- `wb_login` — 发起登录，授权链接自动进剪贴板
- `wb_login_poll` — 查询登录会话
- `wb_models` — 读取模型清单
- `wb_chat` — 直接调用模型对话
- `wb_credits` — 查询积分
- `wb_activity` — 查询限时活动（名称、赛季、起止时间、剩余天数、介绍、规则、奖励）
- `wb_checkin` — 手动领取当日活动奖励（自动领取失灵时的兜底入口）
- `wb_service` — 启动 / 停止 / 重启接入服务与守护进程
- `wb_copy` — 写入剪贴板
- `wb_open` — 用系统浏览器打开链接
- `wb_sync_config` — 把模型清单同步为 Operit 模型配置

界面按区域分为「国内版」「国际版」两个标签页，每个标签页集中该区域的账号、模型、积分三块内容。模型列表默认折叠，展开后每个模型显示实时倍率与活动状态。

两个标签页最下方各有一张**限时活动卡片**，同样默认收起：

- 收起态显示活动名、赛季徽标与一行摘要（每日可得积分、本季已累计）。
- 点「展开」后依次显示活动介绍、活动内容（规则）、本周签到进度条、奖励明细（每日签到 / 连签奖励 / 周进度 / 本季累计）。
- 该区域没有进行中的活动时（例如国际版），降级为「暂无」态，不占版面。
- 数据源是 `POST /v2/billing/meter/checkin-activity-status`，与签到状态同源；介绍与规则文案来自 `activities.json`。

### 卡片的领取按钮

展开后卡片底部有一行操作，右下角是领取入口。按钮形态由服务端返回的 `claimMode` 决定：

| 状态 | 右下角 | 行为 |
|---|---|---|
| 今日已领取（`todayCheckedIn`） | **已领取**（置灰，不可点） | — |
| 可接口领取（`claimMode: "api"`） | **立即领取**（带图标） | 调 `wb_checkin` 走 `POST /admin/checkin` |
| 只能跳链（`claimMode: "link"`） | **去领取**（带图标） | 复制链接，再交给系统打开：http(s) 落默认浏览器，应用深链落对应客户端 |
| 无活动（`claimMode: "none"`） | 不显示 | — |

**为什么要有这个按钮**：自动签到由后台守护进程负责，万一守护没跑起来或者上游抽风，可以在这里手动补一次。接口对重复领取是幂等的，返回「今天已签到」会被识别为「已领取」而不是失败。

**链接的处理**：`action_button.action` 可能是 `workbuddy://` 这类应用深链，浏览器打不开。所以点击时**先把链接写进剪贴板**，再判断协议——`http(s)` 就交给默认浏览器，其他协议只复制并提示到 WorkBuddy 客户端内使用。这样两种情况都不会白点。

界面按 Material 3 规范构建：导航用 PrimaryTabRow，服务状态用容器色区分，操作按主次分为填充按钮、描边按钮与文字按钮。

每次进入面板、每次切换标签页，都会重新读取该区域的账号与积分，不需要手动点刷新。

同步模型配置时会一并写入上下文长度：取该区域所有模型上下文窗口的最大值，按 Operit 的倍率单位换算，实际可用上下文不再停留在默认的 64K。

## 安装

### 前置条件

- Android 设备上的 Operit，已启用终端环境
- 终端环境内安装 Node.js 18 或更高版本

### 第一步：部署反代服务

把 `server.mjs`、`promotions.json` 与 `watchdog.sh` 放到同一个目录，例如 `/root/workbuddy-bridge/`。

启动服务：

```bash
cd /root/workbuddy-bridge
setsid node server.mjs > bridge.log 2>&1 &
```

首次启动会自动生成 `config.json`，其中包含随机 API Key 与默认端口 8787。

检查服务状态：

```bash
curl -sS http://127.0.0.1:8787/healthz
```

### 第二步：安装 ToolPkg 插件

在 Operit 中导入 `operit-connect-workbuddy-v1.toolpkg`。

插件会自动从服务端 `config.json` 读取 API Key，无需手动填写。

### 第三步：登录账号

打开侧边栏的 WorkBuddy 面板，在对应标签页点击「发起登录」。授权链接会自动写入剪贴板，用浏览器打开完成授权即可。

登录成功后，点击「同步模型配置」，插件会把该区域的模型清单自动写进 Operit 的模型设置，无需手动填写。

### 第四步：开始使用

在 Operit 模型设置中选择「WorkBuddy 国内版」或「WorkBuddy 国际版」即可对话。

## 更新包（重要）

**把 `.toolpkg` 复制到 `packages` 目录不会让 Operit 立刻加载它。** 宿主只在启动时扫描一次，之后必须发一条调试广播才会重新扫描并重新注册工具。

不发广播的典型症状是**界面是新的、工具还是旧的**，表现为：

```
操作失败：Tool not found: wb_activity
```

原因是 UI 脚本每次渲染都从磁盘重新读取，而工具表是在包加载时一次性注册的。所以改了子包（新增 / 改名工具）后必须刷新。

### 一条命令搞定

```bash
bash deploy.sh
```

脚本会打包、校验、推送到 `Download` 与 `packages` 两个位置，并打印出需要执行的广播命令。

### 广播命令

`am` 只能在 Android shell 里跑（proot 没有 `/system` 挂载），所以这一步要单独执行：

```bash
am broadcast -a com.ai.assistance.operit.DEBUG_REFRESH_PACKAGES \
  -p com.ai.assistance.operit --ez reactivate_active_packages true
```

这条广播打到 `PackageDebugRefreshReceiver`，它会：

1. 强制重扫外部 `packages` 目录
2. 销毁旧的 ToolPkg 执行引擎
3. 注销已注册的旧工具
4. 对之前处于启用状态的包重新执行激活，按新的 METADATA 注册工具

### 验证

```bash
PID=$(pgrep -f 'com.ai.assistance.operit$' | head -1)
logcat -d --pid=$PID | grep PackageDebugRefreshReceiver
```

出现下面几行即为成功：

```
PackageDebugRefreshReceiver: Starting debug package refresh: reactivateActivePackages=true
ToolPkg : PKG: loadAvailablePackages finish, elapsedMs=28, available=64, containers=16, subpackages=12, errors=0
PackageManager: Successfully loaded and activated package: workbuddy_tools
PackageDebugRefreshReceiver: Enabled external toolpkg containers: ..., com.operit.connect_workbuddy
PackageDebugRefreshReceiver: Reactivated packages: ..., workbuddy_tools
```

### 另一种做法

重启 Operit 应用也能达到同样效果，但会一并杀掉 proot 里的接入服务、服务守护与签到守护。重启后 `/etc/profile.d/00-workbuddy-autostart.sh` 会在下次建立终端会话时把它们拉回来，不需要手动操作。

## 服务保活

Android 系统可能在内存紧张时回收后台进程。当前有四层保护。

**一、发消息前自动检查**

插件注册了发消息前钩子。每次向模型发起请求前，先检查接入服务是否可用，不可用时立即拉起，请求随后才发出，因此服务掉线不会导致本次请求失败。检查走本机 HTTP 请求，服务正常时开销可忽略。

钩子的探测会打到服务的 `/admin/hook-ping`，服务端把它记进 `hook.log`（30 秒内只记一行，避免刷屏）。想确认钩子到底有没有在跑，发一条消息后看这个文件即可：

```bash
tail -5 /root/workbuddy-bridge/hook.log
```

文件里有新的时间戳，说明钩子确实被宿主调用了；一直为空则说明插件没被启用，或钩子注册失败。

**二、守护进程每分钟巡检**

`watchdog.sh` 常驻运行，每 60 秒检查一次接入服务，无响应则拉起。适合 Agent 长时间运行、期间不发消息的场景。

```bash
cp watchdog.sh /root/workbuddy-bridge/
cd /root/workbuddy-bridge && nohup bash watchdog.sh >/dev/null 2>&1 &
```

守护进程随 `wb_service` 一起启停：`start` 与 `restart` 会确保它在运行，`stop` 会连同它一起停止，`status` 同时报告两者状态。运行记录写入 `watchdog.log`，进程号写入 `watchdog.pid`。

**三、面板手动控制**

面板上的「启动服务 / 重启服务」按钮。

**四、面板打开时自动检测**

打开面板时若服务未运行会自动拉起，并顺带确保守护进程在运行。

以上措施保证服务掉线后能快速恢复，但不阻止系统回收进程。终端环境整体被回收时，需要重新启动终端环境。

## 活动数据表

两张人工维护的表，都只补上游不返回的部分：

**`promotions.json`** — 模型限时免费与折扣规则。

WorkBuddy 上游接口只返回基准倍率，不返回任何时段优惠信息。因此活动规则来自官方公告文章，需要人工同步更新。规则过期后会被自动忽略。时区处理按北京时间判断，不依赖运行环境的时区设置。

**`activities.json`** — 限时活动卡片的介绍与规则文案。

上游 `checkin-activity-status` 返回的是结构化字段（主题名、赛季、起止时间、积分数），没有活动介绍长文。所以卡片里**所有数字取自实时接口**，只有介绍与规则文案从本表按 `theme_name` 索引取出。官方换活动主题后，卡片会自动显示新主题的数据，但文案需要在本表补一条。

## 已知限制

- 依赖 WorkBuddy 客户端接口，非官方开放 API。上游更新后可能需要调整。
- WorkBuddy 国际网关自 2026-10-16 起要求请求头携带会话身份三件套（`X-Conversation-ID` / `X-Conversation-Request-ID` / `X-Conversation-Message-ID`），缺失会返回 400 / 11128；当前 server.mjs 已内置每次请求随机生成。
- 活动规则表为人工维护，官方调整后需要手动同步。
- 一个模型配置内的多个模型共享同一个上下文长度。同步时按该区域的最大窗口写入，若改用窗口较小的模型，建议在 Operit 模型设置里把上下文长度调低，避免超出该模型上限。
- Compose DSL 没有动画 API，模型列表的折叠展开为瞬时切换，无过渡动画。
- 凭据有效期以账号实际状态为准，过期后需重新登录。
- **上游用量限流（`code 6004`）按「线路」计算，不按模型 ID。** 免费档（倍率 `x0.00`）指的是不扣积分，不等于不限量；额度耗尽后返回 429。上游给出的付费变体（如 `deepseek-v4.1-flash` → `deepseek-v4.1-flash-sg`）与免费档共享同一额度，实测重置时间完全一致，因此切换付费变体绕不过去，只能换其他线路的模型。命中限流后服务会在错误信息里附上重置时间与同区域可用的免费替代模型。
- 配置项 `autoFallbackOnRateLimit`（`config.json`，默认 `false`）：置 `true` 后，命中限流会按上游的 `freeId` → `paidId` 映射自动重试一次。由于上述线路级限制，对 `Deepseek-V4.1-Flash` 这条线路无效；且付费变体会消耗积分，故默认关闭。

## 免责声明

- 本项目仅供个人学习和研究使用，仅驱动使用者自己的 WorkBuddy 账号在本机调用。
- 使用者需遵守 WorkBuddy 的服务条款，因使用本项目产生的后果由使用者自行承担。
- 本项目与腾讯、WorkBuddy、DeepSeek、Operit 均无关联，未获其授权或认可。文中出现的名称仅用于描述兼容关系，商标权利归各自所有。

## 许可证

MIT。原始版权归属 Copyright (c) 2026 LaoDing，移植部分版权归属 Copyright (c) 2026 gukangran2026-source。完整声明见 [LICENSE](LICENSE)。
