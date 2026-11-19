/**
 * Captures a full client-showcase set of screenshots (every main screen, light + dark) into docs/showcase/.
 *
 *   set BONDHU_SYSTEM_PASSWORD=<iqbal_labs password>   (PowerShell: $env:BONDHU_SYSTEM_PASSWORD='...')
 *   npm run build:all
 *   npx cross-env ELECTRON_RUN_AS_NODE= electron scripts/capture-showcase.js
 *
 * Runs the compiled app in an isolated, throw-away profile with demo data. Your real data is never touched.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { app } = require('electron');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'docs', 'showcase');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bondhu-showcase-'));
fs.mkdirSync(outDir, { recursive: true });

require(path.join(root, 'dist-electron', 'main.js'));
app.setPath('userData', profile);

const sleep = ms => new Promise(r => setTimeout(r, ms));
const problems = [];

app.on('browser-window-created', (_e, win) => {
  win.webContents.on('console-message', (_ev, level, msg) => { if (level >= 2) problems.push(msg); });
  win.webContents.once('did-finish-load', () => run(win).catch(e => { problems.push(e.stack); done(); }));
});

function done() {
  console.log(problems.length ? `Finished with warnings:\n${problems.join('\n')}` : `Screenshots saved to ${outDir}`);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* temp dir */ }
  app.exit(0);
}

// [file prefix, sidebar label to click]
const SCREENS = [
  ['02-overview', 'overview'], ['03-collections', 'collections'], ['04-fines', 'fines'], ['05-members', 'members'],
  ['06-expenses', 'expenses'], ['07-entry-center', 'entry'], ['08-investments', 'investments'], ['09-investment-returns', 'returns'],
  ['10-personal-loans', 'loans'], ['11-reports', 'reports'], ['12-master-data', 'master'], ['13-users-roles', 'users'],
  ['14-backup-restore', 'backup'], ['15-license-control', 'license'], ['16-settings', 'settings'],
];

async function run(win) {
  const pw = process.env.BONDHU_SYSTEM_PASSWORD;
  if (!pw) throw new Error('Set BONDHU_SYSTEM_PASSWORD to the iqbal_labs password (only that account may load demo data).');
  win.unmaximize();
  win.setContentSize(1440, 900);
  const js = code => win.webContents.executeJavaScript(code, true);
  const shot = async (name, wait = 1500) => {
    await sleep(wait);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, `${name}.png`), img.resize({ width: 1440 }).toPNG());
    console.log('  ✓', name);
  };
  const nav = label => js(`(() => { const b=[...document.querySelectorAll('aside nav button')].find(b => (b.textContent||'').trim().toLowerCase().includes(${JSON.stringify(label)})); if (b) b.click(); return !!b; })()`);
  const top = () => js(`(() => { const m = document.querySelector('main'); if (m) m.scrollTop = 0; })()`);
  const prefs = dark => js(`localStorage.setItem('bondhu_language','en'); localStorage.setItem('bondhu_dark_mode','${dark}'); localStorage.setItem('bondhu_sidebar_collapsed','false'); location.reload()`);

  await js(`localStorage.setItem('bondhu_language','en'); localStorage.setItem('bondhu_dark_mode','false')`);
  await sleep(2500);
  await shot('01-login', 500);                       // sign-in screen, before logging in

  await js(`window.electronAPI.call('login', ['iqbal_labs', ${JSON.stringify(pw)}])`);
  const logo = 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'build', 'icon.png')).toString('base64');
  await js(`window.electronAPI.call('loadDemoData', [])`);
  await js(`window.electronAPI.call('saveAppSettings', [{ organization_name: 'Bondhu Fund', organization_name_bn: 'বন্ধু ফান্ড', org_logo: ${JSON.stringify(logo)} }])`);

  await prefs(false); await sleep(3500);
  for (const [name, label] of SCREENS) {
    if (!(await nav(label))) { problems.push(`sidebar item not found: ${label}`); continue; }
    await top(); await shot(name, 2000);
  }

  await prefs(true); await sleep(3500);
  for (const [name, label] of [['17-dark-overview', 'overview'], ['18-dark-collections', 'collections'], ['19-dark-investments', 'investments']]) {
    await nav(label); await top(); await shot(name, 2000);
  }

  await prefs(false); await sleep(1000);
  done();
}
