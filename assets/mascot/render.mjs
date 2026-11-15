// Renders a mascot film to an MP4, one exact frame at a time.
//
//   node assets/mascot/render.mjs <film.html> <out.mp4> [options]
//
//   --fps 60               frames per second (default 60)
//   --size 1920x1080       picture size (default 1920x1080)
//   --audio <file>         a music or video file whose sound goes under the film
//   --audio-start <sec>    where in that file to start (default 0)
//   --fade-in <sec>        default 0.4       --fade-out <sec>   default 1.8
//   --frames <n>           draw only the first n frames (a quick test)
//   --keep-frames          leave the PNG frames beside the MP4
//
// The film page must use Mascot.player (it sets window.__film = { duration, at(t) }).
// The page is opened in a headless browser, so no window appears. Edge or Chrome is
// found by itself; set MASCOT_BROWSER to the exe to choose one. Needs ffmpeg on PATH
// and Node 22 or newer.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf('--' + name); if (i < 0) return fallback; const v = args[i + 1]; args.splice(i, 2); return v; };
const has = name => { const i = args.indexOf('--' + name); if (i < 0) return false; args.splice(i, 1); return true; };
const fps = Number(flag('fps', 60));
const [W, H] = flag('size', '1920x1080').split('x').map(Number);
const audio = flag('audio'), audioStart = Number(flag('audio-start', 0));
const fadeIn = Number(flag('fade-in', 0.4)), fadeOut = Number(flag('fade-out', 1.8));
const onlyFrames = Number(flag('frames', 0)), keepFrames = has('keep-frames');
const [film, out] = args;
if (!film || !out) { console.error('Usage: node render.mjs <film.html> <out.mp4> [--fps 60] [--size 1920x1080] [--audio file] [--audio-start 0]'); process.exit(1); }
if (!fs.existsSync(film)) { console.error('No such film: ' + film); process.exit(1); }
if (audio && !fs.existsSync(audio)) { console.error('No such audio file: ' + audio); process.exit(1); }

const browser = [process.env.MASCOT_BROWSER,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome', '/usr/bin/chromium'].find(p => p && fs.existsSync(p));
if (!browser) { console.error('No Edge or Chrome found. Set MASCOT_BROWSER to the browser exe.'); process.exit(1); }

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mascot-render-'));
const frames = keepFrames ? path.join(path.dirname(path.resolve(out)), path.basename(out, path.extname(out)) + '-frames') : path.join(work, 'frames');
fs.rmSync(frames, { recursive: true, force: true }); fs.mkdirSync(frames, { recursive: true });
const port = 9300 + Math.floor(Math.random() * 500);
const proc = spawn(browser, ['--headless=new', '--disable-gpu', `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(work, 'profile')}`, `--window-size=${W},${H}`, '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(r => setTimeout(r, ms));

let ws, id = 0;
const waiting = new Map(), listeners = new Map();
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id, timer = setTimeout(() => reject(new Error('The browser did not answer ' + method)), 30000);
  waiting.set(n, m => { clearTimeout(timer); m.error ? reject(new Error(method + ': ' + m.error.message)) : resolve(m.result); });
  ws.send(JSON.stringify({ id: n, method, params }));
});
const once = name => new Promise(r => listeners.set(name, r));
const evaluate = async expression => (await send('Runtime.evaluate', { expression, returnByValue: true })).result.value;

try {
  let target;
  for (let i = 0; i < 60 && !target; i++) { await sleep(250); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find(x => x.type === 'page'); } catch { /* not up yet */ } }
  if (!target) throw new Error('The browser did not start.');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('Could not connect to the browser.')); });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); }
    else if (m.method && listeners.has(m.method)) { const f = listeners.get(m.method); listeners.delete(m.method); f(m.params); }
  };
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  const loaded = once('Page.loadEventFired');
  await send('Page.navigate', { url: pathToFileURL(path.resolve(film)).href });
  await loaded; await sleep(600);
  const duration = await evaluate(`document.documentElement.classList.add('render'); window.__film ? (window.__film.at(0), window.__film.duration) : 0`);
  if (!duration) throw new Error('This page has no window.__film. Play the film with Mascot.player.');
  const total = onlyFrames || Math.round(duration * fps);
  const started = Date.now();
  for (let i = 0; i < total; i++) {
    await evaluate(`window.__film.at(${(i / fps).toFixed(5)}); 1`);
    // Let the page's own clock move one frame, so CSS transitions (the eyelids) and the hair keep exact time.
    const moved = once('Emulation.virtualTimeBudgetExpired');
    await send('Emulation.setVirtualTimePolicy', { policy: 'advance', budget: 1000 / fps });
    await moved;
    const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: W, height: H, scale: 1 } });
    fs.writeFileSync(path.join(frames, `f${String(i).padStart(5, '0')}.png`), Buffer.from(shot.data, 'base64'));
    if (i % 120 === 0) console.log(`frame ${i} of ${total} (${((Date.now() - started) / 1000).toFixed(0)}s)`);
  }
  const length = total / fps;
  const ff = ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(frames, 'f%05d.png')];
  if (audio) ff.push('-ss', String(audioStart), '-t', String(length), '-i', audio, '-map', '0:v', '-map', '1:a',
    '-af', `afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${Math.max(0, length - fadeOut).toFixed(3)}:d=${fadeOut}`, '-c:a', 'aac', '-b:a', '256k', '-shortest');
  ff.push('-c:v', 'libx264', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const enc = spawnSync('ffmpeg', ff, { stdio: 'inherit' });
  if (enc.error) throw new Error('ffmpeg is not on PATH.');
  if (enc.status !== 0) throw new Error('ffmpeg failed.');
  console.log(`Wrote ${out}: ${total} frames, ${length.toFixed(1)}s, ${W}x${H} at ${fps} fps${audio ? ', with sound' : ', silent'}.`);
} catch (e) {
  console.error(e.message); process.exitCode = 1;
} finally {
  try { await send('Browser.close'); } catch { /* already gone */ }
  proc.kill();
  await sleep(300);
  try { fs.rmSync(work, { recursive: true, force: true }); } catch { /* the browser may still hold its profile */ }
}
