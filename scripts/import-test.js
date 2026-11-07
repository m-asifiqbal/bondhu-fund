/**
 * Excel import test: template → filled workbook (messy, realistic) → preview → commit → re-import → export round trip.
 * The workbook is filled the way a person fills the template: Members from row 5, Payment History picked by name.
 *   npm run test:import
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const ExcelJS = require('exceljs');

const root = path.resolve(__dirname, '..');
const store = require(path.join(root, 'dist-electron', 'database.js'));
const excel = require(path.join(root, 'dist-electron', 'excel.js'));
const A = store.api;
let fails = 0;
const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fails++; };

const FIRST = 5;                        // first data row (Members and Payment History)
const MEMBER_COLS = ['code', 'name', 'name_bn', 'nid', 'phone', 'email', 'designation', 'status', 'monthly_due', 'join_date', 'opening_balance', 'notes'];

/** Write one member row the way a user types it (values only — the "Ready?" formula stays). */
function putMember(ws, r, vals) {
  vals.forEach((v, i) => { ws.getRow(r).getCell(i + 1).value = v === '' ? null : v; });
}
/** Clear the example rows; the cached results of the auto-filled cells are blank, as Excel shows them once the examples are gone. */
function clearExamples(wb) {
  const ms = wb.getWorksheet('Members');
  for (let r = FIRST; r < FIRST + 3; r++) for (let c = 1; c <= 12; c++) ms.getRow(r).getCell(c).value = null;
  const ps = wb.getWorksheet('Payment History');
  for (let r = FIRST; r < FIRST + 12; r++) {
    const row = ps.getRow(r);
    row.eachCell({ includeEmpty: true }, (cell, c) => {
      if (c === 2 || c === 3) cell.value = { formula: cell.value && cell.value.formula, result: '' };
      else if (c !== 4) cell.value = null;
    });
  }
}

(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bondhu-import-'));
  await store.openDatabase(path.join(work, 'test.db'), fs.readFileSync(path.join(root, 'node_modules/sql.js/dist/sql-wasm.wasm')));
  const cur = store.currentMonthKey();
  const m = n => store.addMonths(cur, n);

  // ---------------------------------------------------------------- 1) the template itself
  const tpl = await excel.buildTemplate({ orgName: 'Test Fund', defaultDue: 2000, dueDay: 10, currentMonth: cur });
  fs.writeFileSync(path.join(work, 'template.xlsx'), tpl);
  const t0 = new ExcelJS.Workbook();
  await t0.xlsx.load(tpl);
  ok(t0.worksheets.map(w => w.name).join('|') === 'Start Here|Members|Payment History', `sheets: ${t0.worksheets.map(w => w.name).join(' | ')}`);
  const tm = t0.getWorksheet('Members');
  const headers = []; tm.getRow(4).eachCell(c => headers.push(String(c.value).split('\n')[0]));
  ok(headers.join(',') === 'Member Code,Name *,Name (Bangla),National ID (NID) *,Phone,Email,Designation,Status,Monthly Due,Join Date *,Opening Balance,Notes,Ready?', 'Members header row (row 4) includes the National ID column in place');
  ok(tm.getCell('D4').fill.fgColor.argb === 'FFFFF1C2' && tm.getCell('B4').fill.fgColor.argb === 'FFFFF1C2' && tm.getCell('J4').fill.fgColor.argb === 'FFFFF1C2', 'required headers (Name, NID, Join Date) are highlighted');
  ok(tm.getCell('D50').numFmt === '@' && tm.getCell('E50').numFmt === '@', 'NID and phone cells are Text so Excel cannot shorten them');
  const dvAt = addr => tm.getCell(addr).dataValidation;
  ok(dvAt('D300') && dvAt('D300').type === 'custom' && dvAt('D300').formulae[0].includes('LEN(D5)=17') && dvAt('D300').errorStyle === 'warning', 'NID cells carry a 10/13/17-digit + no-duplicate check');
  ok(dvAt('H300') && /Active,Inactive/.test(dvAt('H300').formulae[0]), 'Status drop-down sits on the Status column');
  ok(dvAt('J300') && dvAt('J300').type === 'date', 'date check sits on the Join Date column');
  ok(dvAt('I300') && dvAt('I300').type === 'decimal' && dvAt('K300') && dvAt('K300').type === 'decimal', 'amount checks sit on Monthly Due and Opening Balance');
  ok(tm.views[0].state === 'frozen' && tm.views[0].ySplit === 4, 'header rows stay in view while scrolling');
  ok(tm.getRow(5).getCell(4).value === '1990123456789' && String(tm.getRow(6).getCell(4).value).length === 17, 'example rows show a 13- and a 17-digit NID as text');
  const tp = t0.getWorksheet('Payment History');
  ok(String(tp.getCell('E4').value) === store.addMonths(cur, -23) && String(tp.getCell('AB4').value) === cur, '24 month columns, oldest to the current month');
  ok(tp.getCell('A300').dataValidation && tp.getCell('A300').dataValidation.type === 'list' && tp.getCell('A300').dataValidation.formulae[0].includes('OFFSET(Members!'), 'member drop-down on Payment History');
  const pt = await excel.parseWorkbook(tpl);
  ok(pt.members.length === 0 && pt.payments.length === 0 && pt.examplesSkipped >= 5, `template: examples skipped (${pt.examplesSkipped}), nothing to import`);
  ok(pt.sheetWarnings.length === 0, `template reads without warnings (${pt.sheetWarnings.join('; ') || 'none'})`);

  // ---------------------------------------------------------------- 2) a realistic filled workbook
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(tpl);
  clearExamples(wb);
  const ms = wb.getWorksheet('Members');
  const dt = k => new Date(Date.UTC(+m(k).slice(0, 4), +m(k).slice(5) - 1, 1));
  putMember(ms, 5, ['BF-0101', 'Rahim Uddin', 'রহিম উদ্দিন', '1990123456789', '01711-111111', 'rahim@example.com', 'President', 'Active', 2000, dt(-5), 0, '']);
  putMember(ms, 6, ['', 'Karima Begum', 'করিমা বেগম', '১৯৯০১২৩৪৫৬৭৯০', '০১৮১১-২২২২২২', '', 'Treasurer', 'সক্রিয়', '3,000', '১৫/০১/২০২৪', '24000', 'paid 24000 before app']);
  putMember(ms, 7, ['BF-0103', 'Jamal Hossain', '', '1990123456791', '', 'not-an-email', 'Member', 'Active', 2000, `01/${m(-3).slice(5)}/${m(-3).slice(0, 4)}`, 0, '']);
  putMember(ms, 8, ['BF-0101', 'Duplicate Code', '', '1990123456792', '', '', '', 'Active', 2000, '01/01/2024', 0, '']);   // duplicate code → error
  putMember(ms, 9, ['BF-0105', '', '', '1990123456793', '', '', '', 'Active', 2000, '01/01/2024', 0, '']);                 // no name → error
  putMember(ms, 10, ['BF-0106', 'Bad Date', '', '1990123456794', '', '', '', 'Active', 2000, '31/02/2024', 0, '']);          // invalid date → error

  const ps = wb.getWorksheet('Payment History');
  const header = ps.getRow(4);
  const months = [];
  header.eachCell((c, col) => { if (col >= 5) months.push({ col, mk: String(c.value) }); });
  const nextMonth = m(1);
  header.getCell(months[months.length - 1].col + 1).value = nextMonth;                         // future month column
  const payRow = (r, name, code, fill) => {
    const row = ps.getRow(r);
    row.getCell(1).value = name;
    if (code) row.getCell(2).value = code;                                                     // user typed over the automatic code
    months.forEach(({ col, mk }) => { const v = fill(mk); if (v !== undefined) row.getCell(col).value = v; });
    return row;
  };
  payRow(5, 'Rahim Uddin', 'BF-0101', mk => (mk >= m(-5) && mk !== m(-1) ? (mk === m(-4) ? 'P' : 2000) : undefined));   // 5 paid, 1 gap
  payRow(6, 'Karima Begum', '', mk => (mk >= m(-2) ? '৩,০০০' : undefined));                                              // by name, Bangla digits
  const r3 = payRow(7, 'Jamal Hossain', 'BF-0103', mk => (mk === m(-6) ? 2000 : undefined));                            // before join → join moved
  r3.getCell(months[months.length - 1].col + 1).value = 2000;                                                            // future → error
  payRow(8, 'Unknown Person', 'BF-0999', mk => (mk === m(0) ? 2000 : undefined));                                       // unknown → error
  const filled = Buffer.from(await wb.xlsx.writeBuffer());
  fs.writeFileSync(path.join(work, 'filled.xlsx'), filled);

  const parsed = await excel.parseWorkbook(filled);
  ok(parsed.members.length === 6, `parsed 6 member rows (${parsed.members.length})`);
  ok(parsed.members.find(x => x.name === 'Rahim Uddin').nid === '1990123456789', 'NID read as text');
  const pv = store.previewMemberImport(parsed, {});
  const s = pv.summary;
  console.log('      summary', JSON.stringify(s));
  ok(s.newMembers === 3 && s.memberErrors === 3, `3 new members, 3 member errors (${s.newMembers}/${s.memberErrors})`);
  ok(pv.members.find(x => x.name === 'Karima Begum').code.startsWith('BF-'), 'missing code auto-generated');
  ok(pv.members.find(x => x.name === 'Karima Begum').join_date === '2024-01-15', 'Bangla-digit date parsed (১৫/০১/২০২৪)');
  ok(pv.members.find(x => x.name === 'Karima Begum').monthly_due === 3000, '"3,000" parsed as 3000');
  ok(pv.members.find(x => x.name === 'Karima Begum').status === 'Active', 'Bangla status সক্রিয় → Active');
  ok(pv.members.find(x => x.name === 'Karima Begum').nid === '1990123456790', 'Bangla-digit NID → 1990123456790');
  ok(pv.members.find(x => x.name === 'Jamal Hossain').join_date === `${m(-6)}-01`, 'payment before join date moves join date earlier');
  ok(pv.members.find(x => x.name === 'Jamal Hossain').messages.some(x => /Email/.test(x.text)), 'invalid email → warning');
  ok(s.newPayments === 5 + 3 + 1, `9 new payments (${s.newPayments})`);
  ok(s.paymentErrors === 2, `2 payment errors: future month + unknown member (${s.paymentErrors})`);
  ok(s.paymentTotal === 5 * 2000 + 3 * 3000 + 2000, `payment total ${s.paymentTotal}`);

  const res = store.commitMemberImport(parsed, { payment_method: 'Cash' });
  console.log('      commit', JSON.stringify(res));
  ok(res.created === 3 && res.paymentsAdded === 9, 'commit: 3 members, 9 payments');
  const rahim = A.getMembers('Rahim').members[0];
  ok(rahim.total_contributed === 10000 && rahim.nid === '1990123456789', `Rahim total contributed 10000, NID stored (${rahim.total_contributed})`);
  const karima = A.getMembers('Karima').members[0];
  ok(karima.total_contributed === 24000 + 9000 && karima.name_bn === 'করিমা বেগম' && karima.nid === '1990123456790', `Karima opening + history = 33000, Bangla NID stored as digits (${karima.total_contributed})`);
  const st = A.getMemberStatement(rahim.id);
  ok(st.rows.find(r => r.payment_month === m(-1)).status !== 'Paid', 'gap month shows as unpaid in statement');

  // ---------------------------------------------------------------- 3) re-import: nothing duplicated
  const again = store.previewMemberImport(await excel.parseWorkbook(filled), {});
  ok(again.summary.newMembers === 0 && again.summary.skippedMembers === 3, 're-import: existing members skipped');
  ok(again.summary.newPayments === 0 && again.summary.existingPayments === 9, `re-import: all 9 payments recognised as already recorded (${again.summary.existingPayments} existing, ${again.summary.newPayments} new)`);
  const upd = store.previewMemberImport(await excel.parseWorkbook(filled), { existing: 'update' });
  ok(upd.summary.updatedMembers === 3, `update mode: 3 members updated incl. the one matched by name (${upd.summary.updatedMembers})`);

  // ---------------------------------------------------------------- 4) National ID edge cases
  const wb2 = new ExcelJS.Workbook();
  await wb2.xlsx.load(tpl);
  clearExamples(wb2);
  const m2 = wb2.getWorksheet('Members');
  const J = new Date(Date.UTC(2024, 0, 1));
  putMember(m2, 5, ['', 'Numeric Thirteen', '', 1990123456795, '', '', '', 'Active', 2000, J, 0, '']);                       // 13-digit number: exact in Excel
  putMember(m2, 6, ['', 'Mangled Seventeen', '', 19901234567890123, '', '', '', 'Active', 2000, J, 0, '']);                 // 17-digit NUMBER: Excel already lost digits
  putMember(m2, 7, ['', 'Text Seventeen', '', '19901234567890124', '', '', '', 'Active', 2000, J, 0, '']);                  // 17-digit text: fine
  putMember(m2, 8, ['', 'With Dashes', '', '1990-1234-56796', '', '', '', 'Active', 2000, J, 0, '']);                       // dashes ignored
  putMember(m2, 9, ['', 'Same NID As Karima', '', '1990123456790', '', '', '', 'Active', 2000, J, 0, '']);                  // NID already in the app
  putMember(m2, 10, ['', 'No NID At All', '', '', '', '', '', 'Active', 2000, J, 0, '']);                                    // required
  putMember(m2, 11, ['', 'Twelve Digits', '', '199012345679', '', '', '', 'Active', 2000, J, 0, '']);                       // wrong length
  putMember(m2, 12, ['', 'Letters Inside', '', '19901234ABC79', '', '', '', 'Active', 2000, J, 0, '']);                     // letters
  putMember(m2, 13, ['', 'Twice A', '', '1990123456797', '', '', '', 'Active', 2000, J, 0, '']);
  putMember(m2, 14, ['', 'Twice B', '', '1990123456797', '', '', '', 'Active', 2000, J, 0, '']);                           // duplicate inside the file
  const p2 = wb2.getWorksheet('Payment History');
  // a payment row identified only by NID (no name, no code)
  const pr = p2.getRow(5); pr.getCell(3).value = '1990123456795'; pr.getCell(5 + 23).value = 2000;                            // current month column
  const nidFile = Buffer.from(await wb2.xlsx.writeBuffer());
  const pn = await excel.parseWorkbook(nidFile);
  const byName = n => pn.members.find(x => x.name === n);
  ok(byName('Numeric Thirteen').nid === '1990123456795', '13-digit NID typed as a number is read exactly');
  ok(byName('Mangled Seventeen').problems.some(x => /stored as a number/.test(x)), '17-digit NID that Excel turned into a number is refused with an explanation');
  ok(byName('Text Seventeen').nid === '19901234567890124', '17-digit NID typed as text is kept in full');
  const pv2 = store.previewMemberImport(pn, {});
  const msg = n => pv2.members.find(x => x.name === n);
  ok(msg('Numeric Thirteen').action === 'new' && msg('Text Seventeen').action === 'new' && msg('With Dashes').action === 'new' && msg('With Dashes').nid === '1990123456796', 'valid NIDs (13-digit number, 17-digit text, with dashes) are accepted');
  ok(msg('Mangled Seventeen').action === 'error', 'damaged NID blocks that member');
  ok(msg('Same NID As Karima').existingId === karima.id && msg('Same NID As Karima').messages.some(x => /by NID/.test(x.text)), 'NID already in the app and no code → recognised as that existing member (flagged, never duplicated)');
  ok(msg('No NID At All').messages.some(x => /required/i.test(x.text)), 'missing NID → error');
  ok(msg('Twelve Digits').messages.some(x => /10, 13 or 17/.test(x.text)), 'wrong length → error');
  ok(msg('Letters Inside').messages.some(x => /digits only/.test(x.text)), 'letters → error');
  ok(msg('Twice B').messages.some(x => /twice in the file/i.test(x.text)), 'same NID twice in the file → error on the second');
  ok(pv2.summary.newPayments === 1 && pv2.summary.paymentErrors === 0, `a payment row identified by NID only is matched (${pv2.summary.newPayments} new / ${pv2.summary.paymentErrors} errors)`);

  // an existing member re-listed without a code is recognised by NID, even if the name was changed
  const wb3 = new ExcelJS.Workbook();
  await wb3.xlsx.load(tpl);
  clearExamples(wb3);
  putMember(wb3.getWorksheet('Members'), 5, ['', 'Karima B. Begum (renamed)', '', '1990123456790', '', '', '', 'Active', 3000, new Date(Date.UTC(2024, 0, 15)), 24000, '']);
  const pv3 = store.previewMemberImport(await excel.parseWorkbook(Buffer.from(await wb3.xlsx.writeBuffer())), { existing: 'update' });
  ok(pv3.members[0].existingId === karima.id && pv3.members[0].action === 'update' && pv3.members[0].messages.some(x => /by NID/.test(x.text)), 're-listed without a code → matched to the right member by NID');

  // ---------------------------------------------------------------- 5) export round trip (members, NIDs, history) and a big export
  const d = store.exportMembersData();
  const xbuf = await excel.buildMembersExport(d.members, d.payments, d.months);
  const back = await excel.parseWorkbook(xbuf);
  ok(back.members.length === 3 && back.payments.length === 9, `export → parse round trip (${back.members.length} members, ${back.payments.length} payments)`);
  ok(back.members.every(x => /^\d{10}(\d{3}(\d{4})?)?$/.test(x.nid)) && back.members.some(x => x.nid === '1990123456790'), 'export keeps every NID');
  ok(store.previewMemberImport(back, {}).summary.newMembers === 0, 'importing the app\'s own export changes nothing');
  const big = Array.from({ length: 620 }, (_, i) => ({ member_code: `BF-${String(i + 1).padStart(4, '0')}`, name: `Person ${i + 1}`, name_bn: '', nid: String(1000000000 + i), phone: '', email: '', designation: 'Member', status: 'Active', monthly_due: 1000, join_date: '2024-01-01', opening_balance: 0, notes: '' }));
  const bigBack = await excel.parseWorkbook(await excel.buildMembersExport(big, [{ member_code: 'BF-0600', payment_month: '2024-02', contribution_amount: 1000 }], ['2024-01', '2024-02']));
  ok(bigBack.members.length === 620 && bigBack.payments.length === 1 && bigBack.payments[0].code === 'BF-0600', 'an export of 620 members is complete (nothing cut at 500 rows)');

  console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL IMPORT CHECKS PASSED');
  console.log(`(sample files: ${work})`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
