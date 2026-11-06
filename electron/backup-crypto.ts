/**
 * Encrypted backups (.bfbak) with an optional Super-User recovery path.
 *
 *   file = MAGIC | pinSalt(16) | pinIv(12) | pinTag(16) | wrappedKey(32)      <- data key, wrapped by the user's PIN
 *        | escrow(1) [ ephPub(32) | escIv(12) | escTag(16) | escWrapped(32) ]  <- same key, only for the master recovery key
 *        | dataIv(12) | dataTag(16) | ciphertext                              <- AES-256-GCM
 *
 * - A random 256-bit data key encrypts the database. It is wrapped by a key derived from the user's PIN (scrypt),
 *   so the database is useless without the exact PIN and without this file format.
 * - Master recovery: the data key is also wrapped for an X25519 *public* key. The matching private key is not stored
 *   anywhere: it is re-derived from the Super User's master PIN AND account password (scrypt) only when recovering.
 *   A stolen backup therefore contains nothing that a short PIN alone can open.
 * - GCM authenticates everything: a wrong PIN, or any change to the file, is detected.
 */
import * as crypto from 'crypto';

const MAGIC = Buffer.from('BFBAK\x01', 'latin1');
const SALT = 16, IV = 12, TAG = 16, KEY = 32;
const APP_BINDING = 'BondhuFund.backup.v1|2e4f8d1a7c3b9065';
const MASTER_SALT = Buffer.from('BondhuFund.master.v1|7a31c9e5d20b84f6', 'utf8');
const PKCS8_X25519 = Buffer.from('302e020100300506032b656e04220420', 'hex');
const SPKI_X25519 = Buffer.from('302a300506032b656e032100', 'hex');
export const MIN_PIN_LENGTH = 6;
export const MAX_PIN_LENGTH = 64;

export class BackupPinError extends Error {}

export function validatePin(pin: unknown): string {
  const p = typeof pin === 'string' ? pin : '';
  if (p.length < MIN_PIN_LENGTH) throw new BackupPinError(`The PIN must be at least ${MIN_PIN_LENGTH} characters.`);
  if (p.length > MAX_PIN_LENGTH) throw new BackupPinError(`The PIN must be at most ${MAX_PIN_LENGTH} characters.`);
  return p;
}

const scrypt = (secret: string, salt: Buffer, N: number) =>
  crypto.scryptSync(Buffer.from(secret.normalize('NFKC'), 'utf8'), salt, 32, { N, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
const bind = (k: Buffer) => crypto.createHmac('sha256', APP_BINDING).update(k).digest();

function gcmEncrypt(key: Buffer, iv: Buffer, data: Buffer) {
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(MAGIC);
  const ct = Buffer.concat([c.update(data), c.final()]);
  return { ct, tag: c.getAuthTag() };
}
function gcmDecrypt(key: Buffer, iv: Buffer, tag: Buffer, ct: Buffer) {
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
  d.setAAD(MAGIC);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

// ------------------------------------------------------------------ master recovery key
/** Deterministic key pair from the Super User's master PIN + account password. Nothing is stored. */
export function deriveMasterKeys(masterPin: string, password: string): { publicKey: Buffer; privateKey: crypto.KeyObject } {
  if (!masterPin || !password) throw new BackupPinError('The master PIN and the account password are both required.');
  const seed = scrypt(`${masterPin}\u0000${password}`, MASTER_SALT, 1 << 16);
  const privateKey = crypto.createPrivateKey({ key: Buffer.concat([PKCS8_X25519, seed]), format: 'der', type: 'pkcs8' });
  const publicKey = (crypto.createPublicKey(privateKey).export({ format: 'der', type: 'spki' }) as Buffer).subarray(-32);
  return { publicKey: Buffer.from(publicKey), privateKey };
}
const pubObject = (raw: Buffer) => crypto.createPublicKey({ key: Buffer.concat([SPKI_X25519, raw]), format: 'der', type: 'spki' });

// ------------------------------------------------------------------ format
export function isEncryptedBackup(bytes: Uint8Array): boolean {
  return bytes.length > MAGIC.length + SALT + IV + TAG + KEY + 1 && Buffer.from(bytes.subarray(0, MAGIC.length)).equals(MAGIC);
}

export function encryptBackup(plain: Uint8Array, pin: string, masterPublicKey?: Buffer | null): Buffer {
  const p = validatePin(pin);
  const dek = crypto.randomBytes(KEY);
  // data
  const dataIv = crypto.randomBytes(IV);
  const data = gcmEncrypt(dek, dataIv, Buffer.from(plain));
  // wrapped by the PIN
  const pinSalt = crypto.randomBytes(SALT), pinIv = crypto.randomBytes(IV);
  const wPin = gcmEncrypt(bind(scrypt(p, pinSalt, 1 << 15)), pinIv, dek);
  // wrapped for the master recovery key (optional)
  let escrow = Buffer.from([0]);
  if (masterPublicKey && masterPublicKey.length === 32) {
    const eph = crypto.generateKeyPairSync('x25519');
    const shared = crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: pubObject(masterPublicKey) });
    const ephPub = Buffer.from((eph.publicKey.export({ format: 'der', type: 'spki' }) as Buffer).subarray(-32));
    const escIv = crypto.randomBytes(IV);
    const w = gcmEncrypt(bind(shared), escIv, dek);
    escrow = Buffer.concat([Buffer.from([1]), ephPub, escIv, w.tag, w.ct]);
  }
  return Buffer.concat([MAGIC, pinSalt, pinIv, wPin.tag, wPin.ct, escrow, dataIv, data.tag, data.ct]);
}

function parse(buf: Buffer) {
  if (!isEncryptedBackup(buf)) throw new BackupPinError('This is not an encrypted Bondhu Fund backup.');
  let o = MAGIC.length;
  const take = (n: number) => { const s = buf.subarray(o, o + n); o += n; return s; };
  const pinSalt = take(SALT), pinIv = take(IV), pinTag = take(TAG), pinWrapped = take(KEY);
  const hasEscrow = take(1)[0] === 1;
  const esc = hasEscrow ? { ephPub: take(32), iv: take(IV), tag: take(TAG), wrapped: take(KEY) } : null;
  const dataIv = take(IV), dataTag = take(TAG), ct = buf.subarray(o);
  return { pinSalt, pinIv, pinTag, pinWrapped, esc, dataIv, dataTag, ct };
}

const WRONG = 'Incorrect PIN, or the backup file is damaged.';

/** Throws BackupPinError when the PIN is wrong or the file was changed. */
export function decryptBackup(file: Uint8Array, pin: string): Buffer {
  const f = parse(Buffer.from(file));
  try {
    const dek = gcmDecrypt(bind(scrypt(String(pin ?? ''), f.pinSalt, 1 << 15)), f.pinIv, f.pinTag, f.pinWrapped);
    return gcmDecrypt(dek, f.dataIv, f.dataTag, f.ct);
  } catch { throw new BackupPinError(WRONG); }
}

export function hasMasterRecovery(file: Uint8Array): boolean {
  try { return !!parse(Buffer.from(file)).esc; } catch { return false; }
}

/** Super User recovery: opens the backup without the user's PIN, using the key derived from master PIN + password. */
export function decryptBackupWithMaster(file: Uint8Array, masterPin: string, password: string): Buffer {
  const f = parse(Buffer.from(file));
  if (!f.esc) throw new BackupPinError('This backup was made without master recovery, so only its own PIN can open it.');
  try {
    const { privateKey } = deriveMasterKeys(masterPin, password);
    const shared = crypto.diffieHellman({ privateKey, publicKey: pubObject(Buffer.from(f.esc.ephPub)) });
    const dek = gcmDecrypt(bind(shared), f.esc.iv, f.esc.tag, f.esc.wrapped);
    return gcmDecrypt(dek, f.dataIv, f.dataTag, f.ct);
  } catch (e: any) {
    if (e instanceof BackupPinError) throw e;
    throw new BackupPinError('Incorrect master PIN or password, or the backup file is damaged.');
  }
}
