/**
 * Google Drive sync engine (main process, no Electron or database imports — everything arrives through ports, so it is fully tested).
 *
 * WHAT IS SYNCED   the whole database as one snapshot, plus the signed consent-paper files it refers to.
 * HOW IT STAYS SAFE   every snapshot has a revision number. Each computer remembers the revision it last synced and whether it has changed data
 *                     since. Then:
 *   • cloud unchanged since my last sync, I changed things  → PUSH my data (new revision)
 *   • cloud is newer, I changed nothing (new computer, or a second PC) → PULL: replace my data with the cloud's
 *   • cloud is newer AND I changed things (two PCs edited separately)  → CONFLICT: nothing is overwritten until the user chooses
 *     which side to keep; the other side is never lost (a local safety copy is made first; older cloud snapshots stay in Drive)
 * Layout in the hidden Drive folder:
 *   bondhu-sync-head.json          which snapshot is current (revision, time, device, counts, documents)
 *   bondhu-snap-<rev>-<dev>.bfsnap the snapshot (gzip, or encrypted with the sync PIN when that is switched on)
 *   bondhu-doc-<sha256>            a signed consent paper
 *   bondhu-backup-<stamp>.bfbak    manual Drive backups (the app's normal PIN-encrypted backup file)
 */
import * as zlib from 'zlib';
import * as crypto from 'crypto';
import { DriveApi, DriveFile, failure } from './google';

export const HEAD_NAME = 'bondhu-sync-head.json';
export const SNAP_PREFIX = 'bondhu-snap-';
export const DOC_PREFIX = 'bondhu-doc-';
export const BACKUP_PREFIX = 'bondhu-backup-';
export const KEEP_SNAPSHOTS = 5;
export const KEEP_BACKUPS = 30;

/** Records that real data changed on this computer. Works whether or not Google is connected, so edits made while disconnected are never missed. */
export function markDirtyIn(store: { load(): SyncState; save(s: SyncState): void }) {
  const s = store.load();
  if (!s.dirty) { s.dirty = true; s.dirtyAt = new Date().toISOString(); store.save(s); }
}

export interface SyncState {
  deviceId: string; deviceName: string; account: string | null;
  lastRev: number; lastHash: string; lastSyncAt: string | null;
  dirty: boolean; dirtyAt: string | null;
  auto: boolean; encrypt: boolean; lastResult: string | null;
}
export interface StateStore { load(): SyncState; save(s: SyncState): void }
export interface SecretVault { get(k: string): string | null; set(k: string, v: string): void; delete(k: string): void }
export interface CryptoPort { isEncrypted(b: Buffer): boolean; encrypt(plain: Buffer, pin: string): Buffer; decrypt(blob: Buffer, pin: string): Buffer; validatePin(pin: string): string }
export interface LocalDoc { name: string; sha256: string; size: number; read(): Buffer }
export interface LocalPort {
  exportBytes(): Buffer;
  replaceWith(bytes: Buffer): void;
  hasData(): boolean;
  counts(): Record<string, number>;
  /** a copy of the current data kept on this computer before it is replaced */
  safetySnapshot(label: string): void;
  docs(): LocalDoc[];
  hasDoc(name: string): boolean;
  saveDoc(name: string, bytes: Buffer): void;
  /** after a pull: point document paths at this computer and check the signed-in user still exists */
  afterPull(): void;
}

export interface Head {
  format: 1; revision: number; snapshotId: string; snapshotName: string; snapshotSha: string; encrypted: boolean; size: number;
  at: string; deviceId: string; deviceName: string; counts: Record<string, number>;
  docs: Array<{ name: string; sha256: string; size: number; id: string }>;
}

export type SyncStatus = 'up-to-date' | 'pushed' | 'pulled' | 'conflict' | 'needs-pin' | 'nothing' | 'wrong-pin';
export interface SyncResult {
  status: SyncStatus; message: string; revision?: number;
  /** the data on this computer was replaced: the screen must reload */
  replaced?: boolean;
  conflict?: { local: { dirtyAt: string | null; counts: Record<string, number> }; remote: { at: string; deviceName: string; revision: number; counts: Record<string, number> } };
}

const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const nowIso = () => new Date().toISOString();

export class SyncEngine {
  private busy = false;
  constructor(
    private drive: DriveApi, private local: LocalPort, private store: StateStore, private vault: SecretVault, private cx: CryptoPort,
    private account: () => string | null,
  ) {}

  // ---- state ------------------------------------------------------------------------------------------------
  state(): SyncState {
    const s = this.store.load();
    const acct = this.account();
    if (acct && s.account && s.account !== acct) { s.lastRev = 0; s.lastHash = ''; s.account = acct; this.store.save(s); }   // a different Google account: start from scratch
    return s;
  }
  private patch(p: Partial<SyncState>) { const s = this.store.load(); Object.assign(s, p); this.store.save(s); return s; }
  /** Called whenever real data changed on this computer. */
  markDirty() { markDirtyIn(this.store); }
  setAuto(auto: boolean) { this.patch({ auto }); }
  hasPin() { return !!this.vault.get('syncPin'); }

  /** Switch the PIN protection of the cloud copy on or off. The next sync re-uploads the data in the new form. */
  setEncryption(enabled: boolean, pin?: string) {
    if (enabled) { this.vault.set('syncPin', this.cx.validatePin(pin)); this.patch({ encrypt: true, dirty: true, dirtyAt: nowIso() }); }
    else { this.vault.delete('syncPin'); this.patch({ encrypt: false, dirty: true, dirtyAt: nowIso() }); }
  }

  // ---- head -------------------------------------------------------------------------------------------------
  private async headFile(): Promise<DriveFile | null> { return (await this.drive.list({ name: HEAD_NAME }))[0] || null; }
  async readHead(): Promise<Head | null> {
    const f = await this.headFile();
    if (!f) return null;
    try { const h = JSON.parse((await this.drive.download(f.id)).toString('utf8')); return h && h.format === 1 ? h as Head : null; }
    catch { throw failure('unknown', 'head unreadable', 'The cloud copy\'s index could not be read. Try again, or restore from a Drive backup.'); }
  }
  private async writeHead(h: Head) {
    const f = await this.headFile();
    const bytes = Buffer.from(JSON.stringify(h));
    if (f) await this.drive.update(f.id, bytes); else await this.drive.create(HEAD_NAME, bytes, { kind: 'head' });
  }

  /** Cheap look at the cloud: is there newer data, and do I have unsynced changes? (does not change anything) */
  async checkRemote() {
    const st = this.state(); const head = await this.readHead();
    return {
      remote: head ? { revision: head.revision, at: head.at, deviceName: head.deviceName, counts: head.counts, encrypted: head.encrypted, mine: head.deviceId === st.deviceId } : null,
      remoteNewer: !!head && head.revision > st.lastRev && head.deviceId !== st.deviceId,
      localDirty: st.dirty,
    };
  }

  // ---- the sync ---------------------------------------------------------------------------------------------
  async syncNow(opts: { resolve?: 'local' | 'remote'; pin?: string; auto?: boolean; pushOnly?: boolean } = {}): Promise<SyncResult> {
    if (this.busy) throw failure('unknown', 'busy', 'A sync is already running. Wait a moment.');
    this.busy = true;
    try { const r = await this.run(opts); this.patch({ lastResult: `${r.status}: ${r.message}` }); return r; }
    finally { this.busy = false; }
  }

  private async run(opts: { resolve?: 'local' | 'remote'; pin?: string; auto?: boolean; pushOnly?: boolean }): Promise<SyncResult> {
    const st = this.state();
    const head = await this.readHead();
    const hasData = this.local.hasData();
    if (!head) {
      if (!hasData) return { status: 'nothing', message: 'There is no data here or in Google Drive yet.' };
      return this.push(null, st);
    }
    if (head.revision === st.lastRev) return st.dirty ? this.push(head, st) : { status: 'up-to-date', message: 'Everything is already in sync.', revision: head.revision };
    if (head.revision < st.lastRev) return this.push(head, st);          // the cloud was rolled back: this computer holds the newer data
    // the cloud has a revision this computer has not seen
    const freshPc = !hasData;
    const independent = st.lastRev === 0 && hasData;                      // two separate histories (e.g. data entered on a second PC before ever syncing)
    const bothChanged = st.dirty && st.lastRev > 0;
    if (!freshPc && (independent || bothChanged)) {
      if (opts.resolve === 'local') return this.push(head, st);
      if (opts.resolve !== 'remote') {
        return {
          status: 'conflict', message: 'This computer and Google Drive both have changes the other does not. Choose which data to keep.',
          conflict: { local: { dirtyAt: st.dirtyAt, counts: this.local.counts() }, remote: { at: head.at, deviceName: head.deviceName, revision: head.revision, counts: head.counts } },
        };
      }
    }
    // background syncing never replaces data while someone may be working: it only uploads
    if (opts.pushOnly) return { status: 'up-to-date', message: 'Newer data is waiting in Google Drive. Press Sync now to bring it here.', revision: head.revision };
    return this.pull(head, st, opts.pin);
  }

  private async push(head: Head | null, st: SyncState): Promise<SyncResult> {
    const dbBytes = this.local.exportBytes();
    let blob: Buffer; let encrypted = false;
    if (st.encrypt) {
      const pin = this.vault.get('syncPin');
      if (!pin) return { status: 'needs-pin', message: 'Enter the sync PIN to keep the cloud copy protected.' };
      blob = this.cx.encrypt(dbBytes, pin); encrypted = true;
    } else blob = zlib.gzipSync(dbBytes);
    const rev = (head?.revision || 0) + 1;
    const snapName = `${SNAP_PREFIX}${String(rev).padStart(6, '0')}-${st.deviceId.slice(0, 6)}.bfsnap`;
    const snap = await this.drive.create(snapName, blob, { kind: 'snap', rev: String(rev), enc: encrypted ? '1' : '0' });

    // signed papers: upload those the cloud does not have yet
    const have = new Map((head?.docs || []).map(d => [d.sha256, d.id]));
    const docs: Head['docs'] = [];
    for (const d of this.local.docs()) {
      let id = have.get(d.sha256);
      if (!id) { const f = await this.drive.create(`${DOC_PREFIX}${d.sha256}`, d.read(), { kind: 'doc', name: d.name }); id = f.id; have.set(d.sha256, id); }
      docs.push({ name: d.name, sha256: d.sha256, size: d.size, id });
    }

    // another computer may have pushed while this one was uploading: never overwrite a revision we have not seen
    const again = await this.readHead();
    if ((again?.revision || 0) !== (head?.revision || 0)) {
      try { await this.drive.remove(snap.id); } catch { /* best effort */ }
      return { status: 'conflict', message: 'Another computer synced a moment ago. Press Sync again.', conflict: undefined };
    }
    const newHead: Head = { format: 1, revision: rev, snapshotId: snap.id, snapshotName: snapName, snapshotSha: sha(blob), encrypted, size: blob.length, at: nowIso(), deviceId: st.deviceId, deviceName: st.deviceName, counts: this.local.counts(), docs };
    await this.writeHead(newHead);
    this.patch({ lastRev: rev, lastHash: newHead.snapshotSha, lastSyncAt: newHead.at, dirty: false, dirtyAt: null, account: this.account() });
    await this.prune(newHead);
    return { status: 'pushed', message: `Your data was uploaded to Google Drive (revision ${rev}).`, revision: rev };
  }

  private async pull(head: Head, st: SyncState, pinGiven?: string): Promise<SyncResult> {
    let pin: string | null = null;
    if (head.encrypted) {
      pin = pinGiven || this.vault.get('syncPin');
      if (!pin) return { status: 'needs-pin', message: 'The cloud copy is protected with a sync PIN. Enter it to continue.' };
    }
    const blob = await this.drive.download(head.snapshotId);
    if (sha(blob) !== head.snapshotSha) throw failure('unknown', 'hash mismatch', 'The downloaded data is damaged. Try again.');
    let db: Buffer;
    try { db = head.encrypted ? this.cx.decrypt(blob, pin!) : zlib.gunzipSync(blob); }
    catch (e: any) { if (head.encrypted) return { status: 'wrong-pin', message: 'That sync PIN is not correct.' }; throw failure('unknown', String(e?.message), 'The downloaded data could not be opened.'); }

    // the papers first (if one fails, nothing has been replaced yet)
    const papers: Array<{ name: string; bytes: Buffer }> = [];
    for (const d of head.docs) {
      if (this.local.hasDoc(d.name)) continue;
      const b = await this.drive.download(d.id);
      if (sha(b) !== d.sha256) throw failure('unknown', 'doc hash mismatch', `The signed paper "${d.name}" came back damaged. Try again.`);
      papers.push({ name: d.name, bytes: b });
    }
    this.local.safetySnapshot('PreSync');                       // the data being replaced is always kept on this computer first
    this.local.replaceWith(db);
    for (const p of papers) this.local.saveDoc(p.name, p.bytes);
    this.local.afterPull();
    if (pin && !this.vault.get('syncPin')) this.vault.set('syncPin', pin);
    this.patch({ lastRev: head.revision, lastHash: head.snapshotSha, lastSyncAt: nowIso(), dirty: false, dirtyAt: null, account: this.account(), encrypt: head.encrypted });
    return { status: 'pulled', message: `Data from Google Drive (revision ${head.revision}, saved on ${head.deviceName}) is now on this computer.`, revision: head.revision, replaced: true };
  }

  /** Keep only the newest snapshots, and drop papers no longer used. */
  private async prune(head: Head) {
    try {
      const snaps = (await this.drive.list({ prefix: SNAP_PREFIX })).sort((a, b) => b.name.localeCompare(a.name));
      for (const f of snaps.slice(KEEP_SNAPSHOTS)) if (f.id !== head.snapshotId) await this.drive.remove(f.id);
      const used = new Set(head.docs.map(d => `${DOC_PREFIX}${d.sha256}`));
      for (const f of await this.drive.list({ prefix: DOC_PREFIX })) if (!used.has(f.name)) await this.drive.remove(f.id);
    } catch { /* clean-up is best effort: the sync itself already succeeded */ }
  }

  // ---- manual Drive backups (the normal PIN-encrypted backup file, kept in Drive) -----------------------------------
  async uploadBackup(bytes: Buffer, meta: { device: string; encrypted: boolean }): Promise<DriveFile> {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const f = await this.drive.create(`${BACKUP_PREFIX}${stamp}-${crypto.randomBytes(2).toString('hex')}.bfbak`, bytes, { kind: 'backup', device: meta.device, enc: meta.encrypted ? '1' : '0', at: nowIso() });
    try {
      const all = (await this.drive.list({ prefix: BACKUP_PREFIX })).sort((a, b) => b.name.localeCompare(a.name));
      for (const old of all.slice(KEEP_BACKUPS)) await this.drive.remove(old.id);
    } catch { /* best effort */ }
    return f;
  }
  async listBackups(): Promise<Array<{ id: string; name: string; size: number; at: string; device: string; encrypted: boolean }>> {
    return (await this.drive.list({ prefix: BACKUP_PREFIX })).sort((a, b) => b.name.localeCompare(a.name))
      .map(f => ({ id: f.id, name: f.name, size: f.size, at: f.props.at || f.createdTime, device: f.props.device || '', encrypted: f.props.enc !== '0' }));
  }
  downloadBackup(id: string) { return this.drive.download(id); }
  deleteBackup(id: string) { return this.drive.remove(id); }
}

/** Does this computer's data differ from the last sync? (used to show "unsynced changes") */
export const describeResult = (r: SyncResult) => `${r.status}: ${r.message}`;
