'use strict';
/* 4 Horseman Security Level 2 & 3 — offline-first guard app.
   Data lives on the device (localStorage) and is optionally pushed to a server (see README → Sync API).
   Roles: admin (manages officers & locations), supervisor (operations board, all reports), guard (officer). */

// ---------- limits ----------
const MAX_SITES = 2;              // client sites
const MAX_PER_SITE = 25;          // officer accounts assigned to each site
const MAX_OFFICERS = MAX_SITES * MAX_PER_SITE; // 50 accounts in total (excludes the admin account)
const MAX_CHECKPOINTS = 20;       // guard-tour locations per site
const PING_EVERY_MS = 5 * 60000;  // on-shift location ping interval
const PING_MOVE_M = 75;           // or when the officer moves this far

// ---------- helpers ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const now = () => Date.now();
const Native = window.Android || null;
const app = $('#app'), nav = $('#nav');

const fmtTime = t => t ? new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
const fmtDate = t => t ? new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const fmtDT = t => t ? `${fmtDate(t)} · ${fmtTime(t)}` : '—';
const dur = ms => { const m = Math.max(0, Math.floor(ms / 60000)); return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`; };
const ago = t => { const s = (now() - t) / 1000; if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return fmtDate(t); };
const toLocalInput = t => { const d = new Date(t - new Date(t).getTimezoneOffset() * 60000); return d.toISOString().slice(0, 16); };
const greeting = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'; };

// ---------- icons (line style) ----------
const P = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z',
  shield: 'M12 3l7.5 3v5.5c0 4.7-3.2 8.6-7.5 9.5-4.3-.9-7.5-4.8-7.5-9.5V6zM9 12l2 2 4-4',
  qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 14h2v2h-2zM14 18h2v2h-2zM18 18h2v2h-2z',
  doc: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h6',
  chat: 'M4 5h16v11H9l-5 4z',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  alert: 'M12 3 2 20h20zM12 10v4M12 17v.5',
  clip: 'M9 3h6v3H9zM7 4.5H5V21h14V4.5h-2M9 12h6M9 16h4',
  wrench: 'M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-2.4z',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
  pin: 'M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6',
  users: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7M2 20c1.2-3.5 3.8-5.5 7-5.5s5.8 2 7 5.5M16 4.5a3.5 3.5 0 0 1 0 6.5M18 14.5c2 .7 3.3 2.6 4 5.5',
  building: 'M4 21V5l8-2v18M12 8h8v13M8 8h.01M8 12h.01M8 16h.01M16 12h.01M16 16h.01M2 21h20',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 3',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
  chev: 'M9 6l6 6-6 6',
  back: 'M15 6l-6 6 6 6',
  check: 'M5 12l5 5 9-10',
  plus: 'M12 5v14M5 12h14',
  print: 'M7 9V3h10v6M7 17H4v-7h16v7h-3M7 14h10v7H7z',
  share: 'M12 3v12M8 7l4-4 4 4M5 13v8h14v-8',
  sync: 'M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5',
  radio: 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4M8 8a6 6 0 0 0 0 8M16 8a6 6 0 0 1 0 8M5 5a10 10 0 0 0 0 14M19 5a10 10 0 0 1 0 14',
  lock: 'M6 11h12v10H6zM8.5 11V8a3.5 3.5 0 0 1 7 0v3',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  send: 'M3 11l18-8-8 18-2-8z',
  camera: 'M4 8h3l2-3h6l2 3h3v12H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M12 7v5l3 2',
  eye: 'M12 5c-5 0-9 7-9 7s4 7 9 7 9-7 9-7-4-7-9-7M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  eyeOff: 'M3 3l18 18M10.6 6.1A9 9 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-3 3.6M6.6 6.6C4.3 8.2 3 12 3 12s4 7 9 7a8.6 8.6 0 0 0 4.4-1.2M9.9 9.9a3 3 0 0 0 4.2 4.2',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14',
  key: 'M14 10a5 5 0 1 0-1.5 3.5L14 15h2v2h2v2h3v-3l-6.5-6.5',
  sheet: 'M4 4h16v16H4zM4 9h16M4 14h16M10 9v11',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4M8 14h2M14 14h2M8 17h2',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3'
};
// 4 Horseman emblem (shield, four stars, horse head). Ids are prefixed per use so gradients never collide.
const LOGO_INNER = "<defs>\n  <linearGradient id=\"g\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#f7e4b6\"/><stop offset=\".42\" stop-color=\"#d8b87f\"/><stop offset=\"1\" stop-color=\"#97713c\"/></linearGradient>\n  <linearGradient id=\"g2\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#f3dcaa\"/><stop offset=\".6\" stop-color=\"#cfa96f\"/><stop offset=\"1\" stop-color=\"#8e6936\"/></linearGradient>\n  <linearGradient id=\"g3\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#a98349\"/><stop offset=\"1\" stop-color=\"#5e4220\"/></linearGradient>\n  <clipPath id=\"c\"><path d=\"M60 15 L98 27 V64 C98 92 81 111 60 122 C39 111 22 92 22 64 V27 Z\"/></clipPath>\n</defs>\n<path d=\"M60 8 L104 22 V64 C104 96 84 118 60 130 C36 118 16 96 16 64 V22 Z\" fill=\"#0d1220\" stroke=\"url(#g)\" stroke-width=\"3.2\" stroke-linejoin=\"round\"/>\n<path d=\"M60 15 L98 27 V64 C98 92 81 111 60 122 C39 111 22 92 22 64 V27 Z\" fill=\"none\" stroke=\"url(#g)\" stroke-width=\"0.9\" opacity=\".85\"/>\n<g fill=\"url(#g)\"><path d=\"M40.00 33.60 L40.82 35.87 L43.23 35.95 L41.33 37.43 L42.00 39.75 L40.00 38.40 L38.00 39.75 L38.67 37.43 L36.77 35.95 L39.18 35.87Z\"/><path d=\"M52.70 29.10 L53.52 31.37 L55.93 31.45 L54.03 32.93 L54.70 35.25 L52.70 33.90 L50.70 35.25 L51.37 32.93 L49.47 31.45 L51.88 31.37Z\"/><path d=\"M67.30 29.10 L68.12 31.37 L70.53 31.45 L68.63 32.93 L69.30 35.25 L67.30 33.90 L65.30 35.25 L65.97 32.93 L64.07 31.45 L66.48 31.37Z\"/><path d=\"M80.00 33.60 L80.82 35.87 L83.23 35.95 L81.33 37.43 L82.00 39.75 L80.00 38.40 L78.00 39.75 L78.67 37.43 L76.77 35.95 L79.18 35.87Z\"/></g>\n<g clip-path=\"url(#c)\"><g transform=\"translate(24 41) scale(.385)\"><defs>\n  <linearGradient id=\"hg\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#f6e3b6\"/><stop offset=\".45\" stop-color=\"#d9b97f\"/><stop offset=\"1\" stop-color=\"#a27a43\"/></linearGradient>\n  <linearGradient id=\"hg2\" x1=\"0\" y1=\"0\" x2=\"0\" y2=\"1\"><stop offset=\"0\" stop-color=\"#e9cf98\"/><stop offset=\"1\" stop-color=\"#8e6936\"/></linearGradient>\n  <filter id=\"hb\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"3.2\"/></filter>\n  <filter id=\"hb2\" x=\"-20%\" y=\"-20%\" width=\"140%\" height=\"140%\"><feGaussianBlur stdDeviation=\"1.4\"/></filter>\n  <clipPath id=\"hc\"><path d=\"M111 2 C115 9 118.5 21 119.5 33 C139 38 159 52 171 74 C182 95 187 125 189 160 L191 205 L125 205 C126.5 182 126 156 121.5 133 C120 125 117 119 111.5 115.5 C108 131 99 143 85 147 C76 150 68 153 61 158 C56 162 50 164.5 44 163.5 C39 162.8 36.5 160 37.5 156.5 C33 155.5 29.5 152 28.8 147 C28 141 29.5 135.5 33 131.5 C47 113 67 84 83 59 C87 52 91 47 96 43 C99 33 103 20 106.5 11 C108 7 109.5 4 111 2 Z\"/></clipPath>\n</defs>\n<path d=\"M123 6 C127.5 13 130 23 130 34 C127 34.5 124 34.5 121 34 C121.5 24 122.5 14 123 6Z\" fill=\"url(#hg2)\"/>\n<path d=\"M124.5 12 C126.5 18 127.5 25 127.3 31\" fill=\"none\" stroke=\"#6b4c24\" stroke-width=\"1.6\" stroke-linecap=\"round\" opacity=\".7\"/>\n<!-- mane behind the neck -->\n<g fill=\"url(#hg2)\">\n  <path d=\"M121 32 C138 31 152 38 163 50 C150 46 140 45 132 46 Z\"/>\n  <path d=\"M140 44 C157 46 171 56 180 70 C168 63 157 61 149 61 Z\"/>\n  <path d=\"M155 62 C172 68 184 82 190 98 C180 89 170 85 162 84 Z\"/>\n  <path d=\"M166 84 C181 93 191 108 194 126 C186 116 178 110 171 108 Z\"/>\n  <path d=\"M174 108 C187 119 194 135 195 153 C189 142 182 136 177 133 Z\"/>\n  <path d=\"M180 135 C190 147 195 163 194 180 C189 168 184 161 181 158 Z\"/>\n</g>\n<path d=\"M111 2 C115 9 118.5 21 119.5 33 C139 38 159 52 171 74 C182 95 187 125 189 160 L191 205 L125 205 C126.5 182 126 156 121.5 133 C120 125 117 119 111.5 115.5 C108 131 99 143 85 147 C76 150 68 153 61 158 C56 162 50 164.5 44 163.5 C39 162.8 36.5 160 37.5 156.5 C33 155.5 29.5 152 28.8 147 C28 141 29.5 135.5 33 131.5 C47 113 67 84 83 59 C87 52 91 47 96 43 C99 33 103 20 106.5 11 C108 7 109.5 4 111 2 Z\" fill=\"url(#hg)\"/>\n<g clip-path=\"url(#hc)\">\n  <!-- shadows -->\n  <g fill=\"#5a3f1d\" filter=\"url(#hb)\">\n    <path d=\"M111 116 C107 132 98 144 84 148 C96 150 110 146 120 134 C121 126 117 120 111 116Z\" opacity=\".75\"/>\n    <path d=\"M121 133 C126 156 126.5 182 125 205 L146 205 C144 180 138 156 128 136Z\" opacity=\".55\"/>\n    <path d=\"M44 163 C52 162 58 158 64 154 C58 160 52 165 44 166Z\" opacity=\".6\"/>\n    <path d=\"M98 76 C108 82 115 94 116 108 C110 100 104 92 96 86Z\" opacity=\".35\"/>\n    <path d=\"M119 34 C123 46 124 58 122 70 C132 60 136 48 133 38Z\" opacity=\".35\"/>\n    <path d=\"M66 112 C74 116 80 124 82 134 C76 128 70 122 62 118Z\" opacity=\".28\"/>\n    <path d=\"M175 80 C184 110 187 150 189 205 L176 205 C176 160 176 120 168 86Z\" opacity=\".35\"/>\n  </g>\n  <!-- highlights -->\n  <g fill=\"#fff3d4\" filter=\"url(#hb)\">\n    <path d=\"M36 133 C50 112 68 86 84 61 C89 54 93 49 97 46 C92 56 80 76 64 101 C52 119 44 130 39 137Z\" opacity=\".55\"/>\n    <ellipse cx=\"95\" cy=\"112\" rx=\"15\" ry=\"19\" opacity=\".32\"/>\n    <path d=\"M128 52 C146 62 158 80 164 104 C152 86 140 72 126 62Z\" opacity=\".28\"/>\n    <path d=\"M99 34 C102 24 105 14 108.5 6 C109 16 107 27 104 38Z\" opacity=\".35\"/>\n  </g>\n  <!-- anatomy lines: cheek (masseter), facial crest, veins, muzzle -->\n  <g fill=\"none\" stroke=\"#5e421f\" stroke-linecap=\"round\" filter=\"url(#hb2)\">\n    <path d=\"M99 74 C110 84 117 100 115 116 C113 128 104 138 92 143\" stroke-width=\"2.4\" opacity=\".8\"/>\n    <path d=\"M90 70 C84 80 77 92 70 103\" stroke-width=\"1.6\" opacity=\".55\"/>\n    <path d=\"M78 104 C84 112 88 122 88 132\" stroke-width=\"1.1\" opacity=\".45\"/>\n    <path d=\"M60 119 C66 121 71 125 74 131\" stroke-width=\"1\" opacity=\".45\"/>\n    <path d=\"M128 140 C131 160 132 182 131 204\" stroke-width=\"1.6\" opacity=\".4\"/>\n    <path d=\"M45 140 C49 146 50 152 48 157\" stroke-width=\"1.1\" opacity=\".5\"/>\n  </g>\n</g>\n<!-- crisp details -->\n<!-- eye: socket, lids, iris, catch-light -->\n<path d=\"M94 66.5 C98 60.5 105 59 110 62.5 C106 68.8 99 70.8 94 66.5Z\" fill=\"#1a1208\"/>\n<path d=\"M93 66 C97.5 58.6 105.5 56.6 111.5 61\" fill=\"none\" stroke=\"#4a3416\" stroke-width=\"1.5\" stroke-linecap=\"round\"/>\n<path d=\"M95.5 69 C100 71.5 105.5 70.5 109.5 66\" fill=\"none\" stroke=\"#7a5a2c\" stroke-width=\"1\" stroke-linecap=\"round\" opacity=\".8\"/>\n<circle cx=\"104.8\" cy=\"63.4\" r=\"1.25\" fill=\"#fbecc8\"/>\n<path d=\"M91 57 C97 51.5 105 50.5 113 53.5\" fill=\"none\" stroke=\"#6b4c24\" stroke-width=\"1.3\" stroke-linecap=\"round\" opacity=\".55\"/>\n<!-- front ear inner -->\n<path d=\"M110.5 8 C113.5 15 115.5 23 116 31 C112.5 26 110 18 110.5 8Z\" fill=\"#6b4c24\" opacity=\".55\"/>\n<!-- forelock: fine strands falling over the forehead -->\n<g fill=\"none\" stroke-linecap=\"round\">\n  <path d=\"M117 33 C111 38 105 44 100 52\" stroke=\"#e9cf98\" stroke-width=\"2.2\"/>\n  <path d=\"M119 35 C114 41 109 47 105 55\" stroke=\"#d9b97f\" stroke-width=\"2\"/>\n  <path d=\"M115 34 C110.5 37.5 106 41.5 102 46.5\" stroke=\"#f3dcaa\" stroke-width=\"1.6\"/>\n  <path d=\"M117 33 C111 38 105 44 100 52 M119 35 C114 41 109 47 105 55\" stroke=\"#5e421f\" stroke-width=\".55\" opacity=\".8\"/>\n</g>\n<!-- nostril -->\n<path d=\"M33 140.5 C33.5 135 38.5 132 43.5 134 C40.5 135.5 38.5 138.5 38.2 142.5 C36.6 143.3 34.4 142.6 33 140.5Z\" fill=\"#2a1d0c\"/>\n<path d=\"M43.5 134 C46 136.5 46.5 140.5 44.8 143.5\" fill=\"none\" stroke=\"#6b4c24\" stroke-width=\"1.1\" stroke-linecap=\"round\" opacity=\".7\"/>\n<!-- mouth & chin -->\n<path d=\"M29.5 150 C35 152 41 152.3 47 150.5 C50 149.6 52.5 150.4 54 152\" fill=\"none\" stroke=\"#3d2b12\" stroke-width=\"1.5\" stroke-linecap=\"round\"/>\n<path d=\"M38 157.2 C42 158.8 47 158.6 51 157\" fill=\"none\" stroke=\"#6b4c24\" stroke-width=\"1\" stroke-linecap=\"round\" opacity=\".7\"/>\n<!-- mane strands -->\n<g fill=\"none\" stroke=\"#5e421f\" stroke-linecap=\"round\" opacity=\".85\">\n  <path d=\"M126 40 C142 44 155 52 164 63\" stroke-width=\"1.1\"/>\n  <path d=\"M136 52 C154 57 168 68 177 83\" stroke-width=\"1.1\"/>\n  <path d=\"M150 70 C166 77 178 90 185 106\" stroke-width=\"1.1\"/>\n  <path d=\"M161 92 C175 101 184 116 188 133\" stroke-width=\"1.1\"/>\n  <path d=\"M170 116 C181 127 187 142 189 158\" stroke-width=\"1.1\"/>\n  <path d=\"M176 142 C184 153 188 167 188 182\" stroke-width=\"1.1\"/>\n  <path d=\"M131 46 C147 49 160 58 170 70\" stroke-width=\".6\"/>\n  <path d=\"M144 61 C160 66 172 78 181 93\" stroke-width=\".6\"/>\n  <path d=\"M156 82 C170 89 180 102 186 118\" stroke-width=\".6\"/>\n  <path d=\"M166 104 C178 113 186 128 189 144\" stroke-width=\".6\"/>\n</g></g></g>";
const logo = (cls, k) => `<svg class="${cls}" viewBox="12 4 96 130" role="img" aria-label="4 Horseman Security emblem">${LOGO_INNER.replace(/id="(g[23]?|c|h[a-z0-9]+)"/g, `id="${k}$1"`).replace(/url\(#(g[23]?|c|h[a-z0-9]+)\)/g, `url(#${k}$1)`)}</svg>`;
const ic = (n, cls = '') => `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${P[n] || ''}"/></svg>`;

// ---------- data ----------
const DB_KEY = 'gp_db_v1';
// Every phone connects to the 4 Horseman company server automatically. (gp_server_override is for testing only: a URL, or 'none' for stand-alone.)
const DEFAULT_SERVER = 'https://guard-patrol-server-production.up.railway.app';
const builtInServer = () => {
  try { const o = localStorage.getItem('gp_server_override'); if (o != null) return o === 'none' ? '' : o; } catch (e) { }
  // Web app (served at /app/ by the company server): use that same server.
  if (location.protocol === 'https:' && location.hostname !== 'appassets.androidplatform.net') return location.origin;
  return DEFAULT_SERVER;
};
const urlCompany = () => { try { return (new URLSearchParams(location.search).get('company') || '').toUpperCase(); } catch (e) { return ''; } };
const EMPTY_DATA = () => ({ users: [], sites: [], shifts: [], scans: [], reports: [], events: [], messages: [], acks: {}, reads: {}, outbox: [] });
// Start clean on the server: stand-alone demo data must never be uploaded or mixed with company data.
function useServer(d, url) {
  Object.assign(d, EMPTY_DATA(), { session: null });
  d.config = { syncUrl: url, authToken: '', lastPull: 0, lastSync: 0, syncError: '' };
  return d;
}
let db = load();

function seed() {
  const s1 = 'site1', s2 = 'site2';
  const t = now();
  return {
    v: 1,
    users: [
      { id: 'u_admin', name: 'Administrator', badge: '1000', pin: '1234', role: 'admin', phone: '' },
      { id: 'u_demo', name: 'Demo Officer', badge: '2001', pin: '0000', role: 'guard', phone: '', siteId: s1 }
    ],
    sites: [
      {
        id: s1, name: 'Harbor Point Office Park', address: '100 Harbor Point Dr', phone: '', lat: null, lng: null, radius: 200,
        orders: [
          { id: 'o1', title: 'Access control', priority: 'high', updated: t, body: 'All visitors must sign in at the main lobby desk and show photo ID. Issue a visitor badge and record badge number. No tailgating through badge doors.' },
          { id: 'o2', title: 'Patrol frequency', priority: 'normal', updated: t, body: 'Complete a full exterior and interior tour every 2 hours. Scan every checkpoint. Report lights out, open doors, and hazards.' },
          { id: 'o3', title: 'Emergency procedures', priority: 'high', updated: t, body: 'Observe and report — do not engage. In an emergency call 911 first, then the site supervisor. Fire alarm: assist evacuation to the north parking lot muster point.' },
          { id: 'o4', title: 'Lock-up', priority: 'normal', updated: t, body: 'At 19:00 verify all exterior doors are secured and the loading dock roll-up door is closed.' }
        ],
        checkpoints: [
          { id: 'c1', name: 'Main lobby desk', instructions: 'Check visitor log and badge stock.' },
          { id: 'c2', name: 'Loading dock', instructions: 'Roll-up door closed and padlocked after 19:00.' },
          { id: 'c3', name: 'Parking garage level 2', instructions: 'Look for unattended vehicles and lighting outages.' },
          { id: 'c4', name: 'Rooftop access door', instructions: 'Door must be latched; alarm panel shows green.' },
          { id: 'c5', name: 'North muster point', instructions: 'Walkway clear; emergency light working.' }
        ].map(c => ({ ...c, code: `GP:${s1}:${c.id}` }))
      },
      {
        id: s2, name: 'Riverside Apartments', address: '45 Riverside Ave', phone: '', lat: null, lng: null, radius: 250,
        orders: [
          { id: 'o5', title: 'Residents & guests', priority: 'normal', updated: t, body: 'Be courteous with residents. Guests must be escorted or listed with the leasing office.' },
          { id: 'o6', title: 'Amenities', priority: 'normal', updated: t, body: 'Pool closes at 22:00. Clear and lock the pool gate. Gym is resident-only.' }
        ],
        checkpoints: [
          { id: 'c6', name: 'Front gate', instructions: 'Gate closes fully; keypad working.' },
          { id: 'c7', name: 'Pool gate', instructions: 'Locked after 22:00.' },
          { id: 'c8', name: 'Mailroom', instructions: 'Door locked; no packages left in hallway.' }
        ].map(c => ({ ...c, code: `GP:${s2}:${c.id}` }))
      }
    ],
    shifts: [], scans: [], reports: [], events: [],
    messages: [{ id: uid(), channel: 'dispatch', from: 'u_admin', fromName: 'Administrator', text: 'Welcome to 4 Horseman Security. Check in when you arrive on post and review your post orders.', at: t }],
    acks: {}, reads: {}, outbox: [],
    config: { syncUrl: '', authToken: '', lastPull: 0, lastSync: 0, syncError: '' },
    session: null
  };
}
function migrate(d) {
  // Earlier builds had a "Shift Supervisor" account instead of an administrator.
  if (!d.users.some(u => u.role === 'admin')) {
    const s = d.users.find(u => u.id === 'u_sup') || d.users.find(u => u.role === 'supervisor');
    if (s) { s.role = 'admin'; if (s.name === 'Shift Supervisor') s.name = 'Administrator'; }
  }
  return d;
}
function load() {
  const srv = builtInServer();
  try {
    const d = JSON.parse(localStorage.getItem(DB_KEY));
    if (d && d.v === 1) { migrate(d); if (srv && !d.config?.syncUrl) useServer(d, srv); return d; }
  } catch (e) { }
  const d = seed();
  return srv ? useServer(d, srv) : d;
}
function save() {
  try { localStorage.setItem(DB_KEY, JSON.stringify(db)); }
  catch (e) { toast('Device storage is full. Export and remove old reports.', 'err'); }
}
const queue = (kind, data) => { db.outbox.push({ id: uid(), kind, data, at: now() }); };

const me = () => db.session && db.users.find(u => u.id === db.session.userId);
const isAdmin = () => me()?.role === 'admin';
const isSup = () => ['admin', 'supervisor'].includes(me()?.role);
const roleName = r => ({ admin: 'Administrator', supervisor: 'Supervisor', guard: 'Officer' }[r] || 'Officer');
const officerCount = () => db.users.filter(u => u.role !== 'admin').length;
const siteCount = id => db.users.filter(u => u.role !== 'admin' && u.siteId === id).length;
// Officers check in only at their assigned site; supervisors and the administrator can cover any site.
const checkinSites = (u = me()) => u?.role === 'guard' ? db.sites.filter(s => s.id === u.siteId) : db.sites;
const siteById = id => db.sites.find(s => s.id === id);
const activeShift = (u = me()) => u && db.shifts.find(s => s.userId === u.id && !s.outAt);
const userName = id => db.users.find(u => u.id === id)?.name || 'Former officer';

function logEvent(text, shift = activeShift()) {
  db.events.push({ id: uid(), shiftId: shift?.id || null, userId: me()?.id, at: now(), text });
}
function unackedOrders(site, u = me()) {
  if (!site || !u) return [];
  const a = db.acks[u.id] || {};
  return site.orders.filter(o => a[o.id] !== o.updated);
}

// ---------- geo ----------
function getGeo() {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy), at: now() }),
      () => res(null), { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
  });
}
// Location is only read while the officer is on shift (plus the check-in moment itself).
const shiftGeo = () => activeShift() ? getGeo() : Promise.resolve(null);
function distM(a, b) {
  const R = 6371000, r = x => x * Math.PI / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}
function geofence(site, geo) {
  if (!geo) return { state: 'unknown', text: 'Location unavailable' };
  if (site.lat == null || site.lng == null) return { state: 'unset', text: 'Post location not yet set by administrator' };
  const d = distM(geo, site);
  return d <= site.radius + (geo.acc || 0)
    ? { state: 'in', d, text: `On post · ${d} m from site centre` }
    : { state: 'out', d, text: `${d} m from post — outside the ${site.radius} m perimeter` };
}
const geoText = g => g ? `${g.lat}, ${g.lng} (±${g.acc} m)` : 'Not recorded';
const mapUrl = g => `https://maps.google.com/?q=${g.lat},${g.lng}`;

// On-shift monitoring: watch position only while this officer is checked in; stop the moment they check out.
let watchId = null;
function syncTracking() {
  const sh = activeShift();
  if (sh && navigator.geolocation) {
    if (watchId == null) watchId = navigator.geolocation.watchPosition(onPing, () => { }, { enableHighAccuracy: true, maximumAge: 60000, timeout: 30000 });
  } else stopTracking();
}
function stopTracking() { if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; } }
function onPing(p) {
  const sh = activeShift(); if (!sh) { stopTracking(); return; }
  const g = { lat: +p.coords.latitude.toFixed(6), lng: +p.coords.longitude.toFixed(6), acc: Math.round(p.coords.accuracy), at: now() };
  const last = sh.lastGeo;
  if (last && now() - last.at < PING_EVERY_MS && distM(last, g) < PING_MOVE_M) return;
  sh.lastGeo = g; sh.track = (sh.track || []).concat(g).slice(-500);
  queue('location', { shiftId: sh.id, userId: sh.userId, ...g });
  save();
}

// ---------- UI primitives ----------
let toastTimer;
function toast(msg, kind = '') {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast ' + kind; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.hidden = true, 3200);
}
let modalOnClose = null;
function modal(html, onClose) {
  const m = $('#modal'); $('.sheet', m).innerHTML = html; m.hidden = false; modalOnClose = onClose || null;
}
function closeModal() {
  const m = $('#modal'); if (m.hidden) return false;
  m.hidden = true; $('.sheet', m).innerHTML = '';
  const f = modalOnClose; modalOnClose = null; if (f) f();
  return true;
}
$('#modal').addEventListener('click', e => { if (e.target.id === 'modal') closeModal(); });
function confirmBox(title, body, okLabel, onOk, danger) {
  modal(`<h2>${esc(title)}</h2><p class="muted">${body}</p>
    <div class="row" style="margin-top:20px"><button class="btn-ghost grow" data-act="closeModal">Cancel</button>
    <button class="${danger ? 'btn-danger' : 'btn-primary'} grow" id="cfmOk">${esc(okLabel)}</button></div>`);
  $('#cfmOk').onclick = () => { closeModal(); onOk(); };
}
const bar = (title, back) => `<header class="appbar no-print">${back ? `<a class="back" href="${back}" aria-label="Back">${ic('back', 'sm')}</a>` : ''}<h1>${esc(title)}</h1></header>`;
const buzz = ms => { try { Native?.vibrate?.(ms); } catch (e) { } };
const empty = (icon, text) => `<div class="empty"><div class="medal">${ic(icon)}</div><p>${text}</p></div>`;

// event delegation
const H = {};
document.addEventListener('click', e => {
  const t = e.target.closest('[data-act]'); if (!t) return;
  const fn = H[t.dataset.act]; if (fn) { e.preventDefault(); fn(t, e); }
});
document.addEventListener('submit', e => {
  const f = e.target; const fn = H[f.dataset.form];
  if (fn) { e.preventDefault(); fn(f, new FormData(f)); }
});
H.closeModal = closeModal;

// ---------- QR scanning ----------
let scanCb = null, stopWebScan = null;
function scanQR(prompt, cb) {
  scanCb = cb;
  if (Native && Native.scanQR) { Native.scanQR(prompt || 'Scan checkpoint QR code'); return; }
  webScan(prompt);
}
async function webScan(prompt) {
  if (!('BarcodeDetector' in window) || !navigator.mediaDevices?.getUserMedia) return manualCode();
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } }); }
  catch (e) { return manualCode(); }
  let alive = true;
  stopWebScan = () => { alive = false; stream.getTracks().forEach(t => t.stop()); stopWebScan = null; };
  modal(`<h2>${esc(prompt || 'Scan QR code')}</h2><video class="scanvid" playsinline muted autoplay></video>
    <button class="btn-ghost btn-block" style="margin-top:14px" data-act="manualCode">Enter code manually</button>`, () => stopWebScan && stopWebScan());
  const v = $('.scanvid'); v.srcObject = stream; await v.play().catch(() => { });
  const det = new BarcodeDetector({ formats: ['qr_code'] });
  const loop = async () => {
    if (!alive) return;
    try { const r = await det.detect(v); if (r.length) { closeModal(); GP.onScan(r[0].rawValue); return; } } catch (e) { }
    setTimeout(loop, 250);
  };
  loop();
}
function manualCode() {
  const cb = scanCb;
  closeModal(); scanCb = cb;
  modal(`<h2>Enter checkpoint code</h2><p class="muted small">Type the code printed beneath the QR label.</p>
    <form data-form="manualCodeSubmit" style="margin-top:14px"><div class="field"><input name="code" required autocomplete="off" autocapitalize="characters" placeholder="GP:site1:c1"></div>
    <button class="btn-primary btn-block">Submit</button></form>`);
}
H.manualCode = manualCode;
H.manualCodeSubmit = (f, fd) => { closeModal(); GP.onScan(String(fd.get('code'))); };

// Called from native code and the web fallback
window.GP = {
  onScan(text) { const cb = scanCb; scanCb = null; if (cb && text && text.trim()) cb(text.trim()); },
  back() { return closeModal(); }
};

// ---------- photos ----------
function readPhoto(file, max = 1280) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onerror = rej;
    fr.onload = () => {
      const img = new Image();
      img.onerror = rej;
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', 0.7));
      };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  });
}
let draftPhotos = [];
document.addEventListener('change', async e => {
  if (e.target.id !== 'photoInput') return;
  for (const f of e.target.files) {
    if (draftPhotos.length >= 6) { toast('Up to 6 photos per report'); break; }
    try { draftPhotos.push(await readPhoto(f)); } catch (err) { toast('Could not read that image', 'err'); }
  }
  e.target.value = '';
  renderPhotos();
});
function renderPhotos() {
  const box = $('#photoBox'); if (!box) return;
  box.innerHTML = draftPhotos.map((p, i) => `<img src="${p}" alt="Photo ${i + 1}" data-act="removePhoto" data-i="${i}">`).join('') +
    `<label class="photo-add" aria-label="Add photo">${ic('camera')}<input id="photoInput" type="file" accept="image/*" capture="environment" multiple></label>`;
}
H.removePhoto = el => confirmBox('Remove photo?', 'This photo will not be attached.', 'Remove', () => { draftPhotos.splice(+el.dataset.i, 1); renderPhotos(); }, true);

// ---------- router ----------
function go(h) { if (location.hash === h) render(); else location.hash = h; }
window.addEventListener('hashchange', () => { closeModal(); render(); });

const TABS = [['home', 'home', 'Home'], ['tour', 'shield', 'Tour'], ['reports', 'doc', 'Reports'], ['messages', 'chat', 'Messages'], ['more', 'grid', 'More']];
nav.innerHTML = TABS.map(([k, i, l]) => `<a href="#/${k}" data-tab="${k}">${ic(i)}<span>${l}</span>${k === 'messages' ? '<b class="dot" id="msgBadge" hidden></b>' : k === 'reports' ? '<b class="dot" id="repBadge" hidden></b>' : ''}</a>`).join('');

function render() {
  const u = me();
  syncTracking();
  if (!u) { nav.hidden = true; app.innerHTML = Login(); return; }
  nav.hidden = false;
  const [p = 'home', a, b] = (location.hash || '#/home').slice(2).split('/').map(decodeURIComponent);
  if (p === 'admin' && !isAdmin()) { toast('Administrator access only', 'err'); go('#/more'); return; }
  if (p === 'board' && !isSup()) { go('#/more'); return; }
  let html;
  switch (p) {
    case 'checkin': html = CheckIn(); break;
    case 'orders': html = Orders(a); break;
    case 'tour': html = Tour(); break;
    case 'reports': html = Reports(); break;
    case 'report': html = a === 'new' ? ReportForm(b) : ReportView(a); break;
    case 'messages': html = a ? Chat(a) : Channels(); break;
    case 'more': html = More(); break;
    case 'history': html = History(); break;
    case 'schedule': html = MySchedule(); break;
    case 'board': html = Board(); break;
    case 'admin':
      html = a === 'site' ? AdminSite(b) : a === 'officers' ? AdminOfficers() : a === 'qr' ? QrSheet(b) : AdminSites(); break;
    default: html = Home();
  }
  app.innerHTML = html;
  window.scrollTo(0, 0);
  const tabFor = { checkin: 'home', orders: 'home', report: 'reports', history: 'more', schedule: 'more', board: 'more', admin: 'more' }[p] || p;
  $$('.nav a').forEach(el => el.classList.toggle('on', el.dataset.tab === tabFor));
  updateBadge();
  if (p === 'messages' && a) afterChat(a);
  if (p === 'report' && a === 'new') renderPhotos();
}

function updateBadge() {
  const n = channels().reduce((s, c) => s + unread(c.id), 0);
  const b = $('#msgBadge'); if (!b) return; b.hidden = !n; b.textContent = n > 9 ? '9+' : n;
  const rb = $('#repBadge'); const rn = isAdmin() ? adminNew().length : 0; rb.hidden = !rn; rb.textContent = rn > 9 ? '9+' : rn;
}

// ---------- login ----------
const serverMode = () => !!db.config.syncUrl;
const apiBase = () => { let b = db.config.syncUrl.trim().replace(/\/+$/, ''); if (!/\/api$/.test(b)) b += '/api'; return b; };
async function pinHash(badge, pin) {
  try { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`gp:${badge}:${pin}`)); return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join(''); }
  catch (e) { return null; }
}
// Language menu (i18n.js); changing it reloads the app in the new language.
const langSelect = (style = '') => window.I18N ? `<select class="lang-select" translate="no" aria-label="Language" style="${style}" onchange="I18N.set(this.value)">${I18N.langs.map(([c, n]) => `<option value="${c}"${c === I18N.lang ? ' selected' : ''}>${n}</option>`).join('')}</select>` : '';
function Login() {
  const srv = serverMode();
  return `<div class="login">
    ${logo('logo-hero', 'lh')}
    <h1>4 Horseman</h1>
    <p class="tag">Security · Level 2 &amp; 3</p>
    <form data-form="login">
      ${srv ? `<div class="field"><label for="company">Company code</label><input id="company" name="company" required autocapitalize="characters" autocomplete="organization" spellcheck="false" style="text-transform:uppercase;letter-spacing:.14em" value="${esc(urlCompany() || db.config.companyCode || '')}" placeholder="From your administrator"></div>` : ''}
      <div class="field"><label for="badge">Badge number</label><input id="badge" name="badge" inputmode="numeric" required autocomplete="username"></div>
      <div class="field"><label for="pin">PIN</label><input id="pin" name="pin" type="password" inputmode="numeric" required autocomplete="current-password"></div>
      <button class="btn-primary btn-block btn-big" style="margin-top:6px">Sign in</button>
    </form>
    ${srv ? `<p class="muted small center" style="margin-top:22px;display:flex;align-items:center;justify-content:center;gap:8px"><span class="medal ok" style="width:26px;height:26px">${ic('sync', 'sm')}</span>Connected to company server</p>` : `<a class="item" href="#" data-act="serverCfg" style="margin-top:22px"><span class="medal">${ic('sync', 'sm')}</span>
      <div class="grow"><span class="label">Company server</span><p class="small" style="margin-top:2px">Not connected — this phone works on its own</p></div><span class="chev">${ic('chev', 'sm')}</span></a>`}
    <div class="center" style="margin-top:18px">${langSelect()}</div>
    ${srv ? '' : `<p class="muted small center" style="margin-top:20px;line-height:1.7">Stand-alone demo — Administrator <b class="gold">1000</b> / <b class="gold">1234</b><br>Demo officer <b class="gold">2001</b> / <b class="gold">0000</b></p>`}
  </div>`;
}
H.login = async (f, fd) => {
  const badge = String(fd.get('badge')).trim(), pin = String(fd.get('pin')).trim();
  const company = String(fd.get('company') || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  const btn = $('button', f);
  const ok = u => {
    db.session = { userId: u.id, at: now() }; save(); go('#/home'); render();
    toast(`Welcome, ${u.name.split(' ')[0]}`, 'ok'); sync();
  };
  if (!serverMode()) {
    const u = db.users.find(x => x.badge === badge && x.pin === pin);
    if (!u) { toast('Badge or PIN not recognised', 'err'); buzz(200); return; }
    return ok(u);
  }
  btn.disabled = true; btn.textContent = 'Signing in…';
  const h = await pinHash(badge, pin);
  try {
    const r = await fetch(apiBase() + '/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ company, badge, pin }) });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401 || r.status === 429) { btn.disabled = false; btn.textContent = 'Sign in'; toast(j.error || 'Badge or PIN not recognised', 'err'); buzz(200); return; }
    if (!r.ok) throw new Error(j.error || 'HTTP ' + r.status);
    // Signing in to a different company: clear the previous company's data from this phone first.
    if (j.company && db.config.companyId && db.config.companyId !== j.company.id) { const keep = db.config.syncUrl; useServer(db, keep); }
    if (j.company) Object.assign(db.config, { companyId: j.company.id, companyCode: j.company.code, companyName: j.company.name });
    db.config.authToken = j.token;
    mergeUsers(j.users || [j.user]);
    const u = db.users.find(x => x.id === j.user.id); u.pinHash = h;
    ok(u);
  } catch (e) {
    // Offline: allow officers who have signed in on this phone before.
    const u = h && (!company || company === db.config.companyCode) && db.users.find(x => x.badge === badge && x.pinHash === h);
    btn.disabled = false; btn.textContent = 'Sign in';
    if (u && db.config.authToken) { ok(u); toast('Offline — signed in on this phone. Data will sync when online.'); }
    else toast('Cannot reach the company server. Check the connection and try again.', 'err');
  }
};
function mergeUsers(list) {
  const old = new Map(db.users.map(u => [u.id, u]));
  db.users = list.map(u => ({ ...u, pinHash: old.get(u.id)?.pinHash }));
}
H.serverCfg = () => {
  if (serverMode() && !isAdmin()) return; // only the administrator manages the company server
  const c = db.config;
  modal(`<h2>Company server</h2><p class="muted small">Every phone connects to the 4 Horseman company server automatically. Only change this address if the server has moved. Switching servers signs this phone out and clears its local data.</p>
    <form data-form="serverSave" style="margin-top:14px"><div class="field"><label>Server address</label><input name="url" type="url" inputmode="url" autocapitalize="off" value="${esc(c.syncUrl)}" placeholder="https://guard-patrol.up.railway.app"></div>
    <p class="small" id="srvStatus" style="min-height:20px"></p>
    <div class="row" style="margin-top:10px"><button class="btn-primary grow">Test &amp; save</button></div></form>`);
};
H.serverSave = async (f, fd) => {
  if (serverMode() && !isAdmin()) return;
  let url = String(fd.get('url')).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//.test(url)) url = 'https://' + url;
  const st = $('#srvStatus'); st.textContent = 'Connecting…'; st.style.color = '';
  try {
    const r = await fetch(url.replace(/\/api$/, '') + '/api/health');
    const j = await r.json();
    if (!j.ok || j.server !== 'guard-patrol') throw new Error();
  } catch (e) { st.textContent = 'Could not reach a 4 Horseman company server at that address.'; st.style.color = 'var(--bad)'; return; }
  const changed = url !== db.config.syncUrl;
  Object.assign(db.config, { syncUrl: url, syncError: '' });
  if (changed) {
    // Start clean on a new server: stand-alone demo data must not be uploaded or mixed with company data.
    stopTracking(); useServer(db, url);
  }
  save(); closeModal(); location.hash = '#/home'; render(); toast('Connected to company server — please sign in', 'ok');
};
H.serverDisconnect = () => confirmBox('Disconnect from server?', 'This phone will stop sharing data and you will be signed out. Unsent items stay on the phone.', 'Disconnect', () => {
  Object.assign(db.config, { syncUrl: '', authToken: '', lastPull: 0, syncError: '' }); db.session = null; stopTracking(); save(); location.hash = '#/home'; render();
}, true);

// ---------- home ----------
function Home() {
  const u = me(), sh = activeShift(), site = sh && siteById(sh.siteId);
  const pending = site ? unackedOrders(site).length : 0;
  const unreadN = channels().reduce((s, c) => s + unread(c.id), 0);
  const tourP = sh ? tourProgress(sh) : null;
  const supPhone = site?.phone || db.users.find(x => x.role !== 'guard' && x.phone)?.phone;
  const tile = (href, icon, title, sub, count, act) =>
    `<a class="tile" href="${href}" ${act ? `data-act="${act}"` : ''}><span class="medal">${ic(icon)}</span><b>${title}${sub ? `<small>${sub}</small>` : ''}</b>${count ? `<span class="count">${count}</span>` : ''}</a>`;
  return `<div class="page">
    <div class="brandbar">${logo('logo-sm', 'ls')}<div class="grow"><div class="wordmark">4 Horseman</div><div class="label" style="font-size:10px;letter-spacing:.18em;margin-top:3px;white-space:nowrap">Security · Level 2 &amp; 3</div></div>
      <span class="pill gold">${roleName(u.role)} · ${esc(u.badge)}</span></div>
    <div class="greet"><p class="eyebrow">${new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</p>
      <h1>${greeting()}, ${esc(u.name.split(' ')[0])}</h1></div>

    <div style="margin-top:20px">${sh ? `<section class="shift">
      <div class="row between"><span class="pill ok"><span class="live"></span>On duty</span>${sh.inFence === 'out' ? '<span class="pill warn">Off-site check-in</span>' : `<span class="label">Since ${fmtTime(sh.inAt)}</span>`}</div>
      <div class="site">${esc(site?.name || 'Unknown site')}</div>
      <p class="muted small">${esc(site?.address || '')}</p>
      <div class="clock" data-since="${sh.inAt}">${dur(now() - sh.inAt)}</div>
      <div class="metrics"><div><b>${db.scans.filter(s => s.shiftId === sh.id).length}</b><span class="label">Scans</span></div>
        <div><b>${tourP.done}/${tourP.total}</b><span class="label">Round ${tourP.round}</span></div>
        <div><b>${db.reports.filter(r => r.shiftId === sh.id).length}</b><span class="label">Reports</span></div></div>
      <button class="btn-bad btn-block" data-act="checkout">${ic('logout', 'sm')} End shift &amp; check out</button>
      <div class="privacy">${ic('eye', 'sm')}<span>Your location is shared with supervisors while you are on duty. It stops the moment you check out.</span></div>
    </section>` : `<section class="shift">
      <span class="pill">Off duty</span>
      <div class="site">Ready for your post?</div>
      <p class="muted" style="margin:6px 0 20px">Check in when you arrive. Your GPS position is recorded at check-in.</p>
      <a class="btn btn-primary btn-block btn-big" href="#/checkin">${ic('pin', 'sm')} Check in to a site</a>
      <div class="privacy">${ic('eyeOff', 'sm')}<span>Location is not monitored while you are off duty.</span></div>
    </section>`}</div>
    ${nextShiftCard()}

    <div class="section-title"><h3>Quick actions</h3></div>
    <div class="tiles">
      ${tile('#/orders', 'clip', 'Post orders', pending ? 'Action required' : 'Site instructions', pending ? `${pending} new` : '')}
      ${tile('#/tour', 'shield', 'Guard tour', tourP ? `Round ${tourP.round} · ${tourP.done}/${tourP.total}` : 'Checkpoint patrol')}
      ${tile('#', 'qr', 'Scan checkpoint', 'QR verification', '', 'quickScan')}
      ${tile('#/report/new/incident', 'alert', 'Incident report', 'Document an event')}
      ${isAdmin() ? tile('#/reports', 'doc', 'Report inbox', 'All officer reports', adminNew().length ? `${adminNew().length} new` : '') : tile('#/report/new/dar', 'doc', 'Daily activity', 'Shift report')}
      ${tile('#/messages', 'chat', 'Messages', 'Dispatch & team', unreadN || '')}
    </div>

    <div class="section-title"><h3>Emergency</h3></div>
    <div class="sos">
      <a class="btn btn-danger" href="tel:911">${ic('phone', 'sm')} Call 911</a>
      ${supPhone ? `<a class="btn btn-ghost" href="tel:${esc(supPhone)}">${ic('phone', 'sm')} Supervisor</a>` : `<a class="btn btn-ghost" href="#/messages/dispatch">${ic('radio', 'sm')} Dispatch</a>`}
    </div>
    <p class="note">Observe and report. Never put yourself at risk.</p>
  </div>`;
}
setInterval(() => $$('[data-since]').forEach(el => el.textContent = dur(now() - +el.dataset.since)), 15000);

// ---------- check in / out ----------
let lastGeo = null;
function CheckIn() {
  if (activeShift()) return `${bar('Check in', '#/home')}<div class="page"><p>You are already checked in.</p></div>`;
  if (!db.sites.length) return `${bar('Check in', '#/home')}<div class="page">${empty('building', 'No sites have been set up yet. Ask your administrator.')}</div>`;
  const sites = checkinSites();
  if (!sites.length) return `${bar('Check in', '#/home')}<div class="page">${empty('building', 'You have not been assigned to a site yet. Ask your administrator.')}</div>`;
  return `${bar('Check in', '#/home')}<div class="page">
    <form data-form="checkin" class="stack">
      <div class="field"><label>Site</label>
        <select name="siteId" required>${sites.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
      <div class="card hl row" id="geoCard"><span class="medal">${ic('pin')}</span><div class="grow"><span class="label">Your position</span><p class="small" id="geoText" style="margin-top:4px">Acquiring GPS…</p></div></div>
      <div class="field" id="offsiteWrap" hidden><label>Reason for checking in outside the perimeter</label><input name="offsiteReason" placeholder="e.g. GPS drift inside building"></div>
      <button class="btn-primary btn-block btn-big">${ic('check', 'sm')} Check in now</button>
      <p class="muted small center">Location monitoring begins at check-in and ends at check-out.</p>
    </form></div>`;
}
async function refreshCheckinGeo() {
  const sel = $('select[name=siteId]'); if (!sel) return;
  const site = siteById(sel.value);
  if (!lastGeo) { lastGeo = await getGeo(); if (!$('select[name=siteId]')) return; }
  const g = geofence(site, lastGeo);
  $('#geoText').textContent = `${geoText(lastGeo)} — ${g.text}`;
  $('#geoCard').className = 'card row ' + (g.state === 'out' ? 'bad' : 'hl');
  $('#offsiteWrap').hidden = g.state !== 'out';
}
document.addEventListener('change', e => { if (e.target.name === 'siteId' && $('#geoCard')) refreshCheckinGeo(); });
H.checkin = async (f, fd) => {
  const site = checkinSites().find(s => s.id === fd.get('siteId'));
  if (!site) return toast('You can only check in at your assigned site', 'err');
  const geo = lastGeo || await getGeo();
  const g = geofence(site, geo);
  if (g.state === 'out' && !String(fd.get('offsiteReason') || '').trim()) { $('#offsiteWrap').hidden = false; toast('Enter a reason for the off-site check-in', 'err'); return; }
  const sh = { id: uid(), userId: me().id, siteId: site.id, inAt: now(), inGeo: geo, lastGeo: geo, track: geo ? [geo] : [], inFence: g.state, offsiteReason: String(fd.get('offsiteReason') || ''), outAt: null, round: 1, roundDone: [] };
  db.shifts.push(sh);
  logEvent(`Checked in at ${site.name}${g.state === 'out' ? ` (outside perimeter: ${sh.offsiteReason})` : ''}`, sh);
  queue('shift', sh);
  postSystem('site:' + site.id, `${me().name} checked in at ${fmtTime(sh.inAt)}`);
  save(); buzz(60); lastGeo = null;
  toast('Checked in. Stay safe.', 'ok');
  go(unackedOrders(site).length ? '#/orders' : '#/home');
};
H.checkout = () => {
  const sh = activeShift(); if (!sh) return;
  const site = siteById(sh.siteId);
  const hasDar = db.reports.some(r => r.shiftId === sh.id && r.type === 'dar');
  const tp = tourProgress(sh);
  modal(`<h2>End shift</h2>
    <dl class="kv"><dt>Site</dt><dd>${esc(site?.name)}</dd><dt>On duty</dt><dd>${dur(now() - sh.inAt)} · since ${fmtTime(sh.inAt)}</dd>
    <dt>Tour</dt><dd>${tp.rounds} complete round(s) · current ${tp.done}/${tp.total}</dd>
    <dt>Reports</dt><dd>${db.reports.filter(r => r.shiftId === sh.id).length}</dd></dl>
    ${hasDar ? '' : `<div class="card hl" style="margin:16px 0"><b>No daily activity report yet</b><p class="muted small">Most posts require a DAR before check-out.</p>
      <a class="btn btn-ghost btn-block" style="margin-top:10px" href="#/report/new/dar">Write DAR first</a></div>`}
    <form data-form="checkoutSubmit"><div class="field" style="margin-top:16px"><label>Pass-down notes (optional)</label><textarea name="notes" placeholder="Anything the next officer should know"></textarea></div>
    <button class="btn-danger btn-block btn-big">Confirm check-out</button></form>`);
};
H.checkoutSubmit = async (f, fd) => {
  const btn = $('button', f); btn.disabled = true; btn.textContent = 'Recording position…';
  const sh = activeShift(); const site = siteById(sh.siteId);
  sh.outGeo = await getGeo(); sh.outAt = now(); sh.notes = String(fd.get('notes') || '');
  stopTracking();
  logEvent(`Checked out from ${site?.name}${sh.notes ? ` — notes: ${sh.notes}` : ''}`, sh);
  queue('shift', sh);
  postSystem('site:' + sh.siteId, `${me().name} checked out at ${fmtTime(sh.outAt)}${sh.notes ? ` — ${sh.notes}` : ''}`);
  save(); closeModal(); buzz(60); toast('Checked out. Location monitoring stopped.', 'ok'); go('#/home');
};

// ---------- post orders ----------
function Orders(siteId) {
  const sh = activeShift();
  const site = siteById(siteId || sh?.siteId) || db.sites[0];
  if (!site) return `${bar('Post orders', '#/home')}<div class="page">${empty('clip', 'No sites set up yet.')}</div>`;
  const pending = unackedOrders(site);
  const acks = db.acks[me().id] || {};
  const prio = { high: 'bad', normal: 'info', low: '' };
  return `${bar('Post orders', '#/home')}<div class="page stack">
    <div class="field"><label>Site</label><select data-nav="orders">${db.sites.map(s => `<option value="${s.id}" ${s.id === site.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
    ${pending.length ? `<div class="card hl row between"><span><b class="gold">${pending.length}</b> order(s) awaiting acknowledgement</span>
      <button class="btn-primary btn-sm" data-act="ackAll" data-site="${site.id}">Acknowledge all</button></div>` : `<div class="card row"><span class="medal ok">${ic('check', 'sm')}</span><span>All orders acknowledged</span></div>`}
    ${site.orders.map(o => {
    const ok = acks[o.id] === o.updated;
    return `<article class="card ${ok ? '' : 'hl'}"><div class="row between"><h3>${esc(o.title)}</h3><span class="pill ${prio[o.priority] || ''}">${esc(o.priority)}</span></div>
      <p class="pre" style="margin:10px 0 14px;color:#d9d4ca">${esc(o.body)}</p>
      <div class="row between"><span class="dim small">Updated ${fmtDT(o.updated)}</span>
      ${ok ? `<span class="pill ok">${ic('check', 'sm')} Read</span>` : `<button class="btn-primary btn-sm" data-act="ack" data-id="${o.id}" data-site="${site.id}">I have read this</button>`}</div></article>`;
  }).join('') || empty('clip', 'No post orders for this site.')}
  </div>`;
}
document.addEventListener('change', e => { if (e.target.dataset.nav === 'orders') go('#/orders/' + e.target.value); });
function ack(site, ids) {
  const a = db.acks[me().id] = db.acks[me().id] || {};
  ids.forEach(id => { const o = site.orders.find(x => x.id === id); if (o) a[id] = o.updated; });
  logEvent(`Acknowledged ${ids.length} post order(s) for ${site.name}`);
  queue('ack', { userId: me().id, siteId: site.id, orders: ids.map(id => ({ id, version: a[id] })) });
  save(); render();
}
H.ack = el => ack(siteById(el.dataset.site), [el.dataset.id]);
H.ackAll = el => { const s = siteById(el.dataset.site); ack(s, unackedOrders(s).map(o => o.id)); toast('Post orders acknowledged', 'ok'); };

// ---------- guard tour ----------
function tourProgress(sh) {
  const site = siteById(sh.siteId); const total = site?.checkpoints.length || 0;
  return { done: (sh.roundDone || []).length, total, round: sh.round || 1, rounds: (sh.round || 1) - 1 };
}
function Tour() {
  const sh = activeShift();
  if (!sh) return `${bar('Guard tour')}<div class="page">${empty('shield', 'Check in to a site to begin your tour.')}
    <a class="btn btn-primary btn-block" href="#/checkin">Check in</a></div>`;
  const site = siteById(sh.siteId); const p = tourProgress(sh);
  const scans = db.scans.filter(s => s.shiftId === sh.id);
  return `${bar('Guard tour')}<div class="page stack">
    <div class="card hl"><div class="row between"><span class="eyebrow">Round ${p.round}</span><span class="dim small">${esc(site.name)}</span></div>
      <div class="meter" style="margin:8px 0 12px"><b>${p.done}</b><span class="muted">of ${p.total} checkpoints</span></div>
      <div class="bar"><i style="width:${p.total ? p.done / p.total * 100 : 0}%"></i></div>
      <p class="dim small" style="margin-top:10px">${p.rounds} round(s) completed this shift</p></div>
    <button class="btn-primary btn-block btn-big" data-act="quickScan">${ic('qr', 'sm')} Scan checkpoint</button>
    <div class="list">${site.checkpoints.map((c, i) => {
    const last = scans.filter(s => s.cpId === c.id).pop();
    const doneNow = (sh.roundDone || []).includes(c.id);
    const cls = doneNow ? (last?.status === 'issue' ? 'issue' : 'done') : '';
    return `<div class="item cp ${cls}"><span class="num">${doneNow ? (last?.status === 'issue' ? '!' : '✓') : i + 1}</span>
        <div class="grow"><b>${esc(c.name)}</b><p class="muted small">${last ? `Last scan ${fmtTime(last.at)}${last.status === 'issue' ? ' · issue reported' : ''}` : esc(c.instructions || 'Not scanned yet')}</p></div></div>`;
  }).join('') || empty('qr', 'No checkpoints configured for this site.')}</div>
    ${scans.length ? `<div class="section-title"><h3>Scan log</h3></div><div class="list">${scans.slice().reverse().slice(0, 30).map(s => `<div class="item"><div class="grow"><b>${esc(site.checkpoints.find(c => c.id === s.cpId)?.name || 'Checkpoint')}</b>
      <p class="muted small">${fmtTime(s.at)}${s.note ? ' · ' + esc(s.note) : ''}</p></div><span class="pill ${s.status === 'issue' ? 'bad' : 'ok'}">${s.status === 'issue' ? 'Issue' : 'Clear'}</span></div>`).join('')}</div>` : ''}
  </div>`;
}
H.quickScan = () => {
  const sh = activeShift();
  if (!sh) { toast('Check in to a site before scanning', 'err'); go('#/checkin'); return; }
  scanQR('Scan checkpoint QR code', handleCheckpointScan);
};
function handleCheckpointScan(code) {
  const sh = activeShift(); if (!sh) return;
  const site = siteById(sh.siteId);
  const cp = site.checkpoints.find(c => c.code === code);
  if (!cp) {
    const other = db.sites.find(s => s.checkpoints.some(c => c.code === code));
    buzz(300);
    toast(other ? `That checkpoint belongs to ${other.name}` : 'Not a checkpoint QR code for this site', 'err'); return;
  }
  buzz(80);
  modal(`<p class="eyebrow">Checkpoint verified</p><h2 style="margin-top:6px">${esc(cp.name)}</h2>${cp.instructions ? `<div class="card" style="margin-bottom:16px"><span class="label">Instructions</span><p style="margin-top:6px">${esc(cp.instructions)}</p></div>` : ''}
    <form data-form="scanSubmit" data-cp="${cp.id}">
      <div class="field"><label>Condition</label><div class="seg">
        <input type="radio" name="status" id="st1" value="clear" checked><label for="st1">All clear</label>
        <input type="radio" name="status" id="st2" value="issue"><label for="st2">Issue found</label></div></div>
      <div class="field"><label>Note (optional)</label><input name="note" placeholder="e.g. light out by stairwell"></div>
      <button class="btn-primary btn-block btn-big">Log checkpoint</button></form>`);
}
H.scanSubmit = async (f, fd) => {
  const btn = $('button', f); btn.disabled = true; btn.textContent = 'Saving…';
  const sh = activeShift(); const site = siteById(sh.siteId); const cp = site.checkpoints.find(c => c.id === f.dataset.cp);
  const geo = await shiftGeo();
  const scan = { id: uid(), shiftId: sh.id, userId: me().id, siteId: site.id, cpId: cp.id, at: now(), geo, status: fd.get('status'), note: String(fd.get('note') || '') };
  db.scans.push(scan); queue('scan', scan);
  logEvent(`Checkpoint "${cp.name}" — ${scan.status === 'issue' ? 'ISSUE' : 'all clear'}${scan.note ? `: ${scan.note}` : ''}`, sh);
  sh.roundDone = sh.roundDone || [];
  if (!sh.roundDone.includes(cp.id)) sh.roundDone.push(cp.id);
  let msg = 'Checkpoint logged';
  if (sh.roundDone.length >= site.checkpoints.length) {
    logEvent(`Completed tour round ${sh.round}`, sh);
    msg = `Round ${sh.round} complete`; sh.round++; sh.roundDone = []; buzz(200);
  }
  save(); closeModal(); toast(msg, 'ok');
  if (scan.status === 'issue') {
    confirmBox('Write an incident report?', 'You flagged an issue at this checkpoint.', 'Write report', () => {
      reportPrefill = { location: cp.name, description: scan.note }; go('#/report/new/incident');
    });
  }
  if (location.hash.startsWith('#/tour')) render();
};

// ---------- reports ----------
const RT = {
  incident: { name: 'Incident report', icon: 'alert', sub: 'Document an event' },
  dar: { name: 'Daily activity report', icon: 'doc', sub: 'Summary of your shift' },
  maintenance: { name: 'Maintenance & hazard', icon: 'wrench', sub: 'Lighting, doors, leaks, hazards' }
};
const CATS = ['Trespass', 'Theft', 'Vandalism', 'Suspicious activity', 'Disturbance', 'Medical', 'Fire / alarm', 'Safety hazard', 'Vehicle', 'Other'];
let reportPrefill = null;
const adminNew = () => db.reports.filter(r => !r.adminSeenAt);
let inboxFilter = 'new';
function reportRow(r, admin) {
  const pill = admin && !r.adminSeenAt ? '<span class="pill gold">New</span>'
    : admin && r.reviewedAt ? '<span class="pill ok">Reviewed</span>'
    : r.severity ? `<span class="pill ${{ Critical: 'bad', High: 'bad', Medium: 'warn' }[r.severity] || ''}">${esc(r.severity)}</span>` : '';
  return `<a class="item" href="#/report/${r.id}"><span class="medal ${r.type === 'incident' ? 'bad' : ''}">${ic(RT[r.type]?.icon || 'doc')}</span>
    <div class="grow"><b>${esc(r.type === 'incident' ? r.category : RT[r.type]?.name)}</b>
    <p class="muted small">${esc(siteById(r.siteId)?.name || '')} · ${fmtDT(r.occurredAt)}${isSup() ? ` · ${esc(r.userName)}` : ''}</p></div>${pill}</a>`;
}
function Reports() {
  const admin = isAdmin();
  const all = db.reports.filter(r => isSup() || r.userId === me().id).slice().reverse();
  const newOptions = `<div class="list">${Object.entries(RT).map(([k, v]) => `<a class="item" href="#/report/new/${k}"><span class="medal">${ic(v.icon)}</span>
      <div class="grow"><b>${v.name}</b><p class="muted small">${v.sub}</p></div><span class="chev">${ic('chev', 'sm')}</span></a>`).join('')}</div>`;
  if (!admin) return `${bar('Reports')}<div class="page">${newOptions}
    <div class="section-title"><h3>${isSup() ? 'All submitted reports' : 'My reports'}</h3><span class="dim small">${all.length}</span></div>
    <div class="list">${all.map(r => reportRow(r, false)).join('') || empty('doc', 'No reports yet.')}</div>
    <p class="note">${ic('lock', 'sm')} Every report you submit is sent directly to the administrator.</p></div>`;
  const nNew = adminNew().length;
  const list = inboxFilter === 'new' ? all.filter(r => !r.adminSeenAt) : all;
  return `${bar('Report inbox')}<div class="page">
    <div class="card hl row"><span class="medal">${ic('doc')}</span><div class="grow"><span class="label">Administrator inbox</span>
      <p class="small" style="margin-top:4px">Every report filed by any officer or supervisor arrives here.</p></div>${nNew ? `<span class="unread">${nNew} new</span>` : ''}</div>
    <button class="btn-ghost btn-block no-print" style="margin-top:12px" data-act="exportSheet">${ic('sheet', 'sm')} Export to spreadsheet</button>
    <div class="seg" style="margin:16px 0 12px">
      <input type="radio" name="inboxf" id="if1" ${inboxFilter === 'new' ? 'checked' : ''}><label for="if1" data-act="inboxFilter" data-v="new">New (${nNew})</label>
      <input type="radio" name="inboxf" id="if2" ${inboxFilter === 'all' ? 'checked' : ''}><label for="if2" data-act="inboxFilter" data-v="all">All (${all.length})</label>
      ${nNew ? `<button class="btn-sm btn-ghost" style="margin-left:auto" data-act="markAllSeen">Mark all read</button>` : ''}</div>
    <div class="list">${list.map(r => reportRow(r, true)).join('') || empty('check', inboxFilter === 'new' ? 'No new reports — you are all caught up.' : 'No reports yet.')}</div>
    <div class="section-title"><h3>File a report</h3></div>${newOptions}</div>`;
}
H.inboxFilter = el => { inboxFilter = el.dataset.v; render(); };
H.markAllSeen = () => { const t = now(); adminNew().forEach(r => { r.adminSeenAt = t; }); readChannel('admin'); save(); render(); };

// ---------- administrator: export reports to an Excel spreadsheet (.xlsx) ----------
// Built on the device with no libraries: a small .xlsx (Office Open XML) writer plus a zip packer.
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const XL = (() => {
  const enc = new TextEncoder();
  const xe = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const colName = n => { let s = ''; for (n++; n; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s; return s; };
  // Local date-time -> Excel serial number (days since 1899-12-30), so dates sort and filter as real dates.
  const serial = ms => (ms - new Date(ms).getTimezoneOffset() * 60000) / 86400000 + 25569;
  // Cell styles (index into cellXfs below).
  const S = { text: 9, head: 1, dt: 2, wrap: 3, title: 4, bold: 5, link: 6, muted: 7, date: 8, num: 10 };
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm"/><numFmt numFmtId="165" formatCode="yyyy-mm-dd"/></numFmts>
<fonts count="6"><font><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="16"/><color rgb="FF1B2338"/><name val="Calibri"/><family val="2"/></font><font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font><font><u/><sz val="11"/><color rgb="FF0563C1"/><name val="Calibri"/><family val="2"/></font><font><i/><sz val="10"/><color rgb="FF6B7186"/><name val="Calibri"/><family val="2"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1B2338"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3E7CF"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left/><right/><top/><bottom style="thin"><color rgb="FFD6B67E"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="11">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="left" vertical="top"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top"/></xf>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment horizontal="right" vertical="top"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  // A cell is a string/number/null, or { v, s, link } (link = URL shown as a clickable HYPERLINK formula).
  function cellXml(c, ref) {
    if (c == null || c === '') return '';
    if (typeof c !== 'object') c = { v: c };
    const s = c.s != null ? ` s="${c.s}"` : '';
    if (c.link) { const label = xe(c.v || c.link).replace(/"/g, '""'); return `<c r="${ref}" t="str"${s}><f>HYPERLINK("${xe(c.link).replace(/"/g, '""')}","${label}")</f><v>${xe(c.v || c.link)}</v></c>`; }
    if (typeof c.v === 'number' && isFinite(c.v)) return `<c r="${ref}"${s}><v>${c.v}</v></c>`;
    const t = xe(String(c.v).slice(0, 32000));
    return `<c r="${ref}" t="inlineStr"${s}><is><t xml:space="preserve">${t}</t></is></c>`;
  }
  // sheet: { name, widths[], rows[][], headRow (1-based row number of a table header to freeze + filter) }
  function sheetXml(sh) {
    const rows = sh.rows.map((r, i) => {
      const n = i + 1, cells = (r.cells || r).map((c, j) => cellXml(c, colName(j) + n)).join('');
      const ht = r.height ? ` ht="${r.height}" customHeight="1"` : '';
      return `<row r="${n}"${ht}>${cells}</row>`;
    }).join('');
    const ncol = Math.max(1, sh.widths.length);
    const pane = sh.headRow ? `<pane ySplit="${sh.headRow}" topLeftCell="A${sh.headRow + 1}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A${sh.headRow + 1}" sqref="A${sh.headRow + 1}"/>` : '';
    const filter = sh.headRow && sh.rows.length > sh.headRow ? `<autoFilter ref="A${sh.headRow}:${colName(ncol - 1)}${sh.rows.length}"/>` : '';
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"${sh.headRow ? '' : ' showGridLines="0"'}>${pane}</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>
<cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>
<sheetData>${rows}</sheetData>${filter}<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/><pageSetup orientation="landscape" fitToHeight="0"/></worksheet>`;
  }

  // ---- zip (stored, no compression; fine for text-only workbooks) ----
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files) {
    const d = new Date(), time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
      date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const parts = [], central = []; let off = 0;
    for (const [name, text] of files) {
      const nb = enc.encode(name), data = typeof text === 'string' ? enc.encode(text) : text, crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, 0, true);
      h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
      h.setUint16(26, nb.length, true); h.setUint16(28, 0, true);
      parts.push(new Uint8Array(h.buffer), nb, data);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true);
      c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
      c.setUint16(28, nb.length, true); c.setUint32(42, off, true);
      central.push(new Uint8Array(c.buffer), nb);
      off += 30 + nb.length + data.length;
    }
    const csize = central.reduce((s, p) => s + p.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
    const all = [...parts, ...central, new Uint8Array(e.buffer)], out = new Uint8Array(all.reduce((s, p) => s + p.length, 0));
    let p = 0; for (const a of all) { out.set(a, p); p += a.length; }
    return out;
  }

  function workbook(sheets, title) {
    const ws = sheets.map((s, i) => `<sheet name="${xe(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
    const names = sheets.map((s, i) => s.headRow && s.rows.length > s.headRow
      ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${xe(s.name).replace(/'/g, "''")}'!$A$${s.headRow}:$${colName(s.widths.length - 1)}$${s.rows.length}</definedName>` : '').join('');
    const iso = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    return zip([
      ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`],
      ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`],
      ['docProps/core.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xe(title)}</dc:title><dc:creator>4 Horseman Security</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${iso}</dcterms:modified></cp:coreProperties>`],
      ['docProps/app.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>4 Horseman Security</Application></Properties>`],
      ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="0"/></bookViews><sheets>${ws}</sheets>${names ? `<definedNames>${names}</definedNames>` : ''}</workbook>`],
      ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
      ['xl/styles.xml', STYLES],
      ...sheets.map((s, i) => [`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)])
    ]);
  }
  return { workbook, serial, S };
})();

// Time frames offered in the export sheet. Each returns [from, to) in local time.
const dayStart = d => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x.getTime(); };
const EXPORT_RANGES = {
  today: ['Today', () => [dayStart(now()), now() + 1]],
  week: ['Last 7 days', () => [dayStart(now() - 6 * 86400000), now() + 1]],
  d30: ['Last 30 days', () => [dayStart(now() - 29 * 86400000), now() + 1]],
  month: ['This month', () => { const d = new Date(); return [new Date(d.getFullYear(), d.getMonth(), 1).getTime(), now() + 1]; }],
  lastMonth: ['Last month', () => { const d = new Date(); return [new Date(d.getFullYear(), d.getMonth() - 1, 1).getTime(), new Date(d.getFullYear(), d.getMonth(), 1).getTime()]; }],
  year: ['This year', () => [new Date(new Date().getFullYear(), 0, 1).getTime(), now() + 1]],
  all: ['All time', () => [0, now() + 1]],
  custom: ['Custom dates', null]
};
const ymd = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const reportWhen = r => r.occurredAt || r.createdAt;
function exportSelection(form) {
  const fd = new FormData(form), key = fd.get('range');
  let from, to;
  if (key === 'custom') {
    const a = fd.get('from'), b = fd.get('to');
    if (!a || !b) return { error: 'Choose a start and end date' };
    from = new Date(a + 'T00:00').getTime(); to = new Date(b + 'T00:00').getTime() + 86400000;
    if (!(from < to)) return { error: 'The end date must be on or after the start date' };
  } else [from, to] = EXPORT_RANGES[key][1]();
  const types = ['incident', 'dar', 'maintenance'].filter(t => fd.get('t_' + t));
  const site = fd.get('site') || '';
  const list = db.reports.filter(r => types.includes(r.type) && (!site || r.siteId === site) && reportWhen(r) >= from && reportWhen(r) < to)
    .sort((a, b) => reportWhen(a) - reportWhen(b));
  return { key, from, to, types, site, list };
}
H.exportSheet = () => {
  if (!isAdmin()) return toast('Administrator access only', 'err');
  const opt = Object.entries(EXPORT_RANGES).map(([k, [l]]) => `<option value="${k}" ${k === 'd30' ? 'selected' : ''}>${l}</option>`).join('');
  modal(`<h2>Export to spreadsheet</h2><p class="muted small">Creates an Excel workbook (.xlsx) with a summary sheet and one detailed sheet per report type. It opens in Excel, Google Sheets and Numbers.</p>
    <form data-form="exportRun" id="exportForm" style="margin-top:16px">
      <div class="field"><label>Time frame</label><select name="range">${opt}</select></div>
      <div class="row" id="exportCustom" hidden><div class="field grow"><label>From</label><input type="date" name="from" value="${ymd(now() - 29 * 86400000)}"></div>
        <div class="field grow"><label>To</label><input type="date" name="to" value="${ymd(now())}"></div></div>
      <div class="field"><label>Reports to include</label><div class="seg">
        <input type="checkbox" name="t_incident" id="xt1" checked><label for="xt1">Incident</label>
        <input type="checkbox" name="t_dar" id="xt2" checked><label for="xt2">Daily activity</label>
        <input type="checkbox" name="t_maintenance" id="xt3" checked><label for="xt3">Maintenance &amp; hazard</label></div></div>
      <div class="field"><label>Site</label><select name="site"><option value="">All sites</option>${db.sites.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select></div>
      <p class="small" id="exportCount" style="min-height:20px"></p>
      <button class="btn-primary btn-block btn-big">${ic('download', 'sm')} Create spreadsheet</button></form>`);
  exportPreview();
};
function exportPreview() {
  const f = $('#exportForm'); if (!f) return;
  $('#exportCustom').hidden = f.range.value !== 'custom';
  const s = exportSelection(f), out = $('#exportCount');
  if (s.error) { out.textContent = s.error; out.style.color = 'var(--warn)'; return; }
  out.style.color = '';
  const n = t => s.list.filter(r => r.type === t).length;
  out.textContent = s.types.length ? `${s.list.length} report(s) — ${n('incident')} incident, ${n('dar')} daily activity, ${n('maintenance')} maintenance & hazard` : 'Choose at least one report type';
}
document.addEventListener('change', e => { if (e.target.closest('#exportForm')) exportPreview(); });
H.exportRun = (f) => {
  if (!isAdmin()) return;
  const s = exportSelection(f);
  if (s.error) return toast(s.error, 'err');
  if (!s.types.length) return toast('Choose at least one report type', 'err');
  try {
    const bytes = buildReportWorkbook(s);
    const name = `4-Horseman-reports_${ymd(s.from || (s.list[0] ? reportWhen(s.list[0]) : now()))}_to_${ymd(s.to - 1)}.xlsx`;
    saveBytes(name, XLSX_MIME, bytes);
    closeModal(); toast(Native?.saveFile ? 'Spreadsheet saved to Downloads' : 'Spreadsheet downloaded', 'ok');
  } catch (e) { toast('Could not create the spreadsheet: ' + e.message, 'err'); }
};
function saveBytes(name, mime, bytes) {
  if (Native?.saveFile) {
    let b = ''; for (let i = 0; i < bytes.length; i += 0x8000) b += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    Native.saveFile(name, mime, btoa(b)); return;
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([bytes], { type: mime })); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
function buildReportWorkbook(s) {
  const { S, serial } = XL;
  const dt = t => t ? { v: serial(t), s: S.dt } : '';
  const tx = v => v ? { v: String(v), s: S.text } : '';
  const wrap = v => v ? { v: String(v), s: S.wrap } : '';
  const num = v => v == null || v === '' ? '' : { v: +v, s: S.num };
  const head = list => ({ cells: list.map(v => ({ v, s: S.head })), height: 30 });
  const u = r => db.users.find(x => x.id === r.userId);
  const site = r => siteById(r.siteId)?.name || 'Former site';
  const status = r => r.reviewedAt ? 'Reviewed' : r.adminSeenAt ? 'Read' : 'New';
  const gps = r => r.geo ? [num(r.geo.lat), num(r.geo.lng), num(r.geo.acc), { v: 'Open map', link: mapUrl(r.geo), s: S.link }] : ['', '', '', ''];
  const review = r => [tx(status(r)), tx(r.reviewedBy), dt(r.reviewedAt), wrap(r.reviewNote)];
  const company = db.config.companyName || '4 Horseman Security';
  const period = s.key === 'all' ? 'All time' : `${fmtDate(s.from)} – ${fmtDate(s.to - 1)}`;
  const intro = (title, n) => [[{ v: title, s: S.title }], [{ v: `${company} · ${period} · ${n} report(s)`, s: S.muted }], []];
  const empty = n => n ? [] : [[{ v: 'No reports of this type in the selected time frame.', s: S.muted }]];
  const sheets = [];
  const by = (t) => s.list.filter(r => r.type === t);

  // Summary
  const counts = t => by(t).length;
  const sum = [[{ v: 'Report export', s: S.title }], [{ v: company, s: S.bold }],
    ['Time frame', { v: period }], ['Generated', dt(now())], ['Generated by', `${me().name} (badge ${me().badge})`],
    ['Site', s.site ? siteById(s.site)?.name || '' : 'All sites'], []];
  sum.push([{ v: 'Report type', s: S.bold }, { v: 'Count', s: S.bold }]);
  const typeNames = { incident: 'Incident reports', dar: 'Daily activity reports', maintenance: 'Maintenance & hazard reports' };
  s.types.forEach(t => sum.push([typeNames[t], { v: counts(t), s: S.num }]));
  sum.push([{ v: 'Total', s: S.bold }, { v: s.list.length, s: S.num }], []);
  if (s.types.includes('incident')) {
    sum.push([{ v: 'Incidents by severity', s: S.bold }, { v: 'Count', s: S.bold }]);
    ['Critical', 'High', 'Medium', 'Low'].forEach(v => sum.push([v, { v: by('incident').filter(r => r.severity === v).length, s: S.num }]));
    sum.push([]);
    const cats = {}; by('incident').forEach(r => cats[r.category || 'Other'] = (cats[r.category || 'Other'] || 0) + 1);
    sum.push([{ v: 'Incidents by category', s: S.bold }, { v: 'Count', s: S.bold }]);
    Object.entries(cats).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => sum.push([k, { v, s: S.num }]));
    if (!Object.keys(cats).length) sum.push([{ v: 'None', s: S.muted }]);
    sum.push([]);
  }
  const sites = [...new Set(s.list.map(r => r.siteId))];
  sum.push([{ v: 'Reports by site', s: S.bold }, ...s.types.map(t => ({ v: { incident: 'Incident', dar: 'Daily activity', maintenance: 'Maintenance' }[t], s: S.bold })), { v: 'Total', s: S.bold }]);
  sites.forEach(id => { const rs = s.list.filter(r => r.siteId === id); sum.push([siteById(id)?.name || 'Former site', ...s.types.map(t => ({ v: rs.filter(r => r.type === t).length, s: S.num })), { v: rs.length, s: S.num }]); });
  if (!sites.length) sum.push([{ v: 'No reports in this time frame', s: S.muted }]);
  sum.push([]);
  const offs = {}; s.list.forEach(r => offs[r.userName || 'Unknown'] = (offs[r.userName || 'Unknown'] || 0) + 1);
  sum.push([{ v: 'Reports by officer', s: S.bold }, { v: 'Count', s: S.bold }]);
  Object.entries(offs).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => sum.push([k, { v, s: S.num }]));
  sheets.push({ name: 'Summary', widths: [30, 16, 16, 16, 12], rows: sum });

  if (s.types.includes('incident')) {
    const rs = by('incident');
    sheets.push({ name: 'Incident reports', headRow: 4, widths: [17, 17, 24, 22, 10, 18, 10, 26, 50, 36, 40, 14, 14, 11, 12, 9, 11, 8, 11, 18, 17, 30, 14],
      rows: [...intro('Incident reports', rs.length), head(['Occurred', 'Submitted', 'Site', 'Officer', 'Badge', 'Category', 'Severity', 'Exact location', 'What happened', 'People involved', 'Actions taken', 'Emergency services', 'Agency case #', 'Latitude', 'Longitude', 'GPS ± m', 'Map', 'Photos', 'Status', 'Reviewed by', 'Reviewed at', 'Administrator note', 'Report ID']),
        ...rs.map(r => [dt(reportWhen(r)), dt(r.createdAt), tx(site(r)), tx(r.userName), tx(u(r)?.badge), tx(r.category), tx(r.severity), wrap(r.location), wrap(r.description), wrap(r.persons), wrap(r.actions),
          tx(r.authorities && r.authorities !== 'No' ? r.authorities : 'None'), tx(r.caseNo), ...gps(r), num(r.photos?.length || 0), ...review(r), tx(r.id)]), ...empty(rs.length)] });
  }
  if (s.types.includes('dar')) {
    const rs = by('dar');
    sheets.push({ name: 'Daily activity reports', headRow: 4, widths: [13, 17, 24, 22, 10, 50, 60, 18, 11, 12, 9, 11, 8, 11, 18, 17, 30, 14],
      rows: [...intro('Daily activity reports', rs.length), head(['Shift date', 'Submitted', 'Site', 'Officer', 'Badge', 'Summary & observations', 'Shift timeline', 'Weather & conditions', 'Latitude', 'Longitude', 'GPS ± m', 'Map', 'Photos', 'Status', 'Reviewed by', 'Reviewed at', 'Administrator note', 'Report ID']),
        ...rs.map(r => [{ v: serial(dayStart(reportWhen(r))), s: S.date }, dt(r.createdAt), tx(site(r)), tx(r.userName), tx(u(r)?.badge), wrap(r.description), wrap(r.timeline), wrap(r.weather), ...gps(r), num(r.photos?.length || 0), ...review(r), tx(r.id)]), ...empty(rs.length)] });
  }
  if (s.types.includes('maintenance')) {
    const rs = by('maintenance');
    sheets.push({ name: 'Maintenance & hazard', headRow: 4, widths: [17, 17, 24, 22, 10, 18, 10, 26, 50, 11, 12, 9, 11, 8, 11, 18, 17, 30, 14],
      rows: [...intro('Maintenance & hazard reports', rs.length), head(['Occurred', 'Submitted', 'Site', 'Officer', 'Badge', 'Issue type', 'Urgency', 'Exact location', 'Description', 'Latitude', 'Longitude', 'GPS ± m', 'Map', 'Photos', 'Status', 'Reviewed by', 'Reviewed at', 'Administrator note', 'Report ID']),
        ...rs.map(r => [dt(reportWhen(r)), dt(r.createdAt), tx(site(r)), tx(r.userName), tx(u(r)?.badge), tx(r.category), tx(r.severity), wrap(r.location), wrap(r.description), ...gps(r), num(r.photos?.length || 0), ...review(r), tx(r.id)]), ...empty(rs.length)] });
  }
  return XL.workbook(sheets, `${company} reports ${period}`);
}
function darTimeline(sh) {
  if (!sh) return '';
  return db.events.filter(e => e.shiftId === sh.id).map(e => `${fmtTime(e.at)}  ${e.text}`).join('\n');
}
function ReportForm(type) {
  if (!RT[type]) return `${bar('Report', '#/reports')}<div class="page">${empty('doc', 'Unknown report type.')}</div>`;
  const sh = activeShift(); const pre = reportPrefill || {}; reportPrefill = null; draftPhotos = [];
  const siteSel = `<div class="field"><label>Site</label><select name="siteId">${db.sites.map(s => `<option value="${s.id}" ${s.id === sh?.siteId ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>`;
  const when = `<div class="field"><label>${type === 'dar' ? 'Shift date' : 'Date & time occurred'}</label><input type="datetime-local" name="occurredAt" value="${toLocalInput(now())}" required></div>`;
  const photos = `<div class="field"><label>Photographs</label><div class="photos" id="photoBox"></div></div>`;
  let body = '';
  if (type === 'incident') body = `
    <div class="field"><label>Category</label><select name="category">${CATS.map(c => `<option>${c}</option>`).join('')}</select></div>
    <div class="field"><label>Severity</label><div class="seg">${['Low', 'Medium', 'High', 'Critical'].map((s, i) => `<input type="radio" name="severity" id="sv${i}" value="${s}" ${i === 1 ? 'checked' : ''}><label for="sv${i}">${s}</label>`).join('')}</div></div>
    ${when}
    <div class="field"><label>Exact location</label><input name="location" value="${esc(pre.location || '')}" placeholder="e.g. Loading dock, east door" required></div>
    <div class="field"><label>What happened</label><textarea name="description" required placeholder="Who, what, when, where — facts only">${esc(pre.description || '')}</textarea></div>
    <div class="field"><label>People involved</label><textarea name="persons" placeholder="Names, physical descriptions, vehicles, plates"></textarea></div>
    <div class="field"><label>Actions taken</label><textarea name="actions" placeholder="Who you notified, what you did"></textarea></div>
    <div class="field"><label>Emergency services</label><div class="seg">
      <input type="radio" name="authorities" id="au0" value="No" checked><label for="au0">None</label>
      <input type="radio" name="authorities" id="au1" value="Police"><label for="au1">Police</label>
      <input type="radio" name="authorities" id="au2" value="Fire"><label for="au2">Fire</label>
      <input type="radio" name="authorities" id="au3" value="EMS"><label for="au3">EMS</label></div></div>
    <div class="field"><label>Agency case number</label><input name="caseNo" placeholder="If provided"></div>`;
  else if (type === 'dar') body = `${when}
    <div class="field"><label>Shift timeline</label><textarea name="timeline" style="min-height:200px">${esc(darTimeline(sh))}</textarea>
    <p class="dim small" style="margin-top:6px">Auto-filled from your check-in, tour scans and acknowledgements.</p></div>
    <div class="field"><label>Summary &amp; observations</label><textarea name="description" required placeholder="Overall shift summary, notable events, pass-down"></textarea></div>
    <div class="field"><label>Weather &amp; conditions</label><input name="weather" placeholder="e.g. Clear, 18°C"></div>`;
  else body = `${when}
    <div class="field"><label>Issue type</label><select name="category">${['Lighting', 'Door / lock', 'Alarm / camera', 'Water leak', 'Trip hazard', 'Fence / gate', 'Other'].map(c => `<option>${c}</option>`).join('')}</select></div>
    <div class="field"><label>Urgency</label><div class="seg">${['Low', 'Medium', 'High'].map((s, i) => `<input type="radio" name="severity" id="ug${i}" value="${s}" ${i === 0 ? 'checked' : ''}><label for="ug${i}">${s}</label>`).join('')}</div></div>
    <div class="field"><label>Exact location</label><input name="location" value="${esc(pre.location || '')}" required></div>
    <div class="field"><label>Description</label><textarea name="description" required>${esc(pre.description || '')}</textarea></div>`;
  return `${bar(RT[type].name, '#/reports')}<div class="page"><form data-form="reportSubmit" data-type="${type}">
    ${siteSel}${body}${photos}
    <p class="dim small">${sh ? 'Your on-duty GPS position is attached when you submit.' : 'You are off duty — no location will be attached.'}</p>
    <button class="btn-primary btn-block btn-big" style="margin-top:12px">Submit report</button></form></div>`;
}
H.reportSubmit = async (f, fd) => {
  const btn = $('button.btn-big', f); btn.disabled = true; btn.textContent = 'Submitting…';
  const type = f.dataset.type; const sh = activeShift();
  const r = { id: uid(), type, userId: me().id, userName: me().name, userRole: me().role, shiftId: sh?.id || null, createdAt: now(), geo: await shiftGeo(), photos: draftPhotos.slice(),
    to: 'admin', adminSeenAt: null, reviewedAt: null, reviewedBy: null, reviewNote: '' };
  for (const [k, v] of fd.entries()) if (typeof v === 'string') r[k] = v.trim();
  r.occurredAt = new Date(r.occurredAt).getTime() || now();
  db.reports.push(r); queue('report', r);
  const label = type === 'incident' ? `${r.severity} ${r.category}` : RT[type].name;
  logEvent(`Submitted ${label.toLowerCase()} report`, sh);
  // Every report goes straight to the administrator: private alert channel + report inbox.
  postSystem('admin', `New ${label.toLowerCase().replace(/ report$/, '')} report from ${me().name} — ${siteById(r.siteId)?.name || ''}${r.location ? ` (${r.location})` : ''}`, { reportId: r.id });
  if (isAdmin()) r.adminSeenAt = now();
  draftPhotos = []; save(); buzz(60); sync();
  toast('Report sent to administrator', 'ok'); go('#/report/' + r.id);
};
function ReportView(id) {
  const r = db.reports.find(x => x.id === id);
  if (!r || (!isSup() && r.userId !== me().id)) return `${bar('Report', '#/reports')}<div class="page">${empty('doc', 'Report not found.')}</div>`;
  if (isAdmin() && !r.adminSeenAt) { r.adminSeenAt = now(); queue('reportSeen', { id: r.id, at: r.adminSeenAt }); save(); }
  const pending = db.outbox.some(o => o.kind === 'report' && o.data.id === r.id);
  const receipt = r.reviewedAt
    ? `<div class="card row" style="border-color:rgba(95,207,152,.35)"><span class="medal ok">${ic('check')}</span><div class="grow"><b>Reviewed by administrator</b>
        <p class="muted small">${fmtDT(r.reviewedAt)}${r.reviewedBy ? ' · ' + esc(r.reviewedBy) : ''}</p>${r.reviewNote ? `<p class="small" style="margin-top:6px">${esc(r.reviewNote)}</p>` : ''}</div></div>`
    : `<div class="card hl row"><span class="medal">${ic(pending && db.config.syncUrl ? 'clock' : 'send')}</span><div class="grow"><b>${pending && db.config.syncUrl ? 'Sending to administrator…' : 'Sent to administrator'}</b>
        <p class="muted small">${pending && db.config.syncUrl ? 'Queued — it will send automatically when the phone is online.' : `Delivered ${fmtDT(r.createdAt)} · awaiting review`}</p></div></div>`;
  const reviewBox = isAdmin() && !r.reviewedAt ? `<form data-form="reviewReport" data-id="${r.id}" class="card no-print"><div class="field"><label>Administrator note (optional)</label>
      <input name="note" placeholder="e.g. Forwarded to client, maintenance ticket raised"></div><button class="btn-primary btn-block">${ic('check', 'sm')} Mark as reviewed</button></form>` : '';
  const rows = [['Type', RT[r.type]?.name], ['Category', r.category], ['Severity', r.severity], ['Site', siteById(r.siteId)?.name], ['Occurred', fmtDT(r.occurredAt)],
  ['Location', r.location], ['Officer', r.userName], ['Submitted', fmtDT(r.createdAt)], ['GPS', r.geo ? geoText(r.geo) : null], ['Services', r.authorities !== 'No' ? r.authorities : null], ['Case #', r.caseNo], ['Weather', r.weather]]
    .filter(([, v]) => v);
  const blocks = [['What happened', r.type === 'dar' ? null : r.description], ['Summary', r.type === 'dar' ? r.description : null], ['People involved', r.persons], ['Actions taken', r.actions], ['Shift timeline', r.timeline]].filter(([, v]) => v);
  return `${bar(RT[r.type]?.name || 'Report', '#/reports')}<div class="page stack">
    ${receipt}
    <div class="card hl"><dl class="kv">${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>
    ${blocks.map(([k, v]) => `<div class="card"><span class="label">${k}</span><p class="pre" style="margin-top:8px">${esc(v)}</p></div>`).join('')}
    ${r.photos?.length ? `<div class="card"><span class="label">Photographs</span><div class="photos" style="margin-top:10px">${r.photos.map(p => `<img src="${p}" alt="Report photo">`).join('')}</div></div>` : ''}
    ${reviewBox}
    <div class="row no-print"><button class="grow btn-ghost" data-act="shareReport" data-id="${r.id}">${ic('share', 'sm')} Share</button><button class="grow btn-ghost" data-act="print">${ic('print', 'sm')} Print / PDF</button></div>
  </div>`;
}
H.reviewReport = (f, fd) => {
  if (!isAdmin()) return;
  const r = db.reports.find(x => x.id === f.dataset.id); if (!r) return;
  r.reviewedAt = now(); r.reviewedBy = me().name; r.reviewNote = String(fd.get('note') || '').trim();
  queue('reportReviewed', { id: r.id, reviewedAt: r.reviewedAt, reviewedBy: r.reviewedBy, reviewNote: r.reviewNote });
  save(); render(); toast('Report marked as reviewed', 'ok');
};
function reportText(r) {
  const s = siteById(r.siteId);
  return [`${RT[r.type]?.name?.toUpperCase()}${r.category ? ' — ' + r.category : ''}`, `Site: ${s?.name || ''}`, `Officer: ${r.userName}`,
  `Occurred: ${fmtDT(r.occurredAt)}`, r.severity && `Severity: ${r.severity}`, r.location && `Location: ${r.location}`,
  r.description && `\n${r.description}`, r.persons && `\nPeople involved: ${r.persons}`, r.actions && `\nActions taken: ${r.actions}`,
  r.authorities && r.authorities !== 'No' && `Authorities: ${r.authorities} ${r.caseNo || ''}`, r.timeline && `\nTimeline:\n${r.timeline}`,
  r.geo && `\nGPS: ${geoText(r.geo)}`].filter(Boolean).join('\n');
}
H.shareReport = el => {
  const r = db.reports.find(x => x.id === el.dataset.id); const text = reportText(r);
  if (Native?.share) Native.share(RT[r.type].name, text);
  else if (navigator.share) navigator.share({ title: RT[r.type].name, text }).catch(() => { });
  else navigator.clipboard?.writeText(text).then(() => toast('Report copied to clipboard', 'ok'));
};
H.print = () => { if (Native?.print) Native.print(); else window.print(); };

// ---------- messaging ----------
function channels() {
  return [...(isAdmin() ? [{ id: 'admin', name: 'Report alerts', desc: 'Private to the administrator' }] : []),
  { id: 'dispatch', name: 'Dispatch', desc: 'All officers & supervisors' },
  ...db.sites.map(s => ({ id: 'site:' + s.id, name: s.name, desc: 'Site team' }))];
}
function readChannel(ch) { const u = me(); if (u) (db.reads[u.id] = db.reads[u.id] || {})[ch] = now(); }
function unread(ch) {
  const u = me(); if (!u) return 0;
  const seen = (db.reads[u.id] || {})[ch] || 0;
  return db.messages.filter(m => m.channel === ch && m.at > seen && m.from !== u.id).length;
}
function postSystem(channel, text, extra) {
  const m = { id: uid(), channel, from: 'system', fromName: 'System', text, at: now(), system: true, ...(extra || {}) };
  db.messages.push(m); queue('message', m);
}
function Channels() {
  return `${bar('Messages')}<div class="page"><div class="list">${channels().map(c => {
    const last = db.messages.filter(m => m.channel === c.id).pop(); const n = unread(c.id);
    return `<a class="item" href="#/messages/${encodeURIComponent(c.id)}"><span class="medal">${ic(c.id === 'admin' ? 'lock' : c.id === 'dispatch' ? 'radio' : 'building')}</span>
      <div class="grow"><div class="row between"><b>${esc(c.name)}</b><span class="dim small">${last ? ago(last.at) : ''}</span></div>
      <p class="muted small" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${last ? esc((last.system ? '' : last.fromName + ': ') + last.text) : esc(c.desc)}</p></div>
      ${n ? `<span class="unread">${n}</span>` : ''}</a>`;
  }).join('')}</div>
  ${db.config.syncUrl ? '' : `<p class="note">Messages are stored on this device. Connect a sync server (More → Sync) to reach other officers' phones.</p>`}</div>`;
}
function Chat(ch) {
  const c = channels().find(x => x.id === ch);
  if (!c) return `${bar('Messages', '#/messages')}<div class="page">${empty('chat', 'Channel not found.')}</div>`;
  const msgs = db.messages.filter(m => m.channel === ch).slice(-200);
  const u = me();
  return `${bar(c.name, '#/messages')}<div class="chat" id="chat">${msgs.map(m => m.system
    ? (m.reportId ? `<a class="item" href="#/report/${m.reportId}" style="align-self:stretch"><span class="medal">${ic('doc', 'sm')}</span><div class="grow"><p class="small">${esc(m.text)}</p><p class="dim small">${fmtDT(m.at)}</p></div><span class="chev">${ic('chev', 'sm')}</span></a>`
      : `<div class="bubble sys">${esc(m.text)} · ${fmtTime(m.at)}</div>`)
    : `<div class="bubble ${m.from === u.id ? 'me' : ''}">${m.from === u.id ? '' : `<div class="who">${esc(m.fromName)}</div>`}<div>${esc(m.text)}</div><div class="when">${fmtTime(m.at)}</div></div>`).join('') || empty('chat', 'No messages yet.')}</div>
    ${ch === 'admin' ? '' : `<div class="composer"><div class="chips">${['10-4', 'On my way', 'All secure', 'Need backup', 'Running late', 'On break'].map(q => `<button type="button" data-act="quick" data-text="${q}">${q}</button>`).join('')}</div>
    <form data-form="send" data-ch="${esc(ch)}"><input id="msgInput" name="text" autocomplete="off" placeholder="Message ${esc(c.name)}" required><button class="btn-primary" aria-label="Send">${ic('send', 'sm')}</button></form></div>`}`;
}
function afterChat(ch) {
  const u = me(); (db.reads[u.id] = db.reads[u.id] || {})[ch] = now(); save(); updateBadge();
  window.scrollTo(0, document.body.scrollHeight);
}
function sendMsg(ch, text) {
  const u = me();
  const m = { id: uid(), channel: ch, from: u.id, fromName: u.name, text, at: now() };
  db.messages.push(m); queue('message', m); save();
  render(); sync();
}
H.send = (f, fd) => { const t = String(fd.get('text')).trim(); if (t) sendMsg(f.dataset.ch, t); };
H.quick = el => sendMsg($('form[data-form=send]').dataset.ch, el.dataset.text);

// ---------- more / profile / history ----------
function More() {
  const u = me();
  const row = (href, icon, title, sub, act) => `<a class="item" href="${href}" ${act ? `data-act="${act}"` : ''}><span class="medal">${ic(icon)}</span><div class="grow"><b>${title}</b>${sub ? `<p class="muted small">${sub}</p>` : ''}</div><span class="chev">${ic('chev', 'sm')}</span></a>`;
  return `${bar('More')}<div class="page">
    <div class="card hl row"><span class="medal">${ic('user')}</span><div class="grow"><h3>${esc(u.name)}</h3><p class="muted small">Badge ${esc(u.badge)} · ${roleName(u.role)}</p></div></div>
    <div class="list" style="margin-top:12px">
      ${row('#', 'key', 'My profile & PIN', '', 'profile')}
      ${row('#/schedule', 'calendar', 'My schedule', nextShift() ? `<span>${dayLabel(nextShift().start)}</span> · ${shiftRange(nextShift())}` : '')}
      ${row('#/history', 'history', 'Shift history', '')}
      ${row('#/orders', 'clip', 'Post orders', '')}
      ${window.I18N ? `<div class="item"><span class="medal">${ic('globe')}</span><div class="grow"><b>Language</b></div>${langSelect()}</div>` : ''}
    </div>
    ${isSup() ? `<div class="section-title"><h3>Supervision</h3></div><div class="list">
      ${row('#/board', 'chart', 'Operations board', 'Officers on duty and their live position')}</div>` : ''}
    ${isAdmin() && db.config.companyCode ? `<div class="card hl" style="margin-top:12px"><span class="label">Company code</span>
      <b style="display:block;margin-top:6px;font-size:22px;letter-spacing:.14em;overflow-wrap:anywhere" class="gold">${esc(db.config.companyCode)}</b><span class="muted small">${esc(db.config.companyName || '')}</span>
      <p class="dim small" style="margin-top:8px">Officers enter this code with their badge and PIN to sign in.</p></div>` : ''}
    ${isAdmin() ? `<div class="section-title"><h3>Administration</h3><span class="pill gold">${ic('lock', 'sm')} Admin</span></div><div class="list">
      ${row('#/reports', 'doc', 'Report inbox', `${adminNew().length} new · ${db.reports.length} total`)}
      ${row('#/admin/officers', 'users', 'Security officers', `${officerCount()} of ${MAX_OFFICERS} accounts used`)}
      ${row('#/admin', 'building', 'Sites & guard-tour locations', `${db.sites.length} of ${MAX_SITES} sites · up to ${MAX_CHECKPOINTS} tour locations and ${MAX_PER_SITE} officers each`)}</div>` : ''}
    <div class="list" style="margin-top:12px">
      ${isSup() ? row('#', 'download', 'Export data', 'JSON backup of this device', 'exportData') : ''}
      ${row('#', 'logout', 'Sign out', '', 'logout')}
    </div>
    <p class="note">4 Horseman Security Level 2 &amp; 3 · version 1.5</p></div>`;
}
H.profile = () => {
  const u = me();
  modal(`<h2>My profile</h2><form data-form="profileSave">
    <div class="field"><label>Name</label><input name="name" value="${esc(u.name)}" required></div>
    <div class="field"><label>Phone</label><input name="phone" type="tel" value="${esc(u.phone || '')}"></div>
    <div class="field"><label>New PIN (4–8 digits, blank to keep)</label><input name="pin" inputmode="numeric" pattern="\\d{4,8}" type="password"></div>
    <button class="btn-primary btn-block">Save</button></form>`);
};
H.profileSave = (f, fd) => {
  const u = me(); u.name = String(fd.get('name')).trim() || u.name; u.phone = String(fd.get('phone')).trim();
  const p = String(fd.get('pin')).trim(); if (p) u.pin = p;
  queue('user', { id: u.id, name: u.name, phone: u.phone, badge: u.badge, role: u.role, ...(u.siteId ? { siteId: u.siteId } : {}), ...(p ? { pin: p } : {}) });
  if (p && serverMode()) { delete u.pin; pinHash(u.badge, p).then(h => { u.pinHash = h; save(); }); }
  save(); closeModal(); render(); sync(); toast('Profile saved', 'ok');
};
H.logout = () => {
  if (activeShift()) return confirmBox('You are still on duty', 'Signing out does not check you out. Your shift — and on-duty location sharing — keeps running.', 'Sign out anyway', doLogout);
  doLogout();
};
function doLogout() {
  stopTracking();
  if (serverMode() && db.config.authToken && !db.outbox.length) { fetch(apiBase() + '/logout', { method: 'POST', headers: { Authorization: 'Bearer ' + db.config.authToken } }).catch(() => { }); db.config.authToken = ''; }
  db.session = null; save(); location.hash = '#/home'; render();
}
H.exportData = () => {
  const out = JSON.stringify({ ...db, users: db.users.map(({ pin, pinHash, ...u }) => u), session: undefined, config: { syncUrl: db.config.syncUrl } }, null, 2);
  if (Native?.share) Native.share('4 Horseman Security export', out);
  else { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([out], { type: 'application/json' })); a.download = '4-horseman-security-export.json'; a.click(); }
};
H.syncCfg = () => H.serverCfg();
function History() {
  const list = db.shifts.filter(s => isSup() || s.userId === me().id).slice().reverse();
  return `${bar('Shift history', '#/more')}<div class="page"><div class="list">${list.map(s => `<div class="item"><span class="medal ${s.outAt ? '' : 'ok'}">${ic('clock')}</span>
    <div class="grow"><div class="row between"><b>${esc(siteById(s.siteId)?.name || 'Former site')}</b>${s.outAt ? `<span class="pill">${dur(s.outAt - s.inAt)}</span>` : '<span class="pill ok">On duty</span>'}</div>
    <p class="muted small">${isSup() ? esc(userName(s.userId)) + ' · ' : ''}${fmtDT(s.inAt)} → ${s.outAt ? fmtTime(s.outAt) : 'now'} · ${db.scans.filter(x => x.shiftId === s.id).length} scans${s.inFence === 'out' ? ' · <span style="color:var(--warn)">off-site check-in</span>' : ''}</p>
    ${s.notes ? `<p class="small" style="margin-top:4px">${esc(s.notes)}</p>` : ''}</div></div>`).join('') || empty('history', 'No shifts yet.')}</div></div>`;
}

// ---------- my schedule (planned by the administrator on the website dashboard) ----------
const dayKey = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const mySchedule = () => (db.schedule || []).filter(x => !x.open).sort((a, b) => a.start - b.start);
const shiftRange = x => `${fmtTime(x.start)} – ${fmtTime(x.end)}`;
const shiftHours = x => (Math.round((x.end - x.start) / 360000) / 10).toFixed(1);
function dayLabel(t) {
  const d = dayKey(t), today = dayKey(now());
  if (d === today) return 'Today';
  if (d === today + 86400000 || d === dayKey(today + 30 * 3600000)) return 'Tomorrow';
  return new Date(t).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });
}
// The next shift that has not ended yet (or the one happening now).
const nextShift = () => mySchedule().find(x => x.end > now());
function nextShiftCard() {
  if (!serverMode()) return '';
  const x = nextShift(); if (!x) return '';
  const site = siteById(x.siteId), live = x.start <= now();
  return `<a class="card hl row sched-next" href="#/schedule" style="margin-top:12px"><span class="medal${live ? ' ok' : ''}">${ic('calendar')}</span>
    <div class="grow"><span class="label">${live ? 'Scheduled now' : 'Next shift'}</span>
      <b style="display:block;margin-top:4px"><span>${esc(dayLabel(x.start))}</span> · ${shiftRange(x)}</b>
      <span class="muted small" translate="no">${esc(site?.name || '')}</span></div><span class="chev">${ic('chev', 'sm')}</span></a>`;
}
function MySchedule() {
  const mine = mySchedule().filter(x => x.end > dayKey(now()));
  const open = (db.schedule || []).filter(x => x.open && x.end > now());
  const wk0 = dayKey(now()) - new Date().getDay() * 86400000, wk1 = wk0 + 7 * 86400000;
  const week = mine.filter(x => x.start >= wk0 && x.start < wk1);
  const weekH = week.reduce((a, x) => a + (x.end - x.start) / 3600000, 0);
  const sh = activeShift();
  const card = (x, isOpen) => {
    const site = siteById(x.siteId), live = x.start <= now() && x.end > now(), done = x.end <= now();
    const soon = !done && x.start - now() < 3600000;
    const status = isOpen ? '<span class="pill warn">Open shift</span>' : live ? '<span class="pill ok">Now</span>' : done ? '<span class="pill">Ended</span>' : '';
    return `<div class="item sched-item${done ? ' done' : ''}"><span class="medal${live ? ' ok' : ''}">${ic('clock')}</span>
      <div class="grow"><div class="row between"><b>${shiftRange(x)}</b>${status}</div>
        <p class="muted small"><span translate="no">${esc(site?.name || 'Former site')}</span> · ${shiftHours(x)} h</p>
        ${x.note ? `<p class="small" style="margin-top:4px" translate="no">${esc(x.note)}</p>` : ''}
        ${!isOpen && soon && !sh ? `<a class="btn btn-primary btn-sm" style="margin-top:10px" href="#/checkin">${ic('pin', 'sm')} Check in now</a>` : ''}</div></div>`;
  };
  const days = [...new Set(mine.map(x => dayKey(x.start)))];
  return `${bar('My schedule', '#/more')}<div class="page">
    ${serverMode() ? '' : `<p class="note">Schedules come from your company server. Connect this phone to see the shifts your administrator plans.</p>`}
    <div class="tiles"><div class="stat"><span class="label">Shifts this week</span><b>${week.length}</b></div>
      <div class="stat"><span class="label">Hours this week</span><b>${weekH.toFixed(1)}</b></div></div>
    ${days.length ? days.map(d => `<div class="section-title"><h3>${esc(dayLabel(d))}</h3></div>
      <div class="list">${mine.filter(x => dayKey(x.start) === d).map(x => card(x, false)).join('')}</div>`).join('')
      : empty('calendar', 'No upcoming shifts. Your administrator plans shifts on the website dashboard.')}
    ${open.length ? `<div class="section-title"><h3>Open shifts at your site</h3></div>
      <p class="muted small" style="margin:-4px 0 10px">Not assigned to anyone yet. Ask your supervisor if you can take one.</p>
      <div class="list">${open.map(x => `<div class="section-label label" style="margin:10px 0 6px">${esc(dayLabel(x.start))}</div>${card(x, true)}`).join('')}</div>` : ''}
    <p class="note">Check in and out with the app as usual. Your hours are taken from your check-ins, not from this schedule.</p></div>`;
}

// ---------- supervisor: operations board (on-duty officers only) ----------
function Board() {
  const on = db.shifts.filter(s => !s.outAt);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const inc = db.reports.filter(r => r.type === 'incident' && r.createdAt >= today.getTime());
  return `${bar('Operations board', '#/more')}<div class="page">
    <div class="tiles"><div class="stat"><span class="label">On duty now</span><b>${on.length}</b></div>
    <div class="stat"><span class="label">Incidents today</span><b>${inc.length}</b></div></div>
    <div class="section-title"><h3>Officers on duty</h3></div>
    <div class="list">${on.map(s => {
    const lastLocal = db.scans.filter(x => x.shiftId === s.id).pop();
    const lastAt = Math.max(lastLocal?.at || 0, s.lastScanAt || 0);
    const last = lastAt ? { at: lastAt } : null;
    const stale = !last || now() - last.at > 2 * 3600000;
    const g = s.lastGeo;
    return `<div class="card"><div class="row between"><div class="row"><span class="medal ok">${ic('user', 'sm')}</span><div><b>${esc(userName(s.userId))}</b>
      <p class="muted small">${esc(siteById(s.siteId)?.name || '')} · since ${fmtTime(s.inAt)}</p></div></div>
      <span class="pill ${stale ? 'warn' : 'ok'}">${last ? 'Scan ' + ago(last.at) : 'No scans'}</span></div>
      <hr class="hair"><div class="row between"><span class="small muted">${ic('pin', 'sm')} ${g ? `Position ${ago(g.at)} · ±${g.acc} m` : 'No position yet'}</span>
      ${g ? `<a class="btn btn-ghost btn-sm" href="${mapUrl(g)}">View map</a>` : ''}</div></div>`;
  }).join('') || empty('users', 'No officers are checked in.')}</div>
    <p class="note">${ic('eyeOff', 'sm')} Officers are only located while checked in. Off-duty staff never appear here.</p>
    ${db.config.syncUrl ? '' : '<p class="note">This board shows activity on this device. Connect a sync server for a company-wide view.</p>'}
  </div>`;
}

// ---------- administrator ----------
function AdminSites() {
  return `${bar('Sites & tour locations', '#/more')}<div class="page"><div class="list">${db.sites.map(s => `<a class="item" href="#/admin/site/${s.id}"><span class="medal">${ic('building')}</span>
    <div class="grow"><b>${esc(s.name)}</b><p class="muted small">${s.checkpoints.length}/${MAX_CHECKPOINTS} tour locations · ${siteCount(s.id)}/${MAX_PER_SITE} officers · ${s.orders.length} orders${s.lat == null ? ' · perimeter not set' : ''}</p></div><span class="chev">${ic('chev', 'sm')}</span></a>`).join('') || empty('building', 'No sites yet.')}</div>
    ${db.sites.length >= MAX_SITES ? `<button class="btn-ghost btn-block" style="margin-top:16px" disabled>${ic('plus', 'sm')} Limit of ${MAX_SITES} sites reached</button>` : `<button class="btn-primary btn-block" style="margin-top:16px" data-act="addSite">${ic('plus', 'sm')} Add site <span class="dim">(${db.sites.length} of ${MAX_SITES})</span></button>`}</div>`;
}
H.addSite = () => {
  if (!isAdmin()) return;
  if (db.sites.length >= MAX_SITES) return toast(`Limit of ${MAX_SITES} sites reached`, 'err');
  const s = { id: 's' + uid(), name: 'New site', address: '', phone: '', lat: null, lng: null, radius: 200, orders: [], checkpoints: [] };
  db.sites.push(s); queue('site', s); save(); go('#/admin/site/' + s.id);
};
function AdminSite(id) {
  const s = siteById(id); if (!s) return `${bar('Site', '#/admin')}<div class="page">${empty('building', 'Site not found.')}</div>`;
  const full = s.checkpoints.length >= MAX_CHECKPOINTS;
  return `${bar(s.name, '#/admin')}<div class="page">
    <form data-form="siteSave" data-id="${s.id}" class="card hl">
      <div class="field"><label>Site name</label><input name="name" value="${esc(s.name)}" required></div>
      <div class="field"><label>Address</label><input name="address" value="${esc(s.address)}"></div>
      <div class="field"><label>Site supervisor phone</label><input name="phone" type="tel" value="${esc(s.phone)}"></div>
      <div class="row"><div class="field grow"><label>Latitude</label><input name="lat" inputmode="decimal" value="${s.lat ?? ''}"></div>
        <div class="field grow"><label>Longitude</label><input name="lng" inputmode="decimal" value="${s.lng ?? ''}"></div></div>
      <button type="button" class="btn-ghost btn-block" data-act="siteHere">${ic('pin', 'sm')} Use my current location</button>
      <div class="field" style="margin-top:18px"><label>Perimeter radius (metres)</label><input name="radius" type="number" min="25" max="5000" value="${s.radius}"></div>
      <button class="btn-primary btn-block">Save site</button></form>

    <div class="section-title"><h3>Guard-tour locations</h3><span class="pill ${full ? 'warn' : 'gold'}">${s.checkpoints.length} / ${MAX_CHECKPOINTS}</span></div>
    <div class="list">${s.checkpoints.map((c, i) => `<a class="item cp" href="#" data-act="editCp" data-site="${s.id}" data-id="${c.id}"><span class="num">${i + 1}</span><div class="grow"><b>${esc(c.name)}</b><p class="dim small">${esc(c.code)}</p></div><span class="chev">${ic('chev', 'sm')}</span></a>`).join('') || '<p class="muted small">No tour locations yet.</p>'}</div>
    <button class="${full ? 'btn-ghost' : 'btn-primary'} btn-block" style="margin-top:12px" data-act="editCp" data-site="${s.id}" ${full ? 'disabled' : ''}>${ic('plus', 'sm')} ${full ? `Limit of ${MAX_CHECKPOINTS} reached` : 'Add tour location'}</button>
    ${s.checkpoints.length ? `<a class="btn btn-ghost btn-block" style="margin-top:10px" href="#/admin/qr/${s.id}">${ic('print', 'sm')} Print QR labels</a>` : ''}

    <div class="section-title"><h3>Post orders</h3><button class="btn-sm btn-ghost" data-act="editOrder" data-site="${s.id}">${ic('plus', 'sm')} Add</button></div>
    <div class="list">${s.orders.map(o => `<a class="item" href="#" data-act="editOrder" data-site="${s.id}" data-id="${o.id}"><div class="grow"><b>${esc(o.title)}</b><p class="muted small">${esc(o.priority)} · updated ${fmtDate(o.updated)}</p></div><span class="chev">${ic('chev', 'sm')}</span></a>`).join('') || '<p class="muted small">No post orders yet.</p>'}</div>

    <button class="btn-bad btn-block" style="margin-top:28px" data-act="delSite" data-id="${s.id}">${ic('trash', 'sm')} Delete site</button>
  </div>`;
}
H.siteSave = (f, fd) => {
  if (!isAdmin()) return;
  const s = siteById(f.dataset.id);
  s.name = String(fd.get('name')).trim(); s.address = String(fd.get('address')).trim(); s.phone = String(fd.get('phone')).trim();
  const lat = parseFloat(fd.get('lat')), lng = parseFloat(fd.get('lng'));
  s.lat = isFinite(lat) ? lat : null; s.lng = isFinite(lng) ? lng : null;
  s.radius = Math.max(25, parseInt(fd.get('radius')) || 200);
  queue('site', s); save(); render(); toast('Site saved', 'ok');
};
H.siteHere = async el => {
  el.disabled = true; el.textContent = 'Acquiring GPS…';
  const g = await getGeo(); el.disabled = false; el.innerHTML = `${ic('pin', 'sm')} Use my current location`;
  if (!g) return toast('Could not get your location', 'err');
  $('input[name=lat]').value = g.lat; $('input[name=lng]').value = g.lng; toast(`Location captured (±${g.acc} m). Tap Save site.`);
};
H.delSite = el => {
  if (!isAdmin()) return;
  const s = siteById(el.dataset.id);
  if (db.shifts.some(x => !x.outAt && x.siteId === s.id)) return toast('An officer is checked in at this site', 'err');
  if (siteCount(s.id)) return toast(`Move this site's ${siteCount(s.id)} officer(s) to another site first`, 'err');
  confirmBox(`Delete ${s.name}?`, 'Post orders and tour locations for this site will be removed. Past reports are kept.', 'Delete site', () => {
    db.sites = db.sites.filter(x => x.id !== s.id); queue('siteDeleted', { id: s.id }); save(); go('#/admin');
  }, true);
};
H.editOrder = el => {
  if (!isAdmin()) return;
  const s = siteById(el.dataset.site); const o = s.orders.find(x => x.id === el.dataset.id) || { title: '', body: '', priority: 'normal' };
  modal(`<h2>${o.id ? 'Edit' : 'New'} post order</h2><form data-form="orderSave" data-site="${s.id}" data-id="${o.id || ''}">
    <div class="field"><label>Title</label><input name="title" value="${esc(o.title)}" required></div>
    <div class="field"><label>Priority</label><div class="seg">${['low', 'normal', 'high'].map(p => `<input type="radio" name="priority" id="p${p}" value="${p}" ${o.priority === p ? 'checked' : ''}><label for="p${p}">${p}</label>`).join('')}</div></div>
    <div class="field"><label>Instructions</label><textarea name="body" required style="min-height:160px">${esc(o.body)}</textarea></div>
    <p class="dim small">Saving requires every officer to acknowledge this order again.</p>
    <div class="row" style="margin-top:14px">${o.id ? `<button type="button" class="btn-bad grow" data-act="delOrder" data-site="${s.id}" data-id="${o.id}">Delete</button>` : ''}<button class="btn-primary grow">Save</button></div></form>`);
};
H.orderSave = (f, fd) => {
  if (!isAdmin()) return;
  const s = siteById(f.dataset.site); let o = s.orders.find(x => x.id === f.dataset.id);
  if (!o) { o = { id: 'o' + uid() }; s.orders.push(o); }
  Object.assign(o, { title: String(fd.get('title')).trim(), body: String(fd.get('body')).trim(), priority: fd.get('priority') || 'normal', updated: now() });
  postSystem('site:' + s.id, `Post order updated: "${o.title}". Please review and acknowledge.`);
  queue('site', s); save(); closeModal(); render(); toast('Post order saved', 'ok');
};
H.delOrder = el => { if (!isAdmin()) return; const s = siteById(el.dataset.site); s.orders = s.orders.filter(o => o.id !== el.dataset.id); queue('site', s); save(); closeModal(); render(); };
H.editCp = el => {
  if (!isAdmin()) return;
  const s = siteById(el.dataset.site); const c = s.checkpoints.find(x => x.id === el.dataset.id);
  if (!c && s.checkpoints.length >= MAX_CHECKPOINTS) return toast(`Each site can have up to ${MAX_CHECKPOINTS} tour locations`, 'err');
  const v = c || { name: '', instructions: '' };
  modal(`<h2>${c ? 'Edit' : 'New'} tour location</h2><form data-form="cpSave" data-site="${s.id}" data-id="${c?.id || ''}">
    <div class="field"><label>Name</label><input name="name" value="${esc(v.name)}" required placeholder="e.g. Stairwell B, level 3"></div>
    <div class="field"><label>Instructions for officer</label><textarea name="instructions">${esc(v.instructions)}</textarea></div>
    ${c ? `<p class="dim small">QR code value: <code>${esc(c.code)}</code></p>` : ''}
    <div class="row" style="margin-top:14px">${c ? `<button type="button" class="btn-bad grow" data-act="delCp" data-site="${s.id}" data-id="${c.id}">${ic('trash', 'sm')} Delete</button>` : ''}<button class="btn-primary grow">Save</button></div></form>`);
};
H.cpSave = (f, fd) => {
  if (!isAdmin()) return;
  const s = siteById(f.dataset.site); let c = s.checkpoints.find(x => x.id === f.dataset.id);
  if (!c) {
    if (s.checkpoints.length >= MAX_CHECKPOINTS) { closeModal(); return toast(`Each site can have up to ${MAX_CHECKPOINTS} tour locations`, 'err'); }
    const id = 'c' + uid(); c = { id, code: `GP:${s.id}:${id}` }; s.checkpoints.push(c);
  }
  c.name = String(fd.get('name')).trim(); c.instructions = String(fd.get('instructions')).trim();
  queue('site', s); save(); closeModal(); render(); toast('Tour location saved', 'ok');
};
H.delCp = el => {
  if (!isAdmin()) return;
  const s = siteById(el.dataset.site); const c = s.checkpoints.find(x => x.id === el.dataset.id);
  closeModal();
  confirmBox(`Delete ${c.name}?`, 'Its QR label will stop working. Past scans are kept.', 'Delete', () => {
    s.checkpoints = s.checkpoints.filter(x => x.id !== c.id);
    db.shifts.forEach(sh => { if (sh.roundDone) sh.roundDone = sh.roundDone.filter(id => id !== c.id); });
    queue('site', s); save(); render(); toast('Tour location deleted', 'ok');
  }, true);
};
function QrSheet(id) {
  const s = siteById(id); if (!s) return `${bar('QR labels', '#/admin')}<div class="page">${empty('qr', 'Site not found.')}</div>`;
  const img = code => { const d = Native?.qrPng ? Native.qrPng(code, 512) : ''; return d ? `<img src="${d}" alt="QR ${esc(code)}">` : `<div class="qr-ph">${esc(code)}</div>`; };
  return `${bar('QR labels', '#/admin/site/' + s.id)}<div class="page stack">
    <p class="muted small no-print">Print, laminate and mount each label at its tour location.${Native?.qrPng ? '' : ' (QR images render in the Android app; this preview shows the code values.)'}</p>
    <button class="btn-primary btn-block no-print" data-act="print">${ic('print', 'sm')} Print labels</button>
    <div class="qr-grid">${s.checkpoints.map(c => `<div class="qr-card">${img(c.code)}<b>${esc(c.name)}</b><div>${esc(s.name)}</div><div class="code">${esc(c.code)}</div></div>`).join('')}</div></div>`;
}
function AdminOfficers() {
  const n = officerCount(); const full = n >= MAX_OFFICERS;
  const list = db.users.slice().sort((a, b) => (a.role === 'admin' ? -1 : b.role === 'admin' ? 1 : a.name.localeCompare(b.name)));
  return `${bar('Security officers', '#/more')}<div class="page">
    <div class="card hl"><div class="row between"><span class="label">Accounts</span><span class="pill ${full ? 'warn' : 'gold'}">${n} / ${MAX_OFFICERS}</span></div>
      <div class="bar" style="margin-top:12px"><i style="width:${n / MAX_OFFICERS * 100}%"></i></div>
      <p class="dim small" style="margin-top:10px">Up to ${MAX_PER_SITE} officers per site. Only the administrator can add or remove officers.</p>
      ${db.sites.length ? `<div class="row" style="flex-wrap:wrap;gap:6px;margin-top:10px">${db.sites.map(s => `<span class="pill ${siteCount(s.id) >= MAX_PER_SITE ? 'warn' : ''}">${esc(s.name)} ${siteCount(s.id)}/${MAX_PER_SITE}</span>`).join('')}</div>` : ''}</div>
    <p class="note" style="margin:14px 0">New officers are added on the website dashboard under Payroll. They appear here after the next sync. Tap an officer to edit or remove them.</p>
    <div class="list">${list.map(u => `<a class="item" href="#" data-act="editUser" data-id="${u.id}"><span class="medal ${activeShift(u) ? 'ok' : ''}">${ic(u.role === 'admin' ? 'lock' : 'user')}</span>
    <div class="grow"><b>${esc(u.name)}</b><p class="muted small">Badge ${esc(u.badge)} · ${roleName(u.role)}${u.role !== 'admin' ? ` · ${u.siteId && siteById(u.siteId) ? esc(siteById(u.siteId).name) : '<span style="color:var(--warn)">no site</span>'}` : ''}${activeShift(u) ? ' · <span style="color:var(--ok)">on duty</span>' : ''}</p></div><span class="chev">${ic('chev', 'sm')}</span></a>`).join('')}</div></div>`;
}
H.editUser = el => {
  if (!isAdmin()) return;
  const u = db.users.find(x => x.id === el.dataset.id);
  if (!u && officerCount() >= MAX_OFFICERS) return toast(`Limit of ${MAX_OFFICERS} officer accounts reached`, 'err');
  const v = u || { name: '', badge: '', role: 'guard', phone: '' };
  const isAdminAcct = v.role === 'admin';
  modal(`<h2>${u ? 'Edit' : 'New'} ${isAdminAcct ? 'administrator' : 'officer'}</h2><form data-form="userSave" data-id="${u?.id || ''}">
    <div class="field"><label>Full name</label><input name="name" value="${esc(v.name)}" required></div>
    <div class="field"><label>Badge number</label><input name="badge" value="${esc(v.badge)}" required inputmode="numeric"></div>
    <div class="field"><label>Phone</label><input name="phone" type="tel" value="${esc(v.phone || '')}"></div>
    ${isAdminAcct ? '' : `<div class="field"><label>Role</label><div class="seg"><input type="radio" name="role" id="rg" value="guard" ${v.role === 'guard' ? 'checked' : ''}><label for="rg">Officer</label>
      <input type="radio" name="role" id="rs" value="supervisor" ${v.role === 'supervisor' ? 'checked' : ''}><label for="rs">Supervisor</label></div></div>
      <div class="field"><label>Assigned site</label>${db.sites.length ? `<select name="siteId" required><option value="" disabled ${v.siteId && siteById(v.siteId) ? '' : 'selected'}>Choose a site</option>${db.sites.map(s => { const n = siteCount(s.id), full = n >= MAX_PER_SITE && s.id !== v.siteId; return `<option value="${s.id}" ${s.id === v.siteId ? 'selected' : ''} ${full ? 'disabled' : ''}>${esc(s.name)} (${n}/${MAX_PER_SITE}${full ? ' · full' : ''})</option>`; }).join('')}</select>` : '<p class="small" style="color:var(--warn)">Add a site first (Sites &amp; guard-tour locations).</p>'}</div>`}
    <div class="field"><label>${u ? 'Reset PIN (blank to keep)' : 'PIN (4–8 digits)'}</label><input name="pin" inputmode="numeric" pattern="\\d{4,8}" ${u ? '' : 'required'}></div>
    <div class="row" style="margin-top:14px">${u && !isAdminAcct ? `<button type="button" class="btn-bad grow" data-act="delUser" data-id="${u.id}">${ic('trash', 'sm')} Remove</button>` : ''}<button class="btn-primary grow">Save</button></div></form>`);
};
H.userSave = (f, fd) => {
  if (!isAdmin()) return;
  const badge = String(fd.get('badge')).trim();
  if (db.users.some(x => x.badge === badge && x.id !== f.dataset.id)) return toast('That badge number is already in use', 'err');
  let u = db.users.find(x => x.id === f.dataset.id);
  const isAdminAcct = u?.role === 'admin';
  const siteId = isAdminAcct ? undefined : String(fd.get('siteId') || '');
  if (!isAdminAcct) {
    if (!siteById(siteId)) return toast('Choose the site this officer is assigned to', 'err');
    if (siteId !== u?.siteId && siteCount(siteId) >= MAX_PER_SITE) return toast(`${siteById(siteId).name} already has ${MAX_PER_SITE} officers`, 'err');
    const sh = u && activeShift(u); if (sh && sh.siteId !== siteId && u.role === 'guard') return toast('This officer is on duty — they must check out before changing site', 'err');
  }
  if (!u) {
    if (officerCount() >= MAX_OFFICERS) { closeModal(); return toast(`Limit of ${MAX_OFFICERS} officer accounts reached`, 'err'); }
    u = { id: 'u' + uid(), role: 'guard' }; db.users.push(u);
  }
  Object.assign(u, { name: String(fd.get('name')).trim(), badge, phone: String(fd.get('phone')).trim() });
  if (u.role !== 'admin') { u.role = fd.get('role') === 'supervisor' ? 'supervisor' : 'guard'; u.siteId = siteId; }
  const p = String(fd.get('pin')).trim(); if (p) u.pin = p;
  queue('user', { id: u.id, name: u.name, badge: u.badge, role: u.role, phone: u.phone, ...(u.role !== 'admin' ? { siteId: u.siteId } : {}), ...(p ? { pin: p } : {}) });
  if (serverMode()) delete u.pin; sync();
  save(); closeModal(); render(); toast('Officer saved', 'ok');
};
H.delUser = el => {
  if (!isAdmin()) return;
  const u = db.users.find(x => x.id === el.dataset.id);
  if (!u || u.role === 'admin') return;
  if (activeShift(u)) return toast('This officer is on duty — they must check out first', 'err');
  closeModal();
  confirmBox(`Remove ${u.name}?`, 'They will no longer be able to sign in. Their past reports and shifts are kept.', 'Remove officer', () => {
    db.users = db.users.filter(x => x.id !== u.id); queue('userDeleted', { id: u.id }); save(); render(); toast('Officer removed', 'ok');
  }, true);
};

// ---------- sync (company server) ----------
let syncing = false;
const SAFE_RERENDER = /^(#\/(home|tour|reports|messages|more|board|history|schedule|admin|admin\/officers)?)?$/;
async function sync() {
  const c = db.config; if (!c.syncUrl || !c.authToken || !me() || syncing || !navigator.onLine) return;
  syncing = true;
  const base = apiBase();
  const headers = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + c.authToken };
  const hadOutbox = db.outbox.length > 0;
  try {
    while (db.outbox.length) {
      const ev = db.outbox[0];
      const r = await fetch(base + '/events', { method: 'POST', headers, body: JSON.stringify(ev) });
      if (r.status === 401) throw Object.assign(new Error('auth'), { auth: true });
      if (r.status >= 400 && r.status < 500 && r.status !== 408 && r.status !== 429) {
        const j = await r.json().catch(() => ({}));
        db.outbox.shift(); save();
        toast(`Server declined a change: ${j.error || 'HTTP ' + r.status}`, 'err');
        continue;
      }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      db.outbox.shift(); save();
    }
    const onReport = /^#\/report\/(?!new)/.test(location.hash);
    if (hadOutbox && onReport && $('#modal').hidden && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) render();
    const r = await fetch(`${base}/state?since=${c.lastPull || 0}`, { headers });
    if (r.status === 401) throw Object.assign(new Error('auth'), { auth: true });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const st = await r.json();
    const before = JSON.stringify([db.users.length, db.sites, db.messages.length, db.reports.length]);
    let fresh = 0, schedChanged = false;
    mergeUsers(st.users || db.users);
    if (!me()) { toast('Your account was removed by the administrator', 'err'); doLogout(); return; }
    if (Array.isArray(st.sites)) db.sites = st.sites;
    for (const m of st.messages || []) if (!db.messages.some(x => x.id === m.id)) { db.messages.push(m); if (m.from !== me().id) fresh++; }
    for (const x of st.reports || []) {
      const cur = db.reports.find(y => y.id === x.id);
      if (cur) Object.assign(cur, { reviewedAt: x.reviewedAt, reviewedBy: x.reviewedBy, reviewNote: x.reviewNote, adminSeenAt: cur.adminSeenAt || x.adminSeenAt });
      else { db.reports.push(x); if (isAdmin()) fresh++; }
    }
    for (const x of st.shifts || []) {
      const cur = db.shifts.find(y => y.id === x.id);
      if (cur && cur.userId === me().id && !cur.outAt) continue; // this phone owns its live shift
      if (cur) Object.assign(cur, x); else db.shifts.push(x);
    }
    if (st.acks) db.acks[me().id] = { ...(db.acks[me().id] || {}), ...st.acks };
    if (Array.isArray(st.schedule)) { if (JSON.stringify(st.schedule) !== JSON.stringify(db.schedule || [])) schedChanged = true; db.schedule = st.schedule; }
    c.lastPull = st.now; c.lastSync = now(); c.syncError = ''; save();
    const changed = schedChanged || before !== JSON.stringify([db.users.length, db.sites, db.messages.length, db.reports.length]);
    if (fresh) buzz(120);
    if (changed && $('#modal').hidden && SAFE_RERENDER.test(location.hash)) render();
    else if (changed && /^#\/messages\//.test(location.hash) && $('#modal').hidden) { const v = $('#msgInput')?.value || ''; render(); const i = $('#msgInput'); if (i) i.value = v; }
    else updateBadge();
  } catch (e) {
    if (e.auth) { c.authToken = ''; save(); toast('Your session has expired — please sign in again', 'err'); db.session = null; stopTracking(); save(); location.hash = '#/home'; render(); }
    else { c.syncError = 'Offline — will retry automatically'; save(); }
  } finally { syncing = false; }
}
setInterval(sync, 15000);
window.addEventListener('online', sync);

// ---------- boot ----------
save();
render();
sync();
// (no re-render here: returning from the camera must not wipe a half-filled report)
document.addEventListener('visibilitychange', () => { if (!document.hidden) { if (me()) updateBadge(); sync(); } });
window.addEventListener('hashchange', () => { if (location.hash === '#/checkin') { lastGeo = null; refreshCheckinGeo(); } });
if (location.hash === '#/checkin') refreshCheckinGeo();
