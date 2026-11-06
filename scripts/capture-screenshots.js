/**
 * Captures the three documentation screenshots of the real app into docs/screenshots/.
 *
 *   BONDHU_SYSTEM_PASSWORD=<iqbal_labs password> npm run screenshots
 *
 * Runs the compiled app (dist + dist-electron) in an isolated, throw-away profile, signs in as iqbal_labs (the only account allowed to load demo data),
 * loads demo data and sets a sample logo. Your real data is never touched.
 * Output: 01-overview.png (light), 02-collections.png (light), 03-dark-overview.png (dark).
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { app } = require('electron');

const root = path.resolve(__dirname, '..');
const outDir = path.join(root, 'docs', 'screenshots');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bondhu-shots-'));
fs.mkdirSync(outDir, { recursive: true });

require(path.join(root, 'dist-electron', 'main.js'));
app.setPath('userData', profile); // isolated profile: never the user's real database

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
  const nav = label => js(`(() => { const b=[...document.querySelectorAll('aside nav button')].find(b => (b.textContent||'').trim().toLowerCase().includes(${JSON.stringify(label.toLowerCase())})); if (b) b.click(); return !!b; })()`);
  const top = () => js(`document.querySelector('main').scrollTop = 0`);
  const prefs = dark => js(`localStorage.setItem('bondhu_language','en'); localStorage.setItem('bondhu_dark_mode','${dark}'); localStorage.setItem('bondhu_sidebar_collapsed','false'); location.reload()`);

  await sleep(1500);
  await js(`window.electronAPI.call('login', ['iqbal_labs', ${JSON.stringify(pw)}])`);
  const logo = 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'build', 'icon.png')).toString('base64');
  await js(`window.electronAPI.call('loadDemoData', [])`);
  await js(`window.electronAPI.call('saveAppSettings', [{ organization_name: 'Bondhu Fund', organization_name_bn: 'বন্ধু ফান্ড', org_logo: ${JSON.stringify(logo)} }])`);

  await prefs(false); await sleep(3500);
  await nav('overview'); await top(); await shot('01-overview');
  await nav('collections'); await top(); await shot('02-collections', 2000);

  await prefs(true); await sleep(3500);
  await nav('overview'); await top(); await shot('03-dark-overview');

  await prefs(false); await sleep(1500);
  done();
}
