/**
 * Excel import test: template → filled workbook (messy, realistic) → preview → commit → re-import.
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

(async () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'bondhu-import-'));
  await store.openDatabase(path.join(work, 'test.db'), fs.readFileSync(path.join(root, 'node_modules/sql.js/dist/sql-wasm.wasm')));
  const cur = store.currentMonthKey();
  const m = n => store.addMonths(cur, n);

  // 1) Template builds and imports nothing by itself (examples are ignored)
  const tpl = await excel.buildTemplate({ orgName: 'Test Fund', defaultDue: 2000, dueDay: 10, currentMonth: cur });
  fs.writeFileSync(path.join(work, 'template.xlsx'), tpl);
  const pt = await excel.parseWorkbook(tpl);
  ok(pt.members.length === 0 && pt.payments.length === 0 && pt.examplesSkipped >= 5, `template: examples skipped (${pt.examplesSkipped}), nothing to import`);

  // 2) A realistic filled workbook (started from the template)
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(tpl);
  const ms = wb.getWorksheet('Members');
  ms.spliceRows(2, 3); // remove examples
  ms.addRow(['BF-0101', 'Rahim Uddin', 'রহিম উদ্দিন', '1990123456789', '01711-111111', 'rahim@example.com', 'President', 'Active', 2000, new Date(Date.UTC(+m(-5).slice(0, 4), +m(-5).slice(5) - 1, 1)), 0, '']);
  ms.addRow(['', 'Karima Begum', 'করিমা বেগম', '১৯৯০১২৩৪৫৬৭৯০', '০১৮১১-২২২২২২', '', 'Treasurer', 'সক্রিয়', '3,000', '১৫/০১/২০২৪', '24000', 'paid 24000 before app']);
  ms.addRow(['BF-0103', 'Jamal Hossain', '', '1990123456791', '', 'not-an-email', 'Member', 'Active', 2000, `01/${m(-3).slice(5)}/${m(-3).slice(0, 4)}`, 0, '']);
  ms.addRow(['BF-0101', 'Duplicate Code', '', '1990123456792', '', '', '', 'Active', 2000, '01/01/2024', 0, '']);   // duplicate code → error
  ms.addRow(['BF-0105', '', '', '1990123456793', '', '', '', 'Active', 2000, '01/01/2024', 0, '']);                // no name → error
  ms.addRow(['BF-0106', 'Bad Date', '', '1990123456794', '', '', '', 'Active', 2000, '31/02/2024', 0, '']);         // invalid date → error

  const ps = wb.getWorksheet('Payment History');
  ps.spliceRows(2, 10);
  const header = ps.getRow(1);
  const months = [];
  header.eachCell((c, col) => { if (col > 2) months.push({ col, mk: String(c.value) }); });
  const nextMonth = m(1);
  header.getCell(months[months.length - 1].col + 1).value = nextMonth;                         // future month column
  const rowFor = (code, name, fill) => { const r = ps.addRow([code, name]); months.forEach(({ col, mk }) => { const v = fill(mk); if (v !== undefined) r.getCell(col).value = v; }); return r; };
  rowFor('BF-0101', 'Rahim Uddin', mk => (mk >= m(-5) && mk !== m(-1) ? (mk === m(-4) ? 'P' : 2000) : undefined));   // 5 paid, 1 gap
  rowFor('', 'Karima Begum', mk => (mk >= m(-2) ? '৩,০০০' : undefined));                                         // by name, Bangla digits
  const r3 = rowFor('BF-0103', 'Jamal Hossain', mk => (mk === m(-6) ? 2000 : undefined));                      // before join → join moved
  r3.getCell(months[months.length - 1].col + 1).value = 2000;                                                // future → error
  rowFor('BF-0999', 'Unknown Person', mk => (mk === m(0) ? 2000 : undefined));                               // unknown → error
  const filled = Buffer.from(await wb.xlsx.writeBuffer());
  fs.writeFileSync(path.join(work, 'filled.xlsx'), filled);

  const parsed = await excel.parseWorkbook(filled);
  ok(parsed.members.length === 6, `parsed 6 member rows (${parsed.members.length})`);
  const pv = store.previewMemberImport(parsed, {});
  const s = pv.summary;
  console.log('      summary', JSON.stringify(s));
  ok(s.newMembers === 3 && s.memberErrors === 3, `3 new members, 3 member errors (${s.newMembers}/${s.memberErrors})`);
  ok(pv.members.find(x => x.name === 'Karima Begum').code.startsWith('BF-'), 'missing code auto-generated');
  ok(pv.members.find(x => x.name === 'Karima Begum').join_date === '2024-01-15', 'Bangla-digit date parsed (১৫/০১/২০২৪)');
  ok(pv.members.find(x => x.name === 'Karima Begum').monthly_due === 3000, '"3,000" parsed as 3000');
  ok(pv.members.find(x => x.name === 'Karima Begum').status === 'Active', 'Bangla status সক্রিয় → Active');
  ok(pv.members.find(x => x.name === 'Jamal Hossain').join_date === `${m(-6)}-01`, 'payment before join date moves join date earlier');
  ok(pv.members.find(x => x.name === 'Jamal Hossain').messages.some(x => /Email/.test(x.text)), 'invalid email → warning');
  ok(s.newPayments === 5 + 3 + 1, `9 new payments (${s.newPayments})`);
  ok(s.paymentErrors === 2, `2 payment errors: future month + unknown member (${s.paymentErrors})`);
  ok(s.paymentTotal === 5 * 2000 + 3 * 3000 + 2000, `payment total ${s.paymentTotal}`);

  const res = store.commitMemberImport(parsed, { payment_method: 'Cash' });
  console.log('      commit', JSON.stringify(res));
  ok(res.created === 3 && res.paymentsAdded === 9, 'commit: 3 members, 9 payments');
  const rahim = A.getMembers('Rahim').members[0];
  ok(rahim.total_contributed === 10000, `Rahim total contributed 10000 (${rahim.total_contributed})`);
  const karima = A.getMembers('Karima').members[0];
  ok(karima.total_contributed === 24000 + 9000 && karima.name_bn === 'করিমা বেগম', `Karima opening + history = 33000 (${karima.total_contributed})`);
  const st = A.getMemberStatement(rahim.id);
  ok(st.rows.find(r => r.payment_month === m(-1)).status !== 'Paid', 'gap month shows as unpaid in statement');

  // 3) Re-import the same file: nothing is duplicated
  const again = store.previewMemberImport(await excel.parseWorkbook(filled), {});
  ok(again.summary.newMembers === 0 && again.summary.skippedMembers === 3, 're-import: existing members skipped');
  ok(again.summary.newPayments === 0 && again.summary.existingPayments === 9, `re-import: all 9 payments recognised as already recorded (${again.summary.existingPayments} existing, ${again.summary.newPayments} new)`);

  // 4) Update mode applies changes to existing members
  const upd = store.previewMemberImport(await excel.parseWorkbook(filled), { existing: 'update' });
  ok(upd.summary.updatedMembers === 3, `update mode: 3 members updated incl. the one matched by name (${upd.summary.updatedMembers})`);

  // 5) Export round trip
  const d = store.exportMembersData();
  const xbuf = await excel.buildMembersExport(d.members, d.payments, d.months);
  const back = await excel.parseWorkbook(xbuf);
  ok(back.members.length === 3 && back.payments.length === 9, `export → parse round trip (${back.members.length} members, ${back.payments.length} payments)`);

  console.log(fails ? `\n${fails} FAILURE(S)` : '\nALL IMPORT CHECKS PASSED');
  console.log(`(sample files: ${work})`);
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(2); });
