/**
 * Captures documentation screenshots of the real app into docs/screenshots/.
 *
 *   npm run screenshots
 *
 * Runs the compiled app (dist + dist-electron) in an isolated, throw-away profile, loads demo data,
 * sets a sample logo, then visits screens in English (light + dark) and Bangla. Your real data is never touched.
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
  win.unmaximize();
  win.setContentSize(1440, 900);
  const js = code => win.webContents.executeJavaScript(code, true);
  const shot = async (name, wait = 1300) => {
    await sleep(wait);
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(outDir, `${name}.png`), img.resize({ width: 1440 }).toPNG());
    console.log('  ✓', name);
  };
  const nav = label => js(`(() => { const b=[...document.querySelectorAll('aside button')].find(b => ((b.getAttribute('title')||'') + ' ' + (b.textContent||'')).trim().toLowerCase().includes(${JSON.stringify(label.toLowerCase())})); if (b) b.click(); return !!b; })()`);
  const scroll = y => js(`document.querySelector('main').scrollTop = ${y}`);
  const esc = () => js(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); document.dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);
  const prefs = (lang, dark) => js(`localStorage.setItem('bondhu_language','${lang}'); localStorage.setItem('bondhu_dark_mode','${dark}'); localStorage.setItem('bondhu_sidebar_collapsed','false'); location.reload()`);

  await sleep(1500);
  // Demo content + branding
  const logo = 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'build', 'icon.png')).toString('base64');
  await js(`window.electronAPI.call('loadDemoData', [])`);
  await js(`window.electronAPI.call('saveAppSettings', [{ organization_name: 'Bondhu Fund', organization_name_bn: 'বন্ধু ফান্ড', org_logo: ${JSON.stringify(logo)} }])`);

  // ---------- English, light ----------
  await prefs('en', false); await sleep(3000);
  await shot('01-overview');
  await scroll(820); await shot('02-overview-charts');
  await scroll(1700); await shot('03-overview-portfolio');
  await scroll(2600); await shot('04-overview-members');
  await nav('collections'); await shot('05-collections');
  await nav('members'); await shot('06-members');
  await js(`(() => { const b=[...document.querySelectorAll('main button')].find(b => /Add member/.test(b.textContent||'')); b && b.click(); })()`);
  await shot('07-add-member-modal'); await esc(); await sleep(400);
  await nav('entry'); await shot('08-entry-center');
  await nav('operating'); await shot('09-expenses');
  await nav('investments'); await shot('10-investments');
  await nav('reports'); await shot('11-reports');
  await js(`document.querySelector('main button[aria-haspopup="listbox"]')?.click()`); await shot('12-searchable-dropdown'); await esc(); await sleep(300);
  await js(`document.querySelector('main button[aria-haspopup="dialog"]')?.click()`); await shot('13-date-picker'); await esc(); await sleep(300);
  await nav('users'); await shot('14-users');
  await js(`(() => { const e=[...document.querySelectorAll('main *')].find(x => x.children.length===0 && /Nusrat|Administrator|System Admin/.test(x.textContent||'')); e && e.click(); })()`);
  await shot('15-user-profile');
  await nav('master'); await shot('16-master-data');
  await nav('backup'); await shot('17-backup-restore');
  await nav('settings'); await shot('18-settings');

  // ---------- English, dark ----------
  await prefs('en', true); await sleep(3000);
  await shot('19-dark-overview');
  await nav('reports'); await shot('20-dark-reports');

  // ---------- Bangla ----------
  await prefs('bn', false); await sleep(3000);
  await shot('21-bangla-overview');
  await nav('মাসিক'); await shot('22-bangla-collections');
  await nav('সদস্য'); await shot('23-bangla-members');

  await prefs('en', false); await sleep(1500);
  done();
}
