/* ใบจัดบิน ฝูงบิน 602 — PWA frontend (vanilla JS, ไม่มี build step) */
(function () {
  'use strict';

  const APP_VERSION = '1.5.0';   // ให้ตรงกับ VERSION ใน sw.js

  // ───────────────────────── Constants ─────────────────────────
  const ROLE_LABEL = { admin: 'ผู้ดูแลระบบ', scheduler: 'ผู้จัดบิน', commander: 'ผู้บังคับบัญชา', documents: 'ผู้ดูแลเอกสาร', viewer: 'ผู้ชม' };
  const STATUS_LABEL = { NEW: 'ยังไม่มีใบจัดบิน', DRAFT: 'ร่าง (กำลังจัดทำ)', PENDING: 'ขออนุมัติแล้ว · รอพิจารณา', APPROVED: 'อนุมัติแล้ว', DENIED: 'ไม่อนุมัติ', RELEASED: 'Release แล้ว' };
  const CAN = {
    editOrder: ['admin', 'scheduler'], release: ['admin', 'scheduler'], editAircraft: ['admin', 'scheduler'],
    approve: ['admin', 'commander'], seeUnreleased: ['admin', 'scheduler', 'commander', 'documents'],
    manageUsers: ['admin'], settings: ['admin'], deleteOrder: ['admin'],
  };
  const DUTY_SINGLE = [['wingDuty', 'น.เวรกองบิน 6'], ['wingDutyAsst', 'ผช.น.เวร กองบิน 6'], ['controller', 'น.เวร Controller']];
  const DUTY_MULTI = { schedulers: ['น.จัดบินประจำวัน', 2], documents: ['น.เอกสาร', 3] };
  // จุดจอด บ. — เลือก "อื่น ๆ" แล้วกรอกเองได้ (ตอนพิมพ์แสดงเฉพาะข้อความที่กรอก)
  const PARKING = ['ฝูง.602 บน.6', 'ท่าอากาศยานทหาร 1', 'ท่าอากาศยานทหาร 2', 'N2', 'N23R', 'N18R'];
  const parkingOther = new Set();   // ช่องที่ผู้ใช้เลือก "อื่น ๆ" แต่ยังไม่ได้กรอก
  // นบ.STBY: [key, ชื่อ, จำนวนคน, แบบสำหรับแสดงคุณสมบัติ] — ต้องตรงกับ STBY_TYPES ใน Code.gs
  const STBY_TYPES = [['royal320', 'STBY A319/ACJ320 นบ.ราชฯ', 3, 'A319/320'], ['a320', 'STBY A319/ACJ320', 2, 'A319/320'],
    ['a340', 'STBY A340', 2, 'A340'], ['ssj', 'STBY SSJ100', 2, 'SSJ']];
  // หน้าที่นักบิน (ลำดับตามที่ใช้ในฝูง) — แก้รายการได้ที่นี่
  const PILOT_ROLES = ['นบ.1 ราชฯ', 'นบ.2 ราชฯ', 'นบ.1', 'นบ.2', 'คบ.', 'ฝคบ.', 'ฝฟ.', 'ฝนบ.1', 'ฝพ.', 'ฝป.', 'ฝป(พ.)', 'ฝรน.1', 'ฝรน.2', 'OBS'];
  const MISSION_TYPES = ['ภารกิจ', 'ฝึกบิน'];
  const DRESS = ['ชุดบิน', 'ชุดแขนยาวบ่าอ่อน'];
  const AC_STATUS = ['FMC', 'PMC', 'NMCM', 'NMCS', 'NMCB', 'NMC'];
  const DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
  const MONTHS_S = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

  // ───────────────────────── State ─────────────────────────
  const S = {
    user: null, settings: { unitTitle: 'ใบจัดบิน | ฝูงบิน 602 กองบิน 6' },
    crew: { people: [] }, crewById: {}, aircraft: { list: [], version: 0 },
    tab: 'order', date: todayKey(), today: todayKey(), range: [todayKey()], days: {}, holidays: [], holidayMap: {},
    meta: null, order: null, dirty: false, draftOffer: null,
    acEdit: null, history: { month: todayKey().slice(0, 7), rows: null },
    stats: { from: todayKey().slice(0, 8) + '01', to: todayKey(), data: null },
    users: null, settingsForm: null, menu: false,
  };

  // ───────────────────────── Utils ─────────────────────────
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const clone = o => JSON.parse(JSON.stringify(o));
  const rid = () => Math.random().toString(36).slice(2, 9);
  const can = p => !!S.user && CAN[p].includes(S.user.role);
  function todayKey() { const d = new Date(); return ymd(d); }
  function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function parseKey(k) { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); }
  function addDays(k, n) { const d = parseKey(k); d.setDate(d.getDate() + n); return ymd(d); }
  function thaiDate(k) { const d = parseKey(k); return 'วัน' + DAYS[d.getDay()] + 'ที่ ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + (d.getFullYear() + 543); }
  function thaiShort(k) { const d = parseKey(k); return d.getDate() + ' ' + MONTHS_S[d.getMonth()] + ' ' + String(d.getFullYear() + 543).slice(2); }
  function thaiTs(ts) {
    if (!ts) return '';
    const m = String(ts).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    return m ? (Number(m[3]) + ' ' + MONTHS_S[Number(m[2]) - 1] + ' ' + String(Number(m[1]) + 543).slice(2) + ' ' + m[4] + ':' + m[5] + ' น.') : ts;
  }
  function getPath(o, p) { return p.split('.').reduce((a, k) => (a == null ? a : a[k]), o); }
  function setPath(o, p, v) {
    const ks = p.split('.'); const last = ks.pop();
    const t = ks.reduce((a, k) => a[k], o); t[last] = v;
  }
  function typeKey(t) {
    t = String(t || '').toUpperCase();
    if (/A3(19|20)|ACJ|A320/.test(t)) return 'A319/320';
    if (/A340/.test(t)) return 'A340';
    if (/SSJ/.test(t)) return 'SSJ';
    if (/737/.test(t)) return 'B737';
    return t;
  }
  function aircraftLabel(a) { return [a.type, a.designation].filter(Boolean).join(' ') + (a.tail ? ' (' + a.tail + ')' : ''); }

  function blankP() { return { id: '', name: '', phone: '' }; }
  function blankVip() { return { on: false, name: '', position: '', phone: '' }; }
  function blankStandby() { const s = {}; STBY_TYPES.forEach(([k, , n]) => s[k] = { on: false, pilots: Array.from({ length: n }, blankP) }); return s; }
  function blankMission() {
    return { id: rid(), aircraftTail: '', aircraftLabel: '', aircraftType: '', acRole: '', pairTail: '', pairLabel: '',
      type: 'ภารกิจ', title: '', callsign: '', route: '', fuel: '',
      times: { brief: '', tow: '', takeoff: '', towMode: 'tow' }, pax: '', parking: { out: '', ret: '' },
      director: blankVip(), acCommander: blankVip(), hospitality: { on: false, detail: '' }, crew: [], poc: '', dress: '', notes: '' };
  }
  /** ผู้จัดทำใบ = ผู้ใช้ที่ login (ผู้จัดบิน) — จำเบอร์ไว้ในเครื่องนี้ */
  function myContact() {
    if (!S.user || !can('editOrder')) return blankP();
    let phone = '';
    try { phone = localStorage.getItem('fo602_phone_' + S.user.username) || ''; } catch (e) { /* ignore */ }
    return { id: '', name: S.user.displayName, phone };
  }
  function blankOrder() {
    return { title: S.settings.unitTitle,
      duty: { wingDuty: blankP(), wingDutyAsst: blankP(), controller: blankP(), schedulers: [blankP()], documents: [blankP()], refuelIdx: -1, contact: myContact() },
      standby: blankStandby(), noMission: false, missions: [blankMission()], remarks: '' };
  }
  /** แปลงข้อมูลเก่า/ใหม่ให้เป็นโครงสร้างปัจจุบันเสมอ */
  function normalizeOrder(src) {
    const o = clone(src || {}), d = o.duty || {};
    const pp = x => Object.assign(blankP(), x || {});
    const lst = (v, max) => { const a = (Array.isArray(v) ? v : (v && (v.name || v.id) ? [v] : [])).slice(0, max).map(pp); return a.length ? a : [blankP()]; };
    const ri = Number(d.refuelIdx);
    const duty = { wingDuty: pp(d.wingDuty), wingDutyAsst: pp(d.wingDutyAsst), controller: pp(d.controller),
      schedulers: lst(d.schedulers || d.scheduler, 2), documents: lst(d.documents, 3), refuelIdx: Number.isInteger(ri) ? ri : -1, contact: pp(d.contact) };
    const standby = blankStandby();
    Object.keys(standby).forEach(k => {
      const x = (o.standby || {})[k];
      if (x) { standby[k].on = !!x.on; (x.pilots || []).forEach((p, i) => { if (i < standby[k].pilots.length) standby[k].pilots[i] = pp(p); }); }
    });
    const missions = (o.missions || []).map(m => Object.assign(blankMission(), m, {
      times: Object.assign({ brief: '', tow: '', takeoff: '', towMode: 'tow' }, m.times), parking: Object.assign({ out: '', ret: '' }, m.parking),
      director: Object.assign(blankVip(), m.director), acCommander: Object.assign(blankVip(), m.acCommander),
      hospitality: Object.assign({ on: false, detail: '' }, m.hospitality),
      fuel: String(m.fuel || '').replace(/[^\d.]/g, ''),
      crew: (m.crew || []).map(c => Object.assign({ id: '', name: '', dept: '', role: '' }, c)),
    }));
    const out = Object.assign(blankOrder(), o, { duty, standby, missions });
    if (!out.noMission && !out.missions.length) out.missions = [blankMission()];
    return out;
  }
  function fmtFuel(f) { const n = Number(f); return f === '' || isNaN(n) ? String(f) : (Number.isInteger(n) ? n.toFixed(1) : String(f)); }
  function optionsHtml(list, cur) {
    return list.concat(cur && !list.includes(cur) ? [cur] : []).map(v => `<option ${v === cur ? 'selected' : ''}>${esc(v)}</option>`).join('');
  }
  function comparable(o) {
    o = clone(o || {}); delete o.aircraftSnapshot; delete o.schema; delete o.date;
    (o.missions || []).forEach(m => delete m.id);
    return JSON.stringify(o);
  }

  // ───────────────────────── UI helpers ─────────────────────────
  let spinTimer = null, spinCount = 0;
  function busy(on) {
    spinCount += on ? 1 : -1;
    clearTimeout(spinTimer);
    let el = $('#spinner');
    if (spinCount > 0) {
      spinTimer = setTimeout(() => {
        if (!$('#spinner')) { el = document.createElement('div'); el.id = 'spinner'; el.className = 'spinner'; el.innerHTML = '<div></div>'; document.body.appendChild(el); }
      }, 250);
    } else if (el) el.remove();
  }
  function toast(msg, err) {
    const el = document.createElement('div');
    el.className = 'toast' + (err ? ' err' : ''); el.textContent = msg; el.setAttribute('role', 'status');
    document.body.appendChild(el);
    setTimeout(() => el.remove(), err ? 5000 : 2600);
  }
  async function api(action, params, opts) {
    opts = opts || {};
    if (!opts.quiet) busy(true);
    try { return await API.call(action, params); }
    catch (e) {
      if (e.code === 'AUTH') { S.user = null; render(); toast(e.message, true); throw e; }
      if (e.code === 'MUST_CHANGE') { S.user.mustChange = true; render(); throw e; }
      if (!opts.silent) toast(e.message, true);
      throw e;
    } finally { if (!opts.quiet) busy(false); }
  }

  /** modal({title, body(html), foot:[{label, cls, act, value}]}) → Promise(value | null) */
  function modal(o) {
    return new Promise(resolve => {
      const bg = document.createElement('div');
      bg.className = 'modal-bg';
      bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true" aria-label="${esc(o.title)}">
        <div class="modal-head"><h3>${esc(o.title)}</h3><button class="btn icon ghost" data-close aria-label="ปิด">✕</button></div>
        <div class="modal-body">${o.body || ''}</div>
        ${o.foot ? `<div class="modal-foot">${o.foot.map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}">${esc(b.label)}</button>`).join('')}</div>` : ''}
      </div>`;
      const close = v => { bg.remove(); document.removeEventListener('keydown', onKey); resolve(v); };
      const onKey = e => { if (e.key === 'Escape') close(null); };
      document.addEventListener('keydown', onKey);
      bg.addEventListener('click', e => {
        if (e.target === bg || e.target.closest('[data-close]')) return close(null);
        const b = e.target.closest('[data-i]');
        if (b) {
          const spec = o.foot[Number(b.dataset.i)];
          if (spec.validate && !spec.validate(bg)) return;
          close(typeof spec.value === 'function' ? spec.value(bg) : spec.value);
        }
      });
      document.body.appendChild(bg);
      if (o.onOpen) o.onOpen(bg, close);
      const f = bg.querySelector('[autofocus]'); if (f) f.focus();
    });
  }
  const confirmBox = (title, text, okLabel, cls) =>
    modal({ title, body: `<p>${text}</p>`, foot: [{ label: 'ยกเลิก', cls: 'ghost', value: false }, { label: okLabel || 'ยืนยัน', cls: cls || 'primary', value: true }] });

  // ───────────────────────── Drafts (เก็บในเครื่อง ป้องกันข้อมูลหาย) ─────────────────────────
  const draftKey = d => 'fo602_draft_' + (S.user ? S.user.username : '') + '_' + d;
  let draftTimer = null;
  function markDirty() {
    S.dirty = true;
    const d = $('#dirtyFlag'); if (d) d.hidden = false;
    const t = document.querySelector(`.day-tab[data-d="${S.date}"] .dd`); if (t) t.hidden = false;
    clearTimeout(draftTimer);
    const date = S.date, base = S.meta && S.meta.exists ? S.meta.version : 0, order = S.order;
    draftTimer = setTimeout(() => {
      try { localStorage.setItem(draftKey(date), JSON.stringify({ base, order, at: Date.now() })); } catch (e) { /* storage full */ }
    }, 400);
  }
  function clearDraft(d) { localStorage.removeItem(draftKey(d || S.date)); }
  function clearAllDrafts() { Object.keys(localStorage).filter(k => k.startsWith('fo602_draft_')).forEach(k => localStorage.removeItem(k)); }

  // ───────────────────────── Holidays / ชุดวันหยุด ─────────────────────────
  function setHolidays(list) {
    S.holidays = list || [];
    S.holidayMap = {};
    S.holidays.forEach(h => S.holidayMap[h.date] = h.name);
  }
  function isWorking(d) { const w = parseKey(d).getDay(); return w !== 0 && w !== 6 && !S.holidayMap[d]; }
  function holidayName(d) { return S.holidayMap[d] || ([0, 6].includes(parseKey(d).getDay()) ? 'วันหยุด' : ''); }
  /** พรุ่งนี้ → จนถึงวันทำการถัดไป (ศ. → ส. อา. จ.) */
  function nextBatch(today) {
    let d = addDays(today, 1); const out = [d];
    while (!isWorking(d) && out.length < 14) { d = addDays(d, 1); out.push(d); }
    return { from: out[0], to: out[out.length - 1] };
  }

  // ───────────────────────── Data loading (หลายวัน) ─────────────────────────
  // S.days[date] = {date, meta, order, dirty, draftOffer}; วันที่กำลังแสดงถูกคัดลอกไว้ใน S.meta/S.order/S.dirty/S.draftOffer
  function setCrew(c) {
    S.crew = c || { people: [] };
    S.crewById = {};
    (S.crew.people || []).forEach(p => S.crewById[p.id] = p);
  }
  function dayFrom(r) {
    const d = { date: r.date, meta: r, order: null, dirty: false, draftOffer: null };
    if (r.exists && r.order) d.order = normalizeOrder(r.order);
    else d.order = can('editOrder') && !r.hidden ? blankOrder() : null;
    if (can('editOrder') && d.order && (!r.exists || r.status !== 'RELEASED')) {
      try {
        const dr = JSON.parse(localStorage.getItem(draftKey(r.date)) || 'null');
        if (dr && dr.order && comparable(dr.order) !== comparable(d.order)) {
          d.draftOffer = { stale: dr.base !== (r.exists ? r.version : 0), at: dr.at, order: dr.order };
        } else if (dr) clearDraft(r.date);
      } catch (e) { clearDraft(r.date); }
    }
    return d;
  }
  function stash() { const d = S.days[S.date]; if (d) Object.assign(d, { meta: S.meta, order: S.order, dirty: S.dirty, draftOffer: S.draftOffer }); }
  function loadActive() { const d = S.days[S.date]; if (d) Object.assign(S, { meta: d.meta, order: d.order, dirty: d.dirty, draftOffer: d.draftOffer }); }
  function activate(date) { stash(); S.date = date; loadActive(); }
  function putDay(r) { S.days[r.date] = dayFrom(r); if (r.date === S.date) loadActive(); }
  function setRange(res) {
    S.days = {};
    S.range = res.days.map(x => x.date);
    res.days.forEach(r => S.days[r.date] = dayFrom(r));
    if (!S.range.includes(S.date)) S.date = S.range[0];
    loadActive();
  }
  function dayList() { stash(); return S.range.map(d => S.days[d]); }
  function anyDirty() { return dayList().some(d => d.dirty) || !!S.acEdit; }
  function statusOf(d) { return d.meta && d.meta.exists ? d.meta.status : 'NEW'; }
  function dayEditable(d) { return can('editOrder') && d.order && statusOf(d) !== 'RELEASED' && !(d.meta && d.meta.hidden); }

  async function bootstrap(range) {
    const r = await api('bootstrap', range || {});
    S.user = r.user; S.settings = r.settings || S.settings;
    if (r.today) S.today = r.today;
    if (!r.user.mustChange) {
      S.aircraft = r.aircraft; setCrew(r.crew); setHolidays(r.holidays);
      setRange(r.range);
      if (r.crew && r.crew.error) toast('โหลดรายชื่อนักบินไม่สำเร็จ: ' + r.crew.error, true);
    }
    render();
  }
  async function loadRange(from, to, keepDate) {
    if (anyDirty()) toast('ร่างที่ยังไม่บันทึกถูกเก็บไว้ในเครื่องนี้');
    const r = await api('getRange', { from, to: to || from });
    if (keepDate) S.date = keepDate;
    setRange(r);
    renderView();
  }
  const reloadRange = () => loadRange(S.range[0], S.range[S.range.length - 1], S.date);
  async function refreshAircraft() { S.aircraft = await api('getAircraft', {}, { quiet: true }); }

  // ───────────────────────── Render root ─────────────────────────
  const app = () => $('#app');
  function render() {
    if (!S.user) return renderLogin();
    if (S.user.mustChange) return renderChangePassword(true);
    renderShell();
  }

  async function renderLogin(err) {
    app().innerHTML = `<div class="login-wrap"><div class="login-card">
      <div class="brand"><div class="brand-mark">602</div><div><h1>ระบบใบจัดบิน</h1><p>ฝูงบิน 602 กองบิน 6</p></div></div>
      <form id="loginForm" autocomplete="on">
        <label class="field"><span>ชื่อผู้ใช้</span><input name="username" autocomplete="username" autocapitalize="none" required autofocus></label>
        <label class="field"><span>รหัสผ่าน</span><input name="password" type="password" autocomplete="current-password" required></label>
        <div class="form-error" id="loginErr">${esc(err || '')}</div>
        <button class="btn primary" type="submit">เข้าสู่ระบบ</button>
      </form>
      ${API.DEMO ? `<div class="demo-box"><b>โหมดทดลอง</b> — ข้อมูลเก็บในเบราว์เซอร์นี้เท่านั้น รายชื่อเป็นชื่อสมมติ<div class="row" id="demoUsers"></div></div>` : ''}
    </div></div>`;
    const form = $('#loginForm');
    form.onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(form);
      await doLogin(String(fd.get('username')), String(fd.get('password')));
    };
    if (API.DEMO) {
      const users = await API.demoUsers();
      $('#demoUsers').innerHTML = users.map(u => `<button class="btn sm ghost" data-u="${esc(u.username)}" data-p="${esc(u.password)}">${esc(ROLE_LABEL[u.role])}</button>`).join('');
      $('#demoUsers').onclick = e => { const b = e.target.closest('[data-u]'); if (b) doLogin(b.dataset.u, b.dataset.p); };
    }
  }
  async function doLogin(username, password) {
    const errEl = $('#loginErr');
    try {
      busy(true);
      const r = await API.call('login', { username, password });
      API.setToken(r.token);
      S.user = r.user;
      await bootstrap();
    } catch (e) {
      if (errEl) errEl.textContent = e.message;
    } finally { busy(false); }
  }

  function renderChangePassword(forced) {
    const html = `<form id="pwForm" class="grid">
        ${forced ? '<div class="banner warn">กรุณาตั้งรหัสผ่านใหม่ก่อนเริ่มใช้งาน</div>' : ''}
        <label class="field"><span>รหัสผ่านปัจจุบัน${forced ? ' (รหัสชั่วคราว)' : ''}</span><input name="old" type="password" autocomplete="current-password" required></label>
        <label class="field"><span>รหัสผ่านใหม่ (อย่างน้อย 8 ตัวอักษร)</span><input name="new1" type="password" autocomplete="new-password" minlength="8" required></label>
        <label class="field"><span>ยืนยันรหัสผ่านใหม่</span><input name="new2" type="password" autocomplete="new-password" minlength="8" required></label>
        <div class="form-error" id="pwErr"></div>
        <button class="btn primary" type="submit">เปลี่ยนรหัสผ่าน</button>
        ${forced ? '<button class="btn ghost" type="button" id="pwLogout">ออกจากระบบ</button>' : ''}
      </form>`;
    const wire = (root, done) => {
      const f = $('#pwForm', root);
      f.onsubmit = async e => {
        e.preventDefault();
        const fd = new FormData(f), err = $('#pwErr', root);
        if (fd.get('new1') !== fd.get('new2')) { err.textContent = 'รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน'; return; }
        try {
          busy(true);
          await API.call('changePassword', { oldPassword: fd.get('old'), newPassword: fd.get('new1') });
          const r = await API.call('login', { username: S.user.username, password: fd.get('new1') });
          API.setToken(r.token);
          toast('เปลี่ยนรหัสผ่านเรียบร้อย');
          if (done) done();
          await bootstrap();
        } catch (e2) { err.textContent = e2.message; } finally { busy(false); }
      };
      const lo = $('#pwLogout', root); if (lo) lo.onclick = logout;
    };
    if (forced) {
      app().innerHTML = `<div class="login-wrap"><div class="login-card"><div class="brand"><div class="brand-mark">602</div><div><h1>ตั้งรหัสผ่านใหม่</h1><p>${esc(S.user.displayName)}</p></div></div>${html}</div></div>`;
      wire(app());
    } else {
      modal({ title: 'เปลี่ยนรหัสผ่าน', body: html, onOpen: (bg, close) => wire(bg, () => close(null)) });
    }
  }

  async function logout() {
    if (anyDirty() && !(await confirmBox('ออกจากระบบ', 'มีการแก้ไขที่ยังไม่บันทึก ต้องการออกจากระบบหรือไม่? (ร่างจะถูกลบจากเครื่องนี้)', 'ออกจากระบบ', 'bad'))) return;
    try { await API.call('logout', {}); } catch (e) { /* ignore */ }
    API.setToken(''); clearAllDrafts();
    Object.assign(S, { user: null, crew: { people: [] }, crewById: {}, meta: null, order: null, dirty: false, draftOffer: null, days: {}, range: [todayKey()], users: null, acEdit: null, stats: Object.assign(S.stats, { data: null }) });
    render();
  }

  // ───────────────────────── Shell ─────────────────────────
  function tabsFor() {
    const t = [['order', '📋', 'ใบจัดบิน'], ['aircraft', '✈️', 'สถานภาพ บ.'], ['history', '🗂️', 'ย้อนหลัง'], ['stats', '📊', 'สถิติ']];
    if (can('manageUsers')) t.push(['users', '👥', 'ผู้ใช้']);
    if (can('settings')) t.push(['settings', '⚙️', 'ตั้งค่า']);
    return t;
  }
  function renderShell() {
    const u = S.user;
    app().innerHTML = `
      <header class="topbar">
        <div class="brand-mark">602</div>
        <div class="title">ใบจัดบิน<small>ฝูงบิน 602 กองบิน 6</small></div>
        <button class="user-btn" id="userBtn" aria-haspopup="menu">
          <span class="avatar">${esc((u.displayName || u.username).replace(/^(?:[^\s.]{1,4}\.)+(?:หญิง)?\s*/, '').trim().charAt(0) || 'U')}</span>
          <span><span class="name">${esc(u.displayName)}</span><span class="role">${esc(ROLE_LABEL[u.role])}</span></span>
        </button>
      </header>
      ${API.DEMO ? '<div class="demo-banner">โหมดทดลอง — ข้อมูลอยู่ในเบราว์เซอร์นี้เท่านั้น ใช้ชื่อสมมติ</div>' : ''}
      <nav class="tabs" role="tablist">${tabsFor().map(([k, i, l]) =>
        `<button role="tab" data-act="tab" data-tab="${k}" class="${S.tab === k ? 'active' : ''}" aria-selected="${S.tab === k}"><span class="ico" aria-hidden="true">${i}</span>${l}</button>`).join('')}</nav>
      <main class="view" id="view"></main>
      <div class="menu" id="menu" role="menu" hidden>
        <div class="small muted" style="padding:6px 12px">${esc(u.username)} · ${esc(ROLE_LABEL[u.role])}<br>เวอร์ชัน ${APP_VERSION}</div>
        <button data-act="change-pw">🔑 เปลี่ยนรหัสผ่าน</button>
        <button data-act="refresh-crew">↻ โหลดรายชื่อนักบินล่าสุด</button>
        ${API.DEMO ? '<button data-act="demo-reset">🧪 รีเซ็ตข้อมูลทดลอง</button>' : ''}
        <button data-act="logout">⎋ ออกจากระบบ</button>
      </div>`;
    $('#userBtn').onclick = e => { e.stopPropagation(); $('#menu').hidden = !$('#menu').hidden; };
    renderView();
  }
  document.addEventListener('click', e => { const m = $('#menu'); if (m && !m.hidden && !e.target.closest('#menu')) m.hidden = true; });

  function renderView() {
    const v = $('#view'); if (!v) return;
    document.querySelectorAll('.tabs button').forEach(b => { b.classList.toggle('active', b.dataset.tab === S.tab); b.setAttribute('aria-selected', b.dataset.tab === S.tab); });
    ({ order: viewOrder, aircraft: viewAircraft, history: viewHistory, stats: viewStats, users: viewUsers, settings: viewSettings }[S.tab] || viewOrder)(v);
  }

  // ───────────────────────── Order view ─────────────────────────
  function orderStatus() { return statusOf({ meta: S.meta }); }
  function editable() { return dayEditable({ order: S.order, meta: S.meta }); }

  const DOW_S = ['อา.', 'จ.', 'อ.', 'พ.', 'พฤ.', 'ศ.', 'ส.'];
  function dayShort(k) { const d = parseKey(k); return DOW_S[d.getDay()] + ' ' + d.getDate() + ' ' + MONTHS_S[d.getMonth()]; }
  function rangeLabel() {
    const a = S.range[0], b = S.range[S.range.length - 1];
    return a === b ? thaiDate(a) : dayShort(a) + ' – ' + dayShort(b) + ' ' + (parseKey(b).getFullYear() + 543) + ' (' + S.range.length + ' วัน)';
  }
  /** สรุปสถานะทั้งชุด สำหรับเปิด/ปิดปุ่มระดับชุด */
  function batchInfo() {
    const days = dayList(), c = { NEW: 0, DRAFT: 0, PENDING: 0, APPROVED: 0, DENIED: 0, RELEASED: 0 };
    days.forEach(d => c[statusOf(d)]++);
    const existing = days.filter(d => d.meta && d.meta.exists && !d.meta.hidden);
    return {
      days, c, multi: days.length > 1,
      dirty: days.some(d => d.dirty),
      toSave: days.filter(d => dayEditable(d) && (d.dirty || !(d.meta && d.meta.exists))),
      submittable: can('editOrder') && c.NEW === 0 && (c.DRAFT + c.DENIED) > 0,
      approvable: can('approve') && c.NEW === 0 && c.DRAFT === 0 && c.PENDING > 0,
      deniable: can('approve') && c.NEW === 0 && c.DRAFT === 0 && (c.PENDING + c.APPROVED) > 0,
      releasable: can('release') && c.NEW === 0 && c.DRAFT === 0 && c.PENDING === 0 && c.DENIED === 0 && c.APPROVED > 0,
      items: st => existing.filter(d => st.includes(d.meta.status)).map(d => ({ date: d.date, version: d.meta.version })),
      printable: days.filter(d => d.order && !(d.meta && d.meta.hidden) && (d.meta.exists || d.dirty)),
    };
  }

  function viewOrder(v) {
    const b = batchInfo(), st = orderStatus(), m = S.meta || {};
    const sfx = b.multi ? 'ทั้งชุด' : '';
    const summary = Object.keys(b.c).filter(k => b.c[k]).map(k => `<span class="chip ${k}">${esc(STATUS_LABEL[k])} ${b.multi ? b.c[k] : ''}</span>`).join(' ');
    let batchBanner = '';
    const thing = b.multi ? 'ชุดใบจัดบินนี้' : 'ใบจัดบินนี้';
    if (can('approve') && !can('editOrder') && (b.c.DRAFT || b.c.NEW)) {
      batchBanner = `<div class="banner warn">${thing}ผู้จัดบินยังจัดทำไม่เสร็จ${b.multi ? ` (${b.c.DRAFT + b.c.NEW} วัน)` : ''} — จะพิจารณาได้เมื่อผู้จัดบินกด "ส่งขออนุมัติ"</div>`;
    } else if (can('approve') && !can('editOrder') && b.c.PENDING) {
      batchBanner = `<div class="banner warn">${thing}ส่งขออนุมัติแล้ว รอการพิจารณาของท่าน</div>`;
    }
    if (can('editOrder') && b.c.DRAFT + b.c.DENIED) {
      batchBanner += `<div class="banner info">${thing}ยังเป็นร่าง — ผู้บังคับบัญชาจะพิจารณาได้เมื่อกด <b>📨 ส่งขออนุมัติ</b>${b.c.NEW ? ` (ต้องบันทึกให้ครบทุกวันก่อน)` : ''}</div>`;
    } else if (can('editOrder') && b.c.PENDING && !b.c.APPROVED) {
      batchBanner += `<div class="banner info">ส่งขออนุมัติแล้ว — รอผู้บังคับบัญชาพิจารณา (ถ้าแก้ไขอีก จะกลับเป็นร่างและต้องส่งใหม่)</div>`;
    }
    if (b.multi && can('release') && b.c.APPROVED && !b.releasable && b.c.NEW + b.c.DRAFT + b.c.PENDING + b.c.DENIED) {
      batchBanner += `<div class="banner info">Release ทั้งชุดได้เมื่อทุกวันในชุดได้รับอนุมัติแล้ว</div>`;
    }

    const actions = [];
    if (b.toSave.length || (can('editOrder') && b.days.some(dayEditable))) {
      actions.push(`<button class="btn primary" data-act="save">💾 บันทึก${b.multi ? 'ทั้งชุด' : ''}</button>`);
    }
    if (b.printable.length) actions.push(`<button class="btn ghost" data-act="print-all">🖨️ พิมพ์ / PDF${b.multi ? ' (' + b.printable.length + ' วัน)' : ''}</button>`);
    actions.push('<span class="sep"></span>');
    if (b.submittable) actions.push(`<button class="btn rel" data-act="submit">📨 ส่งขออนุมัติ${sfx}</button>`);
    if (b.approvable) actions.push(`<button class="btn ok" data-act="approve">✔ อนุมัติ${sfx}</button>`);
    if (b.deniable) actions.push(`<button class="btn bad" data-act="deny">✖ ไม่อนุมัติ${sfx}</button>`);
    if (b.releasable) actions.push(`<button class="btn rel" data-act="release">🚀 Release${sfx}</button>`);

    const tabs = b.multi ? `<div class="day-tabs" role="tablist">${b.days.map(d => {
      const s = statusOf(d), hn = holidayName(d.date);
      return `<button class="day-tab ${d.date === S.date ? 'on' : ''}" role="tab" aria-selected="${d.date === S.date}" data-act="day-tab" data-d="${d.date}">
        <b>${esc(dayShort(d.date))}</b><span class="hn">${esc(hn || 'วันทำการ')}</span>
        <span class="chip ${s}">${esc(STATUS_LABEL[s])}</span><span class="dd" ${d.dirty ? '' : 'hidden'}><span class="dirty-dot"></span>แก้ไข</span></button>`;
    }).join('')}</div>` : '';

    let banners = '';
    if (S.draftOffer) {
      banners += `<div class="banner warn">พบร่างที่ยังไม่บันทึกในเครื่องนี้ (${esc(thaiTs(ymd(new Date(S.draftOffer.at)) + ' ' + new Date(S.draftOffer.at).toTimeString().slice(0, 5)))})
        ${S.draftOffer.stale ? '— <b>มีผู้อื่นบันทึกใบนี้หลังจากร่างของคุณ</b> ตรวจให้ดีก่อนกู้คืน' : ''}
        <div class="row" style="margin-top:6px"><button class="btn sm" data-act="draft-restore">กู้คืนร่าง</button><button class="btn sm ghost" data-act="draft-discard">ทิ้งร่าง</button></div></div>`;
    }
    if (st === 'DENIED') banners += `<div class="banner bad"><b>ไม่อนุมัติ</b> โดย ${esc(m.approvedBy)} · ${esc(thaiTs(m.approvedAt))}<br>เหตุผล: ${esc(m.denyReason)}</div>`;
    if (st === 'APPROVED') banners += `<div class="banner ok"><b>อนุมัติแล้ว</b> โดย ${esc(m.approvedBy)} · ${esc(thaiTs(m.approvedAt))}</div>`;
    if (st === 'RELEASED') banners += `<div class="banner info"><b>Release แล้ว</b> โดย ${esc(m.releasedBy)} · ${esc(thaiTs(m.releasedAt))} — ใบนี้ถูกล็อก${can('release') ? ' (กด "เปิดแก้ไข" หากต้องแก้)' : ''}</div>`;
    if (m.hidden) banners += `<div class="banner warn">ใบจัดบินวันนี้ยังไม่ release — จะแสดงเมื่อผ่านการอนุมัติและ release แล้ว</div>`;
    if (st === 'NEW' && !can('editOrder')) banners += `<div class="banner warn">ยังไม่มีใบจัดบินของวันนี้</div>`;

    const dayActs = [];
    if (editable()) {
      dayActs.push(`<button class="btn sm ghost" data-act="copy-prev">📄 คัดลอกจากวันก่อน</button>`);
      dayActs.push(`<button class="btn sm ghost" data-act="blank">🧹 ล้างเป็นหน้าว่าง</button>`);
    }
    if (b.multi && S.order && !m.hidden && (m.exists || S.dirty)) dayActs.push(`<button class="btn sm ghost" data-act="print-day">🖨️ พิมพ์เฉพาะวันนี้</button>`);
    if (can('release') && st === 'RELEASED') dayActs.push(`<button class="btn sm ghost" data-act="revise">✏️ เปิดแก้ไขวันนี้</button>`);
    if (can('deleteOrder') && st !== 'NEW') dayActs.push(`<button class="btn sm danger-ghost" data-act="delete">ลบวันนี้</button>`);

    v.innerHTML = `
      <section class="card">
        <div class="datebar">
          <button class="btn icon ghost" data-act="day" data-n="-1" aria-label="วันก่อนหน้า">◀</button>
          <label class="row small" style="gap:4px">ตั้งแต่ <input type="date" id="rFrom" value="${esc(S.range[0])}" aria-label="วันที่เริ่ม"></label>
          <label class="row small" style="gap:4px">ถึง <input type="date" id="rTo" value="${esc(S.range[S.range.length - 1])}" aria-label="วันที่สิ้นสุด"></label>
          <button class="btn icon ghost" data-act="day" data-n="1" aria-label="วันถัดไป">▶</button>
          <button class="btn sm ghost" data-act="today">วันนี้</button>
          ${can('editOrder') ? `<button class="btn sm" data-act="next-batch" title="พรุ่งนี้จนถึงวันทำการถัดไป">📅 ชุดถัดไป</button>` : ''}
        </div>
        <div class="thai-date" style="margin-top:8px">${esc(rangeLabel())}</div>
        <div class="row" style="margin-top:6px">${summary}</div>
        ${batchBanner}
        <div class="actions">${actions.join('')}</div>
        ${tabs}
      </section>
      <section class="card day-card">
        <div class="row">
          <div class="grow"><div class="thai-date">${esc(thaiDate(S.date))}${holidayName(S.date) ? ` <span class="chip NEW">${esc(holidayName(S.date))}</span>` : ''}</div>
            ${m.exists ? `<div class="meta-line">Rev.${esc(m.revision)} · บันทึกล่าสุดโดย ${esc(m.updatedBy)} · ${esc(thaiTs(m.updatedAt))}</div>` : ''}</div>
          <span class="chip ${st}">${esc(STATUS_LABEL[st])}</span>
          <span id="dirtyFlag" class="small" style="color:var(--warn)" ${S.dirty ? '' : 'hidden'}><span class="dirty-dot"></span>ยังไม่บันทึก</span>
        </div>
        ${banners}
        ${dayActs.length ? `<div class="actions">${dayActs.join('')}</div>` : ''}
      </section>
      ${editable() ? editorHtml() : (S.order && !m.hidden ? `<section class="card"><div class="doc-wrap">${docHtml(activeDay())}</div></section>` : '')}
      ${m.exists && m.log && m.log.length ? logHtml(m.log) : ''}`;
    $('#rFrom').onchange = e => { const f = e.target.value; if (!f) return; let t = $('#rTo').value; if (!t || t < f) t = f; loadRange(f, t, f).catch(() => {}); };
    $('#rTo').onchange = e => { const t = e.target.value; if (!t) return; let f = $('#rFrom').value; if (!f || f > t) f = t; loadRange(f, t).catch(() => {}); };
  }
  function activeDay() { return { date: S.date, order: S.order, meta: S.meta, dirty: S.dirty }; }

  function logHtml(log) {
    const L = { create: 'สร้าง', edit: 'แก้ไข', submit: 'ส่งขออนุมัติ', approve: 'อนุมัติ', deny: 'ไม่อนุมัติ', release: 'Release', revise: 'เปิดแก้ไข' };
    return `<section class="card"><details><summary class="card-head" style="cursor:pointer;margin:0"><h2>ประวัติการดำเนินการของวันนี้ (${log.length})</h2></summary>
      <ul class="log" style="margin-top:8px">${log.slice().reverse().map(l => `<li><span class="muted">${esc(thaiTs(l.at))}</span>
      <span><b>${esc(L[l.action] || l.action)}</b> · ${esc(l.by)}${l.note ? ' — ' + esc(l.note) : ''}</span></li>`).join('')}</ul></details></section>`;
  }

  // ───── Editor ─────
  function personField(path, label, p, opts) {
    opts = opts || {};
    return `<div class="field"><span>${esc(label)}</span>
      <div class="person"><input class="input" data-bind="${path}.name" value="${esc(p.name)}" placeholder="พิมพ์หรือเลือกจากรายชื่อ">
      <button class="btn icon ghost" data-act="pick-duty" data-path="${path}" ${opts.tk ? `data-tk="${esc(opts.tk)}"` : ''} aria-label="เลือก${esc(label)}จากรายชื่อ">👤</button>
      ${opts.rm ? `<button class="btn icon danger-ghost" data-act="person-rm" data-list="${opts.rm[0]}" data-i="${opts.rm[1]}" aria-label="ลบ${esc(label)}">✕</button>` : ''}</div>
      ${opts.phone ? `<input class="input" style="margin-top:4px" data-bind="${path}.phone" value="${esc(p.phone)}" placeholder="เบอร์ติดต่อ" inputmode="tel">` : ''}</div>`;
  }
  function multiField(key) {
    const [label, max] = DUTY_MULTI[key], list = S.order.duty[key];
    const hint = key === 'schedulers' ? `<div class="small muted">เข้าเวรตามวันที่ของใบจัดบินนี้ (${esc(thaiDate(S.date))}) — ไม่ต้องใส่เบอร์</div>` : '';
    return `<div class="multi"><div class="multi-head"><b>${esc(label)}</b> <span class="muted small">(สูงสุด ${max} คน)</span>${hint}</div>
      ${list.map((p, i) => personField(`duty.${key}.${i}`, label + ' คนที่ ' + (i + 1), p, { rm: list.length > 1 ? [`duty.${key}`, i] : null })).join('')}
      ${list.length < max ? `<button class="btn sm ghost" data-act="person-add" data-list="duty.${key}" data-max="${max}">＋ เพิ่ม${esc(label)}</button>` : ''}</div>`;
  }
  function refuelOptions() {
    const ri = Number(S.order.duty.refuelIdx);
    return `<option value="-1">— ไม่มีในวันนี้ —</option>` + S.order.duty.documents.map((p, i) => p.name ? `<option value="${i}" ${ri === i ? 'selected' : ''}>${esc(p.name)}</option>` : '').join('');
  }
  function inp(path, label, val, attrs, cls) {
    return `<label class="field ${cls || ''}"><span>${esc(label)}</span><input data-bind="${path}" value="${esc(val)}" ${attrs || ''}></label>`;
  }
  function parkingField(i, k, label, val) {
    const path = `missions.${i}.parking.${k}`;
    const other = (val && !PARKING.includes(val)) || parkingOther.has(S.date + '|' + path);
    return `<div class="field"><span>${esc(label)}</span>
      <select data-parking="${path}"><option value="">— เลือก —</option>
        ${PARKING.map(p => `<option ${!other && p === val ? 'selected' : ''}>${esc(p)}</option>`).join('')}
        <option value="__other" ${other ? 'selected' : ''}>อื่น ๆ</option></select>
      ${other ? `<input style="margin-top:4px" data-bind="${path}" value="${esc(val)}" placeholder="ระบุจุดจอด" maxlength="200">` : ''}</div>`;
  }
  function vipBlock(i, key, label, v) {
    const miss = f => v.on && !String(v[f]).trim() ? 'missing' : '';
    return `<div class="vip ${v.on ? 'on' : ''}"><label class="row"><input type="checkbox" data-bool="missions.${i}.${key}.on" ${v.on ? 'checked' : ''}> มี ${esc(label)}</label>
      ${v.on ? `<div class="grid g3" style="margin-top:6px">
        ${inp(`missions.${i}.${key}.name`, 'ชื่อ *', v.name, '', miss('name'))}
        ${inp(`missions.${i}.${key}.position`, 'ตำแหน่ง *', v.position, '', miss('position'))}
        ${inp(`missions.${i}.${key}.phone`, 'เบอร์โทร. *', v.phone, 'inputmode="tel"', miss('phone'))}</div>` : ''}</div>`;
  }
  function dupMap() {
    const map = {};
    (S.order.missions || []).forEach((m, i) => m.crew.forEach(c => { if (c.id) (map[c.id] = map[c.id] || []).push(i + 1); }));
    return map;
  }
  function acSummaryHtml(list) {
    return list.length ? `<div class="tbl-wrap"><table class="tbl cards"><thead><tr><th>เครื่อง / แบบ</th><th>สถานะ</th><th>ข้อขัดข้อง / รายละเอียด</th><th>Plan Check</th></tr></thead><tbody>
      ${list.map(a => `<tr><td data-k="เครื่อง">${esc(a.tail)} / ${esc(a.type)}</td><td data-k="สถานะ"><span class="ac-status ${esc(a.status)}">${esc(a.status)}</span></td>
        <td data-k="รายละเอียด">${esc(a.detail)}</td><td data-k="Plan Check">${esc(a.planCheck)}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted">ยังไม่มีข้อมูลเครื่องบิน</p>';
  }
  function editorHtml() {
    const o = S.order, dups = dupMap();
    const acList = S.aircraft.list || [];

    const missions = o.missions.map((m, i) => {
      const tk = typeKey(m.aircraftType);
      const acOpts = acList.slice();
      if (m.aircraftTail && !acOpts.some(a => a.tail === m.aircraftTail)) acOpts.push({ tail: m.aircraftTail, type: m.aircraftType, designation: '', status: '' });
      const crew = m.crew.map((c, j) => {
        const p = S.crewById[c.id];
        const otherMissions = (dups[c.id] || []).filter(n => n !== i + 1);
        const qual = p && p.quals && p.quals[tk];
        return `<div class="crew-row">
          <span class="n">${j + 1}.</span>
          <select class="role" data-bind="missions.${i}.crew.${j}.role" aria-label="หน้าที่ของ ${esc(c.name)}">
            <option value="">— หน้าที่ —</option>${optionsHtml(PILOT_ROLES, c.role)}
          </select>
          <span class="nm">${esc(c.name)}<small>${p ? esc([p.rank, p.first, p.last].join(' ').trim()) : ''}</small></span>
          <span class="flags row" style="gap:4px">
            ${otherMissions.length ? `<span class="dup" title="ชื่อนี้อยู่ในภารกิจอื่นด้วย">ซ้ำ ภ.${otherMissions.join(',')}</span>` : ''}
            ${qual && qual.pass.length ? `<span class="q" title="คุณสมบัติบน ${esc(tk)}">${esc(qual.pass.join(' '))}</span>` : ''}
            ${j > 0 ? `<button class="btn sm ghost" data-act="crew-up" data-m="${i}" data-c="${j}" aria-label="เลื่อนขึ้น">↑</button>` : ''}</span>
          <button class="rm" data-act="crew-rm" data-m="${i}" data-c="${j}" aria-label="ลบ ${esc(c.name)}">✕</button>
        </div>`;
      }).join('');
      return `<article class="mission" id="mission-${i}">
        <div class="mission-head">
          <span class="num">ภารกิจที่ ${i + 1}</span>
          <select data-act-change="aircraft" data-m="${i}" aria-label="เครื่องบินของภารกิจที่ ${i + 1}">
            <option value="">— เลือกเครื่องบิน —</option>
            ${acOpts.map(a => `<option value="${esc(a.tail)}" ${a.tail === m.aircraftTail ? 'selected' : ''}>${esc(aircraftLabel(a))}${a.status && a.status !== 'FMC' ? ' · ' + esc(a.status) : ''}</option>`).join('')}
          </select>
          <button class="x" data-act="mission-rm" data-m="${i}" aria-label="ลบภารกิจที่ ${i + 1}" title="ลบภารกิจนี้">✕</button>
        </div>
        <div class="mission-body">
          <div class="grid g4 keep2">
            <label class="field"><span>ประเภท</span><select data-bind="missions.${i}.type">${optionsHtml(MISSION_TYPES, m.type)}</select></label>
            ${inp(`missions.${i}.callsign`, 'Callsign', m.callsign, 'autocapitalize="characters"')}
            <label class="field"><span>เชื้อเพลิง</span><span class="suffix"><input type="number" inputmode="decimal" step="0.1" min="0" data-bind="missions.${i}.fuel" value="${esc(m.fuel)}" placeholder="9.0"><em>TONS</em></span></label>
            ${inp(`missions.${i}.pax`, 'ผู้โดยสาร', m.pax, 'placeholder="เช่น 15/-"')}
          </div>
          <div class="grid g2">
            <label class="field"><span>บ.จริง / บ.สำรอง</span><select data-bind="missions.${i}.acRole" data-rerender>
              <option value="" ${!m.acRole ? 'selected' : ''}>— ไม่ระบุ —</option>
              <option value="primary" ${m.acRole === 'primary' ? 'selected' : ''}>ภารกิจนี้เป็น บ.จริง</option>
              <option value="spare" ${m.acRole === 'spare' ? 'selected' : ''}>ภารกิจนี้เป็น บ.สำรอง</option></select></label>
            ${m.acRole ? inp(`missions.${i}.pairLabel`, m.acRole === 'primary' ? 'บ.สำรอง คือเครื่อง' : 'เป็น บ.สำรองของ บ.จริง เครื่อง', m.pairLabel || m.pairTail,
              'placeholder="เช่น A340 (60204) หรือ บ.ของฝูงบินอื่น" maxlength="120"') : '<span></span>'}
          </div>
          <label class="field"><span>ภารกิจ</span><textarea data-bind="missions.${i}.title" rows="2">${esc(m.title)}</textarea></label>
          ${inp(`missions.${i}.route`, 'เส้นทางบิน', m.route, 'placeholder="เช่น บน.6 – บน.23 – บน.6"')}
          <div class="grid g3 keep2">
            ${inp(`missions.${i}.times.brief`, 'เวลา Brief', m.times.brief, 'inputmode="numeric" placeholder="0640" maxlength="5" data-time')}
            <div class="field"><select class="mini" data-bind="missions.${i}.times.towMode" aria-label="เลือกเวลาลากหรือ TAXI">
                <option value="tow" ${m.times.towMode !== 'taxi' ? 'selected' : ''}>เวลาลาก</option><option value="taxi" ${m.times.towMode === 'taxi' ? 'selected' : ''}>เวลา TAXI</option></select>
              <input data-bind="missions.${i}.times.tow" value="${esc(m.times.tow)}" inputmode="numeric" placeholder="0650" maxlength="5" data-time aria-label="เวลาลาก หรือ TAXI"></div>
            ${inp(`missions.${i}.times.takeoff`, 'เวลาวิ่งขึ้น', m.times.takeoff, 'placeholder="0730 หรือ เมื่อได้รับการประสาน" maxlength="100"')}
          </div>
          <div class="grid g2">
            ${parkingField(i, 'out', 'จุดจอดขาไป', m.parking.out)}
            ${parkingField(i, 'ret', 'จุดจอดขากลับ', m.parking.ret)}
          </div>
          <div class="grid g2">${vipBlock(i, 'director', 'ผอ.เดินทาง', m.director)}${vipBlock(i, 'acCommander', 'ผู้บังคับ บ.', m.acCommander)}</div>
          <div class="vip ${m.hospitality.on ? 'on' : ''}"><label class="row"><input type="checkbox" data-bool="missions.${i}.hospitality.on" ${m.hospitality.on ? 'checked' : ''}> มีจัดรับรอง</label>
            ${m.hospitality.on ? `<label class="field" style="margin-top:6px"><span>รายละเอียดการจัดรับรอง</span><textarea data-bind="missions.${i}.hospitality.detail" rows="2" placeholder="เช่น สถานที่ เวลา จำนวนผู้รับรอง ผู้ประสาน">${esc(m.hospitality.detail)}</textarea></label>` : ''}</div>
          <div class="subhead">นักบิน (${m.crew.length})</div>
          <div class="crew-list">${crew || '<div class="muted small">ยังไม่มีนักบิน</div>'}</div>
          <div><button class="btn sm" data-act="pick-crew" data-m="${i}">＋ เพิ่มนักบิน</button></div>
          <div class="grid g2">
            ${inp(`missions.${i}.poc`, 'POC', m.poc)}
            <label class="field"><span>การแต่งกาย</span><select data-bind="missions.${i}.dress"><option value="">— เลือก —</option>${optionsHtml(DRESS, m.dress)}</select></label>
          </div>
          <label class="field"><span>หมายเหตุภารกิจ</span><textarea data-bind="missions.${i}.notes" rows="3">${esc(m.notes)}</textarea></label>
        </div>
      </article>`;
    }).join('');

    const stby = STBY_TYPES.map(([k, label, n, tk]) => {
      const x = o.standby[k];
      return `<div class="stby ${x.on ? 'on' : ''}"><label class="row stby-head"><input type="checkbox" data-bool="standby.${k}.on" ${x.on ? 'checked' : ''}>
        <b>${esc(label)}</b> <span class="muted small">(${n} คน)</span></label>
        ${x.on ? `<div class="grid g3" style="margin-top:6px">${x.pilots.map((p, j) => personField(`standby.${k}.pilots.${j}`, 'คนที่ ' + (j + 1), p, { tk })).join('')}</div>` : ''}</div>`;
    }).join('');

    return `
      <section class="card">
        <div class="card-head"><h2>น.จัดบินผู้จัดทำใบ (ติดต่อ)</h2><span class="muted small">น.จัดบินที่เข้าเวรในวันที่จัดทำใบนี้ — ชื่อและเบอร์แสดงเป็นผู้ติดต่อในใบ</span></div>
        <div class="grid g2">${personField('duty.contact', 'ชื่อผู้จัดทำ', o.duty.contact)}
          <label class="field"><span>เบอร์ติดต่อ</span><input data-bind="duty.contact.phone" value="${esc(o.duty.contact.phone)}" inputmode="tel" placeholder="08x-xxx-xxxx"></label></div>
      </section>
      <section class="card">
        <div class="card-head"><h2>ข้อมูลเวรและผู้รับผิดชอบ</h2></div>
        <div class="grid g3">${DUTY_SINGLE.map(([k, l]) => personField('duty.' + k, l, o.duty[k])).join('')}</div>
        <div class="grid g2" style="margin-top:12px">${multiField('schedulers')}${multiField('documents')}</div>
        <div class="grid g2" style="margin-top:12px">
          <label class="field"><span>น.ควบคุมการถ่าย ชพ. (เลือกจาก น.เอกสาร)</span><select data-bind="duty.refuelIdx" data-refuel>${refuelOptions()}</select></label>
        </div>
      </section>
      <section class="card">
        <div class="card-head"><h2>นบ.STBY</h2><span class="muted small">ติ๊กเฉพาะประเภทที่มี — ที่ไม่ติ๊กจะไม่แสดงในใบจัดบิน</span></div>
        ${stby}
      </section>
      <section class="card">
        <div class="card-head"><h2>สถานภาพเครื่องบิน</h2><span class="spacer"></span><button class="btn sm ghost" data-act="tab" data-tab="aircraft">แก้ไขในแท็บสถานภาพ →</button></div>
        ${acSummaryHtml(acList)}
      </section>
      <section class="card">
        <div class="card-head"><h2>รายละเอียดภารกิจ</h2><span class="spacer"></span><span class="chip">${o.missions.length} ภารกิจ</span></div>
        <label class="no-mission"><input type="checkbox" data-act-change="no-mission" ${o.noMission ? 'checked' : ''}> ไม่มีภารกิจในวันนี้</label>
        ${o.noMission ? '' : missions}
        ${o.noMission ? '' : '<button class="btn add-mission" data-act="mission-add">＋ เพิ่มภารกิจ</button>'}
      </section>
      <section class="card">
        <label class="field"><span>หมายเหตุทั่วไป</span><textarea data-bind="remarks" rows="3">${esc(o.remarks)}</textarea></label>
      </section>
      <div class="actions" style="margin-bottom:12px"><button class="btn primary" data-act="save">💾 บันทึกใบจัดบิน</button></div>`;
  }

  // ───── Crew picker ─────
  function openPicker(opts) {
    const st = { q: '', inactive: false };
    const mission = opts.m != null ? S.order.missions[opts.m] : null;
    const tk = mission ? typeKey(mission.aircraftType) : (opts.tk || '');
    const title = mission ? `เพิ่มนักบิน — ภารกิจที่ ${opts.m + 1}` : 'เลือกรายชื่อ';
    const body = `
      <input class="input" id="pkQ" placeholder="ค้นหา ยศ ชื่อ นามสกุล หรือรหัส" autocomplete="off" autofocus>
      <div class="picker-filters">
        <label class="small row" style="gap:4px"><input type="checkbox" id="pkI"> แสดงผู้ที่ไม่ใช้งาน</label></div>
      ${tk ? `<div class="small muted">แสดงคุณสมบัติบนแบบ ${esc(tk)}</div>` : ''}
      <div id="pkList" style="margin-top:6px"></div>
      ${!S.crew.configured && !(S.crew.people || []).length ? '<div class="banner warn">ยังไม่ได้เชื่อม Google Sheets รายชื่อนักบิน (ผู้ดูแลระบบตั้งค่าได้ที่แท็บ "ตั้งค่า")</div>' : ''}`;
    modal({
      title, body,
      foot: [{ label: mission ? 'เสร็จ' : 'ปิด', cls: 'primary', value: null }],
      onOpen: (bg, close) => {
        const list = $('#pkList', bg);
        const draw = () => {
          const q = st.q.trim().toLowerCase();
          const inMission = mission ? new Set(mission.crew.map(c => c.id)) : new Set();
          const rows = (S.crew.people || []).filter(p => (st.inactive || p.active !== false) &&
            (!q || [p.id, p.rank, p.first, p.last, p.short, p.dept].join(' ').toLowerCase().includes(q))).slice(0, 200);
          list.innerHTML = rows.length ? rows.map(p => {
            const ql = tk && p.quals && p.quals[tk];
            return `<div class="pick ${inMission.has(p.id) ? 'added' : ''}" data-id="${esc(p.id)}" role="button" tabindex="0">
              <div class="main"><b>${esc(p.short)}</b><small>${esc([p.rank, p.first, p.last].join(' '))} · ${esc(p.id)}</small>
                <div class="quals">
                ${p.royal ? `<span class="q r">${esc(p.royal)}</span>` : ''}
                ${ql ? ql.pass.map(x => `<span class="q">${esc(x)}</span>`).join('') + ql.training.map(x => `<span class="q t">ฝึก ${esc(x)}</span>`).join('') : ''}
                ${p.active === false ? '<span class="q t">ไม่ใช้งาน</span>' : ''}</div></div>
              <span class="state">${inMission.has(p.id) ? '✓' : '＋'}</span></div>`;
          }).join('') : '<p class="muted center">ไม่พบรายชื่อ</p>';
        };
        $('#pkQ', bg).oninput = e => { st.q = e.target.value; draw(); };
        $('#pkI', bg).onchange = e => { st.inactive = e.target.checked; draw(); };
        const choose = el => {
          const p = S.crewById[el.dataset.id]; if (!p) return;
          if (mission) {
            const k = mission.crew.findIndex(c => c.id === p.id);
            if (k >= 0) mission.crew.splice(k, 1);
            else mission.crew.push({ id: p.id, name: p.short, dept: p.deptCode || 'OPS', role: '' });
            markDirty(); draw();
          } else {
            const t = getPath(S.order, opts.path);
            t.id = p.id; t.name = p.short; markDirty(); close(null);
          }
        };
        list.onclick = e => { const el = e.target.closest('.pick'); if (el) choose(el); };
        list.onkeydown = e => { const el = e.target.closest('.pick'); if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); choose(el); } };
        draw();
      },
    }).then(() => renderView());
  }

  // ───── Document (preview + print) ─────
  function docHtml(day) {
    const o = day.order, m = day.meta || {}, st = statusOf(day);
    const ac = (st === 'RELEASED' && o.aircraftSnapshot) ? o.aircraftSnapshot : (S.aircraft.list || []);
    const d = o.duty;
    const nm = p => (p && p.name ? esc(p.name) : '—');
    const names = arr => (arr || []).filter(p => p.name).map(p => esc(p.name)).join(', ') || '—';
    const ri = Number(d.refuelIdx);
    const refuel = ri >= 0 && d.documents[ri] && d.documents[ri].name ? esc(d.documents[ri].name) : '—';
    const stamp = st === 'RELEASED' ? 'RELEASED · Rev.' + m.revision : st === 'APPROVED' ? 'อนุมัติแล้ว · ยังไม่ release' : st === 'DENIED' ? 'ไม่อนุมัติ' : st === 'PENDING' ? 'ขออนุมัติ · รอพิจารณา' : 'ร่าง · ยังไม่ขออนุมัติ';
    const row = (l, v, raw) => (v == null || v === '' ? '' : `<tr><td class="l">${esc(l)}</td><td class="${raw ? 'pre' : ''}">${raw ? esc(v) : v}</td></tr>`);
    const vip = v => (v && v.on ? `${esc(v.name)}${v.position ? ' · ' + esc(v.position) : ''}${v.phone ? ' · โทร. ' + esc(v.phone) : ''}` : '');
    const stbyOn = STBY_TYPES.filter(([k]) => o.standby[k] && o.standby[k].on);
    const missions = o.noMission ? '<div class="d-none">— ไม่มีภารกิจ —</div>' : o.missions.map((x, i) => {
      const crew = x.crew.map((c, n) => `<div>${n + 1}. ${c.role ? '<b>' + esc(c.role) + '</b> ' : ''}${esc(c.name)}</div>`).join('');
      const t = x.times;
      const times = [['Brief', t.brief], [t.towMode === 'taxi' ? 'TAXI' : 'ลาก', t.tow], [/^\s*วิ่งขึ้น/.test(t.takeoff) ? '' : 'วิ่งขึ้น', t.takeoff]]
        .filter(a => a[1]).map(a => (a[0] ? esc(a[0]) + ' ' : '') + '<b>' + esc(a[1]) + '</b>').join(' &nbsp;·&nbsp; ');
      const park = [['ขาไป', x.parking.out], ['ขากลับ', x.parking.ret]].filter(a => a[1]).map(a => esc(a[0]) + ': ' + esc(a[1])).join(' &nbsp;·&nbsp; ');
      const pair = x.pairLabel || x.pairTail || '—';
      const role = x.acRole === 'primary' ? '<b>บ.จริง</b> — บ.สำรอง: ' + esc(pair) : x.acRole === 'spare' ? '<b>บ.สำรอง</b> ของ บ.จริง: ' + esc(pair) : '';
      return `<div class="d-mission"><div class="d-mhead">ภารกิจที่ ${i + 1}${x.aircraftLabel ? ' | ' + esc(x.aircraftLabel) : ''}${x.acRole ? ' · ' + (x.acRole === 'primary' ? 'บ.จริง' : 'บ.สำรอง') : ''}</div>
        <table><tbody>
        ${row('ประเภท', esc(x.type))}${row('บ.จริง / บ.สำรอง', role)}${row('ภารกิจ', x.title, true)}${row('Callsign', esc(x.callsign))}${row('เส้นทางบิน', esc(x.route))}
        ${row('เชื้อเพลิง', x.fuel !== '' ? esc(fmtFuel(x.fuel)) + ' TONS' : '')}${row('เวลา', times)}${row('ผู้โดยสาร', esc(x.pax))}
        ${row('ผอ.เดินทาง', vip(x.director))}${row('ผู้บังคับ บ.', vip(x.acCommander))}${x.hospitality && x.hospitality.on ? row('จัดรับรอง', x.hospitality.detail || 'มี', true) : ''}${row('จุดจอด', park)}
        ${row('นักบิน', crew ? `<div class="d-crew">${crew}</div>` : '')}${row('POC', esc(x.poc))}${row('การแต่งกาย', esc(x.dress))}${row('หมายเหตุ', x.notes, true)}
        </tbody></table></div>`;
    }).join('');
    const apprStatus = { NEW: 'ยังไม่บันทึก', DRAFT: 'ร่าง — ยังไม่ส่งขออนุมัติ', PENDING: 'PENDING — รอพิจารณา', APPROVED: 'APPROVED — อนุมัติ', DENIED: 'DENIED — ไม่อนุมัติ', RELEASED: 'APPROVED — อนุมัติ / RELEASED' }[st];
    return `<div class="doc">
      <div class="d-stamp ${st}">${esc(stamp)}</div>
      <div class="d-title">${esc(S.settings.unitTitle || o.title)}</div>
      <div class="d-date">${esc(thaiDate(day.date))}</div>
      <div class="d-sec">ข้อมูลเวรและผู้รับผิดชอบ</div>
      <table><tbody>
        <tr><td class="l">น.จัดบินผู้จัดทำ (ติดต่อ)</td><td colspan="3">${nm(d.contact)}${d.contact.phone ? ' | โทร. ' + esc(d.contact.phone) : ''}</td></tr>
        <tr><td class="l">น.เวรกองบิน 6</td><td>${nm(d.wingDuty)}</td><td class="l">ผช.น.เวร กองบิน 6</td><td>${nm(d.wingDutyAsst)}</td></tr>
        <tr><td class="l">น.เวร Controller</td><td>${nm(d.controller)}</td><td class="l">น.จัดบินประจำวัน</td><td>${names(d.schedulers)}</td></tr>
        <tr><td class="l">น.เอกสาร</td><td>${names(d.documents)}</td><td class="l">น.ควบคุมการถ่าย ชพ.</td><td>${refuel}</td></tr>
      </tbody></table>
      ${stbyOn.length ? `<div class="d-sec">นบ.STBY</div><table><tbody>${stbyOn.map(([k, label]) => `<tr><td class="l" style="width:30%">${esc(label)}</td>
        <td>${o.standby[k].pilots.filter(p => p.name).map((p, j) => (j + 1) + '. ' + esc(p.name)).join(' &nbsp;&nbsp; ') || '—'}</td></tr>`).join('')}</tbody></table>` : ''}
      <div class="d-sec">สถานภาพเครื่องบินโดยรวม${st === 'RELEASED' && o.aircraftSnapshot ? ' (ณ เวลา release)' : ''}</div>
      <table><thead><tr><th style="width:20%">เครื่อง / แบบ</th><th style="width:11%">สถานะ</th><th>ข้อขัดข้อง / รายละเอียด</th><th style="width:24%">Plan Check</th></tr></thead><tbody>
        ${ac.length ? ac.map(a => `<tr><td>${esc(a.tail)} / ${esc(a.type)}</td><td class="center ${esc(a.status)}"><b>${esc(a.status)}</b></td><td>${esc(a.detail)}</td><td>${esc(a.planCheck)}</td></tr>`).join('') : '<tr><td colspan="4" class="center">—</td></tr>'}
      </tbody></table>
      <div class="d-sec">รายละเอียดภารกิจ${o.noMission ? '' : ' — ' + o.missions.length + ' ภารกิจ'}</div>
      ${missions}
      ${o.remarks ? `<div class="d-sec">หมายเหตุ</div><table><tbody><tr><td class="pre">${esc(o.remarks)}</td></tr></tbody></table>` : ''}
      <div class="d-approval"><div class="d-sec">การพิจารณาใบจัดบิน</div>
        <table><tbody>
          <tr><td class="l">สถานะ</td><td><b>${esc(apprStatus)}</b></td><td class="l">ผู้พิจารณา</td><td>${esc(m.approvedBy || '')}</td></tr>
          <tr><td class="l">วันที่ / เวลา</td><td>${esc(thaiTs(m.approvedAt))}</td><td class="l">${st === 'DENIED' ? 'เหตุผล' : 'Release โดย'}</td><td>${st === 'DENIED' ? esc(m.denyReason) : esc(m.releasedBy ? m.releasedBy + ' · ' + thaiTs(m.releasedAt) : '')}</td></tr>
        </tbody></table></div>
      <div class="d-foot"><span>พิมพ์โดย ${esc(S.user.displayName)} · ${esc(thaiTs(ymd(new Date()) + ' ' + new Date().toTimeString().slice(0, 5)))}</span><span>${m.exists ? 'Rev.' + esc(m.revision) + ' · v' + esc(m.version) : 'ยังไม่บันทึก'}${day.dirty ? ' · มีการแก้ไขที่ยังไม่บันทึก' : ''}</span></div>
    </div>`;
  }
  function doPrint(days) {
    const root = $('#printRoot');
    root.innerHTML = days.map(docHtml).join('');
    const prev = document.title;
    const a = days[0].date, b = days[days.length - 1].date;
    document.title = 'ใบจัดบิน_' + a + (a !== b ? '_ถึง_' + b : (days[0].meta && days[0].meta.exists ? '_Rev' + days[0].meta.revision : ''));
    const restore = () => { document.title = prev; window.removeEventListener('afterprint', restore); };
    window.addEventListener('afterprint', restore);
    setTimeout(() => window.print(), 50);
  }

  // ───── Order actions ─────
  async function gotoDate(d) { await loadRange(d, d, d); }
  async function saveAll(quiet) {
    const b = batchInfo();
    if (!b.toSave.length) { if (!quiet) toast('ไม่มีการเปลี่ยนแปลงที่ต้องบันทึก'); return true; }
    for (const d of b.toSave) {                // ผอ.เดินทาง / ผู้บังคับ บ. ที่ติ๊กไว้ ต้องกรอกครบ
      const bad = [];
      (d.order.noMission ? [] : d.order.missions).forEach((m, i) => [['director', 'ผอ.เดินทาง'], ['acCommander', 'ผู้บังคับ บ.']].forEach(([k, l]) => {
        const v = m[k]; if (v.on && !(v.name.trim() && v.position.trim() && v.phone.trim())) bad.push('ภารกิจที่ ' + (i + 1) + ': ' + l);
      }));
      if (bad.length) {
        if (d.date !== S.date) activate(d.date);
        renderView();
        toast(dayShort(d.date) + ' — กรอกชื่อ ตำแหน่ง เบอร์โทร. ให้ครบ (' + bad.join(', ') + ')', true);
        return false;
      }
      d.order.title = S.settings.unitTitle;     // หัวเรื่องคงที่ตามการตั้งค่า
    }
    try {
      const r = await api('saveBatch', {
        days: b.toSave.map(d => ({ date: d.date, order: d.order, baseVersion: d.meta && d.meta.exists ? d.meta.version : 0 })),
        batchDates: S.range,
      }, { silent: true });
      b.toSave.forEach(d => clearDraft(d.date));
      r.days.forEach(putDay);
      renderView();
      if (!quiet) toast('บันทึกร่างแล้ว' + (b.multi ? ' ' + b.toSave.length + ' วัน' : '') + ' — กด "ส่งขออนุมัติ" เมื่อจัดทำเสร็จ');
      return true;
    } catch (e) {
      if (e.code === 'CONFLICT' || e.code === 'LOCKED') {
        const go = await modal({ title: 'มีผู้อื่นแก้ไขใบจัดบิน', body: `<p>${esc(e.message)}</p><p>ยังไม่มีวันใดถูกบันทึก ร่างของคุณถูกเก็บไว้ในเครื่องนี้ — โหลดใหม่แล้วกด "กู้คืนร่าง" ในแต่ละวันเพื่อเทียบได้</p>`,
          foot: [{ label: 'ยกเลิก', cls: 'ghost', value: false }, { label: 'โหลดใหม่', cls: 'primary', value: true }] });
        if (go) await reloadRange();
      } else toast(e.message, true);
      return false;
    }
  }
  /** สิ่งที่น่าจะยังไม่เสร็จ — แสดงเตือนก่อนส่งขออนุมัติ (ส่งต่อได้) */
  function incompleteList(days) {
    const out = [];
    days.forEach(d => {
      const o = d.order; if (!o) return;
      const w = [];
      if (!o.duty.contact.name) w.push('ยังไม่มีชื่อ น.จัดบินผู้จัดทำ');
      if (!o.noMission) o.missions.forEach((m, i) => {
        const miss = [];
        if (!m.aircraftTail) miss.push('เครื่องบิน');
        if (!m.title.trim()) miss.push('ภารกิจ');
        if (!m.crew.length) miss.push('นักบิน');
        else if (m.crew.some(c => !c.role)) miss.push('หน้าที่นักบิน');
        if (!m.times.takeoff.trim()) miss.push('เวลาวิ่งขึ้น');
        if (miss.length) w.push('ภารกิจที่ ' + (i + 1) + ' ยังไม่มี' + miss.join(', '));
      });
      if (w.length) out.push('<b>' + esc(dayShort(d.date)) + '</b>: ' + w.map(esc).join(' · '));
    });
    return out;
  }
  function requireSaved() { if (batchInfo().dirty) { toast('กรุณาบันทึกการแก้ไขก่อน', true); return false; } return true; }
  async function applyBatch(r, msg) { r.days.forEach(putDay); renderView(); toast(msg); }

  const ACTIONS = {
    tab: async el => {
      const t = el.dataset.tab;
      if (S.tab === 'aircraft' && S.acEdit && t !== 'aircraft' && !(await confirmBox('ยกเลิกการแก้ไข', 'ยังไม่ได้บันทึกสถานภาพเครื่องบิน ต้องการออกจากหน้านี้หรือไม่?', 'ออก', 'bad'))) return;
      if (t !== 'aircraft') S.acEdit = null;
      S.tab = t; renderView(); window.scrollTo(0, 0);
    },
    day: el => {
      const n = Number(el.dataset.n);
      gotoDate(n < 0 ? addDays(S.range[0], -1) : addDays(S.range[S.range.length - 1], 1));
    },
    today: () => gotoDate(S.today || todayKey()),
    'next-batch': () => { const nb = nextBatch(S.today || todayKey()); return loadRange(nb.from, nb.to, nb.from); },
    'day-tab': el => { activate(el.dataset.d); renderView(); },
    save: () => saveAll(),
    submit: async () => {
      if (batchInfo().dirty && !(await saveAll(true))) return;   // บันทึกก่อนส่ง
      const b = batchInfo();
      if (!b.submittable) { toast('ต้องบันทึกใบจัดบินให้ครบทุกวันก่อนส่งขออนุมัติ', true); return; }
      const items = b.items(['DRAFT', 'DENIED']), warn = incompleteList(b.days.filter(d => ['DRAFT', 'DENIED'].includes(statusOf(d))));
      const note = await modal({ title: 'ส่งขออนุมัติ' + (b.multi ? 'ทั้งชุด' : ''), body: `<p>ส่งใบจัดบิน <b>${esc(rangeLabel())}</b> ให้ผู้บังคับบัญชาพิจารณา</p>
        ${warn.length ? `<div class="banner warn" style="margin-top:0"><b>ตรวจก่อนส่ง — รายการที่ยังว่าง:</b><ul class="small" style="margin:6px 0 0;padding-left:18px">${warn.map(w => '<li>' + w + '</li>').join('')}</ul></div>` : ''}
        <p class="small muted">หลังส่งแล้ว ถ้าแก้ไขอีก ใบจะกลับเป็นร่างและต้องส่งขออนุมัติใหม่</p>
        <label class="field"><span>ข้อความถึงผู้บังคับบัญชา (ถ้ามี)</span><textarea id="sbNote" rows="2"></textarea></label>`,
        foot: [{ label: 'ยกเลิก', cls: 'ghost', value: null }, { label: '📨 ส่งขออนุมัติ', cls: 'rel', value: bg => $('#sbNote', bg).value }] });
      if (note == null) return;
      try { await applyBatch(await api('submitBatch', { items, note }, { silent: true }), 'ส่งขออนุมัติแล้ว'); }
      catch (e) { conflictOr(e); }
    },
    blank: async () => {
      if (!(await confirmBox('ล้างเป็นหน้าว่าง', 'ล้างข้อมูลของ' + esc(thaiDate(S.date)) + 'ให้เป็นใบว่าง (ยังไม่บันทึกจนกว่าจะกด "บันทึก")', 'ล้างข้อมูล', 'bad'))) return;
      S.order = blankOrder(); markDirty(); renderView();
    },
    'copy-prev': async () => {
      const prevDate = addDays(S.date, -1);
      let src = null;
      if (S.days[prevDate]) { stash(); src = S.days[prevDate].order; }
      else {
        const r = await api('getOrder', { date: prevDate });
        src = r.exists && r.order ? normalizeOrder(r.order) : null;
      }
      if (!src) { toast('ไม่มีใบจัดบินของ' + thaiDate(prevDate), true); return; }
      const pick = await modal({ title: 'คัดลอกจาก' + thaiDate(prevDate), body: `<p class="small muted">ข้อมูลที่เลือกจะแทนที่ข้อมูลเดิมของ${esc(thaiDate(S.date))}</p>
        <label class="row"><input type="checkbox" id="cpDuty" checked> ข้อมูลเวรและผู้รับผิดชอบ</label>
        <label class="row" style="margin-top:6px"><input type="checkbox" id="cpStby" checked> นบ.STBY</label>
        <label class="row" style="margin-top:6px"><input type="checkbox" id="cpMis" checked> ภารกิจและนักบิน (${src.noMission ? 'ไม่มีภารกิจ' : src.missions.length + ' ภารกิจ'})</label>
        <label class="row" style="margin-top:6px"><input type="checkbox" id="cpRem"> หมายเหตุทั่วไป</label>`,
        foot: [{ label: 'ยกเลิก', cls: 'ghost', value: null }, { label: 'คัดลอก', cls: 'primary', value: bg => ({ duty: $('#cpDuty', bg).checked, stby: $('#cpStby', bg).checked, mis: $('#cpMis', bg).checked, rem: $('#cpRem', bg).checked }) }] });
      if (!pick) return;
      const c = clone(src);
      if (pick.duty) S.order.duty = c.duty;
      if (pick.stby) S.order.standby = c.standby;
      if (pick.mis) { S.order.noMission = c.noMission; S.order.missions = c.missions.map(m => Object.assign(m, { id: rid() })); if (!S.order.noMission && !S.order.missions.length) S.order.missions.push(blankMission()); }
      if (pick.rem) S.order.remarks = c.remarks;
      markDirty(); renderView(); toast('คัดลอกแล้ว — อย่าลืมตรวจและบันทึก');
    },
    'print-all': () => doPrint(batchInfo().printable),
    'print-day': () => doPrint([activeDay()]),
    'draft-restore': () => { S.order = normalizeOrder(S.draftOffer.order); S.draftOffer = null; markDirty(); renderView(); },
    'draft-discard': () => { S.draftOffer = null; clearDraft(); renderView(); },
    approve: async () => {
      if (!requireSaved()) return;
      const b = batchInfo(), items = b.items(['PENDING', 'DENIED', 'APPROVED']);
      const note = await modal({ title: b.multi ? 'อนุมัติทั้งชุด' : 'อนุมัติใบจัดบิน', body: `<p>ยืนยันอนุมัติใบจัดบิน <b>${esc(rangeLabel())}</b></p>
        ${b.multi ? `<ul class="small">${b.days.map(d => `<li>${esc(dayShort(d.date))} — ${d.order && d.order.noMission ? 'ไม่มีภารกิจ' : (d.order ? d.order.missions.length + ' ภารกิจ' : '')} (${esc(STATUS_LABEL[statusOf(d)])})</li>`).join('')}</ul>` : ''}
        <label class="field"><span>หมายเหตุ (ถ้ามี)</span><textarea id="apNote" rows="2"></textarea></label>`,
        foot: [{ label: 'ยกเลิก', cls: 'ghost', value: null }, { label: '✔ อนุมัติ' + (b.multi ? 'ทั้งชุด' : ''), cls: 'ok', value: bg => $('#apNote', bg).value }] });
      if (note == null) return;
      try { await applyBatch(await api('approveBatch', { items, note }, { silent: true }), 'อนุมัติแล้ว'); }
      catch (e) { conflictOr(e); }
    },
    deny: async () => {
      if (!requireSaved()) return;
      const b = batchInfo(), items = b.items(['PENDING', 'APPROVED', 'DENIED']);
      const reason = await modal({ title: b.multi ? 'ไม่อนุมัติทั้งชุด' : 'ไม่อนุมัติใบจัดบิน', body: `<p>${esc(rangeLabel())}</p>
        <label class="field"><span>เหตุผลที่ไม่อนุมัติ (จำเป็น)${b.multi ? ' — ระบุวันที่ต้องแก้ได้' : ''}</span><textarea id="dnR" rows="4" autofocus></textarea></label><div class="form-error" id="dnE"></div>`,
        foot: [{ label: 'ยกเลิก', cls: 'ghost', value: null }, { label: '✖ ไม่อนุมัติ', cls: 'bad', value: bg => $('#dnR', bg).value.trim(),
          validate: bg => { const ok = !!$('#dnR', bg).value.trim(); if (!ok) $('#dnE', bg).textContent = 'กรุณาระบุเหตุผล'; return ok; } }] });
      if (!reason) return;
      try { await applyBatch(await api('denyBatch', { items, reason }, { silent: true }), 'บันทึกผลไม่อนุมัติแล้ว'); }
      catch (e) { conflictOr(e); }
    },
    release: async () => {
      if (!requireSaved()) return;
      const b = batchInfo();
      if (!(await confirmBox(b.multi ? 'Release ทั้งชุด' : 'Release ใบจัดบิน', 'Release ใบจัดบิน <b>' + esc(rangeLabel()) + '</b> — ใบจัดบินจะถูกล็อกและผู้ชมทุกคนจะเห็นได้ สถานภาพเครื่องบินจะถูกบันทึก ณ เวลานี้', '🚀 Release', 'rel'))) return;
      try { await applyBatch(await api('releaseBatch', { items: b.items(['APPROVED']) }, { silent: true }), 'Release แล้ว'); }
      catch (e) { conflictOr(e); }
    },
    revise: async () => {
      const reason = await modal({ title: 'เปิดแก้ไข' + thaiDate(S.date), body: `<p>ใบจัดบินวันนี้จะกลับเป็น <b>ร่าง</b> ในฉบับแก้ไขที่ ${S.meta.revision + 1} และต้องได้รับอนุมัติใหม่ก่อน release (วันอื่นในชุดไม่ได้รับผลกระทบ)</p>
        <label class="field"><span>เหตุผลที่ต้องแก้ไข (จำเป็น)</span><textarea id="rvR" rows="3" autofocus></textarea></label><div class="form-error" id="rvE"></div>`,
        foot: [{ label: 'ยกเลิก', cls: 'ghost', value: null }, { label: 'เปิดแก้ไข', cls: 'primary', value: bg => $('#rvR', bg).value.trim(),
          validate: bg => { const ok = !!$('#rvR', bg).value.trim(); if (!ok) $('#rvE', bg).textContent = 'กรุณาระบุเหตุผล'; return ok; } }] });
      if (!reason) return;
      putDay(await api('reviseOrder', { date: S.date, reason })); renderView();
    },
    delete: async () => {
      if (!(await confirmBox('ลบใบจัดบิน', 'ลบใบจัดบิน' + esc(thaiDate(S.date)) + ' ออกจากฐานข้อมูลถาวร?', 'ลบถาวร', 'bad'))) return;
      await api('deleteOrder', { date: S.date }); clearDraft();
      putDay(await api('getOrder', { date: S.date })); renderView(); toast('ลบแล้ว');
    },
    'mission-add': () => {
      S.order.noMission = false; S.order.missions.push(blankMission()); markDirty(); renderView();
      const el = $('#mission-' + (S.order.missions.length - 1)); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    },
    'mission-rm': async el => {
      const i = Number(el.dataset.m), m = S.order.missions[i];
      const hasData = comparable({ missions: [m] }) !== comparable({ missions: [blankMission()] });
      if (hasData && !(await confirmBox('ลบภารกิจ', `ลบภารกิจที่ ${i + 1}${m.title ? ' (' + esc(m.title.slice(0, 60)) + ')' : ''}?`, 'ลบภารกิจ', 'bad'))) return;
      S.order.missions.splice(i, 1);
      if (!S.order.missions.length) {
        const none = await modal({ title: 'ไม่มีภารกิจเหลือ', body: '<p>ต้องการระบุว่า <b>ไม่มีภารกิจ</b> ในวันนี้ หรือเพิ่มภารกิจว่าง 1 รายการ?</p>',
          foot: [{ label: 'เพิ่มภารกิจว่าง', cls: 'ghost', value: false }, { label: 'ไม่มีภารกิจ', cls: 'primary', value: true }] });
        if (none) S.order.noMission = true; else S.order.missions.push(blankMission());
      }
      markDirty(); renderView();
    },
    'pick-crew': el => openPicker({ m: Number(el.dataset.m) }),
    'pick-duty': el => openPicker({ path: el.dataset.path, tk: el.dataset.tk }),
    'person-add': el => {
      const list = getPath(S.order, el.dataset.list);
      if (list.length < Number(el.dataset.max)) { list.push(blankP()); markDirty(); renderView(); }
    },
    'person-rm': el => {
      const list = getPath(S.order, el.dataset.list), i = Number(el.dataset.i);
      list.splice(i, 1); if (!list.length) list.push(blankP());
      if (el.dataset.list === 'duty.documents') {          // ให้ น.ควบคุมการถ่าย ชพ. ยังชี้คนเดิม
        const ri = Number(S.order.duty.refuelIdx);
        S.order.duty.refuelIdx = ri === i ? -1 : ri > i ? ri - 1 : ri;
      }
      markDirty(); renderView();
    },
    'crew-rm': el => { S.order.missions[+el.dataset.m].crew.splice(+el.dataset.c, 1); markDirty(); renderView(); },
    'crew-up': el => { const c = S.order.missions[+el.dataset.m].crew, j = +el.dataset.c; [c[j - 1], c[j]] = [c[j], c[j - 1]]; markDirty(); renderView(); },
    'change-pw': () => { $('#menu').hidden = true; renderChangePassword(false); },
    'refresh-crew': async () => { $('#menu').hidden = true; setCrew(await api('getCrew', { refresh: true })); toast('โหลดรายชื่อแล้ว ' + S.crew.people.length + ' คน'); },
    'demo-reset': async () => {
      if (!(await confirmBox('รีเซ็ตข้อมูลทดลอง', 'ลบข้อมูลทดลองทั้งหมดในเบราว์เซอร์นี้แล้วเริ่มใหม่?', 'รีเซ็ต', 'bad'))) return;
      await API.demoReset(); API.setToken(''); clearAllDrafts(); location.reload();
    },
    logout,
  };
  async function conflictOr(e) {
    if (e.code === 'CONFLICT' || e.code === 'NOT_FOUND' || e.code === 'BAD_STATE') { toast(e.message, true); await reloadRange(); }
    else toast(e.message, true);
  }

  // ───────────────────────── Aircraft tab ─────────────────────────
  function viewAircraft(v) {
    const list = S.aircraft.list || [], ed = S.acEdit;
    const latest = list.reduce((a, b) => (b.updatedAt > (a ? a.updatedAt : '') ? b : a), null);
    if (!ed) {
      v.innerHTML = `<section class="card">
        <div class="card-head"><h2>สถานภาพเครื่องบิน</h2><span class="spacer"></span>
          <button class="btn sm ghost" data-act="ac-reload">↻ โหลดใหม่</button>
          ${can('editAircraft') ? '<button class="btn sm primary" data-act="ac-edit">🔓 แก้ไข</button>' : ''}</div>
        <div class="lock-note">🔒 <span>ข้อมูลถูกล็อกเพื่อป้องกันการแก้ไขโดยไม่ตั้งใจ${can('editAircraft') ? ' — กด "แก้ไข" เพื่อปรับสถานภาพ' : ''}${latest ? `<br><span class="small muted">ปรับล่าสุด: ${esc(latest.updatedBy)} · ${esc(thaiTs(latest.updatedAt))}</span>` : ''}</span></div>
        <div class="tbl-wrap" style="margin-top:10px"><table class="tbl cards"><thead><tr><th>เครื่อง</th><th>แบบ</th><th>ชื่อ ทอ.</th><th>สถานะ</th><th>ข้อขัดข้อง / รายละเอียด</th><th>Plan Check</th></tr></thead><tbody>
          ${list.length ? list.map(a => `<tr><td data-k="เครื่อง"><b>${esc(a.tail)}</b></td><td data-k="แบบ">${esc(a.type)}</td><td data-k="ชื่อ ทอ.">${esc(a.designation)}</td>
          <td data-k="สถานะ"><span class="ac-status ${esc(a.status)}">${esc(a.status)}</span></td><td data-k="รายละเอียด">${esc(a.detail)}</td><td data-k="Plan Check">${esc(a.planCheck)}</td></tr>`).join('')
            : '<tr><td colspan="6" class="muted">ยังไม่มีข้อมูลเครื่องบิน</td></tr>'}
        </tbody></table></div></section>`;
      return;
    }
    v.innerHTML = `<section class="card">
      <div class="card-head"><h2>แก้ไขสถานภาพเครื่องบิน</h2><span class="spacer"></span>
        <button class="btn sm ghost" data-act="ac-cancel">ยกเลิก</button><button class="btn sm primary" data-act="ac-save">💾 บันทึก</button></div>
      <div class="banner warn" style="margin-top:0">กำลังแก้ไข — การเปลี่ยนแปลงมีผลกับใบจัดบินที่ยังไม่ release ทุกใบ</div>
      <div class="tbl-wrap" style="margin-top:10px"><table class="tbl ac-edit cards"><thead><tr><th style="width:90px">เครื่อง</th><th style="width:110px">แบบ</th><th style="width:100px">ชื่อ ทอ.</th><th style="width:100px">สถานะ</th><th>ข้อขัดข้อง / รายละเอียด</th><th style="width:150px">Plan Check</th><th style="width:76px"></th></tr></thead><tbody>
      ${ed.map((a, i) => `<tr>
        <td data-k="เครื่อง"><input data-ac="${i}.tail" value="${esc(a.tail)}" placeholder="60205" inputmode="numeric"></td>
        <td data-k="แบบ"><input data-ac="${i}.type" value="${esc(a.type)}" placeholder="ACJ320"></td>
        <td data-k="ชื่อ ทอ."><input data-ac="${i}.designation" value="${esc(a.designation)}" placeholder="บ.ล.15 ก"></td>
        <td data-k="สถานะ"><select data-ac="${i}.status">${AC_STATUS.map(s => `<option ${s === a.status ? 'selected' : ''}>${s}</option>`).join('')}${a.status && !AC_STATUS.includes(a.status) ? `<option selected>${esc(a.status)}</option>` : ''}</select></td>
        <td data-k="รายละเอียด"><input data-ac="${i}.detail" value="${esc(a.detail)}"></td>
        <td data-k="Plan Check"><input data-ac="${i}.planCheck" value="${esc(a.planCheck)}"></td>
        <td><div class="row" style="gap:4px;flex-wrap:nowrap">${i > 0 ? `<button class="btn sm ghost" data-act="ac-up" data-i="${i}" aria-label="เลื่อนขึ้น">↑</button>` : ''}<button class="btn sm danger-ghost" data-act="ac-rm" data-i="${i}" aria-label="ลบ">✕</button></div></td>
      </tr>`).join('')}
      </tbody></table></div>
      <button class="btn add-mission" data-act="ac-add">＋ เพิ่มเครื่องบิน</button></section>`;
  }
  Object.assign(ACTIONS, {
    'ac-reload': async () => { await refreshAircraft(); renderView(); },
    'ac-edit': async () => { await refreshAircraft(); S.acEdit = clone(S.aircraft.list); if (!S.acEdit.length) S.acEdit.push({ tail: '', type: '', designation: '', status: 'FMC', detail: '', planCheck: '' }); renderView(); },
    'ac-cancel': () => { S.acEdit = null; renderView(); },
    'ac-add': () => { S.acEdit.push({ tail: '', type: '', designation: '', status: 'FMC', detail: '', planCheck: '' }); renderView(); },
    'ac-rm': async el => {
      const a = S.acEdit[+el.dataset.i];
      if (a.tail && !(await confirmBox('ลบเครื่องบิน', 'ลบ ' + esc(a.tail) + ' ออกจากรายการ?', 'ลบ', 'bad'))) return;
      S.acEdit.splice(+el.dataset.i, 1); renderView();
    },
    'ac-up': el => { const i = +el.dataset.i; [S.acEdit[i - 1], S.acEdit[i]] = [S.acEdit[i], S.acEdit[i - 1]]; renderView(); },
    'ac-save': async () => {
      const list = S.acEdit.filter(a => a.tail.trim() || a.type.trim() || a.detail.trim());
      try {
        S.aircraft = await api('saveAircraft', { aircraft: list, baseVersion: S.aircraft.version }, { silent: true });
        S.acEdit = null; renderView(); toast('บันทึกสถานภาพเครื่องบินแล้ว');
      } catch (e) {
        if (e.code === 'CONFLICT') { toast(e.message, true); await refreshAircraft(); }
        else toast(e.message, true);
      }
    },
  });

  // ───────────────────────── History tab ─────────────────────────
  async function viewHistory(v) {
    const h = S.history;
    v.innerHTML = `<section class="card"><div class="card-head"><h2>ใบจัดบินย้อนหลัง</h2><span class="spacer"></span>
      <input type="month" class="input" id="hMonth" value="${esc(h.month)}" style="width:auto"></div>
      <div id="hList"><p class="muted">กำลังโหลด…</p></div>
      ${!can('seeUnreleased') ? '<p class="small muted">แสดงเฉพาะใบที่ release แล้ว</p>' : ''}</section>`;
    $('#hMonth').onchange = e => { h.month = e.target.value; viewHistory(v); };
    const [y, m] = h.month.split('-').map(Number);
    const last = new Date(y, m, 0).getDate();
    try {
      const rows = await api('listOrders', { from: h.month + '-01', to: h.month + '-' + String(last).padStart(2, '0') }, { quiet: true });
      const el = $('#hList'); if (!el) return;
      el.innerHTML = rows.length ? rows.map(r => `<div class="list-item" data-act="open-date" data-d="${esc(r.date)}" ${r.batchId ? `data-batch="${esc(r.batchId)}"` : ''} role="button" tabindex="0">
          <div class="d grow">${esc(thaiDate(r.date))}${holidayName(r.date) ? ` <span class="chip NEW">${esc(holidayName(r.date))}</span>` : ''}
          <small>${r.batchId ? 'ชุด ' + esc(dayShort(r.batchId.split('..')[0]) + ' – ' + dayShort(r.batchId.split('..')[1])) + ' · ' : ''}${r.missionCount ? r.missionCount + ' ภารกิจ' : 'ไม่มีภารกิจ'} · Rev.${esc(r.revision)} · ${esc(r.updatedBy)} ${esc(thaiTs(r.updatedAt))}</small></div>
          <span class="chip ${esc(r.status)}">${esc(STATUS_LABEL[r.status] || r.status)}</span></div>`).join('')
        : '<p class="muted">ไม่มีใบจัดบินในเดือนนี้</p>';
    } catch (e) { const el = $('#hList'); if (el) el.innerHTML = `<p class="form-error">${esc(e.message)}</p>`; }
  }
  ACTIONS['open-date'] = async el => {
    S.tab = 'order';
    const b = el.dataset.batch ? el.dataset.batch.split('..') : null;
    await loadRange(b ? b[0] : el.dataset.d, b ? b[1] : el.dataset.d, el.dataset.d);
    window.scrollTo(0, 0);
  };

  // ───────────────────────── Stats tab ─────────────────────────
  function bars(rows, labelFn, max) {
    if (!rows.length) return '<p class="muted small">ไม่มีข้อมูล</p>';
    const top = rows.slice(0, max || 15), peak = top[0].count || 1;
    return `<div class="bars">${top.map(r => `<div class="bar-row" title="${esc(labelFn(r))}: ${r.count}">
      <span class="lbl">${labelFn(r, true)}</span><span class="bar-track"><span class="bar-fill" style="display:block;width:${Math.max(1, r.count / peak * 100)}%"></span></span><span class="val">${r.count}</span></div>`).join('')}
      ${rows.length > top.length ? `<p class="small muted">และอีก ${rows.length - top.length} รายการ</p>` : ''}</div>`;
  }
  async function viewStats(v) {
    const s = S.stats;
    v.innerHTML = `<section class="card"><div class="card-head"><h2>สถิติ</h2></div>
      <div class="row"><label class="field"><span>ตั้งแต่</span><input type="date" id="sFrom" value="${esc(s.from)}"></label>
      <label class="field"><span>ถึง</span><input type="date" id="sTo" value="${esc(s.to)}"></label>
      <button class="btn primary" data-act="stats-load" style="align-self:flex-end">แสดง</button></div>
      <p class="small muted" style="margin-bottom:0">นับเฉพาะใบจัดบินที่ release แล้ว · ข้อมูลดิบอยู่ในแท็บ MissionLog / CrewLog ของ Google Sheets สำหรับทำ Pivot table</p></section>
      <div id="sOut"></div>`;
    $('#sFrom').onchange = e => s.from = e.target.value;
    $('#sTo').onchange = e => s.to = e.target.value;
    if (s.data) drawStats(); else ACTIONS['stats-load']();
  }
  function drawStats() {
    const d = S.stats.data, el = $('#sOut'); if (!el || !d) return;
    const avg = d.flyingDays ? (d.totalMissions / d.flyingDays).toFixed(1) : '0';
    el.innerHTML = `<div class="tiles" style="margin-bottom:12px">
        <div class="tile"><div class="k">ภารกิจทั้งหมด</div><div class="v">${d.totalMissions}</div></div>
        <div class="tile"><div class="k">วันที่มีภารกิจ</div><div class="v">${d.flyingDays}</div></div>
        <div class="tile"><div class="k">ภารกิจเฉลี่ย / วันบิน</div><div class="v">${avg}</div></div>
        <div class="tile"><div class="k">กำลังพลที่ขึ้นบิน</div><div class="v">${d.byPerson.length}</div></div></div>
      <div class="grid g2">
        <section class="card"><h2>ภารกิจตามเครื่องบิน</h2><div style="margin-top:10px">${bars(d.byAircraft, (r) => esc(r.key))}</div></section>
        <section class="card"><h2>ภารกิจตามประเภท</h2><div style="margin-top:10px">${bars(d.byType, (r) => esc(r.key))}</div></section>
        <section class="card"><h2>จำนวนเที่ยวบินรายบุคคล</h2><div style="margin-top:10px">${bars(d.byPerson, (r) => esc(r.name), 20)}</div></section>
        <section class="card"><h2>ตามหน้าที่</h2><div style="margin-top:10px">${bars(d.byRole, (r) => esc(r.key))}</div></section>
        <section class="card"><h2>นบ.STBY รายบุคคล</h2><div style="margin-top:10px">${bars(d.byStandby || [], (r) => esc(r.name), 20)}</div></section>
        <section class="card"><h2>นบ.STBY ตามประเภท</h2><div style="margin-top:10px">${bars(d.standbyByType || [], (r) => esc(r.key))}</div></section>
      </div>`;
  }
  ACTIONS['stats-load'] = async () => {
    const s = S.stats;
    if (s.from > s.to) { toast('ช่วงวันที่ไม่ถูกต้อง', true); return; }
    try { s.data = await api('stats', { from: s.from, to: s.to }); drawStats(); } catch (e) { /* toasted */ }
  };

  // ───────────────────────── Users tab (admin) ─────────────────────────
  async function viewUsers(v) {
    v.innerHTML = `<section class="card"><div class="card-head"><h2>ผู้ใช้งาน</h2><span class="spacer"></span><button class="btn sm primary" data-act="user-new">＋ เพิ่มผู้ใช้</button></div>
      <div class="small muted" style="margin-bottom:8px">admin: ทำได้ทุกอย่าง · ผู้จัดบิน: สร้าง/แก้ใบจัดบิน แก้สถานภาพ release · ผู้บังคับบัญชา: อนุมัติ/ไม่อนุมัติ · ผู้ดูแลเอกสาร: ดูและพิมพ์ใบทุกสถานะ (แก้ไขไม่ได้) · ผู้ชม: ดูใบที่ release แล้ว</div>
      <div id="uList"><p class="muted">กำลังโหลด…</p></div></section>`;
    try {
      S.users = await api('listUsers', {}, { quiet: true });
      const el = $('#uList'); if (!el) return;
      el.innerHTML = `<div class="tbl-wrap"><table class="tbl cards"><thead><tr><th>ชื่อผู้ใช้</th><th>ชื่อที่แสดง</th><th>สิทธิ์</th><th>สถานะ</th><th>เข้าระบบล่าสุด</th><th></th></tr></thead><tbody>
        ${S.users.map((u, i) => `<tr><td data-k="ชื่อผู้ใช้"><b>${esc(u.username)}</b></td><td data-k="ชื่อ">${esc(u.displayName)}</td><td data-k="สิทธิ์">${esc(ROLE_LABEL[u.role] || u.role)}</td>
          <td data-k="สถานะ">${u.active ? (u.mustChange ? '<span class="chip PENDING">รอเปลี่ยนรหัส</span>' : '<span class="chip APPROVED">ใช้งาน</span>') : '<span class="chip DENIED">ปิดใช้งาน</span>'}</td>
          <td data-k="ล่าสุด" class="small">${esc(thaiTs(u.lastLogin)) || '—'}</td>
          <td><div class="row" style="gap:4px"><button class="btn sm ghost" data-act="user-edit" data-i="${i}">แก้ไข</button><button class="btn sm ghost" data-act="user-reset" data-i="${i}">รีเซ็ตรหัส</button></div></td></tr>`).join('')}
      </tbody></table></div>`;
    } catch (e) { const el = $('#uList'); if (el) el.innerHTML = `<p class="form-error">${esc(e.message)}</p>`; }
  }
  function userForm(u, isNew) {
    return `<div class="grid">
      <label class="field"><span>ชื่อผู้ใช้ (a-z 0-9 . _ -)</span><input id="uf_un" value="${esc(u.username)}" ${isNew ? 'autofocus' : 'readonly class="input"'} autocapitalize="none"></label>
      <label class="field"><span>ชื่อที่แสดง (ยศ ชื่อ)</span><input id="uf_dn" value="${esc(u.displayName)}"></label>
      <label class="field"><span>สิทธิ์</span><select id="uf_role">${Object.keys(ROLE_LABEL).map(r => `<option value="${r}" ${u.role === r ? 'selected' : ''}>${ROLE_LABEL[r]}</option>`).join('')}</select></label>
      ${isNew ? '' : `<label class="row"><input type="checkbox" id="uf_act" ${u.active ? 'checked' : ''}> เปิดใช้งาน</label>`}
      <div class="form-error" id="uf_err"></div></div>`;
  }
  async function showTempPassword(username, pw) {
    await modal({ title: 'รหัสผ่านชั่วคราว', body: `<p>แจ้งรหัสนี้ให้ <b>${esc(username)}</b> โดยตรง — ระบบจะแสดงเพียงครั้งเดียว และผู้ใช้ต้องเปลี่ยนรหัสเมื่อเข้าระบบครั้งแรก</p>
      <div class="secret">${esc(pw)}</div>`, foot: [{ label: 'คัดลอก', cls: 'ghost', value: 'copy' }, { label: 'ปิด', cls: 'primary', value: null }] })
      .then(v => { if (v === 'copy' && navigator.clipboard) navigator.clipboard.writeText(pw).then(() => toast('คัดลอกแล้ว')); });
  }
  Object.assign(ACTIONS, {
    'user-new': async () => {
      const u = await modal({ title: 'เพิ่มผู้ใช้', body: userForm({ username: '', displayName: '', role: 'viewer' }, true),
        foot: [{ label: 'ยกเลิก', cls: 'ghost', value: null }, { label: 'สร้างบัญชี', cls: 'primary', value: bg => ({ username: $('#uf_un', bg).value, displayName: $('#uf_dn', bg).value, role: $('#uf_role', bg).value }) }] });
      if (!u) return;
      const r = await api('saveUser', { user: u });
      await showTempPassword(r.username, r.tempPassword); renderView();
    },
    'user-edit': async el => {
      const cur = S.users[+el.dataset.i];
      const u = await modal({ title: 'แก้ไขผู้ใช้', body: userForm(cur, false),
        foot: [{ label: 'ยกเลิก', cls: 'ghost', value: null }, { label: 'บันทึก', cls: 'primary', value: bg => ({ username: cur.username, displayName: $('#uf_dn', bg).value, role: $('#uf_role', bg).value, active: $('#uf_act', bg).checked }) }] });
      if (!u) return;
      await api('saveUser', { user: u }); toast('บันทึกแล้ว — ผู้ใช้จะต้องเข้าระบบใหม่หากสิทธิ์เปลี่ยน'); renderView();
    },
    'user-reset': async el => {
      const cur = S.users[+el.dataset.i];
      if (!(await confirmBox('รีเซ็ตรหัสผ่าน', 'สร้างรหัสผ่านชั่วคราวใหม่ให้ ' + esc(cur.username) + '? ผู้ใช้จะถูกออกจากระบบทุกอุปกรณ์', 'รีเซ็ต', 'primary'))) return;
      const r = await api('resetPassword', { username: cur.username });
      await showTempPassword(r.username, r.tempPassword); renderView();
    },
  });

  // ───────────────────────── Settings tab (admin) ─────────────────────────
  async function viewSettings(v) {
    v.innerHTML = '<section class="card"><p class="muted">กำลังโหลด…</p></section>';
    let st;
    try { st = await api('getSettings', {}, { quiet: true }); } catch (e) { v.innerHTML = `<section class="card"><p class="form-error">${esc(e.message)}</p></section>`; return; }
    v.innerHTML = `<section class="card"><div class="card-head"><h2>ตั้งค่าระบบ</h2></div>
      <form id="stForm" class="grid">
        <label class="field"><span>หัวเรื่องใบจัดบิน (ค่าเริ่มต้นของใบใหม่)</span><input name="unitTitle" value="${esc(st.unitTitle)}"></label>
        <label class="field"><span>ลิงก์ Google Sheets รายชื่อกำลังพล (CRM602)</span><input name="crewSheetUrl" value="${esc(st.crewSheetUrl)}" placeholder="https://docs.google.com/spreadsheets/d/…/edit"></label>
        <label class="field"><span>ชื่อแท็บรายชื่อ</span><input name="crewSheetTab" value="${esc(st.crewSheetTab)}"></label>
        <p class="small muted" style="margin:0">แท็บรายชื่อต้องมีคอลัมน์ <b>ID, ฝ่าย, DeptCode, ยศ, ชื่อ-สกุล</b> · ระบบดึงเฉพาะ <b>DeptCode = OPS</b> (นักบินฝ่ายยุทธการ) · ถ้ามีแท็บ PilotHours / PilotQual ระบบจะดึงสถานะใช้งาน สถานะพระราชพาหนะ และคุณสมบัติรายแบบมาแสดงด้วย · บัญชีเจ้าของสคริปต์ต้องมีสิทธิ์อ่านชีตนี้</p>
        <div class="form-error" id="stErr"></div>
        <div class="row"><button class="btn primary" type="submit">บันทึกและทดสอบการเชื่อมต่อ</button></div>
      </form></section>
      <section class="card"><h2>ฐานข้อมูล</h2><p class="small">ใบจัดบิน ผู้ใช้ สถานภาพเครื่องบิน และ log ทั้งหมดอยู่ในไฟล์:<br>
        ${API.DEMO ? esc(st.dbUrl) : `<a href="${esc(st.dbUrl)}" target="_blank" rel="noopener">${esc(st.dbUrl)}</a>`}</p></section>
      <section class="card" id="holCard"></section>`;
    drawHolidays(new Date().getFullYear());
    $('#stForm').onsubmit = async e => {
      e.preventDefault();
      const fd = new FormData(e.target);
      try {
        const r = await api('saveSettings', { settings: Object.fromEntries(fd) }, { silent: true });
        S.settings.unitTitle = r.unitTitle;
        if (r.crewError) $('#stErr').textContent = 'บันทึกแล้ว แต่อ่านรายชื่อไม่สำเร็จ: ' + r.crewError;
        else { toast('บันทึกแล้ว — พบรายชื่อ ' + (r.crewCount || 0) + ' คน'); setCrew(await api('getCrew', {}, { quiet: true })); $('#stErr').textContent = ''; }
      } catch (e2) { $('#stErr').textContent = e2.message; }
    };
  }

  // ───── วันหยุด (admin) ─────
  let holEdit = null;
  function drawHolidays(year) {
    const el = $('#holCard'); if (!el) return;
    holEdit = { year, list: S.holidays.filter(h => h.date.startsWith(year + '-')).map(h => Object.assign({}, h)) };
    const y0 = new Date().getFullYear();
    el.innerHTML = `<div class="card-head"><h2>วันหยุดราชการ / นักขัตฤกษ์</h2><span class="spacer"></span>
        <select class="input" id="holYear" style="width:auto">${[y0 - 1, y0, y0 + 1, y0 + 2].map(y => `<option value="${y}" ${y === year ? 'selected' : ''}>พ.ศ. ${y + 543}</option>`).join('')}</select></div>
      <p class="small muted" style="margin-top:0">เสาร์–อาทิตย์นับเป็นวันหยุดอัตโนมัติ · ใส่วันหยุดนักขัตฤกษ์ วันหยุดชดเชย และวันหยุดพิเศษตามประกาศของปีนั้น
        ระบบใช้ข้อมูลนี้หาช่วง "ชุดถัดไป" เช่น ศุกร์ → ส. อา. จ.</p>
      <div id="holRows"></div>
      <div class="row" style="margin-top:8px"><button class="btn sm ghost" data-act="hol-add">＋ เพิ่มวันหยุด</button><span class="grow"></span>
        <button class="btn sm primary" data-act="hol-save">💾 บันทึกวันหยุดปี ${year + 543}</button></div>`;
    $('#holYear').onchange = e => drawHolidays(Number(e.target.value));
    drawHolRows();
  }
  function drawHolRows() {
    const el = $('#holRows'); if (!el) return;
    el.innerHTML = holEdit.list.length ? `<div class="tbl-wrap"><table class="tbl ac-edit"><thead><tr><th style="width:170px">วันที่</th><th>ชื่อวันหยุด</th><th style="width:50px"></th></tr></thead><tbody>
      ${holEdit.list.map((h, i) => `<tr><td><input type="date" data-hol="${i}.date" value="${esc(h.date)}" min="${holEdit.year}-01-01" max="${holEdit.year}-12-31"></td>
        <td><input data-hol="${i}.name" value="${esc(h.name)}" placeholder="เช่น วันหยุดชดเชย"></td>
        <td><button class="btn sm danger-ghost" data-act="hol-rm" data-i="${i}" aria-label="ลบ">✕</button></td></tr>`).join('')}</tbody></table></div>`
      : '<p class="muted small">ยังไม่มีวันหยุดของปีนี้</p>';
  }
  Object.assign(ACTIONS, {
    'hol-add': () => { holEdit.list.push({ date: '', name: '' }); drawHolRows(); },
    'hol-rm': el => { holEdit.list.splice(+el.dataset.i, 1); drawHolRows(); },
    'hol-save': async () => {
      const list = holEdit.list.filter(h => h.date);
      setHolidays(await api('saveHolidays', { year: String(holEdit.year), holidays: list }));
      drawHolidays(holEdit.year); toast('บันทึกวันหยุดแล้ว');
    },
  });

  // ───────────────────────── Global events ─────────────────────────
  document.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || el.closest('.modal-bg')) return;
    const fn = ACTIONS[el.dataset.act];
    if (fn) { e.preventDefault(); Promise.resolve(fn(el)).catch(() => {}); }
  });
  document.addEventListener('keydown', e => {
    const el = e.target.closest && e.target.closest('.list-item[data-act]');
    if (el && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); ACTIONS[el.dataset.act](el); }
  });
  document.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.bind && S.order && !t.closest('.modal-bg')) {
      setPath(S.order, t.dataset.bind, t.value);
      const m = t.dataset.bind.match(/^(.+)\.name$/);
      if (m) { const parent = getPath(S.order, m[1]); if (parent && 'id' in parent) parent.id = ''; }
      if (t.dataset.bind === 'duty.contact.phone' && S.user) { try { localStorage.setItem('fo602_phone_' + S.user.username, t.value); } catch (e2) { /* ignore */ } }
      if (/\.(director|acCommander)\.(name|position|phone)$/.test(t.dataset.bind)) t.closest('.field').classList.toggle('missing', !t.value.trim());   // พิมพ์ชื่อเอง → ไม่ผูกกับรหัสในฐานข้อมูล
      markDirty();
    } else if (t.dataset.hol && holEdit) {
      const [i, f] = t.dataset.hol.split('.'); holEdit.list[+i][f] = t.value;
    } else if (t.dataset.ac && S.acEdit) {
      const [i, f] = t.dataset.ac.split('.'); S.acEdit[+i][f] = t.value;
    }
  });
  document.addEventListener('change', async e => {
    const t = e.target;
    if (t.hasAttribute('data-time') && t.dataset.bind) {
      let v = t.value.trim().replace(/[.:]/g, '');
      if (/^\d{3}$/.test(v)) v = '0' + v;
      if (/^\d{4}$/.test(v)) { t.value = v; setPath(S.order, t.dataset.bind, v); markDirty(); }
    }
    if (t.dataset.parking && S.order) {
      const path = t.dataset.parking;
      if (t.value === '__other') {
        parkingOther.add(S.date + '|' + path);
        if (PARKING.includes(getPath(S.order, path))) setPath(S.order, path, '');
      } else { parkingOther.delete(S.date + '|' + path); setPath(S.order, path, t.value); }
      markDirty(); renderView();
      if (t.value === '__other') { const el = document.querySelector(`input[data-bind="${path}"]`); if (el) el.focus(); }
      return;
    }
    if (t.dataset.bool && S.order) {
      setPath(S.order, t.dataset.bool, t.checked); markDirty(); renderView(); return;
    }
    if (t.hasAttribute('data-rerender') && t.dataset.bind && S.order) {
      setPath(S.order, t.dataset.bind, t.value);
      const mm = t.dataset.bind.match(/^missions\.(\d+)\.acRole$/);
      if (mm && !t.value) Object.assign(S.order.missions[+mm[1]], { pairTail: '', pairLabel: '' });
      markDirty(); renderView(); return;
    }
    const act = t.dataset.actChange;
    if (act === 'pair') {
      const m = S.order.missions[+t.dataset.m];
      const a = (S.aircraft.list || []).find(x => x.tail === t.value);
      m.pairTail = t.value; m.pairLabel = a ? aircraftLabel(a) : '';
      markDirty(); return;
    }
    if (act === 'aircraft') {
      const m = S.order.missions[+t.dataset.m];
      const a = (S.aircraft.list || []).find(x => x.tail === t.value);
      m.aircraftTail = t.value; m.aircraftType = a ? a.type : (t.value ? m.aircraftType : '');
      m.aircraftLabel = a ? aircraftLabel(a) : (t.value ? m.aircraftLabel : '');
      if (a && a.status && a.status !== 'FMC') toast('หมายเหตุ: ' + a.tail + ' สถานะ ' + a.status, true);
      markDirty(); renderView();
    } else if (act === 'no-mission') {
      const o = S.order;
      if (t.checked) {
        const hasData = o.missions.some(m => comparable({ missions: [m] }) !== comparable({ missions: [blankMission()] }));
        if (hasData && !(await confirmBox('ไม่มีภารกิจ', 'ข้อมูลภารกิจที่กรอกไว้ทั้งหมดจะถูกลบ ต้องการดำเนินการต่อหรือไม่?', 'ยืนยัน', 'bad'))) { t.checked = false; return; }
        o.noMission = true; o.missions = [];
      } else { o.noMission = false; if (!o.missions.length) o.missions.push(blankMission()); }
      markDirty(); renderView();
    }
  });
  document.addEventListener('focusin', e => {   // อัปเดตรายชื่อ น.เอกสาร ในตัวเลือก น.ควบคุมการถ่าย ชพ.
    if (e.target.matches && e.target.matches('select[data-refuel]') && S.order) e.target.innerHTML = refuelOptions();
  });
  window.addEventListener('beforeunload', e => { if (S.user && anyDirty()) { e.preventDefault(); e.returnValue = ''; } });

  // ───────────────────────── Start ─────────────────────────
  async function start() {
    if (API.token) {
      try { await bootstrap(); return; } catch (e) { /* token หมดอายุ */ }
    }
    S.user = null; render();
  }
  // Service worker + อัปเดตอัตโนมัติ: เมื่อมีเวอร์ชันใหม่จะโหลดหน้าใหม่ให้เอง (ถ้าไม่มีงานที่ยังไม่บันทึก)
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    let hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) { hadController = true; return; }   // ติดตั้งครั้งแรก ไม่ต้อง reload
      if (reloading) return;
      if (S.user && anyDirty()) { toast('มีเวอร์ชันใหม่ — บันทึกงานแล้วกดรีเฟรชหน้า'); return; }
      reloading = true; location.reload();
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
      const check = () => reg.update().catch(() => {});
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
      setInterval(check, 30 * 60 * 1000);
    }).catch(() => {});
  }
  window.__fo602 = { S, ACTIONS, nextBatch, setHolidays, loadRange };   // สำหรับ debug/ทดสอบ
  start();
})();
