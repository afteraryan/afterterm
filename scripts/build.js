const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const outDir = path.join(__dirname, '..', 'out');
const buildDir = path.join(outDir, 'afterterm-win32-x64');

// If the current build exists (possibly running), rename it out of the way
if (fs.existsSync(buildDir)) {
  const oldDir = path.join(outDir, `afterterm-old-${Date.now()}`);
  try {
    fs.renameSync(buildDir, oldDir);
    console.log(`Moved running build to ${path.basename(oldDir)}`);
  } catch (e) {
    console.error('Could not move old build — is it still locked? Trying anyway...');
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
