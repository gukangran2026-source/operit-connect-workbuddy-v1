#!/usr/bin/env node
/**
 * workbuddy-bridge
 *
 * 把 WorkBuddy（腾讯 CodeBuddy 系）账号接入任意 OpenAI 兼容客户端（Operit、Chatbox 等）。
 *
 * 上游调用逻辑抽取自 DSH 插件 dsh-connect-workbuddy 4.5.2（MIT，作者 dingminhua），
 * 剥离 DSH / cordis / React 依赖，只保留「凭据 + 上游客户端 + OpenAI 兼容层」。
 *
 * 用法：
 *   node server.mjs                 启动服务
 *   node server.mjs --login         发起登录（打印授权链接后轮询等待）
 *   node server.mjs --status        查看登录状态
 *   node server.mjs --models        打印模型清单
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(HERE, "config.json");

/** 支持的区域。两者各有独立凭据文件，可同时在线、互不覆盖。 */
const REGIONS = ["cn", "global"];

function credsPath(region) {
  return path.join(HERE, `creds.${region}.json`);
}

/* ------------------------------------------------------------------ *
 * 上游常量（逐条对齐 dsh-connect-workbuddy 4.5.2 的 upstream.ts）
 * ------------------------------------------------------------------ */

const CN_CHAT_BASE = "https://copilot.tencent.com";
const CN_BILLING_BASE = "https://www.codebuddy.cn";
const GLOBAL_BASE_DEFAULT = "https://www.workbuddy.ai";
const API_PREFIX = "/v2/plugin";
const GLOBAL_CONFIG_PATH = "/v3/config";
const MODELS_CATALOG_PATH = "/v2/enterprises/personal/models";
const CLIENT_UA = "CLI/2.63.2 CodeBuddy/2.63.2";
const DESKTOP_UA = "WorkBuddy/5.5.2";
const JSON_TIMEOUT_MS = 30000;
const ERROR_BODY_LIMIT = 4096;
const FALLBACK_SYSTEM_PROMPT = "You are a helpful assistant.";
const CATALOG_TTL_MS = 10 * 60 * 1000;
const REFRESH_MARGIN_MS = 120 * 1000;

/* ------------------------------------------------------------------ *
 * 配置与凭据
 * ------------------------------------------------------------------ */

function loadConfig() {
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
      if (parsed && typeof parsed === "object") {
        return {
          port: Number.isInteger(parsed.port) ? parsed.port : 8787,
          host: typeof parsed.host === "string" && parsed.host ? parsed.host : "127.0.0.1",
          apiKey: typeof parsed.apiKey === "string" && parsed.apiKey ? parsed.apiKey : crypto.randomBytes(24).toString("base64url"),
          region: parsed.region === "global" ? "global" : "cn",
          globalBase: typeof parsed.globalBase === "string" && parsed.globalBase ? parsed.globalBase : GLOBAL_BASE_DEFAULT,
          defaultModel: typeof parsed.defaultModel === "string" ? parsed.defaultModel : "",
        };
      }
    } catch {
      /* 配置损坏时按默认重建，不阻断启动 */
    }
  }
  const fresh = {
    port: 8787,
    host: "127.0.0.1",
    apiKey: crypto.randomBytes(24).toString("base64url"),
    region: "cn",
    globalBase: GLOBAL_BASE_DEFAULT,
    defaultModel: "",
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(fresh, null, 2));
  return fresh;
}

const CONFIG = loadConfig();

function loadCreds(region) {
  const file = credsPath(region);
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (parsed && typeof parsed === "object" && typeof parsed.accessToken === "string" && parsed.accessToken) {
      return { ...parsed, region };
    }
  } catch {
    /* 凭据损坏等同未登录 */
  }
  return null;
}

function saveCreds(region, cred) {
  fs.writeFileSync(credsPath(region), JSON.stringify(cred, null, 2), { mode: 0o600 });
}

/* ------------------------------------------------------------------ *
 * 区域与基址
 * ------------------------------------------------------------------ */

function regionOf(domain) {
  const d = String(domain ?? "").trim().toLowerCase();
  if (d === "workbuddy.ai" || d.endsWith(".workbuddy.ai")) return "global";
  if (d === "codebuddy.ai" || d.endsWith(".codebuddy.ai")) return "global";
  return "cn";
}

function globalBase(domain) {
  const d = String(domain ?? "").trim().toLowerCase();
  if (d === "workbuddy.ai" || d.endsWith(".workbuddy.ai")) return "https://www.workbuddy.ai";
  if (d === "codebuddy.ai" || d.endsWith(".codebuddy.ai")) return "https://www.codebuddy.ai";
  return CONFIG.globalBase || GLOBAL_BASE_DEFAULT;
}

function chatBase(cred) {
  return regionOf(cred?.domain) === "global" ? globalBase(cred.domain) : CN_CHAT_BASE;
}

function billingBase(cred) {
  return regionOf(cred?.domain) === "global" ? globalBase(cred.domain) : CN_BILLING_BASE;
}

function originReferer(cred) {
  return regionOf(cred?.domain) === "global" ? globalBase(cred.domain) : CN_BILLING_BASE;
}

function normalizeBase(base) {
  return String(base).trim().replace(/\/+$/, "");
}

/* ------------------------------------------------------------------ *
 * 请求头（逐条对齐 upstream.ts）
 * ------------------------------------------------------------------ */

function commonHeaders(cred) {
  return {
    Accept: "application/json, text/plain, */*",
    "X-Requested-With": "XMLHttpRequest",
    Origin: originReferer(cred),
    Referer: `${originReferer(cred)}/`,
    "User-Agent": CLIENT_UA,
  };
}

/**
 * 上游新增的会话身份三件套：国际网关要求每次请求携带三个互不相同的 UUID，
 * 缺失时返回 400 / 11128（conversation id missing）。国内网关容忍缺失，一并发送无害。
 * 三个值必须每次请求重新生成，且不能复用同一个值。
 */
function conversationHeaders() {
  return {
    "X-Conversation-ID": crypto.randomUUID(),
    "X-Conversation-Request-ID": crypto.randomUUID(),
    "X-Conversation-Message-ID": crypto.randomUUID(),
  };
}

function chatHeaders(cred) {
  return {
    ...commonHeaders(cred),
    "Content-Type": "application/json",
    ...(cred.uid === "" || cred.uid === undefined ? { "X-No-User-Id": "1" } : { "X-User-Id": cred.uid }),
    ...(cred.enterpriseId === undefined || cred.enterpriseId === ""
      ? { "X-No-Enterprise-Id": "1" }
      : { "X-Enterprise-Id": cred.enterpriseId }),
    ...(cred.domain === "" || cred.domain === undefined ? { "X-No-Department-Info": "1" } : { "X-Domain": cred.domain }),
    "X-Product": "SaaS",
    ...conversationHeaders(),
  };
}

function refreshHeaders(cred) {
  const headers = {
    ...commonHeaders(cred),
    "X-Refresh-Token": cred.refreshToken,
    "X-Auth-Refresh-Source": "workbuddy",
  };
  if (cred.enterpriseId !== undefined && cred.enterpriseId !== "") headers["X-Enterprise-Id"] = cred.enterpriseId;
  return headers;
}

/** 计费请求头（只读查询积分）。 */
function billingHeaders(cred) {
  const headers = {
    Authorization: `Bearer ${cred.accessToken}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  if (cred.uid !== "" && cred.uid !== undefined) headers["X-User-Id"] = cred.uid;
  if (cred.enterpriseId !== undefined && cred.enterpriseId !== "") {
    headers["X-Enterprise-Id"] = cred.enterpriseId;
    headers["X-Tenant-Id"] = cred.enterpriseId;
  }
  if (cred.domain !== "" && cred.domain !== undefined) headers["X-Domain"] = cred.domain;
  return headers;
}

/* ------------------------------------------------------------------ *
 * 请求体改写（对齐 prepareChatBody）
 * ------------------------------------------------------------------ */

function ensureSystemHead(obj) {
  if (!Array.isArray(obj.messages)) return;
  const first = obj.messages[0];
  if (typeof first === "object" && first !== null && first.role === "system") return;
  obj.messages.unshift({ role: "system", content: FALLBACK_SYSTEM_PROMPT });
}

function normalizeToolChoice(obj) {
  const suppress = () => {
    delete obj.tools;
    delete obj.functions;
  };
  if (!("tool_choice" in obj)) return;
  const choice = obj.tool_choice;
  if (typeof choice === "string") {
    if (choice.trim().toLowerCase() === "none") {
      delete obj.tool_choice;
      suppress();
    }
    return;
  }
  if (typeof choice === "object" && choice !== null && !Array.isArray(choice)) {
    const type = typeof choice.type === "string" ? choice.type.trim().toLowerCase() : "";
    if (type === "none") {
      delete obj.tool_choice;
      suppress();
    } else if (type === "auto" || type === "required") obj.tool_choice = type;
    else if (type === "function") {
      const fn = typeof choice.function === "object" && choice.function !== null ? choice.function : undefined;
      let name = typeof fn?.name === "string" ? fn.name : "";
      if (name === "" && typeof choice.name === "string") name = choice.name;
      name = name.trim();
      obj.tool_choice = name !== "" ? name : "auto";
    } else delete obj.tool_choice;
    return;
  }
  delete obj.tool_choice;
}

/** 上游要求 stream=true，且 messages 必须以 system 开头。 */
function prepareChatBody(source) {
  let body;
  try {
    body = JSON.parse(source);
  } catch {
    return source;
  }
  if (typeof body !== "object" || body === null || Array.isArray(body)) return source;
  body.stream = true;
  if (Array.isArray(body.messages)) {
    for (const value of body.messages) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
      if (value.role === "developer") value.role = "system";
    }
  }
  ensureSystemHead(body);
  normalizeToolChoice(body);
  return JSON.stringify(body);
}

/* ------------------------------------------------------------------ *
 * 上游调用
 * ------------------------------------------------------------------ */

function envelopeData(doc) {
  const data = doc?.data;
  return typeof data === "object" && data !== null && !Array.isArray(data) ? data : {};
}

function firstString(source, keys) {
  for (const key of keys) {
    const value = source?.[key];
    if (typeof value === "string" && value.trim() !== "") return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

async function readEnvelope(response) {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return { code: typeof parsed.code === "number" ? parsed.code : -1, data: envelopeData(parsed), raw: parsed, text };
    }
  } catch {
    /* 非 JSON（HTML 错误页）走 text 分支 */
  }
  return { code: -1, data: {}, raw: undefined, text };
}

async function refreshToken(cred) {
  const response = await fetch(`${chatBase(cred)}${API_PREFIX}/auth/token/refresh`, {
    method: "POST",
    headers: refreshHeaders(cred),
    signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
  });
  const envelope = await readEnvelope(response);
  if (!response.ok || envelope.code !== 0) {
    throw new Error(`token 刷新失败 (http ${response.status}, code ${envelope.code}): ${envelope.text.slice(0, 300)}`);
  }
  const accessToken = typeof envelope.data.accessToken === "string" ? envelope.data.accessToken : "";
  if (accessToken === "") throw new Error("token 刷新未返回 accessToken，需要重新登录");
  const next = { ...cred, accessToken };
  if (typeof envelope.data.refreshToken === "string" && envelope.data.refreshToken !== "") next.refreshToken = envelope.data.refreshToken;
  if (typeof envelope.data.domain === "string" && envelope.data.domain !== "") next.domain = envelope.data.domain;
  if (typeof envelope.data.expiresIn === "number" && envelope.data.expiresIn > 0) next.expiresAtMs = Date.now() + envelope.data.expiresIn * 1000;
  saveCreds(next.region ?? (regionOf(next.domain) === "global" ? "global" : "cn"), next);
  return next;
}

/** 取指定区域的可用凭据，必要时先刷新。 */
async function resolveCredential(region) {
  let cred = loadCreds(region);
  if (cred === null) throw new Error(`尚未登录（${region}）：先执行 node server.mjs --login ${region}`);
  if (typeof cred.expiresAtMs === "number" && cred.expiresAtMs > 0 && cred.expiresAtMs - Date.now() < REFRESH_MARGIN_MS) {
    cred = await refreshToken(cred);
  }
  return cred;
}

/** POST 上游对话端点；成功时返回原始 SSE 响应。 */
async function chatStream(cred, bodyJson, signal) {
  let response;
  try {
    response = await fetch(`${chatBase(cred)}/v2/chat/completions`, {
      method: "POST",
      headers: { ...chatHeaders(cred), Authorization: `Bearer ${cred.accessToken}` },
      body: bodyJson,
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (error) {
    return { ok: false, status: 0, kind: "server", message: `transport error: ${String(error)}` };
  }
  if (response.ok) return { ok: true, response };
  const text = (await response.text()).slice(0, ERROR_BODY_LIMIT);
  return { ok: false, status: response.status, kind: classifyUpstreamError(response.status, text), message: text };
}

/** 非流式跑一次对话，返回拼接后的正文。 */
async function runChatOnce(cred, model, prompt) {
  const body = { messages: [{ role: "user", content: prompt }], stream: true };
  if (typeof model === "string" && model !== "") body.model = model;
  const prepared = prepareChatBody(JSON.stringify(body));
  const result = await chatStream(cred, prepared, undefined);
  if (!result.ok) {
    throw new Error(`workbuddy upstream ${result.kind} (http ${result.status}): ${result.message.slice(0, 300)}`);
  }
  const text = await result.response.text();
  let content = "";
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") break;
    let chunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      continue;
    }
    const delta = chunk.choices?.[0]?.delta;
    if (delta !== undefined && typeof delta.content === "string") content += delta.content;
  }
  return content;
}

function classifyUpstreamError(status, body) {
  if (status === 402) return "hard_credit";
  const lower = String(body).toLowerCase();
  if (lower.includes("insufficient") || lower.includes("credit") || body.includes('"code":14018')) return "hard_credit";
  if (body.includes("Offline user session not found") || body.includes("12153")) return "session_dead";
  if (body.includes("request illegal") || body.includes('"code":11140')) return "policy_reject";
  if (body.includes('"code":14003')) return "model_busy";
  if (status === 429) return "soft_rate";
  if (status === 404) return "not_found";
  if (status >= 500) return "server";
  return "client";
}

const KIND_STATUS = {
  hard_credit: 402,
  session_dead: 401,
  policy_reject: 403,
  model_busy: 429,
  soft_rate: 429,
  not_found: 404,
  server: 502,
  client: 400,
};

/* ------------------------------------------------------------------ *
 * 模型目录
 * ------------------------------------------------------------------ */

function parseUpstreamModel(value) {
  if (typeof value !== "object" || value === null) return undefined;
  const id = typeof value.id === "string" ? value.id : "";
  if (id === "" || value.disabled === true) return undefined;
  const input = typeof value.maxInputTokens === "number" ? value.maxInputTokens : 0;
  const output = typeof value.maxOutputTokens === "number" ? value.maxOutputTokens : 0;
  if (input <= 0 || output <= 0) return undefined;
  return {
    id,
    name: typeof value.name === "string" && value.name !== "" ? value.name : id,
    contextWindow: input,
    maxTokens: output,
    credits: value.credits,
  };
}

function selectCliModels(rawModels, agents) {
  const byId = new Map();
  for (const model of Array.isArray(rawModels) ? rawModels : []) {
    const parsed = parseUpstreamModel(model);
    if (parsed !== undefined) byId.set(parsed.id, parsed);
  }
  let cliIds;
  for (const agent of Array.isArray(agents) ? agents : []) {
    if (typeof agent === "object" && agent !== null && agent.name === "cli" && Array.isArray(agent.models)) {
      cliIds = agent.models.filter((id) => typeof id === "string");
      break;
    }
  }
  const ids = cliIds !== undefined && cliIds.length > 0 ? cliIds : [...byId.keys()];
  const models = ids.map((id) => byId.get(id)).filter((model) => model !== undefined);
  if (models.length === 0) throw new Error("模型目录解析为空");
  return models;
}

/* ------------------------------------------------------------------ *
 * 活动规则表
 * 上游 /v3/config 只返回基准倍率（credits），不返回时段优惠规则。
 * 本表人工维护，来源见 promotions.json，可能随官方活动变化而过期。
 * ------------------------------------------------------------------ */

const PROMOTIONS_PATH = path.join(HERE, "promotions.json");

function loadPromotions() {
  const empty = { rules: [], source: "", updatedAt: "", note: "" };
  try {
    if (!fs.existsSync(PROMOTIONS_PATH)) return empty;
    const parsed = JSON.parse(fs.readFileSync(PROMOTIONS_PATH, "utf8"));
    return {
      rules: Array.isArray(parsed.rules) ? parsed.rules : [],
      source: typeof parsed.source === "string" ? parsed.source : "",
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      note: typeof parsed.note === "string" ? parsed.note : "",
    };
  } catch (error) {
    return empty;
  }
}

function minutesOf(clock) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(clock));
  if (match === null) return -1;
  return Number(match[1]) * 60 + Number(match[2]);
}

/** 按北京时间取当天分钟数。运行环境时区可能是 UTC，不能直接用 getHours。 */
function beijingMinutes(now) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    let hour = 0;
    let minute = 0;
    for (const part of parts) {
      if (part.type === "hour") hour = Number(part.value) % 24;
      if (part.type === "minute") minute = Number(part.value);
    }
    return hour * 60 + minute;
  } catch (error) {
    const shifted = new Date(now.getTime() + 8 * 3600 * 1000);
    return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
  }
}

function inTimeWindow(now, start, end) {
  const from = minutesOf(start);
  const to = minutesOf(end);
  if (from < 0 || to < 0) return false;
  const current = beijingMinutes(now);
  return from <= to ? current >= from && current < to : current >= from || current < to;
}

function promotionFor(modelId, promotions, now) {
  const rule = promotions.rules.find((item) => item !== null && typeof item === "object" && item.modelId === modelId);
  if (rule === undefined) return undefined;
  const result = {
    label: typeof rule.label === "string" ? rule.label : "活动",
    type: typeof rule.type === "string" ? rule.type : "promo",
    source: promotions.source,
    updatedAt: promotions.updatedAt,
  };
  if (typeof rule.until === "string" && rule.until !== "") {
    const deadline = Date.parse(`${rule.until}T23:59:59+08:00`);
    result.until = rule.until;
    if (Number.isFinite(deadline) && deadline < now.getTime()) return undefined;
  }
  if (typeof rule.start === "string" && typeof rule.end === "string") {
    result.start = rule.start;
    result.end = rule.end;
    result.inWindow = inTimeWindow(now, rule.start, rule.end);
  }
  return result;
}

/** 给模型目录附加活动信息。 */
function decorateModels(models) {
  const promotions = loadPromotions();
  const now = new Date();
  return models.map((model) => {
    const promotion = promotionFor(model.id, promotions, now);
    return promotion === undefined ? Object.assign({}, model) : Object.assign({}, model, { promotion });
  });
}

/** 按区域缓存模型目录。 */
const catalogCache = new Map();

async function fetchModels(cred, force = false) {
  const cacheKey = cred.region ?? (regionOf(cred.domain) === "global" ? "global" : "cn");
  const cached = catalogCache.get(cacheKey);
  if (!force && cached !== undefined && cached.models.length > 0 && Date.now() - cached.at < CATALOG_TTL_MS) {
    return cached.models;
  }
  const readEnvelopeOk = async (response) => {
    const envelope = await readEnvelope(response);
    if (!response.ok || envelope.code !== 0) {
      throw new Error(`目录请求失败 (http ${response.status}, code ${envelope.code}): ${envelope.text.slice(0, 200)}`);
    }
    return selectCliModels(envelope.data.models, envelope.data.agents);
  };

  let models;
  if (regionOf(cred.domain) === "global") {
    const response = await fetch(`${globalBase(cred.domain)}${GLOBAL_CONFIG_PATH}`, {
      headers: {
        Authorization: `Bearer ${cred.accessToken}`,
        Accept: "application/json",
        ...(cred.uid === "" || cred.uid === undefined ? {} : { "X-User-Id": cred.uid }),
        ...(cred.domain === "" || cred.domain === undefined ? {} : { "X-Domain": cred.domain }),
        "X-Product": "SaaS",
        "X-Requested-With": "XMLHttpRequest",
        Connection: "close",
        "User-Agent": DESKTOP_UA,
      },
      signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
    });
    models = await readEnvelopeOk(response);
  } else {
    const readCatalog = async (p) => {
      const response = await fetch(`${chatBase(cred)}${p}`, {
        headers: {
          Authorization: `Bearer ${cred.accessToken}`,
          Accept: "application/json",
          Origin: originReferer(cred),
          Referer: `${originReferer(cred)}/`,
          "User-Agent": CLIENT_UA,
        },
        signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
      });
      return readEnvelopeOk(response);
    };
    try {
      models = await readCatalog(GLOBAL_CONFIG_PATH);
    } catch (error) {
      console.warn(`[bridge] CN ${GLOBAL_CONFIG_PATH} 失败，回退 ${MODELS_CATALOG_PATH}: ${error.message}`);
      models = await readCatalog(MODELS_CATALOG_PATH);
    }
  }
  catalogCache.set(cacheKey, { at: Date.now(), models });
  return models;
}

/* ------------------------------------------------------------------ *
 * 积分查询（只读，不消耗积分）
 * ------------------------------------------------------------------ */

function formatStamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function parseStamp(raw) {
  if (typeof raw === "number" && raw > 0xe8d4a51000) return raw;
  if (typeof raw === "string" && raw !== "") {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

async function fetchCredits(cred) {
  const now = new Date();
  const response = await fetch(`${billingBase(cred)}/v2/billing/meter/get-user-resource`, {
    method: "POST",
    headers: billingHeaders(cred),
    body: JSON.stringify({
      PageNumber: 1,
      PageSize: 100,
      ProductCode: "p_tcaca",
      Status: [0, 3],
      PackageEndTimeRangeBegin: formatStamp(now),
      PackageEndTimeRangeEnd: formatStamp(new Date(now.getTime() + 3185136e6)),
    }),
    signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
  });
  const envelope = await readEnvelope(response);
  if (!response.ok || envelope.code !== 0) {
    throw new Error(`积分查询失败 (http ${response.status}, code ${envelope.code}): ${envelope.text.slice(0, 200)}`);
  }
  const wrapper = typeof envelope.data.Response === "object" && envelope.data.Response !== null ? envelope.data.Response : {};
  const inner = typeof wrapper.Data === "object" && wrapper.Data !== null ? wrapper.Data : {};
  const rawAccounts = Array.isArray(inner.Accounts) ? inner.Accounts : [];
  let total = 0;
  let nearestExpiryMs;
  const packages = [];
  for (const raw of rawAccounts) {
    if (typeof raw !== "object" || raw === null) continue;
    const numberField = (key) => (typeof raw[key] === "number" ? raw[key] : 0);
    const preciseField = (key) => {
      const value = raw[`${key}Precise`];
      if (typeof value === "string" && value !== "") {
        const parsed = Number.parseFloat(value);
        if (Number.isFinite(parsed)) return parsed;
      }
      if (typeof value === "number" && Number.isFinite(value)) return value;
      return numberField(key);
    };
    const monthly = numberField("CapacityType") === 4;
    const remain =
      raw.CycleCapacityRemain !== undefined || raw.CycleCapacityRemainPrecise !== undefined
        ? preciseField("CycleCapacityRemain")
        : preciseField("CapacityRemain");
    const capped = remain < 0 ? 0 : remain;
    const cycleEndMs = parseStamp(raw.CycleEndTime);
    const expiresAtMs = monthly ? undefined : (parseStamp(raw.ExpiredTime) ?? cycleEndMs);
    if (!monthly && (capped <= 0 || (expiresAtMs !== undefined && expiresAtMs <= Date.now()))) continue;
    total += capped;
    if (expiresAtMs !== undefined && (nearestExpiryMs === undefined || expiresAtMs < nearestExpiryMs)) nearestExpiryMs = expiresAtMs;
    packages.push({
      packageName: typeof raw.PackageName === "string" ? raw.PackageName : "(unnamed)",
      remain: capped,
      monthly,
      ...(expiresAtMs === undefined ? {} : { expiresAt: new Date(expiresAtMs).toISOString() }),
    });
  }
  return {
    region: cred.region ?? (regionOf(cred.domain) === "global" ? "global" : "cn"),
    account: cred.nickname ?? cred.uid ?? null,
    total,
    packages,
    nearestExpiry: nearestExpiryMs === undefined ? null : new Date(nearestExpiryMs).toISOString(),
  };
}

/* ------------------------------------------------------------------ *
 * 登录（OAuth：state → 浏览器授权 → 轮询换 token）
 * ------------------------------------------------------------------ */

const loginSessions = new Map();

function oauthBillingBase(region, explicitBase) {
  if (region === "cn") return CN_BILLING_BASE;
  const trimmed = typeof explicitBase === "string" ? explicitBase.trim() : "";
  return trimmed !== "" ? normalizeBase(trimmed) : GLOBAL_BASE_DEFAULT;
}

async function oauthStart(region, explicitBase) {
  const base = normalizeBase(oauthBillingBase(region, explicitBase));
  let response;
  try {
    response = await fetch(`${base}${API_PREFIX}/auth/state?platform=workbuddy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(30000),
    });
  } catch (error) {
    return { error: `无法连接 ${base} 发起登录: ${String(error)}` };
  }
  const envelope = await readEnvelope(response);
  if (envelope.raw === undefined) return { error: `登录服务返回了非 JSON 响应 (http ${response.status})` };
  const state = firstString(envelope.data, ["state", "State"]);
  if (state === "") return { error: `登录服务未签发 state (http ${response.status})` };
  const authUrl = firstString(envelope.data, ["authUrl", "auth_url", "url", "Url"]) || `${base}/login?state=${encodeURIComponent(state)}`;
  const loginId = `wbo_${crypto.randomUUID().replaceAll("-", "")}`;
  loginSessions.set(loginId, { region, base, state, expiresAtMs: Date.now() + 600000, done: false });
  return { loginId, verificationUri: authUrl, expiresIn: 600 };
}

async function oauthPoll(loginId) {
  const session = loginSessions.get(loginId);
  if (session === undefined) return { done: true, error: "登录会话不存在，请重新发起" };
  if (session.done) return session.result !== undefined ? { done: true, account: session.result } : { done: true, error: session.error ?? "登录未产生结果" };
  if (Date.now() > session.expiresAtMs) {
    session.done = true;
    loginSessions.delete(loginId);
    return { done: true, error: "登录超时，请重新发起" };
  }
  let response;
  try {
    response = await fetch(`${session.base}${API_PREFIX}/auth/token?state=${encodeURIComponent(session.state)}`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    return { done: false };
  }
  const envelope = await readEnvelope(response);
  if (envelope.raw === undefined) return { done: false };
  const code = typeof envelope.raw.code === "number" ? envelope.raw.code : -1;
  if (code !== 0 && code !== 200) return { done: false };
  const accessToken = firstString(envelope.data, ["accessToken", "access_token", "AccessToken"]);
  if (accessToken === "") return { done: false };

  session.done = true;
  try {
    const account = await collectAccount(session, accessToken, envelope.data);
    loginSessions.delete(loginId);
    saveCreds(session.region, account);
    session.result = account;
    return { done: true, account };
  } catch (error) {
    session.error = String(error instanceof Error ? error.message : error);
    loginSessions.delete(loginId);
    return { done: true, error: session.error };
  }
}

async function collectAccount(session, accessToken, tokenData) {
  const headers = { Authorization: `Bearer ${accessToken}`, Accept: "application/json" };
  const domain = firstString(tokenData, ["domain", "Domain"]);
  if (domain !== "") headers["X-Domain"] = domain;
  let profile = {};
  try {
    const response = await fetch(`${session.base}${API_PREFIX}/login/account`, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(30000),
    });
    const envelope = await readEnvelope(response);
    profile = envelope.data;
  } catch {
    /* 账号资料拿不到不影响对话能力 */
  }
  const expiresAtMs = expiryMs(tokenData, ["expiresAt", "expires_at"], ["expiresIn", "expires_in"]) ?? 0;
  const refreshExpiresAtMs = expiryMs(tokenData, ["refreshExpiresAt", "refresh_expires_at"], ["refreshExpiresIn", "refresh_expires_in"]);
  const uid = firstString(profile, ["uid", "Uid", "userId", "UserID"]);
  const enterpriseId = firstString(profile, ["enterpriseId", "EnterpriseId"]);
  const nickname = firstString(profile, ["nickname", "NickName", "ScreenName"]);
  return {
    accessToken,
    refreshToken: firstString(tokenData, ["refreshToken", "refresh_token", "RefreshToken"]),
    expiresAtMs,
    ...(refreshExpiresAtMs === undefined ? {} : { refreshExpiresAtMs }),
    domain: domain !== "" ? domain : firstString(profile, ["domain", "Domain"]),
    uid,
    ...(enterpriseId === "" ? {} : { enterpriseId }),
    ...(nickname === "" ? {} : { nickname }),
    region: session.region,
    savedAt: new Date().toISOString(),
  };
}

function expiryMs(source, absoluteKeys, ttlKeys) {
  for (const key of absoluteKeys) {
    const value = source?.[key];
    if (typeof value === "number" && value > 0) return value > 0xe8d4a51000 ? value : value * 1000;
    if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
      const parsed = Number(value);
      return parsed > 0xe8d4a51000 ? parsed : parsed * 1000;
    }
  }
  for (const key of ttlKeys) {
    const value = source?.[key];
    if (typeof value === "number" && value > 0) return Date.now() + value * 1000;
  }
  return undefined;
}

/* ------------------------------------------------------------------ *
 * HTTP 服务
 * ------------------------------------------------------------------ */

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

function sendOpenAIError(res, status, message, type = "upstream_error", code) {
  sendJson(res, status, { error: { message, type, ...(code === undefined ? {} : { code }) } });
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function authorized(req) {
  if (!CONFIG.apiKey) return true;
  const header = req.headers.authorization;
  if (typeof header !== "string") {
    console.log(`[auth] 缺少 Authorization 头：${req.method} ${req.url}`);
    return false;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (match === null) {
    console.log(`[auth] Authorization 头格式不符：${req.method} ${req.url}，收到 ${header.slice(0, 24)}`);
    return false;
  }
  const a = Buffer.from(match[1]);
  const b = Buffer.from(CONFIG.apiKey);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) {
    console.log(
      `[auth] key 不匹配：${req.method} ${req.url}，收到 ${match[1].slice(0, 8)}…（长度 ${match[1].length}），期望 ${CONFIG.apiKey.slice(0, 8)}…（长度 ${CONFIG.apiKey.length}）`
    );
  }
  return ok;
}

async function handleChat(req, res, region) {
  const raw = (await readBody(req)).toString("utf8");
  let wantsStream = false;
  try {
    wantsStream = JSON.parse(raw)?.stream === true;
  } catch {
    /* 交给上游报错 */
  }
  const prepared = prepareChatBody(raw);

  let cred;
  try {
    cred = await resolveCredential(region);
  } catch (error) {
    sendOpenAIError(res, 401, String(error instanceof Error ? error.message : error), "not_signed_in");
    return;
  }

  const controller = new AbortController();
  res.on("close", () => controller.abort());

  const result = await chatStream(cred, prepared, controller.signal);
  if (!result.ok) {
    sendOpenAIError(res, KIND_STATUS[result.kind] ?? 502, `workbuddy upstream ${result.kind} (http ${result.status}): ${result.message.slice(0, 400)}`, result.kind);
    return;
  }

  if (wantsStream) {
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const reader = result.response.body.getReader();
    const decoder = new TextDecoder("utf-8");
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
      }
    } catch {
      /* 客户端断开或上游中断 */
    }
    res.end();
    return;
  }

  /* 非流式：把上游 SSE 聚合成一个标准响应 */
  const text = await result.response.text();
  let content = "";
  let reasoning = "";
  let finishReason = "stop";
  let sawDone = false;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") {
      sawDone = true;
      continue;
    }
    let chunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      continue;
    }
    const choice = chunk.choices?.[0];
    if (choice === undefined) continue;
    if (typeof choice.delta?.content === "string") content += choice.delta.content;
    if (typeof choice.delta?.reasoning_content === "string") reasoning += choice.delta.reasoning_content;
    if (typeof choice.finish_reason === "string" && choice.finish_reason !== "") finishReason = choice.finish_reason;
  }
  if (content === "" && !sawDone) {
    sendOpenAIError(res, 502, `上游未返回可用内容: ${text.slice(0, 300)}`, "upstream_empty");
    return;
  }
  sendJson(res, 200, {
    id: `chatcmpl-${crypto.randomUUID().replaceAll("-", "")}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: JSON.parse(prepared)?.model ?? "workbuddy",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content, ...(reasoning === "" ? {} : { reasoning_content: reasoning }) },
        finish_reason: finishReason,
      },
    ],
    usage: {},
  });
}

const server = http.createServer(async (req, res) => {
  const rawUrl = (req.url ?? "/").split("?")[0];
  let region = CONFIG.region;
  let url = rawUrl;
  for (const candidate of REGIONS) {
    if (rawUrl === `/${candidate}` || rawUrl.startsWith(`/${candidate}/`)) {
      region = candidate;
      url = rawUrl.slice(candidate.length + 1) || "/";
      break;
    }
  }
  try {
    if (req.method === "GET" && url === "/healthz") {
      const regions = {};
      for (const candidate of REGIONS) {
        const cred = loadCreds(candidate);
        regions[candidate] =
          cred === null
            ? { signedIn: false }
            : {
                signedIn: true,
                domain: cred.domain ?? null,
                account: cred.nickname ?? cred.uid ?? null,
                expiresAt: cred.expiresAtMs ? new Date(cred.expiresAtMs).toISOString() : null,
              };
      }
      sendJson(res, 200, { ok: true, defaultRegion: CONFIG.region, regions });
      return;
    }

    /* 管理接口不需要 key：只在 loopback 上，且不泄漏凭据 */
    if (req.method === "POST" && url === "/admin/login") {
      const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const loginRegion = body.region === "global" ? "global" : "cn";
      const result = await oauthStart(loginRegion, body.base);
      sendJson(res, result.error === undefined ? 200 : 502, result);
      return;
    }
    if (req.method === "GET" && url === "/admin/login/poll") {
      const id = new URL(req.url, "http://localhost").searchParams.get("id") ?? "";
      const result = await oauthPoll(id);
      sendJson(res, 200, result);
      return;
    }
    if (req.method === "GET" && url === "/admin/catalog") {
      const cred = await resolveCredential(region);
      const models = await fetchModels(cred, new URL(req.url, "http://localhost").searchParams.get("refresh") === "1");
      const promotions = loadPromotions();
      sendJson(res, 200, {
        region,
        models: decorateModels(models),
        promotions: { source: promotions.source, updatedAt: promotions.updatedAt, note: promotions.note },
      });
      return;
    }
    if (req.method === "GET" && url === "/admin/credits") {
      const cred = await resolveCredential(region);
      const credits = await fetchCredits(cred);
      sendJson(res, 200, credits);
      return;
    }
    if (req.method === "POST" && url === "/admin/chat") {
      const payload = JSON.parse((await readBody(req)).toString("utf8") || "{}");
      const model = typeof payload.model === "string" ? payload.model : "";
      const prompt = typeof payload.prompt === "string" ? payload.prompt : "";
      if (model === "" || prompt === "") {
        sendOpenAIError(res, 400, "model 与 prompt 均为必填", "invalid_request");
        return;
      }
      let cred;
      try {
        cred = await resolveCredential(region);
      } catch (error) {
        sendOpenAIError(res, 401, String(error instanceof Error ? error.message : error), "not_signed_in");
        return;
      }
      const prepared = prepareChatBody(JSON.stringify({ model, messages: [{ role: "user", content: prompt }], stream: false }));
      const result = await chatStream(cred, prepared);
      if (!result.ok) {
        sendOpenAIError(res, KIND_STATUS[result.kind] ?? 502, `workbuddy upstream ${result.kind} (http ${result.status}): ${result.message.slice(0, 300)}`, result.kind);
        return;
      }
      const text = await result.response.text();
      let content = "";
      for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") continue;
        try {
          const chunk = JSON.parse(data);
          const choice = chunk.choices?.[0];
          if (choice !== undefined && typeof choice.delta?.content === "string") content += choice.delta.content;
        } catch {
          /* 跳过无法解析的帧 */
        }
      }
      sendJson(res, 200, { region, model, content });
      return;
    }

    if (!authorized(req)) {
      sendOpenAIError(res, 401, "missing or invalid Authorization bearer", "unauthorized");
      return;
    }

    if (req.method === "GET" && url === "/v1/models") {
      let cred;
      try {
        cred = await resolveCredential(region);
      } catch (error) {
        sendOpenAIError(res, 401, String(error instanceof Error ? error.message : error), "not_signed_in");
        return;
      }
      const models = decorateModels(await fetchModels(cred));
      sendJson(res, 200, {
        object: "list",
        data: models.map((model) => ({ id: model.id, object: "model", created: 0, owned_by: "workbuddy", ...model })),
      });
      return;
    }

    if (req.method === "POST" && url === "/v1/chat/completions") {
      await handleChat(req, res, region);
      return;
    }

    sendOpenAIError(res, 404, `no such route: ${req.method} ${url}`, "not_found");
  } catch (error) {
    if (!res.headersSent) sendOpenAIError(res, 500, String(error instanceof Error ? error.message : error), "internal");
    else res.end();
  }
});

/* ------------------------------------------------------------------ *
 * 命令行入口
 * ------------------------------------------------------------------ */

const args = process.argv.slice(2);

if (args.includes("--login")) {
  const idx = args.indexOf("--login");
  const regionArg = args[idx + 1] === "global" ? "global" : args[idx + 1] === "cn" ? "cn" : CONFIG.region;
  const started = await oauthStart(regionArg);
  if (started.error !== undefined) {
    console.error(started.error);
    process.exit(1);
  }
  console.log(`区域: ${regionArg}`);
  console.log("请在浏览器打开以下链接完成登录：");
  console.log(started.verificationUri);
  console.log("等待授权…");
  for (;;) {
    const result = await oauthPoll(started.loginId);
    if (result.done) {
      if (result.error !== undefined) {
        console.error(`登录失败: ${result.error}`);
        process.exit(1);
      }
      console.log(`登录成功: ${result.account.nickname ?? result.account.uid ?? "(未知账号)"} @ ${result.account.domain}`);
      process.exit(0);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
} else if (args.includes("--status")) {
  for (const r of REGIONS) {
    const cred = loadCreds(r);
    console.log(cred === null ? `${r}: 未登录` : `${r}: ${cred.nickname ?? cred.uid} @ ${cred.domain}  到期 ${cred.expiresAtMs ? new Date(cred.expiresAtMs).toISOString() : "未知"}`);
  }
} else if (args.includes("--models")) {
  const idx = args.indexOf("--models");
  const r = REGIONS.includes(args[idx + 1]) ? args[idx + 1] : CONFIG.region;
  const cred = await resolveCredential(r);
  const models = await fetchModels(cred, true);
  for (const model of models) console.log(`${model.id}\t${model.name}\t上下文 ${model.contextWindow}\t输出 ${model.maxTokens}`);
} else {
  server.listen(CONFIG.port, CONFIG.host, () => {
    console.log(`[bridge] 监听 http://${CONFIG.host}:${CONFIG.port}`);
    console.log(`[bridge] API Key: ${CONFIG.apiKey}`);
    console.log(`[bridge] 国内版 Base URL: http://${CONFIG.host}:${CONFIG.port}/cn/v1`);
    console.log(`[bridge] 国际版 Base URL: http://${CONFIG.host}:${CONFIG.port}/global/v1`);
  });
}
