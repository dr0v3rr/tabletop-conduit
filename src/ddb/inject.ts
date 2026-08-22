// D&D Beyond sheet driver — runs in the embedded DDB WebContentsView (the user's real,
// logged-in sheet). Spending/restoring a slot here drives DDB's OWN slot tracker, so DDB
// persists the change to its server (verified: character-service `used` updates). This is the
// same "operate the real rendered sheet" model Beyond20 uses — no private API calls.

export const DDB_SLOTS_SRC = String.raw`
window.__ddbSlots = (function () {
  function ordinalToLevel(txt) {
    var m = (txt || '').match(/(Cantrip|1st|2nd|3rd|[4-9]th)\s*Level/i);
    if (!m) return null;
    if (/cantrip/i.test(m[0])) return 0;
    var d = m[0].match(/\d/);
    return d ? Number(d[0]) : null;
  }
  function managers() {
    var els = document.querySelectorAll('.ct-spells-level-casting__slot-group-manager .ct-slot-manager--size-small');
    var out = [];
    Array.prototype.forEach.call(els, function (m) {
      var n = m, level = null;
      for (var i = 0; i < 10 && n; i++) { n = n.parentElement; if (!n) break; var L = ordinalToLevel(n.innerText); if (L != null) { level = L; break; } }
      if (level == null) return;
      var slots = Array.prototype.slice.call(m.querySelectorAll('.ct-slot-manager__slot'));
      // Only count owner-editable trackers: the logged-out PUBLIC sheet renders slot managers
      // too, but without the --interactive class. Those can't be written, so skip them —
      // that keeps "connected" honest (true only when signed in as the owner).
      var interactive = slots.some(function (s) { return /--interactive/.test(s.className); });
      if (!interactive) return;
      out.push({ level: level, total: slots.length, used: slots.filter(function (s) { return s.getAttribute('aria-checked') === 'true'; }).length, slots: slots });
    });
    return out;
  }
  return {
    // Click the Spells tab so the slot managers render. Returns true if already present.
    ensureSpellsTab: function () {
      if (document.querySelector('.ct-spells-level-casting__slot-group-manager')) return true;
      var tabs = Array.prototype.slice.call(document.querySelectorAll('[class*=tabButton],[role=tab],.ddbc-tab-list__nav-item'));
      var sp = tabs.filter(function (t) { return /^\s*spells\s*$/i.test(t.textContent || ''); })[0];
      if (sp) { (sp.querySelector('button,a') || sp).click(); }
      return false;
    },
    read: function () { return managers().map(function (m) { return { level: m.level, total: m.total, used: m.used }; }); },
    spend: function (level) {
      var m = managers().filter(function (x) { return x.level === level; })[0];
      if (!m) return { ok: false, error: 'no L' + level + ' slots' };
      var a = m.slots.filter(function (s) { return s.getAttribute('aria-checked') === 'false'; })[0];
      if (!a) return { ok: false, error: 'no free L' + level + ' slot' };
      a.click();
      return { ok: true };
    },
    restore: function (level) {
      var m = managers().filter(function (x) { return x.level === level; })[0];
      if (!m) return { ok: false, error: 'no manager' };
      var u = m.slots.filter(function (s) { return s.getAttribute('aria-checked') === 'true'; })[0];
      if (!u) return { ok: false, error: 'none used' };
      u.click();
      return { ok: true };
    },
    restoreAll: function () {
      // Each click re-renders DDB and detaches the previously-captured slot nodes, so a
      // single captured array leaves later slots un-restored. Re-query between clicks and
      // click one still-used slot at a time until none remain (capped for safety).
      var remaining = 0;
      managers().forEach(function (m) {
        remaining += m.slots.filter(function (s) { return s.getAttribute('aria-checked') === 'true'; }).length;
      });
      for (var guard = remaining + 5; guard > 0; guard--) {
        var used = null, cur = managers();
        for (var i = 0; i < cur.length && !used; i++) {
          used = cur[i].slots.filter(function (s) { return s.getAttribute('aria-checked') === 'true'; })[0] || null;
        }
        if (!used) break;
        used.click();
      }
      return { ok: true };
    },
    loggedIn: function () {
      // Require an owner-editable (interactive) slot to exist, matching read()'s gate: the
      // logged-out PUBLIC sheet renders slot managers too but without the --interactive class,
      // so checking only for the character header gives a false-positive on a public sheet.
      return !!document.querySelector('.ct-slot-manager__slot--interactive');
    },
  };
})();
`;

/** Build a page-context expression that (re)defines the driver and calls one method. */
export function ddbSlotsExpr(method: "ensureSpellsTab" | "read" | "spend" | "restore" | "restoreAll" | "loggedIn", arg?: number): string {
  const a = arg === undefined ? "" : JSON.stringify(arg);
  return `(function(){ ${DDB_SLOTS_SRC}\n return window.__ddbSlots.${method}(${a}); })()`;
}

// ---------------------------------------------------------------------------
// Hit-dice driver — the Short Rest sidebar.
//
// IMPORTANT difference from spell slots: the hit-die slots inside the Short Rest
// pane are STAGED, not persisted. Toggling a slot there does NOT update the
// server's classes[].hitDiceUsed on its own (verified empirically). Only the
// "Take Short Rest" button commits the staged spend (and applies the healing —
// which is exactly what a short rest is). "Reset" reverts the staging with no
// server change. So the flow is: open -> stage N dice -> commit.
// ---------------------------------------------------------------------------

export const DDB_HITDICE_SRC = String.raw`
window.__ddbHitDice = (function () {
  function shortRestButton() {
    var labels = Array.prototype.slice.call(
      document.querySelectorAll('.ct-character-header-desktop__button-label, .ct-character-header-desktop__button')
    );
    var lab = labels.filter(function (e) { return /^\s*short rest\s*$/i.test(e.textContent || ''); })[0];
    if (!lab) return null;
    var b = lab;
    for (var i = 0; i < 4 && b; i++) { if (b.tagName === 'BUTTON') return b; b = b.parentElement; }
    return lab;
  }
  function pane() { return document.querySelector('.ct-reset-pane__hitdice'); }
  function pools() {
    var out = [];
    Array.prototype.forEach.call(document.querySelectorAll('.ct-reset-pane__hitdie'), function (row) {
      var heading = (row.querySelector('.ct-reset-pane__hitdie-heading') || row).textContent || '';
      var dieM = heading.match(/1d(\d+)/i);
      var totM = heading.match(/Total:\s*(\d+)/i);
      var clsEl = row.querySelector('.ct-reset-pane__hitdie-heading-class');
      var mgr = row.querySelector('.ct-slot-manager');
      var slots = mgr ? Array.prototype.slice.call(mgr.querySelectorAll('.ct-slot-manager__slot')) : [];
      var interactive = slots.some(function (s) { return /--interactive/.test(s.className); });
      out.push({
        cls: clsEl ? (clsEl.textContent || '').trim() : '',
        die: dieM ? Number(dieM[1]) : null,
        total: totM ? Number(totM[1]) : slots.length,
        used: slots.filter(function (s) { return s.getAttribute('aria-checked') === 'true'; }).length,
        interactive: interactive,
        slots: slots,
      });
    });
    return out;
  }
  function commitButton() {
    var btns = Array.prototype.slice.call(document.querySelectorAll('button, [role=button]'));
    return btns.filter(function (b) { return /take short rest/i.test(b.textContent || ''); })[0] || null;
  }
  function resetButton() {
    var scope = document.querySelector('.ct-reset-pane') || document;
    var btns = Array.prototype.slice.call(scope.querySelectorAll('button, [role=button]'));
    return btns.filter(function (b) { return /^\s*reset\s*$/i.test(b.textContent || ''); })[0] || null;
  }
  return {
    // Open the Short Rest sidebar if it isn't already showing. Returns true once the
    // hit-dice pane is present.
    open: function () {
      if (pane()) return true;
      var b = shortRestButton();
      if (b) b.click();
      return !!pane();
    },
    isOpen: function () { return !!pane(); },
    read: function () {
      return pools().map(function (p) { return { cls: p.cls, die: p.die, total: p.total, used: p.used, interactive: p.interactive }; });
    },
    // Stage 'n' additional spent dice for the pool with the given die size (or the
    // first interactive pool if die is null). Re-queries between clicks because each
    // click re-renders the manager. Returns how many were actually staged.
    stage: function (die, n) {
      var staged = 0;
      for (var guard = (n || 0) + 5; guard > 0 && staged < n; guard--) {
        var cur = pools().filter(function (p) { return p.interactive && (die == null || p.die === die); })[0];
        if (!cur) break;
        var free = cur.slots.filter(function (s) {
          return s.getAttribute('aria-checked') === 'false' && /--interactive/.test(s.className);
        })[0];
        if (!free) break;
        free.click();
        staged++;
      }
      return { ok: staged === n, staged: staged };
    },
    // Commit the staged short rest (persists hitDiceUsed + applies healing on DDB).
    commit: function () {
      var b = commitButton();
      if (!b) return { ok: false, error: 'no Take Short Rest button' };
      b.click();
      return { ok: true };
    },
    // Revert staging without any server change (closes nothing; just un-stages).
    reset: function () {
      var b = resetButton();
      if (b) { b.click(); return { ok: true }; }
      return { ok: false, error: 'no Reset button' };
    },
    loggedIn: function () { return !!document.querySelector('.ct-slot-manager__slot--interactive'); },
  };
})();
`;

export function ddbHitDiceExpr(
  method: "open" | "isOpen" | "read" | "stage" | "commit" | "reset" | "loggedIn",
  arg1?: number | null,
  arg2?: number,
): string {
  const args = [arg1, arg2]
    .filter((a) => a !== undefined)
    .map((a) => JSON.stringify(a))
    .join(", ");
  return `(function(){ ${DDB_HITDICE_SRC}\n return window.__ddbHitDice.${method}(${args}); })()`;
}

// ---------------------------------------------------------------------------
// Inventory driver.
//
// Quantity write-back uses D&D Beyond's OWN inventory endpoint — the exact call the sheet's
// React app makes — authenticated with the short-lived cobalt→JWT the logged-in page can mint
// (POST auth-service /v1/cobalt-token). This is the user's own token, own character, and the
// mutation they authorized; a single clean PUT is far more robust than scripting the inventory
// list's steppers. Quantity 0 is valid and non-destructive (the row stays, no delete needed).
//
// Adding / searching new items is intentionally NOT done here — that routes to DDB's native
// "Manage Inventory" search via openInventory(), per the hybrid design.
// ---------------------------------------------------------------------------

export const DDB_INVENTORY_SRC = String.raw`
window.__ddbInv = (function () {
  async function token() {
    var r = await fetch('https://auth-service.dndbeyond.com/v1/cobalt-token', { method: 'POST', credentials: 'include' });
    if (!r.ok) throw new Error('cobalt-token HTTP ' + r.status);
    return (await r.json()).token;
  }
  return {
    // Set one inventory row's quantity (0..n). Returns {ok, status, message, quantity}.
    setQuantity: async function (characterId, id, quantity) {
      try {
        var t = await token();
        var r = await fetch('https://character-service.dndbeyond.com/character/v5/inventory/item/quantity', {
          method: 'PUT', credentials: 'include',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + t },
          body: JSON.stringify({ characterId: characterId, id: id, quantity: quantity }),
        });
        var j = null; try { j = await r.json(); } catch (e) {}
        return { ok: !!(r.ok && j && j.success), status: r.status, message: j && j.message, quantity: quantity };
      } catch (e) { return { ok: false, error: String(e) }; }
    },
    // Bring the Inventory tab (and its Manage/search UI) to the fore so the user can add items.
    openInventory: function () {
      var tabs = Array.prototype.slice.call(document.querySelectorAll('[class*=tabButton],[role=tab],.ddbc-tab-list__nav-item'));
      var inv = tabs.filter(function (t) { return /^\s*inventory\s*$/i.test(t.textContent || ''); })[0];
      if (inv) { (inv.querySelector('button,a') || inv).click(); }
      // Try to open Manage Inventory (reveals the search box); harmless if absent.
      setTimeout(function () {
        var btns = Array.prototype.slice.call(document.querySelectorAll('button,a,[role=button]'));
        var manage = btns.filter(function (b) { return /manage inventory/i.test(b.textContent || ''); })[0];
        if (manage) manage.click();
      }, 400);
      return { ok: !!inv };
    },
    loggedIn: function () { return !!document.querySelector('.ct-inventory, .ct-equipment, [class*=inventory i]'); },
  };
})();
`;

/** Build a page-context expression to call an inventory-driver method (JSON-encoded args). */
export function ddbInventoryExpr(method: "setQuantity" | "openInventory" | "loggedIn", ...args: (number | string)[]): string {
  const a = args.map((x) => JSON.stringify(x)).join(", ");
  return `(function(){ ${DDB_INVENTORY_SRC}\n return window.__ddbInv.${method}(${a}); })()`;
}

// ---------------------------------------------------------------------------
// Character list — the logged-in user's own characters, for a picker instead of a raw ID box.
// Same call the "My Characters" page makes: characters/list?userId=<id>, where the userId comes
// from the cobalt→JWT (nameidentifier claim). Read-only; needs the page signed in to DDB.
// ---------------------------------------------------------------------------

export const DDB_CHARS_SRC = String.raw`
window.__ddbChars = (function () {
  return {
    list: async function () {
      try {
        var tr = await fetch('https://auth-service.dndbeyond.com/v1/cobalt-token', { method: 'POST', credentials: 'include' });
        if (!tr.ok) return { ok: false, error: 'Not signed in to D&D Beyond' };
        var token = (await tr.json()).token;
        if (!token) return { ok: false, error: 'Not signed in to D&D Beyond' };
        var claims = {};
        try { claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch (e) {}
        var uid = claims['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier'] || claims.sub;
        if (!uid) return { ok: false, error: 'Could not determine your D&D Beyond user id' };
        var rr = await fetch('https://character-service.dndbeyond.com/character/v5/characters/list?userId=' + encodeURIComponent(uid), {
          credentials: 'include', headers: { 'Authorization': 'Bearer ' + token },
        });
        if (!rr.ok) return { ok: false, error: 'Character list HTTP ' + rr.status };
        var j = await rr.json();
        var chars = ((j.data && j.data.characters) || []).map(function (c) {
          return {
            id: c.id,
            name: c.name || ('Character ' + c.id),
            level: c.level || 0,
            classDescription: c.classDescription || '',
            raceName: c.raceName || '',
            campaignName: c.campaignName || '',
            lastModified: c.lastModifiedDate || '',
          };
        });
        // Most recently edited first — the one you're likely here to open.
        chars.sort(function (a, b) { return String(b.lastModified).localeCompare(String(a.lastModified)); });
        return { ok: true, characters: chars };
      } catch (e) { return { ok: false, error: String(e) }; }
    },
  };
})();
`;

export function ddbCharsExpr(): string {
  return `(function(){ ${DDB_CHARS_SRC}\n return window.__ddbChars.list(); })()`;
}

// ---------------------------------------------------------------------------
// Authenticated character fetch — works for PRIVATE characters too. The public
// character-service GET 403s on private sheets; adding the cobalt→JWT bearer (the same the
// sheet uses) grants the owner access. Cookies alone are NOT enough — the JWT is required.
// ---------------------------------------------------------------------------

export const DDB_FETCHCHAR_SRC = String.raw`
window.__ddbFetchChar = async function (id) {
  try {
    var tr = await fetch('https://auth-service.dndbeyond.com/v1/cobalt-token', { method: 'POST', credentials: 'include' });
    if (!tr.ok) return { ok: false, authed: false, status: tr.status };
    var token = (await tr.json()).token;
    if (!token) return { ok: false, authed: false };
    var r = await fetch('https://character-service.dndbeyond.com/character/v5/character/' + id, {
      credentials: 'include', headers: { 'Authorization': 'Bearer ' + token },
    });
    if (!r.ok) return { ok: false, status: r.status };
    var j = await r.json();
    if (!j || !j.success || !j.data) return { ok: false, status: r.status, badBody: true };
    return { ok: true, data: j.data };
  } catch (e) { return { ok: false, error: String(e) }; }
};
`;

export function ddbFetchCharExpr(id: string | number): string {
  return `(function(){ ${DDB_FETCHCHAR_SRC}\n return window.__ddbFetchChar(${JSON.stringify(String(id))}); })()`;
}

// ---------------------------------------------------------------------------
// Hit-point write-back — DDB's own PUT /life/hp/damage-taken (the exact call the Heal/Damage
// controls make). Body needs BOTH removedHitPoints (damage taken) and temporaryHitPoints.
// ---------------------------------------------------------------------------

export const DDB_HP_SRC = String.raw`
window.__ddbHp = {
  set: async function (characterId, removedHitPoints, temporaryHitPoints) {
    try {
      var tr = await fetch('https://auth-service.dndbeyond.com/v1/cobalt-token', { method: 'POST', credentials: 'include' });
      if (!tr.ok) return { ok: false, error: 'Not signed in to D&D Beyond' };
      var token = (await tr.json()).token;
      var r = await fetch('https://character-service.dndbeyond.com/character/v5/life/hp/damage-taken', {
        method: 'PUT', credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
        body: JSON.stringify({ characterId: characterId, removedHitPoints: removedHitPoints, temporaryHitPoints: temporaryHitPoints }),
      });
      var j = null; try { j = await r.json(); } catch (e) {}
      return { ok: !!(r.ok && j && j.success), status: r.status, message: j && j.message };
    } catch (e) { return { ok: false, error: String(e) }; }
  },
};
`;

export function ddbHpSetExpr(characterId: number, removedHitPoints: number, temporaryHitPoints: number): string {
  return `(function(){ ${DDB_HP_SRC}\n return window.__ddbHp.set(${characterId}, ${removedHitPoints}, ${temporaryHitPoints}); })()`;
}
