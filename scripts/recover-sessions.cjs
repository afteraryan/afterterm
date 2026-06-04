// One-time migration: the old build never captured Claude session ids, so this
// reconstructs them. For each Claude tab in session.json it finds the matching
// transcript UUID (by the session's custom name, falling back to newest-in-cwd) and
// its real cwd, and writes an augmented session.json the new build can auto-resume.
// READ-ONLY by default: writes a staging file + prints a report. Pass --apply to
// write the live session.json (do that only after the old build is closed).
const fs = require('fs');
const path = require('path');
const os = require('os');

const SESSION = path.join(process.env.APPDATA, 'afterterm', 'session.json');
const STAGING = SESSION + '.recovered';
const PROJ = path.join(os.homedir(), '.claude', 'projects');
const RECENT_MS = 21 * 24 * 3600 * 1000;          // only scan transcripts touched recently
const apply = process.argv.includes('--apply');

const sj = JSON.parse(fs.readFileSync(SESSION, 'utf8'));

// A Claude tab's title is a decorated name starting with a non-ASCII glyph
// (✳ / working-spinner / ✅ …). Plain shells are "cmd.exe", "pwsh.exe", etc.
const isClaude = (t) => /^[^\x00-\x7F]/.test(t || '');
const stripGlyph = (t) => t.replace(/^[^\x00-\x7F\s]+\s*/, '').trim();
const encodeCwd = (c) => (c || '').replace(/:/g, '-').replace(/[\\/]/g, '-');

// Index recent transcripts: name -> newest {uuid, cwd, mtime}; and per-dir lists.
const byName = {};
const byDir = {};
for (const dir of fs.readdirSync(PROJ)) {
  const dpath = path.join(PROJ, dir);
  let st; try { st = fs.statSync(dpath); } catch { continue; }
  if (!st.isDirectory()) continue;
  for (const fn of fs.readdirSync(dpath)) {
    if (!fn.endsWith('.jsonl')) continue;
    const fp = path.join(dpath, fn);
    let fst; try { fst = fs.statSync(fp); } catch { continue; }
    if (Date.now() - fst.mtimeMs > RECENT_MS) continue;
    let content; try { content = fs.readFileSync(fp, 'utf8'); } catch { continue; }
    const cwdM = content.match(/"cwd":"((?:[^"\\]|\\.)*)"/);
    const cwd = cwdM ? cwdM[1].replace(/\\\\/g, '\\') : null;
    const cts = [...content.matchAll(/"customTitle":"((?:[^"\\]|\\.)*)"/g)];
    const name = cts.length ? cts[cts.length - 1][1] : null;
    const rec = { uuid: fn.replace(/\.jsonl$/, ''), cwd, mtime: fst.mtimeMs, name };
    (byDir[dir] = byDir[dir] || []).push(rec);
    if (name && (!byName[name] || fst.mtimeMs > byName[name].mtime)) byName[name] = rec;
  }
}

const claimed = new Set();
const report = [];
const claudeTabs = sj.tabs.filter((t) => isClaude(t.title));

// Pass 1: exact name match (precise). Pass 2: newest-unclaimed-in-cwd fallback.
for (const tab of claudeTabs) {
  const rec = byName[stripGlyph(tab.title)];
  if (rec && !claimed.has(rec.uuid)) {
    claimed.add(rec.uuid);
    tab.claudeSessionId = rec.uuid;
    tab.claudeCwd = rec.cwd || tab.cwd;
    report.push({ tab: tab.title, via: 'name', uuid: rec.uuid, cwd: tab.claudeCwd });
  }
}
for (const tab of claudeTabs) {
  if (tab.claudeSessionId) continue;
  const cands = (byDir[encodeCwd(tab.cwd)] || []).filter((r) => !claimed.has(r.uuid)).sort((a, b) => b.mtime - a.mtime);
  const rec = cands[0];
  if (rec) {
    claimed.add(rec.uuid);
    tab.claudeSessionId = rec.uuid;
    tab.claudeCwd = rec.cwd || tab.cwd;
    report.push({ tab: tab.title, via: 'mtime', uuid: rec.uuid, cwd: tab.claudeCwd });
  } else {
    report.push({ tab: tab.title, via: 'UNMATCHED', uuid: null, cwd: tab.cwd });
  }
}

console.log(`\nClaude tabs: ${claudeTabs.length}  (non-Claude shells are left as-is)\n`);
for (const r of report) {
  const u = r.uuid ? r.uuid : '(none found)';
  console.log(`  [${r.via.padEnd(9)}] ${r.tab}`);
  console.log(`              -> ${u}   @ ${r.cwd}`);
}
const matched = report.filter((r) => r.uuid).length;
console.log(`\nMatched ${matched}/${claudeTabs.length}.`);

fs.writeFileSync(STAGING, JSON.stringify(sj), 'utf8');
console.log(`\nStaged augmented session.json -> ${STAGING}`);
if (apply) {
  fs.writeFileSync(SESSION, JSON.stringify(sj), 'utf8');
  console.log(`APPLIED to live ${SESSION}`);
} else {
  console.log(`(dry run — re-run with --apply AFTER closing the old build to write it live)`);
}
