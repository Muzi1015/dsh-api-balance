window.__ModuleLoader__.load({
  id: 'dsh-api-balance-plugin',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useRef, useState } = React;

    const ENDPOINT = '/plugin/api-balance/snapshot';
    const DEFAULT_REFRESH_SECONDS = 60;
    const POLL_MIN_SECONDS = 15;
    const POPOVER_WIDTH = 272;

    const CURRENCY_SYMBOL = { CNY: '¥', USD: '$', EUR: '€', GBP: '£', JPY: '¥' };

    const TEXT = {
      zh: {
        title: 'API 余额',
        loading: '余额查询中',
        unavailable: '余额不可用',
        refresh: '刷新',
        close: '关闭',
        updated: '更新于',
        sourceAccount: 'DeepSeek 账户',
        sourceApiKey: 'API Key',
        granted: '赠送',
        toppedUp: '充值',
        usage: '用量明细',
        topUp: '去充值',
        insufficient: '当前余额不足，API 调用可能失败。',
        hint: '在输入框输入 /balance 也可以查询',
        pillTitle: 'DeepSeek API 余额 · 点击查看明细',
        stale: '刷新失败，显示上次结果',
      },
      en: {
        title: 'API balance',
        loading: 'Checking balance',
        unavailable: 'Balance unavailable',
        refresh: 'Refresh',
        close: 'Close',
        updated: 'Updated',
        sourceAccount: 'DeepSeek account',
        sourceApiKey: 'API key',
        granted: 'Granted',
        toppedUp: 'Topped up',
        insufficient: 'Balance is low; API calls may start failing.',
        hint: 'Type /balance in the composer to check it too',
        pillTitle: 'DeepSeek API balance · click for details',
        stale: 'Refresh failed; showing the last result',
      },
    };

    function dictFor(lang) {
      return /^zh/i.test(lang || '') ? TEXT.zh : TEXT.en;
    }

    function formatMoney(currency, raw) {
      const symbol = CURRENCY_SYMBOL[currency];
      const prefix = symbol || (currency ? String(currency) + ' ' : '');
      const value = Number(raw);
      if (!Number.isFinite(value)) return prefix + String(raw);
      const sign = value < 0 ? '-' : '';
      const magnitude = Math.abs(value);
      if (magnitude > 0 && magnitude < 0.01) return sign + prefix + '<0.01';
      const body = magnitude.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
      return sign + prefix + body;
    }

    function walletsOf(snapshot) {
      return snapshot && Array.isArray(snapshot.wallets) ? snapshot.wallets : [];
    }

    function pillText(snapshot, dict) {
      if (!snapshot) return dict.loading;
      if (snapshot.ok !== true) return dict.unavailable;
      const wallets = walletsOf(snapshot);
      if (!wallets.length) return dict.unavailable;
      return wallets.map((wallet) => formatMoney(wallet.currency, wallet.total)).join(' · ');
    }

    function isLowBalance(snapshot) {
      if (!snapshot || snapshot.ok !== true) return false;
      const threshold = Number(snapshot.lowBalance);
      if (!Number.isFinite(threshold) || threshold <= 0) return false;
      return walletsOf(snapshot).some((wallet) => Number(wallet.total) < threshold);
    }

    function refreshIcon() {
      return h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': 'true', fill: 'none' },
        h('path', {
          d: 'M13.2 8a5.2 5.2 0 1 1-1.6-3.7',
          stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round',
        }),
        h('path', {
          d: 'M13.4 2.6v3.2h-3.2',
          stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round',
        }));
    }

    function closeIcon() {
      return h('svg', { width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': 'true', fill: 'none' },
        h('path', {
          d: 'M4.2 4.2l7.6 7.6M11.8 4.2l-7.6 7.6',
          stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round',
        }));
    }

    const CSS = [
      '.apib-root{display:inline-flex;align-items:center;min-width:0}',
      '.apib-pill{display:inline-flex;align-items:center;gap:6px;height:22px;padding:0 9px;border-radius:999px;',
      'border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);',
      'font-family:inherit;font-size:12px;line-height:1;cursor:pointer;white-space:nowrap;font-variant-numeric:tabular-nums;',
      'transition:color .12s ease,background .12s ease,border-color .12s ease}',
      '.apib-pill:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}',
      '.apib-pill:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.apib-pill[data-state="warn"]{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary)}',
      '.apib-dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-state-success-primary)}',
      '.apib-pill[data-state="warn"] .apib-dot{background:var(--dsw-alias-state-warn-primary)}',
      '.apib-pill[data-state="muted"] .apib-dot{background:var(--dsw-alias-state-idle-primary)}',
      '.apib-pop{position:fixed;z-index:80;box-sizing:border-box;padding:12px;border-radius:12px;',
      'border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);',
      'box-shadow:0 12px 32px rgba(0,0,0,.22);font-family:inherit;font-size:12px;line-height:1.5;text-align:left;outline:none}',
      '.apib-pop:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.apib-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}',
      '.apib-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}',
      '.apib-head-actions{display:inline-flex;align-items:center;gap:2px}',
      '.apib-icon{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;padding:0;border:0;',
      'border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}',
      '.apib-icon:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.apib-icon:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.apib-icon[disabled]{opacity:.5;cursor:default}',
      '.apib-wallets{display:flex;flex-direction:column;gap:10px}',
      '.apib-wallet{border-top:1px solid var(--dsw-alias-border-l1);padding-top:8px}',
      '.apib-wallet:first-child{border-top:0;padding-top:0}',
      '.apib-wallet-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}',
      '.apib-currency{font-size:11px;color:var(--dsw-alias-label-secondary)}',
      '.apib-total{font-size:18px;font-weight:600;font-variant-numeric:tabular-nums}',
      '.apib-split{display:flex;flex-wrap:wrap;gap:4px 14px;margin-top:4px;color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.apib-split-value{color:var(--dsw-alias-label-primary);font-weight:500;font-variant-numeric:tabular-nums}',
      '.apib-error{margin-top:8px;padding:6px 8px;border-radius:8px;background:var(--dsw-alias-bg-layer-2);',
      'color:var(--dsw-alias-state-error-primary);font-size:11px;word-break:break-word}',
      '.apib-warn{margin-top:8px;color:var(--dsw-alias-state-warn-primary);font-size:11px}',
      '.apib-meta{margin-top:8px;color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.apib-links{display:flex;gap:8px;margin-top:10px}',
      '.apib-link{display:inline-flex;align-items:center;height:24px;padding:0 10px;border-radius:8px;',
      'border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-primary);font-size:11px;text-decoration:none}',
      '.apib-link:hover{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}',
      '.apib-link:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}',
      '.apib-hint{margin-top:8px;color:var(--dsw-alias-label-secondary);font-size:11px}',
    ].join('');

    return {
      inject: ['slots'],
      apply(ctx) {
        const localeService = (() => {
          try {
            return ctx.get('locale');
          } catch (error) {
            return undefined;
          }
        })();

        function readActiveLocale() {
          try {
            const snapshot = localeService && typeof localeService.getLocale === 'function'
              ? localeService.getLocale()
              : undefined;
            if (snapshot && typeof snapshot.active === 'string' && snapshot.active) return snapshot.active;
          } catch (error) {
            // fall back to the browser language
          }
          return typeof navigator !== 'undefined' && navigator && typeof navigator.language === 'string'
            ? navigator.language
            : 'en';
        }

        function useActiveLocale() {
          const [active, setActive] = useState(readActiveLocale);
          useEffect(() => {
            if (!localeService || typeof localeService.subscribe !== 'function') return undefined;
            return localeService.subscribe(() => setActive(readActiveLocale()));
          }, []);
          return active;
        }

        function ApiBalanceDock() {
          const lang = useActiveLocale();
          const dict = dictFor(lang);

          const [snapshot, setSnapshot] = useState(null);
          const [failure, setFailure] = useState('');
          const [busy, setBusy] = useState(true);
          const [open, setOpen] = useState(false);
          const [anchor, setAnchor] = useState(null);

          const mounted = useRef(true);
          const trigger = useRef(null);
          const popover = useRef(null);
          const langRef = useRef(lang);
          const openRef = useRef(false);
          langRef.current = lang;
          openRef.current = open;

          useEffect(() => {
            mounted.current = true;
            return () => {
              mounted.current = false;
            };
          }, []);

          const load = useCallback((fresh) => {
            if (typeof fetch !== 'function') {
              setFailure(dictFor(langRef.current).unavailable);
              setBusy(false);
              return undefined;
            }
            setBusy(true);
            let url = ENDPOINT + '?fresh=' + (fresh ? '1' : '0');
            url += '&lang=' + encodeURIComponent(langRef.current || 'en');
            url += '&tz=' + (-new Date().getTimezoneOffset() * 60);
            return fetch(url, { headers: { accept: 'application/json' }, credentials: 'same-origin' })
              .then((response) => (response.ok ? response.json() : Promise.reject(new Error('HTTP ' + response.status))))
              .then((data) => {
                if (!mounted.current) return;
                if (data && typeof data === 'object') {
                  setSnapshot(data);
                  setFailure('');
                } else {
                  setFailure(dictFor(langRef.current).unavailable);
                }
              })
              .catch((error) => {
                if (!mounted.current) return;
                setFailure((error && error.message) || String(error));
              })
              .then(() => {
                if (mounted.current) setBusy(false);
              });
          }, []);

          useEffect(() => {
            load(false);
          }, [load]);

          const refreshSeconds = snapshot && Number(snapshot.refreshSeconds) > 0
            ? Number(snapshot.refreshSeconds)
            : DEFAULT_REFRESH_SECONDS;

          useEffect(() => {
            const id = setInterval(() => {
              if (!openRef.current) load(false);
            }, Math.max(POLL_MIN_SECONDS, refreshSeconds) * 1000);
            return () => clearInterval(id);
          }, [load, refreshSeconds]);

          const place = useCallback(() => {
            const node = trigger.current;
            if (!node || typeof node.getBoundingClientRect !== 'function') return;
            const rect = node.getBoundingClientRect();
            const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : POPOVER_WIDTH + 16;
            const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : 600;
            const width = Math.min(POPOVER_WIDTH, Math.max(200, viewportWidth - 16));
            const left = Math.max(8, Math.min(rect.left, Math.max(8, viewportWidth - width - 8)));
            const bottom = Math.max(8, viewportHeight - rect.top + 8);
            setAnchor({ left, bottom, width });
          }, []);

          const openPopover = useCallback(() => {
            place();
            setOpen(true);
            load(false);
          }, [load, place]);

          useEffect(() => {
            if (!open) return undefined;
            const onPointerDown = (event) => {
              const target = event.target;
              if (popover.current && popover.current.contains(target)) return;
              if (trigger.current && trigger.current.contains(target)) return;
              setOpen(false);
            };
            const onKeyDown = (event) => {
              if (event.key !== 'Escape') return;
              setOpen(false);
              if (trigger.current && typeof trigger.current.focus === 'function') trigger.current.focus();
            };
            const reposition = () => place();
            document.addEventListener('pointerdown', onPointerDown, true);
            document.addEventListener('keydown', onKeyDown, true);
            window.addEventListener('resize', reposition);
            window.addEventListener('scroll', reposition, true);
            if (popover.current && typeof popover.current.focus === 'function') popover.current.focus();
            return () => {
              document.removeEventListener('pointerdown', onPointerDown, true);
              document.removeEventListener('keydown', onKeyDown, true);
              window.removeEventListener('resize', reposition);
              window.removeEventListener('scroll', reposition, true);
            };
          }, [open, place]);

          const wallets = walletsOf(snapshot);
          const ok = !!snapshot && snapshot.ok === true;
          const low = isLowBalance(snapshot);
          const state = !ok ? (wallets.length ? 'warn' : 'muted') : (low ? 'warn' : 'ok');
          const errorMessage = ok ? '' : (failure || (snapshot && snapshot.message) || dict.unavailable);
          const insufficient = ok && snapshot.available === false;
          const stale = !ok && snapshot && snapshot.stale === true && wallets.length > 0;

          const statusBits = [];
          if (snapshot && snapshot.source === 'account') statusBits.push(dict.sourceAccount);
          else if (snapshot && snapshot.source === 'api-key') statusBits.push(dict.sourceApiKey);
          if (snapshot && snapshot.fetchedAt) {
            statusBits.push(dict.updated + ' ' + new Date(snapshot.fetchedAt).toLocaleTimeString(lang, { hour12: false }));
          }

          const renderWallet = (wallet, index) => {
            const split = [];
            if (wallet.toppedUp !== undefined) {
              split.push(h('span', { key: 'toppedUp', className: 'apib-split-item' },
                dict.toppedUp + ' ',
                h('b', { className: 'apib-split-value' }, formatMoney(wallet.currency, wallet.toppedUp))));
            }
            if (wallet.granted !== undefined) {
              split.push(h('span', { key: 'granted', className: 'apib-split-item' },
                dict.granted + ' ',
                h('b', { className: 'apib-split-value' }, formatMoney(wallet.currency, wallet.granted))));
            }
            const children = [
              h('div', { key: 'head', className: 'apib-wallet-head' },
                h('span', { className: 'apib-currency' }, wallet.currency),
                h('span', { className: 'apib-total' }, formatMoney(wallet.currency, wallet.total))),
            ];
            if (split.length) children.push(h('div', { key: 'split', className: 'apib-split' }, split));
            return h('div', { key: 'wallet-' + index, className: 'apib-wallet' }, children);
          };

          const link = (label, href, key) => {
            if (!href) return null;
            return h('a', {
              key,
              className: 'apib-link',
              href,
              target: '_blank',
              rel: 'noreferrer noopener',
            }, label);
          };

          const popoverStyle = anchor
            ? { left: anchor.left + 'px', bottom: anchor.bottom + 'px', width: anchor.width + 'px' }
            : { left: '8px', bottom: '56px', width: POPOVER_WIDTH + 'px' };

          const popoverNode = open
            ? h('div', {
              className: 'apib-pop',
              style: popoverStyle,
              role: 'dialog',
              'aria-label': dict.title,
              tabIndex: -1,
              ref: popover,
            },
            h('div', { className: 'apib-head' },
              h('span', { className: 'apib-title' }, dict.title),
              h('span', { className: 'apib-head-actions' },
                h('button', {
                  type: 'button',
                  className: 'apib-icon',
                  title: dict.refresh,
                  'aria-label': dict.refresh,
                  disabled: busy,
                  onClick: () => load(true),
                }, refreshIcon()),
                h('button', {
                  type: 'button',
                  className: 'apib-icon',
                  title: dict.close,
                  'aria-label': dict.close,
                  onClick: () => {
                    setOpen(false);
                    if (trigger.current && typeof trigger.current.focus === 'function') trigger.current.focus();
                  },
                }, closeIcon()))),
            wallets.length ? h('div', { className: 'apib-wallets' }, wallets.map(renderWallet)) : null,
            errorMessage ? h('div', { className: 'apib-error' }, errorMessage) : null,
            stale ? h('div', { className: 'apib-warn' }, dict.stale) : null,
            insufficient ? h('div', { className: 'apib-warn' }, dict.insufficient) : null,
            statusBits.length ? h('div', { className: 'apib-meta' }, statusBits.join(' · ')) : null,
            h('div', { className: 'apib-links' },
              link(dict.usage, snapshot && snapshot.links && snapshot.links.usageUrl, 'usage'),
              link(dict.topUp, snapshot && snapshot.links && snapshot.links.topUpUrl, 'topUp')),
            h('div', { className: 'apib-hint' }, dict.hint))
            : null;

          const pill = h('button', {
            type: 'button',
            ref: trigger,
            className: 'apib-pill',
            'data-state': state,
            'aria-haspopup': 'dialog',
            'aria-expanded': open ? 'true' : 'false',
            title: dict.pillTitle,
            onClick: () => {
              if (open) {
                setOpen(false);
                return;
              }
              openPopover();
            },
          },
          h('span', { className: 'apib-dot', 'aria-hidden': 'true' }),
          h('span', { className: 'apib-pill-text' }, busy && !snapshot ? dict.loading : pillText(snapshot, dict)));

          return h('div', { className: 'apib-root' }, h('style', null, CSS), pill, popoverNode);
        }

        ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
          name: 'conversation.composer.dock',
          id: 'api-balance',
          order: 2,
        }, ApiBalanceDock));
      },
    };
  },
});
