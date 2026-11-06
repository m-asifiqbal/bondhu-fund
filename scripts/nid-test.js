/** National ID (NID) rules for members.   npm run test:nid */
const fs = require('fs'), path = require('path'), os = require('os');
const proj = path.resolve(__dirname, '..');
const store = require(path.join(proj, 'dist-electron', 'database.js'));
const wasm = fs.readFileSync(path.join(proj, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'));
const A = store.api;
let fails = 0; const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fails++; };
const throws = (fn, re, m) => { try { fn(); ok(false, m + ' (no error)'); } catch (e) { ok(re.test(e.message), `${m} -> "${e.message}"`); } };
(async () => {
  await store.openDatabase(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bf-nid-')), 'n.db'), wasm);
  A.resetDatabase(true);
  throws(() => A.addMember({ name: 'No NID' }), /NID\) is required/, 'a member cannot be added without an NID');
  throws(() => A.addMember({ name: 'Blank', nid: '   ' }), /required/, 'a blank NID is refused');
  throws(() => A.addMember({ name: 'Letters', nid: '12345abcde' }), /digits only/, 'letters in an NID are refused');
  throws(() => A.addMember({ name: 'Short', nid: '123456789' }), /10, 13 or 17/, '9 digits are refused');
  throws(() => A.addMember({ name: 'Odd', nid: '12345678901234' }), /10, 13 or 17/, '14 digits are refused');
  const a = A.addMember({ name: 'Rafiq Hasan', nid: '1990 1234-56789' });
  const find = id => A.getMembers('', 'All', 1, 50).members.find(m => m.id === id);
  ok(find(a).nid === '1990123456789', 'spaces and dashes are removed and the NID is saved');
  const b = A.addMember({ name: 'Sadia Rahman', nid: '১৯৯০১২৩৪৫৬৭৯০' });
  ok(find(b).nid === '1990123456790', 'an NID typed in Bangla digits is stored as normal digits');
  A.addMember({ name: 'Ten digit', nid: '1234567890' }); A.addMember({ name: 'Seventeen', nid: '28811223344556677' });
  ok(A.getMembers('', 'All').total === 4, '10, 13 and 17 digit NIDs are all accepted');
  throws(() => A.addMember({ name: 'Copy', nid: '1990123456789' }), /already belongs to BF-0001 Rafiq Hasan/, 'the same NID cannot be used by two members');
  // search by NID
  const s1 = A.getMembers('1990123456789', 'All').members, s2 = A.getMembers('90123456789', 'All').members, s3 = A.getMembers('১৯৯০১২৩৪৫৬৭৮৯', 'All').members, s4 = A.getMembers('Sadia', 'All').members;
  ok(s1.length === 1 && s1[0].name === 'Rafiq Hasan', 'search finds a member by the full NID');
  ok(s2.length === 1 && s2[0].name === 'Rafiq Hasan', 'search finds a member by part of the NID');
  ok(s3.length === 1 && s3[0].name === 'Rafiq Hasan', 'search accepts an NID typed with Bangla digits');
  ok(s4.length === 1 && s4[0].name === 'Sadia Rahman', 'search by name still works');
  ok(A.getAllMembersLite().every(m => m.nid), 'the lite member list (payment dialogs) carries the NID');
  // collections search
  A.recordPayment({ member_id: a, payment_month: '2026-10', payment_date: '2026-10-05', contribution_amount: 500, payment_method: 'Cash' });
  ok(A.getCollections('2026-10', 'All', undefined, undefined, '3456789').records.length === 1, 'the Collections search finds the member by NID');
  // editing
  throws(() => A.updateMember(b, { nid: '1990123456789' }), /already belongs/, 'an edit cannot take another member\'s NID');
  throws(() => A.updateMember(b, { nid: '' }), /required/, 'an edit cannot remove the NID');
  A.updateMember(b, { nid: '1990123456795', name: 'Sadia R.' });
  ok(find(b).nid === '1990123456795', 'the NID can be corrected');
  A.updateMember(b, { name: 'Sadia Rahman' });
  ok(find(b).nid === '1990123456795', 'editing other fields without sending the NID keeps it');
  const h = A.checkAccountingHealth();
  ok(h.checks.find(c => c.id === 'mem_nid').status === 'pass' && h.checks.find(c => c.id === 'mem_nid_fmt').status === 'pass', 'health check: all members have valid unique NIDs');
  // CSV bulk add
  throws(() => A.bulkAddMembers([{ name: 'No Nid Row' }]), /Row 1.*required/, 'bulk add refuses a row without NID, before importing anything');
  throws(() => A.bulkAddMembers([{ name: 'X', nid: '2000000000001' }, { name: 'Y', nid: '2000000000001' }]), /also used in row 1/, 'bulk add refuses duplicate NIDs inside the list');
  ok(A.getMembers('', 'All').total === 4, 'nothing was added by the refused bulk imports');
  ok(A.bulkAddMembers([{ name: 'Bulk One', nid: '2000000000011' }, { name: 'Bulk Two', nid: '2000000000012' }]) === 2, 'bulk add works with valid NIDs');
  console.log(fails ? `\n${fails} FAILURE(S)` : '\nNID TESTS PASSED');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error('CRASH', e); process.exit(1); });
