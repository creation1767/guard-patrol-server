'use strict';
/*
 * 4 Horseman Security — company server + website
 * ----------------------------------------------
 * One small Node.js program, no third-party dependencies (Node 18+).
 *  - Many companies on one server. Each company has its own administrator, sites, officers, shifts,
 *    reports and messages, and nothing is shared between companies.
 *  - The owner company (your own, migrated from earlier versions) is never billed and never deleted.
 *  - Other companies subscribe on the website: $149.99/month, recurring, through Stripe Checkout.
 *    A company that cancels is deleted when its paid period ends. A company whose monthly payment fails
 *    keeps everything for GRACE_DAYS (15) after the payment date; if it is still unpaid then, it is deleted.
 *  - Website-only administrator dashboard: scheduling, payroll (hours × pay rates, overtime, export),
 *    client billing (invoices from worked hours) and a client portal (clients see their sites' reports,
 *    check-ins, tour scans and invoices, and send service requests).
 *  - Sign-in everywhere (Android app, web app, website): company code + badge number + PIN.
 *  - Serves the website (web/) at / and the full app in the browser (app/) at /app/.
 *
 * Environment variables
 *   PORT              port to listen on (hosting platforms set this automatically)
 *   DATA_DIR          where data is stored. Defaults to the Railway volume path if one is attached, else ./data.
 *   ADMIN_PIN         owner-company administrator PIN (4–8 digits). Applied on first start and whenever it changes.
 *   ADMIN_BADGE       owner-company administrator badge on first start (default 1000)
 *   OWNER_COMPANY_NAME / OWNER_COMPANY_CODE   owner company name / sign-in code (default "4 Horseman Security" / HORSEMAN)
 *   STRIPE_SECRET_KEY Stripe secret key (sk_test_… or sk_live_…). Without it the website shows sign-up as unavailable.
 *   PRICE_CENTS       monthly price in cents (default 14999 = $149.99)
 *   GRACE_DAYS        days after a missed payment before the company is deleted (default 15)
 *   PUBLIC_URL        public address of this server (default: worked out from each request)
 *   SEED_DEMO_SITES   "false" to start the owner company with no sites
 *   ALLOWED_ORIGINS   extra CORS origins for the API (the Android app's origin is always allowed)
 *   MAX_SITES 2 · MAX_PER_SITE 25 · MAX_OFFICERS 50 · MAX_CHECKPOINTS 20 · SESSION_DAYS 30   (limits per company)
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VERSION = '2.1.0';
const PORT = +process.env.PORT || 8080;
const DATA_DIR = path.resolve(process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data'));
const REPORT_DIR = path.join(DATA_DIR, 'reports');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const WEB_DIR = path.join(__dirname, 'web');
const APP_DIR = path.join(__dirname, 'app');
const MAX_SITES = +process.env.MAX_SITES || 2;
const MAX_PER_SITE = +process.env.MAX_PER_SITE || 25;
const MAX_OFFICERS = +process.env.MAX_OFFICERS || MAX_SITES * MAX_PER_SITE;
const MAX_CHECKPOINTS = +process.env.MAX_CHECKPOINTS || 20;
const SESSION_MS = (+process.env.SESSION_DAYS || 30) * 86400000;
const BODY_LIMIT = 25 * 1024 * 1024;
const OWNER_ID = 'c_owner';
const OWNER_NAME = process.env.OWNER_COMPANY_NAME || '4 Horseman Security';
const OWNER_CODE = (process.env.OWNER_COMPANY_CODE || 'HORSEMAN').toUpperCase();
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_API = process.env.STRIPE_API_BASE || 'https://api.stripe.com';
const PRICE_CENTS = +process.env.PRICE_CENTS || 14999;
const GRACE_MS = (+process.env.GRACE_DAYS || 15) * 86400000;
const PRICE_LOOKUP = `horseman_company_monthly_${PRICE_CENTS}`;
const BILLING_SYNC_MS = (+process.env.BILLING_SYNC_MINUTES || 15) * 60000;
// Stripe Checkout languages for the website's languages (Haitian Creole and Arabic are not offered by Stripe: French / auto).
const STRIPE_LOCALES = { en: 'en', es: 'es', fr: 'fr', ht: 'fr', pt: 'pt-BR', ar: 'auto', ru: 'ru', de: 'de', fil: 'fil' };
const ALLOWED_ORIGINS = ['https://appassets.androidplatform.net'].concat((process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean));

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
const isEmail = e => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;
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
const publicUser = u => ({ id: u.id, name: u.name, badge: u.badge, role: u.role, phone: u.phone || '', siteId: u.siteId || '' });
const publicCompany = C => ({ id: C.id, code: C.code, name: C.name, owner: !!C.owner });
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
// Company codes are the company name in capitals with spaces and punctuation removed ("Acme Security, LLC" -> ACMESECURITYLLC),
// so typing the name any way at sign-in finds the company.
const normCode = c => str(c, 120).toUpperCase().replace(/[^A-Z0-9]/g, '');

// ---------- storage ----------
fs.mkdirSync(REPORT_DIR, { recursive: true });
function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
function emptyCompany(id, name, code) {
  return { id, name, code, createdAt: Date.now(), users: [], sites: [], shifts: {}, scans: [], messages: [], acks: {}, deletedUsers: [], ...emptyOffice() };
}
// Website dashboard data: schedule, payroll settings, clients, invoices, client requests.
function emptyOffice() {
  return { sched: [], pay: { rates: {}, period: 'biweekly', anchor: '', otWeekly: 40, otDaily: 0, otMult: 1.5 },
    clients: [], invoices: [], invoiceSeq: 1000, requests: [], profile: { name: '', address: '', phone: '', email: '', payTo: '', terms: 15, taxPct: 0 } };
}
function demoSites() {
  const t = Date.now();
  const cp = (sid, list) => list.map(([id, name, instructions]) => ({ id, name, instructions, code: `GP:${sid}:${id}` }));
  return [
    { id: 'site1', name: 'Harbor Point Office Park', address: '100 Harbor Point Dr', phone: '', lat: null, lng: null, radius: 200, srvAt: t,
      orders: [
        { id: 'o1', title: 'Access control', priority: 'high', updated: t, body: 'All visitors must sign in at the main lobby desk and show photo ID. Issue a visitor badge and record badge number. No tailgating through badge doors.' },
        { id: 'o2', title: 'Patrol frequency', priority: 'normal', updated: t, body: 'Complete a full exterior and interior tour every 2 hours. Scan every checkpoint. Report lights out, open doors, and hazards.' },
        { id: 'o3', title: 'Emergency procedures', priority: 'high', updated: t, body: 'Observe and report — do not engage. In an emergency call 911 first, then the site supervisor.' }],
      checkpoints: cp('site1', [['c1', 'Main lobby desk', 'Check visitor log and badge stock.'], ['c2', 'Loading dock', 'Roll-up door closed and padlocked after 19:00.'], ['c3', 'Parking garage level 2', 'Look for unattended vehicles and lighting outages.']]) },
    { id: 'site2', name: 'Riverside Apartments', address: '45 Riverside Ave', phone: '', lat: null, lng: null, radius: 250, srvAt: t,
      orders: [{ id: 'o5', title: 'Residents & guests', priority: 'normal', updated: t, body: 'Be courteous with residents. Guests must be escorted or listed with the leasing office.' }],
      checkpoints: cp('site2', [['c6', 'Front gate', 'Gate closes fully; keypad working.'], ['c7', 'Pool gate', 'Locked after 22:00.']]) }];
}
function seedState() {
  const pin = isPin(process.env.ADMIN_PIN) ? process.env.ADMIN_PIN : String(crypto.randomInt(100000, 999999));
  if (!isPin(process.env.ADMIN_PIN)) {
    console.log('\n==================================================================');
    console.log(`  No valid ADMIN_PIN set. Company ${OWNER_CODE}, administrator badge ${process.env.ADMIN_BADGE || '1000'}, temporary PIN: ${pin}`);
    console.log('==================================================================\n');
  }
  const C = emptyCompany(OWNER_ID, OWNER_NAME, OWNER_CODE); C.owner = true;
  C.users.push({ id: 'u_admin', name: 'Administrator', badge: String(process.env.ADMIN_BADGE || '1000'), role: 'admin', phone: '', pinHash: hashPin(pin), srvAt: Date.now() });
  if (process.env.SEED_DEMO_SITES !== 'false') C.sites = demoSites();
  return { v: 2, companies: { [OWNER_ID]: C }, sessions: {}, seenEvents: [], pending: {}, adminPinApplied: isPin(process.env.ADMIN_PIN) ? hashPin(process.env.ADMIN_PIN) : undefined };
}
// Version 1 kept a single company at the top level: it becomes the owner company, unchanged.
function migrate(S) {
  if (S.v === 2) return S;
  const C = emptyCompany(OWNER_ID, OWNER_NAME, OWNER_CODE); C.owner = true;
  for (const k of ['users', 'sites', 'shifts', 'scans', 'messages', 'acks', 'deletedUsers']) if (S[k] !== undefined) C[k] = S[k];
  const sessions = {};
  for (const [k, s] of Object.entries(S.sessions || {})) sessions[k] = { ...s, companyId: OWNER_ID };
  console.log(`Migrated single-company data to owner company ${OWNER_CODE} (${C.users.length} account(s)).`);
  return { v: 2, companies: { [OWNER_ID]: C }, sessions, seenEvents: S.seenEvents || [], pending: {}, adminPinApplied: S.adminPinApplied };
}
let S;
try { S = migrate(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))); writeAtomic(STATE_FILE, JSON.stringify(S)); }
catch (e) {
  if (e.code !== 'ENOENT') { console.error('Cannot read', STATE_FILE, e.message); process.exit(1); }
  S = seedState(); writeAtomic(STATE_FILE, JSON.stringify(S));
}
S.pending = S.pending || {};
for (const C of Object.values(S.companies)) { const e = emptyOffice(); for (const k of Object.keys(e)) if (C[k] === undefined) C[k] = e[k]; }
const owner = () => S.companies[OWNER_ID];
if (owner() && owner().code !== OWNER_CODE && !Object.values(S.companies).some(c => c.code === OWNER_CODE)) owner().code = OWNER_CODE;
// ADMIN_PIN is the owner administrator's recovery PIN: whenever its value changes, the owner administrator
// account is reset to it on the next start. (A PIN changed in the app stays until then.)
if (isPin(process.env.ADMIN_PIN) && !checkPin(process.env.ADMIN_PIN, S.adminPinApplied)) {
  const admin = owner()?.users.find(u => u.role === 'admin');
  if (admin) {
    admin.pinHash = hashPin(process.env.ADMIN_PIN); admin.srvAt = Date.now();
    for (const [k, v] of Object.entries(S.sessions)) if (v.userId === admin.id) delete S.sessions[k];
    S.adminPinApplied = hashPin(process.env.ADMIN_PIN);
    writeAtomic(STATE_FILE, JSON.stringify(S));
    console.log(`Administrator PIN reset from ADMIN_PIN (company ${owner().code}, badge ${admin.badge}).`);
  }
}
const seen = new Set(S.seenEvents || []);
const reports = new Map();
for (const f of fs.readdirSync(REPORT_DIR)) {
  if (!f.endsWith('.json')) continue;
  try { const r = JSON.parse(fs.readFileSync(path.join(REPORT_DIR, f), 'utf8')); r.companyId = r.companyId || OWNER_ID; reports.set(r.id, r); }
  catch (e) { console.error('Skipping unreadable report', f); }
}
let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; S.seenEvents = [...seen].slice(-20000); writeAtomic(STATE_FILE, JSON.stringify(S)); }, 300);
}
function flush() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; } S.seenEvents = [...seen].slice(-20000); writeAtomic(STATE_FILE, JSON.stringify(S)); }
const reportFile = r => path.join(REPORT_DIR, `${r.id.replace(/[^\w-]/g, '_')}.json`);
function saveReport(r) { writeAtomic(reportFile(r), JSON.stringify(r)); }

// ---------- companies ----------
const companyByCode = code => Object.values(S.companies).find(c => c.code === code);
function newCode() {
  for (;;) {
    let c = ''; for (let i = 0; i < 6; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!companyByCode(c)) return c;
  }
}
// Is a code taken by a company, or held by someone else's sign-up that is still at checkout (1 hour)?
const codeTaken = (code, exceptPending) => !!companyByCode(code) ||
  Object.values(S.pending).some(p => p.id !== exceptPending && !p.companyId && normCode(p.companyName) === code && Date.now() - p.createdAt < 3600000);
// The company name is the code. Only if two paid sign-ups raced for the same name does the later one get a number added.
function codeFromName(name) {
  const base = normCode(name); if (!base) return newCode();
  if (!companyByCode(base)) return base;
  for (let i = 2; ; i++) if (!companyByCode(base + i)) return base + i;
}
function createCompany({ name, adminName, email, pinHash, billing }) {
  const id = 'c' + crypto.randomUUID().replace(/-/g, '').slice(0, 16);
  const C = emptyCompany(id, str(name, 120) || 'Security company', codeFromName(name));
  C.email = str(email, 200); C.billing = billing || null;
  C.users.push({ id: 'u_admin', name: str(adminName, 120) || 'Administrator', badge: '1000', role: 'admin', phone: '', pinHash, srvAt: clock() });
  C.messages.push({ id: 'm' + crypto.randomUUID(), channel: 'dispatch', from: 'system', fromName: 'System', system: true, at: Date.now(), srvAt: clock(),
    text: `Welcome to ${C.name}. Your administrator can add sites, guard-tour locations and officers under More.` });
  S.companies[id] = C; flush();
  console.log(`Company created: ${C.name} (${C.code})`);
  return C;
}
function deleteCompany(C, why) {
  if (!C || C.owner) return;
  delete S.companies[C.id];
  for (const [k, s] of Object.entries(S.sessions)) if (s.companyId === C.id) delete S.sessions[k];
  for (const r of [...reports.values()]) if (r.companyId === C.id) { reports.delete(r.id); try { fs.unlinkSync(reportFile(r)); } catch (e) { } }
  for (const [k, p] of Object.entries(S.pending)) if (p.companyId === C.id) delete S.pending[k];
  flush();
  console.log(`Company deleted: ${C.name} (${C.code}) — ${why}`);
}

// ---------- auth ----------
const userById = (C, id) => C.users.find(u => u.id === id);
function authUser(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) return null;
  const s = S.sessions[sha(m[1])];
  if (!s || s.exp < Date.now()) return null;
  const C = S.companies[s.companyId || OWNER_ID]; if (!C) return null;
  const u = userById(C, s.userId);
  return u ? { C, u, tokenHash: sha(m[1]) } : null;
}
function revokeSessions(C, userId, exceptTokenHash) {
  for (const [k, s] of Object.entries(S.sessions)) if ((s.companyId || OWNER_ID) === C.id && s.userId === userId && k !== exceptTokenHash) delete S.sessions[k];
}
const attempts = new Map(); // key -> {n, until}
function throttle(key, max = 5, mins = 5) {
  const a = attempts.get(key);
  if (a && a.until > Date.now()) fail(429, 'Too many attempts. Try again in a few minutes.');
}
function failed(key, max = 5, mins = 5) {
  const a = attempts.get(key) || { n: 0, until: 0 };
  a.n++; if (a.n >= max) { a.until = Date.now() + mins * 60000; a.n = 0; }
  attempts.set(key, a);
}

// ---------- event handlers (server-side rules, always within one company) ----------
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
  shift(C, u, d) {
    const id = str(d.id, 80) || fail(400, 'Shift id missing');
    const cur = C.shifts[id];
    if ((cur ? cur.userId : d.userId) !== u.id) fail(403, 'You can only record your own shifts');
    // Officers check in only at their assigned site (supervisors and the administrator may cover any site).
    if (!cur && u.role === 'guard' && str(d.siteId, 80) !== u.siteId) fail(403, 'You can only check in at your assigned site');
    const s = cur || { id, userId: u.id, track: [] };
    Object.assign(s, {
      siteId: str(d.siteId, 80), inAt: num(d.inAt), inGeo: geo(d.inGeo), inFence: str(d.inFence, 20), offsiteReason: str(d.offsiteReason, 300),
      outAt: num(d.outAt), outGeo: geo(d.outGeo), notes: str(d.notes, 2000), round: num(d.round) || 1, srvAt: clock()
    });
    if (geo(d.lastGeo) && !s.lastGeo) s.lastGeo = geo(d.lastGeo);
    C.shifts[id] = s;
  },
  location(C, u, d) {
    const s = C.shifts[str(d.shiftId, 80)];
    // Monitoring is on-shift only: positions for a finished (or someone else's) shift are discarded.
    if (!s || s.userId !== u.id || s.outAt) return;
    const g = geo(d); if (!g) return;
    s.lastGeo = g; s.track = (s.track || []).concat(g).slice(-500); s.srvAt = clock();
  },
  scan(C, u, d) {
    const shift = C.shifts[str(d.shiftId, 80)];
    if (!shift || shift.userId !== u.id) fail(403, 'Scan does not belong to your shift');
    C.scans.push({ id: str(d.id, 80), shiftId: shift.id, userId: u.id, siteId: str(d.siteId, 80), cpId: str(d.cpId, 80), at: num(d.at), geo: geo(d.geo),
      status: d.status === 'issue' ? 'issue' : 'clear', note: str(d.note, 500), srvAt: clock() });
    if (C.scans.length > 50000) C.scans.splice(0, C.scans.length - 50000);
    shift.lastScanAt = num(d.at) || Date.now(); shift.srvAt = clock();
  },
  report(C, u, d) {
    const id = str(d.id, 80) || fail(400, 'Report id missing');
    if (reports.has(id)) return; // already received
    const type = ['incident', 'dar', 'maintenance'].includes(d.type) ? d.type : fail(400, 'Unknown report type');
    const photos = (Array.isArray(d.photos) ? d.photos : []).filter(p => typeof p === 'string' && p.startsWith('data:image/') && p.length < 4e6).slice(0, 6);
    const t = clock();
    const r = {
      id, companyId: C.id, type, to: 'admin', userId: u.id, userName: u.name, userRole: u.role, shiftId: str(d.shiftId, 80) || null, siteId: str(d.siteId, 80),
      createdAt: num(d.createdAt) || t, occurredAt: num(d.occurredAt) || t, geo: geo(d.geo), photos,
      category: str(d.category, 80), severity: str(d.severity, 20), location: str(d.location, 300), description: str(d.description, 10000),
      persons: str(d.persons, 5000), actions: str(d.actions, 5000), authorities: str(d.authorities, 20), caseNo: str(d.caseNo, 80),
      timeline: str(d.timeline, 20000), weather: str(d.weather, 120),
      receivedAt: t, updatedAt: t, adminSeenAt: null, reviewedAt: null, reviewedBy: null, reviewNote: ''
    };
    reports.set(id, r); saveReport(r);
  },
  reportSeen(C, u, d) {
    if (!isAdmin(u)) fail(403, 'Administrator only');
    const r = reports.get(str(d.id, 80)); if (!r || r.companyId !== C.id || r.adminSeenAt) return;
    r.adminSeenAt = num(d.at) || Date.now(); r.updatedAt = clock(); saveReport(r);
  },
  reportReviewed(C, u, d) {
    if (!isAdmin(u)) fail(403, 'Administrator only');
    const r = reports.get(str(d.id, 80)); if (!r || r.companyId !== C.id) fail(404, 'Report not found');
    Object.assign(r, { reviewedAt: num(d.reviewedAt) || Date.now(), reviewedBy: u.name, reviewNote: str(d.reviewNote, 1000), adminSeenAt: r.adminSeenAt || Date.now(), updatedAt: clock() });
    saveReport(r);
  },
  message(C, u, d) {
    const id = str(d.id, 80) || fail(400, 'Message id missing');
    if (C.messages.some(m => m.id === id)) return;
    const channel = str(d.channel, 120);
    const system = !!d.system;
    if (channel === 'admin' && !system) fail(403, 'The report-alert channel is read-only');
    if (!['admin', 'dispatch'].includes(channel) && !channel.startsWith('site:')) fail(400, 'Unknown channel');
    C.messages.push({ id, channel, from: system ? 'system' : u.id, fromName: system ? 'System' : u.name, text: str(d.text, 2000),
      at: num(d.at) || Date.now(), system, reportId: d.reportId ? str(d.reportId, 80) : undefined, srvAt: clock() });
    if (C.messages.length > 20000) C.messages.splice(0, C.messages.length - 20000);
  },
  ack(C, u, d) {
    const a = C.acks[u.id] = C.acks[u.id] || {};
    for (const o of Array.isArray(d.orders) ? d.orders : []) if (o && o.id) a[str(o.id, 80)] = num(o.version);
  },
  user(C, u, d, tokenHash) {
    const pin = d.pin == null || d.pin === '' ? null : String(d.pin);
    if (pin && !isPin(pin)) fail(400, 'PIN must be 4–8 digits');
    let t = userById(C, str(d.id, 80));
    if (t && t.id === u.id && !isAdmin(u)) { // officers may update their own profile
      t.name = str(d.name, 120) || t.name; t.phone = str(d.phone, 40);
      if (pin) { t.pinHash = hashPin(pin); revokeSessions(C, t.id, tokenHash); }
      t.srvAt = clock(); return;
    }
    if (!isAdmin(u)) fail(403, 'Only the administrator can add or change officers');
    const badge = str(d.badge, 20).trim();
    if (!badge) fail(400, 'Badge number required');
    if (C.users.some(x => x.badge === badge && x.id !== (t && t.id))) fail(409, `Badge ${badge} is already in use`);
    const staff = !t || t.role !== 'admin';
    const siteId = staff ? str(d.siteId, 80) : undefined;
    if (staff) {
      if (!C.sites.some(s => s.id === siteId)) fail(400, 'Choose the site this officer is assigned to');
      if ((!t || siteId !== t.siteId) && C.users.filter(x => x.role !== 'admin' && x.siteId === siteId).length >= MAX_PER_SITE)
        fail(409, `Each site can have up to ${MAX_PER_SITE} officers`);
      const onDuty = t && Object.values(C.shifts).find(s => s.userId === t.id && !s.outAt);
      if (onDuty && onDuty.siteId !== siteId && t.role === 'guard' && d.role !== 'supervisor') fail(409, `${t.name} is on duty and must check out before changing site`);
    }
    if (!t) {
      if (C.users.filter(x => x.role !== 'admin').length >= MAX_OFFICERS) fail(409, `Limit of ${MAX_OFFICERS} officer accounts reached`);
      if (!pin) fail(400, 'A PIN is required for new officers');
      t = { id: str(d.id, 80) || 'u' + crypto.randomUUID(), role: 'guard' };
      C.users.push(t);
    }
    t.name = str(d.name, 120) || t.name || 'Officer'; t.badge = badge; t.phone = str(d.phone, 40);
    if (t.role !== 'admin') { t.role = d.role === 'supervisor' ? 'supervisor' : 'guard'; t.siteId = siteId; }
    if (pin) { t.pinHash = hashPin(pin); revokeSessions(C, t.id, tokenHash); }
    t.srvAt = clock();
  },
  userDeleted(C, u, d) {
    if (!isAdmin(u)) fail(403, 'Only the administrator can remove officers');
    const t = userById(C, str(d.id, 80)); if (!t) return;
    if (t.role === 'admin') fail(403, 'The administrator account cannot be removed');
    if (Object.values(C.shifts).some(s => s.userId === t.id && !s.outAt)) fail(409, `${t.name} is on duty and must check out first`);
    C.users = C.users.filter(x => x.id !== t.id); revokeSessions(C, t.id);
    C.deletedUsers = (C.deletedUsers || []).concat({ id: t.id, srvAt: clock() }).slice(-1000);
  },
  site(C, u, d) {
    if (!isAdmin(u)) fail(403, 'Only the administrator can change sites');
    const s = sanitizeSite(d);
    const i = C.sites.findIndex(x => x.id === s.id);
    if (i < 0 && C.sites.length >= MAX_SITES) fail(409, `Limit of ${MAX_SITES} sites reached`);
    if (i >= 0) C.sites[i] = s; else C.sites.push(s);
  },
  siteDeleted(C, u, d) {
    if (!isAdmin(u)) fail(403, 'Only the administrator can delete sites');
    const id = str(d.id, 80);
    if (Object.values(C.shifts).some(s => s.siteId === id && !s.outAt)) fail(409, 'An officer is checked in at this site');
    if (C.users.some(x => x.role !== 'admin' && x.siteId === id)) fail(409, 'Move the officers assigned to this site to another site first');
    C.sites = C.sites.filter(x => x.id !== id);
  }
};

// ---------- Stripe (subscriptions) ----------
function formEncode(obj, prefix, out = []) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object') formEncode(v, key, out);
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(v)}`);
  }
  return out;
}
async function stripe(method, p, params) {
  if (!STRIPE_KEY) fail(503, 'Online sign-up is not available yet. Please try again later.');
  const q = params ? formEncode(params).join('&') : '';
  const r = await fetch(STRIPE_API + p + (method === 'GET' && q ? `?${q}` : ''), {
    method, body: method === 'GET' ? undefined : q,
    headers: { Authorization: `Bearer ${STRIPE_KEY}`, 'Content-Type': 'application/x-www-form-urlencoded', 'Stripe-Version': '2024-06-20' }
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new HttpError(r.status === 404 ? 404 : 502, j.error?.message || `Payment service error (${r.status})`); e.stripe = j.error; throw e; }
  return j;
}
let priceId = null;
async function monthlyPrice() {
  if (priceId) return priceId;
  const found = await stripe('GET', '/v1/prices', { lookup_keys: [PRICE_LOOKUP], active: 'true', limit: 1 });
  if (found.data && found.data[0]) return (priceId = found.data[0].id);
  const product = await stripe('POST', '/v1/products', { name: '4 Horseman Security — company subscription',
    description: `Guard management for up to ${MAX_SITES} sites and ${MAX_OFFICERS} officers` });
  const price = await stripe('POST', '/v1/prices', { product: product.id, unit_amount: PRICE_CENTS, currency: 'usd', recurring: { interval: 'month' }, lookup_key: PRICE_LOOKUP });
  console.log(`Created Stripe price ${price.id} ($${(PRICE_CENTS / 100).toFixed(2)}/month)`);
  return (priceId = price.id);
}
const billingOf = (sub, prev = {}) => {
  const inv = sub.latest_invoice && typeof sub.latest_invoice === 'object' ? sub.latest_invoice : null;
  return { customer: typeof sub.customer === 'string' ? sub.customer : sub.customer?.id, subscription: sub.id, status: sub.status,
    periodEnd: sub.current_period_end ? sub.current_period_end * 1000 : null, cancelAtPeriodEnd: !!sub.cancel_at_period_end,
    cancelReason: sub.cancellation_details?.reason || null,
    payUrl: inv && inv.status === 'open' ? inv.hosted_invoice_url || null : null,
    invoiceDueAt: inv && inv.status === 'open' ? (inv.due_date || inv.period_end || inv.created) * 1000 : null,
    dueSince: prev.dueSince || null, deleteAt: prev.deleteAt || null, checkedAt: Date.now() };
};
// A payment is overdue while the subscription is past due / unpaid, or Stripe cancelled it because payment failed.
const OVERDUE = b => ['past_due', 'unpaid'].includes(b.status) || (b.status === 'canceled' && b.cancelReason === 'payment_failed');
const ENDED = ['canceled', 'incomplete_expired'];
// Completes a paid sign-up exactly once: creates the company and its administrator.
async function completeSignup(p) {
  if (p.companyId && S.companies[p.companyId]) return S.companies[p.companyId];
  const cs = await stripe('GET', `/v1/checkout/sessions/${encodeURIComponent(p.sessionId)}`, { expand: ['subscription'] });
  if (cs.client_reference_id !== p.id || cs.status !== 'complete' || !cs.subscription) return null;
  const sub = typeof cs.subscription === 'string' ? await stripe('GET', `/v1/subscriptions/${cs.subscription}`) : cs.subscription;
  if (!['active', 'trialing'].includes(sub.status)) return null;
  if (p.companyId && S.companies[p.companyId]) return S.companies[p.companyId];
  const C = createCompany({ name: p.companyName, adminName: p.adminName, email: p.email, pinHash: p.pinHash, billing: billingOf(sub) });
  C.lang = p.lang || 'en';
  p.companyId = C.id; delete p.pinHash; flush();
  return C;
}
async function refreshBilling(C) {
  if (C.owner || !C.billing?.subscription) return;
  const sub = await stripe('GET', `/v1/subscriptions/${encodeURIComponent(C.billing.subscription)}`, { expand: ['latest_invoice'] });
  const b = C.billing = billingOf(sub, C.billing);
  if (OVERDUE(b)) {
    // The grace period counts from the scheduled payment date (the date of the unpaid invoice).
    if (!b.dueSince) b.dueSince = Math.min(b.invoiceDueAt || Date.now(), Date.now());
    b.deleteAt = b.dueSince + GRACE_MS; save();
    if (Date.now() >= b.deleteAt) deleteCompany(C, `payment ${Math.round(GRACE_MS / 86400000)} days overdue`);
    return;
  }
  b.dueSince = b.deleteAt = null; save();
  if (ENDED.includes(sub.status)) deleteCompany(C, `subscription ${sub.status}`);
}
let syncing = false;
async function billingSync() {
  if (!STRIPE_KEY || syncing) return;
  syncing = true;
  try {
    for (const C of Object.values(S.companies)) { try { await refreshBilling(C); } catch (e) { console.error('Billing check failed for', C.code, e.message); } }
    for (const p of Object.values(S.pending)) {
      const age = Date.now() - p.createdAt;
      if (!p.companyId && p.sessionId && age < 2 * 86400000) { try { await completeSignup(p); } catch (e) { } }
      if (age > 7 * 86400000) delete S.pending[p.id];
    }
    save();
  } finally { syncing = false; }
}


// ---------- website dashboard ----------
const cents = v => { const n = Math.round(+v); return isFinite(n) && n >= 0 && n < 1e9 ? n : 0; };
const ymd = v => /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
const publicClient = c => ({ id: c.id, name: c.name, contact: c.contact, email: c.email, phone: c.phone, address: c.address, siteIds: c.siteIds,
  rate: c.rate, terms: c.terms, portal: !!c.portalPinHash, createdAt: c.createdAt });
function dashState(C, me) {
  const cutoff = Date.now() - 400 * 86400000;
  return {
    company: publicCompany(C), me: publicUser(me), lang: C.lang || 'en',
    users: C.users.map(u => ({ ...publicUser(u), rate: C.pay.rates[u.id] || 0 })),
    sites: C.sites.map(s => ({ id: s.id, name: s.name, address: s.address, checkpoints: s.checkpoints.length })),
    sched: C.sched.filter(x => x.end > cutoff), pay: C.pay, profile: C.profile,
    clients: C.clients.map(publicClient), invoices: C.invoices, requests: C.requests,
    onDuty: Object.values(C.shifts).filter(s => !s.outAt).map(s => ({ id: s.id, userId: s.userId, siteId: s.siteId, inAt: s.inAt, inFence: s.inFence })),
    limits: { sites: MAX_SITES, officersPerSite: MAX_PER_SITE, officers: MAX_OFFICERS }
  };
}
const userIn = (C, id) => C.users.some(u => u.id === id) ? id : fail(400, 'Choose an officer');
const siteIn = (C, id) => C.sites.some(s => s.id === id) ? id : fail(400, 'Choose a site');
const newId = pre => pre + crypto.randomUUID().replace(/-/g, '').slice(0, 14);
function invoiceTotals(inv) {
  const sub = inv.lines.reduce((a, l) => a + Math.round(l.qty * l.rate), 0);
  const tax = Math.round(sub * (inv.taxPct || 0) / 100);
  return { subtotal: sub, tax, total: sub + tax };
}
const D = {
  // Schedule: one or many shifts at once (the dashboard's "repeat" and "copy week" send several).
  schedSave(C, u, d) {
    const list = Array.isArray(d.items) ? d.items : [d];
    if (list.length > 500) fail(400, 'Too many shifts at once');
    for (const x of list) {
      const start = num(x.start), end = num(x.end);
      if (!start || !end || end <= start) fail(400, 'The shift must end after it starts');
      if (end - start > 24 * 3600000) fail(400, 'A shift can be at most 24 hours');
      const item = { id: str(x.id, 80) || newId('sh'), userId: x.userId ? userIn(C, str(x.userId, 80)) : '', siteId: siteIn(C, str(x.siteId, 80)),
        start, end, note: str(x.note, 300), srvAt: clock() };
      const i = C.sched.findIndex(y => y.id === item.id);
      if (i >= 0) C.sched[i] = item; else C.sched.push(item);
    }
    const cutoff = Date.now() - 400 * 86400000;
    C.sched = C.sched.filter(x => x.end > cutoff).slice(-8000);
  },
  schedDelete(C, u, d) { const ids = new Set((Array.isArray(d.ids) ? d.ids : [d.id]).map(x => str(x, 80))); C.sched = C.sched.filter(x => !ids.has(x.id)); },
  // Payroll settings and pay rates (cents per hour).
  paySettings(C, u, d) {
    const p = C.pay;
    if (d.period !== undefined) p.period = ['weekly', 'biweekly', 'semimonthly', 'monthly'].includes(d.period) ? d.period : 'biweekly';
    if (d.anchor !== undefined) p.anchor = ymd(d.anchor);
    if (d.otWeekly !== undefined) p.otWeekly = Math.min(168, Math.max(0, +d.otWeekly || 0));
    if (d.otDaily !== undefined) p.otDaily = Math.min(24, Math.max(0, +d.otDaily || 0));
    if (d.otMult !== undefined) p.otMult = Math.min(3, Math.max(1, +d.otMult || 1.5));
    if (d.rates && typeof d.rates === 'object') for (const [id, v] of Object.entries(d.rates)) if (C.users.some(x => x.id === id)) p.rates[id] = cents(v);
  },
  // New officer from the Payroll tab. Same rules as adding one in the app (limits, unique badge, PIN, site);
  // the phones pick the account up on their next sync, because /api/state sends the full officer list.
  officerAdd(C, u, d) {
    if (!str(d.name, 120).trim()) fail(400, 'Enter the officer\'s full name');
    const id = newId('u');
    H.user(C, u, { id, name: str(d.name, 120).trim(), badge: d.badge, phone: d.phone, role: d.role, siteId: d.siteId, pin: d.pin == null ? '' : String(d.pin) });
    if (!userById(C, id)) fail(500, 'The officer could not be added');
    if (d.rate !== undefined) C.pay.rates[id] = cents(d.rate);
    return { id };
  },
  profile(C, u, d) {
    const p = C.profile;
    for (const k of ['name', 'address', 'phone', 'email', 'payTo']) if (d[k] !== undefined) p[k] = str(d[k], k === 'payTo' || k === 'address' ? 600 : 160);
    if (d.terms !== undefined) p.terms = Math.min(120, Math.max(0, Math.round(+d.terms || 0)));
    if (d.taxPct !== undefined) p.taxPct = Math.min(50, Math.max(0, +d.taxPct || 0));
    if (d.lang !== undefined) C.lang = str(d.lang, 8);
  },
  // Clients: the properties / businesses the security company works for.
  clientSave(C, u, d) {
    const id = str(d.id, 80);
    let c = id && C.clients.find(x => x.id === id);
    if (!c) { if (C.clients.length >= 200) fail(409, 'Limit of 200 clients reached'); c = { id: newId('cl'), createdAt: Date.now() }; C.clients.push(c); }
    const name = str(d.name, 160).trim(); if (!name) fail(400, 'Enter the client name');
    const email = str(d.email, 200).trim().toLowerCase();
    if (email && !isEmail(email)) fail(400, 'Enter a valid email address');
    if (email && C.clients.some(x => x.id !== c.id && x.email === email)) fail(409, 'Another client already uses this email address');
    Object.assign(c, { name, contact: str(d.contact, 160), email, phone: str(d.phone, 40), address: str(d.address, 300),
      siteIds: (Array.isArray(d.siteIds) ? d.siteIds : []).map(x => str(x, 80)).filter(x => C.sites.some(s => s.id === x)),
      rate: cents(d.rate), terms: d.terms === '' || d.terms == null ? null : Math.min(120, Math.max(0, Math.round(+d.terms || 0))) });
    if (d.portalPin !== undefined && d.portalPin !== '') {
      if (!isPin(String(d.portalPin))) fail(400, 'Portal PIN must be 4–8 digits');
      if (!c.email) fail(400, 'Add the client\'s email address: it is their portal sign-in');
      c.portalPinHash = hashPin(String(d.portalPin)); endClientSessions(C, c.id);
    }
    if (d.portalOff) { delete c.portalPinHash; endClientSessions(C, c.id); }
    return { id: c.id };
  },
  clientDelete(C, u, d) {
    const id = str(d.id, 80);
    if (C.invoices.some(i => i.clientId === id && i.status !== 'void' && i.status !== 'paid')) fail(409, 'This client has unpaid invoices. Mark them paid or void first.');
    C.clients = C.clients.filter(x => x.id !== id); endClientSessions(C, id);
  },
  // Invoices: built in the dashboard from worked hours, saved here. Numbers are given by the server.
  invoiceSave(C, u, d) {
    const id = str(d.id, 80);
    let inv = id && C.invoices.find(x => x.id === id);
    if (inv && inv.status !== 'draft') fail(409, 'Only draft invoices can be edited');
    const clientId = str(d.clientId, 80); if (!C.clients.some(c => c.id === clientId)) fail(400, 'Choose a client');
    const lines = (Array.isArray(d.lines) ? d.lines : []).slice(0, 200).map(l => ({ desc: str(l.desc, 300), qty: Math.round((+l.qty || 0) * 100) / 100, rate: cents(l.rate) }))
      .filter(l => l.desc || l.qty);
    if (!lines.length) fail(400, 'Add at least one line');
    if (!inv) { if (C.invoices.length >= 5000) C.invoices.shift(); inv = { id: newId('in'), number: String(++C.invoiceSeq), status: 'draft', createdAt: Date.now() }; C.invoices.push(inv); }
    Object.assign(inv, { clientId, lines, from: ymd(d.from), to: ymd(d.to), issued: ymd(d.issued) || new Date().toISOString().slice(0, 10), due: ymd(d.due),
      taxPct: Math.min(50, Math.max(0, +d.taxPct || 0)), notes: str(d.notes, 2000), updatedAt: Date.now() });
    Object.assign(inv, invoiceTotals(inv));
    return { id: inv.id };
  },
  invoiceStatus(C, u, d) {
    const inv = C.invoices.find(x => x.id === str(d.id, 80)) || fail(404, 'Invoice not found');
    const st = str(d.status, 10); if (!['draft', 'sent', 'paid', 'void'].includes(st)) fail(400, 'Unknown status');
    if (inv.status === 'void') fail(409, 'A void invoice cannot be changed');
    inv.status = st; inv.updatedAt = Date.now();
    if (st === 'sent' && !inv.sentAt) inv.sentAt = Date.now();
    if (st === 'paid') inv.paidAt = num(d.paidAt) || Date.now(); else delete inv.paidAt;
  },
  invoiceDelete(C, u, d) {
    const inv = C.invoices.find(x => x.id === str(d.id, 80)); if (!inv) return;
    if (inv.status !== 'draft') fail(409, 'Only drafts can be deleted. Void a sent invoice instead.');
    C.invoices = C.invoices.filter(x => x !== inv);
  },
  requestReply(C, u, d) {
    const r = C.requests.find(x => x.id === str(d.id, 80)) || fail(404, 'Request not found');
    const text = str(d.text, 4000).trim();
    if (text) r.thread.push({ from: 'company', name: u.name, text, at: Date.now() });
    if (d.status) r.status = d.status === 'closed' ? 'closed' : 'open';
    r.updatedAt = Date.now();
  }
};
function endClientSessions(C, clientId) { for (const [k, s] of Object.entries(S.sessions)) if (s.kind === 'client' && s.companyId === C.id && s.clientId === clientId) delete S.sessions[k]; }

// ---------- client portal ----------
function authClient(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || ''); if (!m) return null;
  const s = S.sessions[sha(m[1])]; if (!s || s.kind !== 'client' || s.exp < Date.now()) return null;
  const C = S.companies[s.companyId]; const c = C && C.clients.find(x => x.id === s.clientId);
  return c && c.portalPinHash ? { C, c, tokenHash: sha(m[1]) } : null;
}
function clientState(C, c, days) {
  const from = Date.now() - days * 86400000, sites = new Set(c.siteIds);
  const name = id => C.users.find(u => u.id === id)?.name || 'Officer';
  const cpName = (sid, cid) => C.sites.find(s => s.id === sid)?.checkpoints.find(x => x.id === cid)?.name || 'Checkpoint';
  return {
    company: { name: C.name, code: C.code, phone: C.profile.phone, email: C.profile.email || C.email || '', lang: C.lang || 'en' },
    client: { id: c.id, name: c.name, contact: c.contact, email: c.email },
    sites: C.sites.filter(s => sites.has(s.id)).map(s => ({ id: s.id, name: s.name, address: s.address })),
    reports: [...reports.values()].filter(r => r.companyId === C.id && sites.has(r.siteId) && (r.occurredAt || r.createdAt) > from)
      .sort((a, b) => b.createdAt - a.createdAt).slice(0, 300)
      .map(r => ({ id: r.id, type: r.type, siteId: r.siteId, userName: r.userName, occurredAt: r.occurredAt, createdAt: r.createdAt, category: r.category,
        severity: r.severity, location: r.location, description: r.description, actions: r.actions, authorities: r.authorities, caseNo: r.caseNo,
        timeline: r.timeline, weather: r.weather, photos: r.photos, reviewedAt: r.reviewedAt })),
    shifts: Object.values(C.shifts).filter(s => sites.has(s.siteId) && s.inAt && (s.outAt || Date.now()) > from).sort((a, b) => b.inAt - a.inAt).slice(0, 1000)
      .map(s => ({ id: s.id, siteId: s.siteId, officer: name(s.userId), inAt: s.inAt, outAt: s.outAt, inFence: s.inFence })),
    scans: C.scans.filter(x => sites.has(x.siteId) && x.at > from).slice(-3000).reverse()
      .map(x => ({ id: x.id, siteId: x.siteId, checkpoint: cpName(x.siteId, x.cpId), officer: name(x.userId), at: x.at, status: x.status, note: x.note })),
    invoices: C.invoices.filter(i => i.clientId === c.id && i.status !== 'draft'),
    profile: C.profile,
    requests: C.requests.filter(r => r.clientId === c.id)
  };
}
async function clientRoute(req, res, p, url) {
  if (req.method === 'POST' && p === '/api/client/login') {
    const b = await readJson(req);
    const code = normCode(b.company), email = str(b.email, 200).trim().toLowerCase(), pin = str(b.pin, 20);
    const key = `client|${ip(req)}|${code}|${email}`; throttle(key);
    const C = companyByCode(code), c = C && email && C.clients.find(x => x.email === email);
    if (!c || !c.portalPinHash || !checkPin(pin, c.portalPinHash)) { failed(key); fail(401, C ? 'Email or PIN not recognised' : 'Company code not recognised'); }
    attempts.delete(key);
    const token = crypto.randomBytes(32).toString('base64url');
    S.sessions[sha(token)] = { kind: 'client', clientId: c.id, companyId: C.id, exp: Date.now() + SESSION_MS, at: Date.now() };
    save();
    return send(res, 200, { token });
  }
  const a = authClient(req); if (!a) fail(401, 'Please sign in again');
  const { C, c, tokenHash } = a;
  if (req.method === 'POST' && p === '/api/client/logout') { delete S.sessions[tokenHash]; save(); return send(res, 200, { ok: true }); }
  if (req.method === 'GET' && p === '/api/client/state') return send(res, 200, clientState(C, c, Math.min(366, Math.max(1, +url.searchParams.get('days') || 30))));
  if (req.method === 'POST' && p === '/api/client/request') {
    const b = await readJson(req);
    const subject = str(b.subject, 160).trim(), text = str(b.text, 4000).trim();
    if (!subject || !text) fail(400, 'Enter a subject and a message');
    if (C.requests.filter(r => r.clientId === c.id && r.at > Date.now() - 86400000).length >= 30) fail(429, 'Too many requests today. Please call us instead.');
    const r = { id: newId('rq'), clientId: c.id, clientName: c.name, subject, status: 'open', at: Date.now(), updatedAt: Date.now(),
      siteId: c.siteIds.includes(str(b.siteId, 80)) ? str(b.siteId, 80) : '', thread: [{ from: 'client', name: c.contact || c.name, text, at: Date.now() }] };
    C.requests.push(r); if (C.requests.length > 3000) C.requests.shift();
    C.messages.push({ id: 'm' + crypto.randomUUID(), channel: 'admin', from: 'system', fromName: 'System', system: true, at: Date.now(), srvAt: clock(),
      text: `Client request from ${c.name}: ${subject}` });
    save(); return send(res, 200, { ok: true, id: r.id });
  }
  if (req.method === 'POST' && p === '/api/client/reply') {
    const b = await readJson(req);
    const r = C.requests.find(x => x.id === str(b.id, 80) && x.clientId === c.id) || fail(404, 'Request not found');
    const text = str(b.text, 4000).trim(); if (!text) fail(400, 'Write a message');
    r.thread.push({ from: 'client', name: c.contact || c.name, text, at: Date.now() }); r.status = 'open'; r.updatedAt = Date.now();
    C.messages.push({ id: 'm' + crypto.randomUUID(), channel: 'admin', from: 'system', fromName: 'System', system: true, at: Date.now(), srvAt: clock(),
      text: `Client reply from ${c.name}: ${r.subject}` });
    save(); return send(res, 200, { ok: true });
  }
  fail(404, 'Not found');
}

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
const SECURITY_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', 'X-Frame-Options': 'DENY' };
function send(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY_HEADERS });
  res.end(JSON.stringify(obj));
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
const baseUrl = req => (process.env.PUBLIC_URL || `${(req.headers['x-forwarded-proto'] || 'http').split(',')[0]}://${req.headers['x-forwarded-host'] || req.headers.host}`).replace(/\/+$/, '');

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.json': 'application/json', '.mp4': 'video/mp4', '.txt': 'text/plain; charset=utf-8' };
const PAGES = { '/': 'index.html', '/signup': 'signup.html', '/signup/success': 'success.html', '/login': 'login.html', '/account': 'account.html', '/client': 'client.html', '/terms': 'terms.html', '/privacy': 'privacy.html' };
function sendFile(res, dir, rel, status = 200) {
  const file = path.join(dir, path.normalize('/' + rel).slice(1));
  if (!file.startsWith(dir + path.sep)) return false;
  let data; try { data = fs.readFileSync(file); } catch (e) { return false; }
  const ext = path.extname(file).toLowerCase();
  const head = { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': ext === '.html' || ext === '.js' || ext === '.css' ? 'no-cache' : 'public, max-age=86400', 'Accept-Ranges': 'bytes', ...SECURITY_HEADERS };
  // Byte ranges: Safari and iPhones only play video when the server answers range requests.
  const m = status === 200 && /^bytes=(\d*)-(\d*)$/.exec(res.req?.headers.range || '');
  if (m && (m[1] || m[2])) {
    const size = data.length;
    let start = m[1] ? +m[1] : size - +m[2], end = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
    if (start < 0) start = 0;
    if (start >= size || start > end) { res.writeHead(416, { 'Content-Range': `bytes */${size}`, ...SECURITY_HEADERS }); res.end(); return true; }
    res.writeHead(206, { ...head, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    res.end(data.subarray(start, end + 1)); return true;
  }
  res.writeHead(status, head);
  res.end(data); return true;
}

async function route(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname.replace(/\/+$/, '') || '/';
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  // ----- website and web app -----
  if (req.method === 'GET' && !p.startsWith('/api/')) {
    if (PAGES[p] && sendFile(res, WEB_DIR, PAGES[p])) return;
    if (p.startsWith('/assets/') && sendFile(res, WEB_DIR, p.slice(8))) return;
    if (p === '/app' && !url.pathname.endsWith('/')) { res.writeHead(302, { Location: '/app/' + url.search }); return res.end(); }
    if (p === '/app' && sendFile(res, APP_DIR, 'index.html')) return;
    if (p.startsWith('/app/') && sendFile(res, APP_DIR, p.slice(5))) return;
    if (sendFile(res, WEB_DIR, '404.html', 404)) return;
    res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Not found');
  }

  if (req.method === 'GET' && p === '/api/health') return send(res, 200, { ok: true, server: 'guard-patrol', version: VERSION });
  if (req.method === 'GET' && p === '/api/plan') return send(res, 200, { price: PRICE_CENTS, currency: 'usd', interval: 'month', signupOpen: !!STRIPE_KEY, graceDays: Math.round(GRACE_MS / 86400000),
    limits: { sites: MAX_SITES, officersPerSite: MAX_PER_SITE, officers: MAX_OFFICERS, tourLocationsPerSite: MAX_CHECKPOINTS } });

  // ----- sign-up: details → Stripe Checkout → company created once payment succeeds -----
  if (req.method === 'POST' && p === '/api/signup') {
    const b = await readJson(req);
    const key = `signup|${ip(req)}`; throttle(key);
    const companyName = str(b.companyName, 120).trim(), adminName = str(b.adminName, 120).trim(), email = str(b.email, 200).trim(), pin = str(b.pin, 20);
    if (companyName.length < 2) fail(400, 'Enter your company name');
    const code = normCode(companyName);
    if (code.length < 2) fail(400, 'Your company name must include at least two letters or numbers');
    if (codeTaken(code)) fail(409, `The company name "${companyName}" is already taken. Add your city or another word to make it unique.`);
    if (adminName.length < 2) fail(400, 'Enter your name');
    if (!isEmail(email)) fail(400, 'Enter a valid email address');
    if (!isPin(pin)) fail(400, 'Choose a PIN of 4–8 digits');
    failed(key, 10, 60); // at most 10 checkout attempts per hour from one address
    const price = await monthlyPrice();
    const id = 'p' + crypto.randomUUID().replace(/-/g, '');
    const base = baseUrl(req);
    const cs = await stripe('POST', '/v1/checkout/sessions', {
      mode: 'subscription', line_items: [{ price, quantity: 1 }], client_reference_id: id, customer_email: email,
      success_url: `${base}/signup/success?session_id={CHECKOUT_SESSION_ID}`, cancel_url: `${base}/signup?canceled=1`,
      locale: STRIPE_LOCALES[str(b.lang, 8)] || 'auto',
      metadata: { pending: id, company: companyName }, subscription_data: { metadata: { pending: id, company: companyName } }
    });
    S.pending[id] = { id, sessionId: cs.id, companyName, adminName, email, pinHash: hashPin(pin), lang: str(b.lang, 8), createdAt: Date.now() };
    save();
    return send(res, 200, { url: cs.url });
  }
  if (req.method === 'GET' && p === '/api/signup/complete') {
    const sid = str(url.searchParams.get('session_id'), 300);
    const pend = Object.values(S.pending).find(x => x.sessionId === sid);
    if (!pend) fail(404, 'We could not find this sign-up. If you were charged, contact support.');
    const C = await completeSignup(pend);
    if (!C) return send(res, 202, { pending: true });
    return send(res, 200, { company: publicCompany(C), badge: C.users.find(u => u.role === 'admin')?.badge || '1000', adminName: C.users.find(u => u.role === 'admin')?.name });
  }


  // ----- client portal (a company's customers: company code + email + portal PIN) -----
  if (p.startsWith('/api/client/')) return clientRoute(req, res, p, url);
  if (req.method === 'POST' && p === '/api/login') {
    const b = await readJson(req);
    const code = normCode(b.company) || OWNER_CODE;
    const badge = str(b.badge, 20).trim(), pin = str(b.pin, 20);
    const key = `${ip(req)}|${code}|${badge}`;
    throttle(key);
    const C = companyByCode(code);
    const u = C && C.users.find(x => x.badge === badge);
    if (!u || !checkPin(pin, u.pinHash)) { failed(key); fail(401, C ? 'Badge or PIN not recognised' : 'Company code not recognised'); }
    attempts.delete(key);
    const token = crypto.randomBytes(32).toString('base64url');
    for (const [k, s] of Object.entries(S.sessions)) if (s.exp < Date.now()) delete S.sessions[k];
    S.sessions[sha(token)] = { userId: u.id, companyId: C.id, exp: Date.now() + SESSION_MS, at: Date.now() };
    save();
    return send(res, 200, { token, user: publicUser(u), users: C.users.map(publicUser), company: publicCompany(C) });
  }

  const auth = authUser(req);
  if (!auth) fail(401, 'Please sign in again');
  const { C, u: me, tokenHash } = auth;

  if (req.method === 'POST' && p === '/api/logout') { delete S.sessions[tokenHash]; save(); return send(res, 200, { ok: true }); }

  if (req.method === 'POST' && p === '/api/events') {
    const ev = await readJson(req);
    const evId = str(ev.id, 80);
    if (evId && seen.has(evId)) return send(res, 200, { ok: true, duplicate: true });
    const fn = H[ev.kind];
    if (fn) fn(C, me, ev.data || {}, tokenHash);
    if (evId) seen.add(evId);
    save();
    return send(res, 200, { ok: true });
  }

  if (req.method === 'GET' && p === '/api/state') {
    const since = +url.searchParams.get('since') || 0;
    const now = clock();
    const sup = isSup(me), admin = isAdmin(me);
    return send(res, 200, {
      now, me: publicUser(me), company: publicCompany(C),
      users: C.users.map(publicUser),
      sites: C.sites,
      messages: C.messages.filter(m => m.srvAt > since && (m.channel !== 'admin' || admin)).slice(-1000),
      reports: [...reports.values()].filter(r => r.companyId === C.id && r.updatedAt > since && (sup || r.userId === me.id)),
      shifts: Object.values(C.shifts).filter(s => s.srvAt > since && (sup || s.userId === me.id)).map(({ track, ...s }) => s),
      acks: C.acks[me.id] || {},
      // My schedule (app): my planned shifts from yesterday to five weeks ahead, plus open shifts at my site.
      schedule: C.sched.filter(x => x.end > Date.now() - 86400000 && x.start < Date.now() + 35 * 86400000 &&
        (x.userId === me.id || (!x.userId && (me.role !== 'guard' || x.siteId === me.siteId))))
        .sort((a, b) => a.start - b.start).slice(0, 300)
        .map(x => ({ id: x.id, siteId: x.siteId, start: x.start, end: x.end, note: x.note, open: !x.userId }))
    });
  }


  // ----- administrator dashboard (website): scheduling, payroll, billing, client portal -----
  if (p === '/api/dash' || p.startsWith('/api/dash/')) {
    if (!isAdmin(me)) fail(403, 'Only the company administrator can use the dashboard');
    if (req.method === 'GET' && p === '/api/dash') return send(res, 200, dashState(C, me));
    if (req.method === 'GET' && p === '/api/dash/shifts') {
      const from = +url.searchParams.get('from') || 0, to = +url.searchParams.get('to') || Date.now();
      return send(res, 200, { shifts: Object.values(C.shifts).filter(s => s.inAt && s.inAt < to && (s.outAt || Date.now()) > from)
        .map(s => ({ id: s.id, userId: s.userId, siteId: s.siteId, inAt: s.inAt, outAt: s.outAt, inFence: s.inFence })) });
    }
    if (req.method === 'POST') {
      const fn = Object.hasOwn(D, p.slice(10)) && D[p.slice(10)]; if (!fn) fail(404, 'Not found');
      const out = fn(C, me, await readJson(req)) || {};
      save(); return send(res, 200, { ok: true, ...out, state: dashState(C, me) });
    }
  }

  // ----- account & billing (company administrator) -----
  if (p.startsWith('/api/account')) {
    if (!isAdmin(me)) fail(403, 'Only the company administrator can manage the account');
    if (req.method === 'GET' && p === '/api/account') {
      try { await refreshBilling(C); } catch (e) { }
      if (!S.companies[C.id]) fail(410, 'This subscription has ended and the company account was removed.');
      return send(res, 200, { company: { ...publicCompany(C), createdAt: C.createdAt, email: C.email || '' }, me: publicUser(me),
        billing: C.owner ? { status: 'owner' } : C.billing ? { status: C.billing.status, periodEnd: C.billing.periodEnd, cancelAtPeriodEnd: C.billing.cancelAtPeriodEnd,
          overdue: OVERDUE(C.billing), dueSince: C.billing.dueSince, deleteAt: C.billing.deleteAt, payUrl: C.billing.payUrl } : { status: 'none' },
        graceDays: Math.round(GRACE_MS / 86400000),
        price: PRICE_CENTS,
        usage: { sites: C.sites.length, maxSites: MAX_SITES, officers: C.users.filter(x => x.role !== 'admin').length, maxOfficers: MAX_OFFICERS } });
    }
    if (C.owner || !C.billing?.subscription) fail(400, 'This company has no subscription to manage');
    if (req.method === 'POST' && (p === '/api/account/cancel' || p === '/api/account/resume')) {
      const sub = await stripe('POST', `/v1/subscriptions/${encodeURIComponent(C.billing.subscription)}`, { cancel_at_period_end: p.endsWith('cancel') ? 'true' : 'false' });
      C.billing = billingOf(sub, C.billing); save();
      return send(res, 200, { ok: true, cancelAtPeriodEnd: C.billing.cancelAtPeriodEnd, periodEnd: C.billing.periodEnd });
    }
    if (req.method === 'POST' && p === '/api/account/portal') {
      const ps = await stripe('POST', '/v1/billing_portal/sessions', { customer: C.billing.customer, return_url: `${baseUrl(req)}/account` });
      return send(res, 200, { url: ps.url });
    }
  }
  fail(404, 'Not found');
}

const server = http.createServer(async (req, res) => {
  cors(req, res);
  try { await route(req, res); }
  catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status >= 500) console.error(e.message || e);
    if (!res.headersSent) send(res, status, { error: status === 500 ? 'Server error' : e.message });
  }
});
server.listen(PORT, () => {
  const n = Object.values(S.companies).reduce((a, c) => a + c.users.length, 0);
  console.log(`Guard Patrol sync server ${VERSION} listening on :${PORT} · data in ${DATA_DIR} · ${Object.keys(S.companies).length} company(ies), ${n} account(s), ${reports.size} report(s) · payments ${STRIPE_KEY ? (STRIPE_KEY.startsWith('sk_live') ? 'LIVE' : 'test mode') : 'not configured'}`);
  if (STRIPE_KEY) { setTimeout(billingSync, 5000); setInterval(billingSync, BILLING_SYNC_MS); }
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { flush(); process.exit(0); });
