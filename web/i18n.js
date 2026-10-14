/* 4 Horseman Security — languages for the website, the dashboard, the client portal and the app.
   English is written in the pages themselves. For any other language this file loads i18n/<lang>.js,
   a dictionary keyed by the English text, and translates the page as it is drawn:
     - text nodes and the placeholder / title / aria-label / alt attributes whose whole text is a key;
     - short runs of text with inline tags (<b>, <a>, …) whose key writes the tags as <0>…</0>, <1>…</1>;
     - keys with {placeholders} ("{n} officers on duty") match text with any value in their place.
   Code can also call t('English text', { n: 3 }). Names, report text and anything else people type are
   never keys, so they are left as written. Mark an element translate="no" to skip it entirely. */
(function () {
  'use strict';
  var LANGS = [['en', 'English'], ['es', 'Español'], ['fr', 'Français'], ['ht', 'Kreyòl ayisyen'], ['pt', 'Português'],
    ['ar', 'العربية'], ['ru', 'Русский'], ['de', 'Deutsch'], ['fil', 'Filipino']];
  // Date and number formats. Haitian Creole uses French formats; Arabic keeps Western digits for times and amounts.
  var LOCALES = { en: 'en-US', es: 'es-US', fr: 'fr-FR', ht: 'fr-HT', pt: 'pt-BR', ar: 'ar-u-nu-latn', ru: 'ru-RU', de: 'de-DE', fil: 'fil-PH' };
  var KEY = 'hm_lang', codes = LANGS.map(function (l) { return l[0]; });
  function stored() { try { return localStorage.getItem(KEY); } catch (e) { return null; } }
  function pick() {
    var q = /[?&]lang=([a-z]{2,3})/.exec(location.search);
    if (q && codes.indexOf(q[1]) >= 0) { try { localStorage.setItem(KEY, q[1]); } catch (e) { } return q[1]; }
    var s = stored(); if (s && codes.indexOf(s) >= 0) return s;
    var nav = navigator.languages || [navigator.language || 'en'];
    for (var i = 0; i < nav.length; i++) {
      var n = String(nav[i]).toLowerCase(), base = n.split('-')[0];
      if (n === 'tl' || base === 'tl') return 'fil';
      if (codes.indexOf(base) >= 0) return base;
    }
    return 'en';
  }
  var collect = null; try { if (localStorage.getItem('hm_i18n_collect')) collect = {}; } catch (e) { }
  var lang = collect ? 'xx' : pick(), dict = {}, patterns = [], ready = lang === 'en' || !!collect;
  var me = document.currentScript, base = me && me.src ? me.src.replace(/[^/]*$/, '') : '';
  var root = document.documentElement;
  root.lang = lang; root.dir = lang === 'ar' ? 'rtl' : 'ltr';

  var I18N = window.I18N = {
    lang: lang, langs: LANGS, locale: LOCALES[lang] || 'en-US', rtl: lang === 'ar',
    // Called by i18n/<lang>.js
    // pat: the keys with {placeholders} that may appear in the page as finished text (the rest are only used through t()).
    add: function (code, d, pat) {
      if (code !== lang) return;
      for (var k in d) if (Object.prototype.hasOwnProperty.call(d, k) && d[k]) dict[norm(k)] = d[k];
      (pat || []).forEach(function (k) { k = norm(k); if (dict[k]) patterns.push(compile(k, dict[k])); });
      patterns.sort(function (a, b) { return b.len - a.len; });
      ready = true; if (document.body) apply(document.body);
    },
    set: function (code) {
      if (codes.indexOf(code) < 0) return;
      try { localStorage.setItem(KEY, code); } catch (e) { }
      var u = new URL(location.href); u.searchParams.delete('lang'); location.replace(u.toString());
    },
    t: t, apply: function (el) { apply(el || document.body); },
    collected: function () { return collect ? Object.keys(collect) : []; },
    // A language menu (<select>) for headers and settings screens.
    picker: function (cls) {
      var s = document.createElement('select');
      s.className = cls || 'lang-select'; s.setAttribute('aria-label', t('Language')); s.setAttribute('translate', 'no');
      LANGS.forEach(function (l) { var o = document.createElement('option'); o.value = l[0]; o.textContent = l[1]; if (l[0] === lang) o.selected = true; s.appendChild(o); });
      s.addEventListener('change', function () { I18N.set(s.value); });
      return s;
    }
  };
  window.t = t;

  function norm(s) { return String(s).replace(/\s+/g, ' ').trim(); }
  function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  function compile(key, val) {
    var names = [], re = '', last = 0, m, rx = /\{(\w+)\}/g;
    while ((m = rx.exec(key))) { re += esc(key.slice(last, m.index)) + '(.+?)'; names.push(m[1]); last = m.index + m[0].length; }
    re += esc(key.slice(last));
    return { re: new RegExp('^' + re + '$'), names: names, val: val, len: key.length };
  }
  function fill(s, vars) { return vars ? String(s).replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; }) : s; }
  // Translate one piece of text: exact key first, then the {placeholder} patterns (their values are translated too when they are keys).
  function lookup(text) {
    var k = norm(text); if (!k) return null;
    if (Object.prototype.hasOwnProperty.call(dict, k)) return dict[k];
    if (collect && /[A-Za-z]/.test(k)) collect[k] = 1;
    for (var i = 0; i < patterns.length; i++) {
      var p = patterns[i], m = p.re.exec(k); if (!m) continue;
      var vars = {}; for (var j = 0; j < p.names.length; j++) { var v = m[j + 1]; vars[p.names[j]] = Object.prototype.hasOwnProperty.call(dict, v) ? dict[v] : v; }
      return fill(p.val, vars);
    }
    return null;
  }
  function t(key, vars) {
    if (collect) { collect['@@' + norm(key)] = 1; return fill(key, vars); }
    if (lang === 'en') return fill(key, vars);
    var k = norm(key);
    return fill(Object.prototype.hasOwnProperty.call(dict, k) ? dict[k] : (vars ? k : (lookup(k) || key)), vars);
  }

  // ---- translating the page ----
  var SKIP = { SCRIPT: 1, STYLE: 1, TEXTAREA: 1, CODE: 1, PRE: 1, NOSCRIPT: 1, svg: 1, SVG: 1, OPTION: 0 };
  var INLINE = { B: 1, STRONG: 1, I: 1, EM: 1, A: 1, SPAN: 1, SMALL: 1, U: 1, MARK: 1, BR: 1, SUP: 1, SUB: 1, KBD: 1 };
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  var done = new WeakMap(); // element -> the key it was translated from (so a re-render is translated again)
  function skipEl(el) { return SKIP[el.nodeName] || el.getAttribute('translate') === 'no' || el.isContentEditable; }
  // Text with inline tags as a key: "Up to <0>2 sites</0> with post orders". Returns null if the element is not a plain phrase.
  function template(el, list) {
    var out = '', kids = el.childNodes;
    for (var i = 0; i < kids.length; i++) {
      var n = kids[i];
      if (n.nodeType === 3) out += n.nodeValue;
      else if (n.nodeType === 1) {
        if (!INLINE[n.nodeName] || n.getAttribute('translate') === 'no') return null;
        var idx = list.length; list.push(n);
        if (n.nodeName === 'BR') { out += '<br>'; continue; }
        var inner = template(n, list); if (inner == null) return null;
        out += '<' + idx + '>' + inner + '</' + idx + '>';
      }
    }
    return out;
  }
  function rebuild(el, str, list) {
    var frag = document.createDocumentFragment(), stack = [frag], rx = /<(\d+)>|<\/(\d+)>|<br\s*\/?>/g, last = 0, m;
    function text(s) { if (s) stack[stack.length - 1].appendChild(document.createTextNode(s)); }
    while ((m = rx.exec(str))) {
      text(str.slice(last, m.index)); last = m.index + m[0].length;
      if (m[1] != null) { var src = list[+m[1]]; var c = src ? src.cloneNode(false) : document.createElement('span'); stack[stack.length - 1].appendChild(c); stack.push(c); }
      else if (m[2] != null) { if (stack.length > 1) stack.pop(); }
      else stack[stack.length - 1].appendChild(document.createElement('br'));
    }
    text(str.slice(last));
    el.textContent = ''; el.appendChild(frag);
  }
  function attrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i], v = el.getAttribute(a); if (!v) continue;
      var tr = lookup(v); if (tr != null && tr !== v) el.setAttribute(a, tr);
    }
    if ((el.nodeName === 'INPUT' && (el.type === 'submit' || el.type === 'button')) && el.value) { var tv = lookup(el.value); if (tv) el.value = tv; }
  }
  function textNode(n) {
    var v = n.nodeValue; if (!v || !/[A-Za-z]/.test(v)) return;
    var tr = lookup(v); if (tr == null) return;
    var lead = /^\s*/.exec(v)[0], trail = /\s*$/.exec(v)[0], nv = lead + tr + trail;
    if (nv !== v) n.nodeValue = nv;
  }
  function walk(el) {
    if (el.nodeType === 3) return textNode(el);
    if (el.nodeType !== 1) return;
    if (el.nodeName === 'TEXTAREA') return attrs(el); // its placeholder, never what was typed
    if (skipEl(el)) return;
    attrs(el);
    // A phrase with inline tags is translated as a whole, so word order can change.
    // (Only when words sit directly beside the tags; a row of separate labels is translated label by label.)
    var hasInline = false, hasText = false;
    for (var c = el.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 1 && INLINE[c.nodeName] && c.nodeName !== 'BR') hasInline = true;
      else if (c.nodeType === 3 && /[A-Za-z\u00C0-\u024F]/.test(c.nodeValue)) hasText = true;
    }
    if (hasInline && hasText && el.textContent.length < 600) {
      var list = [], tpl = template(el, list);
      if (tpl != null) {
        var key = norm(tpl);
        if (done.get(el) === key) return;
        if (collect) collect[key] = 1;
        if (Object.prototype.hasOwnProperty.call(dict, key)) { rebuild(el, dict[key], list); done.set(el, norm(template(el, []) || '')); return; }
      }
    }
    for (var k = el.firstChild; k; k = k.nextSibling) walk(k);
  }
  var busy = false;
  function apply(el) {
    if (lang === 'en' || !ready || !el) return;
    busy = true; try { walk(el); } finally { busy = false; }
    if (el === document.body || el === document.documentElement) { var tt = lookup(document.title); if (tt) document.title = tt; }
  }
  function observe() {
    if (lang === 'en') return;
    ready = true;
    apply(document.body);
    new MutationObserver(function (muts) {
      if (busy) return;
      busy = true;
      try {
        for (var i = 0; i < muts.length; i++) {
          var m = muts[i];
          if (m.type === 'childList') {
            for (var j = 0; j < m.addedNodes.length; j++) {
              var n = m.addedNodes[j];
              if (n.nodeType === 3) { var p = n.parentNode; if (p && p.nodeType === 1 && !skipEl(p) && !inSkipped(p)) walk(p.childNodes.length === 1 ? n : p); }
              else if (n.nodeType === 1 && !inSkipped(n.parentNode)) walk(n);
            }
          } else if (m.type === 'characterData') { if (!inSkipped(m.target.parentNode)) textNode(m.target); }
          else if (m.type === 'attributes') { if (!inSkipped(m.target)) attrs(m.target); }
        }
      } finally { busy = false; }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  function inSkipped(el) { for (; el && el.nodeType === 1; el = el.parentNode) if (skipEl(el)) return true; return false; }

  if (collect) { if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observe); else observe(); }
  else if (lang !== 'en') {
    // Dates and numbers follow the chosen language wherever the code asks for the default locale.
    var L = I18N.locale, dp = Date.prototype, np = Number.prototype;
    ['toLocaleDateString', 'toLocaleTimeString', 'toLocaleString'].forEach(function (f) {
      var o = dp[f]; dp[f] = function (loc, opt) { return o.call(this, loc == null || (Array.isArray(loc) && !loc.length) ? L : loc, opt); };
    });
    var on = np.toLocaleString; np.toLocaleString = function (loc, opt) { return on.call(this, loc == null || (Array.isArray(loc) && !loc.length) ? L : loc, opt); };
    // alert / confirm / prompt messages are translated too.
    ['alert', 'confirm', 'prompt'].forEach(function (f) {
      var o = window[f]; if (!o) return;
      window[f] = function (msg, def) { var s = String(msg == null ? '' : msg); return o.call(window, s.split('\n').map(function (l) { return lookup(l) || l; }).join('\n'), def); };
    });
    // Loaded from <head> as a normal script, so the dictionary is in place before the page is drawn.
    if (document.readyState === 'loading') document.write('<script src="' + base + 'i18n/' + lang + '.js"><\/script>');
    else { var sc = document.createElement('script'); sc.src = base + 'i18n/' + lang + '.js'; document.head.appendChild(sc); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', observe); else observe();
  }
})();
