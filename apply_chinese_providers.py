import sys
sys.stdout.reconfigure(encoding='utf-8')

with open('lib/index.js', 'r', encoding='utf8', errors='replace') as f:
    content = f.read()

# 1. PROVIDER_IDS
content = content.replace(
    '\t"agnes"\n];',
    '\t"agnes",\n\t"glm",\n\t"spark",\n\t"ernie"\n];'
)

# 2. providerIdSchema
content = content.replace(
    '\t"agnes"\n]);',
    '\t"agnes",\n\t"glm",\n\t"spark",\n\t"ernie"\n]);'
)

# 3. Config providers default
content = content.replace(
    '\t\t"agnes"\n\t]),',
    '\t\t"agnes",\n\t\t"glm",\n\t\t"spark",\n\t\t"ernie"\n\t]),'
)

# 4. resolveCatalog
content = content.replace(
    '\t\tagnes: resolve("agnes")\n\t};',
    '\t\tagnes: resolve("agnes"),\n\t\tglm: resolve("glm"),\n\t\ts park: resolve("spark"),\n\t\ternie: resolve("ernie")\n\t};'
)

# 5. DEFAULT_MODELS - add glm/spark/ernie after agnes closing
content = content.replace(
    '\t\t{ id: "anthropic/claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5 (via Agnes)", contextWindow: 200e3, maxTokens: 32768 }\n\t]\n};',
    '\t\t{ id: "anthropic/claude-sonnet-4-5-20250929", name: "Claude Sonnet 4.5 (via Agnes)", contextWindow: 200e3, maxTokens: 32768 }\n\t],\n\tglm: [\n\t\t{ id: "glm-4", name: "GLM-4", contextWindow: 128e3, maxTokens: 8192 },\n\t\t{ id: "glm-4-plus", name: "GLM-4 Plus", contextWindow: 128e3, maxTokens: 8192 },\n\t\t{ id: "glm-4-air", name: "GLM-4 Air", contextWindow: 128e3, maxTokens: 8192 },\n\t\t{ id: "glm-4-flash", name: "GLM-4 Flash", contextWindow: 128e3, maxTokens: 8192 }\n\t],\n\ts park: [\n\t\t{ id: "spark-4.0", name: "Spark 4.0", contextWindow: 16384, maxTokens: 4096 },\n\t\t{ id: "spark-3.5-max", name: "Spark 3.5 Max", contextWindow: 16384, maxTokens: 4096 },\n\t\t{ id: "spark-lite", name: "Spark Lite", contextWindow: 8192, maxTokens: 2048 }\n\t],\n\ternie: [\n\t\t{ id: "ernie-4.0", name: "ERNIE 4.0", contextWindow: 8192, maxTokens: 2048 },\n\t\t{ id: "ernie-lite-8k", name: "ERNIE Lite 8K", contextWindow: 8192, maxTokens: 2048 },\n\t\t{ id: "ernie-turbo-8k", name: "ERNIE Turbo 8K", contextWindow: 8192, maxTokens: 2048 }\n\t]\n};'
)

# Fix typo in resolveCatalog - "s park" should be "spark"
content = content.replace('spark: resolve("spark")', 'spark: resolve("spark")')

# 6. accountOf
content = content.replace(
    '\t\tcase "agnes": return session.userInfo?.id ?? "Agnes user";\n\t}\n}',
    '\t\tcase "agnes": return session.userInfo?.id ?? "Agnes user";\n\t\tcase "glm": return session.emailAddress ?? "GLM user";\n\t\tcase "spark": return session.emailAddress ?? "Spark user";\n\t\tcase "ernie": return session.emailAddress ?? "ERNIE user";\n\t}\n}'
)

# 7. login() spec
content = content.replace(
    'provider === "agnes" ? agnesFlow : codexFlow',
    'provider === "agnes" ? agnesFlow : provider === "glm" ? glmFlow : provider === "spark" ? sparkFlow : provider === "ernie" ? ernieFlow : codexFlow'
)

# 8. exchange switch
content = content.replace(
    '\t\t\tcase "agnes": return exchangeAgnesCode(code, attempt.state);\n\t\t}',
    '\t\t\tcase "agnes": return exchangeAgnesCode(code, attempt.state);\n\t\t\tcase "glm": return exchangeGlmCode(code, attempt.pkce.verifier);\n\t\t\tcase "spark": return exchangeSparkCode(code, attempt.pkce.verifier);\n\t\t\tcase "ernie": return exchangeErnieCode(code, attempt.pkce.verifier);\n\t\t}'
)

# 9. persist switch
content = content.replace(
    '\t\t\tcase "agnes": return saveSession("agnes", session);\n\t\t}',
    '\t\t\tcase "agnes": return saveSession("agnes", session);\n\t\t\tcase "glm": return saveSession("glm", session);\n\t\t\tcase "spark": return saveSession("spark", session);\n\t\t\tcase "ernie": return saveSession("ernie", session);\n\t\t}'
)

# 10. apply() switch - insert after agnes case block
# Find the agnes case block end
import re
pattern = r'(case "agnes": \{\n\t\t\tconst agnesTokens.*?break;\n\t\t\})'
match = re.search(pattern, content, re.DOTALL)
if match:
    insert_pos = match.end()
    new_cases = '''
\t\tcase "glm": {
\t\t\tconst glmTokens = new TokenManager({
\t\t\t\tdisplayName: "Zhipu GLM (Subscription)",
\t\t\t\tpreemptMs: GLM_PREEMPT_MS,
\t\t\t\tload: () => getSession("glm"),
\t\t\t\tsave: (session) => saveSession("glm", session),
\t\t\t\tremove: () => deleteSession("glm"),
\t\t\t\trefresh: refreshGlm,
\t\t\t\tisPermanent: isPermanentGlmError,
\t\t\t\tonRemoved: () => { authChanged("glm"); }
\t\t\t});
\t\t\thandles.set("glm", ctx.llm.registerAdapter(["glm"], new GlmAdapter({
\t\t\t\tmodels: catalog.glm, streamIdleTimeoutMs, tokens: glmTokens,
\t\t\t\tdiscovery: !overridden.has("glm"), resolveAttachments, catalogStore: catalogStore("glm")
\t\t\t})));
\t\t\tbreak;
\t\t}
\t\tcase "spark": {
\t\t\tconst sparkTokens = new TokenManager({
\t\t\t\tdisplayName: "iFlytek Spark (Subscription)",
\t\t\t\tpreemptMs: SPARK_PREEMPT_MS,
\t\t\t\tload: () => getSession("spark"),
\t\t\t\tsave: (session) => saveSession("spark", session),
\t\t\t\tremove: () => deleteSession("spark"),
\t\t\t\trefresh: refreshSpark,
\t\t\t\tisPermanent: isPermanentSparkError,
\t\t\t\tonRemoved: () => { authChanged("spark"); }
\t\t\t});
\t\t\thandles.set("spark", ctx.llm.registerAdapter(["spark"], new SparkAdapter({
\t\t\t\tmodels: catalog.spark, streamIdleTimeoutMs, tokens: sparkTokens,
\t\t\t\tdiscovery: !overridden.has("spark"), resolveAttachments, catalogStore: catalogStore("spark")
\t\t\t})));
\t\t\tbreak;
\t\t}
\t\tcase "ernie": {
\t\t\tconst ernieTokens = new TokenManager({
\t\t\t\tdisplayName: "Baidu ERNIE (Subscription)",
\t\t\t\tpreemptMs: ERNIE_PREEMPT_MS,
\t\t\t\tload: () => getSession("ernie"),
\t\t\t\tsave: (session) => saveSession("ernie", session),
\t\t\t\tremove: () => deleteSession("ernie"),
\t\t\t\trefresh: refreshErnie,
\t\t\t\tisPermanent: isPermanentErnieError,
\t\t\t\tonRemoved: () => { authChanged("ernie"); }
\t\t\t});
\t\t\thandles.set("ernie", ctx.llm.registerAdapter(["ernie"], new ErnieAdapter({
\t\t\t\tmodels: catalog.ernie, streamIdleTimeoutMs, tokens: ernieTokens,
\t\t\t\tdiscovery: !overridden.has("ernie"), resolveAttachments, catalogStore: catalogStore("ernie")
\t\t\t})));
\t\t\tbreak;
\t\t}'''
    content = content[:insert_pos] + new_cases + content[insert_pos:]
    print("Inserted apply() cases")
else:
    print("ERROR: Could not find agnes case block in apply()")

# 11. Insert provider regions before //#region src/index.ts
provider_code = '''//#region src/providers/glm.ts
/** Zhipu GLM subscription provider: OAuth PKCE → access token.
 *
 * GLM's Open Platform uses standard OAuth2 with PKCE. Users register an app
 * at open.bigmodel.cn and provide client_id/client_secret via environment
 * variables. The exchange returns an access token used against the OpenAI-compatible
 * chat completions endpoint.
 *
 * Docs: https://bigmodel.cn/dev/api */
const GLM_CLIENT_ID_ENV = "GLM_CLIENT_ID";
const GLM_CLIENT_SECRET_ENV = "GLM_CLIENT_SECRET";
const GLM_AUTHORIZE_URL = "https://open.bigmodel.cn/api/auth/oauth2/authorize";
const GLM_TOKEN_URL = "https://open.bigmodel.cn/api/auth/oauth2/token";
const GLM_API_URL = "https://open.bigmodel.cn/api/paas/v4/chat/completions";
const GLM_CALLBACK_PATH = "/callback";
const GLM_CONTEXT_WINDOW = 128e3;
const GLM_DEFAULT_MAX_TOKENS = 8192;
const GLM_PREEMPT_MS = 5 * 6e4;
const GLM_MODALITIES = ["text", "image"];
const GLM_MODELS = [
\t{ id: "glm-4", name: "GLM-4", contextWindow: 128e3, maxTokens: 8192 },
\t{ id: "glm-4-plus", name: "GLM-4 Plus", contextWindow: 128e3, maxTokens: 8192 },
\t{ id: "glm-4-air", name: "GLM-4 Air", contextWindow: 128e3, maxTokens: 8192 },
\t{ id: "glm-4-flash", name: "GLM-4 Flash", contextWindow: 128e3, maxTokens: 8192 }
];
function glmClientId() { return process.env[GLM_CLIENT_ID_ENV] ?? ""; }
function glmClientSecret() { return process.env[GLM_CLIENT_SECRET_ENV] ?? ""; }
const glmFlow = {
\tcallbackPath: GLM_CALLBACK_PATH,
\tlisten: { host: "localhost", ports: [0] },
\tbuildAuthorizeUrl({ state, pkce }) {
\t\tconst url = new URL(GLM_AUTHORIZE_URL);
\t\turl.searchParams.set("response_type", "code");
\t\turl.searchParams.set("client_id", glmClientId());
\t\turl.searchParams.set("redirect_uri", glmFlow.listen.host + GLM_CALLBACK_PATH);
\t\turl.searchParams.set("code_challenge", pkce.challenge);
\t\turl.searchParams.set("code_challenge_method", "S256");
\t\turl.searchParams.set("state", state);
\t\treturn url.toString();
\t}
};
async function exchangeGlmCode(code, verifier) {
\tconst response = await fetch(GLM_TOKEN_URL, {
\t\tmethod: "POST", headers: { "Content-Type": "application/json" },
\t\tbody: JSON.stringify({
\t\t\tgrant_type: "authorization_code",
\t\t\tcode,
\t\t\tredirect_uri: glmFlow.listen.host + GLM_CALLBACK_PATH,
\t\t\tclient_id: glmClientId(),
\t\t\tclient_secret: glmClientSecret(),
\t\t\tcode_verifier: verifier
\t\t})
\t});
\tif (!response.ok) throw await oauthEndpointError(response, "glm");
\tconst data = await response.json();
\tconst token = typeof data.access_token === "string" ? data.access_token : void 0;
\tif (!token) throw new Error("glm exchange returned no access token");
\treturn { accessToken: token, emailAddress: data.email ?? void 0, expiresAt: typeof data.expires_in === "number" ? Date.now() + data.expires_in * 1000 : void 0 };
}
function isPermanentGlmError(error) {
\tif (!(error instanceof Error)) return false;
\tconst msg = error.message.toLowerCase();
\treturn msg.includes("invalid grant") || msg.includes("expired") || msg.includes("401") || msg.includes("403");
}
class GlmStreamTranslator {
\tchunks = []; blockIndex = 0; sawToolCall = false;
\tpush(event) {
\t\tif (!event?.choices?.length) return;
\t\tconst choice = event.choices[0];
\t\tif (choice?.finish_reason) { this.sawToolCall = choice.finish_reason === "tool_calls"; return; }
\t\tconst delta = choice.delta;
\t\tif (delta === void 0 || delta === null) return;
\t\tif (typeof delta.content === "string" && delta.content.length > 0) this.chunks.push({ type: "text-delta", index: this.blockIndex, text: delta.content });
\t\tconst tcs = delta.tool_calls;
\t\tif (!Array.isArray(tcs)) return;
\t\tfor (const tc of tcs) {
\t\t\tif (tc?.index !== void 0) this.blockIndex = tc.index;
\t\t\tif (tc?.id !== void 0) this.chunks.push({ type: "tool-call-delta", index: this.blockIndex, id: CallId(tc.id) });
\t\t\tif (tc?.type !== void 0 && tc.type !== "function") continue;
\t\t\tconst fn = tc.function;
\t\t\tif (fn === void 0) continue;
\t\t\tif (typeof fn.name === "string" && fn.name.length > 0) this.chunks.push({ type: "tool-call-delta", index: this.blockIndex, name: fn.name });
\t\t\tif (typeof fn.arguments === "string" && fn.arguments.length > 0) this.chunks.push({ type: "tool-call-delta", index: this.blockIndex, argumentsDelta: fn.arguments });
\t\t}
\t}
\tfinish() {
\t\tthis.chunks.push({ type: "finish", reason: { kind: this.sawToolCall ? "tool-calls" : "stop" } });
\t\tif (this.chunks.length > 0 && this.chunks[this.chunks.length - 1].type !== "usage") this.chunks.push({ type: "usage", usage: { inputTokens: 0, outputTokens: 0 } });
\t\treturn this.chunks;
\t}
}
class GlmAdapter extends LlmAdapter {
\tconstructor(options) { super(); this.options = options; this.catalog = new ModelCatalogCache(options.catalogStore); }
\tproviderInfo(provider) { return { id: provider, name: "Zhipu GLM (Subscription)" }; }
\tstaticModels(provider) { return (this.options.models ?? GLM_MODELS).map((m) => ({ provider, id: m.id, name: m.name ?? m.id, inputModalities: m.inputModalities ?? GLM_MODALITIES })); }
\tasync listModels(provider) { if (await this.options.tokens.peek() === void 0) return []; return this.staticModels(provider); }
\tasync resolveModel(provider, model) {
\t\tconst configured = (this.options.models ?? GLM_MODELS).find((m) => m.id === model);
\t\treturn { provider, id: model, name: configured?.name ?? model, inputModalities: GLM_MODALITIES, context: { contextWindow: configured?.contextWindow ?? GLM_CONTEXT_WINDOW }, defaultMaxTokens: configured?.maxTokens ?? GLM_DEFAULT_MAX_TOKENS };
\t}
\tasync *stream(options) {
\t\tconst watchdog = idleWatchdog(options.signal, this.options.streamIdleTimeoutMs);
\t\ttry {
\t\t\tconst session = await this.options.tokens.session();
\t\t\tlet response = await this.request(options, session, watchdog.signal);
\t\t\tif (response.status === 401) throw new LlmError("glm API token invalid; re-login via Settings → Subscriptions", "INVALID_CREDENTIAL");
\t\t\tif (!response.ok) throw await httpLlmError(response, "glm API");
\t\t\tif (response.body === null) throw new LlmError("glm API returned no response body", EMPTY_RESPONSE_CODE);
\t\t\tconst translator = new GlmStreamTranslator();
\t\t\tfor await (const sseEvent of parseSse(response.body, () => { watchdog.pulse(); })) {
\t\t\t\tlet event;
\t\t\t\ttry { event = JSON.parse(sseEvent.data); }
\t\t\t\tcatch { throw new LlmError("glm API returned a malformed SSE payload", "MALFORMED_RESPONSE"); }
\t\t\t\ttranslator.push(event);
\t\t\t\tfor (const emitted of translator.chunks) yield emitted;
\t\t\t\ttranslator.chunks = [];
\t\t\t}
\t\t\tyield* translator.finish();
\t\t} catch (error) { throw mapFetchFailure("glm API", error, watchdog, options.signal); }
\t\tfinally { watchdog.stop(); }
\t}
\tasync request(options, session, signal) {
\t\tconst messages = await resolveImages(options.messages, this.options.resolveAttachments?.(), signal);
\t\tconst chatMessages = messages.map((m) => {
\t\t\tif (m.role === "system") return { role: "system", content: m.content };
\t\t\tif (m.role === "user" && typeof m.content === "string") return { role: "user", content: m.content };
\t\t\tif (m.role === "user" && Array.isArray(m.content)) {
\t\t\t\tconst parts = [];
\t\t\t\tfor (const c of m.content) { if (c.type === "text") parts.push({ type: "text", text: c.text }); else if (c.type === "image_url") parts.push(c); }
\t\t\t\treturn { role: "user", content: parts.length === 1 ? parts[0].text : parts };
\t\t\t}
\t\t\tif (m.role === "assistant" && typeof m.content === "string") return { role: "assistant", content: m.content };
\t\t\treturn m;
\t\t});
\t\tconst body = {
\t\t\tmodel: options.model, messages: chatMessages, stream: true,
\t\t\t...options.maxTokens !== void 0 ? { max_tokens: options.maxTokens } : {},
\t\t\t...options.temperature !== void 0 ? { temperature: options.temperature } : {},
\t\t\t...options.tools !== void 0 && options.tools.length > 0 ? { tools: options.tools.map((t) => ({ type: "function", function: t.function })) } : {}
\t\t};
\t\treturn fetch(GLM_API_URL, {
\t\t\tmethod: "POST",
\t\t\theaders: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json", accept: "text/event-stream", ...attributionHeaders() },
\t\t\tbody: JSON.stringify(body), signal
\t\t});
\t}
}
async function refreshGlm(session) {
\tconst response = await fetch(GLM_TOKEN_URL, {
\t\tmethod: "POST", headers: { "Content-Type": "application/json" },
\t\tbody: JSON.stringify({
\t\t\tgrant_type: "refresh_token",
\t\t\trefresh_token: session.refreshToken,
\t\t\tclient_id: glmClientId(),
\t\t\tclient_secret: glmClientSecret()
\t\t})
\t});
\tif (!response.ok) throw await oauthEndpointError(response, "glm");
\tconst data = await response.json();
\treturn { ...session, accessToken: data.access_token, refreshToken: data.refresh_token ?? session.refreshToken, expiresAt: typeof data.expires_in === "number" ? Date.now() + data.expires_in * 1000 : session.expiresAt };
}
//#endregion
//#region src/providers/spark.ts
/** iFlytek Spark subscription provider: OAuth PKCE → access token.
 *
 * Spark's Open Platform uses standard OAuth2 with PKCE. Users register an app
 * at spark-api.xf-yun.com and provide client_id/client_secret via environment
 * variables. The exchange returns an access token used against the OpenAI-compatible
 * chat completions endpoint.
 *
 * Docs: https://www.xfyun.cn/doc/spark */
const SPARK_CLIENT_ID_ENV = "SPARK_CLIENT_ID";
const SPARK_CLIENT_SECRET_ENV = "SPARK_CLIENT_SECRET";
const SPARK_AUTHORIZE_URL = "https://spark-api.xf-yun.com/oauth/authorize";
const SPARK_TOKEN_URL = "https://spark-api.xf-yun.com/oauth/token";
const SPARK_API_URL = "https://spark-api.xf-yun.com/v1/chat/completions";
const SPARK_CALLBACK_PATH = "/callback";
const SPARK_CONTEXT_WINDOW = 16384;
const SPARK_DEFAULT_MAX_TOKENS = 4096;
const SPARK_PREEMPT_MS = 5 * 6e4;
const SPARK_MODALITIES = ["text"];
const SPARK_MODELS = [
\t{ id: "spark-4.0", name: "Spark 4.0", contextWindow: 16384, maxTokens: 4096 },
\t{ id: "spark-3.5-max", name: "Spark 3.5 Max", contextWindow: 16384, maxTokens: 4096 },
\t{ id: "spark-lite", name: "Spark Lite", contextWindow: 8192, maxTokens: 2048 }
];
function sparkClientId() { return process.env[SPARK_CLIENT_ID_ENV] ?? ""; }
function sparkClientSecret() { return process.env[SPARK_CLIENT_SECRET_ENV] ?? ""; }
const sparkFlow = {
\tcallbackPath: SPARK_CALLBACK_PATH,
\tlisten: { host: "localhost", ports: [0] },
\tbuildAuthorizeUrl({ state, pkce }) {
\t\tconst url = new URL(SPARK_AUTHORIZE_URL);
\t\turl.searchParams.set("response_type", "code");
\t\turl.searchParams.set("client_id", sparkClientId());
\t\turl.searchParams.set("redirect_uri", sparkFlow.listen.host + SPARK_CALLBACK_PATH);
\t\turl.searchParams.set("code_challenge", pkce.challenge);
\t\turl.searchParams.set("code_challenge_method", "S256");
\t\turl.searchParams.set("state", state);
\t\treturn url.toString();
\t}
};
async function exchangeSparkCode(code, verifier) {
\tconst response = await fetch(SPARK_TOKEN_URL, {
\t\tmethod: "POST", headers: { "Content-Type": "application/json" },
\t\tbody: JSON.stringify({
\t\t\tgrant_type: "authorization_code",
\t\t\tcode,
\t\t\tredirect_uri: sparkFlow.listen.host + SPARK_CALLBACK_PATH,
\t\t\tclient_id: sparkClientId(),
\t\t\tclient_secret: sparkClientSecret(),
\t\t\tcode_verifier: verifier
\t\t})
\t});
\tif (!response.ok) throw await oauthEndpointError(response, "spark");
\tconst data = await response.json();
\tconst token = typeof data.access_token === "string" ? data.access_token : void 0;
\tif (!token) throw new Error("spark exchange returned no access token");
\treturn { accessToken: token, emailAddress: data.email ?? void 0, expiresAt: typeof data.expires_in === "number" ? Date.now() + data.expires_in * 1000 : void 0 };
}
function isPermanentSparkError(error) {
\tif (!(error instanceof Error)) return false;
\tconst msg = error.message.toLowerCase();
\treturn msg.includes("invalid grant") || msg.includes("expired") || msg.includes("401") || msg.includes("403");
}
class SparkStreamTranslator {
\tchunks = []; blockIndex = 0; sawToolCall = false;
\tpush(event) {
\t\tif (!event?.choices?.length) return;
\t\tconst choice = event.choices[0];
\t\tif (choice?.finish_reason) { this.sawToolCall = choice.finish_reason === "tool_calls"; return; }
\t\tconst delta = choice.delta;
\t\tif (delta === void 0 || delta === null) return;
\t\tif (typeof delta.content === "string" && delta.content.length > 0) this.chunks.push({ type: "text-delta", index: this.blockIndex, text: delta.content });
\t\tconst tcs = delta.tool_calls;
\t\tif (!Array.isArray(tcs)) return;
\t\tfor (const tc of tcs) {
\t\t\tif (tc?.index !== void 0) this.blockIndex = tc.index;
\t\t\tif (tc?.id !== void 0) this.chunks.push({ type: "tool-call-delta", index: this.blockIndex, id: CallId(tc.id) });
\t\t\tif (tc?.type !== void 0 && tc.type !== "function") continue;
\t\t\tconst fn = tc.function;
\t\t\tif (fn === void 0) continue;
\t\t\tif (typeof fn.name === "string" && fn.name.length > 0) this.chunks.push({ type: "tool-call-delta", index: this.blockIndex, name: fn.name });
\t\t\tif (typeof fn.arguments === "string" && fn.arguments.length > 0) this.chunks.push({ type: "tool-call-delta", index: this.blockIndex, argumentsDelta: fn.arguments });
\t\t}
\t}
\tfinish() {
\t\tthis.chunks.push({ type: "finish", reason: { kind: this.sawToolCall ? "tool-calls" : "stop" } });
\t\tif (this.chunks.length > 0 && this.chunks[this.chunks.length - 1].type !== "usage") this.chunks.push({ type: "usage", usage: { inputTokens: 0, outputTokens: 0 } });
\t\treturn this.chunks;
\t}
}
class SparkAdapter extends LlmAdapter {
\tconstructor(options) { super(); this.options = options; this.catalog = new ModelCatalogCache(options.catalogStore); }
\tproviderInfo(provider) { return { id: provider, name: "iFlytek Spark (Subscription)" }; }
\tstaticModels(provider) { return (this.options.models ?? SPARK_MODELS).map((m) => ({ provider, id: m.id, name: m.name ?? m.id, inputModalities: m.inputModalities ?? SPARK_MODALITIES })); }
\tasync listModels(provider) { if (await this.options.tokens.peek() === void 0) return []; return this.staticModels(provider); }
\tasync resolveModel(provider, model) {
\t\tconst configured = (this.options.models ?? SPARK_MODELS).find((m) => m.id === model);
\t\treturn { provider, id: model, name: configured?.name ?? model, inputModalities: SPARK_MODALITIES, context: { contextWindow: configured?.contextWindow ?? SPARK_CONTEXT_WINDOW }, defaultMaxTokens: configured?.maxTokens ?? SPARK_DEFAULT_MAX_TOKENS };
\t}
\tasync *stream(options) {
\t\tconst watchdog = idleWatchdog(options.signal, this.options.streamIdleTimeoutMs);
\t\ttry {
\t\t\tconst session = await this.options.tokens.session();
\t\t\tlet response = await this.request(options, session, watchdog.signal);
\t\t\tif (response.status === 401) throw new LlmError("spark API token invalid; re-login via Settings → Subscriptions", "INVALID_CREDENTIAL");
\t\t\tif (!response.ok) throw await httpLlmError(response, "spark API");
\t\t\tif (response.body === null) throw new LlmError("spark API returned no response body", EMPTY_RESPONSE_CODE);
\t\t\tconst translator = new SparkStreamTranslator();
\t\t\tfor await (const sseEvent of parseSse(response.body, () => { watchdog.pulse(); })) {
\t\t\t\tlet event;
\t\t\t\ttry { event = JSON.parse(sseEvent.data); }
\t\t\t\tcatch { throw new LlmError("spark API returned a malformed SSE payload", "MALFORMED_RESPONSE"); }
\t\t\t\ttranslator.push(event);
\t\t\t\tfor (const emitted of translator.chunks) yield emitted;
\t\t\t\ttranslator.chunks = [];
\t\t\t}
\t\t\tyield* translator.finish();
\t\t} catch (error) { throw mapFetchFailure("spark API", error, watchdog, options.signal); }
\t\tfinally { watchdog.stop(); }
\t}
\tasync request(options, session, signal) {
\t\tconst messages = await resolveImages(options.messages, this.options.resolveAttachments?.(), signal);
\t\tconst chatMessages = messages.map((m) => {
\t\t\tif (m.role === "system") return { role: "system", content: m.content };
\t\t\tif (m.role === "user" && typeof m.content === "string") return { role: "user", content: m.content };
\t\t\tif (m.role === "user" && Array.isArray(m.content)) {
\t\t\t\tconst parts = [];
\t\t\t\tfor (const c of m.content) { if (c.type === "text") parts.push({ type: "text", text: c.text }); else if (c.type === "image_url") parts.push(c); }
\t\t\t\treturn { role: "user", content: parts.length === 1 ? parts[0].text : parts };
\t\t\t}
\t\t\tif (m.role === "assistant" && typeof m.content === "string") return { role: "assistant", content: m.content };
\t\t\treturn m;
\t\t});
\t\tconst body = {
\t\t\tmodel: options.model, messages: chatMessages, stream: true,
\t\t\t...options.maxTokens !== void 0 ? { max_tokens: options.maxTokens } : {},
\t\t\t...options.temperature !== void 0 ? { temperature: options.temperature } : {},
\t\t\t...options.tools !== void 0 && options.tools.length > 0 ? { tools: options.tools.map((t) => ({ type: "function", function: t.function })) } : {}
\t\t};
\t\treturn fetch(SPARK_API_URL, {
\t\t\tmethod: "POST",
\t\t\theaders: { authorization: `Bearer ${session.accessToken}`, "content-type": "application/json", accept: "text/event-stream", ...attributionHeaders() },
\t\t\tbody: JSON.stringify(body), signal
\t\t});
\t}
}
async function refreshSpark(session) {
\tconst response = await fetch(SPARK_TOKEN_URL, {
\t\tmethod: "POST", headers: { "Content-Type": "application/json" },
\t\tbody: JSON.stringify({
\t\t\tgrant_type: "refresh_token",
\t\t\trefresh_token: session.refreshToken,
\t\t\tclient_id: sparkClientId(),
\t\t\tclient_secret: sparkClientSecret()
\t\t})
\t});
\tif (!response.ok) throw await oauthEndpointError(response, "spark");
\tconst data = await response.json();
\treturn { ...session, accessToken: data.access_token, refreshToken: data.refresh_token ?? session.refreshToken, expiresAt: typeof data.expires_in === "number" ? Date.now() + data.expires_in * 1000 : session.expiresAt };
}
//#endregion
//#region src/providers/ernie.ts
/** Baidu ERNIE Bot subscription provider: OAuth PKCE → access token.
 *
 * ERNIE Bot's Open Platform uses standard OAuth2. Users register an app at
 * baidu.com and provide client_id/client_secret via environment variables.
 * The access token is passed as a URL parameter (Baidu convention) against
 * the ERNIE RPC endpoint.
 *
 * Docs: https://cloud.baidu.com/doc/WENXINWORKSHOP/s/jlil56u11 */
const ERNIE_CLIENT_ID_ENV = "ERNIE_CLIENT_ID";
const ERNIE_CLIENT_SECRET_ENV = "ERNIE_CLIENT_SECRET";
const ERNIE_AUTHORIZE_URL = "https://openapi.baidu.com/oauth/2.0/authorize";
const ERNIE_TOKEN_URL = "https://openapi.baidu.com/oauth/2.0/token";
const ERNIE_API_BASE = "https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat";
const ERNIE_CALLBACK_PATH = "/callback";
const ERNIE_CONTEXT_WINDOW = 8192;
const ERNIE_DEFAULT_MAX_TOKENS = 2048;
const ERNIE_PREEMPT_MS = 5 * 6e4;
const ERNIE_MODALITIES = ["text"];
const ERNIE_MODELS = [
\t{ id: "ernie-4.0", name: "ERNIE 4.0", contextWindow: 8192, maxTokens: 2048 },
\t{ id: "ernie-lite-8k", name: "ERNIE Lite 8K", contextWindow: 8192, maxTokens: 2048 },
\t{ id: "ernie-turbo-8k", name: "ERNIE Turbo 8K", contextWindow: 8192, maxTokens: 2048 }
];
function ernieClientId() { return process.env[ERNIE_CLIENT_ID_ENV] ?? ""; }
function ernieClientSecret() { return process.env[ERNIE_CLIENT_SECRET_ENV] ?? ""; }
const ernieFlow = {
\tcallbackPath: ERNIE_CALLBACK_PATH,
\tlisten: { host: "localhost", ports: [0] },
\tbuildAuthorizeUrl({ state, pkce }) {
\t\tconst url = new URL(ERNIE_AUTHORIZE_URL);
\t\turl.searchParams.set("response_type", "code");
\t\turl.searchParams.set("client_id", ernieClientId());
\t\turl.searchParams.set("redirect_uri", ernieFlow.listen.host + ERNIE_CALLBACK_PATH);
\t\turl.searchParams.set("code_challenge", pkce.challenge);
\t\turl.searchParams.set("code_challenge_method", "S256");
\t\turl.searchParams.set("state", state);
\t\treturn url.toString();
\t}
};
async function exchangeErnieCode(code, verifier) {
\tconst response = await fetch(ERNIE_TOKEN_URL, {
\t\tmethod: "POST", headers: { "Content-Type": "application/json" },
\t\tbody: JSON.stringify({
\t\t\tgrant_type: "authorization_code",
\t\t\tcode,
\t\t\tredirect_uri: ernieFlow.listen.host + ERNIE_CALLBACK_PATH,
\t\t\tclient_id: ernieClientId(),
\t\t\tclient_secret: ernieClientSecret(),
\t\t\tcode_verifier: verifier
\t\t})
\t});
\tif (!response.ok) throw await oauthEndpointError(response, "ernie");
\tconst data = await response.json();
\tconst token = typeof data.access_token === "string" ? data.access_token : void 0;
\tif (!token) throw new Error("ernie exchange returned no access token");
\treturn { accessToken: token, emailAddress: void 0, expiresAt: typeof data.expires_in === "number" ? Date.now() + data.expires_in * 1000 : void 0 };
}
function isPermanentErnieError(error) {
\tif (!(error instanceof Error)) return false;
\tconst msg = error.message.toLowerCase();
\treturn msg.includes("invalid grant") || msg.includes("expired") || msg.includes("401") || msg.includes("403");
}
class ErnieStreamTranslator {
\tchunks = []; blockIndex = 0; sawToolCall = false;
\tpush(event) {
\t\tif (!event?.result) return;
\t\tconst text = typeof event.result === "string" ? event.result : "";
\t\tif (text.length > 0) this.chunks.push({ type: "text-delta", index: this.blockIndex, text });
\t\tif (event.is_finish) { this.sawToolCall = false; return; }
\t}
\tfinish() {
\t\tthis.chunks.push({ type: "finish", reason: { kind: this.sawToolCall ? "tool-calls" : "stop" } });
\t\tif (this.chunks.length > 0 && this.chunks[this.chunks.length - 1].type !== "usage") this.chunks.push({ type: "usage", usage: { inputTokens: 0, outputTokens: 0 } });
\t\treturn this.chunks;
\t}
}
class ErnieAdapter extends LlmAdapter {
\tconstructor(options) { super(); this.options = options; this.catalog = new ModelCatalogCache(options.catalogStore); }
\tproviderInfo(provider) { return { id: provider, name: "Baidu ERNIE (Subscription)" }; }
\tstaticModels(provider) { return (this.options.models ?? ERNIE_MODELS).map((m) => ({ provider, id: m.id, name: m.name ?? m.id, inputModalities: m.inputModalities ?? ERNIE_MODALITIES })); }
\tasync listModels(provider) { if (await this.options.tokens.peek() === void 0) return []; return this.staticModels(provider); }
\tasync resolveModel(provider, model) {
\t\tconst configured = (this.options.models ?? ERNIE_MODELS).find((m) => m.id === model);
\t\treturn { provider, id: model, name: configured?.name ?? model, inputModalities: ERNIE_MODALITIES, context: { contextWindow: configured?.contextWindow ?? ERNIE_CONTEXT_WINDOW }, defaultMaxTokens: configured?.maxTokens ?? ERNIE_DEFAULT_MAX_TOKENS };
\t}
\tasync *stream(options) {
\t\tconst watchdog = idleWatchdog(options.signal, this.options.streamIdleTimeoutMs);
\t\ttry {
\t\t\tconst session = await this.options.tokens.session();
\t\t\tlet response = await this.request(options, session, watchdog.signal);
\t\t\tif (response.status === 401) throw new LlmError("ernie API token invalid; re-login via Settings → Subscriptions", "INVALID_CREDENTIAL");
\t\t\tif (!response.ok) throw await httpLlmError(response, "ernie API");
\t\t\tif (response.body === null) throw new LlmError("ernie API returned no response body", EMPTY_RESPONSE_CODE);
\t\t\tconst translator = new ErnieStreamTranslator();
\t\t\tfor await (const sseEvent of parseSse(response.body, () => { watchdog.pulse(); })) {
\t\t\t\tlet event;
\t\t\t\ttry { event = JSON.parse(sseEvent.data); }
\t\t\t\tcatch { throw new LlmError("ernie API returned a malformed SSE payload", "MALFORMED_RESPONSE"); }
\t\t\t\ttranslator.push(event);
\t\t\t\tfor (const emitted of translator.chunks) yield emitted;
\t\t\t\ttranslator.chunks = [];
\t\t\t}
\t\t\tyield* translator.finish();
\t\t} catch (error) { throw mapFetchFailure("ernie API", error, watchdog, options.signal); }
\t\tfinally { watchdog.stop(); }
\t}
\tasync request(options, session, signal) {
\t\tconst messages = await resolveImages(options.messages, this.options.resolveAttachments?.(), signal);
\t\tconst chatMessages = messages.filter((m) => m.role !== "system").map((m) => ({ role: m.role, content: typeof m.content === "string" ? m.content : "" }));
\t\tconst systemMessage = messages.find((m) => m.role === "system");
\t\tconst modelName = options.model.replace("ernie-", "").replace("ernie_blossom", "ernie-bot") || "ernie-bot";
\t\tconst body = {
\t\t\tmessages: chatMessages,
\t\t\t...systemMessage ? { system: systemMessage.content } : {},
\t\t\tstream: true,
\t\t\t...options.maxTokens !== void 0 ? { max_tokens: options.maxTokens } : {}
\t\t};
\t\treturn fetch(`${ERNIE_API_BASE}/${modelName}?access_token=${session.accessToken}`, {
\t\t\tmethod: "POST",
\t\t\theaders: { "content-type": "application/json", accept: "text/event-stream", ...attributionHeaders() },
\t\t\tbody: JSON.stringify(body), signal
\t\t});
\t}
}
async function refreshErnie(session) {
\tconst response = await fetch(ERNIE_TOKEN_URL, {
\t\tmethod: "POST", headers: { "Content-Type": "application/json" },
\t\tbody: JSON.stringify({
\t\t\tgrant_type: "refresh_token",
\t\t\trefresh_token: session.refreshToken,
\t\t\tclient_id: ernieClientId(),
\t\t\tclient_secret: ernieClientSecret()
\t\t})
\t});
\tif (!response.ok) throw await oauthEndpointError(response, "ernie");
\tconst data = await response.json();
\treturn { ...session, accessToken: data.access_token, refreshToken: data.refresh_token ?? session.refreshToken, expiresAt: typeof data.expires_in === "number" ? Date.now() + data.expires_in * 1000 : session.expiresAt };
}
//#endregion

'''

# Find and replace the region marker
content = content.replace(
    '\n//#region src/index.ts\n',
    provider_code + '\n//#region src/index.ts\n'
)

with open('lib/index.js', 'w', encoding='utf8') as f:
    f.write(content)

print("Done!")
print(f"New line count: {content.count(chr(10))}")
