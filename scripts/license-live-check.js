/**
 * One-off check of the REAL licence server (the project in config/supabase.json), the same code path an installed copy uses.
 *   node scripts/license-live-check.js activate ABCD-EFGH-JKLM [username]   -> activates a throw-away "computer" and prints what the server says
 *   node scripts/license-live-check.js check                     -> asks the server again (use after Suspend / Resume / Payment in the panel)
 *   node scripts/license-live-check.js reset                     -> forgets the throw-away computer
 * Use a test customer only: the PIN is bound to this throw-away computer until you issue a new PIN in the panel.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const root = path.resolve(__dirname, '..');
const L = require(path.join(root, 'dist-electron', 'license.js'));
const cfgJson = JSON.parse(fs.readFileSync(path.join(root, 'config', 'supabase.json'), 'utf8'));
const cfg = { url: cfgJson.SUPABASE_URL, key: cfgJson.SUPABASE_PUBLISHABLE_KEY };
const file = path.join(os.tmpdir(), 'bondhu-license-live-check.json');
const saved = (() => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return { state: null, token: null }; } })();
const state = { load: () => saved.state || (saved.state = L.freshState()), save: s => { saved.state = s; fs.writeFileSync(file, JSON.stringify(saved)); } };
const vault = { get: () => saved.token, set: t => { saved.token = t; fs.writeFileSync(file, JSON.stringify(saved)); }, clear: () => { saved.token = null; fs.writeFileSync(file, JSON.stringify(saved)); } };
const client = new L.LicenseClient(cfg, true, fetch, state, vault, () => 'LIVE-CHECK-PC', () => 'live-check');
const show = v => console.log(JSON.stringify({ locked: v.locked, reason: v.reason, customer: v.customer, status: v.status, paidUntil: v.paidUntil, daysLeft: v.daysLeft, message: v.message, lastError: v.lastError }, null, 2));

(async () => {
  const [cmd, pin] = process.argv.slice(2);
  if (cmd === 'reset') { try { fs.unlinkSync(file); } catch { /* none */ } console.log('forgotten'); return; }
  if (cmd === 'activate') { if (!pin) throw new Error('give the PIN'); console.log('before:', client.view().reason); show(await client.activate(pin, process.argv[4])); return; }
  if (cmd === 'check') { await client.check(); show(client.view(pin)); return; }
  console.log('usage: activate <PIN> | check | reset');
})().catch(e => { console.error('FAILED:', e.code || '', e.message); process.exit(1); });
