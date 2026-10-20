# dsh-api-balance

> DeepSeek Harness 内置余额显示 · npm package: `dsh-api-balance-plugin`

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) **plugin bundle** that keeps your DeepSeek
API balance in sight: a resident pill under the composer, a click-through detail popover, a `/balance` command,
and an `api_balance` tool the agent can call on its own.

> This is a Harness plugin (a Host half + a browser half + a bundle patch), not a model-facing skill.
> Installing it adds real UI and a real tool to the Harness; a skill only adds instructions to the prompt.

[中文说明](#中文说明) · [Install](#install) · [Configuration](#configuration) · [How it works](#how-it-works) · [Privacy](#data--privacy) · [Limitations](#limitations)

---

## Features

- **Resident pill** in the composer dock, beside the built-in activity and usage entries: `¥128.40`. It refreshes on
  its own and never needs a click to stay current.
- **Detail popover** on click: total balance, topped-up credit, granted credit, the update time, and links to the
  Platform pages for usage detail and top-up.
- **`/balance` command**: type it in the composer and the balance lands in the conversation as a plain text row.
  Nothing is sent to the model and no tokens are spent.
- **`api_balance` tool**: ask the agent “how much credit is left?” and it reads the same values.
- **Both credential styles**: a signed-in DeepSeek account (wallet balances from the account grant) or a plain
  `DEEPSEEK_API_KEY`. It picks whichever you actually have.
- **Theme- and locale-aware**: only `--dsw-alias-*` tokens are used, and the copy follows the active UI language
  (English and Chinese are bundled).

## Requirements

| Requirement | Notes |
|---|---|
| DeepSeek Harness `>= 0.2.1-rc.2` | Tested against `0.2.1-rc.2` (desktop and web). |
| A credential | A signed-in DeepSeek account in the app, or the `DEEPSEEK_API_KEY` credential reference. |
| A DeepSeek account | Other providers do not expose a balance endpoint; see [Limitations](#limitations). |

## Install

**From npm** (recommended) — ask your agent:

> Install the `dsh-api-balance-plugin` plugin bundle.

That runs Plugin Manager's `install_bundle` with the package name, links it into your profile, and enables it. You can
also install it from the app's **Settings → Plugins** area by package name.

**From a local checkout** — clone this repository and install the directory:

> Install the plugin bundle at `D:\path\to\dsh-api-balance-plugin`.

Both routes survive restarts because the bundle is recorded in your profile, not in a session.

## Configuration

Two knobs, both with safe defaults. Override them by targeting the row id `api-balance` in your profile patch layer
(`~/.dsh/profiles/<profile>/cordis.patch.yml`). A matching override replaces the **whole** config, so repeat every
key you still want:

```yaml
- id: api-balance
  name: 'dsh-api-balance-plugin'
  config:
    refreshSeconds: 120
    lowBalance: 20
```

| Key | Default | Meaning |
|---|---|---|
| `refreshSeconds` | `60` | How often the Host re-reads the balance (clamped to 15–3600). The pill polls the Host at the same rate. |
| `lowBalance` | `5` | Below this amount the pill switches to the warning tone and the popover adds a low-balance note. `0` disables it. |

## Usage

| Surface | What happens |
|---|---|
| Composer dock | `¥128.40` with a state dot. Green = available, amber = low balance or a failed read, grey = unavailable. |
| Click the pill | Popover with `总余额 / 充值 / 赠送`, update time, `用量明细` and `去充值` links, plus an `Esc`-to-close dialog and a manual refresh button. |
| `/balance` | A command row with the same numbers; errors (no credential, 401, timeout) print their reason. |
| Agent tool | `api_balance` with an optional `fresh` flag to bypass the Host cache. |

The popover reads through the Host, so the API key never reaches the browser: the page only ever sees amounts.

## Data & privacy

- The Host reads `ctx.deepseekAccount.getBalance()` when an account grant is stored; otherwise it resolves the
  `DEEPSEEK_API_KEY` credential reference (provider store first, then the ambient environment) and calls
  `GET https://api.deepseek.com/user/balance`.
- The browser receives a JSON snapshot of **amounts only** — no token, no key, no profile.
- The snapshot route is `GET /plugin/api-balance/snapshot`, same-origin guarded (a cross-site `sec-fetch-site`
  is answered with 403; other methods get 405). It is registered on the local Harness web server only.
- The Host caches one snapshot for `refreshSeconds` so several surfaces never multiply upstream calls.
- Nothing is written to disk by this plugin; it keeps no history and sends no telemetry.

## Limitations

- **DeepSeek only.** The plugin reads the DeepSeek Platform wallet. OpenAI, Anthropic and most other providers do not
  publish a balance endpoint, so a generic “balance” panel is not something one adapter can cover.
- **Balance, not itemized usage.** The public API exposes the wallet, not a usage ledger, so “usage detail” is a link
  into the Platform page where you are already signed in.
- **Sign-in happens in the app.** If you use an API key, that is all the plugin needs. Account wallets only appear when
  the Harness account sign-in is complete.
- The pill needs a Web-surface client (the composer dock is a browser slot); `/balance` and the tool are Host-side and
  work wherever a composer or an agent exists.

## How it works

| File | Role |
|---|---|
| `index.js` | Host half: one `read()` shared by the HTTP route, the `/balance` command and the `api_balance` tool, with a TTL cache and upstream failure reporting. |
| `client.js` | Browser half: a `conversation.composer.dock` entry that renders the pill and a fixed-position popover, polls the route, and follows `ctx.locale`. |
| `cordis.patch.yml` | Bundle patch: inserts row `api-balance` with its default config. |
| `locale/{en,zh}.json` | Plugin Manager title and description. |
| `icon.svg` | Original artwork (circle + `¥`), no third-party assets. |

Registration points: `ctx.webServer.register`, `ctx.commands.register`, `ctx.tools.register`,
`ctx.slots.inject('conversation.composer.dock')`. Everything is registered through `ctx.inject`/`ctx.effect`, so
disabling the bundle removes the route, the command, the tool and the pill together.

### Local development

```bash
npm run check          # node --check on both halves
```

The Host half is plain ESM and the browser half is plain JS registered through `window.__ModuleLoader__`, so there is
no build step. After editing, reinstall the directory (or restart the Harness) to pick up a fresh module generation.

## Publishing checklist

The repository already carries an initial commit and a `v1.0.0` tag, and the package name `dsh-api-balance-plugin` was
checked free on npm on 2026-10-20. What is left runs under your own account:

1. **Metadata** — `author`, `repository`, `homepage` and `bugs` already point at `Muzi1015/dsh-api-balance`;
   adjust them if you publish under another account.
2. **GitHub** — the public repository `Muzi1015/dsh-api-balance` is already created and empty; push the prepared
   commit and tag:

```bash
git remote add origin git@github.com:Muzi1015/dsh-api-balance.git
git push -u origin main --tags
```

3. **npm** — `npm login`, then `npm publish`. A scoped alternative (`@<your-scope>/dsh-api-balance-plugin`) needs the
   three renames below plus `--access public`.

If the name is ever taken, rename in exactly three places — `package.json` `name`, the `id` in `client.js`, and the
`name` in `cordis.patch.yml` — and reinstall the bundle.

A screenshot of the pill and popover is the one asset this repository cannot generate on its own — add one to the
README before announcing it.

## License

The Unlicense (public domain) — see [LICENSE](LICENSE).

---

<a id="中文说明"></a>
## 中文说明

**这是什么**：一个 DeepSeek Harness 插件包（Host 半 + 浏览器半 + bundle 补丁），不是 skill。装进 Harness 后会真实增加
UI 和一个工具；skill 只是给模型的提示词文本。

**别人怎么用**：让他的 agent 说「安装 `dsh-api-balance-plugin` 插件包」（Plugin Manager 的 `install_bundle`），或者在设置 →
插件里按包名安装；本地克隆的目录也可以直接作为安装目标。

**他能看到什么**：

- 输入框下方常驻小胶囊，显示实时余额，点击展开「总余额 / 充值 / 赠送」、更新时间，以及「用量明细」「去充值」链接；
- 在输入框输入 `/balance`，余额以文本行落在会话里，不发给模型、不花 token；
- 对 agent 说「查下余额」，它会调用 `api_balance` 工具。

**凭据**：优先用 App 里已登录的 DeepSeek 账户钱包；没有登录就用 `DEEPSEEK_API_KEY` 凭据去查
`https://api.deepseek.com/user/balance`。浏览器只能拿到金额，拿不到 Key。

**配置**：在 profile 的 `cordis.patch.yml` 里覆盖 `api-balance` 行，`refreshSeconds`（默认 60，15–3600）和
`lowBalance`（默认 5，低于它胶囊变橙色）。**注意覆盖会替换整份 config，两个键都要写。**

**限制**：只支持 DeepSeek（其他厂商没有余额接口）；只能看余额，明细跳平台页面；胶囊需要 Web 界面。

**发布前**：包名 `dsh-api-balance-plugin` 已于 2026-10-20 确认在 npm 上可用；本地已有一次提交和 `v1.0.0` 标签。
你只需要：在 GitHub 建一个空的同名仓库并 push，然后 `npm login` + `npm publish`。如果哪天要改包名，只需改
`package.json` 的 `name`、`client.js` 的 `id`、`cordis.patch.yml` 的 `name` 三处，再重装一次即可。
