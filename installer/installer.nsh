# afterterm's additions to electron-builder's one-click NSIS installer.
#
# This installer is the engine, not the face: afterterm-setup.exe (installer/setup,
# WPF) shows the screens and runs it silently,
#   afterterm-engine.exe /S [--no-desktop-shortcut] [--no-start-menu-shortcut] /D=<folder>
# and it copies the app, creates the shortcuts, writes the Settings > Apps entry
# and the uninstaller. The template handles --no-desktop-shortcut itself; the Start
# menu option and the running-app check are added here.

!include FileFunc.nsh

# afterterm in the folder being installed into, or uninstalled from, is asked to
# close: never killed, since it holds the user's terminals. electron-builder's own
# check force-closes every process with the app's file name, anywhere, which would
# take down a separate copy too (the real afterterm beside "afterterm (test)", or a
# portable one). In a silent run the answer is Cancel, so the engine stops; the
# setup screens check for a running copy before they start it.
!macro customCheckAppRunning
  ${Do}
    nsExec::ExecToStack `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "if (Get-Process -Name ([IO.Path]::GetFileNameWithoutExtension('${APP_EXECUTABLE_FILENAME}')) -ErrorAction SilentlyContinue | Where-Object { $$_.Path -and $$_.Path.StartsWith('$INSTDIR\', [StringComparison]::OrdinalIgnoreCase) }) { exit 1 } else { exit 0 }"`
    Pop $0
    Pop $1
    ${If} $0 != 1
      ${Break}
    ${EndIf}
    MessageBox MB_RETRYCANCEL|MB_ICONINFORMATION "${PRODUCT_NAME} is open. Close it, then click Retry." /SD IDCANCEL IDRETRY +2
    Quit
  ${Loop}
!macroend

!ifndef BUILD_UNINSTALLER
Var noStartMenu

!macro customInit
  StrCpy $noStartMenu 0
  ${GetParameters} $0
  ClearErrors
  ${GetOptions} $0 "--no-start-menu-shortcut" $1
  ${IfNot} ${Errors}
    StrCpy $noStartMenu 1
  ${EndIf}
!macroend

# At the end of the template's install section: the Start menu shortcut it made,
# removed when the user unticked it. (The uninstaller removes it either way.)
!macro customInstall
  ${If} $noStartMenu == 1
    WinShell::UninstShortcut "$newStartMenuLink"
    Delete "$newStartMenuLink"
  ${EndIf}
!macroend
!endif
