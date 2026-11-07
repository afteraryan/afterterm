# Guide: building the afterterm installer

`npm run build` produces `out\afterterm-win32-x64\`, the app folder (about 346 MB: Chromium
plus node_modules). To hand afterterm to someone else, build the installer:

```powershell
npm run installer          # out\installer\afterterm-<version>-setup.exe, about 85 MB
npm run installer -- --sandbox   # "afterterm (test)", a throwaway copy for testing (below)
```

`npm run release` runs the same build and then tags the version (see
[`guide-02-releases.md`](guide-02-releases.md)). Nothing has to be installed by hand: no 7-Zip,
no NSIS. Until 0.10.0 the shareable build was a 7-Zip self-extracting archive that unpacked a
folder and nothing else; this guide replaced that one on 2026-10-29.

---

## What the person installing it sees

Four screens (agreed against the "afterterm Setup" mockup on 2026-10-29; screenshots in
`docs/screenshots/installer/`):

1. **Welcome:** logo, version, the install folder with Change (default
   `%LOCALAPPDATA%\Programs\afterterm`, or the folder of an earlier install), a Desktop shortcut
   and a Start menu shortcut box. No admin prompt: it installs for the current user only.
2. **Installing:** a bar that follows the real work and never fills in under 3 seconds.
3. **Checking Claude Code:** only when Claude Code is installed. Three rows (found,
   notifications, chats come back after Sleep) settle as `afterterm.exe --setup-check` reports.
   A failure names the cause and offers **Report issue** (a GitHub issue filled in with the
   report, which can be read first) and **Continue anyway**.
4. **Ready:** Open afterterm, Finish.

It also adds afterterm to Settings > Apps with an uninstaller. Projects, threads and settings
live in `%APPDATA%\afterterm\`, outside the install folder, so installing over an earlier
copy keeps them, and so does uninstalling.

---

## How it is built

`scripts/build-installer.js`, in order:

1. **Package** the app with Forge through `scripts/build.js` (which moves the previous build
   aside and stops if afterterm is running from that folder). `--skip-package` reuses the
   folder as it is.
2. **Stage** a copy and prune what never runs: debug symbols (`*.pdb`) and the arm64 node-pty
   prebuilds. Every language pack is kept: stripping them saves about 40 MB but can break
   afterterm on a non-English Windows.
3. **The engine:** electron-builder (`installer/electron-builder.cjs`) wraps the staged folder,
   `--prepackaged`, in its one-click NSIS installer. It copies the app, creates the shortcuts,
   writes the Settings > Apps entry and the uninstaller. `installer/installer.nsh` adds two
   things: a Start menu opt-out, and a running-app check that asks the user to close afterterm
   instead of force-closing every `afterterm.exe` by name (electron-builder's default, which
   would also kill a separate copy).
4. **The face:** `installer/setup/` (`Setup.cs`, `Setup.xaml`), a small WPF app compiled with
   the C# compiler that ships with Windows (`%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe`),
   with the engine embedded as a resource. It shows the screens, runs the engine silently
   (`/S`, the shortcut options, `/D=<folder>`), then runs the Claude Code check. It needs
   .NET Framework 4.8, which is part of Windows 10 (since 2019) and 11.

### Why WPF and not NSIS's own pages

NSIS draws old Win32 dialog controls: no rounded corners, buttons that cannot be filled, every
element placed by hand in pixels, animation by swapping bitmaps on a timer. A first version
built that way looked like an old Windows dialog painted dark, with overlapping text and a
stuttering spinner. WPF gives real layout, anti-aliased text and animation on the render
thread. NSIS stays underneath for the parts it is good at.

---

## The test build ("afterterm (test)")

`npm run installer -- --sandbox` builds `afterterm-test-<version>-setup.exe`. It has its own app
id, exe name (`afterterm-test.exe`), install folder and uninstall entry, so it installs and
runs beside the real afterterm. Its `resources\afterterm-sandbox.json` points its data and its
Claude Code settings at `%LOCALAPPDATA%\afterterm-test\` (its terminals get that as
`CLAUDE_CONFIG_DIR`, so the real `~/.claude` is never touched), forces the Restricted
execution policy on everything it starts, and seeds the hook entries 0.9.x wrote: the state
Yogansh's laptop was in when chats stopped coming back (2026-10-29). A chat inside the test
build needs one `/login`, since its Claude settings folder is its own.

Remove it from Settings > Apps, then delete `%LOCALAPPDATA%\afterterm-test`.

---

## SmartScreen

The installer is not code-signed, so a downloaded copy shows "Windows protected your PC":
**More info**, then **Run anyway**. One built on the same PC does not. Only a paid
code-signing certificate removes the warning.

## Pinning

Windows lets no app pin itself to the taskbar or to Start. The installer adds Start menu
and desktop shortcuts; the running window and the shortcuts share one app id
(`com.afterterm.app`), so a pin made from either is one taskbar icon.
