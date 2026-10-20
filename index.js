/**
 * Host half of `@local/dsh-api-balance`.
 *
 * One balance read path is shared by three callers:
 *   - the Client pill/popover, through the `plugin/api-balance/snapshot` route,
 *   - the `/balance` composer command,
 *   - the `api_balance` agent tool.
 *
 * Data sources, in order: a signed-in DeepSeek account grant
 * (`ctx.deepseekAccount`), then the platform key stored under the
 * `DEEPSEEK_API_KEY` credential reference. No secret ever leaves this file.
 */

const SNAPSHOT_ROUTE = '/plugin/api-balance/snapshot';
const API_KEY_REF = 'DEEPSEEK_API_KEY';
const BALANCE_URL = 'https://api.deepseek.com/user/balance';
const REQUEST_TIMEOUT_MS = 8000;
const DEFAULT_REFRESH_SECONDS = 60;
const DEFAULT_LOW_BALANCE = 5;
const DEFAULT_LINKS = {
  usageUrl: 'https://platform.deepseek.com/usage',
  topUpUrl: 'https://platform.deepseek.com/top_up',
};

function clampInteger(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function record(value) {
  return value && typeof value === 'object' ? value : {};
}

function errorText(error) {
  if (error && typeof error.message === 'string' && error.message) return error.message;
  return String(error);
}

function amountText(value) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return value.toFixed(2);
  return undefined;
}

function toCents(value) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) : 0;
}

function addAmounts(left, right) {
  return ((toCents(left) + toCents(right)) / 100).toFixed(2);
}

function accountMetadata(options) {
  const timezone = Number(options && options.tz);
  return {
    version: '0.2.1',
    locale: typeof options.lang === 'string' && options.lang ? options.lang : 'zh',
    timezoneOffsetSeconds: Number.isFinite(timezone)
      ? Math.round(timezone)
      : -new Date().getTimezoneOffset() * 60,
  };
}

function mergeAccountWallets(rechargeWallets, bonusWallets) {
  const order = [];
  const byCurrency = new Map();
  const ensure = (currency) => {
    const key = typeof currency === 'string' && currency ? currency : 'CNY';
    if (!byCurrency.has(key)) {
      byCurrency.set(key, { currency: key, total: '0.00', granted: '0.00', toppedUp: '0.00' });
      order.push(key);
    }
    return byCurrency.get(key);
  };
  for (const wallet of Array.isArray(rechargeWallets) ? rechargeWallets : []) {
    const item = ensure(wallet && wallet.currency);
    item.toppedUp = addAmounts(item.toppedUp, wallet && wallet.balance);
  }
  for (const wallet of Array.isArray(bonusWallets) ? bonusWallets : []) {
    const item = ensure(wallet && wallet.currency);
    item.granted = addAmounts(item.granted, wallet && wallet.balance);
  }
  return order.map((currency) => {
    const item = byCurrency.get(currency);
    item.total = addAmounts(item.toppedUp, item.granted);
    return item;
  });
}

function apiKeyWallets(balanceInfos) {
  const wallets = [];
  for (const info of Array.isArray(balanceInfos) ? balanceInfos : []) {
    const source = record(info);
    const total = amountText(source.total_balance);
    if (!total) continue;
    const wallet = { currency: typeof source.currency === 'string' ? source.currency : 'CNY', total };
    const granted = amountText(source.granted_balance);
    const toppedUp = amountText(source.topped_up_balance);
    if (granted !== undefined) wallet.granted = granted;
    if (toppedUp !== undefined) wallet.toppedUp = toppedUp;
    wallets.push(wallet);
  }
  return wallets;
}

async function resolveApiKey(ctx) {
  const credentials = ctx.get('credentials');
  if (credentials && typeof credentials.resolve === 'function') {
    try {
      const resolved = await credentials.resolve(API_KEY_REF);
      const value = record(resolved).value;
      if (typeof value === 'string' && value.trim()) return { key: value.trim() };
    } catch {
      // fall through to the ambient process environment
    }
  }
  const ambient = typeof process !== 'undefined' && process.env ? process.env[API_KEY_REF] : undefined;
  if (typeof ambient === 'string' && ambient.trim()) return { key: ambient.trim() };
  return undefined;
}

async function readViaApiKey(ctx, base, meta) {
  const resolved = await resolveApiKey(ctx);
  if (!resolved) {
    return {
      ...base,
      ok: false,
      source: 'none',
      code: 'no-credential',
      message: '未找到 DEEPSEEK_API_KEY 凭据，也没有已登录的 DeepSeek 账户。',
    };
  }
  if (typeof fetch !== 'function') {
    return { ...base, ok: false, source: 'api-key', code: 'unsupported', message: '当前 Host 没有可用的 fetch。' };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(BALANCE_URL, {
      method: 'GET',
      headers: { accept: 'application/json', authorization: `Bearer ${resolved.key}` },
      signal: controller.signal,
    });
    const body = await response.text();
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      payload = undefined;
    }
    if (!response.ok) {
      const upstream = record(record(payload).error).message;
      const message = response.status === 401
        ? 'API Key 无效或已过期（401）。'
        : `DeepSeek 返回 ${response.status}${typeof upstream === 'string' && upstream ? `：${upstream}` : ''}`;
      return { ...base, ok: false, source: 'api-key', code: `http-${response.status}`, message };
    }
    const wallets = apiKeyWallets(record(payload).balance_infos);
    if (!wallets.length) {
      return { ...base, ok: false, source: 'api-key', code: 'empty', message: 'DeepSeek 未返回余额信息。' };
    }
    return {
      ...base,
      ok: true,
      source: 'api-key',
      available: record(payload).is_available === true,
      wallets,
      meta,
    };
  } catch (error) {
    const aborted = error && (error.name === 'AbortError' || error.code === 'ABORT_ERR');
    return {
      ...base,
      ok: false,
      source: 'api-key',
      code: aborted ? 'timeout' : 'network',
      message: aborted ? '查询 DeepSeek 余额超时。' : `无法连接 DeepSeek：${errorText(error)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readBalance(ctx, settings, options) {
  const meta = accountMetadata(options);
  const base = {
    ok: false,
    version: 1,
    source: 'none',
    signedIn: false,
    links: { ...DEFAULT_LINKS },
    refreshSeconds: settings.refreshSeconds,
    lowBalance: settings.lowBalance,
    fetchedAt: Date.now(),
  };

  const account = ctx.get('deepseekAccount');
  if (account) {
    try {
      const view = record(await account.getState());
      const links = record(view.links);
      base.links = {
        usageUrl: typeof links.usageUrl === 'string' && links.usageUrl ? links.usageUrl : DEFAULT_LINKS.usageUrl,
        topUpUrl: typeof links.topUpUrl === 'string' && links.topUpUrl ? links.topUpUrl : DEFAULT_LINKS.topUpUrl,
      };
      base.signedIn = view.status === 'credential-stored';
      if (base.signedIn && typeof account.getBalance === 'function') {
        const details = record(await account.getBalance(meta));
        if (details.status === 'ready') {
          const wallets = mergeAccountWallets(details.value, details.bonusWallets);
          if (wallets.length) {
            return { ...base, ok: true, source: 'account', available: true, wallets, meta };
          }
        }
        return {
          ...base,
          ok: false,
          source: 'account',
          code: 'account-failed',
          message: 'DeepSeek 账户余额查询失败，请稍后重试。',
        };
      }
    } catch {
      // a broken account read must not block the API-key path
    }
  }

  return readViaApiKey(ctx, base, meta);
}

function describe(snapshot) {
  if (!snapshot || snapshot.ok !== true) {
    const message = snapshot && snapshot.message ? snapshot.message : '未知错误';
    return `API 余额查询失败：${message}`;
  }
  const lines = [];
  for (const wallet of snapshot.wallets) {
    let line = `${wallet.currency} 总余额 ${wallet.total}`;
    const parts = [];
    if (wallet.toppedUp !== undefined) parts.push(`充值 ${wallet.toppedUp}`);
    if (wallet.granted !== undefined) parts.push(`赠送 ${wallet.granted}`);
    if (parts.length) line += `（${parts.join('，')}）`;
    lines.push(line);
  }
  if (!lines.length) lines.push('DeepSeek 未返回余额信息。');
  const source = snapshot.source === 'account' ? 'DeepSeek 账户' : 'API Key';
  const stamp = new Date(snapshot.fetchedAt).toLocaleString('zh-CN', { hour12: false });
  lines.push(`数据来源：${source} · 更新于 ${stamp}`);
  if (snapshot.available === false) lines.push('当前余额不足，API 调用可能失败。');
  lines.push(`用量明细：${snapshot.links.usageUrl}`);
  return lines.join('\n');
}

function serviceOf(scope, fallback, name) {
  if (scope && typeof scope.get === 'function') {
    const value = scope.get(name);
    if (value) return value;
  }
  if (scope && scope[name]) return scope[name];
  return fallback.get(name);
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

export function apply(ctx, config) {
  const raw = record(config);
  const settings = {
    refreshSeconds: clampInteger(raw.refreshSeconds, 15, 3600, DEFAULT_REFRESH_SECONDS),
    lowBalance: clampNumber(raw.lowBalance, 0, 1e6, DEFAULT_LOW_BALANCE),
  };

  let cached;
  let cachedAt = 0;
  let inflight;

  function read(options, force) {
    const now = Date.now();
    if (!force && cached && now - cachedAt < settings.refreshSeconds * 1000) {
      return Promise.resolve({ ...cached, cached: true });
    }
    if (inflight) return inflight;
    const pending = readBalance(ctx, settings, options || {})
      .then((value) => {
        cached = value;
        cachedAt = Date.now();
        return value;
      })
      .catch((error) => {
        const message = errorText(error);
        if (cached && cached.ok) {
          return { ...cached, ok: false, stale: true, code: 'internal', message };
        }
        return {
          ok: false,
          version: 1,
          source: 'none',
          signedIn: false,
          code: 'internal',
          message,
          links: { ...DEFAULT_LINKS },
          refreshSeconds: settings.refreshSeconds,
          lowBalance: settings.lowBalance,
          fetchedAt: Date.now(),
        };
      });
    inflight = pending;
    const settle = () => {
      if (inflight === pending) inflight = undefined;
    };
    pending.then(settle, settle);
    return pending;
  }

  ctx.effect(() => ctx.inject(['webServer'], (scope) => {
    const webServer = serviceOf(scope, ctx, 'webServer');
    if (!webServer || typeof webServer.register !== 'function') return undefined;
    return webServer.register({
      kind: 'exact',
      path: SNAPSHOT_ROUTE,
      handler: (request, response) => {
        if (request.method !== 'GET') {
          sendJson(response, 405, { ok: false, code: 'method', message: 'GET only' });
          return;
        }
        const site = request.headers['sec-fetch-site'];
        if (typeof site === 'string' && site !== 'same-origin' && site !== 'none') {
          sendJson(response, 403, { ok: false, code: 'origin', message: 'cross-site request refused' });
          return;
        }
        let url;
        try {
          url = new URL(request.url || '/', 'http://localhost');
        } catch {
          sendJson(response, 400, { ok: false, code: 'url', message: 'bad request' });
          return;
        }
        const fresh = url.searchParams.get('fresh') === '1';
        const lang = url.searchParams.get('lang') || 'zh';
        const rawTimezone = url.searchParams.get('tz');
        const tz = rawTimezone === null ? undefined : Number(rawTimezone);
        Promise.resolve()
          .then(() => read({ lang, tz: Number.isFinite(tz) ? tz : undefined }, fresh))
          .then((snapshot) => sendJson(response, 200, snapshot))
          .catch((error) => sendJson(response, 200, {
            ok: false,
            version: 1,
            source: 'none',
            code: 'internal',
            message: errorText(error),
            links: { ...DEFAULT_LINKS },
            refreshSeconds: settings.refreshSeconds,
            lowBalance: settings.lowBalance,
            fetchedAt: Date.now(),
          }));
      },
    });
  }));

  ctx.effect(() => ctx.inject(['commands'], (scope) => {
    const commands = serviceOf(scope, ctx, 'commands');
    if (!commands || typeof commands.register !== 'function') return undefined;
    return commands.register({
      name: 'balance',
      description: '查询 DeepSeek API 余额（充值 / 赠送 / 总额）',
      handler: async () => {
        const snapshot = await read({}, true);
        if (snapshot.ok !== true) return { kind: 'error', text: describe(snapshot) };
        return { kind: 'success', text: describe(snapshot) };
      },
    });
  }));

  ctx.effect(() => ctx.inject(['tools'], (scope) => {
    const tools = serviceOf(scope, ctx, 'tools');
    if (!tools || typeof tools.register !== 'function') return undefined;
    return tools.register({
      name: 'api_balance',
      description:
        'Read the DeepSeek API wallet balance used by this harness: total, topped-up, and granted credit per currency. Use it when the user asks how much API credit or balance is left.',
      parameters: {
        type: 'object',
        properties: {
          fresh: {
            type: 'boolean',
            description: 'Bypass the Host cache (default 60s) and query DeepSeek now.',
          },
        },
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean' },
            source: { type: 'string' },
            signedIn: { type: 'boolean' },
            available: { type: 'boolean' },
            currency: { type: 'string' },
            fetchedAt: { type: 'number' },
            code: { type: 'string' },
            message: { type: 'string' },
          },
          additionalProperties: true,
        },
        render: (args, value) => [{ type: 'text', text: describe(value) }],
      },
      execute: async (args) => {
        const input = record(args);
        return read({}, input.fresh === true);
      },
    });
  }));
}
