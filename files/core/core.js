// Brazy Toolkit desktop core (8.0): window, files from Windows, exports, backups, performance, updates.
// Started by ../main.js (the loader). Can be updated online together with the toolkit: an update that changes these
// files restarts the app once (see updater.js).
const { app, BrowserWindow, ipcMain, dialog, shell, session, Menu, screen, powerSaveBlocker, desktopCapturer } = require('electron');
const path = require('path'), fs = require('fs');
const S = require('./store'), U = require('./updater');

// ---- performance: always the real (dedicated) GPU, never the software fallback ----
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('force_high_performance_gpu');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=4096');
app.commandLine.appendSwitch('disable-renderer-backgrounding');
if (!global.BRAZY_BOOT) app.setPath('userData', path.join(app.getPath('appData'), 'ReSkate Toolkit'));   // started without the loader (tests)

const ICON = path.join(S.BOOT.root, 'icon.png');
let win = null, pendingOpen = null, awakeId = null;
const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };
function loadToolkit() { win.loadFile(path.join(S.activeRoot().dir, 'reskate-toolkit.html')); }

/* ---------------- files from Windows: projects (.bzvideo / .rslogo) and update files (.rsupd) ---------------- */
const projFileArg = argv => (argv || []).find(a => /\.(bzvideo|rslogo)$/i.test(a) && fs.existsSync(a));
const updFileArg = argv => (argv || []).find(a => /\.rsupd$/i.test(a) && fs.existsSync(a));
function sendOpenFile(p) {
  try { const msg = { name: path.basename(p), data: fs.readFileSync(p) };
    if (win && !win.isDestroyed() && !win.webContents.isLoading()) send('rs:openFile', msg); else pendingOpen = msg; } catch (e) { dialog.showErrorBox('Brazy Toolkit', e.message); }
}
/** a .rsupd file the person opened: installed right away (they chose it) */
function installFile(file) {
  try {
    const r = U.applyFile(file);
    if (r.same) { send('rs:updateResult', { ok: true, same: true, version: r.version }); return r; }
    return U.install(loadToolkit);
  } catch (e) { if (win && !win.isDestroyed()) send('rs:updateResult', { ok: false, msg: e.message }); else dialog.showErrorBox('Brazy Toolkit', e.message); return { ok: false, msg: e.message }; }
}
/** per user, no admin needed: .bzvideo / .rslogo / .rsupd open with Brazy Toolkit */
function registerFileTypes() {
  if (process.platform !== 'win32' || !app.isPackaged) return; const exe = process.execPath, ver = exe + '|1'; if (S.cfg.assoc === ver) return;
  const { execFile } = require('child_process'), reg = args => new Promise(r => execFile('reg', args, { windowsHide: true }, () => r())), K = 'HKCU\\Software\\Classes\\';
  const types = [['.bzvideo', 'BrazyToolkit.Video', 'Brazy Video Editor project'], ['.rslogo', 'BrazyToolkit.Logo', 'Brazy Logo Maker project'], ['.rsupd', 'BrazyToolkit.Update', 'Brazy Toolkit update']];
  (async () => { for (const [ext, id, desc] of types) { await reg(['add', K + ext, '/ve', '/d', id, '/f']); await reg(['add', K + id, '/ve', '/d', desc, '/f']); await reg(['add', K + id + '\\DefaultIcon', '/ve', '/d', `"${exe}",0`, '/f']); await reg(['add', K + id + '\\shell\\open\\command', '/ve', '/d', `"${exe}" "%1"`, '/f']); }
    S.cfg.assoc = ver; S.save(); })();
}

/* ---------------- window ---------------- */
function keepAwake(on) { if (on && awakeId == null) awakeId = powerSaveBlocker.start('prevent-app-suspension'); if (!on && awakeId != null) { powerSaveBlocker.stop(awakeId); awakeId = null; } return awakeId != null; }
function validBounds(b) {
  if (!b) return null;
  return screen.getAllDisplays().some(d => { const a = d.workArea; return b.x < a.x + a.width - 80 && b.x + b.width > a.x + 80 && b.y >= a.y - 20 && b.y < a.y + a.height - 80; }) ? b : null;
}
function createWindow() {
  const b = validBounds(S.cfg.bounds);
  win = new BrowserWindow({
    width: b ? b.width : 1600, height: b ? b.height : 950, x: b ? b.x : undefined, y: b ? b.y : undefined,
    minWidth: 1100, minHeight: 700, backgroundColor: '#0b0b0d', show: false, title: 'Brazy Toolkit', icon: ICON, autoHideMenuBar: true,
    webPreferences: { preload: path.join(S.BOOT.core, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false, backgroundThrottling: false },
  });
  if (S.cfg.maximized) win.maximize();
  win.once('ready-to-show', () => win.show());
  const remember = () => { if (!win.isMaximized() && !win.isMinimized() && !win.isFullScreen()) S.cfg.bounds = win.getBounds(); S.cfg.maximized = win.isMaximized(); };
  win.on('resize', remember); win.on('move', remember); win.on('close', () => { remember(); S.save(); });
  // links open in the normal browser, never inside the app; the Video Editor's preview window is the one exception
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (frameName === 'vepop' && (!url || url === 'about:blank')) return { action: 'allow', overrideBrowserWindowOptions: { width: 1280, height: 760, autoHideMenuBar: true, backgroundColor: '#000000', title: 'Brazy preview', icon: ICON } };
    if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' };
  });
  const fileOf = url => decodeURIComponent(new URL(url).pathname).replace(/^\/([A-Za-z]:)/, '$1');
  win.webContents.on('will-navigate', (e, url) => {
    if (/^file:.*\.rsupd$/i.test(url)) { e.preventDefault(); try { installFile(fileOf(url)); } catch {} return; }
    if (/^file:.*\.(bzvideo|rslogo)$/i.test(url)) { e.preventDefault(); try { sendOpenFile(fileOf(url)); } catch {} return; }
    if (!url.startsWith('file:')) { e.preventDefault(); if (/^https?:/i.test(url)) shell.openExternal(url); }
  });
  // the page crashed (out of memory, graphics driver…): load it again and offer the autosaved work
  win.webContents.on('render-process-gone', (_e, d) => { if (d.reason === 'clean-exit') return; S.cfg.crashed = { reason: d.reason, at: Date.now() }; S.save(); setTimeout(() => { if (win && !win.isDestroyed()) loadToolkit(); }, 400); });
  win.webContents.on('did-finish-load', () => {
    if (pendingOpen) { const m = pendingOpen; pendingOpen = null; setTimeout(() => send('rs:openFile', m), 600); }
    if (S.cfg.crashed) { send('rs:crashed', S.cfg.crashed); delete S.cfg.crashed; S.save(); }
    if (S.cfg.justUpdated) { send('rs:updateResult', { ok: true, version: S.cfg.justUpdated, notes: (S.info(S.activeRoot().dir) || {}).notes || null }); delete S.cfg.justUpdated; S.save(); }
    if (S.BOOT.fellBack) send('rs:updateResult', { ok: false, msg: `Update ${S.BOOT.fellBack} kon niet starten; de geïnstalleerde versie wordt gebruikt. / Update ${S.BOOT.fellBack} could not start; using the installed version.` });
    send('rs:updateState', U.state);
  });
  // F11 = full screen, Ctrl+R = reload, F12 = developer tools (for bug reports)
  win.webContents.on('before-input-event', (e, i) => {
    if (i.type !== 'keyDown') return;
    if (i.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
    else if (i.key === 'F12') { win.webContents.toggleDevTools(); e.preventDefault(); }
    else if (i.control && i.key.toLowerCase() === 'r') { win.webContents.reload(); e.preventDefault(); }
  });
  loadToolkit();
}

/* ---------------- 8.4: where an export goes ----------------
   export folder [+ a subfolder for the app on screen (Clothing, Logos, Videos…)]; an existing file is replaced, or kept with " (2)" added */
let curApp = '';
function exportPath(name) {
  let dir = S.cfg.exportDir;
  if (S.cfg.exportSub && curApp) { dir = path.join(dir, curApp); try { fs.mkdirSync(dir, { recursive: true }); } catch { dir = S.cfg.exportDir; } }
  let p = path.join(dir, name);
  if (S.cfg.exportKeep && fs.existsSync(p)) { const ext = path.extname(name), base = name.slice(0, name.length - ext.length); for (let i = 2; i < 1000 && fs.existsSync(p); i++) p = path.join(dir, `${base} (${i})${ext}`); }
  return p;
}
/* ---------------- what the toolkit page may ask (preload.js) ---------------- */
function ipc() {
  const h = (ch, fn) => ipcMain.handle(ch, fn);
  const pickDir = async (title, cur) => { const r = await dialog.showOpenDialog(win, { title, defaultPath: cur || app.getPath('documents'), properties: ['openDirectory', 'createDirectory'] }); return r.canceled ? null : r.filePaths[0]; };
  h('rs:version', () => ({ app: app.getVersion(), content: S.activeRoot().version, core: S.BOOT.coreVersion, electron: process.versions.electron, online: !!U.url() }));
  // export folder
  h('rs:getDir', () => S.cfg.exportDir || '');
  h('rs:chooseDir', async () => { const d = await pickDir('Exportmap / Export folder', S.cfg.exportDir); if (d) { S.cfg.exportDir = d; S.save(); } return S.cfg.exportDir || ''; });
  h('rs:clearDir', () => { delete S.cfg.exportDir; S.save(); return ''; });
  h('rs:openDir', () => { const d = S.cfg.exportDir || S.cfg.lastSaveDir; if (d) shell.openPath(d); return !!d; });
  h('rs:setApp', (_e, name) => { curApp = path.join(...String(name || '').split('/').slice(0, 2).map(x => x.replace(/[\\:*?"<>|.]+/g, '').trim().slice(0, 40)).filter(Boolean).concat([''])); return true; });
  h('rs:exportOpts', (_e, o) => { if (o && typeof o === 'object') { if ('sub' in o) S.cfg.exportSub = !!o.sub; if ('keep' in o) S.cfg.exportKeep = !!o.keep; S.save(); } return { dir: S.cfg.exportDir || '', sub: !!S.cfg.exportSub, keep: !!S.cfg.exportKeep }; });
  h('rs:openSaved', (_e, p) => { if (typeof p === 'string' && fs.existsSync(p)) shell.showItemInFolder(p); return true; });
  h('rs:gpu', async () => { try { const g = await app.getGPUInfo('basic'); const d = (g.gpuDevice || []).find(x => x.active) || (g.gpuDevice || [])[0]; return d ? (d.deviceString || d.vendorString || '') : ''; } catch { return ''; } });
  // updates
  h('rs:pickUpdate', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Update', defaultPath: app.getPath('downloads'), filters: [{ name: 'Brazy Toolkit update', extensions: ['rsupd'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return { ok: false, canceled: true }; return installFile(r.filePaths[0]);
  });
  h('rs:checkOnline', () => U.check(true));
  h('rs:updateState', () => U.state);
  h('rs:installUpdate', () => U.install(loadToolkit));
  h('rs:downloadOnline', async () => { const st = await U.check(true); return st.phase === 'ready' ? U.install(loadToolkit) : { ok: st.phase !== 'error', msg: st.msg, state: st }; });   // 7.x name, kept for the hub
  // system
  h('rs:keepAwake', (_e, on) => keepAwake(!!on));
  h('rs:eyedrop', () => eyedrop());   // 8.11.2: pick a colour anywhere on screen (other apps, browsers)
  h('rs:metrics', () => { const m = app.getAppMetrics(); return { mem: m.map(x => ({ type: x.type, mb: Math.round((x.memory && x.memory.workingSetSize || 0) / 1024) })), cpu: m.reduce((a, x) => a + (x.cpu ? x.cpu.percentCPUUsage : 0), 0) }; });
  // automatic backups of all projects into a folder the person picks (e.g. OneDrive); the newest `keep` files stay
  /* 8.15: your own clothes — one folder per item (a .glb 3D model + its base map images + item.json with name and category),
     by default Documents\Brazy Toolkit\Custom. Only these files can be read or written, only inside that folder. */
  const CU_OK = /\.(glb|png|webp|jpe?g)$/i, cuDir = () => { const d = S.cfg.customDir || path.join(app.getPath('documents'), 'Brazy Toolkit', 'Custom'); try { fs.mkdirSync(d, { recursive: true }); } catch {} return d; };
  const cuSafe = n => String(n || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').replace(/^[ .]+|[ .]+$/g, '').slice(0, 80) || 'Item';
  const cuIn = (folder, file) => { const base = cuDir(), p = path.resolve(base, path.basename(String(folder || '')), file ? path.basename(String(file)) : ''); if (!p.startsWith(path.resolve(base) + path.sep)) throw new Error('outside the Custom folder'); return p; };
  h('rs:customDir', () => cuDir());
  h('rs:chooseCustomDir', async () => { const d = await pickDir('Map voor eigen kleding / Folder for your own clothes', cuDir()); if (d) { S.cfg.customDir = d; S.save(); } return cuDir(); });
  h('rs:openCustomDir', (_e, folder) => { const p = folder ? cuIn(folder) : cuDir(); shell.openPath(p); return true; });
  h('rs:customList', () => { const base = cuDir(), out = [];
    for (const e of fs.readdirSync(base, { withFileTypes: true })) { if (!e.isDirectory()) continue; const dir = path.join(base, e.name); let files = [];
      try { files = fs.readdirSync(dir).filter(f => CU_OK.test(f)).map(f => { const st = fs.statSync(path.join(dir, f)); return { name: f, size: st.size, mtime: Math.round(st.mtimeMs) }; }); } catch { continue; }
      if (!files.length) continue; out.push({ folder: e.name, meta: S.readJSON(path.join(dir, 'item.json'), {}), files }); }
    return out; });
  h('rs:customRead', (_e, folder, file) => { if (!CU_OK.test(String(file))) throw new Error('not a model or image'); return fs.readFileSync(cuIn(folder, file)); });
  h('rs:customSave', (_e, item) => {
    const o = item || {}; let folder = o.folder ? path.basename(String(o.folder)) : cuSafe(o.name);
    if (!o.folder) { let k = 2; while (fs.existsSync(path.join(cuDir(), folder))) folder = cuSafe(o.name) + ' (' + k++ + ')'; }
    const dir = cuIn(folder); fs.mkdirSync(dir, { recursive: true });
    for (const f of o.files || []) { const n = path.basename(String(f.name || '')); if (!CU_OK.test(n)) continue; fs.writeFileSync(path.join(dir, n), Buffer.from(f.data)); }
    const meta = Object.assign(S.readJSON(path.join(dir, 'item.json'), {}), { name: String(o.name || folder).slice(0, 80), module: String(o.module || ''), variant: o.variant || null, updated: Date.now() });
    fs.writeFileSync(path.join(dir, 'item.json'), JSON.stringify(meta, null, 1)); return { folder };
  });
  h('rs:customDelete', async (_e, folder) => { const p = cuIn(folder); try { await shell.trashItem(p); } catch { S.rm(p); } return true; });   // to the Recycle Bin
  h('rs:backupDir', () => S.cfg.backupDir || '');
  h('rs:chooseBackupDir', async () => { const d = await pickDir('Back-upmap / Backup folder', S.cfg.backupDir); if (d) { S.cfg.backupDir = d; S.save(); } return S.cfg.backupDir || ''; });
  h('rs:clearBackupDir', () => { delete S.cfg.backupDir; S.save(); return ''; });
  h('rs:openBackupDir', () => { if (S.cfg.backupDir) shell.openPath(S.cfg.backupDir); return !!S.cfg.backupDir; });
  h('rs:backupWrite', (_e, name, data, keep) => {
    try {
      const dir = S.cfg.backupDir; if (!dir || !fs.existsSync(dir)) return { ok: false, msg: 'no folder' };
      const safe = String(name || 'backup.rsbak').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120); if (!/\.rsbak$/i.test(safe)) return { ok: false, msg: 'bad name' };
      const p = path.join(dir, safe), tmp = p + '.part'; fs.writeFileSync(tmp, Buffer.from(data)); fs.renameSync(tmp, p);
      const old = fs.readdirSync(dir).filter(f => /^Brazy backup .*\.rsbak$/i.test(f)).sort().reverse().slice(Math.max(1, keep || 14)); for (const f of old) try { fs.unlinkSync(path.join(dir, f)); } catch (e) {}
      S.cfg.lastBackup = Date.now(); S.save(); return { ok: true, path: p, removed: old.length };
    } catch (e) { return { ok: false, msg: e.message }; }
  });
  h('rs:backupList', () => { try { const dir = S.cfg.backupDir; if (!dir || !fs.existsSync(dir)) return []; return fs.readdirSync(dir).filter(f => /\.rsbak$/i.test(f)).sort().reverse().map(f => ({ name: f, size: fs.statSync(path.join(dir, f)).size })); } catch (e) { return []; } });
  h('rs:backupRead', (_e, name) => { try { const dir = S.cfg.backupDir, f = path.join(dir, path.basename(String(name))); if (!/\.rsbak$/i.test(f) || !fs.existsSync(f)) return null; return new Uint8Array(fs.readFileSync(f)); } catch (e) { return null; } });
}

/* ---------------- start ---------------- */
if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_e, argv) => {
  if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
  const f = updFileArg(argv); if (f) installFile(f);           // double-clicked an update while the app is open
  const p = projFileArg(argv); if (p) sendOpenFile(p);         // double-clicked a project while the app is open
});
app.whenReady().then(() => {
  S.load(); Menu.setApplicationMenu(null);
  // an installed online update that is not newer than the installation itself is left over from before a reinstall
  const ci = S.info(S.contentDir()); if (ci && S.vcmp(ci.version, app.getVersion()) <= 0) S.rm(S.contentDir());
  const nx = S.info(S.nextDir()); if (nx && (!nx.complete || S.vcmp(nx.version, S.activeRoot().version) <= 0)) S.rm(S.nextDir());
  // exports: straight into the chosen export folder (no prompt), otherwise a normal "Save as" dialog
  session.defaultSession.on('will-download', (_e, item) => {
    const name = item.getFilename();
    if (S.cfg.exportDir && fs.existsSync(S.cfg.exportDir)) item.setSavePath(exportPath(name));
    else item.setSaveDialogOptions({ title: 'Opslaan / Save', defaultPath: path.join(S.cfg.lastSaveDir || app.getPath('downloads'), name) });
    item.once('done', (_ev, state) => {
      if (state !== 'completed') return;
      const p = item.getSavePath(); if (!S.cfg.exportDir) { S.cfg.lastSaveDir = path.dirname(p); S.save(); }
      send('rs:saved', { path: p, name: path.basename(p), dir: path.dirname(p) });
    });
  });
  ipc();
  // started by double-clicking a .rsupd file?
  const f = updFileArg(process.argv); if (f) { try { const r = U.applyFile(f); if (!r.same) U.install(() => {}); } catch (e) { S.cfg.updateError = e.message; } }
  const pf = projFileArg(process.argv); if (pf) sendOpenFile(pf);
  registerFileTypes();
  createWindow();
  if (S.cfg.updateError) { const m = S.cfg.updateError; delete S.cfg.updateError; win.webContents.once('did-finish-load', () => send('rs:updateResult', { ok: false, msg: m })); }
  U.start(win);
});
app.on('window-all-closed', () => { keepAwake(false); app.quit(); });

/* ---- 8.11.2: screen eyedropper. The toolkit steps aside (minimised), the screen under the mouse is photographed, and a
   full-screen overlay with a magnifier lets you click any pixel — other apps, browsers, the desktop. Esc cancels.
   Resolves with '#rrggbb' or null. ---- */
let EYE_BUSY = false;
const EYE_HTML = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;height:100%;overflow:hidden;background:#000;cursor:crosshair}
canvas{position:fixed;inset:0;width:100%;height:100%}#lp{position:fixed;width:132px;height:132px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 1px #000,0 8px 24px rgba(0,0,0,.6);overflow:hidden;pointer-events:none;image-rendering:pixelated}
#lp canvas{position:absolute;inset:0;width:100%;height:100%}#tag{position:fixed;padding:4px 8px;border-radius:4px;background:#111;color:#fff;font:600 13px Consolas,monospace;pointer-events:none;display:flex;gap:6px;align-items:center}
#tag i{width:14px;height:14px;border-radius:3px;border:1px solid #fff;display:inline-block}#hint{position:fixed;left:50%;top:18px;transform:translateX(-50%);background:rgba(17,17,17,.88);color:#fff;font:600 13px Segoe UI,sans-serif;padding:8px 14px;border-radius:6px;pointer-events:none}</style>
<canvas id="cv"></canvas><div id="lp"><canvas id="zc" width="11" height="11"></canvas></div><div id="tag"><i></i><span></span></div><div id="hint">Klik om een kleur te nemen · Esc = annuleren &nbsp;|&nbsp; Click to take a colour · Esc = cancel</div>
<script>
const cv=document.getElementById('cv'),g=cv.getContext('2d',{willReadFrequently:true}),zc=document.getElementById('zc'),zg=zc.getContext('2d'),lp=document.getElementById('lp'),tag=document.getElementById('tag');let img=null;
function setImg(u){const im=new Image();im.onload=()=>{img=im;cv.width=im.width;cv.height=im.height;g.drawImage(im,0,0);document.title='ready';};im.src=u;}
const px=e=>[Math.min(cv.width-1,Math.max(0,Math.round(e.clientX/innerWidth*cv.width))),Math.min(cv.height-1,Math.max(0,Math.round(e.clientY/innerHeight*cv.height)))];
const hex=(x,y)=>{const d=g.getImageData(x,y,1,1).data;return'#'+[d[0],d[1],d[2]].map(v=>v.toString(16).padStart(2,'0')).join('');};
addEventListener('mousemove',e=>{if(!img)return;const[x,y]=px(e);zg.imageSmoothingEnabled=false;zg.clearRect(0,0,11,11);zg.drawImage(cv,x-5,y-5,11,11,0,0,11,11);zg.strokeStyle='#fff';zg.lineWidth=.12;zg.strokeRect(5,5,1,1);
 lp.style.left=(e.clientX+18)+'px';lp.style.top=(e.clientY+18)+'px';const h=hex(x,y);tag.querySelector('i').style.background=h;tag.querySelector('span').textContent=h;tag.style.left=(e.clientX+28)+'px';tag.style.top=(e.clientY+156)+'px';});
addEventListener('mousedown',e=>{if(!img)return;if(e.button!==0){document.title='cancel';return;}const[x,y]=px(e);document.title='pick:'+hex(x,y);});
addEventListener('keydown',e=>{if(e.key==='Escape')document.title='cancel';});addEventListener('contextmenu',e=>e.preventDefault());
</script>`;
async function eyedrop() {
  if (EYE_BUSY) return null; EYE_BUSY = true;
  const wasMin = win && !win.isDestroyed() && win.isMinimized();
  try {
    const pt = screen.getCursorScreenPoint(), disp = screen.getDisplayNearestPoint(pt), sf = disp.scaleFactor || 1;
    if (win && !win.isDestroyed() && !wasMin) { win.minimize(); await new Promise(r => setTimeout(r, 380)); }   // let what is behind the toolkit show
    const srcs = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(disp.size.width * sf), height: Math.round(disp.size.height * sf) } });
    const src = srcs.find(x => String(x.display_id) === String(disp.id)) || srcs[0]; if (!src || src.thumbnail.isEmpty()) return null;
    const url = src.thumbnail.toDataURL(), b = disp.bounds;
    return await new Promise(resolve => {
      const ov = new BrowserWindow({ x: b.x, y: b.y, width: b.width, height: b.height, frame: false, alwaysOnTop: true, skipTaskbar: true, resizable: false, movable: false, fullscreenable: false, hasShadow: false, show: false, backgroundColor: '#000000', webPreferences: { contextIsolation: true, sandbox: true } });
      let done = false; const finish = v => { if (done) return; done = true; try { ov.destroy(); } catch (e) { } resolve(v); };
      ov.setAlwaysOnTop(true, 'screen-saver');
      ov.webContents.on('page-title-updated', (_e, t) => { if (t === 'ready') { ov.setBounds(b); ov.show(); ov.focus(); } else if (t === 'cancel') finish(null); else if (/^pick:#[0-9a-f]{6}$/.test(t)) finish(t.slice(5)); });
      ov.on('blur', () => setTimeout(() => { if (!done && !ov.isDestroyed() && !ov.isFocused()) finish(null); }, 250)); ov.on('closed', () => finish(null));
      ov.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(EYE_HTML)).then(() => ov.webContents.executeJavaScript('setImg(' + JSON.stringify(url) + ')')).catch(() => finish(null));
      setTimeout(() => finish(null), 120000);
    });
  } catch (e) { return null; }
  finally { EYE_BUSY = false; if (win && !win.isDestroyed() && !wasMin) { win.restore(); win.focus(); } }
}
