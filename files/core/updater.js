// Brazy Toolkit desktop core — updates.
// Online (8.0): latest.json is checked at start and every hour. A newer release is downloaded quietly in the background
// (only the files that changed, each one checked by its fingerprint) into content.next, then the toolkit asks
// "install now?". Installing swaps the folder in and reloads the toolkit; when the app core changed too, the app restarts.
// When a release needs a newer Electron runtime, the installer itself is downloaded (in parts) and run silently instead.
// Offline: a .rsupd file (zip: update.json + files) can be opened / dropped / double-clicked as before.
const { app, net } = require('electron');
const path = require('path'), fs = require('fs'), os = require('os'), zlib = require('zlib');
const S = require('./store');

const U = module.exports = {
  state: { phase: 'idle' },   // idle | checking | downloading | ready | installing | error | needsInstaller
  win: null, timer: null, latest: null,
  HOUR: 60 * 60 * 1000,
  url: () => (S.cfg.updateUrl || readPkg().updateUrl || '').replace(/\/+$/, ''),
  send(ch, data) { if (U.win && !U.win.isDestroyed()) U.win.webContents.send(ch, data); },
  setState(s) { U.state = s; U.send('rs:updateState', s); },
};
function readPkg() { return S.readJSON(path.join(S.BOOT.root, 'package.json'), {}); }

/* ---------------- online ---------------- */
async function fetchJSON(url) { const r = await net.fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }
async function fetchBuf(url) { const r = await net.fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url.split('/').pop()); return Buffer.from(await r.arrayBuffer()); }
const enc = rel => rel.split('/').map(encodeURIComponent).join('/');

/** a staged update from an earlier session that is still waiting */
function staged() { const n = S.nextDir(), i = S.info(n); return i && i.complete && S.vcmp(i.version, S.activeRoot().version) > 0 ? i : null; }

U.check = async function (manual) {
  if (['checking', 'downloading', 'installing'].includes(U.state.phase)) return U.state;
  const base = U.url(); if (!base) return U.state;
  const ready = staged(); if (ready) { U.setState({ phase: 'ready', version: ready.version, notes: ready.notes || null, restart: !!ready.restart }); return U.state; }
  U.setState({ phase: 'checking' });
  let j; try { j = await fetchJSON(base + '/latest.json'); } catch (e) { U.setState({ phase: 'idle', offline: true }); return U.state; }
  U.latest = j; const cur = S.activeRoot();
  if (!j || !j.version || S.vcmp(j.version, cur.version) <= 0) { U.setState({ phase: 'idle', upToDate: true, version: cur.version }); return U.state; }
  try {
    if (needsRuntime(j)) await stageInstaller(j); else await stageRelease(j);
  } catch (e) { U.setState({ phase: 'error', msg: e.message, version: j.version }); }
  return U.state;
};
const needsRuntime = j => !!(j.runtime && j.runtime.electron && S.vcmp(j.runtime.electron, process.versions.electron) > 0);

/** content + core of release j into content.next: unchanged files are linked from the running release, the rest downloaded */
async function stageRelease(j) {
  if (!j.manifest || !j.files) throw new Error('latest.json has no file list');
  const cur = S.activeRoot(), have = S.hashes(cur.dir), need = [], keep = [];
  for (const [rel, [h, size]] of Object.entries(j.manifest)) { if (!S.SAFE.test(rel)) throw new Error('invalid file in update: ' + rel); (have[rel] === h ? keep : need).push({ rel, h, size }); }
  const total = need.reduce((a, f) => a + (f.size || 0), 0); let done = 0;
  const nx = S.nextDir(); S.rm(nx); fs.mkdirSync(nx, { recursive: true });
  U.setState({ phase: 'downloading', version: j.version, notes: j.notes || null, done: 0, total, files: need.length });
  const base = U.url() + '/' + String(j.files).replace(/^\/+|\/+$/g, '') + '/';
  for (const f of need) {
    const b = await fetchBuf(base + enc(f.rel)); if (S.sha256(b) !== f.h) throw new Error('checksum ' + f.rel);
    const p = path.join(nx, ...f.rel.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, b);
    done += b.length; U.send('rs:updateProgress', { done, total });
  }
  for (const f of keep) S.linkOrCopy(path.join(cur.dir, ...f.rel.split('/')), path.join(nx, ...f.rel.split('/')));
  const restart = need.some(f => f.rel.startsWith('core/'));
  fs.writeFileSync(path.join(nx, 'content.json'), JSON.stringify({ version: j.version, notes: j.notes || null, staged: new Date().toISOString(), downloaded: need.length, bytes: total, restart, complete: true }, null, 1));
  U.setState({ phase: 'ready', version: j.version, notes: j.notes || null, restart, bytes: total });
}

/** a release that needs a newer Electron runtime: the installer (hosted in parts) is downloaded and checked */
async function stageInstaller(j) {
  const r = j.runtime, inst = r.installer; if (!inst || !inst.parts || !inst.sha256) { U.setState({ phase: 'needsInstaller', version: j.version, notes: j.notes || null }); return; }
  const dir = path.join(S.user(), 'installer'), exe = path.join(dir, `Brazy Toolkit Setup ${j.version}.exe`);
  if (fs.existsSync(exe) && S.sha256(fs.readFileSync(exe)) === inst.sha256) { U.setState({ phase: 'ready', version: j.version, notes: j.notes || null, restart: true, installer: exe }); return; }
  S.rm(dir); fs.mkdirSync(dir, { recursive: true });
  U.setState({ phase: 'downloading', version: j.version, notes: j.notes || null, done: 0, total: inst.size || 0, installer: true });
  const parts = []; let done = 0;
  for (const p of inst.parts) { const b = await fetchBuf(U.url() + '/' + enc(p)); parts.push(b); done += b.length; U.send('rs:updateProgress', { done, total: inst.size || done }); }
  const all = Buffer.concat(parts); if (S.sha256(all) !== inst.sha256) throw new Error('installer checksum');
  fs.writeFileSync(exe, all);
  U.setState({ phase: 'ready', version: j.version, notes: j.notes || null, restart: true, installer: exe });
}

/** "Install now": swap the staged release in (reload or restart), or run the downloaded installer silently */
U.install = function (reload) {
  const st = U.state; if (st.phase !== 'ready') return { ok: false, msg: 'no update ready' };
  if (st.installer) {
    const { spawn } = require('child_process');
    spawn(st.installer, ['/S'], { detached: true, stdio: 'ignore', windowsHide: false }).unref();
    U.setState({ phase: 'installing', version: st.version, installer: true }); setTimeout(() => app.quit(), 300); return { ok: true, installer: true };
  }
  const nx = S.nextDir(), ci = S.info(nx); if (!ci || !ci.complete) return { ok: false, msg: 'update incomplete' };
  const cd = S.contentDir(), old = cd + '.old'; S.rm(old);
  if (fs.existsSync(cd)) fs.renameSync(cd, old);
  fs.renameSync(nx, cd); S.rm(old);
  S.cfg.justUpdated = ci.version; S.save(); U.setState({ phase: 'installing', version: ci.version, restart: !!ci.restart });
  if (ci.restart) { setTimeout(() => { app.relaunch(); app.exit(0); }, 200); return { ok: true, restart: true }; }
  reload(); U.setState({ phase: 'idle', version: ci.version }); return { ok: true, version: ci.version };
};

U.start = function (win) {
  U.win = win; clearInterval(U.timer);
  setTimeout(() => U.check(), 4000);
  U.timer = setInterval(() => U.check(), U.HOUR);
};

/* ---------------- offline: .rsupd files ---------------- */
function readZip(buf) {
  let e = -1; for (let i = buf.length - 22; i >= Math.max(0, buf.length - 70000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('not a zip');
  const n = buf.readUInt16LE(e + 10); let o = buf.readUInt32LE(e + 16); const out = {};
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(o) !== 0x02014b50) throw new Error('bad zip');
    const method = buf.readUInt16LE(o + 10), csize = buf.readUInt32LE(o + 20), nl = buf.readUInt16LE(o + 28), xl = buf.readUInt16LE(o + 30), cl = buf.readUInt16LE(o + 32), lo = buf.readUInt32LE(o + 42);
    const name = buf.slice(o + 46, o + 46 + nl).toString('utf8'); o += 46 + nl + xl + cl;
    if (name.endsWith('/')) continue;
    const ds = lo + 30 + buf.readUInt16LE(lo + 26) + buf.readUInt16LE(lo + 28), raw = buf.slice(ds, ds + csize);
    out[name] = method === 0 ? raw : method === 8 ? zlib.inflateRawSync(raw) : null;
    if (!out[name]) throw new Error('unsupported zip method ' + method);
  }
  return out;
}
/** installs a .rsupd file right away (the person chose the file). Returns {ok, version, notes, restart} or throws */
U.applyFile = function (file) {
  const z = readZip(fs.readFileSync(file));
  if (!z['update.json']) throw new Error('Dit is geen Brazy Toolkit-updatebestand. / Not a Brazy Toolkit update file.');
  const u = JSON.parse(z['update.json'].toString('utf8'));
  if (u.minApp && S.vcmp(app.getVersion(), u.minApp) < 0) throw new Error(`Deze update vraagt eerst de nieuwe installer (versie ${u.minApp} of hoger). / This update needs the new installer (version ${u.minApp}+) first.`);
  const cur = S.activeRoot(); if (S.vcmp(u.version, cur.version) <= 0) return { ok: true, same: true, version: cur.version };
  const files = Object.keys(z).filter(n => n !== 'update.json'); for (const n of files) if (!S.SAFE.test(n)) throw new Error('Ongeldig bestand in update / invalid file in update: ' + n);
  const nx = S.nextDir(); S.rm(nx); fs.mkdirSync(nx, { recursive: true });
  for (const rel of S.listFiles(cur.dir)) if (!files.includes(rel)) S.linkOrCopy(path.join(cur.dir, ...rel.split('/')), path.join(nx, ...rel.split('/')));
  for (const n of files) { const p = path.join(nx, ...n.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, z[n]); }
  if (u.updateUrl && /^https:\/\//.test(u.updateUrl)) { S.cfg.updateUrl = u.updateUrl; S.save(); }
  const restart = files.some(n => n.startsWith('core/'));
  fs.writeFileSync(path.join(nx, 'content.json'), JSON.stringify({ version: u.version, notes: u.notes || null, complete: true, restart }, null, 1));
  U.state = { phase: 'ready', version: u.version, notes: u.notes || null, restart };
  return { ok: true, version: u.version, notes: u.notes || null, restart };
};
