const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'out');
const buildDir = path.join(outDir, 'afterterm-win32-x64');

// Move the current build out of the way before packaging over its path.
//
// This rename doubles as the lock test, so don't "try anyway" if it fails: a
// successful rename proves nothing holds the folder, and a failure proves
// something does. Building on regardless would have electron-forge write into
// the folder a running afterterm is executing from, which either fails partway
// or leaves a half-replaced build behind.
//
// What holds it is normally afterterm itself. A running .exe alone does NOT
// block its folder being renamed; a process whose *current directory* is that
// folder does. Launching afterterm.exe from Explorer or a pinned taskbar
// shortcut sets exactly that, which is why an in-place build fails for anyone
// who starts the app the ordinary way, and why closing it fixes it every time.
if (fs.existsSync(buildDir)) {
  const oldDir = path.join(outDir, `afterterm-old-${Date.now()}`);
  try {
    fs.renameSync(buildDir, oldDir);
    console.log(`Moved current build to ${path.basename(oldDir)}`);
  } catch (e) {
    console.error(`\nCannot move the current build out of the way (${e.code}):`);
    console.error(`  ${buildDir}\n`);
    console.error('afterterm is almost certainly still running from that folder.');
    console.error('Close it (check the taskbar and the tray), then re-run this build.\n');
    process.exit(1);
  }
}

// Clean up previous old builds (keep only the most recent one)
if (fs.existsSync(outDir)) {
  const oldDirs = fs.readdirSync(outDir)
    .filter(d => d.startsWith('afterterm-old-'))
    .sort()
    .slice(0, -1); // keep the most recent
  for (const d of oldDirs) {
    try {
      fs.rmSync(path.join(outDir, d), { recursive: true, force: true });
      console.log(`Cleaned up ${d}`);
    } catch {}
  }
}

execFileSync('npx', ['electron-forge', 'package'], { stdio: 'inherit', cwd: path.join(__dirname, '..'), shell: true });
console.log('\nBuild ready at out\\afterterm-win32-x64\\afterterm.exe');
