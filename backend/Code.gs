/**
 * ใบจัดบิน ฝูงบิน 602 — Backend API (Google Apps Script)
 *
 * Deploy เป็น Web App:  Execute as = Me,  Who has access = Anyone
 * (ทุก action ยกเว้น login/ping ต้องมี session token ที่ได้จากการ login)
 *
 * Frontend (PWA บน GitHub Pages) เรียกด้วย:
 *   fetch(API_URL, {method:'POST', headers:{'Content-Type':'text/plain;charset=utf-8'},
 *                   body: JSON.stringify({action, token, ...params})})
 *
 * ครั้งแรก: เลือกฟังก์ชัน setup แล้วกด Run → ดูรหัสผ่าน admin ชั่วคราวใน Execution log
 */

// ───────────────────────── Config ─────────────────────────
const APP = {
  DB_PROP: 'APP_DB_ID',
  CREW_PROP: 'CREW_SHEET_ID',
  CREW_TAB_PROP: 'CREW_SHEET_TAB',
  TITLE_PROP: 'UNIT_TITLE',
  AIRCRAFT_VER_PROP: 'AIRCRAFT_VERSION',
  DEFAULT_TITLE: 'ใบจัดบิน | ฝูงบิน 602 กองบิน 6',
  SESSION_TTL: 6 * 60 * 60,          // วินาที (CacheService เก็บได้สูงสุด 6 ชม.)
  CREW_CACHE_TTL: 10 * 60,
  HASH_ROUNDS: 1500,                 // ปรับได้ — ค่าที่เก็บในชีตจำจำนวนรอบไว้ในตัว
  MAX_LOGIN_FAILS: 5,
  LOCKOUT_SEC: 15 * 60,
  MIN_PASSWORD: 8,
  VIEWER_SEES_UNRELEASED: false,     // viewer เห็นเฉพาะใบที่ release แล้ว
  CREW_DEPTS: ['OPS'],              // ดึงเฉพาะนักบินฝ่ายยุทธการ (DeptCode) — ไม่ส่งข้อมูลฝ่ายอื่นออกไป
  TZ: 'Asia/Bangkok',
};

const ROLES = ['admin', 'scheduler', 'commander', 'documents', 'viewer'];
const CAN = {
  editOrder:     ['admin', 'scheduler'],
  release:       ['admin', 'scheduler'],
  editAircraft:  ['admin', 'scheduler'],
  approve:       ['admin', 'commander'],
  seeUnreleased: ['admin', 'scheduler', 'commander', 'documents'],   // documents = ผู้ดูแลเอกสาร: เห็นทุกสถานะ แก้ไขไม่ได้
  manageUsers:   ['admin'],
  settings:      ['admin'],
  deleteOrder:   ['admin'],
  managePilots:  ['admin', 'scheduler'],   // เพิ่ม/แก้ไข/ปิดใช้งานนักบินใน CRM602
};

// DRAFT = ร่าง (ผู้จัดบินยังจัดทำ) → PENDING = ส่งขออนุมัติแล้ว → APPROVED / DENIED → RELEASED
const STATUS = { DRAFT: 'DRAFT', PENDING: 'PENDING', APPROVED: 'APPROVED', DENIED: 'DENIED', RELEASED: 'RELEASED' };

const SHEETS = {
  Users:        ['username', 'displayName', 'role', 'passwordHash', 'active', 'mustChange', 'createdAt', 'lastLogin'],
  FlightOrders: ['date', 'status', 'revision', 'version', 'updatedBy', 'updatedAt', 'approvedBy', 'approvedAt',
                 'denyReason', 'releasedBy', 'releasedAt', 'missionCount', 'json', 'log', 'batchId'],
  Aircraft:     ['tail', 'type', 'designation', 'status', 'detail', 'planCheck', 'sort', 'updatedBy', 'updatedAt'],
  AircraftLog:  ['timestamp', 'user', 'json'],
  MissionLog:   ['date', 'status', 'revision', 'missionNo', 'aircraftTail', 'aircraftType', 'missionType', 'title',
                 'callsign', 'route', 'brief', 'tow', 'takeoff', 'pax', 'crewCount', 'acRole', 'fuelTons'],
  CrewLog:      ['date', 'status', 'missionNo', 'aircraftTail', 'aircraftType', 'missionType', 'personId', 'name', 'dept', 'role'],
  AuditLog:     ['timestamp', 'user', 'action', 'detail'],
  LineLinks:    ['key', 'personId', 'name', 'lineUserId', 'status', 'linkedAt', 'updatedAt'],
  LineCodes:    ['code', 'key', 'name', 'createdBy', 'createdAt', 'expiresAtMs', 'usedAt'],
  LineQueue:    ['id', 'createdAt', 'type', 'payload', 'status', 'tries', 'sentAt', 'detail'],
  Holidays:     ['date', 'name'],
};

// ───────────────────────── HTTP entry ─────────────────────────
function doGet() {
  return json_({ ok: true, data: { service: 'flight-order-602', time: now_() } });
}

function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, code: 'BAD_REQUEST', error: 'รูปแบบคำขอไม่ถูกต้อง' });
  }
  // webhook จาก LINE (ไม่มี action) — ตอบ 200 เสมอ
  if (Array.isArray(req.events) && 'destination' in req) {
    REQ_T0 = Date.now(); REQ_TAG = '[line-webhook]';
    try { handleLineWebhook_(req); } catch (err) { console.error(err && err.stack || err); }
    step_('done ' + req.events.length + ' events');
    return json_({ ok: true });
  }
  const t0 = Date.now();
  let code = 'OK';
  REQ_T0 = t0; REQ_TAG = '[' + (req.action || '?') + ']';
  console.log(REQ_TAG + ' start' + (req.date ? ' date=' + req.date : '') + (req.from ? ' range=' + req.from + '..' + (req.to || '') : '') +
    ((req.items || req.days) ? ' days=' + (req.items || req.days).map(x => x && x.date).join(',') : ''));
  try {
    const data = route_(req);
    return json_({ ok: true, data: data });
  } catch (err) {
    code = err.code || 'ERROR';
    if (code === 'ERROR') console.error(err && err.stack || err);
    return json_({ ok: false, code: code, error: String(err.message || err), extra: err.extra || null });
  } finally {
    // บันทึกลง Executions log: คำสั่งอะไร ใช้เวลาเท่าไร — ไว้หาว่าคำสั่งไหนช้า (ไม่บันทึกรหัสผ่าน/token)
    const n = (req.items || req.days || []).length;
    console.log('[' + (req.action || '?') + '] ' + code + ' ' + (Date.now() - t0) + ' ms' +
      (req.date ? ' date=' + req.date : '') + (req.from ? ' range=' + req.from + '..' + (req.to || '') : '') + (n ? ' days=' + n : '') +
      (req.username ? ' user=' + req.username : ''));
  }
}

// log ทีละขั้น: ถ้าคำขอค้างจนโดนตัดที่ 6 นาที จะเห็นใน Executions ว่าค้างหลังขั้นไหน
let REQ_T0 = Date.now(), REQ_TAG = '';
function step_(label) { console.log(REQ_TAG + ' +' + (Date.now() - REQ_T0) + 'ms ' + label); }

function route_(req) {
  const a = String(req.action || '');
  if (a === 'ping') return { time: now_() };
  if (a === 'login') return login_(req.username, req.password);

  const user = checkSession_(req.token);
  if (user.mustChange && ['logout', 'me', 'changePassword', 'bootstrap'].indexOf(a) < 0) {
    throw err_('MUST_CHANGE', 'กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน');
  }
  switch (a) {
    case 'logout':         return logout_(req.token);
    case 'me':             return publicUser_(user);
    case 'changePassword': return changePassword_(user, req.oldPassword, req.newPassword);
    case 'bootstrap':      return bootstrap_(user, req);
    case 'getCrew':        return getCrew_(!!req.refresh);
    case 'getOrder':       return getOrder_(user, req.date);
    case 'getRange':       return getRange_(user, req.from, req.to);
    case 'saveBatch':      return saveBatch_(user, req.days, req.batchDates);
    case 'submitBatch':    return submitBatch_(user, req.items, req.note);
    case 'approveBatch':   return approveBatch_(user, req.items, req.note);
    case 'denyBatch':      return denyBatch_(user, req.items, req.reason);
    case 'releaseBatch':   return releaseBatch_(user, req.items);
    case 'getHolidays':    return getHolidays_();
    case 'saveHolidays':   return saveHolidays_(user, req.year, req.holidays);
    case 'listOrders':     return listOrders_(user, req.from, req.to);
    case 'saveOrder':      return saveOrder_(user, req.date, req.order, req.baseVersion);
    case 'approveOrder':   return approveOrder_(user, req.date, req.version, req.note);
    case 'denyOrder':      return denyOrder_(user, req.date, req.version, req.reason);
    case 'releaseOrder':   return releaseOrder_(user, req.date, req.version);
    case 'reviseOrder':    return reviseOrder_(user, req.date, req.reason);
    case 'deleteOrder':    return deleteOrder_(user, req.date);
    case 'lineIssueCodes': return lineIssueCodes_(user, req.keys);
    case 'lineLinks':      return lineLinks_(user);
    case 'lineUnlink':     return lineUnlink_(user, req.key);
    case 'lineTest':       return lineTest_(user);
    case 'lineTestGroup':  return lineTestGroup_(user);
    case 'savePilot':      return savePilot_(user, req.pilot);
    case 'setPilotActive': return setPilotActive_(user, req.id, req.active);
    case 'getAircraft':    return getAircraft_();
    case 'saveAircraft':   return saveAircraft_(user, req.aircraft, req.baseVersion);
    case 'listUsers':      return listUsers_(user);
    case 'saveUser':       return saveUser_(user, req.user);
    case 'resetPassword':  return resetPassword_(user, req.username);
    case 'getSettings':    return getSettings_(user);
    case 'saveSettings':   return saveSettings_(user, req.settings);
    case 'stats':          return stats_(user, req.from, req.to);
    default: throw err_('BAD_REQUEST', 'ไม่รู้จักคำสั่ง: ' + a);
  }
}

// ───────────────────────── Setup ─────────────────────────
/** รันครั้งแรกจาก editor: สร้างฐานข้อมูลและบัญชี admin */
function setup() {
  const ss = db_();
  const sh = ss.getSheetByName('Users');
  const values = sh.getDataRange().getValues();
  const hasAdmin = values.slice(1).some(r => r[2] === 'admin' && isTrue_(r[4]));
  installTriggers();
  if (hasAdmin) {
    console.log('มี admin อยู่แล้ว ฐานข้อมูล: ' + ss.getUrl());
    return;
  }
  const temp = tempPassword_();
  sh.appendRow(['admin', 'ผู้ดูแลระบบ', 'admin', hashPassword_(temp), true, true, now_(), '']);
  console.log('ฐานข้อมูล: ' + ss.getUrl());
  console.log('สร้างบัญชี admin แล้ว  username: admin   รหัสผ่านชั่วคราว: ' + temp);
  console.log('เข้าสู่ระบบครั้งแรกแล้วระบบจะบังคับให้เปลี่ยนรหัสผ่าน');
}

/** ใช้เมื่อลืมรหัส admin: รันจาก editor แล้วดูรหัสใหม่ใน log */
function emergencyResetAdmin() {
  const sh = db_().getSheetByName('Users');
  const row = findRow_(sh, 'admin');
  const temp = tempPassword_();
  if (row) {
    sh.getRange(row, 3, 1, 4).setValues([['admin', hashPassword_(temp), true, true]]);
  } else {
    sh.appendRow(['admin', 'ผู้ดูแลระบบ', 'admin', hashPassword_(temp), true, true, now_(), '']);
  }
  CacheService.getScriptCache().put('revoked_admin', String(Date.now()), APP.SESSION_TTL);
  console.log('รีเซ็ต admin แล้ว  รหัสผ่านชั่วคราว: ' + temp);
}

let DB_CACHE_ = null;   // เปิด Spreadsheet ครั้งเดียวต่อหนึ่งคำขอ
function db_() {
  if (DB_CACHE_) return DB_CACHE_;
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(APP.DB_PROP);
  let ss;
  if (id) {
    // ไม่สร้างไฟล์ใหม่เมื่อเปิดไม่ได้ — ป้องกันข้อมูล "หาย" เพราะ Google ขัดข้องชั่วคราว
    try { ss = SpreadsheetApp.openById(id); }
    catch (e) { throw err_('DB_UNAVAILABLE', 'เปิดฐานข้อมูลไม่ได้ชั่วคราว กรุณาลองใหม่ (' + e.message + ')'); }
  } else {
    ss = SpreadsheetApp.create('ฐานข้อมูลใบจัดบิน ฝูงบิน 602');
    props.setProperty(APP.DB_PROP, ss.getId());
  }
  ensureSheets_(ss);
  DB_CACHE_ = ss;
  step_('db opened');
  return ss;
}

function ensureSheets_(ss) {
  const cache = CacheService.getScriptCache();
  if (cache.get('sheets_ok_v4_' + ss.getId())) return;
  Object.keys(SHEETS).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      const head = SHEETS[name];
      sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#d9eaf7');
      sh.setFrozenRows(1);
      sh.getRange('A:A').setNumberFormat('@');   // คีย์เป็นข้อความเสมอ ไม่ให้ Sheets แปลงเป็นวันที่
    } else if (sh.getLastColumn() < SHEETS[name].length) {
      // อัปเกรดฐานข้อมูลเดิม: เพิ่มหัวคอลัมน์ใหม่ (เช่น batchId)
      const head = SHEETS[name];
      sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#d9eaf7');
    }
  });
  const def = ss.getSheetByName('Sheet1') || ss.getSheetByName('แผ่น1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);
  cache.put('sheets_ok_v4_' + ss.getId(), '1', 21600);
}

// ───────────────────────── Auth ─────────────────────────
function login_(username, password) {
  username = String(username || '').trim().toLowerCase();
  password = String(password || '');
  if (!username || !password) throw err_('BAD_REQUEST', 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน');

  const cache = CacheService.getScriptCache();
  const failKey = 'fail_' + username;
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= APP.MAX_LOGIN_FAILS) throw err_('LOCKED_OUT', 'ใส่รหัสผิดหลายครั้ง กรุณารอ 15 นาทีแล้วลองใหม่');

  const sh = db_().getSheetByName('Users');
  const row = findRow_(sh, username);
  const rec = row ? sh.getRange(row, 1, 1, SHEETS.Users.length).getValues()[0] : null;
  if (!rec || !isTrue_(rec[4]) || !verifyPassword_(password, String(rec[3]))) {
    cache.put(failKey, String(fails + 1), APP.LOCKOUT_SEC);
    throw err_('BAD_LOGIN', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
  }
  cache.remove(failKey);
  sh.getRange(row, 8).setValue(now_());

  const session = { username: rec[0], displayName: rec[1], role: rec[2], mustChange: isTrue_(rec[5]), iat: Date.now() };
  const token = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  cache.put('sess_' + token, JSON.stringify(session), APP.SESSION_TTL);
  audit_(session.username, 'login', '');
  return { token: token, user: publicUser_(session) };
}

function checkSession_(token) {
  if (!token) throw err_('AUTH', 'กรุณาเข้าสู่ระบบ');
  const cache = CacheService.getScriptCache();
  const raw = cache.get('sess_' + token);
  if (!raw) throw err_('AUTH', 'หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบใหม่');
  const s = JSON.parse(raw);
  const revoked = Number(cache.get('revoked_' + s.username) || 0);
  if (revoked && revoked >= s.iat) {
    cache.remove('sess_' + token);
    throw err_('AUTH', 'สิทธิ์ของบัญชีถูกเปลี่ยน กรุณาเข้าสู่ระบบใหม่');
  }
  cache.put('sess_' + token, raw, APP.SESSION_TTL); // sliding expiration
  if (s.mustChange) s._mustChange = true;
  return s;
}

function logout_(token) {
  CacheService.getScriptCache().remove('sess_' + token);
  return { loggedOut: true };
}

function publicUser_(s) {
  return { username: s.username, displayName: s.displayName, role: s.role, mustChange: !!s.mustChange };
}

function require_(user, perm) {
  if (user.mustChange) throw err_('MUST_CHANGE', 'กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน');
  if (CAN[perm].indexOf(user.role) < 0) throw err_('FORBIDDEN', 'บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้');
}

function changePassword_(user, oldPw, newPw) {
  newPw = String(newPw || '');
  if (newPw.length < APP.MIN_PASSWORD) throw err_('BAD_REQUEST', 'รหัสผ่านใหม่ต้องยาวอย่างน้อย ' + APP.MIN_PASSWORD + ' ตัวอักษร');
  const sh = db_().getSheetByName('Users');
  const row = findRow_(sh, user.username);
  if (!row) throw err_('AUTH', 'ไม่พบบัญชี');
  const stored = String(sh.getRange(row, 4).getValue());
  if (!verifyPassword_(String(oldPw || ''), stored)) throw err_('BAD_LOGIN', 'รหัสผ่านเดิมไม่ถูกต้อง');
  if (verifyPassword_(newPw, stored)) throw err_('BAD_REQUEST', 'รหัสผ่านใหม่ต้องไม่ซ้ำรหัสเดิม');
  sh.getRange(row, 4, 1, 3).setValues([[hashPassword_(newPw), true, false]]);
  // ออกจากระบบทุกอุปกรณ์ แล้วให้ client login ใหม่
  CacheService.getScriptCache().put('revoked_' + user.username, String(Date.now()), APP.SESSION_TTL);
  audit_(user.username, 'changePassword', '');
  return { changed: true };
}

function hashPassword_(pw) {
  const salt = Utilities.getUuid().replace(/-/g, '');
  return 'v1$' + APP.HASH_ROUNDS + '$' + salt + '$' + derive_(pw, salt, APP.HASH_ROUNDS);
}

function verifyPassword_(pw, stored) {
  const p = String(stored || '').split('$');
  if (p.length !== 4 || p[0] !== 'v1') return false;
  const h = derive_(pw, p[2], Number(p[1]));
  // เทียบแบบเวลาคงที่
  if (h.length !== p[3].length) return false;
  let diff = 0;
  for (let i = 0; i < h.length; i++) diff |= h.charCodeAt(i) ^ p[3].charCodeAt(i);
  return diff === 0;
}

function derive_(pw, salt, rounds) {
  const key = Utilities.newBlob(pw).getBytes();
  let h = Utilities.newBlob(salt + ':' + pw).getBytes();
  for (let i = 0; i < rounds; i++) h = Utilities.computeHmacSha256Signature(h, key);
  return Utilities.base64Encode(h);
}

function tempPassword_() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const hex = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  let out = '';
  for (let i = 0; i < 10; i++) out += chars[parseInt(hex.substr(i * 2, 2), 16) % chars.length];
  return out;
}

// ───────────────────────── Bootstrap ─────────────────────────
function bootstrap_(user, req) {
  const out = { user: publicUser_(user), settings: publicSettings_(), today: today_() };
  if (user.mustChange) return out;
  out.aircraft = getAircraft_();
  out.holidays = getHolidays_();
  try { out.crew = getCrew_(false); }
  catch (e) { out.crew = { people: [], error: e.message }; }
  const range = req.from ? { from: req.from, to: req.to || req.from } : (req.date ? { from: req.date, to: req.date } : defaultRange_(user, out.holidays));
  out.range = getRange_(user, range.from, range.to);
  return out;
}

// ───────────────────────── Crew: นักบินฝ่ายยุทธการ (Google Sheet ภายนอก) ─────────────────────────
/** คอลัมน์เบอร์โทรในแท็บ Crew: หาจากหัวคอลัมน์ ถ้าไม่เจอใช้คอลัมน์ F (index 5) — คืน index เริ่ม 0 หรือ -1 */
function crewPhoneCol_(head) {
  const names = ['เบอร์โทร', 'เบอร์โทรศัพท์', 'เบอร์', 'โทร', 'โทร.', 'โทรศัพท์', 'Phone', 'Tel', 'Mobile'];
  for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; }
  return head.length > 5 ? 5 : -1;
}

function getCrew_(refresh) {
  const cache = CacheService.getScriptCache();
  if (!refresh) {
    const hit = cache.get('crew_v2');
    if (hit) return JSON.parse(hit);
  }
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(APP.CREW_PROP);
  if (!id) return { people: [], configured: false, updatedAt: now_() };

  const ss = SpreadsheetApp.openById(id);
  const tab = props.getProperty(APP.CREW_TAB_PROP) || 'Crew';
  const sh = ss.getSheetByName(tab);
  if (!sh) throw err_('CREW', 'ไม่พบแท็บ "' + tab + '" ในชีตรายชื่อลูกเรือ');
  const values = sh.getDataRange().getDisplayValues();
  const head = values[0].map(h => String(h).trim());
  const col = names => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i; } return -1; };
  const cId = col(['ID', 'PilotID', 'PersonID', 'รหัส']);
  const cDept = col(['ฝ่าย']);
  const cCode = col(['DeptCode', 'รหัสฝ่าย']);
  const cRank = col(['ยศ']);
  const cName = col(['ชื่อ-สกุล', 'ชื่อ - สกุล', 'ชื่อสกุล']);
  const cPhone = crewPhoneCol_(head);
  if (cId < 0 || cRank < 0 || cName < 0) throw err_('CREW', 'แท็บรายชื่อต้องมีคอลัมน์ ID, ยศ, ชื่อ-สกุล');

  // ข้อมูลเสริมของนักบิน (ถ้ามี): สถานะใช้งาน + สถานะพระราชพาหนะ + คุณสมบัติรายแบบ
  const extra = {};
  const hours = ss.getSheetByName('PilotHours');
  if (hours) {
    const hv = hours.getDataRange().getDisplayValues();
    const hh = hv[0];
    const iId = hh.indexOf('PilotID'), iRoyal = hh.indexOf('สถานะพระราชพาหนะ'), iAct = hh.indexOf('ใช้งาน (Y/N)');
    hv.slice(1).forEach(r => {
      if (!r[iId]) return;
      extra[r[iId]] = extra[r[iId]] || {};
      if (iRoyal >= 0 && r[iRoyal]) extra[r[iId]].royal = r[iRoyal];
      if (iAct >= 0 && /^n/i.test(r[iAct])) extra[r[iId]].inactive = true;
    });
  }
  const qual = ss.getSheetByName('PilotQual');
  if (qual) {
    const qv = qual.getDataRange().getDisplayValues();
    const qh = qv[0];
    const iId = qh.indexOf('PilotID'), iType = qh.indexOf('แบบอากาศยาน');
    const roleCols = ['ฝป.', 'ฝพ.', 'นบ.2', 'นบ.1', 'นลค.', 'คบ.'].map(n => [n, qh.indexOf(n)]).filter(x => x[1] >= 0);
    qv.slice(1).forEach(r => {
      if (!r[iId] || !r[iType]) return;
      const passed = roleCols.filter(x => String(r[x[1]]).trim() === 'ผ่าน').map(x => x[0]);
      const training = roleCols.filter(x => String(r[x[1]]).trim() === 'กำลังฝึก').map(x => x[0]);
      extra[r[iId]] = extra[r[iId]] || {};
      extra[r[iId]].quals = extra[r[iId]].quals || {};
      extra[r[iId]].quals[r[iType]] = { pass: passed, training: training };
    });
  }

  const people = [];
  values.slice(1).forEach(r => {
    const pid = String(r[cId] || '').trim();
    const full = String(r[cName] || '').trim().replace(/\s+/g, ' ');
    if (!pid || !full) return;
    const rank = String(r[cRank] || '').trim();
    const parts = full.split(' ');
    const first = parts.shift();
    const last = parts.join(' ');
    const deptCode = cCode >= 0 ? String(r[cCode]).trim() : pid.replace(/\d+$/, '');
    if (APP.CREW_DEPTS.length && APP.CREW_DEPTS.indexOf(deptCode) < 0) return;
    const x = extra[pid] || {};
    people.push({
      id: pid,
      rank: rank,
      first: first,
      last: last,
      dept: cDept >= 0 ? String(r[cDept]).trim() : '',
      deptCode: deptCode,
      short: shortName_(rank, first, last),
      phone: cPhone >= 0 ? String(r[cPhone] || '').trim() : '',
      royal: x.royal || '',
      quals: x.quals || null,
      active: !x.inactive,
    });
  });
  const out = { people: people, configured: true, updatedAt: now_() };
  try { cache.put('crew_v2', JSON.stringify(out), APP.CREW_CACHE_TTL); } catch (e) { /* ใหญ่เกิน cache ก็ไม่เป็นไร */ }
  return out;
}

/** "น.ต." + "ธนพัฒน์" + "พรหมวงศ์" → "น.ต.ธนพัฒน์ พ." */
function shortName_(rank, first, last) {
  const initial = String(last || '').replace(/^[เแโใไ]+/, '').charAt(0);
  const r = String(rank || '').trim();
  const sep = !r || /\.$/.test(r) ? '' : ' ';
  return (r + sep + first + (initial ? ' ' + initial + '.' : '')).trim();
}

// ───────────────────────── จัดการรายชื่อนักบิน (เขียนลง CRM602 โดยตรง) ─────────────────────────
// เพิ่ม: เพิ่มแถวในแท็บ Crew (ID ใหม่ OPSxxx) · แก้ไข: ยศ / ชื่อ-สกุล ในแท็บ Crew
// "ลบ" = ปิดใช้งาน: ตั้ง ใช้งาน (Y/N) = N ในแท็บ PilotHours — ไม่ลบแถว เพราะแท็บอื่นอ้างอิง ID อยู่
function crewBook_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(APP.CREW_PROP);
  if (!id) throw err_('CREW', 'ยังไม่ได้เชื่อม Google Sheets รายชื่อ (ตั้งค่าที่แท็บ "ตั้งค่า")');
  const ss = SpreadsheetApp.openById(id);
  const tab = props.getProperty(APP.CREW_TAB_PROP) || 'Crew';
  const sh = ss.getSheetByName(tab);
  if (!sh) throw err_('CREW', 'ไม่พบแท็บ "' + tab + '" ในชีตรายชื่อ');
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim());
  const col = names => { for (const n of names) { const i = head.indexOf(n); if (i >= 0) return i + 1; } return 0; };
  const c = { id: col(['ID', 'PilotID', 'PersonID', 'รหัส']), dept: col(['ฝ่าย']), code: col(['DeptCode', 'รหัสฝ่าย']),
              rank: col(['ยศ']), name: col(['ชื่อ-สกุล', 'ชื่อ - สกุล', 'ชื่อสกุล']), phone: crewPhoneCol_(head) + 1 };
  if (!c.id || !c.rank || !c.name) throw err_('CREW', 'แท็บรายชื่อต้องมีคอลัมน์ ID, ยศ, ชื่อ-สกุล');
  return { ss: ss, sh: sh, c: c, width: Math.max(head.length, c.phone) };
}

function cleanPilotInput_(p) {
  const t = v => String(v == null ? '' : v).trim().replace(/\s+/g, ' ');
  const rank = t(p.rank).slice(0, 30), first = t(p.first).replace(/ /g, '').slice(0, 60), last = t(p.last).slice(0, 80);
  if (!rank) throw err_('BAD_REQUEST', 'กรุณาระบุยศ');
  if (!first) throw err_('BAD_REQUEST', 'กรุณาระบุชื่อ');
  if (!last) throw err_('BAD_REQUEST', 'กรุณาระบุนามสกุล');
  const phone = t(p.phone).slice(0, 40);
  return { rank: rank, first: first, last: last, phone: phone, hasPhone: p.phone !== undefined };
}

function savePilot_(user, p) {
  require_(user, 'managePilots');
  p = p || {};
  const v = cleanPilotInput_(p);
  const code = APP.CREW_DEPTS[0] || 'OPS';
  return withLock_(() => {
    const b = crewBook_();
    const n = b.sh.getLastRow() - 1;
    const ids = n > 0 ? b.sh.getRange(2, b.c.id, n, 1).getDisplayValues().map(r => String(r[0]).trim()) : [];
    const names = n > 0 ? b.sh.getRange(2, b.c.name, n, 1).getDisplayValues().map(r => String(r[0]).trim().replace(/\s+/g, ' ')) : [];
    const full = v.first + ' ' + v.last;
    const id = String(p.id || '').trim();
    const dupAt = names.indexOf(full);
    if (dupAt >= 0 && ids[dupAt] !== id) throw err_('BAD_REQUEST', 'มีนักบินชื่อ ' + full + ' อยู่แล้ว (' + ids[dupAt] + ')');
    if (!id) {
      const re = new RegExp('^' + code + '(\\d+)$');
      const max = ids.reduce((m, x) => { const mm = x.match(re); return mm ? Math.max(m, Number(mm[1])) : m; }, 0);
      const newId = code + String(max + 1).padStart(3, '0');
      const row = new Array(b.width).fill('');
      row[b.c.id - 1] = newId; row[b.c.rank - 1] = v.rank; row[b.c.name - 1] = full;
      if (b.c.dept) row[b.c.dept - 1] = 'ฝ่ายยุทธการ';
      if (b.c.code) row[b.c.code - 1] = code;
      if (b.c.phone) row[b.c.phone - 1] = v.phone;
      const r = ids.indexOf('');
      const at = r >= 0 ? r + 2 : b.sh.getLastRow() + 1;      // ใช้แถวว่างที่มีอยู่ก่อน
      b.sh.getRange(at, 1, 1, b.width).setValues([row]);
      afterPilotChange_(user, 'createPilot', newId + ' ' + v.rank + full);
      return { id: newId, created: true, crew: getCrew_(true) };
    }
    const at = ids.indexOf(id);
    if (at < 0) throw err_('NOT_FOUND', 'ไม่พบนักบินรหัส ' + id);
    if (b.c.code) {
      const dc = String(b.sh.getRange(at + 2, b.c.code).getDisplayValue()).trim();
      if (APP.CREW_DEPTS.length && APP.CREW_DEPTS.indexOf(dc) < 0) throw err_('FORBIDDEN', 'แก้ไขได้เฉพาะนักบินฝ่ายยุทธการ');
    }
    b.sh.getRange(at + 2, b.c.rank).setValue(v.rank);
    b.sh.getRange(at + 2, b.c.name).setValue(full);
    if (b.c.phone && v.hasPhone) b.sh.getRange(at + 2, b.c.phone).setValue(v.phone);
    afterPilotChange_(user, 'updatePilot', id + ' → ' + v.rank + full);
    return { id: id, updated: true, crew: getCrew_(true) };
  });
}

function setPilotActive_(user, id, active) {
  require_(user, 'managePilots');
  id = String(id || '').trim();
  if (!id) throw err_('BAD_REQUEST', 'ไม่ระบุรหัสนักบิน');
  return withLock_(() => {
    const b = crewBook_();
    const n = b.sh.getLastRow() - 1;
    const ids = n > 0 ? b.sh.getRange(2, b.c.id, n, 1).getDisplayValues().map(r => String(r[0]).trim()) : [];
    if (ids.indexOf(id) < 0) throw err_('NOT_FOUND', 'ไม่พบนักบินรหัส ' + id);
    const hs = b.ss.getSheetByName('PilotHours');
    if (!hs) throw err_('CREW', 'ไม่พบแท็บ PilotHours ในชีตรายชื่อ (ใช้เก็บสถานะ ใช้งาน Y/N)');
    const head = hs.getRange(1, 1, 1, hs.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim());
    const cId = head.indexOf('PilotID') + 1, cAct = head.indexOf('ใช้งาน (Y/N)') + 1;
    if (!cId || !cAct) throw err_('CREW', 'แท็บ PilotHours ต้องมีคอลัมน์ PilotID และ ใช้งาน (Y/N)');
    const hn = Math.max(hs.getLastRow() - 1, 0);
    const hid = hn > 0 ? hs.getRange(2, cId, hn, 1).getDisplayValues().map(r => String(r[0]).trim()) : [];
    let at = hid.indexOf(id);
    if (at < 0) {
      // ยังไม่มีแถวของนักบินคนนี้ → ใช้แถวว่างแรก (คงสูตรชื่ออัตโนมัติที่มีอยู่) หรือเพิ่มแถวใหม่
      at = hid.indexOf('');
      if (at < 0) at = hn;
      hs.getRange(at + 2, cId).setValue(id);
    }
    hs.getRange(at + 2, cAct).setValue(active ? 'Y' : 'N');
    afterPilotChange_(user, active ? 'activatePilot' : 'deactivatePilot', id);
    return { id: id, active: !!active, crew: getCrew_(true) };
  });
}

function afterPilotChange_(user, action, detail) {
  CacheService.getScriptCache().remove('crew_v2');
  audit_(user.username, action, detail);
}

// ───────────────────────── Flight orders ─────────────────────────
function getOrder_(user, date) {
  date = checkDate_(date);
  const sh = db_().getSheetByName('FlightOrders');
  const row = findRow_(sh, date);
  if (!row) return { date: date, exists: false };
  const r = sh.getRange(row, 1, 1, SHEETS.FlightOrders.length).getValues()[0];
  const meta = metaFromRow_(r);
  if (meta.status !== STATUS.RELEASED && !canSeeUnreleased_(user)) {
    return { date: date, exists: true, hidden: true, status: meta.status };
  }
  // viewer ไม่เห็นประวัติการดำเนินการ (ชื่อผู้แก้ เหตุผลไม่อนุมัติ ข้อความถึงผู้บังคับบัญชา)
  return Object.assign(meta, { exists: true, order: unpack_(r[12]), log: user.role === 'viewer' ? [] : safeJson_(r[13], []) });
}

/** ใบจัดบินหลายวัน (สูงสุด 31 วัน) — ใช้กับชุดวันหยุด */
function getRange_(user, from, to) {
  const dates = dateRange_(from, to);
  return { from: dates[0], to: dates[dates.length - 1], days: dates.map(d => getOrder_(user, d)) };
}

function listOrders_(user, from, to) {
  from = from ? checkDate_(from) : '0000-00-00';
  to = to ? checkDate_(to) : '9999-12-31';
  const sh = db_().getSheetByName('FlightOrders');
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  const rows = sh.getRange(2, 1, n, 12).getValues();   // ไม่อ่านคอลัมน์ json เพื่อความเร็ว
  const batch = sh.getRange(2, 15, n, 1).getValues();
  return rows.map((r, i) => Object.assign(metaFromRow_(r), { batchId: String(batch[i][0] || '') }))
    .filter(m => m.date >= from && m.date <= to)
    .filter(m => m.status === STATUS.RELEASED || canSeeUnreleased_(user))
    .sort((a, b) => b.date.localeCompare(a.date));
}

function saveOrder_(user, date, order, baseVersion) {
  require_(user, 'editOrder');
  date = checkDate_(date);
  const clean = sanitizeOrder_(order, date);
  return withLock_(() => {
    const sh = db_().getSheetByName('FlightOrders');
    saveOne_(user, sh, date, clean, baseVersion, null);
    return getOrder_(user, date);
  });
}

/**
 * บันทึกหลายวันพร้อมกัน (ทั้งหมดหรือไม่บันทึกเลย)
 * days: [{date, order, baseVersion}] — เฉพาะวันที่แก้ไข/วันใหม่
 * batchDates: ทุกวันในชุด — ใช้กำหนด batchId ให้ทุกวันในชุด (ถ้ามีมากกว่า 1 วัน)
 */
function saveBatch_(user, days, batchDates) {
  require_(user, 'editOrder');
  if (!Array.isArray(days)) throw err_('BAD_REQUEST', 'ข้อมูลไม่ถูกต้อง');
  const all = Array.isArray(batchDates) && batchDates.length ? batchDates.map(checkDate_).sort() : days.map(d => checkDate_(d.date)).sort();
  if (all.length > 31) throw err_('BAD_REQUEST', 'บันทึกได้ครั้งละไม่เกิน 31 วัน');
  const batchId = all.length > 1 ? all[0] + '..' + all[all.length - 1] : null;
  const items = days.map(d => ({ date: checkDate_(d.date), clean: sanitizeOrder_(d.order, checkDate_(d.date)), base: d.baseVersion }));
  return withLock_(() => {
    const sh = db_().getSheetByName('FlightOrders');
    items.forEach(it => precheckSave_(sh, it.date, it.base));      // ตรวจทุกวันก่อน ไม่ให้บันทึกครึ่งๆ กลางๆ
    items.forEach(it => saveOne_(user, sh, it.date, it.clean, it.base, batchId));
    if (batchId) {
      all.forEach(d => { const row = findRow_(sh, d); if (row) sh.getRange(row, 15).setValue(batchId); });
    }
    return { batchId: batchId || '', days: all.map(d => getOrder_(user, d)) };
  });
}

function precheckSave_(sh, date, baseVersion) {
  const row = findRow_(sh, date);
  if (!row) {
    if (baseVersion) throw err_('CONFLICT', 'ใบจัดบินวันที่ ' + date + ' ถูกลบไปแล้ว', { reload: true });
    return null;
  }
  const meta = metaFromRow_(sh.getRange(row, 1, 1, 12).getValues()[0]);
  if (meta.status === STATUS.RELEASED) throw err_('LOCKED', 'ใบจัดบินวันที่ ' + date + ' release แล้ว ต้องกด "เปิดแก้ไข" ก่อน');
  if (Number(baseVersion) !== meta.version) {
    throw err_('CONFLICT', 'มีผู้อื่น (' + meta.updatedBy + ') บันทึกใบวันที่ ' + date + ' เมื่อ ' + meta.updatedAt + ' หลังจากที่คุณเปิด', { reload: true });
  }
  return row;
}

function saveOne_(user, sh, date, clean, baseVersion, batchId) {
  const packed = pack_(clean);
  const row = precheckSave_(sh, date, baseVersion);
  const ts = now_();
  if (!row) {
    const log = [logEntry_(user, 'create', '')];
    sh.appendRow([date, STATUS.DRAFT, 1, 1, user.displayName, ts, '', '', '', '', '', clean.missions.length, packed, JSON.stringify(log), batchId || '']);
    step_('order row created ' + date);
    markFlatDirty_(date);
    audit_(user.username, 'saveOrder', date + ' (new)');
    return;
  }
  const r = sh.getRange(row, 1, 1, SHEETS.FlightOrders.length).getValues()[0];
  const meta = metaFromRow_(r);
  if (String(r[12]) === packed) return;          // ไม่มีการเปลี่ยนแปลง

  const log = safeJson_(r[13], []);
  let status = meta.status, approvedBy = r[6], approvedAt = r[7], denyReason = r[8];
  if (meta.status !== STATUS.DRAFT) {
    // แก้ไขใบที่ส่งขออนุมัติ/พิจารณาแล้ว → กลับเป็นร่าง ต้องส่งขออนุมัติใหม่
    log.push(logEntry_(user, 'edit', 'แก้ไขหลัง' + (meta.status === STATUS.PENDING ? 'ส่งขออนุมัติ' : 'พิจารณา') + ' → กลับเป็นร่าง'));
    status = STATUS.DRAFT;
    if (meta.status !== STATUS.DENIED) { approvedBy = ''; approvedAt = ''; }
  } else {
    log.push(logEntry_(user, 'edit', ''));
  }
  sh.getRange(row, 2, 1, 13).setValues([[status, meta.revision, meta.version + 1, user.displayName, ts,
    approvedBy, approvedAt, denyReason, '', '', clean.missions.length, packed, JSON.stringify(trimLog_(log))]]);
  step_('order row written ' + date);
  markFlatDirty_(date);
  audit_(user.username, 'saveOrder', date + ' v' + (meta.version + 1));
}

// ── การเปลี่ยนสถานะ: ใช้ร่วมกันระหว่างรายวันและทั้งชุด ──
const FLOW = {
  submit:  { allowed: [STATUS.DRAFT, STATUS.DENIED], skip: [STATUS.PENDING, STATUS.APPROVED] },
  approve: { allowed: [STATUS.PENDING, STATUS.DENIED], skip: [STATUS.APPROVED] },
  deny:    { allowed: [STATUS.PENDING, STATUS.APPROVED, STATUS.DENIED], skip: [] },
  release: { allowed: [STATUS.APPROVED], skip: [STATUS.RELEASED] },
};
function fnSubmit_(user, note) {
  return (meta, set, log) => {
    set.status = STATUS.PENDING;
    log.push(logEntry_(user, 'submit', String(note || '').slice(0, 500)));
  };
}
function fnApprove_(user, note) {
  return (meta, set, log) => {
    set.status = STATUS.APPROVED; set.approvedBy = user.displayName; set.approvedAt = now_(); set.denyReason = '';
    log.push(logEntry_(user, 'approve', String(note || '').slice(0, 500)));
  };
}
function fnDeny_(user, reason) {
  reason = String(reason || '').trim().slice(0, 1000);
  if (!reason) throw err_('BAD_REQUEST', 'กรุณาระบุเหตุผลที่ไม่อนุมัติ');
  return (meta, set, log) => {
    set.status = STATUS.DENIED; set.approvedBy = user.displayName; set.approvedAt = now_(); set.denyReason = reason;
    log.push(logEntry_(user, 'deny', reason));
  };
}
function fnRelease_(user) {
  let snapshot = null;
  return (meta, set, log, order) => {
    if (!snapshot) snapshot = getAircraft_().list;   // บันทึกสถานภาพเครื่องบิน ณ เวลา release
    set.status = STATUS.RELEASED; set.releasedBy = user.displayName; set.releasedAt = now_();
    order.aircraftSnapshot = snapshot;
    set.json = pack_(order);
    log.push(logEntry_(user, 'release', ''));
  };
}

function approveOrder_(user, date, version, note) {
  require_(user, 'approve');
  return transition_(user, date, version, [STATUS.PENDING, STATUS.DENIED], fnApprove_(user, note));
}
function denyOrder_(user, date, version, reason) {
  require_(user, 'approve');
  return transition_(user, date, version, [STATUS.PENDING, STATUS.APPROVED], fnDeny_(user, reason));
}
function releaseOrder_(user, date, version) {
  require_(user, 'release');
  return transition_(user, date, version, [STATUS.APPROVED], fnRelease_(user));
}

/** อนุมัติ / ไม่อนุมัติ / release ทั้งชุดในครั้งเดียว — items: [{date, version}] */
// หลังเปลี่ยนสถานะสำเร็จ (ปล่อย lock แล้ว) → แจ้งเตือนทาง LINE
function notifyAfter_(res, type, status, extra) {
  const dates = res.days.filter(d => d.status === status).map(d => d.date);
  if (dates.length) { enqueueLine_(type, Object.assign({ dates: dates }, extra)); processLineQueueSafe_(); }
  return res;
}
function submitBatch_(user, items, note) {
  require_(user, 'editOrder');
  return notifyAfter_(batchTransition_(user, items, FLOW.submit, fnSubmit_(user, note)), 'submit', STATUS.PENDING, { by: user.displayName, note: String(note || '').slice(0, 300) });
}
function approveBatch_(user, items, note) {
  require_(user, 'approve');
  const res = batchTransition_(user, items, FLOW.approve, fnApprove_(user, note));
  return notifyAfter_(res, 'approve', STATUS.APPROVED, { by: user.displayName, to: submitters_(res.days.map(d => d.date)) });
}
function denyBatch_(user, items, reason) {
  require_(user, 'approve');
  const res = batchTransition_(user, items, FLOW.deny, fnDeny_(user, reason));
  return notifyAfter_(res, 'deny', STATUS.DENIED, { by: user.displayName, reason: String(reason || '').slice(0, 500), to: submitters_(res.days.map(d => d.date)) });
}
function releaseBatch_(user, items) {
  require_(user, 'release');
  return notifyAfter_(batchTransition_(user, items, FLOW.release, fnRelease_(user)), 'release', STATUS.RELEASED, {});
}

function reviseOrder_(user, date, reason) {
  require_(user, 'release');
  reason = String(reason || '').trim().slice(0, 1000);
  if (!reason) throw err_('BAD_REQUEST', 'กรุณาระบุเหตุผลที่ต้องแก้ไขใบที่ release แล้ว');
  return transition_(user, date, null, [STATUS.RELEASED], (meta, set, log, order) => {
    set.status = STATUS.DRAFT;
    set.revision = meta.revision + 1;
    set.approvedBy = ''; set.approvedAt = ''; set.releasedBy = ''; set.releasedAt = '';
    delete order.aircraftSnapshot;
    set.json = pack_(order);
    log.push(logEntry_(user, 'revise', 'Rev.' + (meta.revision + 1) + ': ' + reason));
  });
}

function deleteOrder_(user, date) {
  require_(user, 'deleteOrder');
  date = checkDate_(date);
  return withLock_(() => {
    const sh = db_().getSheetByName('FlightOrders');
    const row = findRow_(sh, date);
    if (!row) return { deleted: false };
    sh.deleteRow(row);
    markFlatDirty_(date);
    audit_(user.username, 'deleteOrder', date);
    return { deleted: true };
  });
}

/** เปลี่ยนสถานะใบจัดบินแบบตรวจ version เพื่อให้แน่ใจว่าผู้พิจารณาเห็นเวอร์ชันเดียวกับที่บันทึก */
function transition_(user, date, version, allowed, fn) {
  date = checkDate_(date);
  return withLock_(() => {
    const sh = db_().getSheetByName('FlightOrders');
    const p = loadForTransition_(sh, date, version);
    if (allowed.indexOf(p.meta.status) < 0) throw err_('BAD_STATE', 'ทำรายการนี้ไม่ได้ในสถานะ ' + p.meta.status);
    applyTransition_(user, sh, p, fn);
    return getOrder_(user, date);
  });
}

function batchTransition_(user, items, flow, fn) {
  if (!Array.isArray(items) || !items.length) throw err_('BAD_REQUEST', 'ไม่มีวันที่ต้องดำเนินการ');
  if (items.length > 31) throw err_('BAD_REQUEST', 'ดำเนินการได้ครั้งละไม่เกิน 31 วัน');
  const list = items.map(it => ({ date: checkDate_(it.date), version: it.version }));
  return withLock_(() => {
    const sh = db_().getSheetByName('FlightOrders');
    // ตรวจทุกวันก่อน — ถ้าวันใดไม่ผ่าน จะไม่เปลี่ยนแปลงวันใดเลย
    const plan = list.map(it => loadForTransition_(sh, it.date, it.version)).filter(p => {
      if (flow.skip.indexOf(p.meta.status) >= 0) return false;
      if (flow.allowed.indexOf(p.meta.status) < 0) {
        throw err_('BAD_STATE', 'วันที่ ' + p.meta.date + ' อยู่ในสถานะ ' + p.meta.status + ' จึงทำรายการทั้งชุดไม่ได้');
      }
      return true;
    });
    if (!plan.length) throw err_('BAD_STATE', 'ไม่มีวันใดในชุดที่ต้องดำเนินการ');
    plan.forEach(p => applyTransition_(user, sh, p, fn));
    return { days: list.map(it => getOrder_(user, it.date)) };
  });
}

function loadForTransition_(sh, date, version) {
  const row = findRow_(sh, date);
  if (!row) throw err_('NOT_FOUND', 'ไม่พบใบจัดบินวันที่ ' + date, { reload: true });
  const r = sh.getRange(row, 1, 1, SHEETS.FlightOrders.length).getValues()[0];
  const meta = metaFromRow_(r);
  if (version != null && Number(version) !== meta.version) {
    throw err_('CONFLICT', 'ใบจัดบินวันที่ ' + date + ' ถูกแก้ไขโดย ' + meta.updatedBy + ' กรุณาโหลดใหม่และตรวจอีกครั้ง', { reload: true });
  }
  return { row: row, r: r, meta: meta };
}

function applyTransition_(user, sh, p, fn) {
  const r = p.r, meta = p.meta;
  const order = unpack_(r[12]);
  const log = safeJson_(r[13], []);
  const set = {
    status: meta.status, revision: meta.revision, approvedBy: r[6], approvedAt: r[7], denyReason: r[8],
    releasedBy: r[9], releasedAt: r[10], json: r[12],
  };
  fn(meta, set, log, order);
  step_('transition ' + meta.date + ' ' + meta.status + '→' + set.status);
  sh.getRange(p.row, 2, 1, 13).setValues([[set.status, set.revision, meta.version + 1, meta.updatedBy, meta.updatedAt,
    set.approvedBy, set.approvedAt, set.denyReason, set.releasedBy, set.releasedAt, r[11], set.json, JSON.stringify(trimLog_(log))]]);
  if (set.status !== meta.status || set.revision !== meta.revision) markFlatDirty_(meta.date);
  audit_(user.username, 'status', meta.date + ' ' + meta.status + '→' + set.status);
}

// ───────────────────────── Holidays & ชุดวันหยุด ─────────────────────────
function getHolidays_() {
  const sh = db_().getSheetByName('Holidays');
  const n = sh.getLastRow() - 1;
  if (n < 1) return [];
  return sh.getRange(2, 1, n, 2).getValues().filter(r => r[0] !== '')
    .map(r => ({ date: keyStr_(r[0]), name: String(r[1] || '') })).sort((a, b) => a.date.localeCompare(b.date));
}

/** แทนที่วันหยุดทั้งปีที่ระบุ */
function saveHolidays_(user, year, list) {
  require_(user, 'settings');
  year = String(year || '');
  if (!/^\d{4}$/.test(year)) throw err_('BAD_REQUEST', 'ปีไม่ถูกต้อง');
  if (!Array.isArray(list)) throw err_('BAD_REQUEST', 'ข้อมูลไม่ถูกต้อง');
  const seen = {};
  const rows = list.slice(0, 100).map(h => {
    const d = checkDate_(h.date);
    if (d.slice(0, 4) !== year) throw err_('BAD_REQUEST', 'วันที่ ' + d + ' ไม่อยู่ในปี ' + year);
    if (seen[d]) throw err_('BAD_REQUEST', 'วันที่ ' + d + ' ซ้ำ');
    seen[d] = 1;
    return [d, String(h.name || '').trim().slice(0, 120) || 'วันหยุด'];
  });
  return withLock_(() => {
    const sh = db_().getSheetByName('Holidays');
    const keep = getHolidays_().filter(h => h.date.slice(0, 4) !== year).map(h => [h.date, h.name]);
    const all = keep.concat(rows).sort((a, b) => a[0].localeCompare(b[0]));
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 2).clearContent();
    if (all.length) { sh.getRange(2, 1, all.length, 1).setNumberFormat('@'); sh.getRange(2, 1, all.length, 2).setValues(all); }
    audit_(user.username, 'saveHolidays', year + ' (' + rows.length + ' วัน)');
    return getHolidays_();
  });
}

function isWorkingDay_(date, holidaySet) {
  const dow = new Date(date + 'T00:00:00Z').getUTCDay();
  return dow !== 0 && dow !== 6 && !holidaySet[date];
}

/** ชุดถัดไป: ตั้งแต่พรุ่งนี้ไปจนถึงวันทำการถัดไป เช่น ศุกร์ → ส. อา. จ. */
function nextBatch_(today, holidays) {
  const set = {};
  (holidays || []).forEach(h => set[h.date] = 1);
  let d = addDays_(today, 1);
  const out = [d];
  while (!isWorkingDay_(d, set) && out.length < 14) { d = addDays_(d, 1); out.push(d); }
  return { from: out[0], to: out[out.length - 1] };
}

/** ช่วงวันที่เปิดเป็นค่าเริ่มต้นตามสิทธิ์ */
function defaultRange_(user, holidays) {
  const today = today_();
  if (CAN.editOrder.indexOf(user.role) >= 0 || user.role === 'documents') return nextBatch_(today, holidays);
  if (user.role === 'commander') {
    const pending = listOrders_(user, today, null).filter(m => m.status === STATUS.PENDING).sort((a, b) => a.date.localeCompare(b.date));
    if (pending.length) {
      const first = pending[0];
      if (first.batchId) { const p = first.batchId.split('..'); return { from: p[0], to: p[1] }; }
      return { from: first.date, to: first.date };
    }
  }
  return { from: today, to: today };
}

function dateRange_(from, to) {
  from = checkDate_(from); to = checkDate_(to || from);
  if (to < from) throw err_('BAD_REQUEST', 'ช่วงวันที่ไม่ถูกต้อง');
  const out = [];
  for (let d = from; d <= to; d = addDays_(d, 1)) {
    out.push(d);
    if (out.length > 31) throw err_('BAD_REQUEST', 'เลือกช่วงได้ไม่เกิน 31 วัน');
  }
  return out;
}
function addDays_(date, n) {
  const t = new Date(date + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
function today_() { return Utilities.formatDate(new Date(), APP.TZ, 'yyyy-MM-dd'); }

function metaFromRow_(r) {
  return {
    date: keyStr_(r[0]), status: String(r[1] || STATUS.PENDING), revision: Number(r[2]) || 1, version: Number(r[3]) || 1,
    updatedBy: String(r[4] || ''), updatedAt: tsStr_(r[5]), approvedBy: String(r[6] || ''), approvedAt: tsStr_(r[7]),
    denyReason: String(r[8] || ''), releasedBy: String(r[9] || ''), releasedAt: tsStr_(r[10]), missionCount: Number(r[11]) || 0, batchId: String(r[14] || ''),
  };
}

/** ประเภท นบ.STBY: จำนวนคนต่อประเภท (ต้องตรงกับฝั่งหน้าเว็บ) */
const STBY_TYPES = {
  royal320: { label: 'STBY A319/ACJ320 นบ.ราชฯ', type: 'A319/ACJ320', slots: 3 },
  a320:     { label: 'STBY A319/ACJ320', type: 'A319/ACJ320', slots: 2 },
  a340:     { label: 'STBY A340', type: 'A340', slots: 2 },
  ssj:      { label: 'STBY SSJ100', type: 'SSJ100', slots: 2 },
};

function sanitizeOrder_(o, date) {
  o = o || {};
  const s = (v, max) => String(v == null ? '' : v).slice(0, max || 300);
  const person = p => p ? { id: s(p.id, 40), name: s(p.name, 120), phone: s(p.phone, 60) } : { id: '', name: '', phone: '' };
  const list = (v, max) => (Array.isArray(v) ? v : (v && (v.name || v.id) ? [v] : [])).slice(0, max).map(person);
  const vip = v => ({ on: !!(v && v.on), name: s(v && v.name, 120), position: s(v && v.position, 200), phone: s(v && v.phone, 60) });
  const duty = o.duty || {};
  const cleanDuty = {
    wingDuty: person(duty.wingDuty),
    wingDutyAsst: person(duty.wingDutyAsst),
    controller: person(duty.controller),
    schedulers: list(duty.schedulers || duty.scheduler, 2),       // น.จัดบิน สูงสุด 2 คน
    documents: list(duty.documents, 3),                         // น.เอกสาร สูงสุด 3 คน
    contact: person(duty.contact),
    preparedDate: /^\d{4}-\d{2}-\d{2}$/.test(String(duty.preparedDate || '')) ? String(duty.preparedDate) : '',   // วันที่จัดทำใบ
  };
  // น.ควบคุมการถ่าย ชพ. = หนึ่งใน น.เอกสาร (บางวันไม่มี)
  let ri = Number(duty.refuelIdx);
  if (!(ri >= 0 && ri < cleanDuty.documents.length && cleanDuty.documents[ri].name)) ri = -1;
  cleanDuty.refuelIdx = ri;
  cleanDuty.refuel = ri >= 0 ? cleanDuty.documents[ri] : person(null);

  const sb = o.standby || {};
  const standby = {};
  Object.keys(STBY_TYPES).forEach(k => {
    const x = sb[k] || {};
    standby[k] = { on: !!x.on, pilots: (Array.isArray(x.pilots) ? x.pilots : []).slice(0, STBY_TYPES[k].slots).map(person) };
  });

  const missions = (Array.isArray(o.missions) ? o.missions : []).slice(0, 40).map((m, i) => ({
    id: s(m.id, 40) || ('m' + (i + 1)),
    aircraftTail: s(m.aircraftTail, 30), aircraftLabel: s(m.aircraftLabel, 120), aircraftType: s(m.aircraftType, 60),
    acRole: ['primary', 'spare'].indexOf(m.acRole) >= 0 ? m.acRole : '',       // บ.จริง / บ.สำรอง
    pairTail: s(m.pairTail, 30), pairLabel: s(m.pairLabel, 120),        // ชื่อเครื่องคู่ (ข้อความ — อาจเป็น บ.ของฝูงบินอื่น)
    type: s(m.type, 60), title: s(m.title, 1000), callsign: s(m.callsign, 40), route: s(m.route, 500),
    fuel: s(m.fuel, 20).replace(/[^\d.]/g, ''),                                // ตัวเลขอย่างเดียว หน่วย TONS
    times: {
      brief: s(m.times && m.times.brief, 10), tow: s(m.times && m.times.tow, 10), takeoff: s(m.times && m.times.takeoff, 100),   // วิ่งขึ้น: ข้อความได้ เช่น เมื่อได้รับการประสาน
      towMode: m.times && m.times.towMode === 'taxi' ? 'taxi' : 'tow',
    },
    pax: s(m.pax, 60),
    parking: { out: s(m.parking && m.parking.out, 200), ret: s(m.parking && m.parking.ret, 200) },
    director: vip(m.director),          // ผอ.เดินทาง
    acCommander: vip(m.acCommander),    // ผู้บังคับ บ.
    hospitality: { on: !!(m.hospitality && m.hospitality.on), detail: s(m.hospitality && m.hospitality.detail, 1000) },   // จัดรับรอง
    crew: (Array.isArray(m.crew) ? m.crew : []).slice(0, 40).map(c => ({
      id: s(c.id, 40), name: s(c.name, 120), dept: s(c.dept, 20), role: s(c.role, 60),
    })),
    poc: s(m.poc, 300), dress: s(m.dress, 300), notes: s(m.notes, 3000),
  }));
  return {
    schema: 2,
    date: date,
    title: s(o.title, 200) || PropertiesService.getScriptProperties().getProperty(APP.TITLE_PROP) || APP.DEFAULT_TITLE,
    duty: cleanDuty,
    standby: standby,
    noMission: !!o.noMission && missions.length === 0,
    missions: missions,
    remarks: s(o.remarks, 3000),
  };
}

// ───────────────────────── อัปเดตแท็บสถิติเบื้องหลัง ─────────────────────────
// การบันทึก/อนุมัติจะแค่จดวันที่ไว้ในคิว แล้วตัวตั้งเวลา (ทุก 5 นาที) จะสร้าง MissionLog / CrewLog ให้
// ทำให้ผู้ใช้ไม่ต้องรอการเขียนแท็บสถิติ · แท็บสถิติในแอปจะประมวลผลคิวให้ก่อนแสดงเสมอ
const FLAT_QUEUE_PROP = 'FLAT_QUEUE';
function markFlatDirty_(date) {
  const p = PropertiesService.getScriptProperties();
  const q = safeJson_(p.getProperty(FLAT_QUEUE_PROP), []);
  if (q.indexOf(date) < 0) { q.push(date); p.setProperty(FLAT_QUEUE_PROP, JSON.stringify(q.slice(-400))); }
}

/** ต้องเรียกภายใน withLock_ */
function processFlatQueue_() {
  const p = PropertiesService.getScriptProperties();
  const q = safeJson_(p.getProperty(FLAT_QUEUE_PROP), []);
  if (!q.length) return 0;
  const sh = db_().getSheetByName('FlightOrders');
  q.forEach(date => {
    const row = findRow_(sh, date);
    if (!row) { rebuildFlat_(date, null); return; }
    const r = sh.getRange(row, 1, 1, SHEETS.FlightOrders.length).getValues()[0];
    const meta = metaFromRow_(r);
    rebuildFlat_(date, unpack_(r[12]), meta.status, meta.revision);
  });
  p.deleteProperty(FLAT_QUEUE_PROP);
  step_('flat queue processed: ' + q.join(','));
  return q.length;
}

/** ตัวตั้งเวลาเรียกฟังก์ชันนี้ทุก 5 นาที */
function processFlatQueue() {
  REQ_T0 = Date.now(); REQ_TAG = '[processFlatQueue]';
  try { withLock_(() => processFlatQueue_()); }
  catch (e) { console.log(REQ_TAG + ' skipped: ' + e.message); }   // ระบบกำลังบันทึก → รอบหน้าค่อยทำ
  processLineQueueSafe_();                                          // ส่ง LINE ที่ค้าง/ล้มเหลวซ้ำ
}

/** รันครั้งเดียวจาก editor (หรือผ่าน setup) เพื่อติดตั้งตัวตั้งเวลา */
function installTriggers() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'processFlatQueue').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('processFlatQueue').timeBased().everyMinutes(5).create();
  console.log('ติดตั้งตัวตั้งเวลา processFlatQueue (ทุก 5 นาที) แล้ว');
}

/** แตกข้อมูลเป็นแถวในแท็บ MissionLog / CrewLog เพื่อทำ Pivot table สถิติได้ทันที */
function rebuildFlat_(date, order, status, revision) {
  const ss = db_();
  ['MissionLog', 'CrewLog'].forEach(name => {
    const sh = ss.getSheetByName(name);
    const found = sh.getRange('A:A').createTextFinder(date).matchEntireCell(true).findAll().map(r => r.getRow()).filter(r => r > 1);
    // ลบเป็นช่วงแถวติดกัน (ปกติแถวของวันเดียวกันอยู่ติดกัน → ลบครั้งเดียว) แทนการลบทีละแถว
    found.sort((a, b) => a - b);
    const runs = [];
    found.forEach(r => { const last = runs[runs.length - 1]; if (last && r === last[0] + last[1]) last[1]++; else runs.push([r, 1]); });
    runs.reverse().forEach(([start, count]) => sh.deleteRows(start, count));
    step_(name + ' cleared ' + found.length + ' rows for ' + date);
  });
  if (!order) return;
  const mRows = [], cRows = [];
  (order.missions || []).forEach((m, i) => {
    mRows.push([date, status, revision, i + 1, m.aircraftTail, m.aircraftType, m.type, m.title, m.callsign, m.route,
      m.times.brief, m.times.tow, m.times.takeoff, m.pax, m.crew.length, m.acRole || '', m.fuel || '']);
    m.crew.forEach(c => cRows.push([date, status, i + 1, m.aircraftTail, m.aircraftType, m.type, c.id, c.name, c.dept, c.role]));
  });
  // นบ.STBY: missionNo = 'STBY', missionType = 'STBY'
  const sb = order.standby || {};
  Object.keys(STBY_TYPES).forEach(k => {
    if (!sb[k] || !sb[k].on) return;
    sb[k].pilots.filter(p => p.name).forEach(p => cRows.push([date, status, 'STBY', '', STBY_TYPES[k].type, 'STBY', p.id, p.name, 'OPS', STBY_TYPES[k].label]));
  });
  appendRows_(ss.getSheetByName('MissionLog'), mRows);
  appendRows_(ss.getSheetByName('CrewLog'), cRows);
  step_('flat logs appended ' + mRows.length + '/' + cRows.length + ' rows');
}

// ───────────────────────── Aircraft status ─────────────────────────
function getAircraft_() {
  const sh = db_().getSheetByName('Aircraft');
  const n = sh.getLastRow() - 1;
  const list = n < 1 ? [] : sh.getRange(2, 1, n, SHEETS.Aircraft.length).getValues()
    .filter(r => r[0] !== '')
    .map(r => ({ tail: keyStr_(r[0]), type: String(r[1]), designation: String(r[2]), status: String(r[3]),
                 detail: String(r[4]), planCheck: String(r[5]), sort: Number(r[6]) || 0,
                 updatedBy: String(r[7] || ''), updatedAt: tsStr_(r[8]) }))
    .sort((a, b) => a.sort - b.sort);
  const version = Number(PropertiesService.getScriptProperties().getProperty(APP.AIRCRAFT_VER_PROP) || 0);
  return { list: list, version: version };
}

function saveAircraft_(user, list, baseVersion) {
  require_(user, 'editAircraft');
  if (!Array.isArray(list)) throw err_('BAD_REQUEST', 'ข้อมูลเครื่องบินไม่ถูกต้อง');
  return withLock_(() => {
    const props = PropertiesService.getScriptProperties();
    const cur = Number(props.getProperty(APP.AIRCRAFT_VER_PROP) || 0);
    if (Number(baseVersion) !== cur) throw err_('CONFLICT', 'สถานภาพเครื่องบินถูกแก้ไขโดยผู้อื่น กรุณาโหลดใหม่', { reload: true });
    const old = getAircraft_().list;
    const oldMap = {};
    old.forEach(a => oldMap[a.tail] = a);
    const s = (v, m) => String(v == null ? '' : v).slice(0, m);
    const ts = now_();
    const seen = {};
    const rows = list.slice(0, 60).map((a, i) => {
      const tail = s(a.tail, 30).trim();
      if (!tail) throw err_('BAD_REQUEST', 'แถวที่ ' + (i + 1) + ': กรุณาระบุหมายเลขเครื่อง');
      if (seen[tail]) throw err_('BAD_REQUEST', 'หมายเลขเครื่อง ' + tail + ' ซ้ำ');
      seen[tail] = 1;
      const rec = [tail, s(a.type, 60), s(a.designation, 60), s(a.status, 20), s(a.detail, 1000), s(a.planCheck, 300), i + 1];
      const o = oldMap[tail];
      const same = o && o.type === rec[1] && o.designation === rec[2] && o.status === rec[3] && o.detail === rec[4] && o.planCheck === rec[5];
      return rec.concat(same ? [o.updatedBy, o.updatedAt] : [user.displayName, ts]);
    });
    const sh = db_().getSheetByName('Aircraft');
    if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, SHEETS.Aircraft.length).clearContent();
    if (rows.length) {
      sh.getRange(2, 1, rows.length, 1).setNumberFormat('@');
      sh.getRange(2, 1, rows.length, SHEETS.Aircraft.length).setValues(rows);
    }
    props.setProperty(APP.AIRCRAFT_VER_PROP, String(cur + 1));
    db_().getSheetByName('AircraftLog').appendRow([ts, user.displayName, JSON.stringify(rows.map(r => r.slice(0, 6)))]);
    audit_(user.username, 'saveAircraft', rows.length + ' ลำ');
    return getAircraft_();
  });
}

// ───────────────────────── Users ─────────────────────────
function listUsers_(user) {
  require_(user, 'manageUsers');
  const sh = db_().getSheetByName('Users');
  return sh.getDataRange().getValues().slice(1).filter(r => r[0]).map(r => ({
    username: String(r[0]), displayName: String(r[1]), role: String(r[2]), active: isTrue_(r[4]),
    mustChange: isTrue_(r[5]), createdAt: tsStr_(r[6]), lastLogin: tsStr_(r[7]),
  }));
}

function saveUser_(user, u) {
  require_(user, 'manageUsers');
  u = u || {};
  const username = String(u.username || '').trim().toLowerCase();
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw err_('BAD_REQUEST', 'ชื่อผู้ใช้ใช้ได้เฉพาะ a-z 0-9 . _ - ยาว 3–30 ตัว');
  const role = String(u.role || '');
  if (ROLES.indexOf(role) < 0) throw err_('BAD_REQUEST', 'สิทธิ์ไม่ถูกต้อง');
  const displayName = String(u.displayName || '').trim().slice(0, 120) || username;
  const active = u.active !== false;
  return withLock_(() => {
    const sh = db_().getSheetByName('Users');
    const row = findRow_(sh, username);
    if (!row) {
      const temp = tempPassword_();
      sh.appendRow([username, displayName, role, hashPassword_(temp), active, true, now_(), '']);
      audit_(user.username, 'createUser', username + ' (' + role + ')');
      return { created: true, username: username, tempPassword: temp };
    }
    if (username === user.username && (role !== 'admin' || !active)) {
      throw err_('BAD_REQUEST', 'ไม่สามารถลดสิทธิ์หรือปิดบัญชีของตัวเองได้');
    }
    const prev = sh.getRange(row, 1, 1, 5).getValues()[0];
    sh.getRange(row, 2, 1, 2).setValues([[displayName, role]]);
    sh.getRange(row, 5).setValue(active);
    if (prev[2] !== role || isTrue_(prev[4]) !== active) {
      CacheService.getScriptCache().put('revoked_' + username, String(Date.now()), APP.SESSION_TTL);
    }
    audit_(user.username, 'updateUser', username + ' (' + role + (active ? '' : ', ปิดใช้งาน') + ')');
    return { updated: true, username: username };
  });
}

function resetPassword_(user, username) {
  require_(user, 'manageUsers');
  username = String(username || '').trim().toLowerCase();
  const sh = db_().getSheetByName('Users');
  const row = findRow_(sh, username);
  if (!row) throw err_('NOT_FOUND', 'ไม่พบผู้ใช้');
  const temp = tempPassword_();
  sh.getRange(row, 4, 1, 3).setValues([[hashPassword_(temp), true, true]]);
  CacheService.getScriptCache().put('revoked_' + username, String(Date.now()), APP.SESSION_TTL);
  CacheService.getScriptCache().remove('fail_' + username);
  audit_(user.username, 'resetPassword', username);
  return { username: username, tempPassword: temp };
}

// ───────────────────────── Settings ─────────────────────────
function publicSettings_() {
  const p = PropertiesService.getScriptProperties();
  return { unitTitle: p.getProperty(APP.TITLE_PROP) || APP.DEFAULT_TITLE, crewConfigured: !!p.getProperty(APP.CREW_PROP),
           lineConfigured: !!(p.getProperty(LINE.TOKEN_PROP) && p.getProperty(LINE.BASIC_PROP)) };
}

function getSettings_(user) {
  require_(user, 'settings');
  const p = PropertiesService.getScriptProperties();
  const id = p.getProperty(APP.CREW_PROP);
  return {
    unitTitle: p.getProperty(APP.TITLE_PROP) || APP.DEFAULT_TITLE,
    crewSheetUrl: id ? 'https://docs.google.com/spreadsheets/d/' + id + '/edit' : '',
    crewSheetTab: p.getProperty(APP.CREW_TAB_PROP) || 'Crew',
    dbUrl: db_().getUrl(),
    ...lineSettingsPublic_(),
  };
}

function saveSettings_(user, st) {
  require_(user, 'settings');
  st = st || {};
  const p = PropertiesService.getScriptProperties();
  if (st.unitTitle != null) p.setProperty(APP.TITLE_PROP, String(st.unitTitle).slice(0, 200) || APP.DEFAULT_TITLE);
  if (st.crewSheetTab != null) p.setProperty(APP.CREW_TAB_PROP, String(st.crewSheetTab).trim() || 'Crew');
  if (st.crewSheetUrl != null) {
    const url = String(st.crewSheetUrl).trim();
    if (!url) {
      p.deleteProperty(APP.CREW_PROP);
    } else {
      const m = url.match(/\/d\/([a-zA-Z0-9_-]{20,})/) || url.match(/^([a-zA-Z0-9_-]{20,})$/);
      if (!m) throw err_('BAD_REQUEST', 'ลิงก์ Google Sheets ไม่ถูกต้อง');
      try { SpreadsheetApp.openById(m[1]); }
      catch (e) { throw err_('BAD_REQUEST', 'เปิดชีตไม่ได้ — ตรวจว่าบัญชีเจ้าของสคริปต์มีสิทธิ์เข้าถึงชีตนี้'); }
      p.setProperty(APP.CREW_PROP, m[1]);
    }
  }
  saveLineSettings_(st);
  CacheService.getScriptCache().remove('crew_v2');
  audit_(user.username, 'saveSettings', '');
  const out = getSettings_(user);
  try { out.crewCount = getCrew_(true).people.length; } catch (e) { out.crewError = e.message; }
  return out;
}

// ───────────────────────── LINE OA: ลงทะเบียน + แจ้งเตือน ─────────────────────────
// ลงทะเบียน: ออกรหัส 6 หลัก (ใช้ครั้งเดียว อายุ 7 วัน) → ผู้ใช้สแกน QR → ส่ง "REG 123456" หา OA → webhook ผูก userId
// แจ้งเตือน: release → นักบินในใบ · ส่งขออนุมัติ → ผู้บังคับบัญชา · อนุมัติ/ไม่อนุมัติ → ผู้ที่ส่งขออนุมัติ
// Channel access token เก็บใน Script Properties เท่านั้น ไม่ส่งกลับไปหน้าเว็บ
const LINE = {
  TOKEN_PROP: 'LINE_TOKEN', BOT_PROP: 'LINE_BOT_ID', BASIC_PROP: 'LINE_BASIC_ID', APPURL_PROP: 'APP_URL', GROUP_PROP: 'LINE_GROUP_ID',
  CODE_DAYS: 7, MAX_TRIES: 3,
};

function lineCfg_() {
  const p = PropertiesService.getScriptProperties();
  return { token: p.getProperty(LINE.TOKEN_PROP) || '', botId: p.getProperty(LINE.BOT_PROP) || '',
           basicId: p.getProperty(LINE.BASIC_PROP) || '', appUrl: p.getProperty(LINE.APPURL_PROP) || '',
           groupId: p.getProperty(LINE.GROUP_PROP) || '' };
}
function lineApi_(path, payload, method) {
  const cfg = lineCfg_();
  if (!cfg.token) throw err_('LINE', 'ยังไม่ได้ตั้งค่า LINE Channel access token');
  const res = UrlFetchApp.fetch('https://api.line.me' + path, {
    method: method || 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + cfg.token },
    payload: payload ? JSON.stringify(payload) : undefined,
  });
  const code = res.getResponseCode();
  return { code: code, ok: code >= 200 && code < 300, body: res.getContentText() };
}
function lineReply_(replyToken, text) {
  if (!replyToken) return;
  try { lineApi_('/v2/bot/message/reply', { replyToken: replyToken, messages: [{ type: 'text', text: String(text).slice(0, 4900) }] }); }
  catch (e) { console.log('[line] reply failed: ' + e.message); }
}
/** text = ข้อความเดียว หรือ array (สูงสุด 5 ข้อความต่อครั้ง) */
function linePush_(to, text) {
  const list = (Array.isArray(text) ? text : [text]).slice(0, 5);
  return lineApi_('/v2/bot/message/push', { to: to, messages: list.map(t => ({ type: 'text', text: String(t).slice(0, 4900) })) });
}
/** แบ่งข้อความยาวเป็นหลายก้อน (LINE จำกัด 5,000 ตัวอักษรต่อข้อความ) โดยตัดที่ขอบ block */
function chunkText_(header, blocks, footer) {
  const out = [];
  let cur = header;
  blocks.forEach(b => {
    if ((cur + '\n\n' + b).length > 4600 && cur) { out.push(cur); cur = b; }
    else cur = cur ? cur + '\n\n' + b : b;
  });
  if (footer) { if ((cur + footer).length > 4900) { out.push(cur); cur = footer.trim(); } else cur += footer; }
  if (cur) out.push(cur);
  return out.slice(0, 5);
}

/** key = 'pilot:OPS001' | 'user:username' */
function lineKeyName_(key) {
  const m = String(key || '').match(/^(pilot|user):(.+)$/);
  if (!m) throw err_('BAD_REQUEST', 'รหัสผู้รับไม่ถูกต้อง');
  if (m[1] === 'pilot') {
    const p = getCrew_(false).people.find(x => x.id === m[2]);
    if (!p) throw err_('NOT_FOUND', 'ไม่พบนักบินรหัส ' + m[2]);
    return { kind: 'pilot', id: m[2], name: p.short };
  }
  const sh = db_().getSheetByName('Users');
  const row = findRow_(sh, m[2]);
  if (!row) throw err_('NOT_FOUND', 'ไม่พบผู้ใช้ ' + m[2]);
  return { kind: 'user', id: m[2], name: String(sh.getRange(row, 2).getValue()) };
}

function canIssueFor_(user, key) {
  if (key === 'user:' + user.username) return true;
  if (/^pilot:/.test(key)) return CAN.managePilots.indexOf(user.role) >= 0;
  return CAN.manageUsers.indexOf(user.role) >= 0;
}

function lineIssueCodes_(user, keys) {
  if (!Array.isArray(keys) || !keys.length) throw err_('BAD_REQUEST', 'ไม่ระบุผู้ลงทะเบียน');
  const cfg = lineCfg_();
  if (!cfg.token || !cfg.basicId) throw err_('LINE', 'ผู้ดูแลระบบยังไม่ได้ตั้งค่า LINE OA (แท็บตั้งค่า)');
  keys = keys.slice(0, 200).map(String);
  keys.forEach(k => { if (!canIssueFor_(user, k)) throw err_('FORBIDDEN', 'ไม่มีสิทธิ์ออกรหัสให้ ' + k); });
  const people = keys.map(k => Object.assign({ key: k }, lineKeyName_(k)));
  return withLock_(() => {
    const sh = db_().getSheetByName('LineCodes');
    const n = sh.getLastRow() - 1;
    const rows = n > 0 ? sh.getRange(2, 1, n, 7).getValues() : [];
    const nowMs = Date.now();
    const used = {};
    rows.forEach((r, i) => {
      if (!r[6] && Number(r[5]) > nowMs) used[String(r[0])] = 1;
      if (!r[6] && keys.indexOf(String(r[1])) >= 0) sh.getRange(i + 2, 7).setValue('replaced');   // รหัสเก่าของคนเดิมใช้ไม่ได้แล้ว
    });
    const exp = nowMs + LINE.CODE_DAYS * 86400000;
    const out = people.map(p => {
      let code;
      do { code = String(parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 8), 16) % 1000000).padStart(6, '0'); } while (used[code]);
      used[code] = 1;
      return { key: p.key, name: p.name, code: code, expiresAt: exp,
               url: 'https://line.me/R/oaMessage/' + encodeURIComponent(cfg.basicId) + '/?' + encodeURIComponent('REG ' + code) };
    });
    appendRows_(sh, out.map(o => [o.code, o.key, o.name, user.username, now_(), o.expiresAt, '']));
    audit_(user.username, 'lineIssueCodes', keys.length + ' คน');
    return { codes: out, basicId: cfg.basicId };
  });
}

function lineLinksMap_() {
  const sh = db_().getSheetByName('LineLinks');
  const n = sh.getLastRow() - 1;
  const out = {};
  if (n > 0) sh.getRange(2, 1, n, 7).getValues().forEach(r => {
    if (r[0]) out[String(r[0])] = { status: String(r[4]), linkedAt: tsStr_(r[5]), userId: String(r[3]), name: String(r[2]) };
  });
  return out;
}

function lineLinks_(user) {
  const all = lineLinksMap_();
  const mine = all['user:' + user.username];
  const cfg = lineCfg_();
  const out = { configured: !!(cfg.token && cfg.basicId), basicId: cfg.basicId, me: mine ? mine.status : '' };
  if (CAN.managePilots.indexOf(user.role) >= 0 || CAN.manageUsers.indexOf(user.role) >= 0) {
    out.links = {};
    Object.keys(all).forEach(k => {
      if (/^pilot:/.test(k) || CAN.manageUsers.indexOf(user.role) >= 0) out.links[k] = { status: all[k].status, linkedAt: all[k].linkedAt };
    });
  }
  return out;
}

function lineUnlink_(user, key) {
  key = String(key || '');
  if (!canIssueFor_(user, key)) throw err_('FORBIDDEN', 'ไม่มีสิทธิ์ยกเลิกการเชื่อมของ ' + key);
  return withLock_(() => {
    const sh = db_().getSheetByName('LineLinks');
    const row = findRow_(sh, key);
    if (row) sh.deleteRow(row);
    audit_(user.username, 'lineUnlink', key);
    return lineLinks_(user);
  });
}

/** webhook จาก LINE (ไม่มี token — ตรวจด้วย destination = bot userId และรหัสลงทะเบียน) */
function handleLineWebhook_(body) {
  const cfg = lineCfg_();
  if (!cfg.token) return { ok: true };
  if (cfg.botId && body.destination && body.destination !== cfg.botId) { console.log('[line] wrong destination'); return { ok: true }; }
  (body.events || []).forEach(ev => {
    if (ev.type === 'join' && ev.source && ev.source.groupId) {      // เชิญ OA เข้ากลุ่ม → บอก Group ID ไว้ใส่ในหน้าตั้งค่า
      lineReply_(ev.replyToken, 'สวัสดีครับ 👋 Group ID ของกลุ่มนี้คือ\n' + ev.source.groupId + '\nนำไปใส่ในแอปใบจัดบิน → ตั้งค่า → LINE OA เพื่อรับสรุปใบจัดบินเมื่อ release');
      return;
    }
    const uid = ev.source && ev.source.type === 'user' ? ev.source.userId : '';
    if (!uid) return;
    if (ev.type === 'follow') {
      lineReply_(ev.replyToken, 'สวัสดีครับ 👋\nหากต้องการรับแจ้งเตือนใบจัดบิน ฝูงบิน 602 กรุณาสแกน QR ลงทะเบียนที่ได้รับจากผู้จัดบิน\nหรือพิมพ์ REG ตามด้วยรหัส 6 หลัก เช่น REG 123456');
    } else if (ev.type === 'unfollow') {
      withLock_(() => {
        const sh = db_().getSheetByName('LineLinks');
        const n = sh.getLastRow() - 1;
        if (n > 0) sh.getRange(2, 1, n, 7).getValues().forEach((r, i) => { if (String(r[3]) === uid) sh.getRange(i + 2, 5, 1, 3).setValues([['blocked', r[5], now_()]]); });
      });
    } else if (ev.type === 'message' && ev.message && ev.message.type === 'text') {
      const m = String(ev.message.text).trim().match(/^REG\s*(\d{6})$/i);
      if (!m) return;                      // ข้อความอื่นไม่ตอบ (OA ยังใช้แชทปกติได้)
      lineReply_(ev.replyToken, lineRegister_(m[1], uid));
    }
  });
  return { ok: true };
}

function lineRegister_(code, uid) {
  return withLock_(() => {
    const ss = db_();
    const cs = ss.getSheetByName('LineCodes');
    const row = findRow_(cs, code);
    const r = row ? cs.getRange(row, 1, 1, 7).getValues()[0] : null;
    if (!r || r[6] || Number(r[5]) < Date.now()) return '❌ รหัสไม่ถูกต้อง ใช้ไปแล้ว หรือหมดอายุ\nกรุณาขอ QR ลงทะเบียนใหม่จากผู้จัดบิน';
    cs.getRange(row, 7).setValue(now_());
    const key = String(r[1]), name = String(r[2]);
    const ls = ss.getSheetByName('LineLinks');
    const lr = findRow_(ls, key);
    const rec = [key, key.split(':')[1], name, uid, 'active', now_(), now_()];
    if (lr) ls.getRange(lr, 1, 1, 7).setValues([rec]); else appendRows_(ls, [rec]);
    audit_('line', 'lineRegister', key);
    return '✅ ลงทะเบียนสำเร็จ\n' + name + '\n' + (/^pilot:/.test(key)
      ? 'ท่านจะได้รับแจ้งเตือนทาง LINE เมื่อใบจัดบินที่มีชื่อท่าน release แล้ว'
      : 'ท่านจะได้รับแจ้งเตือนทาง LINE เกี่ยวกับการขออนุมัติใบจัดบิน');
  });
}

// ── คิวแจ้งเตือน (ส่งหลังปล่อย lock เพื่อไม่ให้ผู้อื่นต้องรอ) ──
function enqueueLine_(type, payload) {
  if (!lineCfg_().token) return;
  const sh = db_().getSheetByName('LineQueue');
  appendRows_(sh, [[Utilities.getUuid().slice(0, 8), now_(), type, JSON.stringify(payload), 'PENDING', 0, '', '']]);
}
function processLineQueueSafe_() {
  try { processLineQueue_(); } catch (e) { console.log('[line] queue error: ' + e.message); }
}
function processLineQueue_() {
  if (!lineCfg_().token) return 0;
  const sh = db_().getSheetByName('LineQueue');
  const n = sh.getLastRow() - 1;
  if (n < 1) return 0;
  const rows = sh.getRange(2, 1, n, 8).getValues();
  let done = 0;
  rows.forEach((r, i) => {
    if (r[4] !== 'PENDING' || Number(r[5]) >= LINE.MAX_TRIES) return;
    let msgs = [], err = '';
    try { msgs = buildLineMessages_(String(r[2]), JSON.parse(r[3])); } catch (e) { err = 'build: ' + e.message; }
    let sent = 0;
    msgs.forEach(m => {
      try { const res = linePush_(m.to, m.text); if (res.ok) sent++; else err = 'HTTP ' + res.code + ' ' + res.body.slice(0, 200); }
      catch (e) { err = e.message; }
    });
    const ok = !err;
    sh.getRange(i + 2, 5, 1, 4).setValues([[ok ? 'DONE' : (Number(r[5]) + 1 >= LINE.MAX_TRIES ? 'ERROR' : 'PENDING'), Number(r[5]) + 1, now_(), sent + '/' + msgs.length + (err ? ' ' + err : '')]]);
    step_('line ' + r[2] + ' sent ' + sent + '/' + msgs.length + (err ? ' ERR ' + err : ''));
    done++;
  });
  return done;
}

const TH_DOW_ = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
const TH_MON_ = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
function thShort_(date) {
  const t = new Date(date + 'T00:00:00Z');
  return TH_DOW_[t.getUTCDay()] + ' ' + t.getUTCDate() + ' ' + TH_MON_[t.getUTCMonth()] + ' ' + String(t.getUTCFullYear() + 543).slice(2);
}
function rangeTh_(dates) { return dates.length > 1 ? thShort_(dates[0]) + ' – ' + thShort_(dates[dates.length - 1]) + ' (' + dates.length + ' วัน)' : thShort_(dates[0]); }
function appLink_(dates) {
  const base = lineCfg_().appUrl;
  if (!base) return '';
  return base.replace(/#.*$/, '') + (base.indexOf('?') >= 0 ? '&' : '?') + 'openExternalBrowser=1#from=' + dates[0] + '&to=' + dates[dates.length - 1];
}
function lineRecipients_(keys) {
  const links = lineLinksMap_();
  const seen = {};
  return keys.map(k => links[k]).filter(l => l && l.status === 'active' && l.userId && !seen[l.userId] && (seen[l.userId] = 1)).map(l => l.userId);
}
function usersWithRole_(roles) {
  return db_().getSheetByName('Users').getDataRange().getValues().slice(1)
    .filter(r => r[0] && isTrue_(r[4]) && roles.indexOf(String(r[2])) >= 0).map(r => 'user:' + r[0]);
}
/** ผู้ที่ส่งขออนุมัติล่าสุดของแต่ละวัน (จากประวัติในใบ) */
function submitters_(dates) {
  const sh = db_().getSheetByName('FlightOrders');
  const keys = {};
  dates.forEach(d => {
    const row = findRow_(sh, d); if (!row) return;
    const log = safeJson_(sh.getRange(row, 14).getValue(), []);
    const last = log.slice().reverse().find(l => l.action === 'submit' && l.u);
    if (last) keys['user:' + last.u] = 1;
  });
  const out = Object.keys(keys);
  return out.length ? out : usersWithRole_(['scheduler']);
}

function buildLineMessages_(type, p) {
  const dates = (p.dates || []).slice().sort();
  if (!dates.length) return [];
  const link = appLink_(dates);
  const tail = link ? '\n\nเปิดใบจัดบิน:\n' + link : '';
  if (type === 'submit') {
    const text = '📨 มีใบจัดบินส่งขออนุมัติ\n' + rangeTh_(dates) + '\nโดย ' + p.by + (p.note ? '\nข้อความ: ' + p.note : '') + tail;
    return lineRecipients_(usersWithRole_(['commander'])).map(to => ({ to: to, text: text }));
  }
  if (type === 'approve' || type === 'deny') {
    const text = type === 'approve'
      ? '✅ ใบจัดบินได้รับอนุมัติแล้ว\n' + rangeTh_(dates) + '\nโดย ' + p.by + '\nกด Release เพื่อเผยแพร่ใบจัดบิน' + tail
      : '❌ ใบจัดบินไม่ได้รับอนุมัติ\n' + rangeTh_(dates) + '\nโดย ' + p.by + '\nเหตุผล: ' + p.reason + '\nกรุณาแก้ไขแล้วส่งขออนุมัติใหม่' + tail;
    return lineRecipients_(p.to || []).map(to => ({ to: to, text: text }));
  }
  if (type === 'release') {
    // รวมงานของนักบินแต่ละคนทุกวันในชุด → 1 ข้อความต่อคน
    const sh = db_().getSheetByName('FlightOrders');
    const per = {};
    let rev = 1;
    dates.forEach(d => {
      const row = findRow_(sh, d); if (!row) return;
      const r = sh.getRange(row, 1, 1, SHEETS.FlightOrders.length).getValues()[0];
      const meta = metaFromRow_(r);
      if (meta.status !== STATUS.RELEASED) return;
      rev = Math.max(rev, meta.revision);
      const o = unpack_(r[12]) || {};
      (o.missions || []).forEach((m, i) => (m.crew || []).forEach(c => {
        if (!c.id) return;
        const t = m.times || {};
        const lines = ['📅 ' + thShort_(d) + ' — ภารกิจที่ ' + (i + 1) + (meta.revision > 1 ? ' (ฉบับแก้ไข Rev.' + meta.revision + ')' : '')];
        if (m.aircraftLabel) lines.push('เครื่อง: ' + m.aircraftLabel + (m.acRole === 'primary' ? ' · บ.จริง' : m.acRole === 'spare' ? ' · บ.สำรอง' : ''));
        if (c.role) lines.push('หน้าที่: ' + c.role);
        if (m.title) lines.push('ภารกิจ: ' + m.title);
        if (m.route) lines.push('เส้นทาง: ' + m.route);
        const tm = [['Brief', t.brief], [t.towMode === 'taxi' ? 'TAXI' : 'ลาก', t.tow], [/^\s*วิ่งขึ้น/.test(t.takeoff || '') ? '' : 'วิ่งขึ้น', t.takeoff]]
          .filter(x => x[1]).map(x => (x[0] ? x[0] + ' ' : '') + x[1]);
        if (tm.length) lines.push('เวลา: ' + tm.join(' · '));
        lines.push('การแต่งกาย: ' + (m.dress || 'ไม่ได้ระบุ (สอบถามผู้จัดบิน)'));   // แสดงเสมอ
        (per[c.id] = per[c.id] || []).push(lines.join('\n'));
      }));
      const sb = o.standby || {};
      Object.keys(STBY_TYPES).forEach(k => {
        if (!sb[k] || !sb[k].on) return;
        (sb[k].pilots || []).forEach(pl => { if (pl.id) (per[pl.id] = per[pl.id] || []).push('📅 ' + thShort_(d) + ' — ' + STBY_TYPES[k].label); });
      });
    });
    const links = lineLinksMap_();
    const out = Object.keys(per).map(id => {
      const l = links['pilot:' + id];
      if (!l || l.status !== 'active') return null;
      return { to: l.userId, text: chunkText_('✈️ ใบจัดบิน release แล้ว' + (rev > 1 ? ' (มีการแก้ไข)' : '') + '\n' + rangeTh_(dates), per[id], tail) };
    }).filter(Boolean);
    // สรุปทั้งชุดเข้ากลุ่ม LINE (ถ้าตั้ง Group ID ไว้)
    const gid = lineCfg_().groupId;
    if (gid) out.push({ to: gid, text: groupReleaseText_(dates, tail) });
    return out;
  }
  return [];
}

/** ข้อความสรุปใบจัดบินทั้งชุดสำหรับกลุ่ม LINE: ทุกภารกิจ + นักบิน + STBY */
function groupReleaseText_(dates, tail) {
  const sh = db_().getSheetByName('FlightOrders');
  const blocks = [];
  let rev = 1;
  const NUM = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧', '⑨', '⑩'];
  dates.forEach(d => {
    const row = findRow_(sh, d); if (!row) return;
    const r = sh.getRange(row, 1, 1, SHEETS.FlightOrders.length).getValues()[0];
    const meta = metaFromRow_(r);
    if (meta.status !== STATUS.RELEASED) return;
    rev = Math.max(rev, meta.revision);
    const o = unpack_(r[12]) || {};
    const ms = o.noMission ? [] : (o.missions || []);
    const lines = ['📅 ' + thShort_(d) + ' — ' + (ms.length ? ms.length + ' ภารกิจ' : 'ไม่มีภารกิจ') + (meta.revision > 1 ? ' (ฉบับแก้ไข Rev.' + meta.revision + ')' : '')];
    ms.forEach((m, i) => {
      const t = m.times || {};
      lines.push('');
      lines.push((NUM[i] || '(' + (i + 1) + ')') + ' ' + (m.aircraftLabel || 'ภารกิจที่ ' + (i + 1)) + (m.acRole === 'primary' ? ' · บ.จริง' : m.acRole === 'spare' ? ' · บ.สำรอง' : '') + (m.type && m.type !== 'ภารกิจ' ? ' · ' + m.type : ''));
      if (m.title) lines.push('ภารกิจ: ' + m.title);
      if (m.route) lines.push('เส้นทาง: ' + m.route);
      const tm = [['Brief', t.brief], [t.towMode === 'taxi' ? 'TAXI' : 'ลาก', t.tow], [/^\s*วิ่งขึ้น/.test(t.takeoff || '') ? '' : 'วิ่งขึ้น', t.takeoff]]
        .filter(x => x[1]).map(x => (x[0] ? x[0] + ' ' : '') + x[1]);
      if (tm.length) lines.push('เวลา: ' + tm.join(' · '));
      const crew = (m.crew || []).map(c => (c.role ? c.role + ' ' : '') + c.name);
      if (crew.length) lines.push('นักบิน: ' + crew.join(', '));
      lines.push('การแต่งกาย: ' + (m.dress || 'ไม่ได้ระบุ'));
    });
    const sb = o.standby || {};
    const st = Object.keys(STBY_TYPES).filter(k => sb[k] && sb[k].on).map(k => STBY_TYPES[k].label + ': ' + ((sb[k].pilots || []).filter(p => p.name).map(p => p.name).join(', ') || '—'));
    if (st.length) { lines.push(''); st.forEach(x => lines.push(x)); }
    blocks.push(lines.join('\n'));
  });
  return chunkText_('✈️ ใบจัดบิน release แล้ว' + (rev > 1 ? ' (มีการแก้ไข)' : '') + '\n' + rangeTh_(dates), blocks, tail);
}

function lineSettingsPublic_() {
  const c = lineCfg_();
  return { lineConfigured: !!c.token, lineBasicId: c.basicId, appUrl: c.appUrl, lineBotOk: !!c.botId, lineGroupId: c.groupId };
}
/** บันทึก token: ตรวจกับ LINE แล้วดึง bot userId + LINE ID (@xxx) มาเก็บ */
function saveLineSettings_(st) {
  const p = PropertiesService.getScriptProperties();
  if (st.appUrl != null) {
    const u = String(st.appUrl).trim();
    if (u && !/^https:\/\//.test(u)) throw err_('BAD_REQUEST', 'ลิงก์แอปต้องขึ้นต้นด้วย https://');
    if (u) p.setProperty(LINE.APPURL_PROP, u); else p.deleteProperty(LINE.APPURL_PROP);
  }
  if (st.lineGroupId != null) {
    const g = String(st.lineGroupId).trim();
    if (g && !/^C[0-9a-f]{32}$/.test(g)) throw err_('BAD_REQUEST', 'Group ID ต้องขึ้นต้นด้วย C ตามด้วยตัวอักษร 32 ตัว (เช่น C1234…)');
    if (g) p.setProperty(LINE.GROUP_PROP, g); else p.deleteProperty(LINE.GROUP_PROP);
  }
  if (st.lineToken === '-') {                       // ยกเลิกการเชื่อม LINE
    [LINE.TOKEN_PROP, LINE.BOT_PROP, LINE.BASIC_PROP].forEach(k => p.deleteProperty(k));
  } else if (st.lineToken) {
    const prev = p.getProperty(LINE.TOKEN_PROP);
    p.setProperty(LINE.TOKEN_PROP, String(st.lineToken).trim());
    const res = lineApi_('/v2/bot/info', null, 'get');
    if (!res.ok) {
      if (prev) p.setProperty(LINE.TOKEN_PROP, prev); else p.deleteProperty(LINE.TOKEN_PROP);
      throw err_('BAD_REQUEST', 'Channel access token ไม่ถูกต้อง (LINE ตอบ HTTP ' + res.code + ')');
    }
    const info = JSON.parse(res.body);
    p.setProperty(LINE.BOT_PROP, info.userId || '');
    p.setProperty(LINE.BASIC_PROP, info.basicId || '');
  }
}

/** admin: ส่งข้อความทดสอบเข้ากลุ่ม LINE */
function lineTestGroup_(user) {
  require_(user, 'settings');
  const gid = lineCfg_().groupId;
  if (!gid) throw err_('BAD_REQUEST', 'ยังไม่ได้ใส่ Group ID');
  const res = linePush_(gid, '🔔 ทดสอบการแจ้งเตือนเข้ากลุ่มจากระบบใบจัดบิน ฝูงบิน 602\nเมื่อใบจัดบิน release ระบบจะส่งสรุปเข้ากลุ่มนี้');
  if (!res.ok) throw err_('LINE', 'ส่งไม่สำเร็จ: HTTP ' + res.code + ' ' + res.body.slice(0, 200) + ' (ตรวจว่าเชิญ LINE OA เข้ากลุ่มแล้ว)');
  return { sent: true };
}

/** admin: ส่งข้อความทดสอบหาตัวเอง */
function lineTest_(user) {
  require_(user, 'settings');
  const l = lineLinksMap_()['user:' + user.username];
  if (!l || l.status !== 'active') throw err_('BAD_REQUEST', 'บัญชีของท่านยังไม่ได้เชื่อม LINE — กดเมนูผู้ใช้ → รับแจ้งเตือนทาง LINE ก่อน');
  const res = linePush_(l.userId, '🔔 ทดสอบการแจ้งเตือนจากระบบใบจัดบิน ฝูงบิน 602');
  if (!res.ok) throw err_('LINE', 'ส่งไม่สำเร็จ: HTTP ' + res.code + ' ' + res.body.slice(0, 200));
  return { sent: true };
}

// ───────────────────────── Stats ─────────────────────────
function stats_(user, from, to) {
  if (user.mustChange) throw err_('MUST_CHANGE', 'กรุณาเปลี่ยนรหัสผ่านก่อนใช้งาน');
  from = checkDate_(from); to = checkDate_(to);
  try { withLock_(() => processFlatQueue_()); } catch (e) { /* ระบบกำลังบันทึก → ใช้ข้อมูลที่มีอยู่ */ }
  const ss = db_();
  const read = name => {
    const sh = ss.getSheetByName(name);
    const n = sh.getLastRow() - 1;
    return n < 1 ? [] : sh.getRange(2, 1, n, SHEETS[name].length).getValues();
  };
  const inRange = r => { const d = keyStr_(r[0]); return d >= from && d <= to && r[1] === STATUS.RELEASED; };
  const missions = read('MissionLog').filter(inRange);
  const allCrew = read('CrewLog').filter(inRange);
  const crew = allCrew.filter(r => r[5] !== 'STBY');
  const stby = allCrew.filter(r => r[5] === 'STBY');
  const count = (rows, keyFn) => {
    const m = {};
    rows.forEach(r => { const k = keyFn(r) || '(ไม่ระบุ)'; m[k] = (m[k] || 0) + 1; });
    return Object.keys(m).map(k => ({ key: k, count: m[k] })).sort((a, b) => b.count - a.count);
  };
  const days = {};
  missions.forEach(r => days[keyStr_(r[0])] = 1);
  return {
    from: from, to: to,
    totalMissions: missions.length,
    flyingDays: Object.keys(days).length,
    byAircraft: count(missions, r => r[4] ? r[4] + (r[5] ? ' / ' + r[5] : '') : ''),
    byType: count(missions, r => r[6]),
    byPerson: count(crew, r => r[7] + '|' + r[8] + '|' + r[6]).map(x => {
      const p = x.key.split('|');
      return { name: p[0], dept: p[1], id: p[2], count: x.count };
    }),
    byRole: count(crew, r => r[9]),
    byStandby: count(stby, r => r[7] + '|' + r[6]).map(x => { const p = x.key.split('|'); return { name: p[0], id: p[1], count: x.count }; }),
    standbyByType: count(stby, r => r[9]),
  };
}

// ───────────────────────── Helpers ─────────────────────────
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}
function err_(code, msg, extra) { const e = new Error(msg); e.code = code; e.extra = extra; return e; }
function now_() { return Utilities.formatDate(new Date(), APP.TZ, 'yyyy-MM-dd HH:mm:ss'); }
function tsStr_(v) { return v instanceof Date ? Utilities.formatDate(v, APP.TZ, 'yyyy-MM-dd HH:mm:ss') : String(v || ''); }
function keyStr_(v) { return v instanceof Date ? Utilities.formatDate(v, APP.TZ, 'yyyy-MM-dd') : String(v || '').trim(); }
function isTrue_(v) { return v === true || /^(true|y|yes|1)$/i.test(String(v)); }
function canSeeUnreleased_(user) { return APP.VIEWER_SEES_UNRELEASED || CAN.seeUnreleased.indexOf(user.role) >= 0; }
function safeJson_(s, d) { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } }
function logEntry_(user, action, note) { return { at: now_(), by: user.displayName, u: user.username, role: user.role, action: action, note: note || '' }; }
function trimLog_(log) { return log.slice(-60); }

function checkDate_(d) {
  d = String(d || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw err_('BAD_REQUEST', 'รูปแบบวันที่ต้องเป็น YYYY-MM-DD');
  return d;
}

function findRow_(sh, key) {
  if (sh.getLastRow() < 2) return 0;
  const cell = sh.getRange(2, 1, sh.getLastRow() - 1, 1).createTextFinder(String(key)).matchEntireCell(true).findNext();
  return cell ? cell.getRow() : 0;
}

function appendRows_(sh, rows) {
  if (!rows.length) return;
  const start = sh.getLastRow() + 1;
  sh.getRange(start, 1, rows.length, 1).setNumberFormat('@');
  sh.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
}

/** เก็บ JSON ในเซลล์ (จำกัด 50,000 ตัวอักษร) — ถ้ายาวเกินจะบีบอัดอัตโนมัติ */
function pack_(obj) {
  const s = JSON.stringify(obj);
  if (s.length < 45000) return s;
  const gz = 'gz:' + Utilities.base64Encode(Utilities.gzip(Utilities.newBlob(s, 'application/json')).getBytes());
  if (gz.length >= 50000) throw err_('TOO_LARGE', 'ใบจัดบินมีข้อมูลมากเกินไป กรุณาย่อหมายเหตุ');
  return gz;
}
function unpack_(s) {
  s = String(s || '');
  if (!s) return null;
  if (s.indexOf('gz:') === 0) {
    s = Utilities.ungzip(Utilities.newBlob(Utilities.base64Decode(s.slice(3)), 'application/x-gzip')).getDataAsString('UTF-8');
  }
  return JSON.parse(s);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) throw err_('BUSY', 'ระบบกำลังบันทึกข้อมูลของผู้อื่น กรุณารอสักครู่แล้วลองใหม่');
  step_('lock acquired');
  try { return fn(); } finally { lock.releaseLock(); step_('lock released'); }
}

function audit_(user, action, detail) {
  try { db_().getSheetByName('AuditLog').appendRow([now_(), user, action, detail]); } catch (e) { /* ไม่ให้ log ทำให้งานหลักล้ม */ }
}
