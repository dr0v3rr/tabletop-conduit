// OAuth popup preload — runs before the sign-in page's own scripts, in the page's world
// (contextIsolation is off for this popup only). It removes the remaining "embedded browser"
// tells that Google (and similar) check client-side — chiefly navigator.userAgentData, whose
// brand list otherwise still contains "Electron" even after the request headers are cleaned.
// Loaded ONLY for the trusted identity-provider sign-in popup, which never exposes our IPC.

try {
  const nav = navigator as any;
  const win = window as any;
  const ua = navigator.userAgent; // the popup already sets a clean, Electron-free Chrome UA
  const major = (ua.match(/Chrome\/(\d+)/) || [])[1] || "130";
  const full = (ua.match(/Chrome\/([\d.]+)/) || [])[1] || major + ".0.0.0";
  const platform = /Windows/i.test(ua) ? "Windows" : /Linux/i.test(ua) ? "Linux" : "macOS";

  const brands = [
    { brand: "Chromium", version: major },
    { brand: "Google Chrome", version: major },
    { brand: "Not?A_Brand", version: "99" },
  ];
  const fullVersionList = [
    { brand: "Chromium", version: full },
    { brand: "Google Chrome", version: full },
    { brand: "Not?A_Brand", version: "99.0.0.0" },
  ];

  const uaData = {
    brands,
    mobile: false,
    platform,
    getHighEntropyValues: () =>
      Promise.resolve({
        architecture: "x86",
        bitness: "64",
        brands,
        fullVersionList,
        mobile: false,
        model: "",
        platform,
        platformVersion: /Windows/i.test(ua) ? "10.0.0" : /Mac/i.test(ua) ? "13.0.0" : "",
        uaFullVersion: full,
        wow64: false,
      }),
    toJSON: () => ({ brands, mobile: false, platform }),
  };

  // Replace the Electron-branded client hints with stock-Chrome ones.
  Object.defineProperty(nav, "userAgentData", { get: () => uaData, configurable: true });
  // Real Chrome exposes window.chrome with a runtime; bare Electron may not.
  if (!win.chrome) win.chrome = {};
  if (!win.chrome.runtime) win.chrome.runtime = {};
  // Never advertise automation.
  Object.defineProperty(nav, "webdriver", { get: () => false, configurable: true });
} catch {
  // Best-effort: if the environment won't let us patch these, we fall back to the header-level
  // disguise alone.
}
