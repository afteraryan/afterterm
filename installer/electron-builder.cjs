// electron-builder settings for the engine inside afterterm's Windows installer.
//
// The installer people run is afterterm-<version>-setup.exe, built from
// installer/setup (WPF): it shows the screens and runs this engine silently. The
// engine is electron-builder's one-click NSIS installer around the folder Forge
// already built (`--prepackaged`); it copies the app and makes the shortcuts, the
// Settings > Apps entry and the uninstaller. installer/installer.nsh adds the Start
// menu option and a running-app check that asks instead of killing.
// scripts/build-installer.js runs all of it.
//
// AFTERTERM_INSTALLER_SANDBOX=1 builds "afterterm (test)": another app id, another
// exe name, another install folder and its own uninstall entry, so it installs and
// runs beside the real afterterm without touching it.

const sandbox = process.env.AFTERTERM_INSTALLER_SANDBOX === '1';
const productName = sandbox ? 'afterterm (test)' : 'afterterm';

module.exports = {
  appId: sandbox ? 'com.afterterm.app.test' : 'com.afterterm.app',
  productName,
  executableName: sandbox ? 'afterterm-test' : 'afterterm',
  directories: { output: 'out/installer', buildResources: 'installer' },
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    icon: 'assets/icon.ico',
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    runAfterFinish: false,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    shortcutName: productName,
    uninstallDisplayName: productName,
    installerIcon: 'assets/icon.ico',
    uninstallerIcon: 'assets/icon.ico',
    include: 'installer.nsh',
    deleteAppDataOnUninstall: false,
    artifactName: sandbox ? 'afterterm-test-${version}-engine.${ext}' : 'afterterm-${version}-engine.${ext}',
  },
};
