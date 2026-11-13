/*
 * Demo backend: รัน backend/Code.gs ตัวจริงบนตัวจำลอง แล้วเก็บข้อมูลใน localStorage ของเครื่องนี้เท่านั้น
 * ข้อมูลรายชื่อทั้งหมดเป็นชื่อสมมติ
 */
(function (root) {
  'use strict';
  const STATE_KEY = 'fo602_demo_state_v9';

  const DEMO_USERS = [
    ['admin', 'ผู้ดูแลระบบ (ทดลอง)', 'admin', 'admin1234'],
    ['scheduler', 'ร.อ.จัดบิน ท.', 'scheduler', 'sched1234'],
    ['reviewer', 'น.ท.ผู้พิจารณา ฝ.', 'reviewer', 'rev1234'],
    ['commander', 'น.อ.ผู้บังคับฝูง บ.', 'commander', 'cmdr1234'],
    ['chief', 'น.อ.ผู้พิจารณาและอนุมัติ ส.', 'reviewer,commander', 'chief1234'],
    ['docs', 'ร.อ.ดูแลเอกสาร ป.', 'documents', 'docs1234'],
    ['viewer', 'จ.อ.ผู้ชม ด.', 'viewer', 'view1234'],
  ];

  const FIRST = ['กิตติพงษ์', 'ชยพล', 'ณัฐวุฒิ', 'ธนกฤต', 'ปกรณ์', 'พงศกร', 'ภาณุวัฒน์', 'วรเมธ', 'ศุภชัย', 'อนุชา',
    'กฤษดา', 'จิรายุ', 'ธีรภัทร', 'นพดล', 'ปิยะพงษ์', 'รัฐพล', 'วีรยุทธ', 'สิทธิชัย', 'อภิสิทธิ์', 'เอกชัย'];
  const FIRST_F = ['กมลชนก', 'ชนิดา', 'ณัฐธิดา', 'ปวีณา', 'พิมพ์ชนก', 'วรรณิภา', 'ศิริพร', 'อรอุมา'];
  const LAST = ['แก้วประเสริฐ', 'ใจงาม', 'ทองดี', 'บุญมา', 'ประเสริฐสุข', 'พรหมวงศ์', 'มีสุข', 'รุ่งเรือง', 'ศรีสวัสดิ์',
    'สุขสวัสดิ์', 'เอี่ยมสะอาด', 'โชติช่วง', 'กล้าหาญ', 'นาคประเสริฐ', 'วงศ์ไทย', 'สมบูรณ์', 'อินทรสุวรรณ', 'ชัยมงคล'];

  function demoCrew() {
    const depts = [
      ['ฝ่ายยุทธการ', 'OPS', 16, ['น.อ.', 'น.ท.', 'น.ต.', 'น.ต.', 'ร.อ.', 'ร.อ.', 'ร.ท.']],
      ['ฝ่ายการช่าง', 'ENG', 10, ['พ.อ.อ.', 'พ.อ.อ.', 'จ.อ.', 'พ.อ.ท.']],
      ['ฝ่ายสื่อสารอิเล็กทรอนิกส์', 'COM', 5, ['พ.อ.อ.', 'จ.อ.']],
      ['ฝ่ายพนักงานต้อนรับบนอากาศยาน', 'CAB', 6, ['พ.อ.อ.หญิง', 'จ.อ.หญิง', 'จ.ท.หญิง']],
      ['ฝ่ายขนส่งประจำอากาศยาน', 'LOG', 5, ['ร.อ.', 'พ.อ.อ.', 'จ.อ.']],
    ];
    const rows = [['ID', 'ฝ่าย', 'DeptCode', 'ยศ', 'ชื่อ-สกุล', 'เบอร์โทร', 'ตำแหน่ง']];
    let k = 0;
    depts.forEach(([name, code, n, ranks]) => {
      for (let i = 1; i <= n; i++, k++) {
        const female = code === 'CAB';
        const first = female ? FIRST_F[(i * 3) % FIRST_F.length] : FIRST[(k * 7) % FIRST.length];
        const last = LAST[(k * 5 + i) % LAST.length];
        rows.push([code + String(i).padStart(3, '0'), name, code, ranks[Math.min(i - 1, ranks.length - 1) % ranks.length], first + ' ' + last, '08' + String(10000000 + k * 7919).slice(-8).replace(/^(\d)(\d{3})(\d{4})$/, '$1-$2-$3'), code === 'OPS' ? (['ผบ.ฝูง.602', 'รอง ผบ.ฝูง.602', 'ผบ.หมวด', 'นายทหารยุทธการ', 'นักบินประจำฝูง'][Math.min(i - 1, 4)]) : '']);
      }
    });
    const hours = [['PilotID', 'ชื่อ (อัตโนมัติ)', 'รุ่น', 'ชม.รวม', 'ชม.ME', 'สถานะพระราชพาหนะ', 'ใช้งาน (Y/N)']];
    const qual = [['PilotID', 'ชื่อ (อัตโนมัติ)', 'แบบอากาศยาน', 'ชม.เฉพาะแบบ', 'ชม.เป็น นบ.1 บนแบบนี้', 'ฝป.', 'ฝพ.', 'นบ.2', 'นบ.1', 'นลค.', 'คบ.']];
    rows.filter(r => r[2] === 'OPS').forEach((r, i) => {
      hours.push([r[0], r[3] + ' ' + r[4], 50, 6000 - i * 350, 5000 - i * 320, i < 2 ? 'นบ.1 ราช' : i < 5 ? 'นบ.2 ราช' : '', i === 15 ? 'N' : 'Y']);
      const lv = i < 3 ? ['', '', '', '', 'ผ่าน', 'ผ่าน'] : i < 8 ? ['', '', '', 'ผ่าน', '', ''] : i < 12 ? ['', '', 'ผ่าน', '', '', ''] : ['', 'กำลังฝึก', '', '', '', ''];
      qual.push([r[0], '', i % 3 === 2 ? 'A340' : 'A319/320', 1000 - i * 50, ''].concat(lv));
    });
    return { Crew: rows, PilotHours: hours, PilotQual: qual };
  }

  const DEMO_AIRCRAFT = [
    ['60202', 'A319 CJ', 'บ.ล.15', 'NMCM', 'ตัวอย่าง: รอซ่อมสีลำตัว', 'C-Check ธ.ค.'],
    ['60205', 'ACJ320', 'บ.ล.15 ก', 'FMC', 'ตัวอย่าง: ตรวจตามระยะเวลา', '12M ธ.ค.'],
    ['60204', 'A340', 'บ.ล.16', 'FMC', '', '6M พ.ย.–ธ.ค.'],
    ['60206', 'SSJ100', 'บ.ล.17', 'NMCB', 'ตัวอย่าง: NLG HYD LEAK', 'A/C PRESERVATION'],
  ];

  function todayKey(offsetDays) {
    const t = new Date(Date.now() + 7 * 3600000 + (offsetDays || 0) * 86400000);
    return t.toISOString().slice(0, 10);
  }

  function seed(gs, env) {
    gs.setup();
    gs._resetDbCache();
    const ss = gs.db_();
    const users = ss.getSheetByName('Users');
    const rows = DEMO_USERS.map(u => [u[0], u[1], u[2], gs.hashPassword_(u[3]), true, false, '2026-01-01 00:00:00', '']);
    users.getRange(2, 1, rows.length, 8).setValues(rows);

    const crewFile = env.SpreadsheetApp.create('CRM602_Database (ตัวอย่าง)');
    const crewData = demoCrew();
    Object.keys(crewData).forEach(name => {
      const sh = crewFile.insertSheet(name);
      sh.getRange(1, 1, crewData[name].length, crewData[name][0].length).setValues(crewData[name]);
    });
    env.PropertiesService.getScriptProperties().setProperty('CREW_SHEET_ID', crewFile.getId());

    const ac = ss.getSheetByName('Aircraft');
    ac.getRange(2, 1, DEMO_AIRCRAFT.length, 9).setValues(DEMO_AIRCRAFT.map((a, i) => a.concat([i + 1, 'ระบบ', '2026-01-01 00:00:00'])));
    env.PropertiesService.getScriptProperties().setProperty('AIRCRAFT_VERSION', '1');

    // วันหยุดตัวอย่าง (โหมดทดลองเท่านั้น — ระบบจริงให้ admin ใส่ตามประกาศของปีนั้น)
    const hol = ss.getSheetByName('Holidays');
    const H = [['2026-12-05', 'วันพ่อแห่งชาติ (ตัวอย่าง)'], ['2026-12-07', 'วันหยุดชดเชย (ตัวอย่าง)'],
      ['2026-12-10', 'วันรัฐธรรมนูญ (ตัวอย่าง)'], ['2026-12-31', 'วันสิ้นปี (ตัวอย่าง)'], ['2027-01-01', 'วันขึ้นปีใหม่ (ตัวอย่าง)']];
    hol.getRange(2, 1, H.length, 2).setValues(H);

    // LINE OA ทดลอง (ไม่ส่งจริง — ดูข้อความที่ "ส่ง" ได้จากเมนูผู้ใช้)
    const P = env.PropertiesService.getScriptProperties();
    P.setProperty('LINE_TOKEN', 'demo-token'); P.setProperty('LINE_BOT_ID', 'Udemobot0000000000000000000000000'); P.setProperty('LINE_BASIC_ID', '@demo602');
  }

  function createDemoBackend(source, opts) {
    opts = opts || {};
    const storage = opts.storage !== undefined ? opts.storage : (root.localStorage || null);
    let state = null;
    if (storage) { try { state = JSON.parse(storage.getItem(STATE_KEY) || 'null'); } catch (e) { state = null; } }
    let dirty = false;
    const env = root.GasEmulator.createEnv({ state: state || undefined, onChange: () => { dirty = true; } });
    const gs = root.GasEmulator.loadScript(source, env);
    if (!state) seed(gs, env);
    const save = () => { if (storage && dirty) { storage.setItem(STATE_KEY, JSON.stringify(env.store)); dirty = false; } };
    save();
    return {
      demo: true,
      users: DEMO_USERS.map(u => ({ username: u[0], password: u[3], role: u[2] })),
      call(body) {
        gs._resetDbCache();
        const out = gs.doPost({ postData: { contents: JSON.stringify(body) } });
        save();
        return JSON.parse(out.getContent());
      },
      reset() { if (storage) storage.removeItem(STATE_KEY); },
      /** จำลองว่าผู้ใช้ส่งข้อความหา OA (เช่น สแกน QR แล้วกดส่ง) */
      simulateLine(text, userId) {
        gs._resetDbCache();
        gs.doPost({ postData: { contents: JSON.stringify({ destination: 'Udemobot0000000000000000000000000', events: [
          { type: 'follow', replyToken: 'demo', source: { type: 'user', userId } },
          { type: 'message', replyToken: 'demo', source: { type: 'user', userId }, message: { type: 'text', text } }] }) } });
        save();
        const log = env.store.lineSent || [];
        return log[log.length - 1];
      },
      lineLog() { return (env.store.lineSent || []).slice().reverse(); },
      _gs: gs, _env: env, todayKey,
    };
  }

  const api = { createDemoBackend, DEMO_USERS, todayKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DemoBackend = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
