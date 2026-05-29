/**
 * Re'forma — グローバルナビゲーションバー
 *
 * 全ページ共通の4タブボトムナビゲーション。
 * <script src="js/navbar.js"></script> を </body> の直前に置くだけで動作する。
 * 現在のページURLからアクティブタブを自動判定する。
 */
(function () {
  'use strict';

  // ── タブ定義 ────────────────────────────────────────────────
  var TABS = [
    {
      id: 'capture',
      label: '撮影',
      href: 'batting.html?mode=capture',
      match: function (p, q) { return p === '/batting.html' && q !== 'upload'; },
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
            '<circle cx="12" cy="12" r="3.5"/>' +
            '<path d="M20.5 7.5h-2.09A2 2 0 0116.76 6l-.72-1.5A2 2 0 0014.28 3H9.72a2 2 0 00-1.76 1.5L7.24 6A2 2 0 015.59 7.5H3.5A1.5 1.5 0 002 9v10a1.5 1.5 0 001.5 1.5h17A1.5 1.5 0 0022 19V9a1.5 1.5 0 00-1.5-1.5z"/>' +
            '</svg>',
    },
    {
      id: 'upload',
      label: '動画解析',
      href: 'batting.html?mode=upload',
      match: function (p, q) { return p === '/batting.html' && q === 'upload'; },
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
            '<rect x="2" y="3" width="20" height="14" rx="2"/>' +
            '<path d="M8 21h8M12 17v4"/>' +
            '<path d="M9 10l3-3 3 3M12 7v6"/>' +
            '</svg>',
    },
    {
      id: 'records',
      label: '記録',
      href: 'records.html',
      match: function (p) { return p === '/records.html'; },
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/>' +
            '<polyline points="14 2 14 8 20 8"/>' +
            '<line x1="16" y1="13" x2="8" y2="13"/>' +
            '<line x1="16" y1="17" x2="8" y2="17"/>' +
            '<polyline points="10 9 9 9 8 9"/>' +
            '</svg>',
    },
    {
      id: 'settings',
      label: '設定',
      href: 'settings.html',
      match: function (p) { return p === '/settings.html'; },
      icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
            '<circle cx="12" cy="12" r="3"/>' +
            '<path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>' +
            '</svg>',
    },
  ];

  // ── アクティブタブ判定 ─────────────────────────────────────
  function getActiveId() {
    var pathname = window.location.pathname;
    var search   = new URLSearchParams(window.location.search).get('mode') || '';
    for (var i = 0; i < TABS.length; i++) {
      if (TABS[i].match(pathname, search)) return TABS[i].id;
    }
    // batting_result.html 等はナビ対象外ページ（ハイライトなし）
    return null;
  }

  // ── ナビバーHTMLを生成 ──────────────────────────────────────
  function buildNavbar() {
    var activeId = getActiveId();
    var nav = document.createElement('nav');
    nav.id = 'rf-global-nav';
    nav.setAttribute('role', 'navigation');
    nav.setAttribute('aria-label', 'メインメニュー');

    var inner = '';
    for (var i = 0; i < TABS.length; i++) {
      var t = TABS[i];
      var isActive = (t.id === activeId);
      inner +=
        '<a class="rf-nav-btn' + (isActive ? ' active' : '') + '" ' +
        'href="' + t.href + '" ' +
        'aria-current="' + (isActive ? 'page' : 'false') + '">' +
        '<span class="rf-nav-icon" aria-hidden="true">' + t.icon + '</span>' +
        '<span class="rf-nav-label">' + t.label + '</span>' +
        '</a>';
    }
    nav.innerHTML = inner;
    return nav;
  }

  // ── CSS注入 ───────────────────────────────────────────────
  function injectCSS() {
    if (document.getElementById('rf-navbar-css')) return;
    var style = document.createElement('style');
    style.id = 'rf-navbar-css';
    style.textContent =
      '#rf-global-nav {' +
      '  position: fixed; bottom: 0; left: 0; right: 0; z-index: 1000;' +
      '  display: flex; background: #0b0e13;' +
      '  border-top: 1px solid #21262d;' +
      '  padding-bottom: env(safe-area-inset-bottom, 0px);' +
      '  -webkit-backdrop-filter: blur(12px); backdrop-filter: blur(12px);' +
      '}' +
      '.rf-nav-btn {' +
      '  flex: 1; display: flex; flex-direction: column; align-items: center;' +
      '  justify-content: center; gap: 3px; padding: 9px 4px 8px;' +
      '  text-decoration: none; color: #6e7681;' +
      '  font-size: 10px; letter-spacing: 0.3px; font-weight: 500;' +
      '  touch-action: manipulation; -webkit-tap-highlight-color: transparent;' +
      '  transition: color 0.15s; position: relative;' +
      '}' +
      '.rf-nav-btn::after {' +
      '  content: ""; position: absolute; top: 0; left: 25%; right: 25%;' +
      '  height: 2px; border-radius: 0 0 2px 2px; background: #ef4444;' +
      '  opacity: 0; transition: opacity 0.15s;' +
      '}' +
      '.rf-nav-btn.active { color: #ef4444; }' +
      '.rf-nav-btn.active::after { opacity: 1; }' +
      '.rf-nav-icon { width: 22px; height: 22px; display: flex; align-items: center; justify-content: center; }' +
      '.rf-nav-icon svg { width: 22px; height: 22px; }' +
      '.rf-nav-label { font-size: 10px; }' +
      '/* ナビバー分の余白 */' +
      'body { padding-bottom: calc(56px + env(safe-area-inset-bottom, 0px)); }';
    document.head.appendChild(style);
  }

  // ── マウント ──────────────────────────────────────────────
  function mount() {
    // batting_result.html は独自タブバーがあるのでグローバルナビの余白調整のみ
    var pathname = window.location.pathname;
    injectCSS();

    // 結果ページ以外はナビバーを表示
    if (pathname !== '/batting_result.html') {
      document.body.appendChild(buildNavbar());
    } else {
      // 結果ページ: body padding だけ調整（ローカルタブバーがあるため非表示）
      var s = document.createElement('style');
      s.textContent = 'body { padding-bottom: 0 !important; }';
      document.head.appendChild(s);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
