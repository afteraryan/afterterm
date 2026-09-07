// Editor products afterterm can open a project folder in. Shared by the main
// process (detection, launch) and the renderer (button label, logo, menu entry).
// Pure types and a name table, no Node or DOM imports, so both sides and the
// unit tests can import it.

export type EditorProduct = 'vscode' | 'vscode-insiders' | 'cursor' | 'windsurf' | 'other';

export interface EditorInfo {
  // Stable within a session; the renderer passes it back to editors.open().
  id: string;
  // Display name: "VS Code", "VS Code Insiders", "Cursor", "Windsurf", or the exe
  // name without its extension for an unknown product.
  name: string;
  // Absolute path of the executable that gets launched.
  path: string;
  product: EditorProduct;
  // How it was found, for the one-line log at startup and for tests:
  // 'prefs' (editorPath in prefs.json), 'path' (the code command), 'install'
  // (a standard install folder), 'registry' (the uninstall registry).
  source: 'prefs' | 'path' | 'install' | 'registry';
}

export function editorProductName(product: EditorProduct, exeName?: string): string {
  switch (product) {
    case 'vscode': return 'VS Code';
    case 'vscode-insiders': return 'VS Code Insiders';
    case 'cursor': return 'Cursor';
    case 'windsurf': return 'Windsurf';
    case 'other': return (exeName ?? 'Editor').replace(/\.exe$/i, '');
  }
}

// Product from the executable's file name, case-insensitive. Anything unknown is
// 'other' so a hand-picked editorPath still gets a button with its own name.
export function editorProductFromExe(exeName: string): EditorProduct {
  const n = exeName.toLowerCase();
  if (n === 'code.exe') return 'vscode';
  if (n === 'code - insiders.exe') return 'vscode-insiders';
  if (n === 'cursor.exe') return 'cursor';
  if (n === 'windsurf.exe') return 'windsurf';
  return 'other';
}
