// Which desktop the page runs on, for values the two systems name differently (font names). Outside a
// WebKit page on a Mac (WebView2 on Windows, Node in tests) it is Windows.
const MACOS = typeof navigator !== "undefined" && /Macintosh|Mac OS X/.test(navigator.userAgent);

export function onPlatform<T>(windows: T, macos: T): T {
  return MACOS ? macos : windows;
}
