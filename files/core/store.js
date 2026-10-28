// Brazy Toolkit desktop core — settings, versions and the content folders.
//   installed : <app>/resources/app            (toolkit, apps/, models/, core/ — what the installer put there)
//   content   : <userData>/content             (a newer release installed by an online update; same layout)
//   next      : <userData>/content.next        (an update downloaded in the background, waiting for "install")
const { app } = require('electron');
const path = require('path'), fs = require('fs'), crypto = require('crypto');
const BOOT = global.BRAZY_BOOT || { root: path.join(__dirname, '..'), core: __dirname, coreVersion: app.getVersion(), vcmp: null };

const vnum = v => String(v || '0').split('.').map(n => parseInt(n, 10) || 0);
const vcmp = (a, b) => { const x = vnum(a), y = vnum(b); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };
const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

const S = module.exports = {
  BOOT, vcmp, readJSON, sha256,
  cfg: {},
  user: () => app.getPath('userData'),
  cfgFile: () => path.join(app.getPath('userData'), 'desktop-settings.json'),
  load() { S.cfg = readJSON(S.cfgFile(), {}); },
  save() { try { fs.mkdirSync(path.dirname(S.cfgFile()), { recursive: true }); fs.writeFileSync(S.cfgFile() + '.part', JSON.stringify(S.cfg, null, 1)); fs.renameSync(S.cfgFile() + '.part', S.cfgFile()); } catch {} },
  installed: () => ({ dir: BOOT.root, version: app.getVersion() }),
  contentDir: () => path.join(app.getPath('userData'), 'content'),
  nextDir: () => path.join(app.getPath('userData'), 'content.next'),
  info: dir => readJSON(path.join(dir, 'content.json'), null),
  /** the folder the toolkit runs from: an installed online update when it is newer than the installation */
  activeRoot() {
    const d = S.contentDir(), ci = S.info(d);
    if (ci && vcmp(ci.version, app.getVersion()) > 0 && fs.existsSync(path.join(d, 'reskate-toolkit.html'))) return { dir: d, version: ci.version };
    return S.installed();
  },
  /** every file of a release folder, relative paths with '/' (toolkit, apps/, models/, core/) */
  listFiles(dir) {
    const out = [];
    const walk = (rel) => { let es; try { es = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return; }
      for (const e of es) { const r = rel ? rel + '/' + e.name : e.name; if (e.isDirectory()) { if (['apps', 'models', 'core'].includes(r.split('/')[0])) walk(r); } else if (S.SAFE.test(r)) out.push(r); } };
    walk(''); return out;
  },
  /** files a release may contain (online updates and .rsupd files are checked against this) */
  SAFE: /^(reskate-toolkit\.html|apps\/[a-z0-9_-]+\.html|models\/[a-z0-9_]+\.(js|bin)|core\/[a-z0-9_-]+\.js)$/,
  /** fingerprints of a release folder, cached by size + date so the ~100 MB of models is read only once */
  hashes(dir) {
    const old = S.cfg.hcache || {}, nc = {}, out = {};
    for (const rel of S.listFiles(dir)) { const p = path.join(dir, rel); let st; try { st = fs.statSync(p); } catch { continue; }
      const key = p + '|' + st.size + '|' + Math.round(st.mtimeMs); const h = old[key] || sha256(fs.readFileSync(p)); nc[key] = h; out[rel] = h; }
    S.cfg.hcache = nc; S.save(); return out;
  },
  /** same file without copying (hard link) when the disk allows it, else a copy — files are never changed in place */
  linkOrCopy(src, dst) { fs.mkdirSync(path.dirname(dst), { recursive: true }); try { fs.linkSync(src, dst); } catch { fs.copyFileSync(src, dst); } },
  rm: p => { try { fs.rmSync(p, { recursive: true, force: true }); } catch {} },
};
