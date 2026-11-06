/** Encrypted-backup tests (crypto layer, PIN + Super User recovery).   npm run test:backup */
const path = require('path'), crypto = require('crypto');
const C = require(path.join(__dirname, '..', 'dist-electron', 'backup-crypto.js'));
let fails = 0; const ok = (c, m) => { console.log(`${c ? 'PASS' : 'FAIL'}  ${m}`); if (!c) fails++; };
const throws = (fn, re, m) => { try { fn(); ok(false, m + ' (no error)'); } catch (e) { ok(re.test(e.message), `${m} -> "${e.message}"`); } };

const sqlite = Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.from('Rafiq Hasan 01711223344 secret-member-data '.repeat(500))]);
const pin = '482915';

// ---- PIN protection
const enc = C.encryptBackup(sqlite, pin);
ok(C.isEncryptedBackup(enc), 'encrypted file carries the Bondhu Fund backup header');
ok(!enc.includes(Buffer.from('SQLite format 3')) && !enc.includes(Buffer.from('Rafiq')) && !enc.includes(Buffer.from('01711223344')), 'the file contains no readable database content');
ok(C.decryptBackup(enc, pin).equals(sqlite), 'the right PIN restores the exact database bytes');
throws(() => C.decryptBackup(enc, '482916'), /Incorrect PIN/, 'a PIN that is off by one digit is rejected');
throws(() => C.decryptBackup(enc, ''), /Incorrect PIN/, 'an empty PIN is rejected');
for (const [name, at] of [['ciphertext', enc.length - 5], ['PIN salt', 8], ['wrapped key', 60]]) {
  const t = Buffer.from(enc); t[at] ^= 1;
  throws(() => C.decryptBackup(t, pin), /Incorrect PIN|damaged/, `any edit of the ${name} is detected`);
}
ok(!C.encryptBackup(sqlite, pin).equals(enc), 'two backups of the same data with the same PIN differ (random key, salt, IV)');
throws(() => C.encryptBackup(sqlite, '123'), /at least 6/, 'a PIN shorter than 6 characters is refused');
throws(() => C.decryptBackup(sqlite, pin), /not an encrypted/, 'a plain database is not mistaken for an encrypted backup');
ok(!C.hasMasterRecovery(enc), 'a backup made before master recovery was set up carries no recovery block');
throws(() => C.decryptBackupWithMaster(enc, '1234', 'pw'), /without master recovery/, '...and cannot be opened by the Super User (only by its own PIN)');
const t0 = Date.now(); C.decryptBackup(enc, pin); const ms = Date.now() - t0;
ok(ms > 30, `each PIN attempt is deliberately slow (${ms} ms), which makes guessing impractical`);

// ---- Super User master recovery
const MASTER = 'm4ster', PASSWORD = 'super-user-password';
const keys = C.deriveMasterKeys(MASTER, PASSWORD);
ok(keys.publicKey.length === 32 && C.deriveMasterKeys(MASTER, PASSWORD).publicKey.equals(keys.publicKey), 'the recovery key pair is derived deterministically (nothing needs to be stored)');
ok(!C.deriveMasterKeys(MASTER, PASSWORD + 'x').publicKey.equals(keys.publicKey) && !C.deriveMasterKeys(MASTER + 'x', PASSWORD).publicKey.equals(keys.publicKey), 'a different password or master PIN gives a different key');
const encM = C.encryptBackup(sqlite, pin, keys.publicKey);
ok(C.hasMasterRecovery(encM), 'a backup made with the recovery key carries a recovery block');
ok(C.decryptBackup(encM, pin).equals(sqlite), 'the owner\'s PIN still opens it');
ok(C.decryptBackupWithMaster(encM, MASTER, PASSWORD).equals(sqlite), 'the Super User opens it with master PIN + account password, without the owner\'s PIN');
throws(() => C.decryptBackupWithMaster(encM, MASTER, 'wrong-password'), /Incorrect master PIN or password/, 'master PIN with the wrong password is rejected');
throws(() => C.decryptBackupWithMaster(encM, 'wrong', PASSWORD), /Incorrect master PIN or password/, 'wrong master PIN is rejected');
const tM = Buffer.from(encM); tM[6 + 16 + 12 + 16 + 32 + 5] ^= 1;
throws(() => C.decryptBackupWithMaster(tM, MASTER, PASSWORD), /Incorrect master PIN or password|damaged/, 'a damaged recovery block is detected');
ok(!encM.includes(Buffer.from(MASTER)) && !encM.includes(Buffer.from(PASSWORD)) && !encM.includes(Buffer.from('Rafiq')), 'neither the master PIN, the password nor the data appear in the file');
// the short master PIN alone is useless to a thief: every guess must also guess the account password
let opened = false;
for (const guess of ['1261', '0000', '1234', MASTER]) { try { C.decryptBackupWithMaster(encM, guess, 'a-guess-of-the-password'); opened = true; } catch { /* expected */ } }
ok(!opened, 'guessing master PINs without the account password never opens a backup');
console.log(fails ? `\n${fails} FAILURE(S)` : '\nENCRYPTED BACKUP TESTS PASSED');
process.exit(fails ? 1 : 0);
