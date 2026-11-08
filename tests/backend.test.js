// ทดสอบ backend/Code.gs บนตัวจำลอง:  node tests/backend.test.js
const fs = require('fs');
const path = require('path');
const assert = require('assert');
globalThis.GasEmulator = require('../js/demo/gas-emulator.js');
const { createDemoBackend, todayKey } = require('../js/demo/demo-backend.js');

const src = fs.readFileSync(path.join(__dirname, '../backend/Code.gs'), 'utf8');
const be = createDemoBackend(src, { storage: null });
let passed = 0;
function ok(name, fn) { fn(); passed++; console.log('  ✓ ' + name); }
const call = b => be.call(b);
const must = b => { const r = call(b); if (!r.ok) throw new Error(b.action + ': ' + r.code + ' ' + r.error); return r.data; };
const fail = (b, code) => { const r = call(b); assert.strictEqual(r.ok, false, b.action + ' should fail'); if (code) assert.strictEqual(r.code, code, r.error); return r; };
const login = (u, p) => must({ action: 'login', username: u, password: p }).token;

const D = '2026-11-09';
let tA, tS, tC, tV;

ok('login all roles / bad password / lockout', () => {
  tA = login('admin', 'admin1234'); tS = login('scheduler', 'sched1234');
  tC = login('commander', 'cmdr1234'); tV = login('viewer', 'view1234');
  fail({ action: 'login', username: 'viewer', password: 'x' }, 'BAD_LOGIN');
  for (let i = 0; i < 5; i++) call({ action: 'login', username: 'nobody', password: 'x' });
  fail({ action: 'login', username: 'nobody', password: 'x' }, 'LOCKED_OUT');
  fail({ action: 'me', token: 'bogus' }, 'AUTH');
});

ok('crew short names + quals', () => {
  const crew = must({ action: 'getCrew', token: tS });
  assert.strictEqual(crew.people.length, 16, 'OPS only');
  assert(crew.people.every(x => x.deptCode === 'OPS'));
  const p = crew.people[0];
  assert(/^[^ ]+\.[^ ]+ .\.$/.test(p.short), p.short);
  assert(crew.people.some(x => x.quals));
  const g = be._gs;
  assert.strictEqual(g.shortName_('น.ต.', 'ธนพัฒน์', 'เล็กขาว'), 'น.ต.ธนพัฒน์ ล.');
  assert.strictEqual(g.shortName_('พ.อ.อ.หญิง', 'ณัฐรดา', 'สุรเสน'), 'พ.อ.อ.หญิง ณัฐรดา ส.');
});

const order = (title) => ({
  title: 'ใบจัดบิน', duty: { scheduler: { id: 'OPS005', name: 'ร.อ.ทดสอบ ท.' } },
  missions: [{ id: 'a', aircraftTail: '60205', aircraftType: 'ACJ320', type: 'ภารกิจ', title, callsign: 'WHK05',
    times: { brief: '0640', tow: '0650', takeoff: '0730' }, parking: { out: 'บน.6', ret: 'บน.6' },
    crew: [{ id: 'OPS001', name: 'น.อ.ก ข.', dept: 'OPS', role: 'นบ.1' }, { id: 'ENG001', name: 'พ.อ.อ.ค ง.', dept: 'ENG', role: 'ช่างอากาศ' }] }],
});

let v;
ok('scheduler saves → PENDING; viewer cannot save or see', () => {
  const r = must({ action: 'saveOrder', token: tS, date: D, order: order('ทดสอบ 1'), baseVersion: 0 });
  assert.strictEqual(r.status, 'PENDING'); v = r.version;
  fail({ action: 'saveOrder', token: tV, date: D, order: order('x'), baseVersion: v }, 'FORBIDDEN');
  fail({ action: 'saveOrder', token: tC, date: D, order: order('x'), baseVersion: v }, 'FORBIDDEN');
  const hv = must({ action: 'getOrder', token: tV, date: D });
  assert.strictEqual(hv.hidden, true);
  assert.strictEqual(must({ action: 'listOrders', token: tV }).length, 0);
});

ok('conflict detection on stale version', () => {
  fail({ action: 'saveOrder', token: tA, date: D, order: order('stale'), baseVersion: v + 5 }, 'CONFLICT');
});

ok('release requires approval; scheduler cannot approve', () => {
  fail({ action: 'releaseOrder', token: tS, date: D, version: v }, 'BAD_STATE');
  fail({ action: 'approveOrder', token: tS, date: D, version: v }, 'FORBIDDEN');
});

ok('commander deny needs reason; deny then edit → PENDING', () => {
  fail({ action: 'denyOrder', token: tC, date: D, version: v, reason: '  ' }, 'BAD_REQUEST');
  const r = must({ action: 'denyOrder', token: tC, date: D, version: v, reason: 'เวลา brief ไม่ถูก' });
  assert.strictEqual(r.status, 'DENIED'); assert.strictEqual(r.denyReason, 'เวลา brief ไม่ถูก');
  const r2 = must({ action: 'saveOrder', token: tS, date: D, order: order('แก้แล้ว'), baseVersion: r.version });
  assert.strictEqual(r2.status, 'PENDING'); v = r2.version;
});

ok('approve on stale version rejected, then approve → release → locked', () => {
  fail({ action: 'approveOrder', token: tC, date: D, version: v - 1 }, 'CONFLICT');
  const a = must({ action: 'approveOrder', token: tC, date: D, version: v });
  assert.strictEqual(a.status, 'APPROVED'); assert(a.approvedBy);
  const rel = must({ action: 'releaseOrder', token: tS, date: D, version: a.version });
  assert.strictEqual(rel.status, 'RELEASED'); assert(rel.order.aircraftSnapshot.length > 0);
  fail({ action: 'saveOrder', token: tS, date: D, order: order('x'), baseVersion: rel.version }, 'LOCKED');
  const hv = must({ action: 'getOrder', token: tV, date: D });
  assert.strictEqual(hv.order.missions[0].title, 'แก้แล้ว');
  v = rel.version;
});

ok('edit with identical content keeps APPROVED', () => {
  const D2 = '2026-11-10';
  const s = must({ action: 'saveOrder', token: tS, date: D2, order: order('same'), baseVersion: 0 });
  const a = must({ action: 'approveOrder', token: tA, date: D2, version: s.version });
  const s2 = must({ action: 'saveOrder', token: tS, date: D2, order: order('same'), baseVersion: a.version });
  assert.strictEqual(s2.status, 'APPROVED');
  const s3 = must({ action: 'saveOrder', token: tS, date: D2, order: order('changed'), baseVersion: s2.version });
  assert.strictEqual(s3.status, 'PENDING');
});

ok('revise released order → PENDING, rev 2', () => {
  fail({ action: 'reviseOrder', token: tS, date: D, reason: '' }, 'BAD_REQUEST');
  const r = must({ action: 'reviseOrder', token: tS, date: D, reason: 'เปลี่ยนเครื่อง' });
  assert.strictEqual(r.status, 'PENDING'); assert.strictEqual(r.revision, 2);
  assert(!r.order.aircraftSnapshot);
  assert(r.log.some(l => l.action === 'revise'));
});

ok('no-mission order', () => {
  const r = must({ action: 'saveOrder', token: tS, date: '2026-11-11', order: { noMission: true, missions: [] }, baseVersion: 0 });
  assert.strictEqual(r.order.noMission, true); assert.strictEqual(r.missionCount, 0);
});

ok('flat logs + stats count released only', () => {
  const r = must({ action: 'getOrder', token: tS, date: D });
  const a = must({ action: 'approveOrder', token: tC, date: D, version: r.version });
  must({ action: 'releaseOrder', token: tS, date: D, version: a.version });
  const st = must({ action: 'stats', token: tV, from: '2026-11-01', to: '2026-11-30' });
  assert.strictEqual(st.totalMissions, 1);
  assert.strictEqual(st.byPerson.length, 2);
  const ml = be._gs.db_().getSheetByName('MissionLog').getDataRange().getValues();
  assert.strictEqual(ml.filter(x => x[0] === D).length, 1);
});

ok('aircraft save with version + permission', () => {
  const ac = must({ action: 'getAircraft', token: tV });
  fail({ action: 'saveAircraft', token: tV, aircraft: ac.list, baseVersion: ac.version }, 'FORBIDDEN');
  fail({ action: 'saveAircraft', token: tC, aircraft: ac.list, baseVersion: ac.version }, 'FORBIDDEN');
  const list = ac.list.map(x => Object.assign({}, x)); list[0].status = 'FMC';
  const r = must({ action: 'saveAircraft', token: tS, aircraft: list, baseVersion: ac.version });
  assert.strictEqual(r.list[0].status, 'FMC'); assert.strictEqual(r.version, ac.version + 1);
  fail({ action: 'saveAircraft', token: tS, aircraft: list, baseVersion: ac.version }, 'CONFLICT');
  const dup = r.list.concat([{ tail: r.list[0].tail }]);
  fail({ action: 'saveAircraft', token: tS, aircraft: dup, baseVersion: r.version }, 'BAD_REQUEST');
});

ok('user management: create, must change, revoke on role change', () => {
  fail({ action: 'listUsers', token: tS }, 'FORBIDDEN');
  const c = must({ action: 'saveUser', token: tA, user: { username: 'newbie', displayName: 'ใหม่', role: 'viewer' } });
  assert(c.tempPassword.length === 10);
  const t = login('newbie', c.tempPassword);
  const me = must({ action: 'bootstrap', token: t });
  assert.strictEqual(me.user.mustChange, true); assert(!me.aircraft);
  fail({ action: 'listOrders', token: t }, 'MUST_CHANGE');
  fail({ action: 'changePassword', token: t, oldPassword: c.tempPassword, newPassword: 'short' }, 'BAD_REQUEST');
  must({ action: 'changePassword', token: t, oldPassword: c.tempPassword, newPassword: 'newpassword1' });
  fail({ action: 'me', token: t }, 'AUTH');          // session revoked after change
  const t2 = login('newbie', 'newpassword1');
  must({ action: 'listOrders', token: t2 });
  must({ action: 'saveUser', token: tA, user: { username: 'newbie', displayName: 'ใหม่', role: 'scheduler' } });
  fail({ action: 'me', token: t2 }, 'AUTH');          // role change revokes
  fail({ action: 'saveUser', token: tA, user: { username: 'admin', displayName: 'x', role: 'viewer' } }, 'BAD_REQUEST');
  must({ action: 'saveUser', token: tA, user: { username: 'newbie', displayName: 'ใหม่', role: 'viewer', active: false } });
  fail({ action: 'login', username: 'newbie', password: 'newpassword1' }, 'BAD_LOGIN');
});

ok('settings: admin only', () => {
  fail({ action: 'getSettings', token: tS }, 'FORBIDDEN');
  const s = must({ action: 'getSettings', token: tA });
  assert(s.crewSheetUrl);
  fail({ action: 'saveSettings', token: tA, settings: { crewSheetUrl: 'not a url' } }, 'BAD_REQUEST');
});

ok('sanitizer strips unknown fields & caps sizes', () => {
  const r = must({ action: 'saveOrder', token: tS, date: '2026-11-12',
    order: { evil: '<script>', missions: [{ title: 'x'.repeat(5000), crew: [{ id: 'A', hack: 1 }] }] }, baseVersion: 0 });
  assert(!('evil' in r.order)); assert.strictEqual(r.order.missions[0].title.length, 1000);
  assert(!('hack' in r.order.missions[0].crew[0]));
  fail({ action: 'getOrder', token: tS, date: '9/11/2569' }, 'BAD_REQUEST');
});

ok('admin delete order', () => {
  fail({ action: 'deleteOrder', token: tS, date: '2026-11-12' }, 'FORBIDDEN');
  assert.strictEqual(must({ action: 'deleteOrder', token: tA, date: '2026-11-12' }).deleted, true);
  assert.strictEqual(must({ action: 'getOrder', token: tA, date: '2026-11-12' }).exists, false);
});


// ───────── ชุดวันหยุด ─────────
ok('nextBatch: weekday → tomorrow; Friday → Sat–Mon; long weekend; midweek holiday', () => {
  const nb = be._gs.nextBatch_;
  const H = [{ date: '2026-12-07' }, { date: '2026-12-10' }];
  assert.deepStrictEqual(nb('2026-11-10', H), { from: '2026-11-11', to: '2026-11-11' });   // อ. → พ.
  assert.deepStrictEqual(nb('2026-11-13', H), { from: '2026-11-14', to: '2026-11-16' });   // ศ. → ส.–จ.
  assert.deepStrictEqual(nb('2026-12-04', H), { from: '2026-12-05', to: '2026-12-08' });   // ศ. + จ.หยุดชดเชย → ส.–อ.
  assert.deepStrictEqual(nb('2026-12-09', H), { from: '2026-12-10', to: '2026-12-11' });   // อ. ก่อนวันหยุดกลางสัปดาห์
  assert.deepStrictEqual(nb('2026-11-14', H), { from: '2026-11-15', to: '2026-11-16' });   // ทำงานวันเสาร์
});

ok('holidays: admin only, replace per year, validation', () => {
  fail({ action: 'saveHolidays', token: tS, year: '2027', holidays: [] }, 'FORBIDDEN');
  fail({ action: 'saveHolidays', token: tA, year: '2027', holidays: [{ date: '2026-05-01', name: 'x' }] }, 'BAD_REQUEST');
  const r = must({ action: 'saveHolidays', token: tA, year: '2027', holidays: [{ date: '2027-04-13', name: 'สงกรานต์' }, { date: '2027-04-14', name: '' }] });
  assert(r.some(h => h.date === '2026-12-05'), 'other years kept');
  assert.strictEqual(r.filter(h => h.date.startsWith('2027')).length, 2, '2027 replaced');
  assert.strictEqual(r.find(h => h.date === '2027-04-14').name, 'วันหยุด');
  assert(must({ action: 'getHolidays', token: tV }).length >= 2);
});

const F = '2026-11-21', SU = '2026-11-22', MO = '2026-11-23';
let batch;
ok('saveBatch Sat–Mon creates 3 days with shared batchId', () => {
  const days = [F, SU, MO].map((d, i) => ({ date: d, order: i === 1 ? { noMission: true, missions: [] } : order('ชุด ' + d), baseVersion: 0 }));
  const r = must({ action: 'saveBatch', token: tS, days, batchDates: [F, SU, MO] });
  assert.strictEqual(r.batchId, F + '..' + MO);
  assert(r.days.every(d => d.exists && d.status === 'PENDING' && d.batchId === r.batchId));
  batch = r.days;
  const list = must({ action: 'listOrders', token: tC, from: F, to: MO });
  assert(list.every(x => x.batchId === r.batchId));
});

ok('saveBatch is all-or-nothing on conflict', () => {
  const days = [{ date: F, order: order('changed F'), baseVersion: batch[0].version },
                { date: SU, order: order('stale'), baseVersion: batch[1].version + 9 }];
  fail({ action: 'saveBatch', token: tS, days, batchDates: [F, SU, MO] }, 'CONFLICT');
  const f = must({ action: 'getOrder', token: tS, date: F });
  assert.strictEqual(f.version, batch[0].version, 'F not written');
});

ok('commander default range = pending batch; approve whole batch in one call', () => {
  const tC2 = login('commander', 'cmdr1234');
  const b = must({ action: 'bootstrap', token: tC2 });
  // ค่าเริ่มต้นคือชุดที่รอพิจารณาเร็วที่สุดตั้งแต่วันนี้ (ขึ้นกับวันที่จริงของเครื่อง)
  assert(b.range.days.length >= 1 && b.holidays.length >= 1);
  const items = batch.map(d => ({ date: d.date, version: d.version }));
  fail({ action: 'approveBatch', token: tS, items }, 'FORBIDDEN');
  const stale = items.map((x, i) => i === 2 ? { date: x.date, version: x.version - 1 } : x);
  fail({ action: 'approveBatch', token: tC, items: stale }, 'CONFLICT');
  assert.strictEqual(must({ action: 'getOrder', token: tC, date: F }).status, 'PENDING', 'nothing approved on conflict');
  const r = must({ action: 'approveBatch', token: tC, items, note: 'ok ทั้งชุด' });
  assert(r.days.every(d => d.status === 'APPROVED'));
  batch = r.days;
});

ok('release batch requires all approved; edit one day → that day back to PENDING', () => {
  const s1 = must({ action: 'saveBatch', token: tS, days: [{ date: SU, order: order('มีภารกิจแล้ว'), baseVersion: batch[1].version }], batchDates: [F, SU, MO] });
  assert.strictEqual(s1.days[1].status, 'PENDING'); assert.strictEqual(s1.days[0].status, 'APPROVED');
  const items = s1.days.map(d => ({ date: d.date, version: d.version }));
  fail({ action: 'releaseBatch', token: tS, items }, 'BAD_STATE');
  const a = must({ action: 'approveBatch', token: tC, items });         // approved days are skipped, pending approved
  assert(a.days.every(d => d.status === 'APPROVED'));
  const rel = must({ action: 'releaseBatch', token: tS, items: a.days.map(d => ({ date: d.date, version: d.version })) });
  assert(rel.days.every(d => d.status === 'RELEASED' && d.order.aircraftSnapshot));
  const v = must({ action: 'getRange', token: tV, from: F, to: MO });
  assert(v.days.every(d => d.order), 'viewer sees released batch');
});

ok('deny batch with reason; viewer cannot see', () => {
  const days = ['2026-11-28', '2026-11-29'].map(d => ({ date: d, order: order(d), baseVersion: 0 }));
  const r = must({ action: 'saveBatch', token: tS, days, batchDates: days.map(d => d.date) });
  fail({ action: 'denyBatch', token: tC, items: r.days.map(d => ({ date: d.date, version: d.version })), reason: '' }, 'BAD_REQUEST');
  const dn = must({ action: 'denyBatch', token: tC, items: r.days.map(d => ({ date: d.date, version: d.version })), reason: 'วันอาทิตย์ยังไม่มี นบ.2' });
  assert(dn.days.every(d => d.status === 'DENIED' && d.denyReason === 'วันอาทิตย์ยังไม่มี นบ.2'));
  assert(must({ action: 'getRange', token: tV, from: '2026-11-28', to: '2026-11-29' }).days.every(d => d.hidden));
  fail({ action: 'getRange', token: tV, from: '2026-01-01', to: '2026-03-01' }, 'BAD_REQUEST');
});

ok('documents role: sees unreleased, read-only everywhere', () => {
  const tD = login('docs', 'docs1234');
  const D3 = '2026-11-30';
  const s = must({ action: 'saveOrder', token: tS, date: D3, order: order('สำหรับผู้ดูแลเอกสาร'), baseVersion: 0 });
  const g = must({ action: 'getOrder', token: tD, date: D3 });
  assert.strictEqual(g.status, 'PENDING'); assert.strictEqual(g.order.missions[0].title, 'สำหรับผู้ดูแลเอกสาร');
  assert(must({ action: 'listOrders', token: tD }).some(x => x.status !== 'RELEASED'), 'sees unreleased in history');
  assert(must({ action: 'getRange', token: tD, from: '2026-11-28', to: '2026-11-29' }).days.every(d => !d.hidden && d.order));
  fail({ action: 'saveOrder', token: tD, date: D3, order: order('x'), baseVersion: s.version }, 'FORBIDDEN');
  fail({ action: 'saveBatch', token: tD, days: [{ date: D3, order: order('x'), baseVersion: s.version }] }, 'FORBIDDEN');
  fail({ action: 'approveBatch', token: tD, items: [{ date: D3, version: s.version }] }, 'FORBIDDEN');
  fail({ action: 'denyOrder', token: tD, date: D3, version: s.version, reason: 'x' }, 'FORBIDDEN');
  fail({ action: 'releaseBatch', token: tD, items: [{ date: D3, version: s.version }] }, 'FORBIDDEN');
  fail({ action: 'reviseOrder', token: tD, date: D, reason: 'x' }, 'FORBIDDEN');
  fail({ action: 'deleteOrder', token: tD, date: D3 }, 'FORBIDDEN');
  const ac = must({ action: 'getAircraft', token: tD });
  fail({ action: 'saveAircraft', token: tD, aircraft: ac.list, baseVersion: ac.version }, 'FORBIDDEN');
  fail({ action: 'listUsers', token: tD }, 'FORBIDDEN');
  fail({ action: 'saveHolidays', token: tD, year: '2027', holidays: [] }, 'FORBIDDEN');
  must({ action: 'stats', token: tD, from: '2026-11-01', to: '2026-11-30' });
  const nu = must({ action: 'saveUser', token: tA, user: { username: 'docs2', displayName: 'เอกสาร 2', role: 'documents' } });
  assert(nu.tempPassword);
});

ok('schema v2: duty lists, refuel from documents, STBY, mission fields', () => {
  const D4 = '2026-12-15';
  const o = {
    title: 'แก้หัวเรื่องเอง',
    duty: { scheduler: { id: 'OPS005', name: 'เก่า ก.' },                 // ข้อมูลแบบเดิม → ย้ายเป็น schedulers
      documents: [{ name: 'เอกสาร 1' }, { name: 'เอกสาร 2' }, { name: 'เอกสาร 3' }, { name: 'เกิน' }], refuelIdx: '1',
      wingDutyAsst: { name: 'ผช.เวร' } },
    standby: { royal320: { on: true, pilots: [{ id: 'OPS001', name: 'ก ข.' }, { id: 'OPS002', name: 'ค ง.' }, { name: '' }, { name: 'เกิน' }] },
      a340: { on: false, pilots: [{ name: 'ไม่แสดง' }] } },
    missions: [{ type: 'ฝึกบิน', fuel: '9.5 TONS', times: { tow: '0650', towMode: 'taxi' }, acRole: 'spare', pairTail: '60205', pairLabel: 'ACJ320 (60205)',
      director: { on: true, name: 'ผอ.', position: 'ผอ.กอง', phone: '02' }, acCommander: { on: 'x' }, crew: [{ id: 'OPS003', name: 'จ ฉ.', role: 'นบ.1' }] },
      { acRole: 'hack', times: {} }],
  };
  const r = must({ action: 'saveOrder', token: tS, date: D4, order: o, baseVersion: 0 });
  const x = r.order;
  assert.strictEqual(x.schema, 2);
  assert.deepStrictEqual(x.duty.schedulers.map(p => p.name), ['เก่า ก.']);
  assert.strictEqual(x.duty.documents.length, 3, 'documents max 3');
  assert.strictEqual(x.duty.refuelIdx, 1); assert.strictEqual(x.duty.refuel.name, 'เอกสาร 2');
  assert.strictEqual(x.duty.wingDutyAsst.name, 'ผช.เวร');
  assert.strictEqual(x.standby.royal320.pilots.length, 3, 'royal STBY 3 slots');
  assert.strictEqual(x.standby.a320.on, false);
  const m = x.missions[0];
  assert.strictEqual(m.fuel, '9.5'); assert.strictEqual(m.times.towMode, 'taxi'); assert.strictEqual(m.acRole, 'spare');
  assert.strictEqual(m.director.on, true); assert.strictEqual(m.acCommander.on, true);
  assert.strictEqual(x.missions[1].acRole, ''); assert.strictEqual(x.missions[1].times.towMode, 'tow');
  const bad = must({ action: 'saveOrder', token: tS, date: D4, order: Object.assign({}, o, { duty: { documents: [{ name: 'a' }], refuelIdx: 2 } }), baseVersion: r.version });
  assert.strictEqual(bad.order.duty.refuelIdx, -1, 'refuel index out of range → none');
  // STBY อยู่ใน CrewLog แต่ไม่นับเป็นเที่ยวบิน
  const ap = must({ action: 'approveOrder', token: tC, date: D4, version: bad.version });
  const back = must({ action: 'saveOrder', token: tS, date: D4, order: o, baseVersion: ap.version });
  const ap2 = must({ action: 'approveOrder', token: tC, date: D4, version: back.version });
  must({ action: 'releaseOrder', token: tS, date: D4, version: ap2.version });
  const cl = be._gs.db_().getSheetByName('CrewLog').getDataRange().getValues().filter(rw => rw[0] === D4);
  assert.strictEqual(cl.filter(rw => rw[2] === 'STBY').length, 2, '2 named royal STBY rows');
  const st = must({ action: 'stats', token: tA, from: D4, to: D4 });
  assert.strictEqual(st.byPerson.length, 1); assert.strictEqual(st.byStandby.length, 2);
  assert.strictEqual(st.standbyByType[0].key, 'STBY A319/ACJ320 นบ.ราชฯ');
});

console.log('\n' + passed + ' tests passed');
