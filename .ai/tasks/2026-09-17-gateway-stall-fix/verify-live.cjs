var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// probe:electron
var require_electron = __commonJS({
  "probe:electron"(exports2, module2) {
    module2.exports = { app: {
      getPath: () => "F:\\Son\\tool\\TediaPros\\.ai\\tasks\\2026-09-17-gateway-stall-fix",
      getVersion: () => "0.1.26",
      getName: () => "restoration-probe",
      isPackaged: false
    }, safeStorage: { isEncryptionAvailable: () => false } };
  }
});

// .ai/tasks/2026-09-17-gateway-stall-fix/verify-live.ts
var import_promises6 = require("node:fs/promises");
var import_node_crypto7 = require("node:crypto");
var import_node_path6 = require("node:path");

// src/main/geminiGatewayRestoration.ts
var import_node_crypto5 = require("node:crypto");
var import_promises4 = require("node:fs/promises");
var import_node_path4 = require("node:path");

// src/main/geminiGatewayOperations.ts
var import_node_crypto = require("node:crypto");

// src/shared/gatewayOperation.ts
function operationAction(status) {
  if (status === "succeeded") return "consume";
  if (status === "queued" || status === "waiting-provider" || status === "running" || status === "cancelling") return "poll";
  return "stop";
}

// src/main/aiResponseBody.ts
var DEFAULT_MAX_RESPONSE_BYTES = 256 * 1024;
async function awaitWithAbort(operation, signal) {
  if (!signal) return operation;
  signal.throwIfAborted();
  let onAbort;
  const aborted = new Promise((_resolve, reject) => {
    onAbort = () => reject(signal.reason ?? new DOMException("The operation was aborted.", "AbortError"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([operation, aborted]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
}
async function readBoundedAiResponseText(response, signal, maxBytes = DEFAULT_MAX_RESPONSE_BYTES) {
  if (!Number.isInteger(maxBytes) || maxBytes < 1) throw new Error("Invalid AI response byte limit.");
  signal?.throwIfAborted();
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {
    });
    throw new Error("AI response exceeds the byte limit.");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let total = 0;
  let text = "";
  try {
    while (true) {
      signal?.throwIfAborted();
      const next = await awaitWithAbort(reader.read(), signal);
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maxBytes) throw new Error("AI response exceeds the byte limit.");
      text += decoder.decode(next.value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } catch (error) {
    await reader.cancel(error).catch(() => {
    });
    throw error;
  } finally {
    reader.releaseLock();
  }
}
async function readBoundedAiResponseJson(response, signal, maxBytes = DEFAULT_MAX_RESPONSE_BYTES) {
  return JSON.parse(await readBoundedAiResponseText(response, signal, maxBytes));
}

// src/main/geminiGatewayOperations.ts
function createGatewayError(status, detail) {
  let errorCode;
  let errorMsg;
  try {
    const parsed = JSON.parse(detail);
    errorCode = parsed?.error?.code || parsed?.gateway_metadata?.error_code || (typeof parsed?.error === "string" ? parsed.error : void 0);
    errorMsg = parsed?.error?.message || (typeof parsed?.error === "string" ? parsed.error : void 0);
  } catch {
  }
  const message = errorMsg || detail || `Gemini Gateway b\xE1o l\u1ED7i HTTP ${status}.`;
  const isThrottled = status === 429 || status === 405 || /rate limit|quota|too many requests|chống bot/iu.test(message);
  const providerCode = isThrottled ? "provider-throttled" : status >= 500 ? "provider-transient" : "provider-protocol";
  return Object.assign(new Error(message), {
    status,
    providerCode,
    errorCode
  });
}
var GatewayOperationDeferredError = class extends Error {
  constructor(receipt) {
    super(receipt.reason || (receipt.status === "outcome-unknown" ? "outcome-unknown" : "Gateway operation \u0111ang ch\u1EDD provider."));
    this.receipt = receipt;
    this.name = "GatewayOperationDeferredError";
    this.providerCode = receipt.status === "outcome-unknown" ? "outcome-unknown" : "provider-throttled";
    this.operationId = receipt.id;
    this.nextEligibleAtUtc = receipt.nextEligibleAtUtc ?? null;
    this.reason = receipt.reason || receipt.status;
  }
  providerCode;
  operationId;
  nextEligibleAtUtc;
  reason;
  /** Set by the adapter after it binds the deferred receipt to a durable stage. */
  stage;
  /** Queue cancellation callback for the exact durable gateway operation. */
  cancelOperation;
};
var OPERATION_STATUSES = /* @__PURE__ */ new Set([
  "queued",
  "waiting-provider",
  "running",
  "succeeded",
  "failed",
  "blocked",
  "cancelling",
  "cancelled",
  "outcome-unknown"
]);
var DISPATCH_STATES = /* @__PURE__ */ new Set([
  "not-dispatched",
  "dispatched",
  "unknown"
]);
function httpDeadline(parent, timeoutMs) {
  const controller = new AbortController();
  const onParentAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) onParentAbort();
  else parent?.addEventListener("abort", onParentAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new DOMException("Gateway HTTP request timed out.", "TimeoutError")), Math.max(1, Math.ceil(timeoutMs)));
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onParentAbort);
    }
  };
}
function generateOperationToken() {
  return (0, import_node_crypto.randomBytes)(32).toString("hex");
}
function generateClientRequestId() {
  return (0, import_node_crypto.randomUUID)();
}
async function submitGatewayOperation(options) {
  const { baseUrl, requestPayload, signal } = options;
  const clientRequestId = options.clientRequestId || generateClientRequestId();
  const operationToken = options.operationToken || generateOperationToken();
  const envelope = {
    client_request_id: clientRequestId,
    request: requestPayload
  };
  const deadline = httpDeadline(signal, options.httpTimeoutMs ?? 3e4);
  try {
    const response = await fetch(`${baseUrl}/gateway/requests`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Operation-Token": operationToken
      },
      body: JSON.stringify(envelope),
      signal: deadline.signal
    });
    if (!response.ok && response.status !== 202) {
      const detail = await readBoundedAiResponseText(response, deadline.signal, 64 * 1024).catch(() => "");
      throw createGatewayError(response.status, detail);
    }
    const data = await readBoundedAiResponseJson(response, deadline.signal, 64 * 1024);
    return parseOperationReceipt(data, { expectedClientRequestId: clientRequestId });
  } finally {
    deadline.dispose();
  }
}
async function getGatewayOperation(options) {
  const deadline = httpDeadline(options.signal, options.httpTimeoutMs ?? 3e4);
  try {
    const response = await fetch(`${options.baseUrl}/gateway/requests/${encodeURIComponent(options.operationId)}`, {
      method: "GET",
      headers: { "X-Operation-Token": options.operationToken },
      signal: deadline.signal
    });
    if (!response.ok) {
      const detail = await readBoundedAiResponseText(response, deadline.signal, 64 * 1024).catch(() => "");
      throw createGatewayError(response.status, detail);
    }
    const data = await readBoundedAiResponseJson(response, deadline.signal, 4 * 1024 * 1024);
    return {
      data,
      receipt: parseOperationReceipt(data, {
        expectedClientRequestId: options.expectedClientRequestId,
        expectedOperationId: options.operationId
      })
    };
  } finally {
    deadline.dispose();
  }
}
async function pollGatewayOperation(options) {
  const { baseUrl, operationId, operationToken, signal, pollIntervalMs = 5e3, onProgress } = options;
  const runtime = options.runtime || { nowMs: () => Date.now(), delay: delayWithSignal };
  while (!signal.aborted) {
    const { data, receipt } = await getGatewayOperation({
      baseUrl,
      operationId,
      operationToken,
      signal,
      expectedClientRequestId: options.expectedClientRequestId,
      httpTimeoutMs: options.httpTimeoutMs
    });
    if (onProgress) {
      onProgress(receipt);
    }
    if ((receipt.status === "waiting-provider" || receipt.status === "outcome-unknown") && options.deferOnWaitingProvider) {
      throw new GatewayOperationDeferredError(receipt);
    }
    const action = operationAction(receipt.status);
    if (action === "consume") {
      return data.response;
    }
    if (action === "stop") {
      const msg = receipt.error || `Gateway operation ended with status: ${receipt.status}`;
      const err = new Error(msg);
      Object.assign(err, { providerCode: receipt.errorCode || receipt.status, receipt });
      throw err;
    }
    let waitTime = pollIntervalMs;
    if (receipt.nextEligibleAtUtc) {
      const nextMs = Date.parse(receipt.nextEligibleAtUtc);
      if (Number.isFinite(nextMs)) {
        const delta = nextMs - runtime.nowMs();
        if (delta > waitTime) {
          waitTime = delta;
        }
      }
    }
    const step = Math.max(waitTime, 500);
    await runtime.delay(step, signal);
  }
  throw new Error("\u0110\xE3 h\u1EE7y t\xE1c v\u1EE5.");
}
async function cancelGatewayOperation(baseUrl, operationId, operationToken, options = {}) {
  const deadline = httpDeadline(void 0, options.timeoutMs ?? 1e4);
  try {
    const response = await fetch(`${baseUrl}/gateway/requests/${encodeURIComponent(operationId)}/cancel`, {
      method: "POST",
      headers: { "X-Operation-Token": operationToken },
      signal: deadline.signal
    });
    if (!response.ok) {
      const detail = await readBoundedAiResponseText(response, deadline.signal, 64 * 1024).catch(() => "");
      throw createGatewayError(response.status, detail);
    }
    if (response.status === 204) return void 0;
    const text = await readBoundedAiResponseText(response, deadline.signal, 64 * 1024);
    if (!text.trim()) return void 0;
    const data = JSON.parse(text);
    if (data.id === void 0) return void 0;
    return parseOperationReceipt(data, {
      expectedClientRequestId: options.expectedClientRequestId,
      expectedOperationId: operationId
    });
  } finally {
    deadline.dispose();
  }
}
async function ackGatewayOperation(baseUrl, operationId, operationToken, timeoutMs = 1e4) {
  const deadline = httpDeadline(void 0, timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/gateway/requests/${encodeURIComponent(operationId)}/ack`, {
      method: "POST",
      headers: { "X-Operation-Token": operationToken },
      signal: deadline.signal
    });
    if (!response.ok) {
      const detail = await readBoundedAiResponseText(response, deadline.signal, 64 * 1024).catch(() => "");
      throw createGatewayError(response.status, detail);
    }
  } finally {
    deadline.dispose();
  }
}
async function getGatewaySchedulerStatus(baseUrl, signal) {
  const response = await fetch(`${baseUrl}/gateway/scheduler`, { signal });
  if (!response.ok) {
    const detail = await readBoundedAiResponseText(response, signal, 64 * 1024).catch(() => "");
    throw createGatewayError(response.status, detail);
  }
  const data = await readBoundedAiResponseJson(response, signal, 64 * 1024);
  return {
    state: data.state || "ready",
    egressGroup: String(data.egress_group || "default"),
    activePermits: Number(data.active_permits || 0),
    queuedRequests: Number(data.queued_requests || 0),
    nextEligibleAtUtc: typeof data.next_eligible_at_utc === "string" ? data.next_eligible_at_utc : null,
    retryAfterSeconds: typeof data.retry_after_seconds === "number" ? data.retry_after_seconds : void 0,
    reason: typeof data.reason === "string" ? data.reason : void 0,
    revision: Number(data.revision || 0)
  };
}
function parseOperationReceipt(data, expected = {}) {
  const id = typeof data.id === "string" ? data.id.trim() : "";
  const clientRequestId = typeof data.client_request_id === "string" ? data.client_request_id.trim() : "";
  const status = data.status;
  const dispatchState = data.dispatch_state;
  const upstreamAttempts = data.upstream_attempts;
  const createdAtUtc = data.created_at_utc;
  const updatedAtUtc = data.updated_at_utc;
  const nextEligibleAtUtc = data.next_eligible_at_utc;
  const validDate = (value) => typeof value === "string" && value.trim().length > 0 && Number.isFinite(Date.parse(value));
  if (!id || !clientRequestId || !OPERATION_STATUSES.has(status) || !DISPATCH_STATES.has(dispatchState) || typeof upstreamAttempts !== "number" || !Number.isFinite(upstreamAttempts) || upstreamAttempts < 0 || !Number.isInteger(upstreamAttempts) || !validDate(createdAtUtc) || updatedAtUtc !== void 0 && !validDate(updatedAtUtc) || nextEligibleAtUtc !== void 0 && nextEligibleAtUtc !== null && !validDate(nextEligibleAtUtc)) {
    throw Object.assign(new Error("Gateway operation receipt kh\xF4ng h\u1EE3p l\u1EC7."), { providerCode: "provider-protocol" });
  }
  if (expected.expectedClientRequestId && clientRequestId !== expected.expectedClientRequestId) {
    throw Object.assign(new Error("Gateway operation receipt c\xF3 client_request_id kh\xF4ng kh\u1EDBp lease."), { providerCode: "provider-protocol" });
  }
  if (expected.expectedOperationId && id !== expected.expectedOperationId) {
    throw Object.assign(new Error("Gateway operation receipt c\xF3 operation ID kh\xF4ng kh\u1EDBp lease."), { providerCode: "provider-protocol" });
  }
  return {
    id,
    clientRequestId,
    status,
    dispatchState,
    upstreamAttempts,
    createdAtUtc,
    updatedAtUtc,
    nextEligibleAtUtc: nextEligibleAtUtc === null || nextEligibleAtUtc === void 0 ? null : nextEligibleAtUtc,
    reason: typeof data.reason === "string" ? data.reason : void 0,
    error: typeof data.error === "string" ? data.error : void 0,
    errorCode: typeof data.error_code === "string" ? data.error_code : void 0
  };
}
function delayWithSignal(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("\u0110\xE3 h\u1EE7y t\xE1c v\u1EE5."));
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("\u0110\xE3 h\u1EE7y t\xE1c v\u1EE5."));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
async function resetGatewayScheduler(baseUrl, signal) {
  try {
    const response = await fetch(`${baseUrl}/gateway/reset`, { method: "POST", signal });
    return response.ok;
  } catch {
    return false;
  }
}

// src/main/geminiGateway.ts
var import_node_crypto3 = require("node:crypto");
var import_promises3 = require("node:fs/promises");
var import_node_path3 = require("node:path");

// src/shared/types.ts
var GEMINI_GATEWAY_MODEL = "gemini-advanced";

// src/shared/aiOutput.ts
var AI_OUTPUT_PARSER_VERSION = "ai-output-parser-v1";
var DEFAULT_LIMITS = {
  maxBytes: 256 * 1024,
  maxDepth: 16,
  maxMembers: 1e3,
  maxCandidates: 1
};
var AiOutputParseError = class extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "AiOutputParseError";
    this.code = code;
  }
};
function utf8Bytes(value) {
  return new TextEncoder().encode(value).length;
}
function containsLoneSurrogate(value) {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 55296 && code <= 56319) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 56320 && next <= 57343)) return true;
      index++;
    } else if (code >= 56320 && code <= 57343) return true;
  }
  return false;
}
var StrictJsonParser = class {
  constructor(text, limits) {
    this.text = text;
    this.limits = limits;
  }
  index = 0;
  members = 0;
  parseDocument() {
    this.skipWhitespace();
    const value = this.parseValue(0);
    this.skipWhitespace();
    if (this.index !== this.text.length) this.fail("ambiguous-json", "Ph\u1EA3n h\u1ED3i ch\u1EE9a d\u1EEF li\u1EC7u ngo\xE0i JSON root.");
    return value;
  }
  parsePrefix() {
    this.skipWhitespace();
    const value = this.parseValue(0);
    return { value, end: this.index };
  }
  parseValue(depth) {
    if (depth > this.limits.maxDepth) this.fail("depth-limit", "JSON v\u01B0\u1EE3t gi\u1EDBi h\u1EA1n \u0111\u1ED9 s\xE2u.");
    const char = this.text[this.index];
    if (char === "{") return this.parseObject(depth + 1);
    if (char === "[") return this.parseArray(depth + 1);
    if (char === '"') return this.parseString();
    if (char === "t" && this.takeLiteral("true")) return true;
    if (char === "f" && this.takeLiteral("false")) return false;
    if (char === "n" && this.takeLiteral("null")) return null;
    if (char === "-" || char >= "0" && char <= "9") return this.parseNumber();
    this.fail("invalid-json", "Ph\u1EA3n h\u1ED3i kh\xF4ng ph\u1EA3i JSON h\u1EE3p l\u1EC7.");
  }
  parseObject(depth) {
    this.index++;
    const result = /* @__PURE__ */ Object.create(null);
    const keys = /* @__PURE__ */ new Set();
    this.skipWhitespace();
    if (this.text[this.index] === "}") {
      this.index++;
      return result;
    }
    while (true) {
      this.skipWhitespace();
      if (this.text[this.index] !== '"') this.fail("invalid-json", "T\xEAn tr\u01B0\u1EDDng JSON ph\u1EA3i l\xE0 chu\u1ED7i.");
      const key = this.parseString();
      if (keys.has(key)) this.fail("duplicate-key", `JSON ch\u1EE9a tr\u01B0\u1EDDng tr\xF9ng: ${key}.`);
      keys.add(key);
      this.countMember();
      this.skipWhitespace();
      if (this.text[this.index] !== ":") this.fail("invalid-json", "JSON thi\u1EBFu d\u1EA5u hai ch\u1EA5m sau t\xEAn tr\u01B0\u1EDDng.");
      this.index++;
      this.skipWhitespace();
      result[key] = this.parseValue(depth);
      this.skipWhitespace();
      const next = this.text[this.index++];
      if (next === "}") return result;
      if (next !== ",") this.fail("invalid-json", "JSON object ch\u01B0a \u0111\xF3ng \u0111\xFAng \u0111\u1ECBnh d\u1EA1ng.");
    }
  }
  parseArray(depth) {
    this.index++;
    const result = [];
    this.skipWhitespace();
    if (this.text[this.index] === "]") {
      this.index++;
      return result;
    }
    while (true) {
      this.countMember();
      result.push(this.parseValue(depth));
      this.skipWhitespace();
      const next = this.text[this.index++];
      if (next === "]") return result;
      if (next !== ",") this.fail("invalid-json", "JSON array ch\u01B0a \u0111\xF3ng \u0111\xFAng \u0111\u1ECBnh d\u1EA1ng.");
      this.skipWhitespace();
    }
  }
  parseString() {
    const start = this.index;
    this.index++;
    let escaped = false;
    while (this.index < this.text.length) {
      const char = this.text[this.index++];
      if (escaped) {
        if (char === "u") {
          const hex = this.text.slice(this.index, this.index + 4);
          if (!/^[0-9a-f]{4}$/iu.test(hex)) this.fail("invalid-json", "JSON ch\u1EE9a Unicode escape kh\xF4ng h\u1EE3p l\u1EC7.");
          this.index += 4;
        } else if (!/^["\\/bfnrt]$/u.test(char)) this.fail("invalid-json", "JSON ch\u1EE9a escape kh\xF4ng h\u1EE3p l\u1EC7.");
        escaped = false;
      } else if (char === "\\") escaped = true;
      else if (char === '"') {
        let value;
        try {
          value = JSON.parse(this.text.slice(start, this.index));
        } catch {
          this.fail("invalid-json", "JSON ch\u1EE9a chu\u1ED7i kh\xF4ng h\u1EE3p l\u1EC7.");
        }
        if (containsLoneSurrogate(value)) this.fail("invalid-unicode", "JSON ch\u1EE9a Unicode surrogate kh\xF4ng ho\xE0n ch\u1EC9nh.");
        return value;
      } else if (char.charCodeAt(0) <= 31) this.fail("invalid-json", "JSON ch\u1EE9a k\xFD t\u1EF1 \u0111i\u1EC1u khi\u1EC3n ch\u01B0a escape.");
    }
    this.fail("invalid-json", "JSON ch\u1EE9a chu\u1ED7i ch\u01B0a \u0111\xF3ng.");
  }
  parseNumber() {
    const source = this.text.slice(this.index);
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(source);
    if (!match) this.fail("invalid-json", "JSON ch\u1EE9a s\u1ED1 kh\xF4ng h\u1EE3p l\u1EC7.");
    this.index += match[0].length;
    const value = Number(match[0]);
    if (!Number.isFinite(value)) this.fail("invalid-number", "JSON ch\u1EE9a s\u1ED1 v\u01B0\u1EE3t gi\u1EDBi h\u1EA1n h\u1EEFu h\u1EA1n.");
    return value;
  }
  takeLiteral(literal) {
    if (!this.text.startsWith(literal, this.index)) return false;
    this.index += literal.length;
    return true;
  }
  skipWhitespace() {
    while (this.text[this.index] === " " || this.text[this.index] === "	" || this.text[this.index] === "\r" || this.text[this.index] === "\n") this.index++;
  }
  countMember() {
    this.members++;
    if (this.members > this.limits.maxMembers) this.fail("member-limit", "JSON c\xF3 qu\xE1 nhi\u1EC1u ph\u1EA7n t\u1EED.");
  }
  fail(code, message) {
    throw new AiOutputParseError(code, message);
  }
};
function exactObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AiOutputParseError("wrong-root", "AI ph\u1EA3i tr\u1EA3 v\u1EC1 \u0111\xFAng m\u1ED9t JSON object.");
  }
  return value;
}
function limitsWith(overrides) {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) throw new AiOutputParseError("invalid-limit", `Gi\u1EDBi h\u1EA1n ${key} kh\xF4ng h\u1EE3p l\u1EC7.`);
  }
  return limits;
}
function trimJsonWhitespace(raw) {
  return raw.replace(/^[ \t\r\n]+|[ \t\r\n]+$/gu, "");
}
function completeFence(raw) {
  if (!raw.startsWith("```")) return null;
  const openingEnd = raw.indexOf("\n");
  if (openingEnd < 0) return null;
  const opening = raw.slice(0, openingEnd).replace(/\r$/u, "");
  if (!/^```(?:json)?[\t ]*$/iu.test(opening)) return null;
  const contentStart = openingEnd + 1;
  const closings = [];
  const matcher = /(?:^|\n)```[\t \r]*(?=\n|$)/gu;
  matcher.lastIndex = contentStart;
  for (let match = matcher.exec(raw); match; match = matcher.exec(raw)) {
    const start = match.index + (match[0].startsWith("\n") ? 1 : 0);
    if (start >= contentStart) closings.push(start);
  }
  if (closings.length !== 1) return null;
  const closing = closings[0];
  if (trimJsonWhitespace(raw.slice(closing + 3)) !== "") return null;
  return raw.slice(contentStart, closing);
}
function topLevelObjectStarts(raw) {
  const starts = [];
  let inString = false;
  let escaped = false;
  let depth = 0;
  for (let index = 0; index < raw.length; index++) {
    const char = raw[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") {
      if (depth === 0) starts.push(index);
      depth++;
    } else if (char === "}" && depth > 0) depth--;
  }
  return starts;
}
function parseAiJsonObject(raw, options = {}) {
  const limits = limitsWith(options.limits);
  const hadBom = raw.startsWith("\uFEFF");
  const text = trimJsonWhitespace(hadBom ? raw.slice(1) : raw);
  const bytes = utf8Bytes(text);
  if (bytes > limits.maxBytes) throw new AiOutputParseError("byte-limit", "Ph\u1EA3n h\u1ED3i AI v\u01B0\u1EE3t gi\u1EDBi h\u1EA1n k\xEDch th\u01B0\u1EDBc.");
  const directNormalization = hadBom ? ["strip-bom"] : [];
  let strictError;
  try {
    return {
      value: exactObject(new StrictJsonParser(text, limits).parseDocument()),
      outcome: "clean",
      bytes,
      normalizedText: text,
      normalization: directNormalization
    };
  } catch (error) {
    if (!(error instanceof AiOutputParseError)) throw error;
    strictError = error;
  }
  if (options.allowFence) {
    const fenced = completeFence(text);
    if (fenced !== null) {
      const normalizedText = trimJsonWhitespace(fenced);
      return {
        value: exactObject(new StrictJsonParser(normalizedText, limits).parseDocument()),
        outcome: "unwrapped",
        bytes,
        normalizedText,
        normalization: [...directNormalization, "unwrap-json-fence"]
      };
    }
    if (text.includes("```")) throw new AiOutputParseError("ambiguous-json", "Ph\u1EA3n h\u1ED3i c\xF3 code fence kh\xF4ng ho\xE0n ch\u1EC9nh ho\u1EB7c m\u01A1 h\u1ED3.");
  }
  if (!options.allowProseObject) throw strictError;
  const candidates = [];
  let malformed = false;
  for (const start of topLevelObjectStarts(text)) {
    try {
      const parsed = new StrictJsonParser(text.slice(start), limits).parsePrefix();
      candidates.push(exactObject(parsed.value));
      if (candidates.length > limits.maxCandidates) break;
    } catch {
      malformed = true;
    }
  }
  if (malformed || candidates.length !== 1) {
    throw new AiOutputParseError("ambiguous-json", "AI tr\u1EA3 v\u1EC1 JSON m\u01A1 h\u1ED3 ho\u1EB7c kh\xF4ng ho\xE0n ch\u1EC9nh.");
  }
  return { value: candidates[0], outcome: "extracted", bytes, normalizedText: text, normalization: directNormalization };
}

// src/main/logger.ts
var import_electron = __toESM(require_electron());
var import_promises = require("node:fs/promises");
var import_node_path = require("node:path");
var import_node_crypto2 = require("node:crypto");
var import_node_events = require("node:events");

// src/main/logRetention.ts
var DEFAULT_LOG_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1e3;
var DEFAULT_LOG_MAX_BYTES = 100 * 1024 * 1024;

// src/main/logger.ts
var MAX = 1e3;
var buffer = [];
var logEmitter = new import_node_events.EventEmitter();
var logGeneration = 0;
var logSessionId = (0, import_node_crypto2.randomUUID)();
function logDir() {
  return (0, import_node_path.join)(import_electron.app.getPath("userData"), "logs");
}
function logFilePath() {
  return (0, import_node_path.join)(logDir(), `tblao-session-${logSessionId}.log`);
}
var dirReady = false;
async function ensureDir() {
  if (dirReady) return;
  try {
    await (0, import_promises.mkdir)(logDir(), { recursive: true });
  } catch {
  }
  dirReady = true;
}
function log(level, msg) {
  const entry = { time: (/* @__PURE__ */ new Date()).toISOString(), level, msg };
  buffer.push(entry);
  if (buffer.length > MAX) buffer.shift();
  logEmitter.emit("entry", entry);
  const generation = logGeneration;
  void ensureDir().then(() => {
    if (generation !== logGeneration) return;
    return (0, import_promises.appendFile)(logFilePath(), `[${entry.time}] ${level.toUpperCase()} ${msg}
`).catch(() => {
    });
  });
  try {
    const out = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
    out(`[tblao] ${msg}`);
  } catch {
  }
}
var logWarn = (m) => log("warn", m);

// src/main/safeContainedPath.ts
var import_node_path2 = require("node:path");
var import_promises2 = require("node:fs/promises");
async function assertContainedRegularFile(candidate, root, label) {
  if (!(0, import_node_path2.isAbsolute)(candidate) || !(0, import_node_path2.isAbsolute)(root)) {
    throw new Error(`${label}: \u0111\u01B0\u1EDDng d\u1EABn ph\u1EA3i l\xE0 tuy\u1EC7t \u0111\u1ED1i (candidate=${candidate}, root=${root}).`);
  }
  let rootReal;
  try {
    rootReal = await (0, import_promises2.realpath)(root);
  } catch (err) {
    throw new Error(`${label}: th\u01B0 m\u1EE5c g\u1ED1c kh\xF4ng t\u1ED3n t\u1EA1i ho\u1EB7c kh\xF4ng h\u1EE3p l\u1EC7: ${err.message}`);
  }
  let candLstat;
  try {
    candLstat = await (0, import_promises2.lstat)(candidate);
  } catch (err) {
    throw new Error(`${label}: file kh\xF4ng t\u1ED3n t\u1EA1i: ${err.message}`);
  }
  if (candLstat.isSymbolicLink()) {
    throw new Error(`${label}: kh\xF4ng ch\u1EA5p nh\u1EADn symbolic link ho\u1EB7c reparse point.`);
  }
  let candStat;
  try {
    candStat = await (0, import_promises2.stat)(candidate);
  } catch (err) {
    throw new Error(`${label}: kh\xF4ng th\u1EC3 ki\u1EC3m tra stat file: ${err.message}`);
  }
  if (!candStat.isFile()) {
    throw new Error(`${label}: \u0111\u01B0\u1EDDng d\u1EABn kh\xF4ng ph\u1EA3i l\xE0 file th\xF4ng th\u01B0\u1EDDng (regular file).`);
  }
  let candReal;
  try {
    candReal = await (0, import_promises2.realpath)(candidate);
  } catch (err) {
    throw new Error(`${label}: kh\xF4ng th\u1EC3 resolve realpath: ${err.message}`);
  }
  const rel = (0, import_node_path2.relative)(rootReal, candReal);
  if (!rel || rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || (0, import_node_path2.isAbsolute)(rel)) {
    throw new Error(`${label}: file n\u1EB1m ngo\xE0i th\u01B0 m\u1EE5c g\u1ED1c cho ph\xE9p (${rootReal}).`);
  }
  return (0, import_node_path2.normalize)(candReal);
}

// src/main/geminiGatewayDraftCheckpoint.ts
var MAX_GATEWAY_DRAFT_RAW_BYTES = 1024 * 1024;
var MAX_GATEWAY_DRAFT_BYTES = 2 * 1024 * 1024;
var GATEWAY_DRAFT_PARSER_VERSION = `${AI_OUTPUT_PARSER_VERSION}:gateway-draft-v2`;

// src/main/geminiGateway.ts
var MAX_AUDIT_BYTES = 16 * 1024 * 1024;
var MAX_GATEWAY_REQUEST_BYTES = 32 * 1024 * 1024;
var GATEWAY_STAGE_TIMEOUT_MS = 36e4;
var TRANSLATION_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "srt_translation",
    strict: true,
    schema: {
      type: "object",
      properties: {
        translations: {
          type: "object",
          additionalProperties: { type: "string" }
        }
      },
      required: ["translations"],
      additionalProperties: false
    }
  }
};
function isGatewayRouteFingerprint(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/iu.test(value);
}
async function readGatewayCapabilitiesInfo(baseUrl, signal) {
  const response = await fetch(`${baseUrl}/gateway/capabilities`, { signal });
  if (!response.ok) {
    const detail = await readBoundedAiResponseText(response, signal, 64 * 1024).catch(() => "");
    throw providerError(response.status, detail);
  }
  const data = await readBoundedAiResponseJson(response, signal, 256 * 1024);
  if (data.provider_ready === false) {
    const message = data.provider_error === "authentication_required" ? "Cookie Gemini c\u1EE7a gateway \u0111\xE3 h\u1EBFt h\u1EA1n ho\u1EB7c kh\xF4ng h\u1EE3p l\u1EC7. H\xE3y c\u1EADp nh\u1EADt cookie r\u1ED3i kh\u1EDFi \u0111\u1ED9ng l\u1EA1i gateway." : "Gemini Gateway ch\u01B0a s\u1EB5n s\xE0ng \u0111\u1EC3 x\xE1c minh route model.";
    throw Object.assign(new Error(message), {
      providerCode: data.provider_error === "authentication_required" ? "provider-auth" : "provider-protocol"
    });
  }
  if (data.gateway_contract_version !== 2) {
    throw Object.assign(new Error("Gemini Gateway kh\xF4ng tr\u1EA3 v\u1EC1 h\u1EE3p \u0111\u1ED3ng phi\xEAn b\u1EA3n 2 khi ki\u1EC3m tra route model."), { providerCode: "provider-protocol" });
  }
  const models = Array.isArray(data.models) ? data.models.filter((item) => typeof item === "string") : [];
  if (!models.includes(GEMINI_GATEWAY_MODEL)) {
    throw Object.assign(new Error(`Gateway ch\u01B0a cung c\u1EA5p ${GEMINI_GATEWAY_MODEL} (Gemini 3.1 Pro).`), { providerCode: "provider-protocol" });
  }
  const routes = data.gateway_model_routes;
  const route = routes && typeof routes === "object" && !Array.isArray(routes) ? routes[GEMINI_GATEWAY_MODEL] : void 0;
  if (!route || !isGatewayRouteFingerprint(route.route_fingerprint)) {
    throw Object.assign(new Error("Gemini Gateway kh\xF4ng cung c\u1EA5p route_fingerprint h\u1EE3p l\u1EC7 \u0111\u1EC3 kh\xF4i ph\u1EE5c draft an to\xE0n."), { providerCode: "provider-protocol" });
  }
  const schedulerSupported = data.scheduler_contract_version === 1 && data.request_jobs === true;
  const maxRequestBodyBytes = typeof data.max_request_body_bytes === "number" && Number.isSafeInteger(data.max_request_body_bytes) && data.max_request_body_bytes > 0 ? data.max_request_body_bytes : void 0;
  return {
    routeFingerprint: route.route_fingerprint,
    schedulerSupported,
    ...maxRequestBodyBytes ? { maxRequestBodyBytes } : {}
  };
}
function isProviderThrottledError(message) {
  if (!message) return false;
  return /provider-throttled|405|429|too many requests|rate limit|quota|resource-exhausted|robot|method not allowed|anti-bot|chống bot|hạn chế tần suất|giới hạn tần suất/iu.test(message);
}
function providerError(status, detail) {
  let errorCode;
  let errorMsg;
  let upstreamAttempts;
  try {
    const parsed = JSON.parse(detail);
    errorCode = parsed?.error?.code || parsed?.gateway_metadata?.error_code;
    errorMsg = parsed?.error?.message;
    if (typeof parsed?.gateway_metadata?.upstream_attempts === "number") {
      upstreamAttempts = parsed.gateway_metadata.upstream_attempts;
    }
  } catch {
  }
  const isThrottled = status === 429 || status === 405 || isProviderThrottledError(`${errorMsg || ""} ${detail || ""}`);
  let message = detail || `Gemini Gateway b\xE1o l\u1ED7i HTTP ${status}.`;
  let providerCode = "provider-protocol";
  if (isThrottled) {
    const attemptText = upstreamAttempts ? `${upstreamAttempts} l\u01B0\u1EE3t th\u1EED` : "1 l\u01B0\u1EE3t th\u1EED";
    message = `Google Gemini Web t\u1EA1m t\u1EEB ch\u1ED1i ho\u1EB7c gi\u1EDBi h\u1EA1n t\u1EA7n su\u1EA5t (HTTP ${status === 200 || status >= 500 ? "405/429" : status} - ch\u1ED1ng bot/rate limit); \u0111\xE3 g\u1ECDi ${attemptText}. H\xE3y t\u1EA1m d\u1EEBng \u0111\u1EC3 tr\xE1nh b\u1ECB ch\u1EB7n IP.`;
    providerCode = "provider-throttled";
  } else if (errorCode === "model-unavailable") {
    message = "T\xE0i kho\u1EA3n Google c\u1EE7a gateway ch\u01B0a h\u1ED7 tr\u1EE3 Gemini 3.1 Pro (c\u1EA7n g\xF3i Google One AI Premium ho\u1EB7c Gemini Advanced).";
    providerCode = "provider-protocol";
  } else if (errorCode === "model-mismatch") {
    message = `Gemini Gateway tr\u1EA3 v\u1EC1 model kh\xF4ng kh\u1EDBp: ${errorMsg || detail}`;
    providerCode = "provider-protocol";
  } else if (errorCode === "invalid-structured-json" || errorCode === "invalid-json" || errorCode === "ambiguous-json" || errorCode === "duplicate-key") {
    message = `Gemini Gateway kh\xF4ng th\u1EC3 chu\u1EA9n h\xF3a JSON c\xF3 c\u1EA5u tr\xFAc: ${errorMsg || detail}`;
    providerCode = "provider-protocol";
  } else if (errorCode === "model-unverified") {
    message = `Gemini Gateway kh\xF4ng x\xE1c th\u1EF1c \u0111\u01B0\u1EE3c model Gemini 3.1 Pro: ${errorMsg || detail}`;
    providerCode = "provider-protocol";
  } else if (errorCode === "upstream-incomplete" || errorCode === "response-limit") {
    message = `Gemini Gateway ph\u1EA3n h\u1ED3i ch\u01B0a ho\xE0n t\u1EA5t t\u1EEB upstream: ${errorMsg || detail}`;
    providerCode = "provider-protocol";
  } else if (errorCode && [
    "upstream-http-5xx",
    "gemini-transient-message",
    "upstream-generation-error",
    "upstream-parse-error",
    "upstream-timeout",
    "invalid-payload",
    "invalid-json",
    "ambiguous-json",
    "duplicate-key",
    "wrong-root"
  ].includes(errorCode)) {
    const attemptText = upstreamAttempts ? `${upstreamAttempts} l\u01B0\u1EE3t th\u1EED` : "1 l\u01B0\u1EE3t th\u1EED";
    message = `Gemini Gateway b\xE1o l\u1ED7i upstream (${errorCode}, ${attemptText}): ${errorMsg || detail || "kh\xF4ng c\xF3 chi ti\u1EBFt"}. H\xE3y th\u1EED l\u1EA1i th\u1EE7 c\xF4ng \u0111\u1EC3 m\u1EDF m\u1ED9t l\u01B0\u1EE3t gateway m\u1EDBi.`;
    providerCode = "provider-transient";
  } else if (errorCode === "upstream-transient" || status === 408 || status === 425 || status === 429 || status >= 500) {
    message = errorMsg ? `Gemini Gateway l\u1ED7i upstream: ${errorMsg}` : detail || `Gemini Gateway b\xE1o l\u1ED7i HTTP ${status}.`;
    providerCode = "provider-transient";
  } else if (status === 401 || status === 403 || errorCode === "authentication_required") {
    message = "Cookie Gemini c\u1EE7a gateway \u0111\xE3 h\u1EBFt h\u1EA1n ho\u1EB7c kh\xF4ng h\u1EE3p l\u1EC7. H\xE3y c\u1EADp nh\u1EADt cookie r\u1ED3i kh\u1EDFi \u0111\u1ED9ng l\u1EA1i gateway.";
    providerCode = "provider-auth";
  }
  return Object.assign(new Error(message), {
    status,
    providerCode,
    errorCode,
    upstreamAttempts
  });
}
function createGatewayRequestBody(messages, maxOutputTokens, structuredJson = true, outputMode = "json-items", responseFormat) {
  const useStructuredJson = structuredJson && outputMode === "json-items";
  const selectedResponseFormat = responseFormat || (useStructuredJson ? TRANSLATION_RESPONSE_FORMAT : void 0);
  return {
    model: GEMINI_GATEWAY_MODEL,
    messages,
    temperature: 0.2,
    max_tokens: maxOutputTokens,
    temporary: true,
    gateway_requirements: {
      contract_version: 2,
      // Google may serve a different text model than the catalog route. The
      // user-selected policy accepts that fallback; completion and structured
      // output evidence remain mandatory.
      require_verified_model: false,
      require_complete_response: true,
      ...outputMode === "cue-lines-v1" ? { text_output_contract: "cue-lines-v1" } : {}
    },
    ...selectedResponseFormat ? { response_format: selectedResponseFormat } : {}
  };
}
var isTestEnv = typeof process !== "undefined" && Boolean(
  process.env.NODE_TEST_CONTEXT !== void 0 || process.env.npm_lifecycle_event?.includes("test") || process.argv?.some((arg) => arg.includes("test"))
);
function parseGatewayCompletionData(data, requestBody, outputMode) {
  if (!data || typeof data !== "object") {
    throw Object.assign(new Error("Gemini Gateway kh\xF4ng tr\u1EA3 v\u1EC1 payload h\u1EE3p l\u1EC7."), { providerCode: "provider-protocol" });
  }
  if (!Array.isArray(data.choices) || data.choices.length !== 1) {
    throw Object.assign(new Error("Gemini Gateway tr\u1EA3 v\u1EC1 s\u1ED1 candidate kh\xF4ng h\u1EE3p l\u1EC7."), { providerCode: "provider-protocol" });
  }
  const choice = data.choices[0];
  const finishReason = typeof choice.finish_reason === "string" ? choice.finish_reason : "unknown";
  if (finishReason === "content_filter" || typeof choice.message?.refusal === "string" && choice.message.refusal.trim() || choice.message?.tool_calls !== void 0) {
    throw Object.assign(new Error("Gemini Gateway l\u1ECDc, t\u1EEB ch\u1ED1i ho\u1EB7c tr\u1EA3 tool payload."), { providerCode: "provider-protocol" });
  }
  const raw = typeof choice.message?.content === "string" ? choice.message.content.trim() : "";
  if (!raw) throw Object.assign(new Error("Gemini Gateway tr\u1EA3 v\u1EC1 n\u1ED9i dung r\u1ED7ng."), { providerCode: "provider-protocol" });
  const meta = data.gateway_metadata;
  if (!meta || meta.gateway_contract_version !== 2) {
    throw Object.assign(new Error("Gemini Gateway kh\xF4ng tr\u1EA3 v\u1EC1 h\u1EE3p \u0111\u1ED3ng phi\xEAn b\u1EA3n 2 (gateway_metadata.gateway_contract_version: 2). H\xE3y ki\u1EC3m tra phi\xEAn b\u1EA3n gateway v\xE0 TediaPros."), { providerCode: "provider-protocol" });
  }
  if (!["matched", "mismatch", "unverified"].includes(String(meta.model_verification))) {
    throw Object.assign(new Error(`Gemini Gateway tr\u1EA3 v\u1EC1 tr\u1EA1ng th\xE1i model kh\xF4ng h\u1EE3p l\u1EC7: ${meta.model_verification}.`), { providerCode: "provider-protocol" });
  }
  if (!meta.observed_model_id || typeof meta.observed_model_id !== "string") {
    throw Object.assign(new Error("Gemini Gateway kh\xF4ng cung c\u1EA5p observed_model_id h\u1EE3p l\u1EC7."), { providerCode: "provider-protocol" });
  }
  if (meta.completion_state !== "complete") {
    throw Object.assign(new Error(`Gemini Gateway ph\u1EA3n h\u1ED3i ch\u01B0a ho\xE0n t\u1EA5t (completion_state: ${meta.completion_state}).`), { providerCode: "provider-protocol" });
  }
  if (outputMode === "cue-lines-v1" && meta.text_output_contract !== "cue-lines-v1") {
    throw Object.assign(new Error("Gemini Gateway kh\xF4ng x\xE1c nh\u1EADn text_output_contract=cue-lines-v1 trong metadata; kh\xF4ng ch\u1EA5p nh\u1EADn plain-text response khi ch\u01B0a negotiated."), { providerCode: "provider-protocol" });
  }
  if (!isGatewayRouteFingerprint(meta.route_fingerprint)) {
    throw Object.assign(new Error("Gemini Gateway kh\xF4ng cung c\u1EA5p route_fingerprint h\u1EE3p l\u1EC7."), { providerCode: "provider-protocol" });
  }
  if (typeof meta.completion_evidence !== "string" || !meta.completion_evidence.trim()) {
    throw Object.assign(new Error("Gemini Gateway kh\xF4ng cung c\u1EA5p completion_evidence h\u1EE3p l\u1EC7."), { providerCode: "provider-protocol" });
  }
  if (typeof meta.upstream_attempts !== "number" || !Number.isInteger(meta.upstream_attempts) || meta.upstream_attempts < 1 || meta.upstream_attempts > 3) {
    throw Object.assign(new Error("Gemini Gateway cung c\u1EA5p upstream_attempts ngo\xE0i gi\u1EDBi h\u1EA1n 1..3."), { providerCode: "provider-protocol" });
  }
  const resolved = typeof meta.resolved_model === "string" ? meta.resolved_model : typeof data.model === "string" ? data.model : GEMINI_GATEWAY_MODEL;
  if (resolved !== GEMINI_GATEWAY_MODEL) {
    throw Object.assign(new Error(`Gemini Gateway \u0111\xE3 ch\u1ECDn model ${resolved} thay v\xEC ${GEMINI_GATEWAY_MODEL}.`), { providerCode: "provider-protocol" });
  }
  return {
    raw,
    truncated: finishReason === "length",
    modelIdentity: `gemini-gateway:${GEMINI_GATEWAY_MODEL}`,
    responseId: typeof data.id === "string" ? data.id : void 0,
    finishReason,
    requestBody,
    logicalRequestId: typeof meta.logical_request_id === "string" ? meta.logical_request_id : void 0,
    observedModelId: meta.observed_model_id,
    observedModel: typeof meta.observed_model === "string" ? meta.observed_model : void 0,
    routeFingerprint: meta.route_fingerprint,
    completionState: "complete",
    completionEvidence: meta.completion_evidence,
    normalizationOps: Array.isArray(meta.normalization) ? meta.normalization.filter((item) => typeof item === "string") : [],
    upstreamRetryReasons: Array.isArray(meta.upstream_retry_reasons) ? meta.upstream_retry_reasons.filter((item) => typeof item === "string").slice(0, 8) : [],
    upstreamAttempts: meta.upstream_attempts
  };
}
async function writeDurableJson(path, value) {
  await (0, import_promises3.mkdir)((0, import_node_path3.dirname)(path), { recursive: true });
  const temporary = `${path}.${(0, import_node_crypto3.randomUUID)()}.tmp`;
  let handle;
  try {
    handle = await (0, import_promises3.open)(temporary, "wx");
    await handle.writeFile(JSON.stringify(value, null, 2), "utf8");
    await handle.sync();
    await handle.close();
    handle = void 0;
    await (0, import_promises3.rename)(temporary, path);
  } finally {
    await handle?.close().catch(() => {
    });
    await (0, import_promises3.rm)(temporary, { force: true }).catch(() => {
    });
  }
}
function parseGatewayOperationLease(raw, payloadSha256, stage) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const lease = value;
  if (!lease || lease.schemaVersion !== 1 || typeof lease.clientRequestId !== "string" || !lease.clientRequestId.trim() || typeof lease.operationToken !== "string" || !lease.operationToken.trim() || typeof lease.payloadSha256 !== "string" || !/^[a-f0-9]{64}$/u.test(lease.payloadSha256) || lease.payloadSha256 !== payloadSha256 || lease.stage !== stage || typeof lease.startedAtUtc !== "string" || !Number.isFinite(Date.parse(lease.startedAtUtc)) || lease.operationId !== void 0 && (typeof lease.operationId !== "string" || !lease.operationId.trim())) {
    return null;
  }
  return lease;
}
function recoveredStoreBlockedReceipt(error) {
  if (!error || typeof error !== "object") return null;
  const receipt = error.receipt;
  if (!receipt || receipt.status !== "blocked" || receipt.dispatchState !== "not-dispatched" || receipt.upstreamAttempts !== 0) return null;
  return receipt.errorCode === "recovered-from-store" || receipt.error?.includes("recovered-from-store") ? receipt : null;
}
async function recoverStoredGovernorBlock(baseUrl, signal) {
  const scheduler = await getGatewaySchedulerStatus(baseUrl, signal);
  if (scheduler.state === "blocked") {
    if (scheduler.reason !== "recovered-from-store" || scheduler.activePermits !== 0) return false;
    logWarn("[GeminiGateway] Governor kh\xF4i ph\u1EE5c t\u1EEB snapshot kh\xF3a c\u0169; \u0111ang reset tr\u01B0\u1EDBc khi t\u1EA1o operation m\u1EDBi\u2026");
    if (!await resetGatewayScheduler(baseUrl, signal)) return false;
    const verified = await getGatewaySchedulerStatus(baseUrl, signal);
    return verified.state === "ready" && verified.activePermits === 0;
  }
  return true;
}
async function requestGatewayOperation(baseUrl, messages, signal, maxOutputTokens, structuredJson = true, outputMode = "json-items", context) {
  const requestBody = createGatewayRequestBody(messages, maxOutputTokens, structuredJson, outputMode, context?.responseFormat);
  const payloadSha256 = (0, import_node_crypto3.createHash)("sha256").update(JSON.stringify(requestBody)).digest("hex");
  const createLease = () => ({
    schemaVersion: 1,
    clientRequestId: generateClientRequestId(),
    operationToken: generateOperationToken(),
    payloadSha256,
    stage: context?.stage || "unknown",
    startedAtUtc: (/* @__PURE__ */ new Date()).toISOString()
  });
  let lease = createLease();
  let leasePath2;
  if (context?.maxRequestBodyBytes !== void 0) {
    if (!Number.isSafeInteger(context.maxRequestBodyBytes) || context.maxRequestBodyBytes <= 0) {
      throw Object.assign(new Error("Gateway kh\xF4ng c\xF4ng b\u1ED1 max_request_body_bytes h\u1EE3p l\u1EC7 cho media restoration."), { providerCode: "provider-protocol" });
    }
    const envelopeBytes = Buffer.byteLength(JSON.stringify({ client_request_id: lease.clientRequestId, request: requestBody }), "utf8");
    if (envelopeBytes > context.maxRequestBodyBytes) {
      throw Object.assign(new Error(`Gateway media payload v\u01B0\u1EE3t max_request_body_bytes (${envelopeBytes} > ${context.maxRequestBodyBytes}); kh\xF4ng g\u1EEDi request.`), {
        providerCode: "provider-protocol",
        requestBytes: envelopeBytes,
        requestByteLimit: context.maxRequestBodyBytes
      });
    }
  }
  if (context?.draftDir) {
    leasePath2 = (0, import_node_path3.join)(context.draftDir, `${context.stage}-operation.json`);
    try {
      const rawLease = await (0, import_promises3.readFile)(leasePath2, "utf8");
      const parsed = parseGatewayOperationLease(rawLease, payloadSha256, context.stage);
      if (parsed) {
        lease = parsed;
      } else {
        try {
          const old = JSON.parse(rawLease);
          if (typeof old?.operationId === "string" && old.operationId.trim() && typeof old?.operationToken === "string" && old.operationToken.trim() && typeof old.clientRequestId === "string" && old.clientRequestId.trim()) {
            const { receipt } = await getGatewayOperation({
              baseUrl,
              operationId: old.operationId,
              operationToken: old.operationToken,
              expectedClientRequestId: old.clientRequestId,
              signal,
              httpTimeoutMs: Math.min(context.httpTimeoutMs ?? 1e4, 1e4)
            });
            const safelyCancellablePending = (receipt.status === "queued" || receipt.status === "waiting-provider") && receipt.dispatchState === "not-dispatched" && receipt.upstreamAttempts === 0;
            if (safelyCancellablePending) {
              await cancelGatewayOperation(baseUrl, receipt.id, old.operationToken, {
                timeoutMs: Math.min(context.httpTimeoutMs ?? 1e4, 1e4),
                expectedClientRequestId: old.clientRequestId
              });
            } else if (["queued", "waiting-provider", "running", "cancelling", "outcome-unknown"].includes(receipt.status)) {
              const deferred = new GatewayOperationDeferredError(receipt);
              Object.assign(deferred, {
                stage: context.stage,
                cancelOperation: async () => {
                  await cancelGatewayOperation(baseUrl, receipt.id, old.operationToken, {
                    timeoutMs: Math.min(context.httpTimeoutMs ?? 1e4, 1e4),
                    expectedClientRequestId: old.clientRequestId
                  });
                }
              });
              throw deferred;
            } else {
              await ackGatewayOperation(baseUrl, receipt.id, old.operationToken, Math.min(context.httpTimeoutMs ?? 1e4, 1e4)).catch(() => {
              });
            }
          }
        } catch (error) {
          if (error instanceof GatewayOperationDeferredError) throw error;
          const status = error?.status;
          if (status !== 404) throw error;
        }
        logWarn(`[GeminiGateway] Lease c\u0169 t\u1EA1i ${leasePath2} kh\xF4ng kh\u1EDBp payload/stage (stage=${context.stage}); t\u1EA1o lease m\u1EDBi cho generation hi\u1EC7n t\u1EA1i.`);
        await writeDurableJson(leasePath2, lease);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      await writeDurableJson(leasePath2, lease);
    }
  }
  let operationId = lease.operationId;
  let recoveredStoreBlock = false;
  while (true) {
    try {
      if (!operationId) {
        const receipt = await submitGatewayOperation({
          baseUrl,
          clientRequestId: lease.clientRequestId,
          operationToken: lease.operationToken,
          requestPayload: requestBody,
          signal,
          httpTimeoutMs: context?.httpTimeoutMs
        });
        operationId = receipt.id;
        context?.onProgress?.(receipt);
        lease = { ...lease, operationId, startedAtUtc: receipt.createdAtUtc };
        if (leasePath2) await writeDurableJson(leasePath2, lease);
      }
      const rawResponse = await pollGatewayOperation({
        baseUrl,
        operationId,
        operationToken: lease.operationToken,
        signal,
        expectedClientRequestId: lease.clientRequestId,
        httpTimeoutMs: context?.httpTimeoutMs,
        runtime: context?.runtime,
        deferOnWaitingProvider: context?.deferOnWaitingProvider,
        onProgress: context?.onProgress
      });
      const completion = parseGatewayCompletionData(rawResponse, requestBody, outputMode);
      const ack = async () => {
        await ackGatewayOperation(baseUrl, operationId, lease.operationToken, context?.httpTimeoutMs);
        if (leasePath2) await (0, import_promises3.unlink)(leasePath2);
      };
      return { completion, ack };
    } catch (error) {
      const blockedReceipt = recoveredStoreBlockedReceipt(error);
      if (!recoveredStoreBlock && blockedReceipt && await recoverStoredGovernorBlock(baseUrl, signal)) {
        recoveredStoreBlock = true;
        await ackGatewayOperation(baseUrl, blockedReceipt.id, lease.operationToken, context?.httpTimeoutMs).catch((ackError) => {
          logWarn(`[GeminiGateway] Kh\xF4ng ACK \u0111\u01B0\u1EE3c operation b\u1ECB kh\xF3a ${blockedReceipt.id}: ${ackError instanceof Error ? ackError.message : String(ackError)}`);
        });
        lease = createLease();
        operationId = void 0;
        if (leasePath2) await writeDurableJson(leasePath2, lease);
        continue;
      }
      if (error instanceof GatewayOperationDeferredError) {
        Object.assign(error, {
          stage: context?.stage,
          cancelOperation: async () => {
            await cancelGatewayOperation(baseUrl, error.operationId, lease.operationToken, {
              timeoutMs: Math.min(context?.httpTimeoutMs ?? 1e4, 1e4),
              expectedClientRequestId: lease.clientRequestId
            });
          }
        });
        throw error;
      }
      if (signal.aborted && operationId) {
        try {
          await cancelGatewayOperation(baseUrl, operationId, lease.operationToken, {
            timeoutMs: Math.min(context?.httpTimeoutMs ?? 1e4, 1e4),
            expectedClientRequestId: lease.clientRequestId
          });
        } catch (cancelError) {
          throw Object.assign(new Error(`\u0110\xE3 h\u1EE7y t\xE1c v\u1EE5 nh\u01B0ng gateway kh\xF4ng x\xE1c nh\u1EADn cancel: ${cancelError instanceof Error ? cancelError.message : String(cancelError)}`, { cause: cancelError }), {
            providerCode: "provider-protocol",
            operationId,
            stage: context?.stage
          });
        }
      }
      throw error;
    }
  }
}

// src/main/translation/sourceRestoration.ts
var import_node_crypto4 = require("node:crypto");
var SHA256_RE = /^[a-f0-9]{64}$/iu;
var EDIT_KINDS = /* @__PURE__ */ new Set(["homophone", "ocr_alignment", "entity", "semantic"]);
var REVIEW_STATUSES = /* @__PURE__ */ new Set(["approved", "needs_adjustment", "rejected"]);
function sha256(value) {
  return (0, import_node_crypto4.createHash)("sha256").update(value).digest("hex");
}
function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function nonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function exactKeys(value, allowed, required = allowed) {
  const actual = Object.keys(value);
  if (required.some((key) => !(key in value)) || actual.some((key) => !allowed.includes(key))) {
    throw new Error("Restoration payload c\xF3 tr\u01B0\u1EDDng kh\xF4ng \u0111\xFAng schema.");
  }
}
function parseObject(raw, label) {
  if (typeof raw === "string") {
    try {
      const parsed = parseAiJsonObject(raw.trim(), {
        allowFence: false,
        allowProseObject: false,
        limits: { maxBytes: 2 * 1024 * 1024, maxDepth: 16, maxMembers: 4e3, maxCandidates: 1 }
      }).value;
      if (!isPlainObject(parsed)) throw new Error("not-object");
      return parsed;
    } catch {
      throw new Error(`${label} ph\u1EA3i l\xE0 JSON object h\u1EE3p l\u1EC7, kh\xF4ng c\xF3 Markdown hay prose.`);
    }
  }
  if (!isPlainObject(raw)) throw new Error(`${label} ph\u1EA3i l\xE0 JSON object h\u1EE3p l\u1EC7.`);
  return raw;
}
function normalizedCues(cues) {
  const ids = /* @__PURE__ */ new Set();
  return cues.map((cue, index) => {
    const id = String(cue.id || "").trim();
    const text = String(cue.text || "").trim();
    if (!id || ids.has(id) || !text || !finiteNumber(cue.start) || !finiteNumber(cue.end) || cue.end < cue.start) {
      throw new Error(`Cue ngu\u1ED3n th\u1EE9 ${index + 1} kh\xF4ng h\u1EE3p l\u1EC7 cho restoration.`);
    }
    ids.add(id);
    return { id, text, start: cue.start, end: cue.end };
  });
}
function matchingCueIds(cues, start, end) {
  return cues.filter((cue) => Math.max(cue.start, start) <= Math.min(cue.end, end)).map((cue) => cue.id);
}
function normalizeRegion(value) {
  if (!isPlainObject(value) || !finiteNumber(value.x) || !finiteNumber(value.y) || !finiteNumber(value.width) || !finiteNumber(value.height) || value.width <= 0 || value.height <= 0) return void 0;
  return { x: value.x, y: value.y, width: value.width, height: value.height };
}
function buildSourceEvidencePack(param1, legacyOcrCues = null, legacyGlossary) {
  const options = Array.isArray(param1) ? { cues: param1, glossary: legacyGlossary } : param1;
  const cues = normalizedCues(options.cues || []);
  const items = [];
  const ocrEvidence = [];
  if (options.audioMeta) {
    const audio = options.audioMeta;
    if (!finiteNumber(audio.durationSeconds) || audio.durationSeconds <= 0 || !Number.isSafeInteger(audio.sampleRate) || audio.sampleRate <= 0 || !Number.isSafeInteger(audio.channels) || audio.channels <= 0 || !["mp3", "wav"].includes(audio.format) || !SHA256_RE.test(audio.sha256 || "")) {
      throw new Error("Audio evidence metadata kh\xF4ng h\u1EE3p l\u1EC7.");
    }
    items.push({
      id: "audio_0",
      type: "audio",
      text: `audio/${audio.format};${audio.durationSeconds.toFixed(3)}s`,
      start: 0,
      end: audio.durationSeconds,
      matchingCueIds: matchingCueIds(cues, 0, audio.durationSeconds)
    });
  }
  const addOcr = (timestamp, end, line) => {
    const text = String(line.text || "").trim();
    if (!text || !finiteNumber(timestamp) || !finiteNumber(end) || end < timestamp) return;
    const id = `ocr_${ocrEvidence.length}`;
    const confidence = finiteNumber(line.confidence) ? Math.max(0, Math.min(1, line.confidence)) : 0.9;
    const region = normalizeRegion(line.boundingBox);
    const cueIds = matchingCueIds(cues, timestamp, end);
    ocrEvidence.push({ id, text, start: timestamp, end, confidence, ...region ? { region } : {} });
    items.push({
      id,
      type: "ocr",
      text,
      timestamp,
      start: timestamp,
      end,
      confidence,
      ...region ? { region } : {},
      matchingCueIds: cueIds
    });
  };
  if (Array.isArray(options.ocrFrames)) {
    for (const frame of options.ocrFrames) {
      const start = frame.timestamp;
      const end = finiteNumber(frame.end) ? frame.end : start + 0.5;
      for (const line of frame.lines || []) addOcr(start, end, line);
    }
  }
  if (legacyOcrCues) {
    for (const cue of legacyOcrCues) addOcr(cue.start, cue.end, { text: cue.text, confidence: 0.95 });
  }
  const glossary = (options.glossary || []).flatMap((entry, index) => {
    const source = String(entry.source || "").trim();
    const target = String(entry.target || "").trim();
    if (!source || !target) return [];
    const related = cues.filter((cue) => cue.text.includes(source)).map((cue) => cue.id);
    if (related.length > 0) {
      items.push({ id: `glossary_${index}`, type: "glossary", text: `${source} => ${target}`, matchingCueIds: related });
    }
    return [{ source, target }];
  });
  const payload = JSON.stringify({ schemaVersion: 1, cues, ocrEvidence, audioMeta: options.audioMeta, glossary });
  const evidenceDigest = sha256(payload);
  return {
    schemaVersion: 1,
    evidenceDigest,
    digest: evidenceDigest,
    cues,
    ocrEvidence,
    items,
    ...options.audioMeta ? { audioMeta: options.audioMeta } : {},
    ...glossary.length > 0 ? { glossary } : {}
  };
}
function compactRestorationEvidence(items, requiredRefs = /* @__PURE__ */ new Set()) {
  const representatives = /* @__PURE__ */ new Map();
  for (const item of items) {
    const key = JSON.stringify([item.type, item.text, [...item.matchingCueIds].sort()]);
    const previous = representatives.get(key);
    if (!previous || (item.confidence ?? 0) > (previous.confidence ?? 0)) representatives.set(key, item);
  }
  const selected = new Set([...representatives.values()].map((item) => item.id));
  return items.filter((item) => selected.has(item.id) || requiredRefs.has(item.id)).map((item) => ({
    id: item.id,
    type: item.type,
    text: item.text,
    ...item.start !== void 0 ? { start: item.start } : {},
    ...item.end !== void 0 ? { end: item.end } : {},
    ...item.confidence !== void 0 ? { confidence: Math.round(item.confidence * 1e3) / 1e3 } : {},
    matchingCueIds: [...item.matchingCueIds]
  }));
}
function buildRestorationDraftPayload(params) {
  return JSON.stringify({
    schemaVersion: "restoration-draft-input-v1",
    targetLang: params.targetLang,
    evidenceDigest: params.evidencePack.evidenceDigest,
    cues: normalizedCues(params.cues),
    evidenceItems: compactRestorationEvidence(params.evidencePack.items),
    ...params.synopsis?.trim() ? { synopsis: params.synopsis.trim() } : {},
    ...params.channelContext?.trim() ? { channelContext: params.channelContext.trim() } : {}
  });
}
function expectedIds(expected) {
  if (expected instanceof Set) return [...expected].map((id) => id.trim());
  if ("schemaVersion" in expected && expected.schemaVersion === 1 && Array.isArray(expected.cues)) return expected.cues.map((cue) => cue.id.trim());
  return normalizedCues(expected).map((cue) => cue.id);
}
function getEvidencePack(value) {
  return value && !(value instanceof Set) && value.schemaVersion === 1 ? value : void 0;
}
function validateEvidenceReferences(refs, cueId, evidence, label) {
  if (!Array.isArray(refs) || refs.length === 0 || refs.some((ref) => !nonEmptyString(ref))) {
    throw new Error(`${label} ph\u1EA3i tham chi\u1EBFu \xEDt nh\u1EA5t m\u1ED9t evidence h\u1EE3p l\u1EC7.`);
  }
  const normalized = refs.map((ref) => ref.trim());
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} c\xF3 evidence ref tr\xF9ng.`);
  for (const ref of normalized) {
    const item = evidence.get(ref);
    if (!item) throw new Error(`${label} tham chi\u1EBFu evidence kh\xF4ng t\u1ED3n t\u1EA1i: ${ref}.`);
    if (!item.matchingCueIds.includes(cueId)) throw new Error(`${label} tham chi\u1EBFu evidence kh\xF4ng li\xEAn quan local t\u1EDBi cue ${cueId}.`);
  }
  return normalized;
}
function validateEntityEvidenceReferences(refs, cueIds, evidence, label) {
  if (!Array.isArray(refs) || refs.length === 0 || refs.some((ref) => !nonEmptyString(ref))) {
    throw new Error(`${label} ph\u1EA3i tham chi\u1EBFu \xEDt nh\u1EA5t m\u1ED9t evidence h\u1EE3p l\u1EC7.`);
  }
  const normalized = refs.map((ref) => ref.trim());
  if (new Set(normalized).size !== normalized.length) throw new Error(`${label} c\xF3 evidence ref tr\xF9ng.`);
  const covered = /* @__PURE__ */ new Set();
  for (const ref of normalized) {
    const item = evidence.get(ref);
    if (!item) throw new Error(`${label} tham chi\u1EBFu evidence kh\xF4ng t\u1ED3n t\u1EA1i: ${ref}.`);
    const localCueIds = cueIds.filter((cueId) => item.matchingCueIds.includes(cueId));
    if (localCueIds.length === 0) throw new Error(`${label} tham chi\u1EBFu evidence kh\xF4ng li\xEAn quan local t\u1EDBi entity.`);
    for (const cueId of localCueIds) covered.add(cueId);
  }
  if (cueIds.some((cueId) => !covered.has(cueId))) throw new Error(`${label} ch\u01B0a c\xF3 evidence local cho to\xE0n b\u1ED9 cue c\u1EE7a entity.`);
  return normalized;
}
function normalizeObservedGatewaySourceEdit(value) {
  if (!isPlainObject(value)) return value;
  const legacyKeys = ["cueId", "text", "evidenceRefs"];
  const keys = Object.keys(value);
  if (keys.length !== legacyKeys.length || legacyKeys.some((key) => !(key in value))) return value;
  return {
    id: value.cueId,
    text: value.text,
    kind: "semantic",
    evidenceRefs: value.evidenceRefs
  };
}
function validateSourceEdit(value, ids, evidence, label, allowedIds = ids) {
  const normalizedValue = normalizeObservedGatewaySourceEdit(value);
  if (!isPlainObject(normalizedValue)) throw new Error(`${label} kh\xF4ng h\u1EE3p l\u1EC7.`);
  exactKeys(normalizedValue, ["id", "text", "kind", "evidenceRefs"]);
  const id = typeof normalizedValue.id === "string" ? normalizedValue.id.trim() : "";
  const text = typeof normalizedValue.text === "string" ? normalizedValue.text.trim() : "";
  const kind = normalizedValue.kind;
  if (!id || !allowedIds.has(id) || !ids.has(id) || !text || !EDIT_KINDS.has(kind)) throw new Error(`${label} c\xF3 cue ID, text ho\u1EB7c kind kh\xF4ng h\u1EE3p l\u1EC7.`);
  return { id, text, kind, evidenceRefs: validateEvidenceReferences(normalizedValue.evidenceRefs, id, evidence, label) };
}
function validateItems(value, ids, label) {
  if (!Array.isArray(value) || value.length !== ids.length) throw new Error(`${label} kh\xF4ng kh\u1EDBp v\u1EDBi s\u1ED1 cue ngu\u1ED3n.`);
  const expected = new Set(ids);
  const seen = /* @__PURE__ */ new Set();
  const result = value.map((raw, index) => {
    if (!isPlainObject(raw)) throw new Error(`${label} item th\u1EE9 ${index + 1} kh\xF4ng h\u1EE3p l\u1EC7.`);
    exactKeys(raw, ["id", "target"]);
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    const target = typeof raw.target === "string" ? raw.target.trim() : "";
    if (!id || !expected.has(id) || seen.has(id)) throw new Error(`${label} c\xF3 cue ID kh\xF4ng thu\u1ED9c ngu\u1ED3n ho\u1EB7c b\u1ECB tr\xF9ng.`);
    if (!target) throw new Error(`${label} c\xF3 target text r\u1ED7ng.`);
    seen.add(id);
    return { id, target };
  });
  if (seen.size !== expected.size) throw new Error(`${label} thi\u1EBFu cue ID.`);
  return result;
}
function validateRestorationDraft(raw, expectedIdsOrCues, validEvidenceIdsOrPack) {
  const obj = parseObject(raw, "Restoration draft");
  exactKeys(obj, ["schemaVersion", "evidenceDigest", "sourceEdits", "sentenceEndIds", "entities", "synopsis", "items"], ["schemaVersion", "evidenceDigest", "sourceEdits", "sentenceEndIds", "entities", "items"]);
  if (obj.schemaVersion !== "restoration-translation-v1") throw new Error("Restoration draft c\xF3 schemaVersion kh\xF4ng h\u1EE3p l\u1EC7.");
  const ids = expectedIds(expectedIdsOrCues);
  if (ids.length === 0 || new Set(ids).size !== ids.length) throw new Error("T\u1EADp cue ngu\u1ED3n kh\xF4ng h\u1EE3p l\u1EC7.");
  const pack = getEvidencePack(validEvidenceIdsOrPack);
  if (pack && obj.evidenceDigest !== pack.evidenceDigest) throw new Error("Restoration draft c\xF3 evidence digest kh\xF4ng kh\u1EDBp.");
  if (!pack && !nonEmptyString(obj.evidenceDigest)) throw new Error("Restoration draft thi\u1EBFu evidence digest.");
  const evidence = /* @__PURE__ */ new Map();
  if (pack) for (const item of pack.items) evidence.set(item.id, item);
  else if (validEvidenceIdsOrPack instanceof Set) for (const id of validEvidenceIdsOrPack) evidence.set(id, { id, type: "audio", text: "legacy", matchingCueIds: ids });
  const idSet = new Set(ids);
  if (!Array.isArray(obj.sourceEdits)) throw new Error("Restoration draft thi\u1EBFu sourceEdits.");
  const edited = /* @__PURE__ */ new Set();
  const sourceEdits = obj.sourceEdits.map((edit, index) => {
    const normalized = validateSourceEdit(edit, idSet, evidence, `Source edit ${index + 1}`);
    if (edited.has(normalized.id)) throw new Error(`Source edit b\u1ECB tr\xF9ng cue ID ${normalized.id}.`);
    edited.add(normalized.id);
    return normalized;
  });
  if (!Array.isArray(obj.sentenceEndIds) || obj.sentenceEndIds.some((id) => !nonEmptyString(id))) throw new Error("Restoration draft c\xF3 sentenceEndIds kh\xF4ng h\u1EE3p l\u1EC7.");
  const sentenceEndIds = obj.sentenceEndIds.map((id) => id.trim());
  if (new Set(sentenceEndIds).size !== sentenceEndIds.length || sentenceEndIds.some((id) => !idSet.has(id))) throw new Error("Restoration draft c\xF3 sentenceEndIds kh\xF4ng thu\u1ED9c cue ngu\u1ED3n ho\u1EB7c b\u1ECB tr\xF9ng.");
  if (!Array.isArray(obj.entities)) throw new Error("Restoration draft thi\u1EBFu entities.");
  const entities = obj.entities.map((entity, index) => {
    if (!isPlainObject(entity)) throw new Error(`Entity ${index + 1} kh\xF4ng h\u1EE3p l\u1EC7.`);
    exactKeys(entity, ["source", "target", "sourceCueIds", "evidenceRefs"]);
    const source = typeof entity.source === "string" ? entity.source.trim() : "";
    const target = typeof entity.target === "string" ? entity.target.trim() : "";
    if (!source || !target || !Array.isArray(entity.sourceCueIds) || entity.sourceCueIds.length === 0 || entity.sourceCueIds.some((id) => !nonEmptyString(id))) throw new Error(`Entity ${index + 1} kh\xF4ng h\u1EE3p l\u1EC7.`);
    const sourceCueIds = entity.sourceCueIds.map((id) => id.trim());
    if (new Set(sourceCueIds).size !== sourceCueIds.length || sourceCueIds.some((id) => !idSet.has(id))) throw new Error(`Entity ${index + 1} c\xF3 cue ID kh\xF4ng h\u1EE3p l\u1EC7.`);
    const refs = Array.isArray(entity.evidenceRefs) && entity.evidenceRefs.length > 0 ? validateEntityEvidenceReferences(entity.evidenceRefs, sourceCueIds, evidence, `Entity ${index + 1}`) : [];
    return { source, target, sourceCueIds, evidenceRefs: refs };
  });
  return {
    schemaVersion: "restoration-translation-v1",
    evidenceDigest: obj.evidenceDigest,
    sourceEdits,
    sentenceEndIds,
    entities,
    ...typeof obj.synopsis === "string" ? { synopsis: obj.synopsis.trim() } : {},
    items: validateItems(obj.items, ids, "Restoration draft")
  };
}
function calculateRestorationCandidateDigest(draft) {
  return sha256(JSON.stringify({
    schemaVersion: draft.schemaVersion,
    evidenceDigest: draft.evidenceDigest || "",
    sourceEdits: draft.sourceEdits.map((edit) => ({ ...edit, evidenceRefs: [...edit.evidenceRefs] })),
    sentenceEndIds: [...draft.sentenceEndIds],
    entities: draft.entities.map((entity) => ({ ...entity, sourceCueIds: [...entity.sourceCueIds], evidenceRefs: [...entity.evidenceRefs] })),
    items: draft.items.map((item) => ({ id: item.id, target: item.target }))
  }));
}
function buildRestorationReviewPayload(params) {
  return JSON.stringify({
    schemaVersion: "restoration-review-input-v1",
    evidenceDigest: params.evidencePack.evidenceDigest,
    candidateDigest: calculateRestorationCandidateDigest(params.draft),
    targetLang: params.targetLang,
    draft: params.draft,
    evidenceItems: compactRestorationEvidence(params.evidencePack.items, /* @__PURE__ */ new Set([
      ...params.draft.sourceEdits.flatMap((edit) => edit.evidenceRefs),
      ...params.draft.entities.flatMap((entity) => entity.evidenceRefs)
    ])),
    ...params.synopsis?.trim() ? { synopsis: params.synopsis.trim() } : {}
  });
}
function expectedReviewIds(expectedDigestOrDraft, expectedIdsOrPack) {
  if (expectedIdsOrPack instanceof Set) return [...expectedIdsOrPack].map((id) => id.trim());
  if (expectedIdsOrPack) return expectedIds(expectedIdsOrPack);
  if (typeof expectedDigestOrDraft !== "string") return expectedDigestOrDraft.items.map((item) => item.id.trim());
  throw new Error("Restoration review thi\u1EBFu t\u1EADp cue k\u1EF3 v\u1ECDng.");
}
function validateRestorationReview(raw, expectedDigestOrDraft, expectedIdsOrPack) {
  const obj = parseObject(raw, "Restoration review");
  exactKeys(obj, ["schemaVersion", "candidateDigest", "reviewedCueIds", "status", "confidenceScore", "reviewerNotes", "groupAssessments", "findings", "replacements"]);
  if (obj.schemaVersion !== "restoration-review-v1") throw new Error("Restoration review c\xF3 schemaVersion kh\xF4ng h\u1EE3p l\u1EC7.");
  const candidateDigest = typeof expectedDigestOrDraft === "string" ? expectedDigestOrDraft : calculateRestorationCandidateDigest(expectedDigestOrDraft);
  if (obj.candidateDigest !== candidateDigest) throw new Error("Restoration review c\xF3 candidate digest kh\xF4ng kh\u1EDBp ho\u1EB7c stale.");
  const ids = expectedReviewIds(expectedDigestOrDraft, expectedIdsOrPack);
  const idSet = new Set(ids);
  if (!Array.isArray(obj.reviewedCueIds) || obj.reviewedCueIds.some((id) => !nonEmptyString(id))) throw new Error("Restoration review c\xF3 reviewedCueIds kh\xF4ng h\u1EE3p l\u1EC7.");
  const reviewedCueIds = obj.reviewedCueIds.map((id) => id.trim());
  if (reviewedCueIds.length !== ids.length || new Set(reviewedCueIds).size !== ids.length || reviewedCueIds.some((id) => !idSet.has(id))) throw new Error("Restoration review kh\xF4ng bao ph\u1EE7 ch\xEDnh x\xE1c t\u1EADp cue c\u1EA7n review.");
  const status = obj.status;
  if (!REVIEW_STATUSES.has(status) || !finiteNumber(obj.confidenceScore) || obj.confidenceScore < 0 || obj.confidenceScore > 1 || !nonEmptyString(obj.reviewerNotes)) throw new Error("Restoration review thi\u1EBFu status, confidence ho\u1EB7c reviewer notes h\u1EE3p l\u1EC7.");
  if (!Array.isArray(obj.groupAssessments) || obj.groupAssessments.length === 0) throw new Error("Restoration review thi\u1EBFu group assessments.");
  const groupIds = /* @__PURE__ */ new Set();
  const assigned = /* @__PURE__ */ new Set();
  const groupById = /* @__PURE__ */ new Map();
  const groupAssessments = obj.groupAssessments.map((assessment, index) => {
    if (!isPlainObject(assessment)) throw new Error(`Group assessment ${index + 1} kh\xF4ng h\u1EE3p l\u1EC7.`);
    exactKeys(assessment, ["groupId", "cueIds", "status", "reason"]);
    const groupId = typeof assessment.groupId === "string" ? assessment.groupId.trim() : "";
    const cueIds = Array.isArray(assessment.cueIds) ? assessment.cueIds.map((id) => String(id).trim()) : [];
    const groupStatus = assessment.status;
    const reason = typeof assessment.reason === "string" ? assessment.reason.trim() : "";
    if (!groupId || groupIds.has(groupId) || cueIds.length === 0 || new Set(cueIds).size !== cueIds.length || cueIds.some((id) => !idSet.has(id) || assigned.has(id)) || !REVIEW_STATUSES.has(groupStatus) || !reason) throw new Error(`Group assessment ${index + 1} kh\xF4ng bao ph\u1EE7 cue h\u1EE3p l\u1EC7.`);
    groupIds.add(groupId);
    for (const id of cueIds) assigned.add(id);
    const normalized = { groupId, cueIds, status: groupStatus, reason };
    groupById.set(groupId, normalized);
    return normalized;
  });
  if (assigned.size !== ids.length) throw new Error("Group assessments kh\xF4ng bao ph\u1EE7 to\xE0n b\u1ED9 cue.");
  const evidence = /* @__PURE__ */ new Map();
  const pack = getEvidencePack(expectedIdsOrPack);
  if (pack) for (const item of pack.items) evidence.set(item.id, item);
  if (!Array.isArray(obj.findings)) throw new Error("Restoration review thi\u1EBFu findings.");
  const findings = obj.findings.map((finding, index) => {
    if (!isPlainObject(finding)) throw new Error(`Finding ${index + 1} kh\xF4ng h\u1EE3p l\u1EC7.`);
    exactKeys(finding, ["code", "severity", "cueIds", "evidenceRefs", "note", "resolution"]);
    const cueIds = Array.isArray(finding.cueIds) ? finding.cueIds.map((id) => String(id).trim()) : [];
    if (!nonEmptyString(finding.code) || finding.severity !== "error" && finding.severity !== "warning" || cueIds.some((id) => !idSet.has(id)) || !nonEmptyString(finding.note) || finding.resolution !== "patched" && finding.resolution !== "unresolved") throw new Error(`Finding ${index + 1} kh\xF4ng h\u1EE3p l\u1EC7.`);
    const refs = Array.isArray(finding.evidenceRefs) ? finding.evidenceRefs.map((ref) => String(ref).trim()) : [];
    if (refs.some((ref) => !evidence.has(ref))) throw new Error(`Finding ${index + 1} tham chi\u1EBFu evidence kh\xF4ng t\u1ED3n t\u1EA1i.`);
    return { code: finding.code.trim(), severity: finding.severity, cueIds, evidenceRefs: refs, note: finding.note.trim(), resolution: finding.resolution };
  });
  if (!Array.isArray(obj.replacements)) throw new Error("Restoration review thi\u1EBFu replacements.");
  const replacementGroups = /* @__PURE__ */ new Set();
  const replacements = obj.replacements.map((replacement, index) => {
    if (!isPlainObject(replacement)) throw new Error(`Replacement ${index + 1} kh\xF4ng h\u1EE3p l\u1EC7.`);
    exactKeys(replacement, ["groupId", "sourceEdits", "items", "sentenceEndIds"], ["groupId", "sourceEdits", "items"]);
    const groupId = typeof replacement.groupId === "string" ? replacement.groupId.trim() : "";
    const group = groupById.get(groupId);
    if (!group || replacementGroups.has(groupId) || group.status !== "needs_adjustment") throw new Error(`Replacement ${index + 1} kh\xF4ng thu\u1ED9c nh\xF3m needs_adjustment h\u1EE3p l\u1EC7.`);
    const groupSet = new Set(group.cueIds);
    const items = validateItems(replacement.items, group.cueIds, `Replacement ${index + 1}`);
    if (!Array.isArray(replacement.sourceEdits)) throw new Error(`Replacement ${index + 1} thi\u1EBFu sourceEdits.`);
    const sourceEdits = replacement.sourceEdits.map((edit, editIndex) => validateSourceEdit(edit, idSet, evidence, `Replacement ${index + 1} source edit ${editIndex + 1}`, groupSet));
    if (new Set(sourceEdits.map((edit) => edit.id)).size !== sourceEdits.length) throw new Error(`Replacement ${index + 1} c\xF3 source edit tr\xF9ng.`);
    const sentenceEndIds = replacement.sentenceEndIds === void 0 ? void 0 : (() => {
      if (!Array.isArray(replacement.sentenceEndIds) || replacement.sentenceEndIds.some((id) => !nonEmptyString(id))) throw new Error(`Replacement ${index + 1} c\xF3 sentenceEndIds kh\xF4ng h\u1EE3p l\u1EC7.`);
      const normalized = replacement.sentenceEndIds.map((id) => id.trim());
      if (new Set(normalized).size !== normalized.length || normalized.some((id) => !groupSet.has(id))) throw new Error(`Replacement ${index + 1} c\xF3 sentenceEndIds ngo\xE0i nh\xF3m.`);
      return normalized;
    })();
    replacementGroups.add(groupId);
    return { groupId, sourceEdits, items, ...sentenceEndIds ? { sentenceEndIds } : {} };
  });
  const groupStatuses = new Set(groupAssessments.map((item) => item.status));
  if (groupStatuses.has("rejected") && status !== "rejected" || !groupStatuses.has("rejected") && groupStatuses.has("needs_adjustment") && status !== "needs_adjustment" || !groupStatuses.has("rejected") && !groupStatuses.has("needs_adjustment") && status !== "approved") throw new Error("Restoration review c\xF3 status t\u1ED5ng kh\xF4ng kh\u1EDBp group assessments.");
  if (groupAssessments.filter((group) => group.status === "needs_adjustment").some((group) => !replacementGroups.has(group.groupId))) throw new Error("Restoration review needs_adjustment thi\u1EBFu replacement nguy\xEAn nh\xF3m.");
  if (groupStatuses.has("rejected") && replacements.length > 0) throw new Error("Restoration review rejected kh\xF4ng \u0111\u01B0\u1EE3c xu\u1EA5t replacement.");
  return {
    schemaVersion: "restoration-review-v1",
    candidateDigest,
    reviewedCueIds,
    status,
    confidenceScore: obj.confidenceScore,
    reviewerNotes: obj.reviewerNotes.trim(),
    groupAssessments,
    findings,
    replacements
  };
}
function applyRestorationPipeline(params) {
  const source = normalizedCues(params.cues);
  const ids = source.map((cue) => cue.id);
  const idSet = new Set(ids);
  if (params.draft.items.length !== ids.length || new Set(params.draft.items.map((item) => item.id)).size !== ids.length || params.draft.items.some((item) => !idSet.has(item.id) || !item.target.trim())) throw new Error("Draft kh\xF4ng c\xF3 t\u1EADp target 1:1 h\u1EE3p l\u1EC7 \u0111\u1EC3 xu\u1EA5t b\u1EA3n.");
  if (params.review.status === "rejected" || params.review.groupAssessments.some((group) => group.status === "rejected")) throw new Error("Restoration review rejected; kh\xF4ng xu\u1EA5t b\u1EA3n source edit hay target translation c\u1EE7a nh\xF3m b\u1ECB t\u1EEB ch\u1ED1i.");
  const groupOwners = /* @__PURE__ */ new Map();
  for (const group of params.review.groupAssessments) {
    if (!group.groupId || group.cueIds.length === 0 || !REVIEW_STATUSES.has(group.status)) throw new Error("Review group kh\xF4ng h\u1EE3p l\u1EC7.");
    for (const id of group.cueIds) {
      if (!idSet.has(id) || groupOwners.has(id)) throw new Error("Review group kh\xF4ng bao ph\u1EE7 cue 1:1.");
      groupOwners.set(id, group);
    }
  }
  if (groupOwners.size !== ids.length) throw new Error("Review group kh\xF4ng bao ph\u1EE7 to\xE0n b\u1ED9 cue.");
  const replacementByGroup = new Map(params.review.replacements.map((replacement) => [replacement.groupId, replacement]));
  const sourceMap = new Map(params.cues.map((cue) => [cue.id.trim(), { ...cue }]));
  const draftItems = new Map(params.draft.items.map((item) => [item.id, item.target]));
  const draftEdits = new Map(params.draft.sourceEdits.map((edit) => [edit.id, edit]));
  const translated = /* @__PURE__ */ new Map();
  const appliedEdits = [];
  let groupPatchesApplied = 0;
  let sentenceEnds = new Set(params.draft.sentenceEndIds);
  for (const group of params.review.groupAssessments) {
    if (group.status === "approved") {
      for (const id of group.cueIds) {
        const target = draftItems.get(id);
        if (!target) throw new Error(`Draft thi\u1EBFu target cho ${id}.`);
        translated.set(id, target);
        const edit = draftEdits.get(id);
        if (edit) {
          sourceMap.get(id).text = edit.text;
          appliedEdits.push(edit);
        }
      }
      continue;
    }
    const replacement = replacementByGroup.get(group.groupId);
    if (!replacement) throw new Error(`Nh\xF3m ${group.groupId} c\u1EA7n adjustment nh\u01B0ng kh\xF4ng c\xF3 replacement nguy\xEAn kh\u1ED1i.`);
    const replacementIds = replacement.items.map((item) => item.id);
    if (replacementIds.length !== group.cueIds.length || new Set(replacementIds).size !== replacementIds.length || replacementIds.some((id) => !group.cueIds.includes(id)) || replacement.items.some((item) => !item.target.trim())) throw new Error(`Replacement nh\xF3m ${group.groupId} kh\xF4ng \u0111\u1EA7y \u0111\u1EE7; kh\xF4ng \xE1p d\u1EE5ng patch m\u1ED9t ph\u1EA7n.`);
    for (const item of replacement.items) translated.set(item.id, item.target);
    for (const edit of replacement.sourceEdits) {
      if (!group.cueIds.includes(edit.id) || !edit.text.trim()) throw new Error(`Replacement nh\xF3m ${group.groupId} ch\u1EE9a source edit ngo\xE0i nh\xF3m.`);
      sourceMap.get(edit.id).text = edit.text;
      appliedEdits.push(edit);
    }
    if (replacement.sentenceEndIds) {
      for (const id of group.cueIds) sentenceEnds.delete(id);
      for (const id of replacement.sentenceEndIds) sentenceEnds.add(id);
    }
    groupPatchesApplied++;
  }
  if (translated.size !== ids.length || ids.some((id) => !translated.get(id)?.trim())) throw new Error("Restoration kh\xF4ng t\u1EA1o \u0111\u1EE7 target translation; kh\xF4ng copy source l\xE0m fallback.");
  const restoredCues = params.cues.map((cue) => sourceMap.get(cue.id.trim()));
  const translatedItems = ids.map((id) => ({ id, target: translated.get(id), isSentenceEnd: sentenceEnds.has(id) }));
  const finalTranslationItems = translatedItems.map((item) => ({ id: item.id, text: item.target }));
  return {
    restoredCues,
    restoredSourceCues: restoredCues,
    translatedItems,
    finalTranslationItems,
    appliedEdits,
    groupPatchesApplied,
    metrics: {
      totalCues: source.length,
      knownErrorsEvaluated: null,
      fixedAsrErrors: null,
      corruptedCleanCues: null,
      droppedCues: 0,
      cueIdIntegrity: restoredCues.every((cue, index) => cue.id === params.cues[index].id),
      timestampsIntegrity: restoredCues.every((cue, index) => cue.start === params.cues[index].start && cue.end === params.cues[index].end),
      accuracyRate: null,
      sourceEditsCount: appliedEdits.length,
      appliedReplacementsCount: groupPatchesApplied,
      findingsCount: params.review.findings.length,
      cueCountPreserved: finalTranslationItems.length === source.length
    }
  };
}

// src/main/geminiGatewayRestoration.ts
var GATEWAY_RESTORATION_PROMPT_VERSION = "gateway-restoration-media-v2";
var GATEWAY_RESTORATION_PARSER_VERSION = "gateway-restoration-parser-v1";
var RESTORATION_DRAFT_FILE = "restoration-draft-v1.json";
var RESTORATION_REVIEW_FILE = "restoration-review-v1.json";
var MAX_STAGE_RECORD_BYTES = 2 * 1024 * 1024;
var MIN_RESTORATION_OUTPUT_TOKENS = 2048;
var MAX_RESTORATION_OUTPUT_TOKENS = 8192;
var MAX_RESTORATION_CUES_PER_CHUNK = 8;
function calculateRestorationOutputTokenLimit(cueCount) {
  const safeCount = Number.isSafeInteger(cueCount) && cueCount > 0 ? cueCount : 1;
  return Math.min(MAX_RESTORATION_OUTPUT_TOKENS, Math.max(MIN_RESTORATION_OUTPUT_TOKENS, 1024 + safeCount * 128));
}
function partitionRestorationCues(cues) {
  const chunks = [];
  for (let offset = 0; offset < cues.length; offset += MAX_RESTORATION_CUES_PER_CHUNK) {
    chunks.push(cues.slice(offset, offset + MAX_RESTORATION_CUES_PER_CHUNK).map((cue) => ({ ...cue })));
  }
  return chunks;
}
var SOURCE_EDIT_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string" },
    text: { type: "string" },
    kind: { type: "string", enum: ["homophone", "ocr_alignment", "entity", "semantic"] },
    evidenceRefs: { type: "array", items: { type: "string" }, minItems: 1, uniqueItems: true }
  },
  required: ["id", "text", "kind", "evidenceRefs"],
  additionalProperties: false
};
var RESTORATION_DRAFT_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "restoration_translation_v1",
    strict: true,
    schema: {
      type: "object",
      properties: {
        schemaVersion: { type: "string", const: "restoration-translation-v1" },
        evidenceDigest: { type: "string" },
        sourceEdits: { type: "array", items: SOURCE_EDIT_SCHEMA },
        sentenceEndIds: { type: "array", items: { type: "string" }, uniqueItems: true },
        entities: {
          type: "array",
          items: {
            type: "object",
            properties: {
              source: { type: "string" },
              target: { type: "string" },
              sourceCueIds: { type: "array", items: { type: "string" }, minItems: 1, uniqueItems: true },
              evidenceRefs: { type: "array", items: { type: "string" }, uniqueItems: true }
            },
            required: ["source", "target", "sourceCueIds", "evidenceRefs"],
            additionalProperties: false
          }
        },
        synopsis: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { id: { type: "string" }, target: { type: "string" } },
            required: ["id", "target"],
            additionalProperties: false
          }
        }
      },
      required: ["schemaVersion", "evidenceDigest", "sourceEdits", "sentenceEndIds", "entities", "items"],
      additionalProperties: false
    }
  }
};
var RESTORATION_REVIEW_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "restoration_review_v1",
    strict: true,
    schema: {
      type: "object",
      properties: {
        schemaVersion: { type: "string", const: "restoration-review-v1" },
        candidateDigest: { type: "string" },
        reviewedCueIds: { type: "array", items: { type: "string" }, uniqueItems: true },
        status: { type: "string", enum: ["approved", "needs_adjustment", "rejected"] },
        confidenceScore: { type: "number", minimum: 0, maximum: 1 },
        reviewerNotes: { type: "string" },
        groupAssessments: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            properties: {
              groupId: { type: "string" },
              cueIds: { type: "array", items: { type: "string" }, minItems: 1, uniqueItems: true },
              status: { type: "string", enum: ["approved", "needs_adjustment", "rejected"] },
              reason: { type: "string" }
            },
            required: ["groupId", "cueIds", "status", "reason"],
            additionalProperties: false
          }
        },
        findings: {
          type: "array",
          items: {
            type: "object",
            properties: {
              code: { type: "string" },
              severity: { type: "string", enum: ["error", "warning"] },
              cueIds: { type: "array", items: { type: "string" }, uniqueItems: true },
              evidenceRefs: { type: "array", items: { type: "string" }, uniqueItems: true },
              note: { type: "string" },
              resolution: { type: "string", enum: ["patched", "unresolved"] }
            },
            required: ["code", "severity", "cueIds", "evidenceRefs", "note", "resolution"],
            additionalProperties: false
          }
        },
        replacements: {
          type: "array",
          items: {
            type: "object",
            properties: {
              groupId: { type: "string" },
              sourceEdits: { type: "array", items: SOURCE_EDIT_SCHEMA },
              items: {
                type: "array",
                items: {
                  type: "object",
                  properties: { id: { type: "string" }, target: { type: "string" } },
                  required: ["id", "target"],
                  additionalProperties: false
                }
              },
              sentenceEndIds: { type: "array", items: { type: "string" }, uniqueItems: true }
            },
            required: ["groupId", "sourceEdits", "items"],
            additionalProperties: false
          }
        }
      },
      required: ["schemaVersion", "candidateDigest", "reviewedCueIds", "status", "confidenceScore", "reviewerNotes", "groupAssessments", "findings", "replacements"],
      additionalProperties: false
    }
  }
};
function sha2562(value) {
  return (0, import_node_crypto5.createHash)("sha256").update(value).digest("hex");
}
function evidenceForChunk(evidence, cues) {
  const cueIds = new Set(cues.map((cue) => cue.id.trim()));
  const normalizedCues2 = cues.map((cue) => ({ id: cue.id.trim(), text: cue.text.trim(), start: cue.start, end: cue.end }));
  const items = evidence.items.flatMap((item) => {
    const matchingCueIds2 = item.matchingCueIds.filter((id) => cueIds.has(id));
    return matchingCueIds2.length > 0 ? [{ ...item, matchingCueIds: matchingCueIds2 }] : [];
  });
  const itemIds = new Set(items.map((item) => item.id));
  const ocrEvidence = evidence.ocrEvidence.filter((item) => itemIds.has(item.id)).map((item) => ({ ...item }));
  const glossary = evidence.glossary?.map((entry) => ({ ...entry })) || [];
  const digest = sha2562(JSON.stringify({
    schemaVersion: 1,
    cues: normalizedCues2,
    ocrEvidence,
    audioMeta: evidence.audioMeta,
    glossary
  }));
  return {
    schemaVersion: 1,
    evidenceDigest: digest,
    digest,
    cues: normalizedCues2,
    ocrEvidence,
    items,
    ...evidence.audioMeta ? { audioMeta: { ...evidence.audioMeta } } : {},
    ...glossary.length > 0 ? { glossary } : {}
  };
}
function validSha(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/iu.test(value);
}
function calculateGatewayRestorationIdentity(input) {
  return sha2562(JSON.stringify({
    mediaDigest: input.mediaDigest,
    sourceLanguage: input.sourceLanguage.trim() || "auto",
    targetLocale: input.targetLocale.trim(),
    mode: input.mode,
    glossary: input.glossary.map((entry) => ({ source: entry.source, target: entry.target })),
    synopsis: input.synopsis?.trim() || "",
    promptVersion: GATEWAY_RESTORATION_PROMPT_VERSION,
    parserVersion: GATEWAY_RESTORATION_PARSER_VERSION,
    cues: input.sourceCues.map((cue) => ({ id: cue.id, start: cue.start, end: cue.end, text: cue.text }))
  }));
}
function draftMessages(input, evidence) {
  const ids = input.sourceCues.map((cue) => cue.id);
  const payload = buildRestorationDraftPayload({
    evidencePack: evidence,
    targetLang: input.targetLocale,
    cues: input.sourceCues,
    synopsis: input.synopsis
  });
  const system = [
    `gateway_restoration_prompt_version=${GATEWAY_RESTORATION_PROMPT_VERSION}`,
    `task=audio-ocr-grounded-restoration-and-translation; source_language=${input.sourceLanguage || "auto"}; target_locale=${input.targetLocale}; mode=${input.mode}`,
    "Return exactly one JSON object and no Markdown or prose.",
    "The local cue IDs and timestamps are immutable. Return each requested ID exactly once; never add, delete, merge, or reorder IDs.",
    "Correct a source cue only when at least one local OCR/audio/glossary evidence reference supports that cue. Every source edit needs non-empty evidenceRefs; do not guess brands, numbers, names, units, negation, places, or facts.",
    "Produce schemaVersion=restoration-translation-v1 with exact evidenceDigest, sourceEdits, sentenceEndIds, entities, and items. Every sourceEdits entry has exactly {id,text,kind,evidenceRefs}: use id (never cueId), kind is homophone|ocr_alignment|entity|semantic, and evidenceRefs is non-empty. Every item has exactly {id,target}, and target must be non-empty target-language text.",
    `Requested cue IDs: ${JSON.stringify(ids)}`
  ].join("\n");
  return [
    { role: "system", content: system },
    {
      role: "user",
      content: [
        { type: "text", text: payload },
        { type: "input_audio", input_audio: { data: input.audio.data.toString("base64"), format: input.audio.format } }
      ]
    }
  ];
}
function reviewMessages(input, evidence, draft) {
  const ids = input.sourceCues.map((cue) => cue.id);
  const payload = buildRestorationReviewPayload({ evidencePack: evidence, targetLang: input.targetLocale, draft, synopsis: input.synopsis });
  const system = [
    `gateway_restoration_prompt_version=${GATEWAY_RESTORATION_PROMPT_VERSION}`,
    `task=independent-audio-ocr-restoration-review; target_locale=${input.targetLocale}`,
    "You are a fresh reviewer. Return exactly one JSON object and no Markdown or prose.",
    "Verify the candidate against the attached source audio and timestamped OCR/glossary evidence. Do not approve an unsupported source edit.",
    "Produce schemaVersion=restoration-review-v1 with exact candidateDigest, exact reviewedCueIds, explicit status, confidenceScore 0..1, reviewerNotes, groupAssessments, findings and replacements. Every replacement sourceEdits entry has exactly {id,text,kind,evidenceRefs}: use id (never cueId), kind is homophone|ocr_alignment|entity|semantic, and evidenceRefs is non-empty.",
    "Every cue must appear in exactly one group. A needs_adjustment group must include a full replacement for every cue in that group. A rejected group must not return a replacement.",
    `Requested cue IDs: ${JSON.stringify(ids)}`
  ].join("\n");
  return [
    { role: "system", content: system },
    {
      role: "user",
      content: [
        { type: "text", text: payload },
        { type: "input_audio", input_audio: { data: input.audio.data.toString("base64"), format: input.audio.format } }
      ]
    }
  ];
}
function stagePayloadSha(messages, responseFormat, maxOutputTokens) {
  return sha2562(JSON.stringify(createGatewayRequestBody(messages, maxOutputTokens, false, "json-items", responseFormat)));
}
function stageRecordPath(dir, stage) {
  return (0, import_node_path4.join)(dir, stage === "restoration-draft" ? RESTORATION_DRAFT_FILE : RESTORATION_REVIEW_FILE);
}
function leasePath(dir, stage) {
  return (0, import_node_path4.join)(dir, `${stage}-operation.json`);
}
async function writeDurableJson2(path, value) {
  await (0, import_promises4.mkdir)((0, import_node_path4.dirname)(path), { recursive: true });
  const temporary = `${path}.${(0, import_node_crypto5.randomUUID)()}.tmp`;
  let handle;
  try {
    handle = await (0, import_promises4.open)(temporary, "wx");
    await handle.writeFile(JSON.stringify(value, null, 2), "utf8");
    await handle.sync();
    await handle.close();
    handle = void 0;
    await (0, import_promises4.rename)(temporary, path);
  } finally {
    await handle?.close().catch(() => {
    });
    await (0, import_promises4.rm)(temporary, { force: true }).catch(() => {
    });
  }
}
function isValidStageRecord(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value;
  return record.schemaVersion === 1 && record.state === "validated" && record.stage === expected.stage && record.identity === expected.identity && record.routeFingerprint === expected.routeFingerprint && record.evidenceDigest === expected.evidenceDigest && Array.isArray(record.expectedIds) && record.expectedIds.length === expected.expectedIds.length && record.expectedIds.every((id, index) => id === expected.expectedIds[index]) && record.targetLocale === expected.targetLocale && record.promptVersion === expected.promptVersion && record.parserVersion === expected.parserVersion && typeof record.raw === "string" && Buffer.byteLength(record.raw, "utf8") > 0 && Buffer.byteLength(record.raw, "utf8") <= MAX_STAGE_RECORD_BYTES && validSha(record.rawSha256) && sha2562(record.raw) === record.rawSha256 && typeof record.observedModelId === "string" && record.observedModelId.trim().length > 0 && (record.observedModel === null || typeof record.observedModel === "string") && typeof record.savedAtUtc === "string" && Number.isFinite(Date.parse(record.savedAtUtc));
}
async function readStageRecord(dir, expected) {
  if (!(0, import_node_path4.isAbsolute)(dir)) return null;
  try {
    const raw = await (0, import_promises4.readFile)(stageRecordPath(dir, expected.stage), "utf8");
    if (Buffer.byteLength(raw, "utf8") > MAX_STAGE_RECORD_BYTES) return null;
    const parsed = JSON.parse(raw);
    return isValidStageRecord(parsed, expected) ? parsed : null;
  } catch {
    return null;
  }
}
async function acknowledgeRecordedLease(baseUrl, dir, stage, payloadSha256) {
  try {
    const raw = await (0, import_promises4.readFile)(leasePath(dir, stage), "utf8");
    const lease = JSON.parse(raw);
    if (lease.schemaVersion !== 1 || lease.stage !== stage || lease.payloadSha256 !== payloadSha256 || !validSha(lease.payloadSha256) || typeof lease.operationId !== "string" || !lease.operationId.trim() || typeof lease.operationToken !== "string" || !lease.operationToken.trim() || typeof lease.clientRequestId !== "string" || !lease.clientRequestId.trim()) {
      await (0, import_promises4.unlink)(leasePath(dir, stage)).catch(() => {
      });
      return;
    }
    await ackGatewayOperation(baseUrl, lease.operationId, lease.operationToken);
    await (0, import_promises4.unlink)(leasePath(dir, stage));
  } catch (error) {
    if (error?.code !== "ENOENT") return;
  }
}
async function executeStage(input) {
  const maxOutputTokens = calculateRestorationOutputTokenLimit(input.expected.expectedIds.length);
  const payloadSha256 = stagePayloadSha(input.messages, input.responseFormat, maxOutputTokens);
  const existing = await readStageRecord(input.draftDir, input.expected);
  if (existing) {
    try {
      input.validate(existing.raw);
      await acknowledgeRecordedLease(input.baseUrl, input.draftDir, input.stage, payloadSha256);
      return { raw: existing.raw, observedModelId: existing.observedModelId, ...existing.observedModel ? { observedModel: existing.observedModel } : {} };
    } catch (error) {
      await (0, import_promises4.rm)(stageRecordPath(input.draftDir, input.stage), { force: true }).catch(() => {
      });
      if (error?.providerCode === "provider-protocol") throw error;
    }
  }
  const execution = await requestGatewayOperation(
    input.baseUrl,
    input.messages,
    input.signal,
    maxOutputTokens,
    false,
    "json-items",
    {
      draftDir: input.draftDir,
      stage: input.stage,
      httpTimeoutMs: GATEWAY_STAGE_TIMEOUT_MS,
      deferOnWaitingProvider: true,
      maxRequestBodyBytes: input.maxRequestBodyBytes,
      responseFormat: input.responseFormat
    }
  );
  try {
    input.validate(execution.completion.raw);
  } catch (validationError) {
    await execution.ack().catch(() => {
    });
    throw validationError;
  }
  const record = {
    schemaVersion: 1,
    state: "validated",
    ...input.expected,
    raw: execution.completion.raw,
    rawSha256: sha2562(execution.completion.raw),
    observedModelId: execution.completion.observedModelId,
    observedModel: execution.completion.observedModel || null,
    savedAtUtc: (/* @__PURE__ */ new Date()).toISOString()
  };
  await writeDurableJson2(stageRecordPath(input.draftDir, input.stage), record);
  await execution.ack();
  return { raw: record.raw, observedModelId: record.observedModelId, ...record.observedModel ? { observedModel: record.observedModel } : {} };
}
function stageExpectation(stage, identity, routeFingerprint, evidenceDigest, expectedIds2, targetLocale) {
  return {
    stage,
    identity,
    routeFingerprint,
    evidenceDigest,
    expectedIds: expectedIds2,
    targetLocale,
    promptVersion: GATEWAY_RESTORATION_PROMPT_VERSION,
    parserVersion: GATEWAY_RESTORATION_PARSER_VERSION
  };
}
async function executeRestorationChunk(input, capabilities, evidence, identity, draftDir) {
  const expectedIds2 = input.sourceCues.map((cue) => cue.id.trim());
  const draftStage = stageExpectation("restoration-draft", identity, capabilities.routeFingerprint, evidence.evidenceDigest, expectedIds2, input.targetLocale);
  const draftResult = await executeStage({
    baseUrl: input.baseUrl,
    messages: draftMessages(input, evidence),
    stage: "restoration-draft",
    signal: input.signal,
    draftDir,
    maxRequestBodyBytes: capabilities.maxRequestBodyBytes,
    expected: draftStage,
    validate: (raw) => {
      validateRestorationDraft(raw, input.sourceCues, evidence);
    },
    responseFormat: RESTORATION_DRAFT_RESPONSE_FORMAT
  });
  const draft = validateRestorationDraft(draftResult.raw, input.sourceCues, evidence);
  const candidateDigest = calculateRestorationCandidateDigest(draft);
  const reviewStage = stageExpectation("restoration-review", identity, capabilities.routeFingerprint, evidence.evidenceDigest, expectedIds2, input.targetLocale);
  const reviewResult = await executeStage({
    baseUrl: input.baseUrl,
    messages: reviewMessages(input, evidence, draft),
    stage: "restoration-review",
    signal: input.signal,
    draftDir,
    maxRequestBodyBytes: capabilities.maxRequestBodyBytes,
    expected: reviewStage,
    validate: (raw) => {
      validateRestorationReview(raw, draft, evidence);
    },
    responseFormat: RESTORATION_REVIEW_RESPONSE_FORMAT
  });
  const review = validateRestorationReview(reviewResult.raw, draft, evidence);
  applyRestorationPipeline({ cues: input.sourceCues, draft, review });
  return { evidence, draft, review, reviewDigest: sha2562(reviewResult.raw) };
}
function combineRestorationChunks(input, evidence, chunks) {
  const draftCandidate = {
    schemaVersion: "restoration-translation-v1",
    evidenceDigest: evidence.evidenceDigest,
    sourceEdits: chunks.flatMap((chunk) => chunk.draft.sourceEdits),
    sentenceEndIds: chunks.flatMap((chunk) => chunk.draft.sentenceEndIds),
    entities: chunks.flatMap((chunk) => chunk.draft.entities),
    ...input.synopsis?.trim() ? { synopsis: input.synopsis.trim() } : {},
    items: chunks.flatMap((chunk) => chunk.draft.items)
  };
  const draft = validateRestorationDraft(JSON.stringify(draftCandidate), input.sourceCues, evidence);
  const candidateDigest = calculateRestorationCandidateDigest(draft);
  const groupAssessments = chunks.flatMap((chunk, chunkIndex) => chunk.review.groupAssessments.map((group) => ({
    ...group,
    groupId: `chunk-${String(chunkIndex + 1).padStart(3, "0")}-${group.groupId}`
  })));
  const replacements = chunks.flatMap((chunk, chunkIndex) => chunk.review.replacements.map((replacement) => ({
    ...replacement,
    groupId: `chunk-${String(chunkIndex + 1).padStart(3, "0")}-${replacement.groupId}`
  })));
  const status = groupAssessments.some((group) => group.status === "needs_adjustment") ? "needs_adjustment" : "approved";
  const reviewCandidate = {
    schemaVersion: "restoration-review-v1",
    candidateDigest,
    reviewedCueIds: input.sourceCues.map((cue) => cue.id.trim()),
    status,
    confidenceScore: Math.min(...chunks.map((chunk) => chunk.review.confidenceScore)),
    reviewerNotes: chunks.map((chunk, index) => `[chunk-${String(index + 1).padStart(3, "0")}] ${chunk.review.reviewerNotes}`).join("\n"),
    groupAssessments,
    findings: chunks.flatMap((chunk) => chunk.review.findings),
    replacements
  };
  const review = validateRestorationReview(JSON.stringify(reviewCandidate), draft, evidence);
  const applied = applyRestorationPipeline({ cues: input.sourceCues, draft, review });
  return {
    draft,
    review,
    restoredSourceCues: applied.restoredSourceCues,
    translatedItems: applied.finalTranslationItems,
    metrics: applied.metrics,
    candidateDigest,
    reviewDigest: sha2562(JSON.stringify(review))
  };
}
async function runGatewayRestoration(input) {
  if (!(0, import_node_path4.isAbsolute)(input.draftDir)) throw new Error("Gateway restoration draftDir ph\u1EA3i l\xE0 \u0111\u01B0\u1EDDng d\u1EABn tuy\u1EC7t \u0111\u1ED1i.");
  const capabilities = input.capabilities || await readGatewayCapabilitiesInfo(input.baseUrl, input.signal);
  if (!capabilities.schedulerSupported) throw Object.assign(new Error("Gemini Gateway kh\xF4ng h\u1ED7 tr\u1EE3 Operation API; kh\xF4ng ch\u1EA1y media restoration ngo\xE0i governor."), { providerCode: "provider-protocol" });
  if (!capabilities.maxRequestBodyBytes) throw Object.assign(new Error("Gemini Gateway kh\xF4ng c\xF4ng b\u1ED1 max_request_body_bytes; kh\xF4ng g\u1EEDi audio media."), { providerCode: "provider-protocol" });
  const identity = calculateGatewayRestorationIdentity(input);
  const evidence = buildSourceEvidencePack({
    cues: input.sourceCues,
    ocrFrames: input.ocrFrames,
    audioMeta: {
      durationSeconds: input.audio.durationSeconds,
      sampleRate: input.audio.sampleRate,
      channels: input.audio.channels,
      format: input.audio.format,
      sha256: input.audio.sha256
    },
    glossary: input.glossary
  });
  const cueChunks = partitionRestorationCues(input.sourceCues);
  if (cueChunks.length === 0) throw new Error("Gateway restoration c\u1EA7n \xEDt nh\u1EA5t m\u1ED9t cue ngu\u1ED3n.");
  const executed = [];
  for (let index = 0; index < cueChunks.length; index++) {
    const sourceCues = cueChunks[index];
    const chunkEvidence = cueChunks.length === 1 ? evidence : evidenceForChunk(evidence, sourceCues);
    const chunkIdentity = cueChunks.length === 1 ? identity : sha2562(JSON.stringify({ identity, index, evidenceDigest: chunkEvidence.evidenceDigest, cueIds: sourceCues.map((cue) => cue.id.trim()) }));
    const chunkDir = cueChunks.length === 1 ? input.draftDir : (0, import_node_path4.join)(input.draftDir, `chunk-${String(index + 1).padStart(3, "0")}`);
    executed.push(await executeRestorationChunk({ ...input, sourceCues }, capabilities, chunkEvidence, chunkIdentity, chunkDir));
  }
  const combined = cueChunks.length === 1 ? (() => {
    const chunk = executed[0];
    const applied = applyRestorationPipeline({ cues: input.sourceCues, draft: chunk.draft, review: chunk.review });
    return {
      draft: chunk.draft,
      review: chunk.review,
      restoredSourceCues: applied.restoredSourceCues,
      translatedItems: applied.finalTranslationItems,
      metrics: applied.metrics,
      candidateDigest: calculateRestorationCandidateDigest(chunk.draft),
      reviewDigest: chunk.reviewDigest
    };
  })() : combineRestorationChunks(input, evidence, executed);
  return {
    identity,
    routeFingerprint: capabilities.routeFingerprint,
    evidence,
    ...combined
  };
}

// src/main/gatewayManualRecovery.ts
var import_promises5 = require("node:fs/promises");
var import_node_crypto6 = require("node:crypto");
var import_node_path5 = require("node:path");
async function findOperationLease(draftDir, wait) {
  const fileName = `${wait.stage}-operation.json`;
  const candidateDirs = [draftDir];
  const entries = await (0, import_promises5.readdir)(draftDir, { withFileTypes: true }).catch(() => []);
  candidateDirs.push(...entries.filter((entry) => entry.isDirectory() && /^chunk-\d{3}$/u.test(entry.name)).map((entry) => (0, import_node_path5.join)(draftDir, entry.name)));
  for (const candidateDir of candidateDirs) {
    const names = await (0, import_promises5.readdir)(candidateDir).catch(() => []);
    if (!names.includes(fileName)) continue;
    const path = await assertContainedRegularFile((0, import_node_path5.join)(candidateDir, fileName), draftDir, "Gateway operation lease");
    const lease = JSON.parse(await (0, import_promises5.readFile)(path, "utf8"));
    if (lease.schemaVersion === 1 && lease.stage === wait.stage && lease.operationId === wait.operationId) return { path, lease };
  }
  throw new Error("Operation c\u1EA7n ph\u1EE5c h\u1ED3i kh\xF4ng kh\u1EDBp checkpoint.");
}
async function recoverUnknownGatewayOperation(baseUrl, draftDir, wait) {
  if (wait.reason !== "outcome-unknown") throw new Error("Ch\u1EC9 ph\u1EE5c h\u1ED3i th\u1EE7 c\xF4ng operation ch\u01B0a r\xF5 k\u1EBFt qu\u1EA3.");
  if (!["restore-translate", "independent-review", "restoration-draft", "restoration-review", "rephrase", "metadata"].includes(wait.stage)) {
    throw new Error("Gateway recovery stage kh\xF4ng h\u1EE3p l\u1EC7.");
  }
  const located = await findOperationLease(draftDir, wait);
  const leasePath2 = located.path;
  const lease = located.lease;
  if (lease.schemaVersion !== 1 || lease.stage !== wait.stage || lease.operationId !== wait.operationId || typeof lease.operationToken !== "string" || !lease.operationToken || typeof lease.clientRequestId !== "string" || !lease.clientRequestId) {
    throw new Error("Operation c\u1EA7n ph\u1EE5c h\u1ED3i kh\xF4ng kh\u1EDBp checkpoint.");
  }
  const signal = AbortSignal.timeout(3e4);
  const { receipt } = await getGatewayOperation({
    baseUrl,
    operationId: lease.operationId,
    operationToken: lease.operationToken,
    expectedClientRequestId: lease.clientRequestId,
    signal
  });
  if (receipt.status === "succeeded") return;
  if (receipt.status !== "outcome-unknown") throw new Error("Operation \u0111\xE3 thay \u0111\u1ED5i tr\u1EA1ng th\xE1i; h\xE3y t\u1EA3i l\u1EA1i batch tr\u01B0\u1EDBc khi ti\u1EBFp t\u1EE5c.");
  const scheduler = await getGatewaySchedulerStatus(baseUrl, signal);
  if (scheduler.activePermits !== 0 || scheduler.queuedRequests !== 0 || scheduler.state === "blocked" && !["outcome-unknown", "recovered-from-store"].includes(scheduler.reason || "")) {
    throw new Error("Gateway \u0111ang b\u1EADn ho\u1EB7c b\u1ECB kh\xF3a v\xEC l\xFD do kh\xE1c; ch\u01B0a th\u1EC3 th\u1EED l\u1EA1i operation n\xE0y.");
  }
  if (scheduler.state === "blocked" && !await resetGatewayScheduler(baseUrl, signal)) throw new Error("Kh\xF4ng kh\xF4i ph\u1EE5c \u0111\u01B0\u1EE3c Gateway.");
  await ackGatewayOperation(baseUrl, lease.operationId, lease.operationToken);
  await (0, import_promises5.rename)(leasePath2, (0, import_node_path5.join)((0, import_node_path5.dirname)(leasePath2), `${wait.stage}-operation.abandoned-${(0, import_node_crypto6.randomUUID)()}.json`));
}

// .ai/tasks/2026-09-17-gateway-stall-fix/verify-live.ts
async function main() {
  const root = (0, import_node_path6.join)(process.cwd(), ".ai/tasks/2026-09-17-gateway-stall-fix");
  await (0, import_promises6.mkdir)(root, { recursive: true });
  const payload = JSON.parse(await (0, import_promises6.readFile)("F:/Son/tool/CreateMediaTool/.state/operations/op-12d11c6c-ddaa-4f49-b208-93bf3328583a.payload.json", "utf8"));
  const original = JSON.parse(payload.messages[1].content);
  const compact = { ...original, evidenceItems: compactRestorationEvidence(original.evidenceItems) };
  const sizing = {
    cueCount: original.cues.length,
    beforeEvidence: original.evidenceItems.length,
    afterEvidence: compact.evidenceItems.length,
    beforeChars: JSON.stringify(original).length,
    afterChars: JSON.stringify(compact).length
  };
  console.log(JSON.stringify(sizing));
  await (0, import_promises6.writeFile)((0, import_node_path6.join)(root, "payload-sizing.json"), JSON.stringify(sizing, null, 2));
  if (!process.argv.includes("--live")) return;
  const data = Buffer.from(payload.messages[1].attachments[0].data, "base64");
  const audioEvidence = original.evidenceItems.find((item) => item.type === "audio");
  const stageDir = (0, import_node_path6.join)(root, "live-stages");
  if (process.argv.includes("--recover")) {
    const lease = JSON.parse(await (0, import_promises6.readFile)((0, import_node_path6.join)(stageDir, "restoration-draft-operation.json"), "utf8"));
    await recoverUnknownGatewayOperation("http://127.0.0.1:4982/openai/v1", stageDir, {
      operationId: lease.operationId,
      stage: "restoration-draft",
      reason: "outcome-unknown",
      nextEligibleAtUtc: null
    });
  }
  if (process.argv.includes("--recover-text")) {
    const textStageDir = (0, import_node_path6.join)(root, "text-full-stage");
    const lease = JSON.parse(await (0, import_promises6.readFile)((0, import_node_path6.join)(textStageDir, "metadata-operation.json"), "utf8"));
    await recoverUnknownGatewayOperation("http://127.0.0.1:4982/openai/v1", textStageDir, {
      operationId: lease.operationId,
      stage: "metadata",
      reason: "outcome-unknown",
      nextEligibleAtUtc: null
    });
    if (!process.argv.includes("--run-after-recover")) return;
  }
  if (process.argv.includes("--tiny")) {
    const started2 = Date.now();
    const execution = await requestGatewayOperation(
      "http://127.0.0.1:4982/openai/v1",
      [{ role: "user", content: 'Return exactly {"translations":{"probe":"ok"}} and nothing else.' }],
      AbortSignal.timeout(4 * 6e4),
      64,
      false,
      "json-items",
      { draftDir: (0, import_node_path6.join)(root, "tiny-stage"), stage: "metadata", httpTimeoutMs: 18e4, deferOnWaitingProvider: true }
    );
    const summary = { ok: true, elapsedSeconds: (Date.now() - started2) / 1e3, responseChars: execution.completion.raw.length };
    await execution.ack();
    await (0, import_promises6.writeFile)((0, import_node_path6.join)(root, "tiny-summary.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary));
    return;
  }
  if (process.argv.includes("--text-full")) {
    const started2 = Date.now();
    const textMessages = payload.messages.map((message) => ({
      role: message.role,
      content: (message.role === "user" ? JSON.stringify(compact) : message.content).replace(/audio-ocr/gu, "ocr").replace(/audio\/OCR/gu, "OCR")
    }));
    const execution = await requestGatewayOperation(
      "http://127.0.0.1:4982/openai/v1",
      textMessages,
      AbortSignal.timeout(4 * 6e4),
      3968,
      false,
      "json-items",
      {
        draftDir: (0, import_node_path6.join)(root, "text-full-stage"),
        stage: "metadata",
        httpTimeoutMs: 18e4,
        deferOnWaitingProvider: true,
        ...process.argv.includes("--no-schema") ? {} : { responseFormat: payload.response_format }
      }
    );
    const summary = { ok: true, elapsedSeconds: (Date.now() - started2) / 1e3, responseChars: execution.completion.raw.length };
    await execution.ack();
    await (0, import_promises6.writeFile)((0, import_node_path6.join)(root, "text-full-summary.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary));
    return;
  }
  const started = Date.now();
  try {
    const result = await runGatewayRestoration({
      baseUrl: "http://127.0.0.1:4982/openai/v1",
      sourceCues: original.cues,
      mediaDigest: "31e9b66009a8e03160e703822cf8bc1c0555111693e794b1757a6753149dcd3a",
      sourceLanguage: "zh",
      targetLocale: "vi",
      mode: "dubbing",
      glossary: [],
      audio: {
        data,
        format: "mp3",
        durationSeconds: audioEvidence.end,
        sampleRate: 16e3,
        channels: 1,
        sha256: (0, import_node_crypto7.createHash)("sha256").update(data).digest("hex")
      },
      ocrFrames: original.evidenceItems.filter((item) => item.type === "ocr").map((item) => ({
        timestamp: item.start,
        end: item.end,
        lines: [{ text: item.text, confidence: item.confidence, boundingBox: item.region }]
      })),
      signal: AbortSignal.timeout(8 * 6e4),
      draftDir: stageDir
    });
    await (0, import_promises6.writeFile)((0, import_node_path6.join)(root, "live-result.json"), JSON.stringify(result, null, 2));
    const summary = {
      ok: true,
      elapsedSeconds: (Date.now() - started) / 1e3,
      cues: result.translatedItems.length,
      sourceEdits: result.draft.sourceEdits.length,
      reviewStatus: result.review.status,
      metrics: result.metrics
    };
    await (0, import_promises6.writeFile)((0, import_node_path6.join)(root, "live-summary.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary));
  } catch (error) {
    const e = error;
    const summary = { ok: false, elapsedSeconds: (Date.now() - started) / 1e3, error: e.message, code: e.providerCode, operationId: e.operationId };
    await (0, import_promises6.writeFile)((0, import_node_path6.join)(root, "live-summary.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary));
    process.exitCode = 1;
  }
}
void main();
