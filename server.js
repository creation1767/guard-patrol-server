'use strict';
/*
 * Guard Patrol sync server
 * ------------------------
 * One small Node.js program, no third-party dependencies (Node 18+).
 *  - Central officer accounts: badge + PIN sign-in (PINs stored as scrypt hashes), session tokens.
 *  - Receives events from phones (shifts, on-duty locations, scans, reports, messages, admin changes)
 *    and enforces permissions + limits on the server side.
 *  - Phones pull everything new from GET /api/state every 15 seconds.
 *  - Data is kept in DATA_DIR (state.json + one file per report). Point DATA_DIR at a persistent volume.
 *
 * Environment variables
 *   PORT              port to listen on (hosting platforms set this automatically)
 *   DATA_DIR          where data is stored. Defaults to the Railway volume path if one is attached, else ./data.
 *                     MUST be a persistent volume in production, or data is lost on every redeploy.
 *   ADMIN_BADGE       administrator badge number on first start (default 1000)
 *   ADMIN_PIN         administrator PIN on first start (4–8 digits). If missing, a random PIN is printed to the logs.
 *   SEED_DEMO_SITES   "false" to start with no sites (default: two demo sites you can edit or delete)
 *   ALLOWED_ORIGINS   comma-separated CORS origins (default: the Android app's origin). Use * only for testing.
 *   MAX_OFFICERS      default 40          MAX_CHECKPOINTS  default 15 (per site)
 *   SESSION_DAYS      default 30
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VERSION = '1.0.0';
const PORT = +process.env.PORT || 8080;
const DATA_DIR = path.resolve(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data'));
const REPORT_DIR = path.join(DATA_DIR, 'reports');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const MAX_OFFICERS = +process.env.MAX_OFFICERS || 40;
const MAX_CHECKPOINTS = +process.env.MAX_CHECKPOINTS || 15;
const SESSION_MS = (+process.env.SESSION_DAYS || 30) * 86400000;
const BODY_LIMIT = 25 * 1024 * 1024;
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'https://appassets.androidplatform.net')
  .split(',').map(s => s.trim()).filter(Boolean);

// ---------- helpers ----------
let lastClock = 0;
const clock = () => (lastClock = Math.max(Date.now(), lastClock + 1)); // strictly increasing server time
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const fail = (status, msg) => { throw new HttpError(status, msg); };
const str = (v, max = 500) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
const num = v => (typeof v === 'number' && isFinite(v) ? v : null);
const geo = g => (g && num(g.lat) != null && num(g.lng) != null)
  ? { lat: g.lat, lng: g.lng, acc: num(g.acc) || 0, at: num(g.at) || Date.now() } : null;
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const isPin = p => typeof p === 'string' && /^\d{4,8}$/.test(p);
function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${crypto.scryptSync(pin, salt, 32).toString('hex')}`;
}
function checkPin(pin, stored) {
  if (!stored || typeof pin !== 'string') return false;
  const [salt, hash] = stored.split(':');
  const a = crypto.scryptSync(pin, salt, 32), b = Buffer.from(hash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const publicUser = u => ({ id: u.id, name: u.name, badge: u.badge, role: u.role, phone: u.phone || '' });

// ---------- storage ----------
fs.mkdirSync(REPORT_DIR, { recursive: true });
function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
function seedState() {
  const pin = isPin(process.env.ADMIN_PIN) ? process.env.ADMIN_PIN : String(crypto.randomInt(100000, 999999));
  if (!isPin(process.env.ADMIN_PIN)) {
    console.log('\n==================================================================');
    console.log(`  No valid ADMIN_PIN set. Administrator badge ${process.env.ADMIN_BADGE || '1000'}, temporary PIN: ${pin}`);
    console.log('  Sign in and change it under More → My profile & PIN.');
    console.log('==================================================================\n');
  }
  const t = Date.now();
  const st = {
    v: 1,
    users: [{ id: 'u_admin', name: 'Administrator', badge: String(process.env.ADMIN_BADGE || '1000'), role: 'admin', phone: '', pinHash: hashPin(pin), srvAt: t }],
    sites: [], shifts: {}, scans: [], messages: [], acks: {}, sessions: {}, seenEvents: []
  };
  if (process.env.SEED_DEMO_SITES !== 'false') {
    const cp = (sid, list) => list.map(([id, name, instructions]) => ({ id, name, instructions, code: `GP:${sid}:${id}` }));
    st.sites.push(
      { id: 'site1', name: 'Harbor Point Office Park', address: '100 Harbor Point Dr', phone: '', lat: null, lng: null, radius: 200, srvAt: t,
        orders: [
          { id: 'o1', title: 'Access control', priority: 'high', updated: t, body: 'All visitors must sign in at the main lobby desk and show photo ID. Issue a visitor badge and record badge number. No tailgating through badge doors.' },
          { id: 'o2', title: 'Patrol frequency', priority: 'normal', updated: t, body: 'Complete a full exterior and interior tour every 2 hours. Scan every checkpoint. Report lights out, open doors, and hazards.' },
          { id: 'o3', title: 'Emergency procedures', priority: 'high', updated: t, body: 'Observe and report — do not engage. In an emergency call 911 first, then the site supervisor.' }],
        checkpoints: cp('site1', [['c1', 'Main lobby desk', 'Check visitor log and badge stock.'], ['c2', 'Loading dock', 'Roll-up door closed and padlocked after 19:00.'], ['c3', 'Parking garage level 2', 'Look for unattended vehicles and lighting outages.']]) },
      { id: 'site2', name: 'Riverside Apartments', address: '45 Riverside Ave', phone: '', lat: null, lng: null, radius: 250, srvAt: t,
        orders: [{ id: 'o5', title: 'Residents & guests', priority: 'normal', updated: t, body: 'Be courteous with residents. Guests must be escorted or listed with the leasing office.' }],
        checkpoints: cp('site2', [['c6', 'Front gate', 'Gate closes fully; keypad working.'], ['c7', 'Pool gate', 'Locked after 22:00.']]) });
  }
  return st;
}
let S;
try { S = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
catch (e) {
  if (e.code !== 'ENOENT') { console.error('Cannot read', STATE_FILE, e.message); process.exit(1); }
  S = seedState(); writeAtomic(STATE_FILE, JSON.stringify(S));
}
const seen = new Set(S.seenEvents || []);
const reports = new Map();
for (const f of fs.readdirSync(REPORT_DIR)) {
  if (!f.endsWith('.json')) continue;
  try { const r = JSON.parse(fs.readFileSync(path.join(REPORT_DIR, f), 'utf8')); reports.set(r.id, r); }
  catch (e) { console.error('Skipping unreadable report', f); }
}
let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    S.seenEvents = [...seen].slice(-20000);
    writeAtomic(STATE_FILE, JSON.stringify(S));
  }, 300);
}
function flush() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; S.seenEvents = [...seen].slice(-20000); writeAtomic(STATE_FILE, JSON.stringify(S)); } }
function saveReport(r) { writeAtomic(path.join(REPORT_DIR, `${r.id.replace(/[^\w-]/g, '_')}.json`), JSON.stringify(r)); }

// ---------- auth ----------
const userById = id => S.users.find(u => u.id === id);
function authUser(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) return null;
  const s = S.sessions[sha(m[1])];
  if (!s || s.exp < Date.now()) return null;
  return userById(s.userId) || null;
}
function revokeSessions(userId, exceptTokenHash) {
  for (const [k, s] of Object.entries(S.sessions)) if (s.userId === userId && k !== exceptTokenHash) delete S.sessions[k];
}
const attempts = new Map(); // key -> {n, until}
function throttle(key) {
  const a = attempts.get(key);
  if (a && a.until > Date.now()) fail(429, 'Too many attempts. Try again in a few minutes.');
}
function failed(key) {
  const a = attempts.get(key) || { n: 0, until: 0 };
  a.n++; if (a.n >= 5) { a.until = Date.now() + 5 * 60000; a.n = 0; }
  attempts.set(key, a);
}

// ---------- event handlers (server-side rules) ----------
const isAdmin = u => u.role === 'admin';
const isSup = u => u.role === 'admin' || u.role === 'supervisor';
function sanitizeSite(d) {
  const id = str(d.id, 80) || fail(400, 'Site id missing');
  const checkpoints = (Array.isArray(d.checkpoints) ? d.checkpoints : []).map(c => ({
    id: str(c.id, 80), name: str(c.name, 120), instructions: str(c.instructions, 1000), code: `GP:${id}:${str(c.id, 80)}`
  })).filter(c => c.id && c.name);
  if (checkpoints.length > MAX_CHECKPOINTS) fail(409, `Each site can have up to ${MAX_CHECKPOINTS} guard-tour locations`);
  const orders = (Array.isArray(d.orders) ? d.orders : []).slice(0, 100).map(o => ({
    id: str(o.id, 80), title: str(o.title, 200), body: str(o.body, 5000), priority: ['low', 'normal', 'high'].includes(o.priority) ? o.priority : 'normal', updated: num(o.updated) || Date.now()
  })).filter(o => o.id);
  return { id, name: str(d.name, 160) || 'Site', address: str(d.address, 300), phone: str(d.phone, 40),
    lat: num(d.lat), lng: num(d.lng), radius: Math.min(5000, Math.max(25, num(d.radius) || 200)), orders, checkpoints, srvAt: clock() };
}
const H = {
  shift(u, d) {
    const id = str(d.id, 80) || fail(400, 'Shift id missing');
    const cur = S.shifts[id];
    if ((cur ? cur.userId : d.userId) !== u.id) fail(403, 'You can only record your own shifts');
    const s = cur || { id, userId: u.id, track: [] };
    Object.assign(s, {
      siteId: str(d.siteId, 80), inAt: num(d.inAt), inGeo: geo(d.inGeo), inFence: str(d.inFence, 20), offsiteReason: str(d.offsiteReason, 300),
      outAt: num(d.outAt), outGeo: geo(d.outGeo), notes: str(d.notes, 2000), round: num(d.round) || 1, srvAt: clock()
    });
    if (geo(d.lastGeo) && !s.lastGeo) s.lastGeo = geo(d.lastGeo);
    S.shifts[id] = s;
  },
  location(u, d) {
    const s = S.shifts[str(d.shiftId, 80)];
    // Monitoring is on-shift only: positions for a finished (or someone else's) shift are discarded.
    if (!s || s.userId !== u.id || s.outAt) return;
    const g = geo(d); if (!g) return;
    s.lastGeo = g; s.track = (s.track || []).concat(g).slice(-500); s.srvAt = clock();
  },
  scan(u, d) {
    const shift = S.shifts[str(d.shiftId, 80)];
    if (!shift || shift.userId !== u.id) fail(403, 'Scan does not belong to your shift');
    S.scans.push({ id: str(d.id, 80), shiftId: shift.id, userId: u.id, siteId: str(d.siteId, 80), cpId: str(d.cpId, 80), at: num(d.at), geo: geo(d.geo),
      status: d.status === 'issue' ? 'issue' : 'clear', note: str(d.note, 500), srvAt: clock() });
    if (S.scans.length > 50000) S.scans.splice(0, S.scans.length - 50000);
    shift.lastScanAt = num(d.at) || Date.now(); shift.srvAt = clock();
  },
  report(u, d) {
    const id = str(d.id, 80) || fail(400, 'Report id missing');
    if (reports.has(id)) return; // already received
    const type = ['incident', 'dar', 'maintenance'].includes(d.type) ? d.type : fail(400, 'Unknown report type');
    const photos = (Array.isArray(d.photos) ? d.photos : []).filter(p => typeof p === 'string' && p.startsWith('data:image/') && p.length < 4e6).slice(0, 6);
    const t = clock();
    const r = {
      id, type, to: 'admin', userId: u.id, userName: u.name, userRole: u.role, shiftId: str(d.shiftId, 80) || null, siteId: str(d.siteId, 80),
      createdAt: num(d.createdAt) || t, occurredAt: num(d.occurredAt) || t, geo: geo(d.geo), photos,
      category: str(d.category, 80), severity: str(d.severity, 20), location: str(d.location, 300), description: str(d.description, 10000),
      persons: str(d.persons, 5000), actions: str(d.actions, 5000), authorities: str(d.authorities, 20), caseNo: str(d.caseNo, 80),
      timeline: str(d.timeline, 20000), weather: str(d.weather, 120),
      receivedAt: t, updatedAt: t, adminSeenAt: null, reviewedAt: null, reviewedBy: null, reviewNote: ''
    };
    reports.set(id, r); saveReport(r);
  },
  reportSeen(u, d) {
    if (!isAdmin(u)) fail(403, 'Administrator only');
    const r = reports.get(str(d.id, 80)); if (!r || r.adminSeenAt) return;
    r.adminSeenAt = num(d.at) || Date.now(); r.updatedAt = clock(); saveReport(r);
  },
  reportReviewed(u, d) {
    if (!isAdmin(u)) fail(403, 'Administrator only');
    const r = reports.get(str(d.id, 80)); if (!r) fail(404, 'Report not found');
    Object.assign(r, { reviewedAt: num(d.reviewedAt) || Date.now(), reviewedBy: u.name, reviewNote: str(d.reviewNote, 1000), adminSeenAt: r.adminSeenAt || Date.now(), updatedAt: clock() });
    saveReport(r);
  },
  message(u, d) {
    const id = str(d.id, 80) || fail(400, 'Message id missing');
    if (S.messages.some(m => m.id === id)) return;
    const channel = str(d.channel, 120);
    const system = !!d.system;
    if (channel === 'admin' && !system) fail(403, 'The report-alert channel is read-only');
    if (!['admin', 'dispatch'].includes(channel) && !channel.startsWith('site:')) fail(400, 'Unknown channel');
    S.messages.push({ id, channel, from: system ? 'system' : u.id, fromName: system ? 'System' : u.name, text: str(d.text, 2000),
      at: num(d.at) || Date.now(), system, reportId: d.reportId ? str(d.reportId, 80) : undefined, srvAt: clock() });
    if (S.messages.length > 20000) S.messages.splice(0, S.messages.length - 20000);
  },
  ack(u, d) {
    const a = S.acks[u.id] = S.acks[u.id] || {};
    for (const o of Array.isArray(d.orders) ? d.orders : []) if (o && o.id) a[str(o.id, 80)] = num(o.version);
  },
  user(u, d, tokenHash) {
    const pin = d.pin == null || d.pin === '' ? null : String(d.pin);
    if (pin && !isPin(pin)) fail(400, 'PIN must be 4–8 digits');
    let t = userById(str(d.id, 80));
    if (t && t.id === u.id && !isAdmin(u)) { // officers may update their own profile
      t.name = str(d.name, 120) || t.name; t.phone = str(d.phone, 40);
      if (pin) { t.pinHash = hashPin(pin); revokeSessions(t.id, tokenHash); }
      t.srvAt = clock(); return;
    }
    if (!isAdmin(u)) fail(403, 'Only the administrator can add or change officers');
    const badge = str(d.badge, 20).trim();
    if (!badge) fail(400, 'Badge number required');
    if (S.users.some(x => x.badge === badge && x.id !== (t && t.id))) fail(409, `Badge ${badge} is already in use`);
    if (!t) {
      if (S.users.filter(x => x.role !== 'admin').length >= MAX_OFFICERS) fail(409, `Limit of ${MAX_OFFICERS} officer accounts reached`);
      if (!pin) fail(400, 'A PIN is required for new officers');
      t = { id: str(d.id, 80) || 'u' + crypto.randomUUID(), role: 'guard' };
      S.users.push(t);
    }
    t.name = str(d.name, 120) || t.name || 'Officer'; t.badge = badge; t.phone = str(d.phone, 40);
    if (t.role !== 'admin') t.role = d.role === 'supervisor' ? 'supervisor' : 'guard';
    if (pin) { t.pinHash = hashPin(pin); revokeSessions(t.id, tokenHash); }
    t.srvAt = clock();
  },
  userDeleted(u, d) {
    if (!isAdmin(u)) fail(403, 'Only the administrator can remove officers');
    const t = userById(str(d.id, 80)); if (!t) return;
    if (t.role === 'admin') fail(403, 'The administrator account cannot be removed');
    if (Object.values(S.shifts).some(s => s.userId === t.id && !s.outAt)) fail(409, `${t.name} is on duty and must check out first`);
    S.users = S.users.filter(x => x.id !== t.id); revokeSessions(t.id);
    S.deletedUsers = (S.deletedUsers || []).concat({ id: t.id, srvAt: clock() }).slice(-1000);
  },
  site(u, d) {
    if (!isAdmin(u)) fail(403, 'Only the administrator can change sites');
    const s = sanitizeSite(d);
    const i = S.sites.findIndex(x => x.id === s.id);
    if (i >= 0) S.sites[i] = s; else S.sites.push(s);
  },
  siteDeleted(u, d) {
    if (!isAdmin(u)) fail(403, 'Only the administrator can delete sites');
    const id = str(d.id, 80);
    if (Object.values(S.shifts).some(s => s.siteId === id && !s.outAt)) fail(409, 'An officer is checked in at this site');
    S.sites = S.sites.filter(x => x.id !== id);
  }
};

// ---------- HTTP ----------
function cors(req, res) {
  const origin = req.headers.origin;
  if (origin && (ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
}
function send(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > BODY_LIMIT) { reject(new HttpError(413, 'Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(new HttpError(400, 'Invalid JSON')); } });
    req.on('error', reject);
  });
}
const ip = req => (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;

async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.replace(/\/+$/, '') || '/';
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (req.method === 'GET' && p === '/') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(`Guard Patrol sync server ${VERSION} is running.\nEnter this address in the app: More → Sync, or "Company server" on the sign-in screen.\n`);
  }
  if (req.method === 'GET' && p === '/api/health') return send(res, 200, { ok: true, server: 'guard-patrol', version: VERSION });

  if (req.method === 'POST' && p === '/api/login') {
    const b = await readJson(req);
    const badge = str(b.badge, 20).trim(), pin = str(b.pin, 20);
    const key = `${ip(req)}|${badge}`;
    throttle(key);
    const u = S.users.find(x => x.badge === badge);
    if (!u || !checkPin(pin, u.pinHash)) { failed(key); fail(401, 'Badge or PIN not recognised'); }
    attempts.delete(key);
    const token = crypto.randomBytes(32).toString('base64url');
    for (const [k, s] of Object.entries(S.sessions)) if (s.exp < Date.now()) delete S.sessions[k];
    S.sessions[sha(token)] = { userId: u.id, exp: Date.now() + SESSION_MS, at: Date.now() };
    save();
    return send(res, 200, { token, user: publicUser(u), users: S.users.map(publicUser) });
  }

  const me = authUser(req);
  if (!me) fail(401, 'Please sign in again');
  const tokenHash = sha(/^Bearer (.+)$/.exec(req.headers.authorization)[1]);

  if (req.method === 'POST' && p === '/api/logout') { delete S.sessions[tokenHash]; save(); return send(res, 200, { ok: true }); }

  if (req.method === 'POST' && p === '/api/events') {
    const ev = await readJson(req);
    const evId = str(ev.id, 80);
    if (evId && seen.has(evId)) return send(res, 200, { ok: true, duplicate: true });
    const fn = H[ev.kind];
    if (fn) fn(me, ev.data || {}, tokenHash);
    if (evId) seen.add(evId);
    save();
    return send(res, 200, { ok: true });
  }

  if (req.method === 'GET' && p === '/api/state') {
    const since = +url.searchParams.get('since') || 0;
    const now = clock();
    const sup = isSup(me), admin = isAdmin(me);
    const out = {
      now, me: publicUser(me),
      users: S.users.map(publicUser),
      sites: S.sites,
      messages: S.messages.filter(m => m.srvAt > since && (m.channel !== 'admin' || admin)).slice(-1000),
      reports: [...reports.values()].filter(r => r.updatedAt > since && (sup || r.userId === me.id)),
      shifts: Object.values(S.shifts).filter(s => s.srvAt > since && (sup || s.userId === me.id))
        .map(({ track, ...s }) => (sup || s.userId === me.id) ? s : { ...s, lastGeo: null }),
      acks: S.acks[me.id] || {}
    };
    return send(res, 200, out);
  }
  fail(404, 'Not found');
}

const server = http.createServer(async (req, res) => {
  cors(req, res);
  try { await route(req, res); }
  catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'Server error' : e.message });
  }
});
server.listen(PORT, () => console.log(`Guard Patrol sync server ${VERSION} listening on :${PORT} · data in ${DATA_DIR} · ${S.users.length} account(s), ${reports.size} report(s)`));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { flush(); process.exit(0); });
