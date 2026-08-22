// Sheet renderer — thin client over window.api (preload IPC). No engine here.
import { aggregate } from "../src/stats/roll-stats.js"; // pure stats, safe in the renderer bundle
import { CONDITIONS } from "../src/engine/conditions.js"; // pure data catalog
type Ability = "STR" | "DEX" | "CON" | "INT" | "WIS" | "CHA";
type AdvMode = "normal" | "advantage" | "disadvantage" | "super-advantage" | "super-disadvantage";

declare global {
  interface Window {
    api: {
      loadCharacter(id: string): Promise<{ ok: boolean; model?: any; error?: string }>;
      loadPoke5e(input: string): Promise<{ ok: boolean; model?: any; error?: string; [k: string]: any }>;
      listPoke5eTrainers(extraKeys: string[]): Promise<{ ok: boolean; trainers: { readKey: string; name: string; level: number }[]; error?: string }>;
      poke5eGmRoster(extraKeys: string[]): Promise<{ ok: boolean; trainers: { readKey: string; name: string; writable: boolean; team: { id: number; name: string }[] }[]; error?: string }>;
      loadPoke5ePokemon(pokemonId: number): Promise<{ ok: boolean; model?: any; error?: string; [k: string]: any }>;
      poke5eSetHp(curHp: number, maxHp: number): Promise<{ ok: boolean; error?: string }>;
      poke5eSetPp(learnedId: number, moveId: string, ppCur: number, ppMax: number, notes?: string): Promise<{ ok: boolean; error?: string }>;
      poke5eKeys(): Promise<{ ok: boolean; name?: string; readKey?: string; writeKey?: string; error?: string }>;
      getConfig(): Promise<{ source: string; vtt: string }>;
      showSplash(): Promise<{ ok: boolean }>;
      searchMonsters(query: string): Promise<{ ok: boolean; results: { slug: string; name: string; cr: string; type: string }[]; error?: string }>;
      loadMonster(slug: string): Promise<{ ok: boolean; model?: any; error?: string; [k: string]: any }>;
      searchDdbMonsters(query: string): Promise<{ ok: boolean; results: { slug: string; name: string; cr: string; type: string }[]; error?: string }>;
      loadDdbMonster(id: string): Promise<{ ok: boolean; model?: any; error?: string; [k: string]: any }>;
      listCharacters(): Promise<{ ok: boolean; characters: { id: number; name: string; level: number; classDescription: string; raceName: string; campaignName: string }[]; error?: string }>;
      listToggles(request: any): Promise<{ id: string; name: string }[]>;
      roll(request: any, enabled: string[]): Promise<{ ok: boolean; command?: string; injected?: any; error?: string }>;
      setRightPane(mode: "roll20" | "ddb"): Promise<{ mode: string }>;
      ddbStatus(): Promise<{ loggedIn: boolean }>;
      ddbAuth(): Promise<{ authed: boolean }>;
      ddbSync(): Promise<{ ok: boolean; slots: { level: number; total: number; used: number }[] }>;
      ddbPeek(): Promise<{ slots: { level: number; total: number; used: number }[] }>;
      ddbSpend(level: number): Promise<{ ok: boolean; slots?: any[]; error?: string }>;
      ddbRestore(level: number): Promise<{ ok: boolean; slots?: any[]; error?: string }>;
      ddbRestoreAll(): Promise<{ ok: boolean; slots?: any[] }>;
      ddbHitDiceRead(): Promise<{ ok: boolean; pools: { cls: string; die: number; total: number; used: number; interactive: boolean }[] }>;
      ddbShortRest(count: number, die?: number): Promise<{ ok: boolean; pools?: any[]; error?: string }>;
      ddbItemSetQty(id: number, quantity: number): Promise<{ ok: boolean; quantity?: number; error?: string; message?: string }>;
      inventoryRefresh(): Promise<{ ok: boolean; items: any[]; error?: string }>;
      ddbOpenInventory(): Promise<{ ok: boolean; error?: string }>;
      ddbSetHp(removed: number, temp: number): Promise<{ ok: boolean; removed?: number; temp?: number; error?: string; message?: string }>;
      ddbSetCondition(id: number, active: boolean, level: number | null): Promise<{ ok: boolean; error?: string }>;
      r20SetTokenHp(name: string, current: number, max: number, temp?: number): Promise<{ ok: boolean; found: number; wrote?: number; bar?: string; linked?: boolean; blocked?: number }>;
      r20SelectedToken(): Promise<{ ok: boolean; id?: string; name?: string; reason?: string }>;
      r20ListTokens(): Promise<{ ok: boolean; tokens: { id: string; name: string; bar1: string; bar1max: string; x: number; y: number }[]; error?: string }>;
      r20SetTokenHpById(id: string, current: number, max: number, temp?: number): Promise<{ ok: boolean; bar?: string; name?: string; reason?: string }>;
      r20FindToken(name: string, max: number): Promise<{ ok: boolean; tokens: { id: string; name: string; bar: string; value: string; max: string; linked: boolean }[] }>;
      ddbReadAc(): Promise<{ ac: number | null }>;
      roll20Scrape(): Promise<any[]>;
      roll20Say(message: string, speakingAs?: string): Promise<{ ok: boolean; error?: string }>;
      roll20SheetStyle(): Promise<{ style: "sheet" | "default" }>;
      r20TurnTop(): Promise<{ id: string; pr: any; count: number } | null>;
      notify(title: string, body: string): Promise<{ ok: boolean }>;
      sessionSync(): Promise<{ records: any[]; stats: any; actions: any[]; currentCampaign?: string | null; campaigns?: Record<string, string> }>;
      sessionDeepSync(): Promise<{ records: any[]; stats: any; actions: any[]; currentCampaign?: string | null; campaigns?: Record<string, string> }>;
      sessionClear(): Promise<{ ok: boolean }>;
      sessionExport(kind: "json" | "csv-log" | "csv-stats"): Promise<{ ok: boolean; path?: string; canceled?: boolean }>;
      copyText(text: string): Promise<void>;
      logout(): Promise<{ ok: boolean; error?: string }>;
    };
  }
}

const ABILITIES: Ability[] = ["STR", "DEX", "CON", "INT", "WIS", "CHA"];
const DAMAGE_TYPES = ["acid", "bludgeoning", "cold", "fire", "force", "lightning", "necrotic", "piercing", "poison", "psychic", "radiant", "slashing", "thunder"];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const SKILL_NAMES: Record<string, string> = {
  acrobatics: "Acrobatics", "animal-handling": "Animal Handling", arcana: "Arcana",
  athletics: "Athletics", deception: "Deception", history: "History", insight: "Insight",
  intimidation: "Intimidation", investigation: "Investigation", medicine: "Medicine",
  nature: "Nature", perception: "Perception", performance: "Performance", persuasion: "Persuasion",
  religion: "Religion", "sleight-of-hand": "Sleight of Hand", stealth: "Stealth", survival: "Survival",
};

let model: any = null;
let weapons: any[] = [];
let spellcasting: any = null;
let spellSlots: any[] = [];
let remaining: Record<number, number> = {}; // spell level -> remaining slots
let hitDice: any = null; // { pools: [{die,total,used}], conMod }
let hitRemaining: Record<number, number> = {}; // die size -> remaining hit dice
let hitPending: Record<number, number> = {}; // die size -> hit dice spent this short rest, awaiting DDB commit
let inventory: any[] = []; // rollable + magic items (potions, offensive consumables, magic gear)
let hp: { current: number; max: number; temp: number; removed: number } | null = null;
let defenses: { resist: string[]; immune: string[]; vulnerable: string[] } = { resist: [], immune: [], vulnerable: [] };
let concentrating: { name: string } | null = null; // active concentration spell, if any
let deathSaves = { success: 0, fail: 0 }; // tracked while at 0 HP
let acValue: number | null = null; // Armor Class read from the DDB sheet
let activeConditions = new Map<number, number | null>(); // ddb condition id -> level (null unless exhaustion)
let hpUndo: { removed: number; temp: number } | null = null; // last HP state, for Undo
let pickerCharId = ""; // currently selected character in the custom picker
let ddbConnected = false; // when true, `remaining` mirrors the real DDB sheet
let ddbAuthed = false; // signed in to DDB (cobalt-token works) — independent of sheet render
let ddbBusy = false; // a DDB slot mutation (spend/restore/restoreAll) is in flight — serialize
let adv: AdvMode = "normal";
let whisperOn = false; // roll privately to the GM
let adhocMod = 0; // ad-hoc situational modifier on the next d20 roll(s)
let lastRollRequest: any = null; // for the Reroll button
let templateStyle: "sheet" | "default" = "default"; // 'sheet' → prettier D&D-5e cards when the game has that sheet
let activeSource: "ddb" | "poke5e" | "monster" = "ddb"; // which character-sheet source the splash selected
let writable = true; // false for public/others' sheets & monsters — edits stay local, no write-back
// GM-mode roster. For DDB it's the campaign party; for poke5e it's either a single trainer's team,
// or (GM view) every remembered trainer grouped — `kind`/`group`/`writable` drive the grouped render.
let roster: { id: string; name: string; avatar?: string; mine?: boolean; kind?: "trainer" | "pokemon"; group?: string; writable?: boolean }[] = [];
let poke5eTrainerKey = ""; // read key of the currently-loaded poke5e trainer (for cross-trainer switches)
let feats: { name: string; description: string }[] = []; // trainer feats / abilities (poke5e etc.)
let passives: { ability: string; cond: any; effect: string }[] = []; // Pokémon-wide ability passives
let pokeMeta: { species: string; types: string[]; nature: string; tera: string; status: string; shiny: boolean; bond: { level: number; cur: number; max: number } } | null = null;
let activeRef = ""; // ref (DDB character id) of the currently-shown roster member
const enabled = new Set<string>();

const $ = (id: string) => document.getElementById(id)!;
const sectionEl = (name: string) => document.querySelector<HTMLElement>(`[data-section="${name}"]`)!;
const sgn = (n: number) => (n >= 0 ? `+${n}` : `${n}`);

function selectedCharId(): string {
  if (!$("charPicker").hidden && pickerCharId) return pickerCharId;
  return ($("charId") as HTMLInputElement).value;
}

async function load() {
  if (activeSource === "monster") return; // monsters load from the search dropdown, not here
  const id = selectedCharId();
  setStatus("Loading…");
  // The DDB pane is about to navigate to the new character; until refreshDdb() re-confirms the
  // connection, treat DDB as offline so a cast doesn't drive the old/still-loading sheet, and
  // drop any stale in-flight lock from the previous character.
  ddbConnected = false;
  ddbBusy = false;
  const res = activeSource === "poke5e" ? await window.api.loadPoke5e(id) : await window.api.loadCharacter(id);
  applyCharacter(res, id);
}

// Load a monster/NPC chosen from the search dropdown (from D&D Beyond or Open5e).
async function loadMonster(slug: string, name: string, src: "ddb" | "open5e" = "open5e") {
  setStatus(`Loading ${name}…`);
  ddbConnected = false;
  ddbBusy = false;
  const res = src === "ddb" ? await window.api.loadDdbMonster(slug) : await window.api.loadMonster(slug);
  applyCharacter(res, slug);
}

// GM-mode: build the campaign party switcher from a loaded D&D Beyond character's roster.
function buildRosterFrom(res: any, ref: string) {
  activeRef = ref;
  // poke5e (and any source) can ship an explicit roster (Trainer + Pokémon team).
  if (Array.isArray(res.roster) && res.roster.length > 1) {
    roster = res.roster.map((r: any) => ({ id: r.ref, name: r.name, avatar: r.avatar, mine: r.mine }));
    renderRoster();
    // GM view: if the user has more than one trainer remembered, upgrade to the grouped switcher
    // (all trainers + their teams). Fire-and-forget so the single-trainer roster shows instantly.
    if (activeSource === "poke5e") void augmentPoke5eGmRoster();
    return;
  }
  // No roster in this payload: if we're just switching within an existing roster, keep it.
  if (roster.length && roster.some((r) => r.id === ref)) { renderRoster(); return; }
  const camp = res.campaign;
  const myUid = res.userId;
  // GM-mode only: show the party roster when the signed-in user is the campaign's DM.
  const isDM = !!(camp && myUid != null && camp.dmUserId != null && String(camp.dmUserId) === String(myUid));
  if (activeSource === "ddb" && isDM && Array.isArray(camp.characters) && camp.characters.length > 1) {
    roster = camp.characters.map((c: any) => ({
      id: String(c.characterId),
      name: c.characterName || "Character " + c.characterId,
      avatar: c.avatarUrl || undefined,
      mine: myUid != null && String(c.userId) === String(myUid),
    }));
    if (!roster.some((r) => r.id === activeRef)) roster.unshift({ id: activeRef, name: model?.name || "This character", mine: writable });
  } else {
    roster = []; // not the DM, or not a multi-character campaign → no switcher
  }
  renderRoster();
}

// The trainer read key an activeRef belongs to (grouped GM view): a "pmon:<id>@<key>" ref → its
// key; a plain trainer key → itself; otherwise the currently-loaded trainer.
function activeRefTrainerKey(): string {
  const at = activeRef.indexOf("@");
  if (activeRef.startsWith("pmon:") && at >= 0) return activeRef.slice(at + 1);
  if (!activeRef.startsWith("pmon:") && activeRef) return activeRef; // a trainer key
  return poke5eTrainerKey;
}

// GM view for poke5e: replace the single-trainer roster with EVERY remembered trainer, each as a
// header with its team beneath. Only kicks in when >1 trainer is known (else the simple roster
// stays). poke5e has no campaign, so this is the union of trainers the user has loaded/opened.
let augmentSeq = 0;
// Cache the grouped roster keyed by the trainer-key set, so switching between already-known trainers
// doesn't re-fetch every team each time. Cleared by reloadCurrent() / when the key set changes.
let gmRosterCache: { keys: string; grouped: typeof roster } | null = null;
async function augmentPoke5eGmRoster() {
  const keyStr = getPoke5eKeys().slice().sort().join(",");
  let grouped: typeof roster;
  if (gmRosterCache && gmRosterCache.keys === keyStr) {
    grouped = gmRosterCache.grouped; // reuse — the grouped structure (names only) is switch-invariant
  } else {
    const myseq = ++augmentSeq;
    const res = await window.api.poke5eGmRoster(getPoke5eKeys()).catch(() => null);
    if (myseq !== augmentSeq) return; // a newer augment superseded this one (avoid stale roster overwrite)
    if (activeSource !== "poke5e") return; // source may have changed while fetching
    if (!res?.ok || res.trainers.length < 2) return; // single trainer → keep the simple roster
    grouped = [];
    for (const tr of res.trainers) {
      grouped.push({ id: tr.readKey, name: tr.name, kind: "trainer", group: tr.name, writable: tr.writable, mine: tr.writable });
      for (const p of tr.team) grouped.push({ id: `pmon:${p.id}@${tr.readKey}`, name: p.name, kind: "pokemon", group: tr.name, writable: tr.writable });
    }
    gmRosterCache = { keys: keyStr, grouped };
  }
  if (activeSource !== "poke5e") return;
  roster = grouped;
  // Normalise the active ref to the grouped scheme so the current member stays highlighted.
  if (activeRef.startsWith("pmon:") && !activeRef.includes("@") && poke5eTrainerKey) activeRef = `${activeRef}@${poke5eTrainerKey}`;
  else if (!activeRef.startsWith("pmon:") && poke5eTrainerKey && grouped.some((r) => r.id === poke5eTrainerKey)) activeRef = poke5eTrainerKey;
  renderRoster();
}

// The roster switcher is a dropdown anchored under the character/trainer name (scales to a large
// team without a horizontal strip). Hidden entirely for a solo character.
function renderRoster() {
  const toggle = $("rosterToggle") as HTMLButtonElement;
  const menu = $("rosterMenu");
  const wasOpen = !menu.hidden; // preserve open state so an async augment re-render doesn't slam it shut
  if (roster.length < 2) { toggle.hidden = true; menu.innerHTML = ""; closeRosterMenu(); return; }
  toggle.hidden = false;
  const grouped = roster.some((r) => r.kind); // poke5e GM view: trainer headers + team rows
  if (grouped) {
    const activeTrainer = activeRefTrainerKey();
    menu.innerHTML = roster
      .map((r) => {
        if (r.kind === "trainer") {
          const on = activeTrainer === r.id;
          const badge = r.writable ? '<span class="rm-badge rm-own" title="You can edit this trainer">✎</span>' : '<span class="rm-badge" title="Read-only — loaded by read key">read-only</span>';
          return `<button class="rm-row rm-trainer${on ? " active" : ""}" role="option" data-id="${esc(r.id)}"><span class="rc-name">${esc(r.name)}</span>${badge}</button>`;
        }
        const active = r.id === activeRef;
        return `<button class="rm-row rm-mon${active ? " active" : ""}" role="option" aria-selected="${active}" data-id="${esc(r.id)}"><span class="rc-name">${esc(r.name)}</span>${active ? '<span class="rm-check">✓</span>' : ""}</button>`;
      })
      .join("");
  } else {
    menu.innerHTML = roster
      .map((r) => {
        const active = r.id === activeRef;
        const av = r.avatar
          ? `<img class="rc-av" src="${esc(r.avatar)}" alt="" />`
          : `<span class="rc-av rc-av-ph" style="background:${badgeColor(r.name)}">${esc((r.name || "?").charAt(0).toUpperCase())}</span>`;
        return `<button class="rm-row${active ? " active" : ""}" role="option" aria-selected="${active}" data-id="${esc(r.id)}">${av}<span class="rc-name">${esc(r.name)}</span>${r.mine ? '<span class="rc-star" title="Your character">★</span>' : ""}${active ? '<span class="rm-check">✓</span>' : ""}</button>`;
      })
      .join("");
  }
  menu.querySelectorAll<HTMLButtonElement>(".rm-row").forEach((b) => {
    b.onclick = () => { closeRosterMenu(); const id = b.dataset.id!; if (id !== activeRef) switchTo(id); };
  });
  if (!wasOpen) closeRosterMenu(); // stay closed unless the menu was already open (async re-render)
}

function openRosterMenu() {
  ($("rosterMenu") as HTMLElement).hidden = false;
  const t = $("rosterToggle") as HTMLButtonElement;
  t.setAttribute("aria-expanded", "true"); t.classList.add("on");
  setTimeout(() => document.addEventListener("click", rosterOutside, true), 0);
}
function closeRosterMenu() {
  ($("rosterMenu") as HTMLElement).hidden = true;
  const t = $("rosterToggle") as HTMLButtonElement;
  t.setAttribute("aria-expanded", "false"); t.classList.remove("on");
  document.removeEventListener("click", rosterOutside, true);
}
function rosterOutside(e: MouseEvent) {
  const t = e.target as HTMLElement;
  if (!t.closest("#rosterMenu") && t.id !== "rosterToggle" && t.id !== "charName") closeRosterMenu();
}

// Perform the load for a roster ref WITHOUT touching activeRef/render — the caller decides. Handles
// a trainer key, a same-trainer Pokémon (pmon:<id>), a cross-trainer Pokémon (pmon:<id>@<key>, which
// loads that trainer first), or a DDB character. Updates poke5eTrainerKey for trainer loads so the
// main-process write-back context stays in sync with what's shown.
async function loadRef(ref: string): Promise<any> {
  if (ref.startsWith("pmon:")) {
    const body = ref.slice(5);
    const at = body.indexOf("@");
    if (at >= 0) {
      const id = Number(body.slice(0, at));
      const key = body.slice(at + 1);
      if (key !== poke5eTrainerKey) {
        const tres = await window.api.loadPoke5e(key);
        if (!tres.ok) return tres;
        poke5eTrainerKey = key;
      }
      return await window.api.loadPoke5ePokemon(id);
    }
    return await window.api.loadPoke5ePokemon(Number(body));
  }
  if (activeSource === "poke5e") {
    const r = await window.api.loadPoke5e(ref); // ref is a trainer read key
    if (r.ok) poke5eTrainerKey = ref;
    return r;
  }
  return await window.api.loadCharacter(ref);
}

// Switch the active party member (GM-mode). Serialized via a chain so rapid clicks apply in order
// (last wins) and can't leave the renderer and the main-process write-back context on different
// members — a cross-trainer load mutates shared main state, so ordering matters.
let switchSeq = 0;
let switchChain: Promise<void> = Promise.resolve();
function switchTo(ref: string): Promise<void> {
  const myseq = ++switchSeq;
  const run = () => (myseq === switchSeq ? doSwitch(ref) : Promise.resolve()); // skip superseded clicks
  switchChain = switchChain.then(run, run);
  return switchChain;
}

// Re-read the currently-shown character/Pokémon from its source — picks up changes made elsewhere
// (e.g. HP edited directly on poke5e.app, or a DDB sync). Serialized through the same switch chain.
function reloadCurrent(): Promise<void> {
  if (!activeRef) return Promise.resolve();
  const ref = activeRef;
  const run = async () => {
    setStatus("Reloading…");
    gmRosterCache = null; // a manual reload should re-fetch trainer teams too
    const res = await loadRef(ref);
    if (!res.ok) { setStatus(res.error || "Couldn't reload", true); return; }
    applyCharacter(res, ref);
    setStatus(`Reloaded ${res.model?.name ?? ""}`.trim());
  };
  switchChain = switchChain.then(run, run);
  return switchChain;
}

async function doSwitch(ref: string) {
  const prev = activeRef;
  const prevTrainerKey = poke5eTrainerKey;
  setStatus("Switching…");
  ddbConnected = false;
  ddbBusy = false;
  activeRef = ref;
  renderRoster(); // reflect the selection immediately
  const res = await loadRef(ref);
  if (!res.ok) {
    activeRef = prev;
    // If a cross-trainer load already switched the main context to another trainer, reload the
    // previously-shown member so a later HP edit can't write onto the half-loaded trainer.
    if (poke5eTrainerKey !== prevTrainerKey) await loadRef(prev).catch(() => {});
    renderRoster();
    setStatus((res.error || "Couldn't load that character") + (activeSource === "ddb" ? " (private sheets can't be loaded)" : ""), true);
    return;
  }
  applyCharacter(res, ref);
}

// Apply a loaded character payload (from any source) to the sheet state and render.
function applyCharacter(res: any, ref: string) {
  if (!res.ok) return setStatus(res.error || "Load failed", true);
  model = res.model;
  weapons = res.weapons || [];
  spellcasting = res.spellcasting || null;
  spellSlots = res.spellSlots || [];
  remaining = {};
  for (const s of spellSlots) remaining[s.level] = s.total - s.used;
  hitDice = res.hitDice || null;
  inventory = res.inventory || [];
  hp = res.hp || null;
  writable = res.writable ?? true;
  defenses = res.defenses || { resist: [], immune: [], vulnerable: [] };
  concentrating = null;
  deathSaves = { success: 0, fail: 0 };
  boundToken = loadBinding(ref); // restore a previously-bound token for this character (if any)
  enabled.clear(); // don't carry a previous character's enabled toggles (Bless, GWM…) onto this one
  lastRollRequest = null; // and don't let Reroll re-fire the previous character's roll
  ($("rerollBtn") as HTMLButtonElement).disabled = true;
  feats = res.feats || [];
  passives = res.passives || [];
  pokeMeta = res.poke || null;
  activeConditions = new Map(((res.conditions as any[]) || []).map((c: any) => [c.id, c.level ?? null]));
  acValue = typeof res.ac === "number" ? res.ac : null; // non-DDB sources send AC directly
  hpUndo = null;
  ($("hpUndo") as HTMLButtonElement).disabled = true;
  hitRemaining = {};
  hitPending = {};
  for (const pool of hitDice?.pools ?? []) hitRemaining[pool.die] = pool.total - pool.used;
  setStatus(`Loaded ${model.name}`);
  rememberLastChar(ref);
  if (res.readKey) { addPoke5eKey(res.readKey); poke5eTrainerKey = res.readKey; } // remember trainer + track the active one
  buildRosterFrom(res, ref);
  ($("sheet") as HTMLElement).hidden = false;
  render();
  refreshToggles();
  // VTT-side syncing applies to every source.
  detectAndSyncToken(); // show whether a matching Roll20 token is on the map
  setTimeout(detectAndSyncToken, 3000); // retry once in case the Roll20 game is still loading
  detectTemplateStyle(); // use the prettier D&D-5e roll cards if the game has that sheet
  setTimeout(detectTemplateStyle, 3500);
  refreshSession();
  startTurnPoll(); // alert when it's this character's turn in the tracker
  // DDB-only post-load: auth chip, slot poll, AC scrape off the embedded sheet.
  if (activeSource === "ddb") {
    refreshDdb();
    scheduleDdbRecheck();
    startDdbPoll();
    refreshAc();
  }
}

type DdbState = "checking" | "synced" | "signedin" | "signin";
function setDdbStatus(state: DdbState) {
  const el = $("ddbStatus");
  const text: Record<DdbState, string> = {
    checking: "DDB: checking…",
    synced: "DDB: synced ✓",
    signedin: "DDB: signed in ✓",
    signin: "DDB: sign in ↗",
  };
  el.textContent = text[state];
  el.className = "ddb-status " + (state === "synced" || state === "signedin" ? "ok" : state === "signin" ? "off" : "");
}

function applyDdbSlots(slots: any[]) {
  if (!slots || !slots.length) return; // couldn't read slots this time — don't downgrade auth state
  ddbConnected = true;
  for (const s of slots) remaining[s.level] = s.total - s.used;
  setDdbStatus("synced");
  renderSpells();
}

let ddbPoll: ReturnType<typeof setInterval> | null = null;
function startDdbPoll() {
  if (ddbPoll) return;
  ddbPoll = setInterval(async () => {
    if (!model || !writable) return; // read-only: don't let the pane's slots overwrite local tracking
    try {
      // If we're not showing "connected", keep re-checking auth so the chip self-heals
      // (e.g. the user signed in after load, or the first check missed a slow sheet render).
      if (!ddbAuthed) { await refreshDdb(); return; }
      const r = await window.api.ddbPeek();
      if (!r.slots || !r.slots.length) return; // pane not showing spells — leave state as-is
      const changed = r.slots.some((s) => (remaining[s.level] ?? -1) !== s.total - s.used);
      if (changed) applyDdbSlots(r.slots); // reflects slots you spent directly on DDB
    } catch {
      /* ignore transient */
    }
  }, 15000);
}

// Auth is the reliable signal (cobalt token) and resolves as soon as the DDB pane is on a
// dndbeyond origin — it does NOT wait for the character sheet to finish rendering, so a slow
// load can't leave the chip stuck on "sign in". Slot values then sync opportunistically.
async function refreshDdb(): Promise<boolean> {
  setDdbStatus("checking");
  let authed = false;
  try { authed = (await window.api.ddbAuth()).authed; } catch { authed = false; }
  ddbAuthed = authed;
  if (!authed) { ddbConnected = false; setDdbStatus("signin"); return false; }
  // Signed in — reflect that immediately (write-back is available); don't wait on the slower
  // slot sync, which needs the character sheet to finish rendering.
  ddbConnected = true;
  setDdbStatus("signedin");
  try {
    const res = await window.api.ddbSync();
    if (res.ok && res.slots.length) applyDdbSlots(res.slots); // upgrades chip to "synced ✓"
  } catch { /* slots not ready yet — still signed in */ }
  return true;
}

// After a load, the DDB pane may still be navigating/rendering. Re-check a few times so the
// status settles quickly once auth resolves, without waiting for the 15s poll.
let ddbRecheckTimers: ReturnType<typeof setTimeout>[] = [];
function scheduleDdbRecheck() {
  ddbRecheckTimers.forEach(clearTimeout);
  ddbRecheckTimers = [800, 2000, 4000, 8000].map((d) =>
    setTimeout(() => { if (!ddbAuthed) refreshDdb(); }, d),
  );
}

function setStatus(msg: string, err = false) {
  const s = $("status");
  s.textContent = msg;
  s.className = "status" + (err ? " err" : "");
}

// ---- Session log & statistics -------------------------------------------------
async function refreshSession() {
  try {
    const data = await window.api.sessionSync();
    renderSession(data);
  } catch {
    /* no game / transient */
  }
}

function renderCampaignOptions() {
  const sel = $("logCampaign") as HTMLSelectElement;
  const names: Record<string, string> = sessionData.campaigns || {};
  // every campaign id that appears in the store, plus any named ones
  const ids = new Set<string>(Object.keys(names));
  for (const r of sessionData.records) if (r.campaign) ids.add(r.campaign);
  const label = (id: string) => names[id] || `Campaign ${id}`;
  const opts = [`<option value="__all__">All campaigns</option>`, ...[...ids].map((id) => `<option value="${esc(id)}">${esc(label(id))}</option>`)];
  const want = opts.join("");
  if (sel.innerHTML !== want) sel.innerHTML = want;
  sel.value = logFilter.campaign;
}

let sessionData: { records: any[]; stats: any; currentCampaign?: string | null; campaigns?: Record<string, string> } = { records: [], stats: { players: [] } };
const logFilter = { player: "", d20Only: false, showGM: false, campaign: "__all__" };
let campaignPinned = false; // once we default the campaign filter to the current game, don't override the user
let liveTimer: ReturnType<typeof setInterval> | null = null;

/** Records visible to stats — filtered by selected campaign, and excluding GM rolls by default. */
function statRecords(): any[] {
  return sessionData.records.filter(
    (r) =>
      (logFilter.showGM || !r.isGM) &&
      (logFilter.campaign === "__all__" || (r.campaign ?? null) === logFilter.campaign),
  );
}

function renderSession(data: any) {
  sessionData = data;
  // Default the campaign filter to the game currently open (once), then keep it under user control.
  if (!campaignPinned && data.currentCampaign) { logFilter.campaign = data.currentCampaign; campaignPinned = true; }
  renderCampaignOptions();
  // Keep the player filter dropdown in sync with who has rolled (respecting the GM toggle).
  const sel = $("logPlayer") as HTMLSelectElement;
  const players: string[] = aggregate(statRecords()).players.map((p: any) => p.player);
  const have = [...sel.options].map((o) => o.value).filter(Boolean);
  if (players.length !== have.length || players.some((p) => !have.includes(p))) {
    const cur = sel.value;
    sel.innerHTML = `<option value="">All players</option>` + players.map((p) => `<option value="${esc(p)}">${esc(p)}</option>`).join("");
    sel.value = players.includes(cur) ? cur : "";
    logFilter.player = sel.value;
  }
  renderStats();
  renderLog();
}

function renderStats() {
  const stats = aggregate(statRecords());
  ($("logMeta") as HTMLElement).textContent = stats.totalRolls ? `${stats.totalRolls} rolls · ${stats.totalNat20}×✦ · ${stats.totalNat1}×✗` : "no rolls yet";
  const st = $("statsTable");
  if (!stats.players.length) { st.innerHTML = `<div class="empty">Open a Roll20 game and roll — this fills from the game chat.</div>`; return; }
  const luckiest = stats.players.reduce((a: any, b: any) => ((b.luck ?? 0) > (a.luck ?? 0) ? b : a), stats.players[0]);
  let h = `<table><thead><tr><th>Player</th><th>Rolls</th><th title="average natural d20 (10.5 is fair)">⌀d20</th><th title="natural 20s">✦</th><th title="natural 1s">✗</th><th title="total damage dealt">Dmg</th></tr></thead><tbody>`;
  for (const p of stats.players) {
    const crown = p === luckiest && (p.luck ?? 0) > 0 ? " 👑" : "";
    h += `<tr><td class="pl">${esc(p.player)}${crown}</td><td>${p.rolls}</td><td>${p.avgD20 ?? "–"}</td><td class="c">${p.nat20 || ""}</td><td class="f">${p.nat1 || ""}</td><td class="dmg-col">${p.damage || ""}</td></tr>`;
  }
  st.innerHTML = h + `</tbody></table>`;
}

function filteredRecords(): any[] {
  return statRecords().filter(
    (r) => (!logFilter.player || r.player === logFilter.player) && (!logFilter.d20Only || r.d20),
  );
}

function renderLog() {
  const log = $("rollLog");
  const recent = filteredRecords().slice(-40).reverse();
  if (!recent.length) {
    log.innerHTML = `<div class="empty">No rolls${logFilter.player || logFilter.d20Only ? " match the filter" : " yet"}.</div>`;
    return;
  }
  log.innerHTML = recent
    .map((r) => {
      const cls = r.crit ? "crit" : r.fumble ? "fumble" : "";
      const badge = r.crit
        ? `<span class="badge nat20">✦20</span>`
        : r.fumble
          ? `<span class="badge nat1">✗1</span>`
          : r.rawD20 != null
            ? `<span class="rawd" title="natural d20">${r.rawD20}</span>`
            : "";
      const who = r.character ? `${esc(r.player)} · ${esc(r.character)}` : esc(r.player);
      const tip = r.breakdown ? ` title="${esc(r.breakdown)}"` : "";
      const dmg = r.damage ? `<span class="lr-dmg" title="damage">${r.damage}⚔</span>` : "";
      return `<div class="logrow ${cls}"${tip}><span class="lr-ts">${esc(r.ts ?? "")}</span><span class="lr-who">${who}</span><span class="lr-name">${esc(r.name)}</span>${badge}${dmg}<span class="lr-tot">${r.total ?? ""}</span></div>`;
    })
    .join("");
}

// Escapes for BOTH text and attribute contexts (quotes included), so a name with a `"` can't
// break out of an attribute value. Single source of truth for HTML escaping in the renderer.
function esc(s: any): string {
  return String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&#39;" })[c]!);
}

async function doExport(kind: "json" | "csv-log" | "csv-stats") {
  const res = await window.api.sessionExport(kind);
  if (res.ok) setStatus(`Exported → ${res.path}`);
  else if (!res.canceled) setStatus("Export failed", true);
}

// A Pokémon's header meta line: types / nature / tera / status / bond, plus live chips for any
// HP-/status-gated passive that is currently ON (🛡). Re-run whenever HP or status changes.
function renderPokeChips() {
  if (!pokeMeta) return;
  const bits = [`Level ${model.level}`];
  if (pokeMeta.types.length) bits.push(pokeMeta.types.map(cap).join("/") + (pokeMeta.shiny ? " ✨" : ""));
  if (pokeMeta.nature) bits.push(pokeMeta.nature);
  if (pokeMeta.tera) bits.push("Tera " + cap(pokeMeta.tera));
  if (pokeMeta.status) bits.push("⚠ " + cap(pokeMeta.status));
  if (pokeMeta.bond.level) bits.push(`Bond ${pokeMeta.bond.level}`);
  for (const p of passives) if (p.cond !== "always" && condActive(p.cond)) bits.push(`🛡 ${p.ability}`);
  $("meta").textContent = bits.join(" · ");
}

function render() {
  $("charName").textContent = model.name;
  ($("roMode") as HTMLElement).hidden = writable; // badge only when read-only
  ($("keysBtn") as HTMLElement).hidden = activeSource !== "poke5e"; // key backup is poke5e-only
  ($("reloadChar") as HTMLElement).hidden = activeSource === "monster"; // monsters reload via search, not here
  if (!writable) ($("ddbStatus") as HTMLElement).hidden = true; // no source sync to show
  if (pokeMeta) renderPokeChips();
  else $("meta").textContent = `Level ${model.level} · Proficiency ${sgn(model.profBonus)}`;
  ($("initMod") as HTMLElement).textContent = sgn(model.initiative);

  const ab = $("abilities");
  ab.innerHTML = "";
  for (const a of ABILITIES) {
    const { score, mod } = model.abilities[a];
    const el = document.createElement("div");
    el.className = "abil";
    el.innerHTML = `<div class="name">${a}</div><div class="mod">${sgn(mod)}</div><div class="score">${score}</div>`;
    el.onclick = () => doRoll({ kind: "check", key: a });
    ab.appendChild(el);
  }

  const sv = $("saves");
  sv.innerHTML = "";
  for (const a of ABILITIES) {
    const s = model.saves[a];
    sv.appendChild(rollLine(`${a} Save`, s.mod, s.proficient ? "prof" : "", () => doRoll({ kind: "save", key: a })));
  }

  const sk = $("skills");
  sk.innerHTML = "";
  for (const key of Object.keys(SKILL_NAMES)) {
    const s = model.skills[key];
    if (!s) continue;
    const cls = s.expertise ? "exp" : s.proficient ? "prof" : "";
    sk.appendChild(rollLine(SKILL_NAMES[key]!, s.mod, cls, () => doRoll({ kind: "skill", key })));
  }

  renderVitals();
  renderConditions();
  renderHp();
  renderAttacks();
  renderSpells();
  renderInventory();
  renderHitDice();
  renderFeats();
  applyFilter();
}

function renderVitals() {
  if (!model) return;
  const items: { label: string; value: string | number }[] = [
    { label: "AC", value: acValue ?? "—" },
    { label: "Speed", value: `${model.speed} ft` },
    { label: "Init", value: sgn(model.initiative) },
    { label: "Pass Per", value: model.passives.perception },
    { label: "Pass Inv", value: model.passives.investigation },
    { label: "Pass Ins", value: model.passives.insight },
  ];
  $("vitals").innerHTML = items
    .map((i) => `<span class="vital"><span class="v-label">${i.label}</span><span class="v-val">${i.value}</span></span>`)
    .join("");
}

// Conditions: chips you tap to toggle. Active ones sync to D&D Beyond and auto-apply their roll
// effects (Poisoned → disadvantage, etc.) via the `condition-<slug>` rules on every roll.
function renderConditions() {
  const active = $("condActive");
  const list = $("condList");
  const addBtn = $("condAddBtn") as HTMLButtonElement;
  if (!model) { active.innerHTML = ""; addBtn.hidden = true; return; }
  addBtn.hidden = false;

  // Inline: only the ACTIVE conditions (click the ✕ to clear). Usually empty → near-zero space.
  const on = CONDITIONS.filter((c) => activeConditions.has(c.id));
  active.innerHTML = on
    .map((c) => `<button class="cond-chip on${c.effects.length ? " affects" : ""}" data-id="${c.id}" title="Clear ${esc(c.name)}">${esc(c.name)} <span class="cx">✕</span></button>`)
    .join("");
  active.querySelectorAll<HTMLElement>(".cond-chip").forEach((chip) => {
    chip.onclick = () => toggleCondition(Number(chip.dataset.id));
  });
  addBtn.textContent = on.length ? "＋" : "＋ Condition";

  // The picker popover: the full list, active ones checked. Toggling keeps it open for multi-select.
  list.innerHTML = CONDITIONS
    .map((c) => {
      const isOn = activeConditions.has(c.id);
      return `<button class="cond-opt${isOn ? " on" : ""}" data-id="${c.id}"><span class="cond-tick">${isOn ? "✓" : ""}</span>${esc(c.name)}${c.effects.length ? '<span class="cond-dot" title="affects your rolls">●</span>' : ""}</button>`;
    })
    .join("");
  list.querySelectorAll<HTMLElement>(".cond-opt").forEach((opt) => {
    opt.onclick = (e) => { e.stopPropagation(); toggleCondition(Number(opt.dataset.id)); };
  });
}

async function toggleCondition(id: number) {
  const wasActive = activeConditions.has(id);
  // Optimistic
  if (wasActive) activeConditions.delete(id);
  else activeConditions.set(id, null);
  renderConditions();
  if (writable) {
    const res = await window.api.ddbSetCondition(id, !wasActive, null).catch(() => ({ ok: false, error: "failed" } as any));
    if (!res.ok) {
      // revert
      if (wasActive) activeConditions.set(id, null); else activeConditions.delete(id);
      renderConditions();
      setStatus(res.error || "Couldn't update condition on D&D Beyond", true);
      return;
    }
  }
  const def = CONDITIONS.find((c) => c.id === id);
  const name = def?.name ?? "condition";
  setStatus(`${name} ${wasActive ? "cleared" : "applied"}${writable ? " on D&D Beyond ✓" : ""}`);
  // Announce to the Roll20 table. Sent AS the character (speaking-as), so Roll20 prefixes the
  // sender's name itself. A clean, symmetric one-line template — no dice, no repeated name.
  if (model?.name) {
    const label = wasActive ? "Condition Cleared" : "Condition Gained";
    window.api.roll20Say(`&{template:default} {{${label}=${name}}}`, model.name).catch(() => {});
  }
}

/** The `condition-<slug>` rule ids for currently-active conditions — merged into every roll's
 *  enabled toggles so their effects (dis/advantage) apply automatically. */
function activeConditionRuleIds(): string[] {
  const ids: string[] = [];
  for (const c of CONDITIONS) if (activeConditions.has(c.id) && c.effects.length) ids.push(`condition-${c.slug}`);
  return ids;
}

// AC comes from the DDB sheet DOM (always correct there); the pane may still be rendering, so retry.
async function refreshAc(tries = 6) {
  const res = await window.api.ddbReadAc().catch(() => ({ ac: null }));
  if (res.ac != null) { acValue = res.ac; renderVitals(); return; }
  if (tries > 0) setTimeout(() => refreshAc(tries - 1), 1500);
}

function renderHp() {
  const sec = sectionEl("hp");
  if (!hp) { sec.hidden = true; return; }
  sec.hidden = false;
  const pct = hp.max > 0 ? Math.max(0, Math.min(100, (hp.current / hp.max) * 100)) : 0;
  const fill = $("hpFill");
  fill.style.width = pct + "%";
  fill.className = "hp-fill" + (hp.current <= 0 ? " dead" : hp.current <= hp.max * 0.25 ? " low" : "");
  $("hpText").textContent = `${hp.current} / ${hp.max}` + (hp.temp > 0 ? `  +${hp.temp} temp` : "");
  const tempEl = $("hpTemp") as HTMLInputElement;
  if (document.activeElement !== tempEl) tempEl.value = hp.temp ? String(hp.temp) : "";
  renderDefenses();
  renderConcentration();
  renderDeathSaves();
  renderBindToken();
  updateHpMeta();
}

// Show the character's damage resistances / immunities / vulnerabilities (from D&D Beyond).
function renderDefenses() {
  const el = $("defenses");
  const parts: string[] = [];
  if (defenses.immune.length) parts.push(`<span class="def immune" title="No damage">Immune: ${defenses.immune.map(cap).join(", ")}</span>`);
  if (defenses.resist.length) parts.push(`<span class="def resist" title="Half damage">Resist: ${defenses.resist.map(cap).join(", ")}</span>`);
  if (defenses.vulnerable.length) parts.push(`<span class="def vuln" title="Double damage">Vulnerable: ${defenses.vulnerable.map(cap).join(", ")}</span>`);
  el.innerHTML = parts.join("");
  el.hidden = !parts.length;
}

// Concentration chip — set when you cast a concentration spell; click to drop.
function renderConcentration() {
  const el = $("concentration");
  if (!concentrating) { el.hidden = true; el.innerHTML = ""; return; }
  el.hidden = false;
  el.innerHTML = `<span class="conc-dot" title="Concentration">C</span> Concentrating: <b>${esc(concentrating.name)}</b> <button id="concEnd" class="mini-btn" title="Drop concentration">drop</button>`;
  ($("concEnd") as HTMLButtonElement).onclick = () => { concentrating = null; renderConcentration(); setStatus("Concentration dropped"); };
}

// Death saves — appear at 0 HP. Pips are click-to-set; the Roll button posts a d20 to Roll20.
function renderDeathSaves() {
  const el = $("deathSaves");
  if (!hp || hp.current > 0) { el.hidden = true; el.innerHTML = ""; if (deathSaves.success || deathSaves.fail) deathSaves = { success: 0, fail: 0 }; return; }
  el.hidden = false;
  const pips = (n: number, cls: string) => Array.from({ length: 3 }, (_, i) => `<span class="ds-pip ${cls} ${i < n ? "on" : ""}" data-kind="${cls}" data-i="${i}"></span>`).join("");
  const state = deathSaves.fail >= 3 ? `<b class="ds-dead">DEAD</b>` : deathSaves.success >= 3 ? `<b class="ds-stable">STABLE</b>` : "";
  el.innerHTML =
    `<span class="ds-label">Death Saves</span>` +
    `<span class="ds-group" title="Successes">${pips(deathSaves.success, "succ")}</span>` +
    `<span class="ds-group" title="Failures">${pips(deathSaves.fail, "fail")}</span>` +
    `<button id="dsRoll" class="mini-btn" title="Roll a death saving throw into Roll20">Roll d20</button> ${state}`;
  el.querySelectorAll<HTMLElement>(".ds-pip").forEach((p) => {
    p.onclick = () => {
      const i = Number(p.dataset.i), kind = p.dataset.kind as "succ" | "fail";
      const cur = kind === "succ" ? deathSaves.success : deathSaves.fail;
      const next = cur === i + 1 ? i : i + 1; // click the last-filled pip to unset it
      if (kind === "succ") deathSaves.success = next; else deathSaves.fail = next;
      renderDeathSaves();
    };
  });
  ($("dsRoll") as HTMLButtonElement).onclick = rollDeathSave;
}

// Post a plain d20 death save to Roll20 (players mark the result on the pips themselves).
function rollDeathSave() {
  const msg = templateStyle === "sheet"
    ? `&{template:simple} {{rname=Death Saving Throw}} {{mod=+0}} {{r1=[[1d20]]}}`
    : `&{template:default} {{name=Death Saving Throw}} {{Roll=[[1d20]]}}`;
  window.api.roll20Say(msg, model?.name).catch(() => {});
  setStatus("Death save rolled — mark success (≥10) or failure (<10); nat 20 = regain 1 HP");
}

// Bind HP tracking to one specific Roll20 token (disambiguates identical NPCs). Roll20's Jumpgate
// engine hides the on-map selection, so we present a picker of the map's tokens to choose from.
async function toggleBindToken() {
  if (boundToken) { boundToken = null; saveBinding(); renderBindToken(); setStatus("Token unbound — HP tracks locally"); return; }
  const res = await window.api.r20ListTokens().catch(() => ({ ok: false, tokens: [] as any[] }));
  if (!res.ok || !res.tokens.length) { setStatus("No tokens found — open your Roll20 game map first", true); return; }
  showBindPicker(res.tokens);
}

function showBindPicker(tokens: { id: string; name: string; bar1: string; bar1max: string; x: number; y: number }[]) {
  let el = document.getElementById("bindPicker");
  if (!el) { el = document.createElement("div"); el.id = "bindPicker"; el.className = "bind-picker"; el.hidden = true; document.body.appendChild(el); }
  const myName = (model?.name || "").toLowerCase();
  const sorted = [...tokens].sort(
    (a, b) => (b.name.toLowerCase() === myName ? 1 : 0) - (a.name.toLowerCase() === myName ? 1 : 0) || a.name.localeCompare(b.name),
  );
  el.innerHTML = sorted
    .map((tk) => {
      const hpStr = tk.bar1 != null && tk.bar1 !== "" ? `${esc(tk.bar1)}${tk.bar1max ? "/" + esc(tk.bar1max) : ""}` : "—";
      return `<div class="bp-row" data-id="${esc(tk.id)}" data-name="${esc(tk.name)}"><span class="bp-name">${esc(tk.name)}</span><span class="bp-meta">HP ${hpStr} · @${tk.x},${tk.y}</span></div>`;
    })
    .join("");
  const menu = el;
  // The picker is position:fixed (so the HP card's overflow:hidden can't clip it), which means it
  // must be re-pinned to the button whenever the sheet scrolls or the window resizes — otherwise it
  // stays put in the viewport while the button scrolls away.
  const reposition = () => {
    const rr = ($("bindToken") as HTMLElement).getBoundingClientRect();
    menu.style.left = Math.min(rr.left, window.innerWidth - 260) + "px";
    menu.style.top = rr.bottom + 4 + "px";
  };
  const onOutside = (e: MouseEvent) => {
    if (!(e.target as HTMLElement).closest("#bindPicker") && (e.target as HTMLElement).id !== "bindToken") cleanup();
  };
  const cleanup = () => {
    menu.hidden = true;
    document.removeEventListener("click", onOutside, true);
    window.removeEventListener("scroll", reposition, true);
    window.removeEventListener("resize", reposition);
  };
  reposition();
  menu.hidden = false;
  menu.querySelectorAll<HTMLElement>(".bp-row").forEach((row) => {
    row.onclick = () => {
      boundToken = { id: row.dataset.id!, name: row.dataset.name! };
      saveBinding(); // remember this binding for the character (survives restart / rename / map change)
      cleanup();
      renderBindToken();
      setStatus(`HP bound to “${boundToken.name}” — damage/heal now drives just that token`);
      if (hp) window.api.r20SetTokenHpById(boundToken.id, hp.current, hp.max, hp.temp > 0 ? hp.temp : undefined).catch(() => {}); // push current HP (+temp only if present)
    };
  });
  setTimeout(() => {
    document.addEventListener("click", onOutside, true);
    // capture=true so scroll on an inner scroll container is caught (scroll events don't bubble).
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("resize", reposition);
  }, 0);
}

function renderBindToken() {
  const b = $("bindToken") as HTMLButtonElement;
  if (boundToken) { b.textContent = `⚔ ${boundToken.name} ✕`; b.classList.add("on"); b.title = "Unbind — stop driving this token"; }
  else { b.textContent = "⚔ Bind token"; b.classList.remove("on"); b.title = "Bind HP to the token you've selected on Roll20"; }
}

// Write HP back to D&D Beyond (damage taken + temp), optimistic with revert on failure.
// Serializes the async DDB writes so rapid Damage/Heal/Undo clicks apply in order (no lost
// update, no out-of-order confirm clobbering a newer value). The optimistic UI update stays
// immediate; only the network write + reconcile is queued.
let hpChain: Promise<void> = Promise.resolve();

function commitHp(removed: number, temp: number, recordUndo = true) {
  if (!hp) return;
  const prevR = hp.removed, prevT = hp.temp;
  if (recordUndo && (prevR !== removed || prevT !== temp)) {
    hpUndo = { removed: prevR, temp: prevT };
    ($("hpUndo") as HTMLButtonElement).disabled = false;
  }
  hp.removed = removed; hp.temp = temp; hp.current = hp.max - removed;
  renderHp();
  // A Pokémon's HP-gated ability badges (⚡ Blaze at ≤25%) and passive chips (🛡 Multiscale at full)
  // depend on live HP%, so re-render them when HP changes — otherwise they'd only update on reload.
  if (pokeMeta) { renderSpells(); renderPokeChips(); }
  const run = () => hpWrite(removed, temp, prevR, prevT);
  hpChain = hpChain.then(run, run); // keep the chain alive even if a prior write threw
}

async function hpWrite(removed: number, temp: number, prevR: number, prevT: number) {
  // Read-only sheets (public characters, monsters): HP is already applied locally by commitHp —
  // skip the source write-back entirely, but still sync the Roll20 token (a VTT action).
  if (writable && activeSource === "poke5e") {
    // poke5e write-back: HP is already applied locally; save it to poke5e (trainer or Pokémon).
    if (!hp) return;
    const res = await window.api.poke5eSetHp(hp.current, hp.max).catch(() => ({ ok: false } as any));
    // Revert local HP on failure (unless a newer click superseded us), so the sheet never shows a
    // value poke5e didn't store — matching the DDB path below.
    if (!res.ok) {
      const stillLatest = hp.removed === removed && hp.temp === temp;
      if (stillLatest) {
        hp.removed = prevR; hp.temp = prevT; hp.current = hp.max - prevR;
        renderHp();
      }
      setStatus(res.error || "Couldn't save HP to poke5e", true);
      return;
    }
  } else if (writable) {
    const res = await window.api.ddbSetHp(removed, temp).catch(() => ({ ok: false } as any));
    if (!hp) return;
    // Only reconcile/revert if this is still the latest intended state — a newer click may have
    // superseded us while the request was in flight; don't clobber it.
    const stillLatest = hp.removed === removed && hp.temp === temp;
    if (!res.ok) {
      if (stillLatest) {
        hp.removed = prevR; hp.temp = prevT; hp.current = hp.max - prevR;
        renderHp();
        setStatus(res.error || res.message || "Couldn't update HP — sign in to the D&D Beyond pane", true);
      }
      return;
    }
    if (!stillLatest) return;
    if (typeof res.removed === "number") { hp.removed = res.removed; hp.current = hp.max - res.removed; }
    if (typeof res.temp === "number") hp.temp = res.temp;
    renderHp();
  } else if (!hp) {
    return;
  }
  // Push HP to a Roll20 token bar. If the GM has BOUND a specific token, drive exactly that one
  // (so multiple identically-named NPCs don't all get clobbered). Otherwise, a writable PC (unique
  // name) syncs by name; a read-only monster with no bound token stays local-only.
  // Only drive the token's blue (temp) bar when the character actually HAS temp HP (fill), or just
  // SPENT it (prevT > 0 → clear). If temp is and was 0, pass undefined so we never blank a bar the
  // token uses for something else (AC/speed) on a character that never uses temp HP.
  const tempArg = hp.temp > 0 ? hp.temp : prevT > 0 ? 0 : undefined;
  let tokenNote = "";
  if (boundToken) {
    let tk = await window.api.r20SetTokenHpById(boundToken.id, hp.current, hp.max, tempArg).catch(() => null);
    // Auto-rebind: if the bound token's id is gone (map change / deleted+recreated), re-resolve by
    // its name among the tokens you control on the current page. Exactly one match → rebind + retry.
    if (tk?.reason === "token-gone" && boundToken) {
      const list = await window.api.r20ListTokens().catch(() => ({ ok: false, tokens: [] as any[] }));
      const matches = (list.tokens || []).filter((t) => t.name === boundToken!.name);
      if (matches.length === 1) {
        boundToken = { id: matches[0].id, name: matches[0].name };
        saveBinding();
        tk = await window.api.r20SetTokenHpById(boundToken.id, hp.current, hp.max, tempArg).catch(() => null);
        if (tk?.ok) tk = { ...tk, rebound: true } as any;
      }
    }
    const reason = tk?.reason === "not-controlled" ? "you don't control this token" : tk?.reason === "token-gone" ? "token not on this map — re-bind it" : tk?.reason || "not updated";
    tokenNote = tk?.ok ? ` · ⚔ ${boundToken.name} ✓${(tk as any).rebound ? " (re-bound)" : ""}` : ` · ⚔ ${boundToken.name}: ${reason}`;
  } else if (writable && model?.name) {
    const tk = await window.api.r20SetTokenHp(model.name, hp.current, hp.max, tempArg).catch(() => null);
    tokenSync = tk;
    if (tk?.ok) tokenNote = " · Roll20 token ✓";
    else if (tk && tk.found > 0 && tk.linked) tokenNote = " · token bar is linked (edit on the sheet)";
    // Tokens matched by name but every one was skipped because you don't control them.
    else if (tk && tk.found > 0 && (tk.blocked ?? 0) > 0 && (tk.wrote ?? 0) === 0) tokenNote = " · Roll20 token: you don't control it";
    updateHpMeta();
  }
  const where = !writable ? "(local)" : activeSource === "poke5e" ? "on poke5e ✓" : "on D&D Beyond ✓";
  setStatus(`HP ${hp.current}/${hp.max}${hp.temp ? ` (+${hp.temp} temp)` : ""} ${where}${tokenNote}`);
}

// Show whether a matching Roll20 token is being kept in sync, next to the HP heading.
let tokenSync: { ok?: boolean; found: number; bar?: string; linked?: boolean } | null = null;
let boundToken: { id: string; name: string } | null = null; // a specific Roll20 token HP is bound to
function updateHpMeta() {
  const el = $("hpMeta") as HTMLElement;
  const bits: string[] = [];
  if (hp && hp.current <= 0) bits.push("unconscious");
  else if (hp && hp.current <= hp.max * 0.25) bits.push("bloodied");
  if (tokenSync?.found) bits.push(tokenSync.linked ? "⚔ token (linked)" : tokenMismatch ? `⚔ token ${tokenMismatch} ≠ sheet` : "⚔ token synced");
  el.textContent = bits.join(" · ");
}

// On load / entering a game, detect the matching token so the HP card shows its sync state.
// We DON'T overwrite the token here (you may have changed it in Roll20) — the app pushes to the
// token only when you actively change HP via the Damage/Heal controls. We just flag a mismatch.
let tokenMismatch: string | null = null;
let myTokenIds: string[] = []; // the character's Roll20 token ids, for "your turn" matching
async function detectAndSyncToken() {
  if (!model?.name || !hp) { tokenSync = null; myTokenIds = []; return; }
  const res = await window.api.r20FindToken(model.name, hp.max).catch(() => null);
  if (!res?.ok || !res.tokens.length) { tokenSync = { found: 0 }; tokenMismatch = null; myTokenIds = []; updateHpMeta(); return; }
  myTokenIds = res.tokens.map((t) => t.id).filter(Boolean);
  tokenSync = { found: res.tokens.length, linked: res.tokens.every((t) => t.linked) };
  const tok = res.tokens[0];
  tokenMismatch = !tok.linked && String(tok.value) !== String(hp.current) ? `${tok.value}/${tok.max}` : null;
  updateHpMeta();
}

// Pick the roll-card style based on the open Roll20 game — the D&D 5e sheet's templates render as
// clean cards; without it we fall back to the universal (plainer) default template.
async function detectTemplateStyle() {
  // poke5e is a non-D&D-5e context. A Pokémon Roll20 campaign has NONE of the D&D 5e rolltemplates
  // (atkdmg / simple / spell) — verified live — so any card we emit with them renders as an EMPTY
  // chat message (rolls included, not just announcements). Force Roll20's built-in `default`
  // template, which renders in any campaign. (Detection can wrongly report "sheet" if the campaign's
  // Pokémon sheet happens to define some unrelated sheet-rolltemplate-* class.)
  if (activeSource === "poke5e") { templateStyle = "default"; return; }
  const res = await window.api.roll20SheetStyle().catch(() => ({ style: "default" as const }));
  templateStyle = res.style;
}

// The rolltemplate to use for a no-dice ANNOUNCEMENT (item use, utility move). poke5e campaigns
// frequently have the D&D `atkdmg` template (so dice rolls render) but NOT `simple` — which made
// text-only announcements render as an empty card. Use the universal `default` template for poke5e
// announcements so they always show; D&D 5e keeps its nicer `simple` card.
function announceTemplate(line: string): string {
  if (activeSource !== "poke5e" && templateStyle === "sheet") return `&{template:simple} {{rname=${line}}}`;
  return `&{template:default} {{name=${line}}}`;
}

// Watch the Roll20 turn order and alert when it becomes this character's turn.
let turnPoll: ReturnType<typeof setInterval> | null = null;
let lastTurnTop: string | null = null;
function startTurnPoll() {
  if (turnPoll) return;
  turnPoll = setInterval(async () => {
    if (!model || !myTokenIds.length) return;
    const top = await window.api.r20TurnTop().catch(() => null);
    if (!top || !top.id) return;
    if (top.id === lastTurnTop) return; // only fire on a change of whose turn it is
    lastTurnTop = top.id;
    if (myTokenIds.includes(top.id)) {
      window.api.notify("⚔ Your turn!", `${model.name}, you're up in initiative.`).catch(() => {});
      setStatus(`⚔ It's your turn! (${model.name})`);
    }
  }, 4000);
}

async function applyHp(kind: "damage" | "heal") {
  if (!hp) return;
  const amtEl = $("hpAmount") as HTMLInputElement;
  const raw = Math.max(0, Math.floor(Number(amtEl.value) || 0));
  if (!raw) return;
  let removed = hp.removed, temp = hp.temp;
  if (kind === "heal") {
    removed = Math.max(0, removed - raw); // healing can't exceed max
    amtEl.value = "";
    await commitHp(removed, temp);
    return;
  }
  // Damage: apply resistance/immunity/vulnerability for the chosen type, then temp HP soak.
  const type = ($("hpDamageType") as HTMLSelectElement).value; // "" = untyped
  let d = raw;
  let effect = "";
  if (type) {
    if (defenses.immune.includes(type)) { d = 0; effect = ` — immune to ${cap(type)}`; }
    else if (defenses.resist.includes(type)) { d = Math.floor(d / 2); effect = ` — ${cap(type)} resisted (halved)`; }
    else if (defenses.vulnerable.includes(type)) { d = d * 2; effect = ` — vulnerable to ${cap(type)} (doubled)`; }
  }
  const dmgTaken = d; // post-defense damage actually taken — drives the concentration DC
  if (temp > 0) { const absorbed = Math.min(temp, d); temp -= absorbed; d -= absorbed; } // temp HP soaks first
  removed = Math.min(hp.max, removed + d);
  amtEl.value = "";
  await commitHp(removed, temp);
  if (dmgTaken > 0) setStatus(`Took ${dmgTaken} damage${effect}`);
  // Concentration: taking damage forces a CON save (DC 10 or half the damage, whichever higher).
  if (concentrating && hp.current > 0 && dmgTaken > 0) promptConcentration(dmgTaken);
  if (hp.current <= 0 && concentrating) { concentrating = null; renderConcentration(); } // 0 HP drops concentration
}

// On taking damage while concentrating, auto-roll the CON save into Roll20 and show the DC.
function promptConcentration(dmgTaken: number) {
  if (!concentrating) return;
  const dc = Math.max(10, Math.floor(dmgTaken / 2));
  setStatus(`Concentration! CON save DC ${dc} to keep ${concentrating.name}`, true);
  doRoll({ kind: "save", key: "CON" }); // one-click: post the CON save
}

function renderHitDice() {
  const sec = sectionEl("rests");
  const box = $("hitDice");
  const pools: any[] = hitDice?.pools ?? [];
  if (!pools.length) { sec.hidden = true; return; }
  sec.hidden = false;
  const pendingTotal = Object.values(hitPending).reduce((a, b) => a + b, 0);
  const metaBits = [`heal ${sgn(hitDice.conMod)} / die`];
  if (pendingTotal) metaBits.push(`${pendingTotal} to spend`);
  ($("restMeta") as HTMLElement).textContent = metaBits.join(" · ");
  box.innerHTML = pools
    .map((p) => {
      const rem = hitRemaining[p.die] ?? 0;
      const pend = hitPending[p.die] ?? 0;
      let pips = "";
      for (let i = 0; i < p.total; i++) {
        // full = still available; spent (empty) that is staged this rest gets a distinct look.
        const staged = i >= rem && i < rem + pend;
        pips += `<span class="pip hd ${i < rem ? "full" : staged ? "staged" : ""}" data-die="${p.die}" data-i="${i}"></span>`;
      }
      return `<div class="hd-row"><span class="hd-label">Hit Dice ${p.total}d${p.die}</span><span class="pips">${pips}</span><span class="hd-heal">1d${p.die}${sgn(hitDice.conMod)}</span></div>`;
    })
    .join("");
  box.querySelectorAll<HTMLElement>(".pip.hd").forEach((pip) => {
    pip.onclick = () => {
      const die = Number(pip.dataset.die);
      if (pip.classList.contains("full")) spendHitDie(die);
      else {
        // Un-spend the most recent staged die (correcting a mis-click before you commit).
        const total = pools.find((x) => x.die === die)?.total ?? 0;
        hitRemaining[die] = Math.min(total, (hitRemaining[die] ?? 0) + 1);
        hitPending[die] = Math.max(0, (hitPending[die] ?? 0) - 1);
        renderHitDice();
      }
    };
  });
}

// Spend one hit die: roll the heal to Roll20 now, and stage it for the next Short Rest
// (which writes hitDiceUsed back to D&D Beyond on commit). Nothing hits DDB until you
// press Short Rest, so several spends batch into one real short rest.
function spendHitDie(die: number) {
  const rem = hitRemaining[die] ?? 0;
  if (rem <= 0) { setStatus(`No d${die} Hit Dice left`, true); return; }
  hitRemaining[die] = rem - 1;
  hitPending[die] = (hitPending[die] ?? 0) + 1;
  renderHitDice();
  const mod = hitDice.conMod;
  sendRoll({ kind: "damage", key: "Hit Die (heal)", baseDamage: mod ? `1d${die} + ${mod}` : `1d${die}` });
}

function renderAttacks() {
  const sec = sectionEl("attacks");
  const box = $("attacks");
  box.innerHTML = "";
  if (!weapons.length) { sec.hidden = true; return; }
  sec.hidden = false;
  for (const w of weapons) {
    const dmg = w.damageMod ? `${w.damageDice}${w.damageMod >= 0 ? "+" : ""}${w.damageMod}` : w.damageDice;
    const b = document.createElement("button");
    b.className = "roll-line atk";
    // Save-based action (breath weapon, …) shows its DC instead of a to-hit; otherwise the attack bonus.
    const left = w.save ? `<span class="dmg">${esc(w.save.ability)} DC ${esc(w.save.dc)}</span>` : `<span class="mod">${sgn(w.attackMod)}</span>`;
    const twoHint = w.versatileDamage ? ` <span class="two-hint">(2H ${esc(w.versatileDamage)})</span>` : "";
    b.innerHTML = `<span class="label"><span class="dot ${w.proficient ? "prof" : ""}"></span>${esc(w.name)}</span>` +
      `<span class="atk-nums">${left}<span class="dmg">${esc(dmg)} ${esc(w.damageType || "")}${twoHint}</span></span>`;
    b.onclick = () => sendRoll(weaponReq(w));
    // Versatile weapon → a "2H" button that rolls the two-handed die (same to-hit / mod).
    if (w.versatileDamage) {
      const wrap = document.createElement("div");
      wrap.className = "atk-2h-row";
      b.classList.add("grow");
      wrap.appendChild(b);
      const two = document.createElement("button");
      two.className = "mini-btn two-hand";
      two.textContent = "2H";
      two.title = `Roll two-handed (${w.versatileDamage})`;
      two.onclick = () => sendRoll(weaponReq({ ...w, name: `${w.name} (2H)`, damageDice: w.versatileDamage }));
      wrap.appendChild(two);
      box.appendChild(wrap);
    } else {
      box.appendChild(b);
    }
  }
}

// Build a roll request for a rollable item (heal potion / offensive consumable). Utility → null.
function itemReq(it: any): any | null {
  if (it.kind === "heal" && it.dice) return { kind: "damage", key: `${it.name} (heal)`, baseDamage: it.dice };
  if (it.kind === "damage" && it.dice) return { kind: "damage", key: it.name, baseDamage: it.dice, damageType: it.damageType };
  return null;
}

function renderFeats() {
  const sec = sectionEl("features");
  const box = $("features");
  if (!feats.length) { sec.hidden = true; box.innerHTML = ""; return; }
  sec.hidden = false;
  box.innerHTML = feats
    .map((f) => `<div class="feat"><div class="feat-name">${esc(f.name)}</div>${f.description ? `<div class="feat-desc">${esc(f.description)}</div>` : ""}</div>`)
    .join("");
}

function renderInventory() {
  const sec = sectionEl("items");
  const box = $("items");
  box.innerHTML = "";
  if (!inventory.length) { sec.hidden = true; return; }
  sec.hidden = false;
  const rollableCount = inventory.filter((it) => it.kind === "heal" || it.kind === "damage").length;
  ($("itemMeta") as HTMLElement).textContent = rollableCount ? `${rollableCount} rollable` : "";
  for (const it of inventory) {
    const rollable = it.kind === "heal" || it.kind === "damage";
    // Consumables (and any stackable) get quantity controls + a Use action; equipment is reference.
    const managed = it.consumable || it.quantity > 1;
    const row = document.createElement("div");
    row.className = "item-row";

    // Main label / roll target. Rollable items roll on click (no consume — preview/reroll).
    const label = document.createElement(rollable ? "button" : "div");
    // Usable consumables read as active (white); only pure reference gear is dimmed.
    const isReference = !rollable && !it.consumable;
    label.className = "roll-line item" + (rollable ? "" : " noroll") + (isReference ? " reference" : "");
    let nums = "";
    if (it.kind === "heal") nums = `<span class="dmg heal">${esc(it.dice)}</span>`;
    else if (it.kind === "damage") nums = `<span class="dmg">${esc(it.dice)}${it.damageType ? " " + esc(it.damageType) : ""}</span>`;
    else {
      const note = it.attuned ? "attuned" : it.magic ? "magic" : "";
      nums = `<span class="item-note">${esc(it.typeName)}${note ? " · " + note : ""}</span>`;
    }
    label.innerHTML = `<span class="label">${esc(it.name)}</span><span class="atk-nums">${nums}</span>`;
    if (rollable) (label as HTMLButtonElement).onclick = () => sendRoll(itemReq(it));
    row.appendChild(label);

    // Quantity stepper + Use, for consumables / stackables.
    if (managed) {
      const ctl = document.createElement("div");
      ctl.className = "item-ctl";
      const minus = mkMini("−", () => adjustItemQty(it, -1), "Decrease quantity on D&D Beyond");
      const count = document.createElement("span");
      count.className = "item-qty";
      count.textContent = `×${it.quantity}`;
      const plus = mkMini("+", () => adjustItemQty(it, +1), "Increase quantity on D&D Beyond");
      ctl.append(minus, count, plus);
      if (it.consumable) {
        const use = mkMini("Use", () => useItem(it), "Use one — rolls dice (if any) and decrements on D&D Beyond");
        use.classList.add("use-btn");
        if (it.quantity <= 0) (use as HTMLButtonElement).disabled = true;
        ctl.appendChild(use);
      }
      if (it.quantity <= 0) (minus as HTMLButtonElement).disabled = true;
      row.appendChild(ctl);
    }
    box.appendChild(row);
  }
}

function mkMini(text: string, onclick: () => void, title = ""): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "mini-btn item-mini";
  b.textContent = text;
  if (title) b.title = title;
  b.onclick = (e) => { e.stopPropagation(); onclick(); };
  return b;
}

// Use one consumable. Optimistic + responsive: roll/announce immediately and decrement on
// D&D Beyond in the background (adjustItemQty updates the local count instantly and reverts if
// the write fails). We trust the local quantity rather than round-tripping DDB first — the Use
// button is already disabled at 0, and this keeps clicks snappy.
async function useItem(it: any) {
  if (it.quantity <= 0) return;
  const req = itemReq(it);
  if (req) sendRoll(req); // Potion of Healing rolls 2d4+2 …
  else announceUse(it); // … utility consumables (Fire Resistance etc.) announce the use instead
  const ok = await adjustItemQty(it, -1, /*silent*/ true);
  if (ok) setStatus(`Used ${it.name}${req ? " (rolled)" : ""} — ${Math.max(0, it.quantity)} left`);
}

// Announce a no-dice consumable (Potion of Fire Resistance, etc.) on the table so a "Use" is
// visible in Roll20 even when there's nothing to roll. Respects the detected sheet style.
function announceUse(it: any) {
  const name = it.name || "item";
  // Capture items read as a throw; everything else is "Uses". Match on the poke5e item TYPE
  // (e.g. "pokeball") only — not the display name, which would misfire on "Snowball"/"Eyeball".
  const line = /ball/i.test(String(it.itemType || "")) ? `Threw a ${name}` : `Uses ${name}`;
  window.api.roll20Say(announceTemplate(line), model?.name).catch(() => {});
}

// Adjust an item's quantity by ±1, writing back to D&D Beyond. Targets the right underlying row:
// for −, the first row with qty>0; for +, the first row. Returns whether the write succeeded.
async function adjustItemQty(it: any, delta: number, silent = false): Promise<boolean> {
  const entries: { id: number; quantity: number }[] = it.entries ?? [];
  if (delta < 0 && it.quantity <= 0) return false;
  const target = delta < 0 ? entries.find((e) => e.quantity > 0) : entries[0];
  // Local-only for read-only sheets AND any non-DDB source: the ddbItemSetQty endpoint only exists
  // for D&D Beyond. poke5e/monster bags decrement locally (poke5e has no item-write RPC), so we must
  // NOT route their "Use"/± through the DDB path (which would NaN the id and snap the count back).
  if (!writable || activeSource !== "ddb") {
    if (target) target.quantity = Math.max(0, target.quantity + delta);
    it.quantity = entries.length ? entries.reduce((a, e) => a + e.quantity, 0) : Math.max(0, it.quantity + delta);
    renderInventory();
    return true;
  }
  if (!target) {
    // No DDB row id (shouldn't happen) — adjust locally only.
    it.quantity = Math.max(0, it.quantity + delta);
    renderInventory();
    return false;
  }
  const newQ = Math.max(0, target.quantity + delta);
  // Optimistic local update.
  target.quantity = newQ;
  it.quantity = entries.reduce((a, e) => a + e.quantity, 0);
  renderInventory();

  // Always attempt the write — inventory auth is its own cobalt token, independent of whether
  // the spell-slot managers are rendered (so this works for non-casters too). Revert on failure.
  const res = await window.api.ddbItemSetQty(target.id, newQ);
  if (!res.ok) {
    if ((res as any).stale) {
      // The row id no longer exists on DDB (inventory changed underneath us) — reconcile fully.
      setStatus("Inventory out of sync — pulling latest from D&D Beyond…", true);
      await syncInventory();
      return false;
    }
    // Revert the optimistic change.
    target.quantity -= delta;
    it.quantity = entries.reduce((a, e) => a + e.quantity, 0);
    renderInventory();
    setStatus(res.error || res.message || "Couldn't update quantity — sign in to the D&D Beyond pane", true);
    return false;
  }
  // Trust the server-confirmed quantity (self-heals if the optimistic value was off).
  if (typeof res.quantity === "number") target.quantity = res.quantity;
  it.quantity = entries.reduce((a, e) => a + e.quantity, 0);
  renderInventory();
  if (!silent) setStatus(`${it.name} → ×${it.quantity} on D&D Beyond ✓`);
  return true;
}

function slotPips(level: number): string {
  const slot = spellSlots.find((s) => s.level === level);
  if (!slot) return "";
  const rem = remaining[level] ?? 0;
  let html = `<span class="pips" data-level="${level}">`;
  for (let i = 0; i < slot.total; i++) html += `<span class="pip ${i < rem ? "full" : ""}" data-level="${level}" data-i="${i}"></span>`;
  html += `</span>`;
  return html;
}

function spellTags(sp: any): string {
  let t = "";
  if (sp.concentration) t += `<span class="stag conc" title="Concentration">C</span>`;
  if (sp.ritual) t += `<span class="stag rit" title="Ritual">R</span>`;
  if (sp.castingTime === "bonus") t += `<span class="stag ct" title="Bonus action">BA</span>`;
  else if (sp.castingTime === "reaction") t += `<span class="stag ct" title="Reaction">RXN</span>`;
  if (sp.moveHint) t += `<span class="stag ct" title="${esc(sp.moveHint)}">⏳</span>`; // charge / recharge
  return t;
}

function spellRow(sp: any): HTMLElement {
  const b = document.createElement("button");
  const lvl = sp.isCantrip ? 0 : sp.level;
  // A leveled spell whose slot pool for its level is empty can't be cast — mark it so the UI
  // reads as unavailable (castSpell also hard-blocks the cast).
  const usesSlot = lvl > 0 && spellSlots.some((s) => s.level === lvl);
  const outOfPp = !!(sp.pp && sp.pp.max > 0 && sp.pp.current <= 0);
  const depleted = (usesSlot && (remaining[lvl] ?? 0) <= 0) || outOfPp;
  b.className = "roll-line spell " + sp.casting + (depleted ? " depleted" : "");
  if (depleted) b.title = outOfPp ? "No PP left" : `No level ${lvl} spell slots left`;
  let right = "";
  const sd = spellDamage(sp); // full damage incl. any secondary component
  if (sp.casting === "attack") right = `<span class="mod">${sgn(sp.attackBonus)}</span><span class="dmg">${esc(sd.dice || "")} ${esc(sd.type || "")}</span>`;
  else if (sp.casting === "save") right = `<span class="dmg">${esc(sp.saveAbility || "")} DC ${esc(sp.saveDc)} · ${esc(sd.dice || "—")}</span>`;
  else if (sp.healDice) right = `<span class="dmg heal">heal ${esc(sp.healDice)}</span>`;
  else if (sp.autoHit && sp.damageDice) right = `<span class="dmg">${esc(sp.damageDice)} ${esc(sp.damageType || "")}</span>`; // guaranteed-hit damage
  else if (sp.rollDie) right = `<span class="dmg">roll ${esc(sp.rollDie)}</span>`; // OHKO / prose die
  else right = `<span class="dmg util">cast</span>`;
  const pp = sp.pp && sp.pp.max > 0 ? `<span class="pp">${sp.pp.current}/${sp.pp.max} PP</span>` : "";
  b.innerHTML = `<span class="label">${esc(sp.name)}<span class="stags">${spellTags(sp)}${abilityBadge(sp)}</span></span><span class="atk-nums">${right}${pp}</span>`;
  b.onclick = () => castSpell(sp);
  return b;
}

function renderSpells() {
  const sec = sectionEl("spells");
  const box = $("spells");
  box.innerHTML = "";
  const info = spellcasting;
  const title = sec.querySelector<HTMLElement>(".section-title");
  if (title) title.textContent = pokeMeta ? "Moves" : "Spells"; // Pokémon use "Moves"
  if (!info || !info.spells?.length) { sec.hidden = true; return; }
  sec.hidden = false;
  const c = info.classes?.[0];
  ($("spellMeta") as HTMLElement).textContent = c ? `atk ${sgn(c.attackBonus)} · DC ${c.saveDc}` : "";

  const order = ["attack", "save", "utility"];
  const byLevel = new Map<number, any[]>();
  for (const sp of info.spells) {
    const lvl = sp.isCantrip ? 0 : sp.level;
    if (!byLevel.has(lvl)) byLevel.set(lvl, []);
    byLevel.get(lvl)!.push(sp);
  }
  const levels = [...byLevel.keys()].sort((a, b) => a - b);
  for (const lvl of levels) {
    const group = document.createElement("div");
    group.className = "spell-group";
    const head = document.createElement("div");
    head.className = "spell-group-head";
    const label = lvl === 0 ? "Cantrips" : `Level ${lvl}`;
    const sub = lvl === 0 ? `<span class="atwill">at-will</span>` : slotPips(lvl);
    head.innerHTML = `<span class="grp-name">${label}</span>${sub}`;
    group.appendChild(head);
    const spells = byLevel.get(lvl)!.sort((a, b) => order.indexOf(a.casting) - order.indexOf(b.casting) || a.name.localeCompare(b.name));
    for (const sp of spells) group.appendChild(spellRow(sp));
    box.appendChild(group);
  }
  wirePips();
  applyFilter();
}

function applyFilter() {
  const q = ($("search") as HTMLInputElement).value.trim().toLowerCase();
  const rows = document.querySelectorAll<HTMLElement>("#skills .roll-line, #attacks .roll-line, #spells .roll-line");
  rows.forEach((el) => {
    const name = (el.querySelector(".label")?.textContent || el.textContent || "").toLowerCase();
    el.style.display = !q || name.includes(q) ? "" : "none";
  });
  // Items wrap the label + quantity controls in an .item-row — hide the whole row.
  document.querySelectorAll<HTMLElement>("#items .item-row").forEach((el) => {
    const name = (el.querySelector(".label")?.textContent || "").toLowerCase();
    el.style.display = !q || name.includes(q) ? "" : "none";
  });
  document.querySelectorAll<HTMLElement>("#spells .spell-group").forEach((g) => {
    const any = [...g.querySelectorAll<HTMLElement>(".roll-line")].some((r) => r.style.display !== "none");
    g.style.display = any ? "" : "none";
  });
  if (q) ["skills", "attacks", "spells", "items"].forEach((s) => sectionEl(s).classList.remove("collapsed"));
}

function wirePips() {
  document.querySelectorAll<HTMLElement>("#spells .pip").forEach((pip) => {
    pip.onclick = async (e) => {
      e.stopPropagation();
      const lvl = Number(pip.dataset.level);
      const full = pip.classList.contains("full");
      if (ddbConnected && writable) {
        // (writable-gated: never drive a read-only teammate's live DDB sheet from a slot pip)
        // drive the real DDB sheet (writes back to D&D Beyond), serialized against other clicks
        await withDdbLock(async () => {
          const res = full ? await window.api.ddbSpend(lvl) : await window.api.ddbRestore(lvl);
          if (res.slots) applyDdbSlots(res.slots);
          else if (res.error) setStatus(res.error, true);
        });
      } else {
        const i = Number(pip.dataset.i);
        remaining[lvl] = full ? i : i + 1;
        renderSpells();
      }
    };
  });
}

// Serialize every DDB slot mutation: while a spend/restore/restoreAll is pending, ignore
// further slot mutations so concurrent cast/pip clicks can't race two writes to nondeterministic
// counts. Read-only paths (refreshDdb/poll) are unaffected.
async function withDdbLock(fn: () => Promise<void>): Promise<void> {
  if (ddbBusy) return; // a slot mutation is already in flight — drop this click
  ddbBusy = true;
  try { await fn(); }
  finally { ddbBusy = false; }
}

// Local (offline) slot decrement fallback when DDB isn't connected.
// Returns true if a slot was actually spent, false if none were left.
function localSpend(lvl: number): boolean {
  const rem = remaining[lvl] ?? 0;
  if (rem <= 0) { setStatus(`No level ${lvl} slots left`, true); return false; }
  remaining[lvl] = rem - 1;
  renderSpells();
  return true;
}

// Spend one level-`lvl` slot, preferring the real DDB sheet but recovering honestly if the
// write fails (e.g. a mid-session DDB logout leaves ddbConnected stuck true).
// Returns true only if a slot was genuinely spent (so the caller can gate the cast on it).
async function spendSlot(lvl: number): Promise<boolean> {
  if (!writable) return localSpend(lvl); // read-only sheet: track slots locally, don't write back
  // If we think we're offline, try once to (re)connect — handles signing into DDB after the
  // character was loaded, so a cast still writes back to the real sheet.
  if (!ddbConnected) await refreshDdb();
  if (!ddbConnected) return localSpend(lvl);

  let res = await window.api.ddbSpend(lvl);
  if (!res.ok) {
    // The write failed — maybe we logged out mid-session. Re-check the connection honestly
    // (refreshDdb sets ddbConnected via ensureSlots + read), then retry if we reconnected.
    await refreshDdb();
    if (ddbConnected) res = await window.api.ddbSpend(lvl);
  }
  if (res.ok && res.slots) { applyDdbSlots(res.slots); return true; }
  if (!ddbConnected) return localSpend(lvl); // still offline → local fallback
  setStatus(res.error || `No level ${lvl} slots left`, true); // connected but genuinely no slot
  return false;
}

// Evaluate a move's Pokémon-ability modifiers against the current live state (HP % + status) and
// bake the active numeric ones (extra STAB damage, to-hit, save DC) into an effective move; return
// any advantage + reminder notes. Non-poke5e sources have no abilityMods, so this is a no-op.
function condActive(cond: any): boolean {
  const hpPct = hp && hp.max ? (hp.current / hp.max) * 100 : 100;
  const status = (pokeMeta?.status || "").toLowerCase();
  if (cond === "always") return true;
  if (cond?.hpFull) return hpPct >= 100;
  if (cond?.hpPctMax != null) return hpPct <= cond.hpPctMax; // "N% or less"
  if (cond?.hpPctBelow != null) return hpPct < cond.hpPctBelow; // prose "below N%"
  // Status matches by stem (case-insensitive substring) so "burn" catches "burned"/"burning".
  if (cond?.status) return cond.status === "any" ? !!status : status.includes(String(cond.status).toLowerCase());
  return false;
}
function abilityModActive(m: any): boolean {
  return condActive(m.cond);
}

// A ⚡ badge on moves an ability affects; lit when its condition currently holds.
function abilityBadge(sp: any): string {
  const mods: any[] = sp.abilityMods || [];
  if (!mods.length) return "";
  const anyActive = mods.some(abilityModActive);
  const title = mods
    .map((m) => {
      const eff = m.note ? `: ${m.note}` : m.damageAdd ? ` +${m.damageAdd} dmg` : m.attackAdd ? ` +${m.attackAdd} to hit` : m.saveDcAdd ? ` +${m.saveDcAdd} DC` : m.attackAdvantage ? " advantage" : "";
      const when = m.cond === "always" ? "" : m.cond?.hpPctMax != null ? ` (when HP ≤ ${m.cond.hpPctMax}%)` : m.cond?.status ? ` (while ${m.cond.status === "any" ? "afflicted" : m.cond.status})` : "";
      return `${m.ability}${eff}${when}`;
    })
    .join("; ");
  return `<span class="ability-badge${anyActive ? " on" : ""}" title="${esc(title)}">⚡</span>`;
}

function applyAbilityMods(sp: any): { eff: any; advantage: AdvMode | null; notes: string[] } {
  const mods: any[] = sp.abilityMods || [];
  if (!mods.length) return { eff: sp, advantage: null, notes: [] };
  const active = mods.filter(abilityModActive);
  if (!active.length) return { eff: sp, advantage: null, notes: [] };
  const eff = { ...sp };
  let adv = false;
  let dis = false;
  const notes: string[] = [];
  for (const m of active) {
    // Only add flat damage to a move that already has a damage roll — never fabricate damage on a
    // utility/status move (Flare Boost, Competitive, Steelworker all say "damage rolls").
    if (m.damageAdd && eff.damageDice) eff.damageDice = `${eff.damageDice} + ${m.damageAdd}`;
    if (m.attackAdd && eff.attackBonus != null) eff.attackBonus = eff.attackBonus + m.attackAdd;
    if (m.saveDcAdd && eff.saveDc != null) eff.saveDc = eff.saveDc + m.saveDcAdd;
    if (m.attackAdvantage) adv = true;
    if (m.attackDisadvantage) dis = true;
    notes.push(m.note ? `${m.ability}: ${m.note}` : `${m.ability} active`);
  }
  // Advantage and disadvantage from different abilities cancel to a straight roll.
  const advantage: AdvMode | null = adv && dis ? null : adv ? "advantage" : dis ? "disadvantage" : null;
  return { eff, advantage, notes };
}

async function castSpell(sp: any) {
  const lvl = sp.isCantrip ? 0 : sp.level;
  const usesSlot = lvl > 0 && spellSlots.some((s) => s.level === lvl);
  // Instant, local-only guard (no network): don't cast when you can already see there are no
  // slots left. Beyond that we trust the local count and stay responsive.
  if (usesSlot && (remaining[lvl] ?? 0) <= 0) { setStatus(`No level ${lvl} spell slots left`, true); return; }
  // poke5e move PP: block at 0, otherwise consume one and save it back (with the write key).
  const tracksPp = sp.pp && sp.pp.max > 0 && sp.moveId;
  if (tracksPp && sp.pp.current <= 0) { setStatus(`${sp.name}: no PP left`, true); return; }
  // Apply any Pokémon-ability modifiers whose condition (HP% / status) currently holds.
  const { eff, advantage, notes } = applyAbilityMods(sp);
  const req = spellReq(eff);
  if (req && advantage && req.kind === "attack") req.advantage = advantage;
  // A no-dice poke5e move announcement uses the universal template (the D&D `simple` card is often
  // absent in a Pokémon Roll20 game, which would render the announcement as an empty card).
  if (req && req.kind === "cast" && activeSource === "poke5e") req.templateStyle = "default";
  if (req) sendRoll(req); // roll immediately — responsive
  const allNotes = [...notes, ...(sp.moveHint ? [sp.moveHint] : [])]; // ability notes + charge/recharge reminder
  // Negative Bond → obedience check when issuing a command (poke5e /reference/bonds).
  const bond = pokeMeta?.bond?.level ?? 0;
  if (bond <= -3) allNotes.push("⚠ Bond −3: roll a d20 — on ≤10 the Pokémon disobeys this command");
  else if (bond <= -2) allNotes.push("⚠ Bond −2: roll a d20 — on ≤10 it hesitates (this move at disadvantage)");
  if (allNotes.length) setStatus("⚡ " + allNotes.join(" · "));
  if (usesSlot) withDdbLock(() => spendSlot(lvl)); // spend the slot in the background (reconciles with DDB)
  if (tracksPp) {
    sp.pp.current -= 1;
    renderSpells();
    // Preserve the move's notes on the write, and restore the PP on failure so local ≠ backend
    // doesn't silently persist until reload.
    if (writable) {
      window.api.poke5eSetPp(sp.learnedId, sp.moveId, sp.pp.current, sp.pp.max, sp.moveNotes)
        .then((res: any) => {
          if (!res?.ok) { sp.pp.current = Math.min(sp.pp.max, sp.pp.current + 1); renderSpells(); setStatus(`${sp.name}: PP not saved to poke5e`, true); }
        })
        .catch(() => { sp.pp.current = Math.min(sp.pp.max, sp.pp.current + 1); renderSpells(); setStatus(`${sp.name}: PP not saved to poke5e`, true); });
    }
  }
  // Concentration spell → track it (replacing any prior concentration).
  if (sp.concentration) { concentrating = { name: sp.name }; renderConcentration(); setStatus(`Concentrating on ${sp.name}`); }
}

function weaponReq(w: any) {
  const dmg = w.damageMod ? `${w.damageDice} ${w.damageMod >= 0 ? "+" : "-"} ${Math.abs(w.damageMod)}` : w.damageDice;
  // Save-based action → a damage roll labelled with the DC (targets roll the save); no to-hit.
  if (w.save) return { kind: "damage", key: `${w.name} (DC ${w.save.dc} ${w.save.ability})`, baseDamage: dmg, damageType: w.damageType };
  return { kind: "attack", key: w.name, baseAttackMod: w.attackMod, baseDamage: dmg, damageType: w.damageType, advantage: adv };
}

// A spell's FULL damage — combines every component (e.g. Ice Knife's piercing + cold), so the
// secondary component actually rolls instead of being dropped. Falls back to the primary dice.
function spellDamage(sp: any): { dice: string; type?: string } {
  const comps = Array.isArray(sp.damages) ? sp.damages.filter((d: any) => d && d.dice) : [];
  if (comps.length > 1) {
    return {
      dice: comps.map((d: any) => d.dice).join(" + "),
      type: [...new Set(comps.map((d: any) => d.type).filter(Boolean))].join(" + ") || sp.damageType,
    };
  }
  return { dice: sp.damageDice ?? "", type: sp.damageType };
}

function spellReq(sp: any): any | null {
  // poke5e Pokémon moves are "used", not "cast" — only affects the no-dice announcement verb.
  const verb = activeSource === "poke5e" ? "Uses" : undefined;
  const d = spellDamage(sp);
  if (sp.casting === "attack")
    return { kind: "attack", key: sp.name, baseAttackMod: sp.attackBonus ?? 0, baseDamage: d.dice, damageType: d.type, advantage: adv };
  if (sp.casting === "save") {
    // No-damage save spell/move (Bane, Web, Growl …) → announce the DC instead of rolling empty dice.
    if (!d.dice) return { kind: "cast", key: `${sp.name} (${sp.saveAbility} DC ${sp.saveDc} save)`, verb };
    return { kind: "damage", key: `${sp.name} (DC ${sp.saveDc} ${sp.saveAbility})`, baseDamage: d.dice, damageType: d.type };
  }
  // Healing spells (Cure Wounds, Healing Word …) → roll the healing dice.
  if (sp.healDice) return { kind: "damage", key: `${sp.name} (heal)`, baseDamage: sp.healDice };
  // Guaranteed-hit damage move (Swift, Aura Sphere, Magical Leaf …) — roll damage, no to-hit.
  if (sp.autoHit && sp.damageDice) return { kind: "damage", key: sp.name, baseDamage: sp.damageDice, damageType: sp.damageType };
  // Prose "roll a d20/d100/…" move (Sheer Cold & the OHKO moves, Metronome, Acupressure) — roll it.
  if (sp.rollDie) return { kind: "damage", key: `${sp.name} — roll ${sp.rollDie}`, baseDamage: sp.rollDie };
  return { kind: "cast", key: sp.name, verb };
}

function rollLine(label: string, mod: number, dotCls: string, onclick: () => void): HTMLElement {
  const b = document.createElement("button");
  b.className = "roll-line";
  b.innerHTML = `<span class="label"><span class="dot ${dotCls}"></span>${label}</span><span class="mod">${sgn(mod)}</span>`;
  b.onclick = onclick;
  return b;
}

async function refreshToggles() {
  // Show toggles applicable to this character. Probe with a save AND an attack request so a
  // toggle that only applies to one target still surfaces; merge, de-duped by id.
  const list = await window.api.listToggles({ kind: "save", key: "CON" });
  const attackList = await window.api.listToggles({ kind: "attack" });
  const byId = new Map<string, string>();
  [...list, ...attackList].forEach((t) => byId.set(t.id, t.name));
  const sec = sectionEl("options");
  const box = $("toggles");
  box.innerHTML = "";
  if (byId.size === 0) { sec.hidden = true; return; }
  sec.hidden = false;

  // Tidy the list: split character abilities ("Features") from situational spell/condition
  // effects you toggle when they're on you ("Conditions"), each under a small label. The
  // registry already drops config placeholders and no-op options, so everything here acts.
  const clean = (name: string) => name.replace(/^(Feat|Effect|Effects|Fighting Style|Cleric|Class Feature|Artificer|Race|Racial Trait):\s*/i, "").trim();
  const isCondition = (id: string) => /^effects-/.test(id) || /exhaustion|bless|bane|enlarge|reduce|hex|hunter/i.test(id);
  const groups: { label: string; ids: string[] }[] = [
    { label: "Features", ids: [...byId.keys()].filter((id) => !isCondition(id)) },
    { label: "Conditions & Effects", ids: [...byId.keys()].filter((id) => isCondition(id)) },
  ];
  for (const g of groups) {
    if (!g.ids.length) continue;
    const head = document.createElement("div");
    head.className = "toggle-group-label";
    head.textContent = g.label;
    box.appendChild(head);
    const wrap = document.createElement("div");
    wrap.className = "toggle-group";
    for (const id of g.ids) {
      const lab = document.createElement("label");
      lab.className = "toggle";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = enabled.has(id);
      cb.onchange = () => { cb.checked ? enabled.add(id) : enabled.delete(id); };
      lab.appendChild(cb);
      lab.appendChild(document.createTextNode(clean(byId.get(id)!)));
      wrap.appendChild(lab);
    }
    box.appendChild(wrap);
  }
}

async function sendRoll(request: any) {
  lastRollRequest = request;
  ($("rerollBtn") as HTMLButtonElement).disabled = false;
  const req = { ...request, whisper: whisperOn || request.whisper, templateStyle: request.templateStyle ?? templateStyle };
  if (adhocMod) { req.adhocMod = adhocMod; resetAdhoc(); } // one-off: applies to this roll, then clears
  // Snapshot chat ids so we can spot OUR result once it lands (best-effort — needs a game open).
  const beforeIds = new Set((await window.api.roll20Scrape().catch(() => [])).map((r: any) => r.id));
  const toggles = [...enabled, ...activeConditionRuleIds()]; // active conditions auto-apply
  const res = await window.api.roll(req, toggles);
  const lr = $("lastRoll");
  if (!res.ok) { lr.innerHTML = `<b>Error:</b> ${res.error}`; return; }
  const inj = res.injected;
  const landed = inj?.ok ? "✓ sent to Roll20" : `⚠ ${inj?.error || "not sent — open a Roll20 game"}`;
  lr.innerHTML = `<b>${landed}</b> &nbsp; <code>${(res.command || "").replace(/</g, "&lt;")}</code>`;
  if (inj?.ok) pollRollResult(beforeIds); // read the total back and show it
}

// After a roll lands, poll the chat for OUR new result and surface the total (with crit/fumble).
async function pollRollResult(beforeIds: Set<string>) {
  const myName = (model?.name || "").toLowerCase();
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const recs = await window.api.roll20Scrape().catch(() => []);
    const fresh = recs.filter((r: any) => !beforeIds.has(r.id) && String(r.character || "").toLowerCase() === myName);
    if (fresh.length) { showRollResult(fresh[fresh.length - 1]); return; }
  }
}

function showRollResult(r: any) {
  const lr = $("lastRoll");
  const cls = r.crit ? "res-crit" : r.fumble ? "res-fumble" : "";
  const badge = r.crit ? " 🎯" : r.fumble ? " 💀" : "";
  const dmg = r.damage ? `  ·  ${esc(r.damage)} dmg` : "";
  lr.innerHTML = `<b class="${cls}">${esc(r.name || "Roll")}: ${esc(r.total)}${badge}</b>${dmg}`;
}

function doRoll(req: { kind: string; key?: string }) {
  let advantage: AdvMode = adv;
  // poke5e Paralysis → disadvantage on STR/DEX saving throws (cancels with a manual advantage).
  if (req.kind === "save" && (req.key === "STR" || req.key === "DEX") && /paralys/i.test(pokeMeta?.status || "")) {
    advantage = adv === "advantage" ? "normal" : "disadvantage";
    setStatus("⚠ Paralysis: disadvantage on this save");
  }
  return sendRoll({ ...req, advantage });
}

// wire controls
$("restBtn").onclick = async () => {
  if (writable && ddbConnected) {
    await withDdbLock(async () => {
      const res = await window.api.ddbRestoreAll();
      if (res.slots) applyDdbSlots(res.slots);
      setStatus("Slots restored on D&D Beyond");
    });
  } else {
    for (const s of spellSlots) remaining[s.level] = s.total - s.used;
    renderSpells();
    setStatus("Long rest — slots restored (local)");
  }
};
$("shortRest").onclick = async () => {
  const pools: any[] = hitDice?.pools ?? [];
  const pendingTotal = Object.values(hitPending).reduce((a, b) => a + b, 0);
  if (!writable || !ddbConnected) {
    // Read-only or offline: the heals already went to Roll20 and pips already dropped — just clear staging.
    hitPending = {};
    setStatus(pendingTotal ? `Short rest — ${pendingTotal} Hit ${pendingTotal === 1 ? "Die" : "Dice"} spent (local only)` : "Short rest (local)");
    renderHitDice();
    return;
  }
  await withDdbLock(async () => {
    setStatus("Short rest — writing to D&D Beyond…");
    let committed = 0;
    // Commit per die-size pool that has staged spends (one real short rest handles all).
    const dice = pools.map((p) => p.die).filter((d) => (hitPending[d] ?? 0) > 0);
    if (dice.length === 0) {
      // Take a short rest with no hit dice spent (still resets short-rest features on DDB).
      const res = await window.api.ddbShortRest(0);
      if (!res.ok) { setStatus(res.error || "Short rest failed", true); return; }
    } else {
      for (const die of dice) {
        const n = hitPending[die] ?? 0;
        const res = await window.api.ddbShortRest(n, die);
        if (!res.ok) { setStatus(res.error || "Short rest failed", true); return; }
        committed += n;
        if (res.pools) syncHitPoolsFromDdb(res.pools);
      }
    }
    hitPending = {};
    renderHitDice();
    setStatus(committed ? `Short rest — spent ${committed} Hit ${committed === 1 ? "Die" : "Dice"} on D&D Beyond ✓` : "Short rest taken on D&D Beyond ✓");
  });
};
$("longRest").onclick = async () => {
  // Regain half your Hit Dice (min 1 per pool) — a long rest.
  for (const p of hitDice?.pools ?? []) {
    const regain = Math.max(1, Math.floor(p.total / 2));
    hitRemaining[p.die] = Math.min(p.total, (hitRemaining[p.die] ?? 0) + regain);
    // Update the model's used baseline so pending math stays correct after a long rest.
    p.used = p.total - hitRemaining[p.die];
  }
  hitPending = {};
  renderHitDice();
  // Restore spell slots (on DDB if connected & writable, else locally).
  if (writable && ddbConnected) {
    const res = await window.api.ddbRestoreAll();
    if (res.slots) applyDdbSlots(res.slots);
  } else {
    for (const s of spellSlots) remaining[s.level] = s.total - s.used;
    renderSpells();
  }
  // Full HP (temp cleared), drop concentration, clear any death saves.
  if (hp) commitHp(0, 0);
  concentrating = null;
  deathSaves = { success: 0, fail: 0 };
  renderConcentration();
  setStatus("Long rest — full HP, spell slots restored, half your Hit Dice back");
};

// Reconcile local hit-dice pips with the authoritative per-class used counts DDB reports
// after a short rest. DDB pools are per class; our pips are grouped by die size, so sum.
function syncHitPoolsFromDdb(ddbPools: any[]) {
  const usedByDie: Record<number, number> = {};
  const totalByDie: Record<number, number> = {};
  for (const p of ddbPools || []) {
    if (p.die == null) continue;
    usedByDie[p.die] = (usedByDie[p.die] ?? 0) + (p.used ?? 0);
    totalByDie[p.die] = (totalByDie[p.die] ?? 0) + (p.total ?? 0);
  }
  for (const pool of hitDice?.pools ?? []) {
    if (usedByDie[pool.die] == null) continue;
    pool.used = usedByDie[pool.die];
    hitRemaining[pool.die] = (totalByDie[pool.die] ?? pool.total) - usedByDie[pool.die];
  }
}
let pendingInvRefresh = false;
$("paneSeg").querySelectorAll("button").forEach((b) => {
  b.addEventListener("click", () => {
    $("paneSeg").querySelectorAll("button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    const mode = (b.getAttribute("data-pane") as "roll20" | "ddb") || "roll20";
    window.api.setRightPane(mode);
    if (mode === "ddb") setTimeout(refreshDdb, 1500); // user may be signing in
    // Returning to the Table after visiting DDB (e.g. adding items) → pull the fresh inventory.
    if (mode === "roll20" && pendingInvRefresh) { pendingInvRefresh = false; syncInventory(); }
  });
});

// "＋ Add / Manage" → open DDB's own inventory (search + add), and mark for re-sync on return.
$("manageItems").onclick = async () => {
  pendingInvRefresh = true;
  $("paneSeg").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.getAttribute("data-pane") === "ddb"));
  await window.api.ddbOpenInventory();
  setStatus("Search & add items on D&D Beyond, then switch back to Table to re-sync");
};

// Pull the latest inventory from D&D Beyond (after adding/editing items there).
async function syncInventory() {
  const res = await window.api.inventoryRefresh();
  if (res.ok) { inventory = res.items || []; renderInventory(); applyFilter(); setStatus("Inventory synced from D&D Beyond ✓"); }
}
// Click the status chip to re-check DDB connection (e.g. right after signing in).
$("ddbStatus").onclick = () => { if (model) refreshDdb(); };

// Collapsible sections (twisties)
document.querySelectorAll<HTMLElement>(".section-head").forEach((h) => {
  h.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("button")) return; // header buttons handle themselves
    h.closest(".card")!.classList.toggle("collapsed");
  });
});

// Live search across skills / attacks / spells
$("search").addEventListener("input", applyFilter);

// Session log & stats controls
$("logRefresh").onclick = refreshSession;
($("logCampaign") as HTMLSelectElement).onchange = (e) => {
  logFilter.campaign = (e.target as HTMLSelectElement).value;
  campaignPinned = true;
  logFilter.player = ""; // reset player filter when switching campaigns
  renderSession(sessionData);
};
$("logDeepSync").onclick = async () => {
  const btn = $("logDeepSync") as HTMLButtonElement;
  const prev = btn.textContent;
  btn.textContent = "Loading…";
  btn.disabled = true;
  setStatus("Loading full history from Roll20…");
  try {
    const data = await window.api.sessionDeepSync();
    renderSession(data);
    setStatus(`Loaded ${data.records.length} rolls of history`);
  } catch {
    setStatus("Full sync failed", true);
  } finally {
    btn.textContent = prev;
    btn.disabled = false;
  }
};
$("exportJson").onclick = () => doExport("json");
$("exportCsvLog").onclick = () => doExport("csv-log");
$("exportCsvStats").onclick = () => doExport("csv-stats");
$("logClear").onclick = async () => {
  if (!confirm("Clear all saved roll history? This wipes the persisted log and can't be undone.")) return;
  await window.api.sessionClear();
  refreshSession();
};

// Live auto-refresh poll (Off/5s/15s/30s), persisted.
function setLive(sec: number) {
  if (liveTimer) { clearInterval(liveTimer); liveTimer = null; }
  if (sec > 0) { liveTimer = setInterval(refreshSession, sec * 1000); refreshSession(); }
  try { localStorage.setItem("liveInterval", String(sec)); } catch { /* ignore */ }
}
$("liveSeg").querySelectorAll("button").forEach((b) => {
  b.addEventListener("click", () => {
    $("liveSeg").querySelectorAll("button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    setLive(Number(b.getAttribute("data-live")) || 0);
  });
});
(function initLive() {
  let sec = 0;
  try { sec = Number(localStorage.getItem("liveInterval") || "0"); } catch { /* ignore */ }
  const btn = $("liveSeg").querySelector(`button[data-live="${sec}"]`) as HTMLElement | null;
  if (btn) { $("liveSeg").querySelectorAll("button").forEach((x) => x.classList.remove("on")); btn.classList.add("on"); }
  if (sec > 0) liveTimer = setInterval(refreshSession, sec * 1000);
})();

// Log filters
($("logPlayer") as HTMLSelectElement).onchange = (e) => { logFilter.player = (e.target as HTMLSelectElement).value; renderLog(); };
($("d20Only") as HTMLInputElement).onchange = (e) => { logFilter.d20Only = (e.target as HTMLInputElement).checked; renderLog(); };
($("showGM") as HTMLInputElement).onchange = (e) => { logFilter.showGM = (e.target as HTMLInputElement).checked; renderSession(sessionData); };

// Copy the (filtered) log to the clipboard as tab-separated text.
$("logCopy").onclick = async () => {
  const text = filteredRecords()
    .map((r) => `${r.ts ?? ""}\t${r.player}${r.character ? " (" + r.character + ")" : ""}\t${r.name}\t${r.total ?? ""}${r.crit ? "\t✦20" : r.fumble ? "\t✗1" : ""}`)
    .join("\n");
  await window.api.copyText(text);
  setStatus("Log copied to clipboard");
};
$("loadBtn").onclick = load;
($("charId") as HTMLInputElement).addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") load(); });

// A small deterministic color from the name, for the initial badge.
function badgeColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return `hsl(${h}, 42%, 45%)`;
}

function charMetaLine(c: any): string {
  const placeholder = (s: string) => !s || /no (classes|species|race)/i.test(s);
  const cls = !placeholder(c.classDescription) ? c.classDescription : !placeholder(c.raceName) ? c.raceName : "New character";
  return [cls, c.campaignName].filter(Boolean).join("  ·  ");
}

function setPickerLabel(c: any | null) {
  ($("charPickerLabel") as HTMLElement).textContent = c
    ? `${c.name}${c.level ? `  ·  Lvl ${c.level}` : ""}`
    : "Select a character…";
}

// Populate the custom picker from the signed-in D&D Beyond session (falls back to the ID box).
let didAutoLoad = false;
async function refreshCharacterList(): Promise<boolean> {
  const picker = $("charPicker");
  const idBox = $("charId") as HTMLInputElement;
  const refreshBtn = $("charRefresh");
  const res = await window.api.listCharacters().catch(() => ({ ok: false, characters: [] as any[] }));
  if (!res.ok || !res.characters?.length) {
    // Not signed in yet (or no characters). Show the ID box, but KEEP the refresh
    // button so signing in later can recover — and hint how in its tooltip.
    picker.hidden = true; idBox.hidden = false;
    refreshBtn.hidden = false;
    refreshBtn.title = "Sign in to D&D Beyond in the right pane, then click to load your characters";
    return false;
  }
  // Prefer the last character you opened; else keep the current pick; else the most recent.
  const saved = lastCharId();
  if (saved && res.characters.some((c) => String(c.id) === saved)) pickerCharId = saved;
  else if (!res.characters.some((c) => String(c.id) === pickerCharId)) pickerCharId = String(res.characters[0].id);
  const list = $("charPickerList");
  list.innerHTML = "";
  for (const c of res.characters) {
    const row = document.createElement("div");
    row.className = "cp-row" + (String(c.id) === pickerCharId ? " sel" : "");
    row.dataset.id = String(c.id);
    const initial = (c.name || "?").trim().charAt(0).toUpperCase() || "?";
    row.innerHTML =
      `<span class="cp-badge" style="background:${badgeColor(c.name || "")}">${initial}</span>` +
      `<span class="cp-info"><span class="cp-name">${esc(c.name)}</span><span class="cp-meta">${esc(charMetaLine(c))}</span></span>` +
      `<span class="cp-lvl">${c.level ? "Lvl " + c.level : ""}</span>`;
    row.onclick = () => {
      pickerCharId = String(c.id);
      setPickerLabel(c);
      closePicker();
      load();
    };
    list.appendChild(row);
  }
  setPickerLabel(res.characters.find((c) => String(c.id) === pickerCharId) || null);
  picker.hidden = false; refreshBtn.hidden = false; idBox.hidden = true;
  refreshBtn.title = "Reload your character list";
  // Auto-open the last character the first time the list resolves (don't clobber a loaded one).
  if (!didAutoLoad && !model && pickerCharId) { didAutoLoad = true; load(); }
  return true;
}

function openPicker() { $("charPickerList").hidden = false; }
function closePicker() { $("charPickerList").hidden = true; }
$("charPickerBtn").onclick = (e) => { e.stopPropagation(); $("charPickerList").hidden ? openPicker() : closePicker(); };
document.addEventListener("click", (e) => { if (!(e.target as HTMLElement).closest("#charPicker")) closePicker(); });
$("charRefresh").onclick = () => refreshCharacterList();
// "⇦ Menu" returns to the splash to pick a different source/VTT (works for every source; the
// account sign-out lives on the splash now, since each site handles its own login in its pane).
$("logoutBtn").onclick = () => window.api.showSplash();
// Populate the shared picker from the user's poke5e trainers (read from the poke5e pane's local
// list), so they auto-load like D&D Beyond instead of pasting a key. Returns true if any found.
async function refreshPoke5eTrainers(): Promise<boolean> {
  const res = await window.api.listPoke5eTrainers(getPoke5eKeys()).catch(() => ({ ok: false, trainers: [] as any[] }));
  const trainers = res.trainers || [];
  if (!trainers.length) return false;
  const saved = lastCharId();
  if (saved && trainers.some((t) => t.readKey === saved)) pickerCharId = saved;
  else if (!trainers.some((t) => t.readKey === pickerCharId)) pickerCharId = trainers[0].readKey;
  const list = $("charPickerList");
  list.innerHTML = "";
  for (const t of trainers) {
    const row = document.createElement("div");
    row.className = "cp-row" + (t.readKey === pickerCharId ? " sel" : "");
    row.dataset.id = t.readKey;
    const initial = (t.name || "?").trim().charAt(0).toUpperCase() || "?";
    row.innerHTML =
      `<span class="cp-badge" style="background:${badgeColor(t.name || "")}">${initial}</span>` +
      `<span class="cp-info"><span class="cp-name">${esc(t.name)}</span><span class="cp-meta">Pokémon 5e trainer${t.level ? " · Lvl " + t.level : ""}</span></span>`;
    row.onclick = () => { pickerCharId = t.readKey; setPickerLabel(t); closePicker(); load(); };
    list.appendChild(row);
  }
  setPickerLabel(trainers.find((t) => t.readKey === pickerCharId) || null);
  $("charPicker").hidden = false;
  $("charRefresh").hidden = false;
  ($("charId") as HTMLInputElement).hidden = true;
  if (!didAutoLoad && !model && pickerCharId) { didAutoLoad = true; load(); }
  return true;
}

// Adapt the loader to the character source chosen on the splash, then start the right flow.
(async function initSource() {
  try {
    const cfg = await window.api.getConfig();
    activeSource = cfg?.source === "poke5e" ? "poke5e" : cfg?.source === "monster" ? "monster" : "ddb";
  } catch { /* default to ddb */ }

  if (activeSource === "monster") {
    // Monster/NPC: a search box with a results dropdown; picking a creature loads it read-only.
    $("charPicker").hidden = true;
    $("charRefresh").hidden = true;
    $("ddbStatus").hidden = true;
    ($("loadBtn") as HTMLElement).hidden = true;
    const idBox = $("charId") as HTMLInputElement;
    idBox.hidden = false;
    idBox.placeholder = "Search a monster… e.g. Goblin";
    const srcBtn = $("paneSeg").querySelector('[data-pane="ddb"]');
    if (srcBtn) srcBtn.textContent = "Monsters";
    // Source toggle: D&D Beyond (your owned Monster Manual + SRD) vs Open5e (SRD + community).
    let monsterSrc: "ddb" | "open5e" = "ddb";
    const toggle = document.createElement("div");
    toggle.className = "mon-toggle";
    toggle.innerHTML = `<button data-src="ddb" class="on">D&D Beyond</button><button data-src="open5e">Open5e</button>`;
    $("loader").insertBefore(toggle, idBox);
    const results = document.createElement("div");
    results.className = "mon-results";
    results.hidden = true;
    $("loader").appendChild(results);
    let timer: ReturnType<typeof setTimeout>;
    const renderResults = (hits: { slug: string; name: string; cr: string; type: string }[]) => {
      results.innerHTML = hits
        .map((h) => `<div class="cp-row" data-slug="${esc(h.slug)}"><span class="cp-info"><span class="cp-name">${esc(h.name)}</span><span class="cp-meta">${h.cr ? "CR " + esc(h.cr) : ""}${h.type ? " · " + esc(h.type) : ""}</span></span></div>`)
        .join("");
      results.hidden = hits.length === 0;
      results.querySelectorAll<HTMLElement>(".cp-row").forEach((row) => {
        row.onclick = () => {
          results.hidden = true;
          idBox.value = row.querySelector(".cp-name")?.textContent || "";
          loadMonster(row.dataset.slug!, idBox.value, monsterSrc);
        };
      });
    };
    const doSearch = async () => {
      const q = idBox.value.trim();
      if (q.length < 2) { results.hidden = true; return; }
      const res = monsterSrc === "ddb"
        ? await window.api.searchDdbMonsters(q).catch(() => ({ ok: false, results: [] as any[] }))
        : await window.api.searchMonsters(q).catch(() => ({ ok: false, results: [] as any[] }));
      renderResults(res.results || []);
    };
    toggle.querySelectorAll<HTMLButtonElement>("button").forEach((b) => {
      b.onclick = () => {
        toggle.querySelectorAll("button").forEach((x) => x.classList.remove("on"));
        b.classList.add("on");
        monsterSrc = (b.dataset.src as "ddb" | "open5e") || "ddb";
        doSearch();
      };
    });
    idBox.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(doSearch, 350); });
    idBox.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") { clearTimeout(timer); doSearch(); } });
    document.addEventListener("click", (e) => { if (!(e.target as HTMLElement).closest("#loader")) results.hidden = true; });
    return;
  }

  if (activeSource === "poke5e") {
    const srcBtn = $("paneSeg").querySelector('[data-pane="ddb"]');
    if (srcBtn) srcBtn.textContent = "poke5e";
    $("ddbStatus").hidden = true; // no spell-slot sync for poke5e
    const idBox = $("charId") as HTMLInputElement;
    idBox.placeholder = "poke5e share link or read key";
    $("charRefresh").onclick = () => refreshPoke5eTrainers();
    // Auto-discover the trainers you've opened in poke5e (like the D&D Beyond list). The poke5e
    // pane may still be loading, so poll a few times before falling back to the paste box.
    for (let i = 0; i < 12; i++) {
      if (await refreshPoke5eTrainers()) return; // got a trainer picker
      await new Promise((r) => setTimeout(r, 2000));
    }
    // None found in poke5e's local list → paste box.
    $("charPicker").hidden = true;
    $("charRefresh").hidden = true;
    idBox.hidden = false;
    const saved = lastCharId();
    if (saved) idBox.value = saved;
    return;
  }

  // D&D Beyond: poll for the character list on startup. On a fresh machine the DDB pane isn't
  // signed in yet, so keep retrying (every 3s, up to ~90s) until it resolves — that way the
  // picker appears on its own once you sign in, without a manual refresh.
  for (let i = 0; i < 30; i++) {
    if (await refreshCharacterList()) return; // got the list — stop polling
    if (!$("charPicker").hidden) return; // a manual refresh succeeded meanwhile
    await new Promise((r) => setTimeout(r, 3000));
  }
})();
$("advSeg").querySelectorAll("button").forEach((b) => {
  b.addEventListener("click", () => {
    $("advSeg").querySelectorAll("button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    adv = (b.getAttribute("data-adv") as AdvMode) || "normal";
  });
});
document.querySelectorAll<HTMLElement>('.roll-line[data-kind="initiative"]').forEach((b) => {
  b.onclick = () => doRoll({ kind: "initiative" });
});

// ---- Roll extras: ad-hoc modifier, whisper, reroll ----
const modInput = $("adhocMod") as HTMLInputElement;
function syncAdhoc() {
  adhocMod = Math.trunc(Number(modInput.value) || 0);
  modInput.value = String(adhocMod);
  ($("adhocMod").closest(".ex-mod") as HTMLElement).classList.toggle("active", adhocMod !== 0);
}
function resetAdhoc() { modInput.value = "0"; syncAdhoc(); }
modInput.addEventListener("input", syncAdhoc);
$("modUp").onclick = () => { modInput.value = String((Number(modInput.value) || 0) + 1); syncAdhoc(); };
$("modDown").onclick = () => { modInput.value = String((Number(modInput.value) || 0) - 1); syncAdhoc(); };
$("whisperToggle").onclick = () => {
  whisperOn = !whisperOn;
  $("whisperToggle").classList.toggle("on", whisperOn);
};
$("rerollBtn").onclick = () => { if (lastRollRequest) sendRoll(lastRollRequest); };

// Roster dropdown: the ▾ caret (and clicking the name) opens the character/team switcher.
function toggleRosterMenu(e: Event) {
  e.stopPropagation();
  if (($("rosterToggle") as HTMLButtonElement).hidden) return; // solo character → no switcher
  ($("rosterMenu") as HTMLElement).hidden ? openRosterMenu() : closeRosterMenu();
}
$("rosterToggle").onclick = toggleRosterMenu;
$("charName").onclick = toggleRosterMenu;
$("reloadChar").onclick = () => reloadCurrent();

// Reveal + copy the loaded poke5e trainer's keys so they can be backed up. The write key is a
// secret cached only in the poke5e pane — it can't be regenerated if lost, so make it retrievable.
$("keysBtn").onclick = async () => {
  const k = await window.api.poke5eKeys().catch(() => null);
  if (!k?.ok) { setStatus(k?.error || "Load a trainer first", true); return; }
  const block = [
    `poke5e trainer: ${k.name}`,
    `Read key:  ${k.readKey}`,
    k.writeKey ? `Write key: ${k.writeKey}` : `Write key: (none cached — this trainer was loaded read-only)`,
  ].join("\n");
  await window.api.copyText(block).catch(() => {});
  setStatus(`🔑 Read ${k.readKey}${k.writeKey ? ` · Write ${k.writeKey}` : " · (read-only)"} — copied to clipboard`);
};

// ---- Hit points ----
// Fill the damage-type dropdown once (used to apply resistances/immunities/vulnerabilities).
for (const dt of DAMAGE_TYPES) {
  const o = document.createElement("option");
  o.value = dt; o.textContent = cap(dt);
  ($("hpDamageType") as HTMLSelectElement).appendChild(o);
}
$("hpDamage").onclick = () => applyHp("damage");
$("hpHeal").onclick = () => applyHp("heal");
$("bindToken").onclick = () => toggleBindToken();
($("hpAmount") as HTMLInputElement).addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Enter") applyHp("damage"); });
($("hpTemp") as HTMLInputElement).addEventListener("change", () => {
  if (!hp) return;
  const t = Math.max(0, Math.floor(Number(($("hpTemp") as HTMLInputElement).value) || 0));
  if (t !== hp.temp) commitHp(hp.removed, t);
});
// Close any open popover. In a multi-WebContentsView window, clicking the RIGHT pane (Roll20/DDB)
// never reaches this document, so an in-document outside-click listener alone can't catch it —
// hence also closing on window blur (focus left the sheet pane) and on Escape.
function closePopovers() {
  $("condList").hidden = true;
  $("charPickerList").hidden = true;
}
window.addEventListener("blur", closePopovers);
document.addEventListener("keydown", (e) => { if ((e as KeyboardEvent).key === "Escape") closePopovers(); });

// Conditions picker popover
$("condAddBtn").onclick = (e) => { e.stopPropagation(); const l = $("condList"); l.hidden = !l.hidden; };
document.addEventListener("click", (e) => { if (!(e.target as HTMLElement).closest("#conditions")) $("condList").hidden = true; });

$("hpUndo").onclick = () => {
  if (!hpUndo) return;
  const u = hpUndo;
  hpUndo = null;
  ($("hpUndo") as HTMLButtonElement).disabled = true;
  commitHp(u.removed, u.temp, /*recordUndo*/ false); // undo is a plain revert, not a new undo point
};

// ---- Remember & auto-load the last character opened ----
function rememberLastChar(id: string) {
  try { localStorage.setItem("lastCharId", id); } catch { /* ignore */ }
}
function lastCharId(): string | null {
  try { return localStorage.getItem("lastCharId"); } catch { return null; }
}

// Token bindings persist per character ref, so a bound token survives app restart / character switch
// (and, with auto-rebind below, a map change or rename).
function saveBinding() {
  try {
    if (!activeRef) return;
    if (boundToken) localStorage.setItem("bind:" + activeRef, JSON.stringify(boundToken));
    else localStorage.removeItem("bind:" + activeRef);
  } catch { /* ignore */ }
}
function loadBinding(ref: string): { id: string; name: string } | null {
  try { const s = localStorage.getItem("bind:" + ref); return s ? JSON.parse(s) : null; } catch { return null; }
}

// The app's own memory of poke5e read keys the user has loaded (so the picker rebuilds even if
// poke5e's local list is empty — e.g. the trainer was first opened via a pasted link).
function getPoke5eKeys(): string[] {
  try { return JSON.parse(localStorage.getItem("poke5eKeys") || "[]"); } catch { return []; }
}
function addPoke5eKey(key: string) {
  if (!key) return;
  try {
    const keys = getPoke5eKeys();
    if (!keys.includes(key)) { keys.push(key); localStorage.setItem("poke5eKeys", JSON.stringify(keys)); }
  } catch { /* ignore */ }
}

export {};
