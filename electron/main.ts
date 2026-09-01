// Electron main. One window with a splash chooser + a left sheet-UI view and two right-hand panes
// (the VTT — Roll20 — and the character source's site). Character sources: D&D Beyond, poke5e,
// and Open5e/DDB monsters. The engine runs here in main; the renderer is a thin client over IPC.
import { app, BaseWindow, BrowserWindow, WebContentsView, ipcMain, dialog, session, clipboard, net, Notification, shell, Menu } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve, relative, isAbsolute } from "node:path";
import { campaignLogFileName } from "./archive-path.js";
import { writeFile, readFile, appendFile, mkdir, readdir } from "node:fs/promises";
import { rollFrom, buildCharacter, availableToggles } from "../src/pipeline.js";
import type { CharacterData, RollRequest } from "../src/pipeline.js";
import { buildSendExpression } from "../src/roll20/inject.js";
import { displayCard } from "../src/roll20/format.js";
import { r20TokenExpr } from "../src/roll20/token.js";
import { ddbSlotsExpr, ddbHitDiceExpr, ddbInventoryExpr, ddbFetchCharExpr } from "../src/ddb/inject.js";
import { extractReadKey, fetchTrainer, trainerToRollModel, trainerExtras, buildInventory, fetchTrainerFeats, updateTrainerHp, updatePokemonHp, updateMovePp, updateInventoryItem, addInventoryItem, fetchItemsCatalog, addPokemonToTeam, removePokemon, deleteTrainer, setPoke5eCredentials, getPoke5eCredentials } from "../src/poke5e/source.js";
import { buildPokedex } from "../src/poke5e/pokedex.js";
import type { DexEntry } from "../src/poke5e/pokedex.js";
import { isNewer } from "../src/update/version.js";
import electronUpdater from "electron-updater";
const { autoUpdater } = electronUpdater;
import { fetchPokemon, fetchMoveset, movesMap, pokemonToCharacter, resolveAbilities, fetchPokemonFeats, pokemonMeta } from "../src/poke5e/pokemon.js";
import { abilityIds, passiveAbilityEffects } from "../src/poke5e/abilities-engine.js";
import { searchMonsters, fetchMonster, monsterToCharacter } from "../src/monster/source.js";
import { searchDdbMonsters, fetchDdbMonster, ddbMonsterToCharacter } from "../src/monster/ddb.js";
import { roll20LogExpr } from "../src/roll20/log.js";
import type { RollRecord } from "../src/roll20/log.js";
import { aggregate, recordsToCSV, statsToCSV } from "../src/stats/roll-stats.js";

/** Accumulated roll history. Deduped by Roll20 message id and PERSISTED to disk, so it survives
 *  restarts and grows far beyond Roll20's ~100-message chat buffer. */
const sessionLog = new Map<string, RollRecord>();
const actionLog: Array<{ at: number; character?: string; name: string; command: string }> = []; // what WE sent
const campaignNames = new Map<string, string>(); // campaign id -> display name

const storePath = () => join(app.getPath("userData"), "roll-history.json");

// Last poke5e Supabase credentials auto-detected from the site (persisted so they're applied on
// the next launch, before the pane has a chance to re-emit them). null until first detection.
let detectedPoke5e: { url: string; anonKey: string } | null = null;

// Pokédex "seen / caught" collection, persisted in the store. Keyed by species id.
const pokedexCollection = new Map<string, "seen" | "caught">();

// A release version the user chose to "Skip" in the update prompt (so we don't nag for it again).
let updateSkip: string | null = null;

// poke5e Pokémon the user has hidden from the roster switcher (a local "show only my working team"
// filter — poke5e has no team field yet). Keyed by pokemon id.
const pokeHidden = new Set<string>();

async function loadStore() {
  try {
    const data = JSON.parse(await readFile(storePath(), "utf8"));
    for (const r of data.records ?? []) if (r?.id) sessionLog.set(r.id, r);
    if (Array.isArray(data.actions)) actionLog.push(...data.actions);
    for (const [id, name] of Object.entries(data.campaigns ?? {})) campaignNames.set(id, String(name));
    for (const [id, st] of Object.entries(data.pokedex ?? {})) {
      if (st === "seen" || st === "caught") pokedexCollection.set(id, st);
    }
    if (typeof data.updateSkip === "string") updateSkip = data.updateSkip;
    for (const id of data.pokeHidden ?? []) pokeHidden.add(String(id));
    // Re-apply a previously detected poke5e key/endpoint so RPCs work before the pane reloads.
    if (data.poke5e && setPoke5eCredentials(data.poke5e)) detectedPoke5e = getPoke5eCredentials();
  } catch {
    /* no store yet — first run */
  }
}

/** Read the Roll20 pane's current campaign id + name (best-effort). */
async function readCampaign(): Promise<{ id: string | null; name: string | null }> {
  try {
    return await roll20View.webContents.executeJavaScript(
      `(function(){ try { var id=(typeof window.campaign_id!=='undefined'&&window.campaign_id!=null)?String(window.campaign_id):null; var name=(window.Campaign&&window.Campaign.get&&window.Campaign.get('name'))||null; if(!name&&document.title){name=document.title.replace(/\\s*\\|\\s*Roll20.*$/i,'').trim()||null;} return {id:id,name:name}; } catch(e){ return {id:null,name:null}; } })()`,
      true,
    );
  } catch {
    return { id: null, name: null };
  }
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveStoreSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    try {
      await writeFile(storePath(), JSON.stringify({ records: [...sessionLog.values()], actions: actionLog, campaigns: Object.fromEntries(campaignNames), poke5e: detectedPoke5e, pokedex: Object.fromEntries(pokedexCollection), updateSkip, pokeHidden: [...pokeHidden] }), "utf8");
    } catch {
      /* best-effort */
    }
  }, 1500);
}

// ---- Durable per-campaign roll archive --------------------------------------------------------
// Roll20's chat buffer evicts old messages, so rolls scroll off and are lost forever. We keep an
// append-only JSON-Lines archive per campaign, capturing every roll we scrape (deduped by message
// id) from the moment you first open a campaign. This is the standardised, durable home for roll
// history — independent of the in-app session view and of roll-history.json (clearing the session
// view never touches the archive).
//
// Location — a conventional per-OS home for the durable roll archive:
//   Windows        %APPDATA%\Conduit\roll-logs   (app.getPath("appData"), the natural spot on Win)
//   macOS / Linux  ~/.conduit/roll-logs          (a hidden dot-dir keeps the home directory tidy)
// On Unix we use a dot-dir under $HOME rather than the Documents folder on purpose: macOS
// Documents/Desktop/Downloads are TCC-protected, where a sandboxed write can fail silently — a
// home-level dot-dir is not, so the archive always just works. It's still easy to find and to back
// up / sync yourself.
const rollLogsDir = () =>
  process.platform === "win32"
    ? join(app.getPath("appData"), "Conduit", "roll-logs")
    : join(app.getPath("home"), ".conduit", "roll-logs");
const archivedIds = new Set<string>(); // roll ids already written to the archive (append dedupe)
type CampaignArchive = { name: string | null; first: string | null; last: string | null; count: number; file: string };
const campaignIndex = new Map<string, CampaignArchive>();

// campaignLogFileName is a pure, unit-tested path-safety helper (electron/archive-path.ts). The
// campaign id is UNTRUSTED (window.campaign_id from a page a hostile game/player can influence);
// campaignLogFileName whitelists it (no separators/dots, length-capped, reserved-name-safe), and
// withinArchive (below) is a belt-and-suspenders containment check on the final path.
const campaignFile = (id: string) => campaignLogFileName(id);
// Defense-in-depth containment check: confirm a target path resolves strictly INSIDE the archive dir
// before writing — so no future change can be tricked into escaping it.
function withinArchive(fullPath: string): boolean {
  const rel = relative(resolve(rollLogsDir()), resolve(fullPath));
  return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel);
}

/** Load the existing archive at startup: rebuild the id-dedupe set + per-campaign index. */
async function loadArchive() {
  try {
    await mkdir(rollLogsDir(), { recursive: true });
    for (const f of (await readdir(rollLogsDir())).filter((n) => n.endsWith(".jsonl"))) {
      let text = "";
      try { text = await readFile(join(rollLogsDir(), f), "utf8"); } catch { continue; }
      let count = 0, first: string | null = null, last: string | null = null, cid = f.replace(/\.jsonl$/, "");
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        try {
          const r = JSON.parse(line);
          if (r.id) {
            archivedIds.add(r.id);
            // Seed the session store from the durable archive so stats/leaderboards reflect the
            // ENTIRE campaign history — not just the current view, and surviving a Clear + restart.
            // Deduped by id; loadArchive runs after loadStore so the archive is authoritative.
            if (!sessionLog.has(r.id)) sessionLog.set(r.id, r as RollRecord);
          }
          count++;
          if (first == null && r.ts) first = r.ts;
          if (r.ts) last = r.ts;
          if (r.campaign) cid = r.campaign;
        } catch { /* skip a corrupt line, keep the rest */ }
      }
      campaignIndex.set(cid, { name: campaignNames.get(cid) ?? null, first, last, count, file: f });
    }
  } catch { /* first run — no archive yet */ }
}

let archiveIndexTimer: ReturnType<typeof setTimeout> | null = null;
function writeArchiveIndexSoon() {
  if (archiveIndexTimer) return;
  archiveIndexTimer = setTimeout(async () => {
    archiveIndexTimer = null;
    try {
      const campaigns = [...campaignIndex.entries()].map(([id, v]) => ({ id, ...v, name: v.name ?? campaignNames.get(id) ?? null }));
      await writeFile(join(rollLogsDir(), "index.json"), JSON.stringify({ updatedAt: Date.now(), campaigns }, null, 2), "utf8");
    } catch { /* best-effort */ }
  }, 1500);
}

/** Append every not-yet-archived roll to its campaign's JSONL file. Called on each scrape. */
async function appendToArchive(records: RollRecord[]) {
  const fresh = (records || []).filter((r) => r && r.id && !archivedIds.has(r.id));
  if (!fresh.length) return;
  try { await mkdir(rollLogsDir(), { recursive: true }); } catch { /* ignore */ }
  const byCampaign = new Map<string, RollRecord[]>();
  for (const r of fresh) {
    archivedIds.add(r.id); // reserve now so a concurrent scrape can't double-append
    const cid = r.campaign || "unknown";
    const arr = byCampaign.get(cid);
    if (arr) arr.push(r); else byCampaign.set(cid, [r]);
  }
  for (const [cid, recs] of byCampaign) {
    const file = campaignFile(cid);
    const target = join(rollLogsDir(), file);
    if (!withinArchive(target)) { recs.forEach((r) => archivedIds.delete(r.id)); continue; } // never write outside the archive dir
    try {
      // JSON.stringify safely escapes every field (quotes, newlines, control chars), so untrusted
      // scraped content can neither break the one-record-per-line JSONL framing nor inject structure.
      await appendFile(target, recs.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
    } catch {
      recs.forEach((r) => archivedIds.delete(r.id)); // write failed → let a later scrape retry
      continue;
    }
    const prev = campaignIndex.get(cid) ?? { name: null, first: null, last: null, count: 0, file };
    for (const r of recs) { if (prev.first == null && r.ts) prev.first = r.ts; if (r.ts) prev.last = r.ts; }
    prev.count += recs.length;
    prev.name = prev.name ?? campaignNames.get(cid) ?? null;
    prev.file = file;
    campaignIndex.set(cid, prev);
  }
  writeArchiveIndexSoon();
}

/** Merge freshly-scraped records into the persistent store. Returns true if anything changed. */
function mergeRecords(records: RollRecord[]): boolean {
  let changed = false;
  for (const r of records ?? []) {
    if (!r || !r.id) continue;
    const prev = sessionLog.get(r.id);
    // update if new, or if a later scrape filled in a value (e.g. rawD20 once the title rendered)
    if (!prev || JSON.stringify(prev) !== JSON.stringify(r)) { sessionLog.set(r.id, r); changed = true; }
  }
  if (changed) saveStoreSoon();
  return changed;
}

/** Background capture: scrape the Roll20 chat on a timer so rolls are stored BEFORE they scroll
 *  off Roll20's buffer — independent of the renderer's Live-display toggle. */
async function captureLoop() {
  try {
    if (!roll20View) return;
    const records: RollRecord[] = await roll20View.webContents.executeJavaScript(roll20LogExpr(), true);
    mergeRecords(records);
    void appendToArchive(records); // durable per-campaign archive (independent of the session view)
  } catch {
    /* no game open / transient */
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHEET_W = 400;

let win: BaseWindow;
let sheetView: WebContentsView;
let roll20View: WebContentsView;
let ddbView: WebContentsView;
let splashView: WebContentsView;
let rightMode: "roll20" | "ddb" = "roll20";
let pokedexOpen = false; // Pokédex tab active → sheet pane covers the whole window
let launched = false; // false until the user picks a source + VTT on the splash screen
let activeSource: "ddb" | "poke5e" | "monster" = "ddb";
let activeVtt: "roll20" = "roll20";

/** Currently loaded character (raw character-service data). Kept in main for roll resolution. */
let current: { data: CharacterData; name: string; id: string; model?: import("../src/engine/types.js").RollModel } | null = null;
// poke5e team context, so switching to a Pokémon doesn't re-fetch the whole trainer.
let poke5eCtx: { readKey: string; trainerId: string; trainerRow: any; team: Map<number, any>; writeKey: string } | null = null;

// poke5e.app doesn't live-update when we write HP/PP through its API, so the pane shows stale values.
// After a write settles, reload the poke5e pane (in the background) so it re-fetches the new state.
// Debounced so a burst of writes triggers a single reload, and only when the pane is on poke5e.app.
let poke5eRefreshTimer: ReturnType<typeof setTimeout> | null = null;
function schedulePoke5ePaneRefresh() {
  if (poke5eRefreshTimer) clearTimeout(poke5eRefreshTimer);
  poke5eRefreshTimer = setTimeout(() => {
    poke5eRefreshTimer = null;
    try {
      if ((ddbView?.webContents?.getURL?.() || "").includes("poke5e.app")) ddbView.webContents.reload();
    } catch { /* pane gone / navigating — ignore */ }
  }, 2500);
}

function layout() {
  const [w, h] = win.getContentSize();
  // Before launch the splash covers the whole window and the panes sit at 0×0 behind it.
  if (splashView) splashView.setBounds(launched ? { x: 0, y: 0, width: 0, height: 0 } : { x: 0, y: 0, width: w, height: h });
  if (!launched) {
    sheetView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    roll20View.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    ddbView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    return;
  }
  // Pokédex tab: the sheet pane covers the FULL window (its list+detail layout wants the room).
  // The right panes keep their desktop-width bounds but sit BEHIND the sheet (z-order), so they're
  // hidden without resizing to 0×0 — which would flip D&D Beyond into its broken mobile layout.
  sheetView.setBounds(pokedexOpen ? { x: 0, y: 0, width: w, height: h } : { x: 0, y: 0, width: SHEET_W, height: h });
  // BOTH right-pane views get the full right region at all times — the inactive one sits BEHIND
  // the active one (z-order), so it's invisible but still rendered at desktop width. A 0×0 view
  // makes D&D Beyond switch to its mobile layout, which breaks the rest/hit-dice controls.
  const right = { x: SHEET_W, y: 0, width: Math.max(1, w - SHEET_W), height: h };
  roll20View.setBounds(right);
  ddbView.setBounds(right);
}

/** Bring the active right-pane view to the front (Electron z-order = child add order). */
function raiseRightPane() {
  const active = rightMode === "ddb" ? ddbView : roll20View;
  win.contentView.removeChildView(active);
  win.contentView.addChildView(active);
  win.contentView.removeChildView(sheetView); // keep the sheet on top
  win.contentView.addChildView(sheetView);
}

/** Shared, persistent session for both remote sites. We rewrite incoming Set-Cookie headers so
 *  that pure session cookies (no Expires/Max-Age) get a long Max-Age — Electron only persists
 *  cookies with an expiry to disk, so this is what keeps D&D Beyond and Roll20 logged in across
 *  app restarts. Deletion cookies (which already carry Max-Age/Expires) are left untouched. */
function setupPersistentSession(): string {
  const PARTITION = "persist:main";
  const s = session.fromPartition(PARTITION);
  const THIRTY_DAYS = 60 * 60 * 24 * 30;
  s.webRequest.onHeadersReceived((details, cb) => {
    const headers = details.responseHeaders ?? {};
    const key = Object.keys(headers).find((k) => k.toLowerCase() === "set-cookie");
    if (key) {
      headers[key] = (headers[key] as string[]).map((c) =>
        /expires=|max-age=/i.test(c) ? c : `${c}; Max-Age=${THIRTY_DAYS}`,
      );
    }
    cb({ responseHeaders: headers });
  });

  // Google (and some others) refuse OAuth in browsers they flag as embedded. Beyond the UA
  // string, the real tell is User-Agent Client Hints (Sec-CH-UA), which Electron stamps with an
  // "Electron" brand. Rewrite those for Google's auth hosts so the in-app sign-in popup presents
  // as stock Chrome. Scoped to accounts.google.com so nothing else is affected.
  const cleanUa = chromeUA(app.userAgentFallback || "");
  const major = (cleanUa.match(/Chrome\/(\d+)/) || [])[1] || "130";
  const fullVer = (cleanUa.match(/Chrome\/([\d.]+)/) || [])[1] || "130.0.0.0";
  const chShort = `"Chromium";v="${major}", "Google Chrome";v="${major}", "Not?A_Brand";v="99"`;
  const chFull = `"Chromium";v="${fullVer}", "Google Chrome";v="${fullVer}", "Not?A_Brand";v="99.0.0.0"`;
  // Auto-detect poke5e's Supabase anon key + endpoint from the site's OWN API calls. poke5e.app
  // sends the anon key as the `apikey` header on every Supabase request; we read it (observe-only)
  // and hand it to our RPC layer, which otherwise falls back to a baked-in default. This means a
  // rotated key — or even a moved Supabase project — is picked up automatically, no code change.
  s.webRequest.onSendHeaders({ urls: ["*://*.poke5e.app/*", "*://*.supabase.co/*"] }, (details) => {
    try {
      const h = details.requestHeaders || {};
      const apikey = (Object.entries(h).find(([k]) => k.toLowerCase() === "apikey") || [])[1] as string | undefined;
      const url = new URL(details.url).origin;
      if (apikey && setPoke5eCredentials({ url, anonKey: apikey })) {
        detectedPoke5e = getPoke5eCredentials();
        saveStoreSoon();
      }
    } catch {
      /* best-effort — never let sniffing break a request */
    }
  });

  s.webRequest.onBeforeSendHeaders(
    { urls: ["*://accounts.google.com/*", "*://accounts.youtube.com/*"] },
    (details, cb) => {
      const h = details.requestHeaders;
      if (cleanUa) h["User-Agent"] = cleanUa;
      for (const k of Object.keys(h)) {
        const lk = k.toLowerCase();
        if (lk === "sec-ch-ua") h[k] = chShort;
        else if (lk === "sec-ch-ua-full-version-list") h[k] = chFull;
      }
      cb({ requestHeaders: h });
    },
  );
  return PARTITION;
}

/** Navigation hardening for a view: never spawn in-app popups (route real links to the OS
 *  browser), and block navigations to dangerous schemes (javascript:/data:/file:). The local
 *  sheet view is additionally locked to file:// so it can never be navigated away from. */
// Identity-provider hosts whose sign-in popups must stay INSIDE the app (same session) so the
// auth cookie lands in our persistent session — not the system browser. Also covers the sites'
// own auth popups (dndbeyond.com / roll20.net).
function isAuthPopup(url: string): boolean {
  try {
    const h = new URL(url).host.toLowerCase();
    return (
      /(^|\.)accounts\.google\.com$/.test(h) ||
      /(^|\.)appleid\.apple\.com$/.test(h) ||
      /(^|\.)login\.(microsoftonline|live)\.com$/.test(h) ||
      /(^|\.)(facebook|discord|twitch|amazon|apple)\.com$/.test(h) ||
      /(^|\.)twitch\.tv$/.test(h) ||
      /(^|\.)dndbeyond\.com$/.test(h) ||
      /(^|\.)roll20\.net$/.test(h)
    );
  } catch {
    return false;
  }
}

// Strip the "AppName/x.y.z" and "Electron/x.y.z" tokens so the UA reads as stock Chrome — Google
// (and others) block OAuth in browsers they flag as embedded/insecure, and the Electron token is
// the tell. Leaves the correct per-platform Chrome UA otherwise.
function chromeUA(ua: string): string {
  const appToken = new RegExp(" " + app.getName().replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\/[\\d.]+", "i");
  return ua.replace(appToken, "").replace(/ Electron\/[\d.]+/i, "").replace(/\s{2,}/g, " ").trim();
}

function isGoogleAuth(url: string): boolean {
  try { return /(^|\.)accounts\.google\.com$/.test(new URL(url).host.toLowerCase()); } catch { return false; }
}

// Google blocks OAuth inside desktop apps (and defeats UA/client-hint spoofing), so we never let
// the user reach its dead-end "browser may not be secure" page. Instead, steer them to a login
// method that works in-app — email/password or Twitch. One-time; the session then persists.
async function guideToEmailLogin(spawningView: WebContentsView) {
  const toRoll20 = spawningView === roll20View;
  const site = toRoll20 ? "Roll20" : "D&D Beyond";
  const loginUrl = toRoll20 ? "https://app.roll20.net/sessions/new" : "https://www.dndbeyond.com/login";
  const { response } = await dialog.showMessageBox(win, {
    type: "info",
    title: "Google sign-in isn’t supported in apps",
    message: "Google blocks “Sign in with Google” inside desktop apps.",
    detail: `This is Google’s policy for every desktop app, not a bug here. Sign in to ${site} with email & password (or Twitch) instead — those work inside the app, and it’s a one-time thing. Open the ${site} email login now?`,
    buttons: ["Open email login", "Cancel"],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) spawningView.webContents.loadURL(loginUrl);
}

// Open an OAuth/sign-in popup as an in-app child window sharing the persistent session, so the
// resulting cookies are visible to the D&D Beyond / Roll20 panes. Closes itself once the flow
// returns to the originating site, then reloads that pane to reflect the new signed-in state.
function openAuthPopup(url: string, spawningView: WebContentsView) {
  // A Google target is doomed — skip the popup entirely and guide to a login method that works.
  if (isGoogleAuth(url)) { void guideToEmailLogin(spawningView); return; }
  const popup = new BrowserWindow({
    width: 520,
    height: 700,
    parent: win,
    title: "Sign in",
    autoHideMenuBar: true,
    // contextIsolation OFF (this popup only) so oauth-preload can patch navigator.userAgentData in
    // the page's own world — the last client-side "embedded browser" tell Google checks. The popup
    // loads only trusted identity providers and exposes no IPC, so it can't reach our app internals.
    webPreferences: {
      partition: "persist:main",
      preload: join(__dirname, "oauth-preload.cjs"),
      sandbox: false,
      contextIsolation: false,
      nodeIntegration: false,
    },
  });
  const ua = chromeUA(popup.webContents.getUserAgent());
  popup.webContents.setUserAgent(ua);
  let sawExternal = false;
  let guided = false;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  const onNav = (u: string) => {
    // The instant the flow touches Google (directly, or via a D&D Beyond → Google redirect), bail
    // out and guide to email login — before the block page ever renders.
    if (!guided && isGoogleAuth(u)) {
      guided = true;
      if (!popup.isDestroyed()) popup.close();
      void guideToEmailLogin(spawningView);
      return;
    }
    let h = "";
    try { h = new URL(u).host.toLowerCase(); } catch { return; }
    const home = /(^|\.)dndbeyond\.com$/.test(h) || /(^|\.)roll20\.net$/.test(h);
    if (!home) {
      sawExternal = true; // at the identity provider — keep the popup open
      if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
    } else if (sawExternal) {
      // Back on the app's own site: let the OAuth callback finish writing cookies, then close.
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = setTimeout(() => { if (!popup.isDestroyed()) popup.close(); }, 1500);
    }
  };
  popup.webContents.on("will-redirect", (_e, u) => onNav(u));
  popup.webContents.on("will-navigate", (_e, u) => onNav(u));
  popup.webContents.on("did-navigate", (_e, u) => onNav(u));
  // Nested popups (rare) reuse the same in-app treatment.
  popup.webContents.setWindowOpenHandler(({ url: u }) => {
    if (isAuthPopup(u)) openAuthPopup(u, spawningView);
    else shell.openExternal(u).catch(() => {});
    return { action: "deny" };
  });
  popup.on("closed", () => { if (!guided) spawningView.webContents.reload(); }); // pick up the new session
  popup.loadURL(url, { userAgent: ua });
}

// A controlled, minimal context menu for OUR OWN UI panes (sheet + splash). We deliberately do
// NOT attach this to the remote Roll20/DDB panes — those sites drive their own right-click menus
// (e.g. Roll20's token menu), and a native popup would clash with them. "Inspect Element" is
// exposed ONLY in development builds, so packaged apps can't open DevTools on our renderer.
function installContextMenu(view: WebContentsView) {
  const wc = view.webContents;
  wc.on("context-menu", (_e, params) => {
    const items: MenuItemConstructorOptions[] = [];
    const ef = params.editFlags;

    // Spellcheck fixes first, when right-clicking a misspelled word in an editable field.
    if (params.isEditable && params.misspelledWord && params.dictionarySuggestions.length) {
      for (const s of params.dictionarySuggestions.slice(0, 5)) items.push({ label: s, click: () => wc.replaceMisspelling(s) });
      items.push({ type: "separator" });
    }
    if (params.linkURL) {
      items.push(
        { label: "Copy Link", click: () => clipboard.writeText(params.linkURL) },
        { label: "Open Link in Browser", click: () => shell.openExternal(params.linkURL).catch(() => {}) },
        { type: "separator" },
      );
    }
    if (params.isEditable) {
      items.push(
        { label: "Cut", role: "cut", enabled: ef.canCut },
        { label: "Copy", role: "copy", enabled: ef.canCopy },
        { label: "Paste", role: "paste", enabled: ef.canPaste },
        { type: "separator" },
        { label: "Select All", role: "selectAll" },
      );
    } else if (params.selectionText) {
      items.push({ label: "Copy", role: "copy", enabled: ef.canCopy });
    }
    // Dev-only escape hatch — never present in a packaged/production build.
    if (!app.isPackaged) {
      if (items.length) items.push({ type: "separator" });
      items.push({ label: "Inspect Element", click: () => wc.inspectElement(params.x, params.y) });
    }
    if (!items.length) return; // nothing actionable → show no menu at all
    Menu.buildFromTemplate(items).popup({ window: win });
  });
}

function hardenView(view: WebContentsView, opts: { externalLinks?: boolean; lockToFile?: boolean; ownUi?: boolean }) {
  const wc = view.webContents;
  if (opts.ownUi) installContextMenu(view); // controlled menu on our panes only
  wc.setWindowOpenHandler(({ url }) => {
    // Sign-in popups stay in-app (shared session); other links open in the system browser.
    if (!opts.lockToFile && isAuthPopup(url)) { openAuthPopup(url, view); return { action: "deny" }; }
    if (opts.externalLinks && /^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });
  wc.on("will-navigate", (e, url) => {
    if (opts.lockToFile) { if (!url.startsWith("file://")) e.preventDefault(); return; }
    let proto = "";
    try { proto = new URL(url).protocol; } catch { e.preventDefault(); return; }
    if (proto !== "http:" && proto !== "https:") e.preventDefault(); // block javascript:/data:/file:/...
  });
}

function createWindow() {
  win = new BaseWindow({ width: 1500, height: 950, title: `Conduit v${app.getVersion()}` });
  // Packaged builds carry the Conduit icon via electron-builder; an unpackaged `electron .` run shows
  // the default Electron icon, so set the dock icon by hand in dev (macOS) from build/icon.png.
  if (!app.isPackaged && process.platform === "darwin") {
    try { app.dock?.setIcon(join(__dirname, "..", "build", "icon.png")); } catch { /* dev cosmetic only */ }
  }

  const partition = setupPersistentSession();
  // Remote panes: explicit hardening (don't rely on Electron defaults) — sandboxed, isolated,
  // no Node, web security on, and NO preload, so a compromised remote page can't reach our IPC.
  const remotePrefs = { partition, sandbox: true, contextIsolation: true, nodeIntegration: false, webSecurity: true };
  roll20View = new WebContentsView({ webPreferences: remotePrefs });
  ddbView = new WebContentsView({ webPreferences: remotePrefs });
  sheetView = new WebContentsView({
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true, // the preload uses only contextBridge/ipcRenderer, which work sandboxed
    },
  });
  hardenView(roll20View, { externalLinks: true });
  hardenView(ddbView, { externalLinks: true });
  hardenView(sheetView, { externalLinks: true, lockToFile: true, ownUi: true });

  // The inactive pane is sized 0×0 (see layout()); Chromium would otherwise throttle its
  // timers/React re-render when hidden, making slot write-backs to the background DDB pane
  // flaky. Keep both live panes running at full speed.
  roll20View.webContents.setBackgroundThrottling(false);
  ddbView.webContents.setBackgroundThrottling(false);

  // Splash: a full-window chooser (character source | VTT) shown before the panes.
  splashView = new WebContentsView({
    webPreferences: { preload: join(__dirname, "preload.cjs"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  hardenView(splashView, { externalLinks: true, lockToFile: true, ownUi: true });

  win.contentView.addChildView(ddbView); // bottom of the right stack
  win.contentView.addChildView(roll20View); // active by default (rightMode = 'roll20')
  win.contentView.addChildView(sheetView); // left pane
  win.contentView.addChildView(splashView); // on top until the user launches
  layout();
  win.on("resize", layout);

  // The VTT can warm up behind the splash; the character-source pane and the sheet UI load at
  // launch (they depend on whether you picked D&D Beyond or poke5e).
  roll20View.webContents.loadURL("https://app.roll20.net/");
  splashView.webContents.loadFile(join(__dirname, "splash.html"));

  // Continuously capture rolls into the persistent store so nothing is lost past Roll20's buffer.
  setInterval(captureLoop, 25000);
}

/** The splash's "Enter the table" button: record the chosen source/VTT, load the source pane,
 *  then reveal the three-pane layout. */
ipcMain.handle("launch-app", (_e, config: { source: string; vtt: string }) => {
  activeSource = config?.source === "poke5e" ? "poke5e" : config?.source === "monster" ? "monster" : "ddb";
  // (Roll20 is the only VTT for now; activeVtt stays "roll20".)
  const paneUrl =
    activeSource === "poke5e" ? "https://poke5e.app/" : activeSource === "monster" ? "https://open5e.com/" : "https://www.dndbeyond.com/";
  ddbView.webContents.loadURL(paneUrl);
  // Load the sheet UI now that the source is known, so its init reads the right config.
  sheetView.webContents.loadFile(join(__dirname, "sheet.html"));
  launched = true;
  win.contentView.removeChildView(splashView); // reveal the panes
  layout();
  raiseRightPane();
  return { ok: true };
});

/** Let the sheet renderer learn which source/VTT the user chose on the splash. */
ipcMain.handle("get-config", () => ({ source: activeSource, vtt: activeVtt }));

/** Return to the splash to pick a different character source / VTT. */
ipcMain.handle("show-splash", () => {
  launched = false;
  win.contentView.addChildView(splashView); // back on top of the panes
  splashView.webContents.reload(); // fresh selection
  layout();
  return { ok: true };
});

/** Monster/NPC search + load via the free Open5e API (read-only; HP tracked locally). */
ipcMain.handle("search-monsters", async (_e, query: string) => {
  try {
    return { ok: true, results: await searchMonsters(query) };
  } catch (err) {
    return { ok: false, error: String(err), results: [] };
  }
});
/** D&D Beyond monster search + load (your owned Monster Manual etc.; SRD when not signed in). */
ipcMain.handle("search-ddb-monsters", async (_e, query: string) => {
  try {
    const token = await mintDdbToken();
    return { ok: true, results: await searchDdbMonsters(token, query) };
  } catch (err) {
    return { ok: false, error: String(err), results: [] };
  }
});
ipcMain.handle("load-ddb-monster", async (_e, id: string) => {
  try {
    const token = await mintDdbToken();
    const m = await fetchDdbMonster(token, id);
    if (!m) return { ok: false, error: "Monster not found" };
    const { model, hp, weapons, ac } = ddbMonsterToCharacter(m);
    current = { data: {} as CharacterData, name: model.name, id, model };
    return {
      ok: true, model, hp, weapons, spellcasting: null, spellSlots: [], hitDice: null,
      inventory: [], conditions: [], defenses: { resist: [], immune: [], vulnerable: [] }, writable: false, ac,
    };
  } catch (err) {
    return { ok: false, error: "Couldn't reach D&D Beyond monsters: " + String(err) };
  }
});

ipcMain.handle("load-monster", async (_e, slug: string) => {
  try {
    const m = await fetchMonster(slug);
    if (!m) return { ok: false, error: "Monster not found" };
    const { model, hp, weapons } = monsterToCharacter(m);
    current = { data: {} as CharacterData, name: model.name, id: slug, model };
    return {
      ok: true,
      model,
      hp,
      weapons,
      spellcasting: null,
      spellSlots: [],
      hitDice: null,
      inventory: [],
      conditions: [],
      defenses: { resist: [], immune: [], vulnerable: [] },
      writable: false, // monsters never write back — HP is a local session value
      ac: typeof (m as any).armor_class === "number" ? (m as any).armor_class : undefined,
    };
  } catch (err) {
    return { ok: false, error: "Couldn't reach Open5e: " + String(err) };
  }
});

/** Load a poke5e trainer from a pasted share link or read key. Read-only; no auth needed. */
/** Auto-discover the user's poke5e trainers from the poke5e pane's own localStorage (the site
 *  keeps a comma-separated list of read keys under "trainers"), so they get a picker instead of
 *  pasting a link — like the D&D Beyond character list. */
// Reload the poke5e web pane (right side) so its own trainer list re-renders — e.g. after a trainer
// is deleted elsewhere. Awaits the page load (with a safety timeout) so a follow-up list read is fresh.
ipcMain.handle("poke5e-reload-pane", async () => {
  try {
    const wc = ddbView?.webContents;
    if (!wc || !(wc.getURL?.() || "").includes("poke5e.app")) return { ok: false };
    await new Promise<void>((resolve) => {
      const done = () => { try { wc.off("did-finish-load", done); } catch { /* ignore */ } resolve(); };
      wc.once("did-finish-load", done);
      wc.reload();
      setTimeout(done, 6000); // don't hang if the load stalls
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle("list-poke5e-trainers", async (_e, extraKeys: string[] = []) => {
  try {
    const raw: string = await ddbView.webContents
      .executeJavaScript(`(function(){try{return localStorage.getItem("trainers")||"";}catch(e){return "";}})()`, true)
      .catch(() => "");
    // Union of poke5e's own local list and any keys the app itself has remembered.
    const keys = [...new Set([...String(raw).split(","), ...(extraKeys ?? [])].map((s) => s.trim()).filter(Boolean))];
    if (!keys.length) return { ok: true, trainers: [] as any[] };
    const trainers: { readKey: string; name: string; level: number }[] = [];
    for (const key of keys.slice(0, 40)) {
      const row = await fetchTrainer(key).catch(() => null);
      if (row) trainers.push({ readKey: key, name: row.name || "Trainer", level: Number(row.level) || 0 });
    }
    return { ok: true, trainers };
  } catch (err) {
    return { ok: false, trainers: [], error: String(err) };
  }
});

/** GM view: every remembered trainer WITH its team and write-access, for the grouped roster
 *  switcher. poke5e has no campaign concept, so "the GM's party" is just the union of trainers the
 *  user has loaded/opened (poke5e's own list + the app's remembered keys). */
ipcMain.handle("poke5e-gm-roster", async (_e, extraKeys: string[] = []) => {
  try {
    const raw: string = await ddbView.webContents
      .executeJavaScript(`(function(){try{return localStorage.getItem("trainers")||"";}catch(e){return "";}})()`, true)
      .catch(() => "");
    const keys = [...new Set([...String(raw).split(","), ...(extraKeys ?? [])].map((s) => s.trim()).filter(Boolean))].slice(0, 40);
    const trainers: any[] = [];
    for (const key of keys) {
      const row = await fetchTrainer(key).catch(() => null);
      if (!row) continue;
      const [team, wk] = await Promise.all([
        fetchPokemon((row as any).id).catch(() => []),
        ddbView.webContents
          .executeJavaScript(`(function(){try{return localStorage.getItem("write:"+${JSON.stringify(key)})||"";}catch(e){return "";}})()`, true)
          .catch(() => ""),
      ]);
      trainers.push({
        readKey: key,
        name: (row as any).name || "Trainer",
        writable: !!wk,
        team: (Array.isArray(team) ? team : []).map((p: any) => ({
          id: p.id,
          name: (p.nickname && String(p.nickname).trim()) || p.species || "Pokémon",
        })),
      });
    }
    return { ok: true, trainers };
  } catch (err) {
    return { ok: false, trainers: [], error: String(err) };
  }
});

/** Write HP back to poke5e (trainer or the active Pokémon) via a full-row upsert with the write key. */
ipcMain.handle("poke5e-set-hp", async (_e, curHp: number, maxHp: number) => {
  if (!poke5eCtx?.writeKey || !current) return { ok: false, error: "This trainer is read-only (no write key)" };
  try {
    if (String(current.id).startsWith("pmon:")) {
      const pid = Number(String(current.id).slice(5));
      const pk = poke5eCtx.team.get(pid);
      if (!pk) return { ok: false, error: "Pokémon not loaded" };
      const ok = await updatePokemonHp(poke5eCtx.writeKey, pk, curHp, maxHp);
      if (ok) { pk.hp_cur = curHp; pk.hp_max = maxHp; schedulePoke5ePaneRefresh(); }
      return ok ? { ok: true } : { ok: false, error: "poke5e rejected the write (check your write key)" };
    }
    const ok = await updateTrainerHp(poke5eCtx.writeKey, poke5eCtx.trainerRow, curHp, maxHp);
    if (ok) { poke5eCtx.trainerRow.hp_cur = curHp; poke5eCtx.trainerRow.hp_max = maxHp; schedulePoke5ePaneRefresh(); }
    return ok ? { ok: true } : { ok: false, error: "poke5e rejected the write (check your write key)" };
  } catch (err) {
    return { ok: false, error: "Couldn't reach poke5e: " + String(err) };
  }
});

/** Write a Pokémon move's remaining PP back to poke5e (targeted update_move; needs write key). */
ipcMain.handle("poke5e-set-pp", async (_e, learnedId: number, moveId: string, ppCur: number, ppMax: number, notes?: string) => {
  if (!poke5eCtx?.writeKey) return { ok: false, error: "read-only" };
  try {
    // Pass the move's existing notes through — update_move upserts notes too, so omitting them would blank the field.
    const ok = await updateMovePp(poke5eCtx.writeKey, learnedId, moveId, ppCur, ppMax, notes ?? "");
    if (ok) schedulePoke5ePaneRefresh();
    return ok ? { ok: true } : { ok: false, error: "poke5e rejected the PP write" };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

/** Surface the loaded trainer's own poke5e keys so the user can back them up (the write key is a
 *  secret only cached in the poke5e pane's localStorage; there's no way to regenerate it if lost). */
ipcMain.handle("poke5e-keys", async () => {
  if (!poke5eCtx) return { ok: false, error: "Load a trainer first" };
  return {
    ok: true,
    name: poke5eCtx.trainerRow?.name || "Trainer",
    readKey: poke5eCtx.readKey,
    writeKey: poke5eCtx.writeKey || "", // empty = trainer was loaded read-only (no write key cached)
  };
});

/** Load one of the trainer's Pokémon (from the cached team) with its moves as rollable "spells". */
ipcMain.handle("load-poke5e-pokemon", async (_e, pokemonId: number) => {
  if (!poke5eCtx) return { ok: false, error: "Load your trainer first" };
  const pk = poke5eCtx.team.get(Number(pokemonId));
  if (!pk) return { ok: false, error: "Pokémon not found on this trainer" };
  try {
    const [moveset, moves, abilities, pfeats] = await Promise.all([
      fetchMoveset(Number(pokemonId)),
      movesMap(),
      resolveAbilities(pk),
      fetchPokemonFeats(Number(pokemonId)),
    ]);
    const featNames = (Array.isArray(pfeats) ? pfeats : []).map((f: any) => f.name).filter(Boolean);
    // Speed lives on the SPECIES (pokemon.json), not the pokémon row — look it up from the dex.
    const speciesSpeeds = (await ensurePokedex().catch(() => [] as DexEntry[])).find((e) => e.id === String(pk.species))?.speedModes ?? [];
    const { model, hp, spellcasting } = pokemonToCharacter(pk, moveset, moves, featNames, speciesSpeeds);
    current = { data: {} as CharacterData, name: model.name, id: `pmon:${pokemonId}`, model };
    // A Pokémon's "feats" section = its passive abilities (Blaze, …) plus any Pokémon feats.
    const feats = [...abilities, ...pfeats];
    // Pokémon-wide passives (resist/immunity/AC/form/…) surfaced as live, condition-lit reminders.
    const passives = passiveAbilityEffects(abilityIds(pk));
    return {
      ok: true, model, hp, weapons: [], spellcasting, spellSlots: [], hitDice: null,
      inventory: [], conditions: [], defenses: { resist: [], immune: [], vulnerable: [] }, writable: !!poke5eCtx.writeKey,
      ac: typeof pk.ac === "number" ? pk.ac : undefined,
      feats, passives,
      poke: pokemonMeta(pk),
    };
  } catch (err) {
    return { ok: false, error: "Couldn't load Pokémon: " + String(err) };
  }
});

ipcMain.handle("load-poke5e", async (_e, input: string) => {
  const key = extractReadKey(input);
  if (!key) return { ok: false, error: "Paste your poke5e share link or read key" };
  try {
    const row = await fetchTrainer(key);
    if (!row) return { ok: false, error: "No trainer found for that link/key — check it and try again" };
    const { model, hp } = trainerToRollModel(row);
    current = { data: {} as CharacterData, name: model.name, id: key, model };
    const [inventory, trainerFeats, team] = await Promise.all([
      buildInventory(key).catch(() => []),
      fetchTrainerFeats(key).catch(() => []),
      fetchPokemon((row as any).id).catch(() => []),
    ]);
    // Surface the trainer's Path + Specialisation(s) (read off the trainer row) ahead of their feats.
    const feats = [...trainerExtras(row), ...trainerFeats];
    // The write key poke5e stores locally ("write:<readKey>") — presence = we can save back.
    const writeKey: string = await ddbView.webContents
      .executeJavaScript(`(function(){try{return localStorage.getItem("write:"+${JSON.stringify(key)})||"";}catch(e){return "";}})()`, true)
      .catch(() => "");
    // Cache the team + trainer row so switching / write-back doesn't re-fetch the whole trainer.
    poke5eCtx = { readKey: key, trainerId: (row as any).id, trainerRow: row, team: new Map(team.map((p: any) => [p.id, p])), writeKey };
    // Roster: the Trainer plus each Pokémon, as switchable chips (like GM-mode).
    const roster = [
      { ref: key, name: model.name, mine: true },
      ...team.map((p: any) => ({ ref: `pmon:${p.id}`, name: (p.nickname && String(p.nickname).trim()) || p.species || "Pokémon", mine: true })),
    ];
    return {
      ok: true,
      model,
      hp,
      weapons: [],
      spellcasting: null,
      spellSlots: [],
      hitDice: null,
      inventory,
      conditions: [],
      defenses: { resist: [], immune: [], vulnerable: [] },
      writable: !!writeKey, // read/write if we hold this trainer's write key, else read-only
      ac: typeof (row as any).ac === "number" ? (row as any).ac : undefined,
      readKey: key, // resolved key, so the app can remember it for the auto-load picker
      feats,
      roster,
    };
  } catch (err) {
    return { ok: false, error: "Couldn't reach poke5e: " + String(err) };
  }
});

// ---- IPC: character loading + rolling --------------------------------------

ipcMain.handle("load-character", async (_e, id: string) => {
  try {
    const cleanId = String(id).trim().match(/\d+/)?.[0];
    if (!cleanId) return { ok: false, error: "Enter a numeric character ID" };

    let data: CharacterData | null = null;
    // Prefer the authenticated DDB pane — this works for PRIVATE characters too (the plain,
    // unauthenticated endpoint 403s on private sheets even for the owner).
    try {
      const authed: any = await ddbView.webContents.executeJavaScript(ddbFetchCharExpr(cleanId), true);
      if (authed?.ok && authed.data) data = authed.data as CharacterData;
    } catch { /* DDB pane not ready — fall back below */ }
    // Fallback: the public unauthenticated endpoint (public characters, or DDB not signed in).
    if (!data) {
      const res = await fetch(`https://character-service.dndbeyond.com/character/v5/character/${cleanId}`);
      if (res.ok) {
        const json: any = await res.json();
        if (json?.success && json?.data) data = json.data as CharacterData;
      }
    }
    if (!data) {
      return { ok: false, error: "Couldn't load this character. If it's private, open the D&D Beyond pane and make sure you're signed in, then try again." };
    }
    // Point the embedded DDB sheet at this character so slot writes hit the right sheet.
    ddbView.webContents.loadURL(`https://www.dndbeyond.com/characters/${cleanId}`);
    const character = buildCharacter(data);
    current = { data, name: data.name, id: cleanId, model: character.model };
    // Writable only if the signed-in user OWNS this character; a public/other's sheet loads
    // read-only (play with it, track HP locally, but never write back).
    const uid = await ddbUserId();
    const ownerId = (data as any).userId;
    const writable = !!uid && ownerId != null && String(ownerId) === uid;
    // The character sheet carries its whole campaign roster — expose it for GM-mode's switcher.
    const camp = (data as any).campaign;
    const campaign = camp
      ? {
          id: camp.id,
          name: camp.name,
          dmUserId: camp.dmUserId,
          characters: (camp.characters ?? []).map((c: any) => ({
            characterId: c.characterId,
            characterName: c.characterName,
            avatarUrl: c.avatarUrl,
            userId: c.userId,
            privacyType: c.privacyType,
          })),
        }
      : null;
    return { ok: true, model: character.model, weapons: character.weapons, spellcasting: character.spellcasting, spellSlots: character.spellSlots, hitDice: character.hitDice, inventory: character.inventory, hp: character.hp, conditions: character.conditions, defenses: character.defenses, writable, campaign, userId: uid };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

ipcMain.handle("list-toggles", async (_e, request: RollRequest) => {
  if (!current || !(current.data as { stats?: unknown }).stats) return []; // non-DDB sources have no rule toggles
  return availableToggles(current.data, request).map((r) => ({ id: r.id, name: r.name }));
});

ipcMain.handle("roll", async (_e, request: RollRequest, enabledToggleIds: string[]) => {
  if (!current) return { ok: false, error: "No character loaded" };
  const { command, request: merged } = rollFrom(current.data, request, enabledToggleIds ?? [], current.model);
  const expr = buildSendExpression(command, merged.speakingAs);
  let injected: any;
  try {
    injected = await roll20View.webContents.executeJavaScript(expr, true);
  } catch (err) {
    injected = { ok: false, error: String(err) };
  }
  // Only record the action once it actually reached Roll20 — don't log rolls that never sent.
  if (injected?.ok) {
    actionLog.push({ at: Date.now(), character: merged.speakingAs, name: request.key ?? request.kind, command });
    saveStoreSoon();
  }
  return { ok: injected?.ok === true, command, injected };
});

// ---- IPC: D&D Beyond slot sync (drives the real sheet, writes back to DDB) --------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ddbExec(method: "ensureSpellsTab" | "read" | "spend" | "restore" | "restoreAll" | "loggedIn", arg?: number) {
  return ddbView.webContents.executeJavaScript(ddbSlotsExpr(method, arg), true);
}

/** Ensure the DDB Spells tab is rendered (its slot managers exist), retrying briefly. */
async function ensureSlots(): Promise<boolean> {
  for (let i = 0; i < 8; i++) {
    const ready = await ddbExec("ensureSpellsTab").catch(() => false);
    if (ready) return true;
    await sleep(500);
  }
  return false;
}

/** Read the current used-slot count for a level (or 0 if that level isn't present). */
function usedAt(slots: any[], level: number): number {
  const s = (slots || []).find((x: any) => x.level === level);
  return s ? s.used : 0;
}

/** Poll read() up to `tries`×`waitMs` until `done(slots)` holds, then return the last read.
 *  A background DDB pane can lag its React re-render, so we can't trust a single fixed sleep. */
async function pollRead(done: (slots: any[]) => boolean, tries = 5, waitMs = 400): Promise<any[]> {
  let slots = await ddbExec("read").catch(() => []);
  for (let i = 0; i < tries && !done(slots); i++) {
    await sleep(waitMs);
    slots = await ddbExec("read").catch(() => []);
  }
  return slots;
}

// ---- Authenticated D&D Beyond requests from the MAIN process ---------------------------------
// Uses net.request with the shared session's cookies + the short-lived cobalt→JWT. This is
// decoupled from the ddbView page state, so it never breaks when that pane reloads/navigates
// (unlike executeJavaScript-in-the-pane writes) and it works for PRIVATE characters too.

/** The signed-in D&D Beyond user id (from the cobalt→JWT's nameidentifier claim), or null. */
async function ddbUserId(): Promise<string | null> {
  const token = await mintDdbToken();
  if (!token) return null;
  try {
    const p = JSON.parse(Buffer.from(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    const uid = p["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier"] || p.sub;
    return uid ? String(uid) : null;
  } catch {
    return null;
  }
}

function mintDdbToken(): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (t: string | null) => { if (!done) { done = true; resolve(t); } };
    try {
      const req = net.request({ method: "POST", url: "https://auth-service.dndbeyond.com/v1/cobalt-token", session: session.fromPartition("persist:main"), useSessionCookies: true });
      let body = "";
      req.on("response", (r) => { r.on("data", (c) => (body += c.toString())); r.on("end", () => { try { finish(JSON.parse(body).token || null); } catch { finish(null); } }); });
      req.on("error", () => finish(null));
      setTimeout(() => finish(null), 6000);
      req.end();
    } catch { finish(null); }
  });
}

function ddbApiRequest(method: string, url: string, token: string, body?: unknown): Promise<{ ok: boolean; status: number; json: any; error?: string }> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: { ok: boolean; status: number; json: any; error?: string }) => { if (!done) { done = true; resolve(v); } };
    try {
      const req = net.request({ method, url, session: session.fromPartition("persist:main"), useSessionCookies: true });
      req.setHeader("Authorization", "Bearer " + token);
      if (body !== undefined) req.setHeader("Content-Type", "application/json");
      let buf = "";
      req.on("response", (r) => {
        r.on("data", (c) => (buf += c.toString()));
        r.on("end", () => { let j: any = null; try { j = JSON.parse(buf); } catch { /* non-JSON */ } finish({ ok: r.statusCode! >= 200 && r.statusCode! < 300 && (j?.success ?? true), status: r.statusCode!, json: j }); });
      });
      req.on("error", (e) => finish({ ok: false, status: 0, json: null, error: String(e) }));
      setTimeout(() => finish({ ok: false, status: 0, json: null, error: "timeout" }), 8000);
      if (body !== undefined) req.write(JSON.stringify(body));
      req.end();
    } catch (e) { finish({ ok: false, status: 0, json: null, error: String(e) }); }
  });
}

ipcMain.handle("set-right-pane", (_e, mode: "roll20" | "ddb") => {
  rightMode = mode === "ddb" ? "ddb" : "roll20";
  layout();
  raiseRightPane();
  return { mode: rightMode };
});

ipcMain.handle("ddb-status", async () => {
  const loggedIn = await ddbExec("loggedIn").catch(() => false);
  return { loggedIn: !!loggedIn };
});

/** Reliable "signed in to D&D Beyond?" check. Runs in the MAIN process against the shared
 *  session's cookies (net.request + useSessionCookies), so it does NOT depend on the DDB pane
 *  having finished navigating/rendering — a slow character load can't make it miss or hang. */
ipcMain.handle("ddb-auth", async () => {
  return new Promise<{ authed: boolean }>((resolve) => {
    let done = false;
    const finish = (authed: boolean) => { if (!done) { done = true; resolve({ authed }); } };
    try {
      const req = net.request({
        method: "POST",
        url: "https://auth-service.dndbeyond.com/v1/cobalt-token",
        session: session.fromPartition("persist:main"),
        useSessionCookies: true,
      });
      let body = "";
      req.on("response", (r) => {
        r.on("data", (c) => (body += c.toString()));
        r.on("end", () => {
          try { finish(r.statusCode === 200 && !!JSON.parse(body).token); }
          catch { finish(r.statusCode === 200); }
        });
      });
      req.on("error", () => finish(false));
      setTimeout(() => finish(false), 6000); // never hang the chip
      req.end();
    } catch {
      finish(false);
    }
  });
});

ipcMain.handle("ddb-sync", async () => {
  const ok = await ensureSlots();
  if (!ok) return { ok: false, slots: [] };
  const slots = await ddbExec("read").catch(() => []);
  return { ok: true, slots };
});

// Gentle read-only poll — does NOT click tabs; returns [] if the spell managers aren't
// currently rendered (e.g. user navigated the DDB pane elsewhere), so it never disrupts.
ipcMain.handle("ddb-peek", async () => {
  const slots = await ddbExec("read").catch(() => []);
  return { slots };
});

ipcMain.handle("ddb-spend", async (_e, level: number) => {
  if (!(await ensureSlots())) return { ok: false, error: "DDB sheet not ready — open the D&D Beyond pane and sign in" };
  const before = await ddbExec("read").catch(() => []);
  const prevUsed = usedAt(before, level);
  const res = await ddbExec("spend", level).catch((e) => ({ ok: false, error: String(e) }));
  // Only wait for a change when we actually clicked a slot; otherwise a single read is enough.
  const slots = res && (res as any).ok
    ? await pollRead((s) => usedAt(s, level) > prevUsed)
    : await ddbExec("read").catch(() => []);
  return { ...res, slots };
});

ipcMain.handle("ddb-restore", async (_e, level: number) => {
  if (!(await ensureSlots())) return { ok: false, error: "DDB sheet not ready" };
  const before = await ddbExec("read").catch(() => []);
  const prevUsed = usedAt(before, level);
  const res = await ddbExec("restore", level).catch((e) => ({ ok: false, error: String(e) }));
  const slots = res && (res as any).ok
    ? await pollRead((s) => usedAt(s, level) < prevUsed)
    : await ddbExec("read").catch(() => []);
  return { ...res, slots };
});

ipcMain.handle("ddb-restore-all", async () => {
  if (!(await ensureSlots())) return { ok: false, slots: [] };
  await ddbExec("restoreAll").catch(() => ({}));
  // Restore-all clears every used slot; wait until the re-render shows them all free.
  const slots = await pollRead((s) => (s || []).every((x: any) => x.used === 0));
  return { ok: true, slots };
});

// ---- IPC: D&D Beyond hit-dice / short rest (Short Rest sidebar; stage -> commit) ----------

async function ddbHd(method: "open" | "isOpen" | "read" | "stage" | "commit" | "reset" | "loggedIn", a1?: number | null, a2?: number) {
  return ddbView.webContents.executeJavaScript(ddbHitDiceExpr(method, a1, a2), true);
}

/** Ensure the Short Rest sidebar (its hit-dice pane) is rendered, retrying briefly. */
async function ensureShortRest(): Promise<boolean> {
  for (let i = 0; i < 10; i++) {
    const open = await ddbHd("open").catch(() => false);
    if (open) return true;
    await sleep(400);
  }
  return false;
}

/** Read hit-dice pools from the Short Rest pane (opens it if needed). */
ipcMain.handle("ddb-hd-read", async () => {
  if (!(await ensureShortRest())) return { ok: false, pools: [] };
  const pools = await ddbHd("read").catch(() => []);
  return { ok: true, pools };
});

/** Stage `count` spent dice (die size optional) WITHOUT committing — for previewing. */
ipcMain.handle("ddb-hd-stage", async (_e, count: number, die?: number) => {
  if (!(await ensureShortRest())) return { ok: false, error: "Short Rest pane not ready — open the D&D Beyond pane and sign in" };
  const res = await ddbHd("stage", die ?? null, count).catch((e) => ({ ok: false, error: String(e) }));
  const pools = await ddbHd("read").catch(() => []);
  return { ...res, pools };
});

/** Revert any staged spend (no server change). */
ipcMain.handle("ddb-hd-reset", async () => {
  const res = await ddbHd("reset").catch((e) => ({ ok: false, error: String(e) }));
  const pools = await ddbHd("read").catch(() => []);
  return { ...res, pools };
});

/** Full short-rest spend driver: open -> stage `count` dice -> commit (persists
 *  hitDiceUsed and applies the short-rest healing on D&D Beyond). This is a real,
 *  user-initiated mutation of the live sheet — only ever runs on an explicit click. */
ipcMain.handle("ddb-short-rest", async (_e, count: number, die?: number) => {
  if (!(await ensureShortRest())) return { ok: false, error: "Short Rest pane not ready — open the D&D Beyond pane and sign in" };
  if (count > 0) {
    const staged = await ddbHd("stage", die ?? null, count).catch((e) => ({ ok: false, error: String(e) }));
    if (!staged || !(staged as any).ok) {
      await ddbHd("reset").catch(() => ({}));
      return { ok: false, error: `could only stage ${(staged as any)?.staged ?? 0}/${count} hit dice` };
    }
  }
  const res = await ddbHd("commit").catch((e) => ({ ok: false, error: String(e) }));
  await sleep(700);
  // After committing, the pane closes; re-open read-only to report the persisted state.
  const pools = (await ensureShortRest()) ? await ddbHd("read").catch(() => []) : [];
  return { ...res, pools };
});

// ---- IPC: inventory (quantity write-back via DDB's own API; add/search via native UI) ----

/** Set one inventory row's quantity on D&D Beyond (drives the real endpoint the sheet uses),
 *  then CONFIRM the write landed by re-reading the row from character-service — so a write can
 *  never silently no-op (e.g. a stale row id). Returns the server-confirmed quantity. */
ipcMain.handle("ddb-item-set-qty", async (_e, id: number, quantity: number) => {
  if (!current) return { ok: false, error: "No character loaded" };
  const q = Math.max(0, Math.floor(quantity));
  const res: any = await ddbView.webContents
    .executeJavaScript(ddbInventoryExpr("setQuantity", Number(current.id), id, q), true)
    .catch((err) => ({ ok: false, error: String(err) }));
  if (!res || !res.ok) return res;
  // Verify against the source of truth (character-service reflects writes immediately, uncached).
  try {
    const r = await fetch(`https://character-service.dndbeyond.com/character/v5/character/${current.id}`);
    const j: any = await r.json();
    const row = (j?.data?.inventory ?? []).find((x: any) => x.id === id);
    if (j?.data) current = { ...current, data: j.data as CharacterData };
    if (!row) return { ok: false, stale: true, error: "Item not on D&D Beyond anymore — re-syncing" };
    if (row.quantity !== q) return { ok: false, error: `D&D Beyond kept quantity at ${row.quantity}`, quantity: row.quantity };
    scheduleDdbReload(); // the embedded DDB sheet's React view won't reflect an API write until it re-fetches
    return { ok: true, quantity: row.quantity, confirmed: true };
  } catch {
    scheduleDdbReload();
    return res; // driver said ok; couldn't double-check — trust the 200
  }
});

// A direct character-service write updates DDB's server but not the open sheet's in-memory
// React state, so the embedded DDB pane shows stale quantities until it re-fetches. Reload it
// (debounced, so a burst of ± clicks triggers a single reload) to keep the pane in sync.
let ddbReloadTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleDdbReload() {
  if (ddbReloadTimer) clearTimeout(ddbReloadTimer);
  ddbReloadTimer = setTimeout(() => {
    ddbReloadTimer = null;
    if (current) ddbView.webContents.reload();
  }, 1500);
}

/** List the logged-in user's own D&D Beyond characters (for the picker). Read-only.
 *  Runs entirely in the MAIN process against the shared session's cookies (the same
 *  proven path as HP/condition writes), so it does NOT depend on the DDB pane having
 *  navigated to a dndbeyond.com page — which is why it was failing after loading a
 *  character sheet or on a fresh machine. */
ipcMain.handle("list-characters", async () => {
  try {
    const token = await mintDdbToken();
    if (!token) return { ok: false, error: "Not signed in to D&D Beyond", characters: [] };
    // Derive the user id from the cobalt→JWT's nameidentifier claim.
    let uid: string | undefined;
    try {
      const payload = JSON.parse(
        Buffer.from(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"),
      );
      uid = payload["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier"] || payload.sub;
    } catch { /* malformed token */ }
    if (!uid) return { ok: false, error: "Could not determine your D&D Beyond user id", characters: [] };
    const r = await ddbApiRequest(
      "GET",
      `https://character-service.dndbeyond.com/character/v5/characters/list?userId=${encodeURIComponent(String(uid))}`,
      token,
    );
    if (!r.ok) return { ok: false, error: `Character list HTTP ${r.status}`, characters: [] };
    const characters = ((r.json?.data?.characters ?? []) as any[])
      .map((c) => ({
        id: c.id,
        name: c.name || "Character " + c.id,
        level: c.level || 0,
        classDescription: c.classDescription || "",
        raceName: c.raceName || "",
        campaignName: c.campaignName || "",
        lastModified: c.lastModifiedDate || "",
      }))
      .sort((a, b) => String(b.lastModified).localeCompare(String(a.lastModified)));
    return { ok: true, characters };
  } catch (err) {
    return { ok: false, error: String(err), characters: [] };
  }
});

/** Sign out: wipe the shared session (cookies + storage + cache) so the next launch
 *  behaves like a fresh install. Reloads both panes back to their signed-out landing
 *  pages. Handy for testing the first-run experience without a clean profile. */
ipcMain.handle("logout", async () => {
  try {
    const s = session.fromPartition("persist:main");
    await s.clearStorageData(); // cookies, localStorage, IndexedDB, service workers, cache…
    await s.clearCache();
    current = null;
    roll20View?.webContents.loadURL("https://app.roll20.net/");
    ddbView?.webContents.loadURL("https://www.dndbeyond.com/");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

/** Re-fetch the character and recompute the inventory (reflects DDB-side add/edit/use). */
ipcMain.handle("inventory-refresh", async () => {
  if (!current) return { ok: false, items: [] };
  try {
    const res = await fetch(`https://character-service.dndbeyond.com/character/v5/character/${current.id}`);
    if (!res.ok) return { ok: false, items: [], error: `HTTP ${res.status}` };
    const json: any = await res.json();
    if (!json?.data) return { ok: false, items: [] };
    current = { ...current, data: json.data as CharacterData };
    return { ok: true, items: buildCharacter(json.data as CharacterData).inventory };
  } catch (err) {
    return { ok: false, items: [], error: String(err) };
  }
});

/** Set HP on D&D Beyond (damage taken + temp), then confirm against character-service and
 *  refresh the embedded sheet so its view isn't stale (same pattern as inventory quantity). */
ipcMain.handle("ddb-set-hp", async (_e, removed: number, temp: number) => {
  if (!current) return { ok: false, error: "No character loaded" };
  const r = Math.max(0, Math.floor(removed));
  const t = Math.max(0, Math.floor(temp));
  const token = await mintDdbToken();
  if (!token) return { ok: false, error: "Not signed in to D&D Beyond" };
  const res = await ddbApiRequest(
    "PUT",
    "https://character-service.dndbeyond.com/character/v5/life/hp/damage-taken",
    token,
    { characterId: Number(current.id), removedHitPoints: r, temporaryHitPoints: t },
  );
  if (!res.ok) return { ok: false, error: res.json?.message || res.error || `HTTP ${res.status}` };
  // Confirm against the source of truth (authenticated — works for private characters too).
  const confirmed = await ddbApiRequest("GET", `https://character-service.dndbeyond.com/character/v5/character/${current.id}`, token);
  if (confirmed.ok && confirmed.json?.data) current = { ...current, data: confirmed.json.data as CharacterData };
  scheduleDdbReload(); // refresh the VISUAL pane only — the write path above no longer needs it
  return {
    ok: true,
    removed: confirmed.json?.data?.removedHitPoints ?? r,
    temp: confirmed.json?.data?.temporaryHitPoints ?? t,
  };
});

/** Add/remove a condition on D&D Beyond (PUT to apply, DELETE to clear — the exact calls the
 *  sheet's condition toggles make), authenticated from the main process. */
ipcMain.handle("ddb-set-condition", async (_e, id: number, active: boolean, level: number | null) => {
  if (!current) return { ok: false, error: "No character loaded" };
  const token = await mintDdbToken();
  if (!token) return { ok: false, error: "Not signed in to D&D Beyond" };
  const cid = Number(current.id);
  const url = "https://character-service.dndbeyond.com/character/v5/condition";
  const totalHp = (current.data as any)?.overrideHitPoints ?? undefined;
  const res = active
    ? await ddbApiRequest("PUT", url, token, { characterId: cid, id, level: level ?? null, totalHp })
    : await ddbApiRequest("DELETE", url, token, { characterId: cid, id });
  if (!res.ok) return { ok: false, error: res.json?.message || res.error || `HTTP ${res.status}` };
  scheduleDdbReload();
  return { ok: true };
});

/** Push HP to the matching Roll20 token's HP bar (by name). Only writes tokens you may edit;
 *  a linked bar (driven by a sheet attribute) is reported so the UI can say so. */
ipcMain.handle("r20-token-hp", async (_e, name: string, current: number, max: number, temp?: number) => {
  try {
    return await roll20View.webContents.executeJavaScript(r20TokenExpr("setHp", name, current, max, temp ?? null), true);
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

/** The token the GM currently has selected on the Roll20 map (for binding HP to one specific NPC). */
ipcMain.handle("r20-selected-token", async () => {
  try {
    return await roll20View.webContents.executeJavaScript(r20TokenExpr("selected"), true);
  } catch (err) {
    return { ok: false, reason: String(err) };
  }
});

/** All object-layer tokens on the active Roll20 page, for the "bind HP to token" picker. */
ipcMain.handle("r20-list-tokens", async () => {
  try {
    return await roll20View.webContents.executeJavaScript(r20TokenExpr("list"), true);
  } catch (err) {
    return { ok: false, tokens: [], error: String(err) };
  }
});

/** Write HP to ONE token by id (used after the GM binds to a selected token). */
ipcMain.handle("r20-token-hp-by-id", async (_e, id: string, current: number, max: number, temp?: number) => {
  try {
    return await roll20View.webContents.executeJavaScript(r20TokenExpr("setHpById", id, current, max, temp ?? null), true);
  } catch (err) {
    return { ok: false, reason: String(err) };
  }
});

/** Rename ONE Roll20 token (by id) AND the character it represents — used to push poke5e's name
 *  (the source of truth for character info) into Roll20 so the token, its character, and the chat
 *  speaker all match the sheet. Only affects objects the trainer controls (enforced in the page). */
ipcMain.handle("r20-token-rename", async (_e, id: string, name: string) => {
  try {
    return await roll20View.webContents.executeJavaScript(r20TokenExpr("renameById", id, name), true);
  } catch (err) {
    return { ok: false, reason: String(err) };
  }
});

/** Detect whether the open Roll20 game has the D&D 5e sheet's roll-template styling loaded. If so
 *  the app can send the prettier sheet templates (simple/atkdmg); otherwise it uses the universal
 *  default template (which renders in ANY game, just plainer). Checks loaded CSS, so it works even
 *  before any roll has been made. */
ipcMain.handle("roll20-sheet-style", async () => {
  try {
    const has5e = await roll20View.webContents.executeJavaScript(
      `(function(){try{for(const ss of document.styleSheets){let rules;try{rules=ss.cssRules;}catch(e){continue;}if(!rules)continue;for(const r of rules){if(r.selectorText&&/sheet-rolltemplate-(simple|atkdmg|atk|dmg|spell)/.test(r.selectorText))return true;}}}catch(e){}return !!document.querySelector('[class*=sheet-rolltemplate-]');})()`,
      true,
    );
    return { style: has5e ? "sheet" : "default" };
  } catch {
    return { style: "default" };
  }
});

/** Post a plain message to the Roll20 chat as the given character (e.g. a condition announcement).
 *  Reuses the same chat injector rolls use. Fails softly if no game is open. */
ipcMain.handle("roll20-say", async (_e, message: string, speakingAs?: string) => {
  try {
    return await roll20View.webContents.executeJavaScript(buildSendExpression(String(message), speakingAs), true);
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

// "Display in VTT" — post the WORDING of a move/spell/feat/item to the Roll20 table as a
// `&{template:default}` info card. Formatting (HTML-strip, template-delimiter neutralization,
// length cap) is done by the pure, unit-tested displayCard(); the renderer only passes raw text.
ipcMain.handle("display-in-vtt", async (_e, payload: { name?: string; body?: string; meta?: string; label?: string; speakingAs?: string }) => {
  const command = displayCard({ name: payload?.name ?? "", body: payload?.body ?? "", meta: payload?.meta, label: payload?.label });
  if (!command) return { ok: false, error: "nothing to display" };
  try {
    const injected: any = await roll20View.webContents.executeJavaScript(buildSendExpression(command, payload?.speakingAs), true);
    return { ok: injected?.ok === true, command, injected };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

// ---- Pokédex: species reference + seen/caught collection --------------------------------------
let pokedexCache: DexEntry[] | null = null;
async function ensurePokedex(): Promise<DexEntry[]> {
  if (pokedexCache) return pokedexCache;
  const [pj, mj] = await Promise.all([
    fetch("https://poke5e.app/pokemon.json").then((r) => r.json()),
    fetch("https://poke5e.app/moves.json").then((r) => r.json()),
  ]);
  pokedexCache = buildPokedex((pj as any).items || [], (mj as any).moves || []);
  return pokedexCache;
}
ipcMain.handle("pokedex-load", async () => {
  try {
    return { ok: true, species: await ensurePokedex(), collection: Object.fromEntries(pokedexCollection) };
  } catch (err) {
    return { ok: false, error: String(err), species: [], collection: {} };
  }
});
ipcMain.handle("pokedex-view", (_e, open: boolean) => {
  pokedexOpen = !!open;
  layout();
  raiseRightPane(); // keeps the sheet pane on top (it now covers the whole window)
  return { ok: true };
});
// A manual, persisted dex flag: "seen" (encounter the DM confirms) or "caught" (marked by hand,
// e.g. after an inventory Poké Ball throw). Team membership is layered on top as caught at read time.
ipcMain.handle("pokedex-mark", (_e, id: string, state: "seen" | "caught" | null) => {
  if (!id) return { ok: false };
  if (state === "seen" || state === "caught") pokedexCollection.set(id, state);
  else pokedexCollection.delete(id);
  saveStoreSoon();
  return { ok: true };
});
// Hidden-Pokémon filter for the roster switcher (local "working team" view; poke5e has no team yet).
ipcMain.handle("poke5e-hidden-get", () => ({ ids: [...pokeHidden] }));
ipcMain.handle("poke5e-hidden-set", (_e, id: string, hidden: boolean) => {
  if (!id) return { ok: false };
  if (hidden) pokeHidden.add(String(id)); else pokeHidden.delete(String(id));
  saveStoreSoon();
  return { ok: true };
});

// Species the loaded trainer owns (their team) = "caught" in the dex. Derived live from poke5e.
ipcMain.handle("pokedex-caught", () => {
  const species = poke5eCtx?.team
    ? [...poke5eCtx.team.values()].map((p: any) => String(p.species || "").toLowerCase()).filter(Boolean)
    : [];
  return { ok: true, species: [...new Set(species)] };
});

// Set a bag item's quantity — writes back to poke5e when we hold the write key, else local-only.
ipcMain.handle("poke5e-item-qty", async (_e, item: { rowId: number; itemId?: string | null; name?: string; customName?: string | null; note?: string }, quantity: number) => {
  if (!poke5eCtx?.writeKey) return { ok: true, persisted: false }; // read-only trainer → caller decrements locally
  try {
    await updateInventoryItem(poke5eCtx.writeKey, item, Math.max(0, quantity));
    return { ok: true, persisted: true };
  } catch (err) {
    return { ok: false, persisted: false, error: String(err) };
  }
});

// The poke5e standard-item catalogue (id, name, type) for the "add item" picker.
ipcMain.handle("poke5e-items-catalog", async () => {
  try { return { ok: true, items: await fetchItemsCatalog() }; } catch (err) { return { ok: false, items: [], error: String(err) }; }
});

// Add a standard item to the loaded trainer's bag. If it's already there, bump that row's quantity
// (avoids a duplicate row); otherwise create a fresh row. Returns the rebuilt inventory.
ipcMain.handle("poke5e-add-item", async (_e, itemId: string, quantity: number = 1) => {
  if (!poke5eCtx?.writeKey) return { ok: false, error: "This trainer is read-only (no write key) — add items on poke5e." };
  const qty = Math.max(1, Number(quantity) || 1);
  try {
    const before = await buildInventory(poke5eCtx.readKey).catch(() => [] as any[]);
    const existing = before.find((it: any) => it.itemId && String(it.itemId) === String(itemId));
    if (existing) await updateInventoryItem(poke5eCtx.writeKey, existing, (Number(existing.quantity) || 0) + qty);
    else await addInventoryItem(poke5eCtx.writeKey, String(itemId), qty);
    const inventory = await buildInventory(poke5eCtx.readKey).catch(() => [] as any[]);
    schedulePoke5ePaneRefresh();
    return { ok: true, inventory };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

// Forget a trainer's keys in the poke5e web pane's own local list (so its page drops it too).
async function forgetTrainerInPane(readKey: string) {
  try {
    await ddbView.webContents.executeJavaScript(
      `(function(){try{var t=(localStorage.getItem("trainers")||"").split(",").filter(function(k){return k&&k!==${JSON.stringify(readKey)}});localStorage.setItem("trainers",t.join(","));localStorage.removeItem("write:"+${JSON.stringify(readKey)});localStorage.removeItem("read:"+${JSON.stringify(readKey)});}catch(e){}})()`,
      true,
    );
  } catch { /* best effort */ }
}

// "Remove" — forget the loaded trainer from the local list only (poke5e's own behaviour). The trainer
// row stays in the database and can be re-added with its read key. No confirmation (non-destructive).
ipcMain.handle("poke5e-remove-trainer", async () => {
  if (!poke5eCtx?.readKey) return { ok: false, error: "No trainer loaded." };
  const readKey = poke5eCtx.readKey;
  await forgetTrainerInPane(readKey);
  poke5eCtx = null;
  return { ok: true, readKey };
});

// Permanently delete the currently-loaded poke5e trainer (write-key gated), behind a confirmation
// dialog so an accidental click can't erase a trainer.
ipcMain.handle("poke5e-delete-trainer", async () => {
  if (!poke5eCtx?.writeKey || !poke5eCtx.trainerId) return { ok: false, error: "This trainer is read-only (no write key) — it can't be deleted from here." };
  const name = poke5eCtx.trainerRow?.name || "this trainer";
  const readKey = poke5eCtx.readKey;
  const { response } = await dialog.showMessageBox(win, {
    type: "warning",
    title: "Delete trainer",
    message: `Delete “${name}” permanently?`,
    detail: "This removes the trainer and all of its Pokémon from poke5e for anyone with the link. This cannot be undone.",
    buttons: ["Cancel", "Delete permanently"],
    defaultId: 0,
    cancelId: 0,
  });
  if (response !== 1) return { ok: true, canceled: true };
  try {
    const gone = await deleteTrainer(poke5eCtx.writeKey, poke5eCtx.trainerId);
    if (!gone) return { ok: false, error: "Delete failed — the trainer no longer exists or the write key is wrong." };
    await forgetTrainerInPane(readKey);
    poke5eCtx = null;
    return { ok: true, deleted: true, readKey };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

// Permanently remove ONE Pokémon from the loaded trainer (poke5e's `remove_pokemon`, write-key
// gated), behind a confirmation dialog. Refetches the team so the roster drops it.
ipcMain.handle("poke5e-remove-pokemon", async (_e, pokemonId: number) => {
  if (!poke5eCtx?.writeKey) return { ok: false, error: "This trainer is read-only (no write key) — remove Pokémon on poke5e." };
  const pid = Number(pokemonId);
  const pk = poke5eCtx.team.get(pid);
  if (!pk) return { ok: false, error: "That Pokémon isn't on this trainer." };
  const name = (pk.nickname && String(pk.nickname).trim()) || pk.species || "this Pokémon";
  const trainerName = poke5eCtx.trainerRow?.name || "the trainer";
  const { response } = await dialog.showMessageBox(win, {
    type: "warning",
    title: "Remove Pokémon",
    message: `Remove ${name} from ${trainerName}?`,
    detail: "This permanently removes the Pokémon from the trainer on poke5e. This cannot be undone.",
    buttons: ["Cancel", "Remove permanently"],
    defaultId: 0,
    cancelId: 0,
  });
  if (response !== 1) return { ok: true, canceled: true };
  try {
    await removePokemon(poke5eCtx.writeKey, pid);
    // Re-pull the team so the roster reflects the removal (fall back to a local drop on failure).
    const team = await fetchPokemon(poke5eCtx.trainerId).catch(() => null);
    if (Array.isArray(team)) poke5eCtx.team = new Map(team.map((p: any) => [p.id, p]));
    else poke5eCtx.team.delete(pid);
    schedulePoke5ePaneRefresh();
    return { ok: true, removed: true, pokemonId: pid };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

// Add a caught Pokémon (by species id, at a wild level) to the trainer's team on poke5e.
ipcMain.handle("poke5e-add-team", async (_e, speciesId: string, level: number) => {
  if (!poke5eCtx?.writeKey) return { ok: false, error: "This trainer is read-only (no write key) — add it on poke5e." };
  const entry = (pokedexCache || []).find((p) => p.id === speciesId);
  if (!entry) return { ok: false, error: "Unknown species" };
  try {
    await addPokemonToTeam(poke5eCtx.writeKey, entry, Math.max(1, Number(level) || entry.minLevel || 1));
    // Refresh the cached team so the dex immediately shows it as caught.
    const team = await fetchPokemon(poke5eCtx.trainerId).catch(() => null);
    if (Array.isArray(team)) poke5eCtx.team = new Map(team.map((p: any) => [p.id, p]));
    schedulePoke5ePaneRefresh();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
});

/** Scrape the Roll20 chat and return the roll records (no persist) — used to read a roll's
 *  RESULT back into the app right after sending it. */
ipcMain.handle("roll20-scrape", async () => {
  try {
    return await roll20View.webContents.executeJavaScript(roll20LogExpr(), true);
  } catch {
    return [];
  }
});

/** The token id whose turn it is (top of the Roll20 turn order), for "your turn" alerts. */
ipcMain.handle("r20-turn-top", async () => {
  try {
    return await roll20View.webContents.executeJavaScript(r20TokenExpr("turnTop"), true);
  } catch {
    return null;
  }
});

/** Show an OS notification (e.g. "your turn"). */
ipcMain.handle("notify", (_e, title: string, body: string) => {
  try {
    if (Notification.isSupported()) new Notification({ title, body }).show();
  } catch { /* ignore */ }
  return { ok: true };
});

/** Read the computed Armor Class straight off the D&D Beyond sheet (it's already correct there —
 *  computing AC from scratch, with armor/dex-cap/shield/magic/feats, is error-prone). */
ipcMain.handle("ddb-read-ac", async () => {
  try {
    const ac = await ddbView.webContents.executeJavaScript(
      `(function(){var e=document.querySelector('.ddbc-armor-class-box__value');if(!e)return null;var n=parseInt((e.textContent||'').trim(),10);return isNaN(n)?null:n;})()`,
      true,
    );
    return { ac: typeof ac === "number" ? ac : null };
  } catch {
    return { ac: null };
  }
});

/** Look up the matching Roll20 token(s) for a character name (for load-time reconciliation). */
ipcMain.handle("r20-token-find", async (_e, name: string, max: number) => {
  try {
    const tokens = await roll20View.webContents.executeJavaScript(r20TokenExpr("find", name, max), true);
    return { ok: true, tokens };
  } catch (err) {
    return { ok: false, tokens: [], error: String(err) };
  }
});

/** Raise the D&D Beyond pane on the Inventory tab so the user can search/add items natively. */
ipcMain.handle("ddb-open-inventory", async () => {
  rightMode = "ddb";
  layout();
  raiseRightPane();
  const res = await ddbView.webContents
    .executeJavaScript(ddbInventoryExpr("openInventory"), true)
    .catch((err) => ({ ok: false, error: String(err) }));
  return res;
});

// ---- IPC: session log & statistics (scraped from the connected Roll20 game) --------------

/** Scrape the Roll20 chat, merge new rolls into the session log, return log + stats + actions. */
ipcMain.handle("session-sync", async () => {
  try {
    const records: RollRecord[] = await roll20View.webContents.executeJavaScript(roll20LogExpr(), true);
    mergeRecords(records); // dedup + persist (session view)
    void appendToArchive(records); // durable per-campaign archive
  } catch {
    /* chat not available (no game open) — return what we have */
  }
  return sessionPayload(await currentCampaignId());
});

/** Open the durable roll-log folder in the OS file manager. */
ipcMain.handle("roll-logs-open", async () => {
  try {
    await mkdir(rollLogsDir(), { recursive: true });
    const err = await shell.openPath(rollLogsDir());
    return { ok: !err, dir: rollLogsDir(), error: err || undefined };
  } catch (e) {
    return { ok: false, dir: rollLogsDir(), error: String(e) };
  }
});

/** Current campaign id, also recording its name for the dropdown. */
async function currentCampaignId(): Promise<string | null> {
  const c = await readCampaign();
  if (c.id) { if (c.name) campaignNames.set(c.id, c.name); saveStoreSoon(); }
  return c.id;
}

function sessionPayload(currentCampaign: string | null) {
  const all = [...sessionLog.values()];
  return {
    records: all,
    stats: aggregate(all),
    actions: actionLog,
    currentCampaign,
    campaigns: Object.fromEntries(campaignNames),
  };
}

/** Deep sync: scroll the Roll20 chat up to lazy-load the MAX history Roll20 will serve, then scrape. */
ipcMain.handle("session-deep-sync", async () => {
  try {
    await roll20View.webContents.executeJavaScript(
      `(async function(){
        var c = document.querySelector('#textchat .content') || document.querySelector('#textchat');
        if(!c) return;
        var last = -1, stable = 0;
        for (var i=0;i<60;i++){
          var n = document.querySelectorAll('#textchat .content .message').length;
          if (n === last) { stable++; if (stable >= 3) break; }  // 3 stable checks = Roll20 has no more
          else { stable = 0; last = n; }
          c.scrollTop = 0;                 // jump to top to trigger lazy-load of older messages
          await new Promise(function(r){ setTimeout(r, 500); });
        }
        c.scrollTop = c.scrollHeight;      // restore the view to the newest messages
      })()`,
      true,
    );
  } catch {
    /* no game / transient */
  }
  await captureLoop(); // scrape everything that loaded (deduped by id)
  return sessionPayload(await currentCampaignId());
});

ipcMain.handle("copy-text", (_e, text: string) => {
  clipboard.writeText(String(text ?? ""));
  return { ok: true };
});

ipcMain.handle("session-clear", () => {
  sessionLog.clear();
  actionLog.length = 0;
  saveStoreSoon(); // persist the empty store so the clear survives a restart
  return { ok: true };
});

/** Export the session as a file. kind: 'json' (full bundle) | 'csv-log' | 'csv-stats'. */
ipcMain.handle("session-export", async (_e, kind: "json" | "csv-log" | "csv-stats") => {
  const all = [...sessionLog.values()];
  const stats = aggregate(all);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const char = current?.name ? current.name.replace(/[^\w]+/g, "_") : "session";
  let ext = "json";
  let content = "";
  if (kind === "csv-log") { ext = "csv"; content = recordsToCSV(all); }
  else if (kind === "csv-stats") { ext = "csv"; content = statsToCSV(stats); }
  else { content = JSON.stringify({ exportedAt: new Date().toISOString(), character: current?.name, records: all, stats, actions: actionLog }, null, 2); }

  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: "Export session",
    defaultPath: `${char}-${kind}-${stamp}.${ext}`,
    filters: ext === "csv" ? [{ name: "CSV", extensions: ["csv"] }] : [{ name: "JSON", extensions: ["json"] }],
  });
  if (canceled || !filePath) return { ok: false, canceled: true };
  await writeFile(filePath, content, "utf8");
  return { ok: true, path: filePath };
});

/** Process-wide security backstops, applied once at startup and independent of the per-view
 *  hardening in createWindow(). Defense-in-depth: (1) refuse to attach a <webview> anywhere —
 *  nothing in this app uses one, so any attempt is hostile; (2) deny high-risk device/permission
 *  requests that neither the local sheet nor the Roll20 / D&D Beyond panes need. Media,
 *  notifications, clipboard, fullscreen and screen-capture are intentionally left allowed so the
 *  VTT's audio/video and screen-share keep working. */
const DENIED_PERMISSIONS = new Set<string>([
  "geolocation", "hid", "serial", "usb", "midi", "midiSysex", "idle-detection", "bluetooth",
]);
function installGlobalHardening() {
  app.on("web-contents-created", (_e, contents) => {
    contents.on("will-attach-webview", (e) => e.preventDefault());
  });
  const applyPermissions = (s: Electron.Session) => {
    s.setPermissionRequestHandler((_wc, permission, cb) => cb(!DENIED_PERMISSIONS.has(permission)));
    s.setPermissionCheckHandler((_wc, permission) => !DENIED_PERMISSIONS.has(permission));
  };
  applyPermissions(session.defaultSession); // local sheet + splash views
  applyPermissions(session.fromPartition("persist:main")); // Roll20 + D&D Beyond remote panes
}

// ---- Update checker ------------------------------------------------------------------------------
// On launch (packaged builds), ask GitHub for the latest release and, if it's newer than what's
// running, prompt the user to Download / Later / Skip. We don't auto-install (the builds are
// unsigned, and silent replacement would just re-trigger SmartScreen/Gatekeeper) — "Download" opens
// the release page so the user installs deliberately.
const GH_LATEST_RELEASE = "https://api.github.com/repos/dr0v3rr/tabletop-conduit/releases/latest";
async function checkForUpdate(manual = false): Promise<void> {
  try {
    const res = await fetch(GH_LATEST_RELEASE, { headers: { "User-Agent": "Conduit-update-check", Accept: "application/vnd.github+json" } });
    if (!res.ok) { if (manual) dialog.showMessageBox(win, { type: "warning", message: "Couldn't check for updates", detail: `GitHub returned HTTP ${res.status}.` }); return; }
    const rel: any = await res.json();
    const latest = String(rel.tag_name || "").replace(/^v/i, "");
    const current = app.getVersion();
    if (!latest) return;
    if (!isNewer(latest, current)) {
      if (manual) dialog.showMessageBox(win, { type: "info", message: "You're up to date", detail: `Conduit v${current} is the latest release.` });
      return;
    }
    if (!manual && updateSkip === latest) return; // user asked to skip this exact version
    const { response } = await dialog.showMessageBox(win, {
      type: "info",
      title: "Update available",
      message: `Conduit v${latest} is available`,
      detail: `You're running v${current}. Download the new version from GitHub?`,
      buttons: ["Download", "Later", "Skip this version"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) shell.openExternal(String(rel.html_url || "https://github.com/dr0v3rr/tabletop-conduit/releases/latest"));
    else if (response === 2) { updateSkip = latest; saveStoreSoon(); }
  } catch {
    if (manual) dialog.showMessageBox(win, { type: "warning", message: "Couldn't check for updates", detail: "You appear to be offline." });
    /* otherwise silent — offline / rate-limited */
  }
}
// Full in-app update for Windows & Linux (electron-updater): download the new build and relaunch
// into it. macOS is excluded — Squirrel.Mac refuses unsigned updates — and any failure falls back to
// the notifier above (open the release page). Requires the release to carry electron-builder's
// latest*.yml (published from v0.2.11 onward).
let autoUpdateWired = false;
function autoUpdate(manual = false): void {
  // Portable Windows builds (PORTABLE_EXECUTABLE_DIR is set) and macOS can't self-replace/relaunch,
  // so they get the version-check NOTIFIER (prompt → open the release page) instead of electron-updater.
  const isPortable = !!process.env.PORTABLE_EXECUTABLE_DIR;
  if (process.platform === "darwin" || isPortable) { void checkForUpdate(manual); return; }
  autoUpdater.autoDownload = false;
  if (!autoUpdateWired) {
    autoUpdateWired = true;
    autoUpdater.on("update-available", async (info) => {
      if (!manual && updateSkip === info.version) return;
      const { response } = await dialog.showMessageBox(win, {
        type: "info", title: "Update available", message: `Conduit v${info.version} is available`,
        detail: `You're running v${app.getVersion()}. Download it now? Conduit will offer to restart when it's ready.`,
        buttons: ["Download", "Later", "Skip this version"], defaultId: 0, cancelId: 1,
      });
      if (response === 0) autoUpdater.downloadUpdate();
      else if (response === 2) { updateSkip = info.version; saveStoreSoon(); }
    });
    autoUpdater.on("update-not-available", () => { if (manual) dialog.showMessageBox(win, { type: "info", message: "You're up to date", detail: `Conduit v${app.getVersion()} is the latest release.` }); });
    autoUpdater.on("update-downloaded", async (info) => {
      const { response } = await dialog.showMessageBox(win, {
        type: "info", title: "Update ready", message: `Conduit v${info.version} downloaded`,
        detail: "Restart now to finish installing?", buttons: ["Restart now", "Later"], defaultId: 0, cancelId: 1,
      });
      if (response === 0) autoUpdater.quitAndInstall();
    });
    autoUpdater.on("error", () => { void checkForUpdate(manual); }); // no feed yet / offline → notifier fallback
  }
  autoUpdater.checkForUpdates().catch(() => checkForUpdate(manual));
}
ipcMain.handle("check-update", () => autoUpdate(true)); // manual "Check for updates" action

app.whenReady().then(async () => {
  installGlobalHardening();
  await loadStore(); // restore accumulated roll history from previous sessions
  await loadArchive(); // index the durable per-campaign roll archive (dedupe future appends)
  createWindow();
  // Non-blocking launch check (packaged builds only — no dev noise), a few seconds after startup.
  // Win/Linux get the full download+relaunch flow; macOS/failures fall back to the open-page notifier.
  if (app.isPackaged) setTimeout(() => autoUpdate(false), 4000);
});
app.on("window-all-closed", () => app.quit());
