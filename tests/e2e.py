# End-to-end test of the PWA in demo mode (headless Chrome).  python3 tests/e2e.py
# ต้องเปิด server ก่อน:  python3 -m http.server 8602
import sys, os
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://localhost:8602/')
OUT = os.environ.get('OUT', '/tmp/fo602')
os.makedirs(OUT, exist_ok=True)
errors = []
D1 = '2026-12-01'                                   # อังคาร — ใบรายวัน
FRI = '2026-12-04'                                  # ศุกร์ (จ. 7 ธ.ค. เป็นวันหยุดชดเชยในข้อมูลทดลอง)
BATCH = ['2026-12-05', '2026-12-06', '2026-12-07', '2026-12-08']

def login(page, role):
    page.goto(BASE)
    page.wait_for_selector('#demoUsers button')
    page.click(f'#demoUsers button:has-text("{role}")')
    page.wait_for_selector('.topbar')
    page.wait_for_selector('#view .card')

def logout(page):
    page.evaluate("window.onbeforeunload=null")
    page.click('#userBtn'); page.click('[data-act=logout]')
    if page.locator('.modal-foot').count(): page.click('.modal-foot button:has-text("ออกจากระบบ")')
    page.wait_for_selector('#loginForm')

def goto(page, a, b=None):
    page.evaluate("([a,b]) => window.__fo602.loadRange(a, b || a, a)", [a, b])
    page.wait_for_function("([a,b]) => { const S = window.__fo602.S; return S.range[0] === a && S.range[S.range.length-1] === (b || a); }", arg=[a, b])
    page.wait_for_selector('.day-card')

def modal_btn(page, label):
    page.click(f'.modal-foot button:has-text("{label}")')

def tab(page, date):
    page.click(f'.day-tab[data-d="{date}"]'); page.wait_for_selector(f'.day-tab.on[data-d="{date}"]')

def statuses(page):
    return page.evaluate("() => { const S = window.__fo602.S; return S.range.map(d => (S.days[d].meta.exists ? S.days[d].meta.status : 'NEW')); }")

def pick_pilots(page, m, n):
    page.click(f'[data-act=pick-crew][data-m="{m}"]'); page.wait_for_selector('.pick')
    for i in range(n): page.click(f'.pick >> nth={i}')
    modal_btn(page, 'เสร็จ'); page.wait_for_selector('.modal-bg', state='detached')

with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome', args=['--no-sandbox'])
    ctx = b.new_context(viewport={'width': 1280, 'height': 900}, locale='th-TH')
    page = ctx.new_page()
    page.on('pageerror', lambda e: errors.append('pageerror: ' + str(e)))
    page.on('console', lambda m: m.type == 'error' and errors.append('console: ' + m.text))

    # ── 1. ใบรายวัน ──
    login(page, 'ผู้จัดบิน')
    goto(page, D1)
    assert page.locator('.mission').count() == 1, 'default 1 mission'
    assert page.locator('.day-tab').count() == 0, 'no tabs for single day'
    page.fill('[data-bind="duty.wingDuty.name"]', 'น.ต.เวรทดสอบ ก.')
    page.click('[data-act=pick-duty][data-path="duty.scheduler"]')
    page.wait_for_selector('.pick'); page.click('.pick >> nth=0'); page.wait_for_selector('.modal-bg', state='detached')
    page.select_option('[data-act-change=aircraft][data-m="0"]', '60205')
    page.fill('[data-bind="missions.0.callsign"]', 'WHK05')
    page.fill('[data-bind="missions.0.title"]', 'ภารกิจทดสอบ ส่งคณะ')
    t = page.locator('[data-bind="missions.0.times.brief"]'); t.fill('640'); t.press('Tab')
    assert page.input_value('[data-bind="missions.0.times.brief"]') == '0640', 'time pad'
    pick_pilots(page, 0, 5)
    page.select_option('[data-bind="missions.0.crew.0.role"]', 'นบ.1 ราช')
    page.select_option('[data-bind="missions.0.crew.1.role"]', 'ฝป(พ.)')
    assert page.locator('[data-bind="missions.0.crew.0.role"] option').count() == 15, 'role list'
    page.click('[data-act=mission-add]'); page.click('[data-act=mission-add]')
    page.click('[data-act=mission-rm][data-m="2"]')
    assert page.locator('.mission').count() == 2
    page.select_option('[data-act-change=aircraft][data-m="1"]', '60204')
    page.fill('[data-bind="missions.1.title"]', 'ฝึกบินตามแผน')
    pick_pilots(page, 1, 1)
    assert page.locator('#mission-1 .dup').count() == 1, 'duplicate badge'
    page.click('.card [data-act=save] >> nth=0'); page.wait_for_selector('.day-card .chip.PENDING')
    print('  ✓ single-day order saved (PENDING)')

    page.click('.tabs [data-tab=aircraft]'); page.click('[data-act=ac-edit]')
    page.select_option('[data-ac="2.status"]', 'NMCS')
    page.click('[data-act=ac-save]'); page.wait_for_selector('[data-act=ac-edit]')
    page.click('.tabs [data-tab=order]')
    print('  ✓ aircraft status edit (locked tab)')
    logout(page)

    login(page, 'ผู้ชม'); goto(page, D1)
    assert 'ยังไม่ release' in page.inner_text('#view') and page.locator('[data-act=save]').count() == 0
    print('  ✓ viewer: pending hidden'); logout(page)

    login(page, 'ผู้ดูแลเอกสาร'); goto(page, D1)
    page.wait_for_selector('.doc'); assert 'ภารกิจทดสอบ ส่งคณะ' in page.inner_text('.doc')
    assert page.locator('[data-bind]').count() == 0 and page.locator('[data-act=save],[data-act=approve],[data-act=deny],[data-act=release],[data-act=ac-edit]').count() == 0
    assert page.locator('[data-act=print-all]').count() == 1
    page.click('.tabs [data-tab=aircraft]'); assert page.locator('[data-act=ac-edit]').count() == 0
    page.click('.tabs [data-tab=order]')
    print('  ✓ documents: sees pending, read-only, can print'); logout(page)

    login(page, 'ผู้บังคับบัญชา'); goto(page, D1)
    assert page.locator('[data-bind]').count() == 0, 'commander read-only'
    page.click('[data-act=deny]'); modal_btn(page, 'ไม่อนุมัติ')
    assert page.locator('#dnE').inner_text() != ''
    page.fill('#dnR', 'ให้ตรวจเวลาวิ่งขึ้น'); modal_btn(page, 'ไม่อนุมัติ'); page.wait_for_selector('.day-card .chip.DENIED')
    print('  ✓ commander denied with reason'); logout(page)

    login(page, 'ผู้จัดบิน'); goto(page, D1)
    assert 'ให้ตรวจเวลาวิ่งขึ้น' in page.inner_text('.banner.bad')
    t = page.locator('[data-bind="missions.0.times.takeoff"]'); t.fill('0730'); t.press('Tab')
    page.click('.card [data-act=save] >> nth=0'); page.wait_for_selector('.day-card .chip.PENDING')
    logout(page)
    login(page, 'ผู้บังคับบัญชา'); goto(page, D1)
    page.click('[data-act=approve]'); modal_btn(page, 'อนุมัติ'); page.wait_for_selector('.day-card .chip.APPROVED'); logout(page)
    login(page, 'ผู้จัดบิน'); goto(page, D1)
    page.click('[data-act=release]'); modal_btn(page, 'Release'); page.wait_for_selector('.day-card .chip.RELEASED')
    assert page.locator('[data-bind]').count() == 0
    print('  ✓ edit after deny → approve → release (locked)')

    # ── 2. ชุดวันหยุด: วันศุกร์ทำของ ส.–อ. (จ. หยุดชดเชย) ──
    page.evaluate(f"window.__fo602.S.today = '{FRI}'")
    page.click('[data-act=next-batch]'); page.wait_for_selector('.day-tab')
    assert page.evaluate("window.__fo602.S.range") == BATCH, 'Friday + Monday holiday → Sat..Tue'
    assert 'วันหยุดชดเชย' in page.inner_text('.day-tabs')
    tab(page, BATCH[0])
    page.select_option('[data-act-change=aircraft][data-m="0"]', '60205')
    page.fill('[data-bind="missions.0.title"]', 'ภารกิจวันเสาร์'); pick_pilots(page, 0, 2)
    tab(page, BATCH[1]); page.check('[data-act-change=no-mission]'); page.wait_for_selector('.mission', state='detached')
    tab(page, BATCH[2]); page.click('[data-act=copy-prev]'); modal_btn(page, 'คัดลอก')
    assert page.is_checked('[data-act-change=no-mission]'), 'copied no-mission from Sunday'
    tab(page, BATCH[3]); page.fill('[data-bind="missions.0.title"]', 'ภารกิจวันอังคาร'); pick_pilots(page, 0, 3)
    assert page.locator('.day-tab .dd:not([hidden])').count() == 4, 'dirty markers on 4 tabs'
    tab(page, BATCH[0])
    assert page.input_value('[data-bind="missions.0.title"]') == 'ภารกิจวันเสาร์', 'tab switch keeps edits'
    page.screenshot(path=f'{OUT}/6-batch-editor.png', full_page=False)
    page.click('.card [data-act=save] >> nth=0')
    page.wait_for_function("() => { const S = window.__fo602.S; return S.range.every(d => S.days[d].meta.exists); }")
    assert statuses(page) == ['PENDING'] * 4
    print('  ✓ batch Sat–Tue saved in one click (4 × PENDING)')
    logout(page)

    login(page, 'ผู้บังคับบัญชา')
    assert page.evaluate("window.__fo602.S.range") == BATCH, 'commander opens pending batch by default'
    page.screenshot(path=f'{OUT}/7-batch-commander.png', full_page=False)
    page.click('[data-act=approve]'); modal_btn(page, 'อนุมัติทั้งชุด')
    page.wait_for_function("() => { const S = window.__fo602.S; return S.range.every(d => S.days[d].meta.status === 'APPROVED'); }")
    print('  ✓ commander approved whole batch in one click'); logout(page)

    login(page, 'ผู้จัดบิน'); goto(page, BATCH[0], BATCH[-1])
    tab(page, BATCH[3]); page.fill('[data-bind="missions.0.callsign"]', 'WHK09')
    page.click('.card [data-act=save] >> nth=0')
    page.wait_for_function("() => window.__fo602.S.days['2026-12-08'].meta.status === 'PENDING'")
    assert statuses(page) == ['APPROVED', 'APPROVED', 'APPROVED', 'PENDING']
    assert page.locator('[data-act=release]').count() == 0, 'cannot release with a pending day'
    logout(page)
    login(page, 'ผู้บังคับบัญชา')
    page.click('[data-act=approve]'); modal_btn(page, 'อนุมัติทั้งชุด')
    page.wait_for_function("() => window.__fo602.S.days['2026-12-08'].meta.status === 'APPROVED'"); logout(page)
    login(page, 'ผู้จัดบิน'); goto(page, BATCH[0], BATCH[-1])
    page.click('[data-act=release]'); modal_btn(page, 'Release')
    page.wait_for_function("() => { const S = window.__fo602.S; return S.range.every(d => S.days[d].meta.status === 'RELEASED'); }")
    print('  ✓ editing one day re-pends only that day; release whole batch')

    page.evaluate("window.print = () => {}")
    page.click('[data-act=print-all]'); page.wait_for_timeout(200)
    assert page.locator('#printRoot .doc').count() == 4
    page.emulate_media(media='print')
    page.pdf(path=f'{OUT}/batch.pdf', format='A4', print_background=True, prefer_css_page_size=True)
    page.emulate_media(media='screen')
    print('  ✓ batch PDF rendered')
    logout(page)

    # ── 3. มือถือ ──
    mctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
    m = mctx.new_page()
    m.on('pageerror', lambda e: errors.append('m pageerror: ' + str(e)))
    state = page.evaluate("localStorage.getItem('fo602_demo_state_v3')")
    m.goto(BASE); m.evaluate("s => localStorage.setItem('fo602_demo_state_v3', s)", state)
    login(m, 'ผู้ชม'); goto(m, BATCH[0], BATCH[-1])
    m.wait_for_selector('.doc'); assert 'ภารกิจวันเสาร์' in m.inner_text('.doc')
    m.screenshot(path=f'{OUT}/8-viewer-batch-mobile.png', full_page=False)
    goto(m, D1); assert 'นบ.1 ราช' in m.inner_text('.doc') and 'ฝป(พ.)' in m.inner_text('.doc')
    print('  ✓ mobile viewer sees released batch & day')

    # ── 4. admin ──
    login(page, 'ผู้ดูแลระบบ')
    page.click('.tabs [data-tab=history]'); page.fill('#hMonth', '2026-12'); page.dispatch_event('#hMonth', 'change')
    page.wait_for_selector('.list-item[data-batch]')
    page.click(f'.list-item[data-d="{BATCH[2]}"]'); page.wait_for_selector('.day-tab')
    assert page.evaluate("window.__fo602.S.range") == BATCH and page.evaluate("window.__fo602.S.date") == BATCH[2]
    print('  ✓ history opens whole batch')
    page.click('.tabs [data-tab=stats]'); page.fill('#sFrom', '2026-12-01'); page.fill('#sTo', '2026-12-31')
    page.dispatch_event('#sFrom', 'change'); page.dispatch_event('#sTo', 'change')
    page.click('[data-act=stats-load]'); page.wait_for_function("document.querySelector('.tile .v') && document.querySelector('.tile .v').innerText === '4'")
    page.click('.tabs [data-tab=settings]'); page.wait_for_selector('#holCard [data-act=hol-add]')
    page.select_option('#holYear', '2027'); page.click('[data-act=hol-add]')
    page.fill('[data-hol="1.date"]', '2027-01-02'); page.fill('[data-hol="1.name"]', 'วันหยุดพิเศษ')
    page.click('[data-act=hol-save]'); page.wait_for_function("window.__fo602.S.holidayMap['2027-01-02'] === 'วันหยุดพิเศษ'")
    assert page.evaluate("window.__fo602.nextBatch('2026-12-31')") == {'from': '2027-01-01', 'to': '2027-01-04'}
    print('  ✓ stats + holiday admin (Thu 31 Dec → Fri 1 – Mon 4 Jan)')
    page.click('.tabs [data-tab=users]'); page.wait_for_selector('#uList table')
    page.click('[data-act=user-new]'); page.fill('#uf_un', 'pilot01'); page.fill('#uf_dn', 'ร.ท.ทดสอบ'); modal_btn(page, 'สร้างบัญชี')
    page.wait_for_selector('.secret'); pw = page.inner_text('.secret'); modal_btn(page, 'ปิด')
    logout(page)
    page.fill('[name=username]', 'pilot01'); page.fill('[name=password]', pw); page.click('#loginForm button')
    page.wait_for_selector('#pwForm')
    page.fill('[name=old]', pw); page.fill('[name=new1]', 'pilot01pass'); page.fill('[name=new2]', 'pilot01pass')
    page.click('#pwForm button[type=submit]'); page.wait_for_selector('.topbar')
    print('  ✓ new user forced password change')

    # ── 5. ร่างในเครื่อง ──
    logout(page); login(page, 'ผู้จัดบิน'); goto(page, '2030-01-15')
    page.fill('[data-bind="missions.0.title"]', 'ร่างยังไม่บันทึก'); page.wait_for_timeout(600)
    page.evaluate("window.onbeforeunload=null"); page.reload(); page.wait_for_selector('.topbar')
    goto(page, '2030-01-15'); page.click('[data-act=draft-restore]')
    assert page.input_value('[data-bind="missions.0.title"]') == 'ร่างยังไม่บันทึก'
    print('  ✓ draft recovery')
    b.close()

if errors:
    print('ERRORS:'); [print('  ', e) for e in errors]; sys.exit(1)
print('all e2e checks passed')
