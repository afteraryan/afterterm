// Long-running screen recorder for the harness. Records the main window's page
// content through the Chrome DevTools Protocol (Page.startScreencast), not the
// screen, so it works even while the dev window is pushed behind other windows.
//
//   node scripts/agent-harness/record.mjs --out <file.mp4> [--port <n> | --data-dir <dir>]
//                                          [--work-dir <dir>] [--max-width 1280] [--fps 12] [--quality 80]
//
// Runs until <work-dir>/stop appears (polled every 100ms) or on SIGTERM/SIGINT, then
// stops the screencast and stitches the captured frames into an mp4 with ffmpeg.
// Frames, the stop file and record.log live in --work-dir (default <out>.work), so
// nothing but the mp4 lands beside the screenshots.
// Normally started detached by `drive.mjs record start`, not run by hand.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  parseArgs, loadRun, resolvePort, listTargets, pickMainPage, Cdp, evaluate, sleep,
} from './lib.mjs';

const { opts } = parseArgs(process.argv.slice(2));

if (!opts.out) fail('record.mjs needs --out <file.mp4>');

const outFile = path.resolve(String(opts.out));
// Frames, the stop file and the log are bookkeeping, not captures, so they live in
// a work folder (drive.mjs passes one under the run's data dir) rather than next to
// the mp4, which sits in docs/screenshots/<phase>/ and is committed.
const workDir = path.resolve(String(opts['work-dir'] ?? `${outFile}.work`));
const framesDir = path.join(workDir, 'frames');
const stopFile = path.join(workDir, 'stop');
const logFile = path.join(workDir, 'record.log');
const maxWidth = Number(opts['max-width'] ?? 1280);
const fps = Number(opts.fps ?? 12);
const quality = Number(opts.quality ?? 80);

fs.mkdirSync(path.dirname(outFile), { recursive: true });
// A leftover .frames or .stop from an earlier recording at the same path must
// not leak into or short-circuit this run.
if (fs.existsSync(framesDir)) fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });
if (fs.existsSync(stopFile)) fs.rmSync(stopFile, { force: true });
fs.writeFileSync(logFile, `=== record ${new Date().toISOString()} out=${outFile} maxWidth=${maxWidth} fps=${fps} quality=${quality} ===\n`);

function log(line) {
  const stamped = `${new Date().toISOString()} ${line}`;
  fs.appendFileSync(logFile, stamped + '\n');
  console.log(stamped);
}

let cdp = null;
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
process.on('SIGINT', () => { stopping = true; });

try {
  await main();
  process.exit(0);
} catch (e) {
  log(`error: ${e.message}`);
  console.error(`record: ${e.message}`);
  process.exitCode = 1;
} finally {
  if (cdp) cdp.close();
}

async function main() {
  let run = null;
  try { run = loadRun(opts); } catch (e) { if (!opts.port) throw e; }
  const port = resolvePort(opts, run);

  const targets = await listTargets(port);
  const page = pickMainPage(targets);
  if (!page) throw new Error(`no main-window page target on port ${port}`);
  cdp = await Cdp.connect(page.webSocketDebuggerUrl);
  log(`connected to ${page.url}`);

  await cdp.send('Page.enable');

  // Scale maxHeight to the page's own aspect ratio so the screencast is not
  // squashed or letterboxed against an arbitrary height cap.
  let maxHeight = maxWidth;
  try {
    const size = await evaluate(cdp, '({ w: window.innerWidth, h: window.innerHeight })');
    if (size.w > 0 && size.h > 0) maxHeight = Math.max(2, Math.round((maxWidth * size.h) / size.w));
  } catch { /* keep the square fallback */ }

  const frames = [];
  let frameCount = 0;

  cdp.on('Page.screencastFrame', params => {
    onFrame(params).catch(e => log(`frame error: ${e.message}`));
  });

  async function onFrame(params) {
    frameCount++;
    const file = `frame-${String(frameCount).padStart(6, '0')}.jpg`;
    fs.writeFileSync(path.join(framesDir, file), Buffer.from(params.data, 'base64'));
    frames.push({ file, timestamp: params.metadata.timestamp });
    // Mandatory: Chromium stops sending frames until each one is acknowledged.
    await cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId });
    if (frameCount === 1 || frameCount % 10 === 0) log(`frame ${frameCount} at ${params.metadata.timestamp}`);
  }

  await cdp.send('Page.startScreencast', { format: 'jpeg', quality, maxWidth, maxHeight, everyNthFrame: 1 });
  log(`recording started, maxWidth=${maxWidth} maxHeight=${maxHeight}`);

  while (!stopping && !fs.existsSync(stopFile)) {
    await sleep(100);
  }
  log(`stop requested (${frameCount} frame(s) captured); stopping screencast`);

  try { await cdp.send('Page.stopScreencast'); } catch (e) { log(`stopScreencast: ${e.message}`); }
  cdp.close();
  cdp = null;

  if (fs.existsSync(stopFile)) fs.rmSync(stopFile, { force: true });

  await stitch(frames);
}

async function stitch(frames) {
  if (frames.length === 0) {
    log('no frames captured, nothing to stitch');
    return;
  }

  const minDur = 1 / fps;
  // Chromium sends a frame for every repaint, so a burst (a screen transition, a
  // terminal printing) can deliver dozens of frames within one 1/fps slot. Keep at
  // most one frame per slot, plus the last frame, so the timeline stays real time:
  // padding every frame to 1/fps instead stretched a 20s run to a minute.
  const kept = [];
  for (let i = 0; i < frames.length; i++) {
    const last = kept[kept.length - 1];
    const isLast = i === frames.length - 1;
    if (!last || isLast || frames[i].timestamp - last.timestamp >= minDur) kept.push(frames[i]);
  }
  const lines = [];
  for (let i = 0; i < kept.length; i++) {
    const dur = i < kept.length - 1
      ? Math.max(minDur, kept[i + 1].timestamp - kept[i].timestamp)
      : minDur;
    lines.push(`file '${kept[i].file}'`);
    lines.push(`duration ${dur.toFixed(3)}`);
  }
  // ffmpeg's concat demuxer ignores the duration on the last listed file, so the
  // last frame is repeated once more without a duration to make it actually show.
  lines.push(`file '${kept[kept.length - 1].file}'`);
  const listPath = path.join(framesDir, 'list.txt');
  fs.writeFileSync(listPath, lines.join('\n') + '\n');
  log(`kept ${kept.length} of ${frames.length} frame(s) at ${fps} fps`);

  const durationSeconds = kept.length > 1
    ? kept[kept.length - 1].timestamp - kept[0].timestamp + minDur
    : minDur;

  const ffmpeg = findFfmpeg();
  const vf = `fps=${fps},scale=trunc(iw/2)*2:trunc(ih/2)*2`;
  if (!ffmpeg) {
    log('ffmpeg not found on PATH, frames kept');
    log(`stitch manually: ffmpeg -f concat -safe 0 -i "${listPath}" -vf "${vf}" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "${outFile}"`);
    console.error(`record: ffmpeg not found on PATH; frames kept at ${framesDir}, stitch manually (see ${logFile})`);
    return;
  }

  try {
    execFileSync(ffmpeg, [
      '-y', '-f', 'concat', '-safe', '0', '-i', 'list.txt',
      '-vf', vf,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
      outFile,
    ], { cwd: framesDir, stdio: ['ignore', 'pipe', 'pipe'] });
    fs.rmSync(framesDir, { recursive: true, force: true });
    log(`wrote ${outFile} (${durationSeconds.toFixed(2)}s, ${frames.length} frame(s))`);
  } catch (e) {
    log(`ffmpeg failed, frames kept at ${framesDir}: ${e.message}`);
    console.error(`record: ffmpeg failed, frames kept at ${framesDir} (see ${logFile})`);
  }
}

function findFfmpeg() {
  try {
    const out = execFileSync('where.exe', ['ffmpeg'], { encoding: 'utf8' });
    return out.split(/\r?\n/).map(s => s.trim()).find(Boolean) ?? null;
  } catch {
    return null;
  }
}

function fail(msg) {
  console.error(`record: ${msg}`);
  process.exit(1);
}
