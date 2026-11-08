Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class ZT {
  public delegate IntPtr WndProc(IntPtr h, uint m, IntPtr w, IntPtr l);
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  public struct WNDCLASSEX { public uint cbSize; public uint style; public WndProc lpfnWndProc; public int cbClsExtra; public int cbWndExtra; public IntPtr hInstance; public IntPtr hIcon; public IntPtr hCursor; public IntPtr hbrBackground; public string lpszMenuName; public string lpszClassName; public IntPtr hIconSm; }
  [StructLayout(LayoutKind.Sequential)] public struct MSG { public IntPtr hwnd; public uint message; public IntPtr wParam; public IntPtr lParam; public uint time; public int x; public int y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr v);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern ushort RegisterClassEx(ref WNDCLASSEX c);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr CreateWindowEx(uint ex, string cls, string name, uint style, int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr inst, IntPtr param);
  [DllImport("user32.dll")] public static extern IntPtr DefWindowProc(IntPtr h, uint m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool DestroyWindow(IntPtr h);
  [DllImport("gdi32.dll")] public static extern IntPtr CreateSolidBrush(uint color);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] public static extern IntPtr GetModuleHandle(string n);
  [DllImport("user32.dll")] public static extern bool PeekMessage(out MSG m, IntPtr h, uint min, uint max, uint remove);
  [DllImport("user32.dll")] public static extern bool TranslateMessage(ref MSG m);
  [DllImport("user32.dll")] public static extern IntPtr DispatchMessage(ref MSG m);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetWindowLong(IntPtr h, int idx);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  // True when a sits above b in the z-order (walking down from a reaches b).
  public static bool Above(IntPtr a, IntPtr b) { IntPtr h = GetWindow(a, 2); int n = 0; while (h != IntPtr.Zero && n++ < 100000) { if (h == b) return true; h = GetWindow(h, 2); } return false; }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(IntPtr h, System.Text.StringBuilder s, int n);
  static WndProc keep = (h, m, w, l) => DefWindowProc(h, m, w, l);
  static bool registered;
  public static IntPtr MakeBlocker(int x, int y, int w, int h) {
    IntPtr inst = GetModuleHandle(null);
    if (!registered) {
      var wc = new WNDCLASSEX();
      wc.cbSize = (uint)Marshal.SizeOf(typeof(WNDCLASSEX));
      wc.lpfnWndProc = keep; wc.hInstance = inst;
      wc.hbrBackground = CreateSolidBrush(0x00FF00FF); // magenta (BGR)
      wc.lpszClassName = "AftZBlocker";
      RegisterClassEx(ref wc);
      registered = true;
    }
    // WS_POPUP; WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW: never activated, no taskbar button.
    IntPtr hwnd = CreateWindowEx(0x08000080, "AftZBlocker", "z-order blocker", 0x80000000, x, y, w, h, IntPtr.Zero, IntPtr.Zero, inst, IntPtr.Zero);
    ShowWindow(hwnd, 4); // SW_SHOWNOACTIVATE
    return hwnd;
  }
  public static void Pump(int ms) {
    int end = Environment.TickCount + ms; MSG m;
    while (Environment.TickCount < end) {
      while (PeekMessage(out m, IntPtr.Zero, 0, 0, 1)) { TranslateMessage(ref m); DispatchMessage(ref m); }
      System.Threading.Thread.Sleep(10);
    }
  }
  public static List<IntPtr> ZOrder() {
    var list = new List<IntPtr>();
    EnumWindows((h, l) => { list.Add(h); return true; }, IntPtr.Zero);
    return list;
  }
  // 32bpp bytes (B,G,R,A). Near-white pixels in rows [padTop, padBottom), rows with at least minRow near-white pixels, all near-white pixels.
  public static int[] WhiteScan(byte[] d, int stride, int w, int h, int padTop, int padBottom, int minRow) {
    int pad = 0, rows = 0, all = 0;
    for (int y = 0; y < h; y++) {
      int rw = 0, o = y * stride;
      for (int x = 0; x < w; x++) { int i = o + x * 4; if (d[i] >= 225 && d[i + 1] >= 225 && d[i + 2] >= 225) rw++; }
      all += rw; if (rw >= minRow) rows++; if (y >= padTop && y < padBottom) pad += rw;
    }
    return new int[] { pad, rows, all };
  }
  public static string Cls(IntPtr h) { var sb = new System.Text.StringBuilder(256); GetClassName(h, sb, 256); return sb.ToString(); }
}
'@

[void][ZT]::SetProcessDpiAwarenessContext([IntPtr]::op_Explicit(-4))
if ([ZT]::SetThreadDpiAwarenessContext([IntPtr]::op_Explicit(-4)) -eq [IntPtr]::Zero) { throw "could not set per-monitor DPI awareness" }
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
