// Roll20 token HP sync — runs in the Roll20 PAGE context (executeJavaScript in roll20View).
//
// Modern Roll20 has no window.d20, but window.Campaign (a Backbone model) exposes the active
// page and its graphics: Campaign.activePage().thegraphics.models. Each token model has
// name / bar{1,2,3}_value / bar{1,2,3}_max / bar{1,2,3}_link / represents / controlledby, and
// model.save({...}) syncs to the server — but ONLY for tokens the player may edit (writing a
// monster you don't control silently reverts). We match a token by NAME to the character and
// pick the bar whose max matches the sheet's max HP (falling back to bar1), so we drive the
// right bar without guessing.

export const ROLL20_TOKEN_SRC = String.raw`
window.__r20Token = (function () {
  function tokens(name) {
    try {
      var page = window.Campaign && window.Campaign.activePage ? window.Campaign.activePage() : null;
      if (!page || !page.thegraphics) return [];
      var models = page.thegraphics.models || [];
      var want = String(name || '').trim().toLowerCase();
      return models.filter(function (g) {
        var a = g && g.attributes; if (!a) return false;
        var n = String(a.name || '').trim().toLowerCase();
        return n && n === want && a.layer !== 'walls' && a.layer !== 'map';
      });
    } catch (e) { return []; }
  }
  // Which bar holds HP: the one whose max equals the sheet max (strong signal); else bar1.
  function hpBar(attrs, max) {
    if (max != null) {
      for (var i = 1; i <= 3; i++) {
        if (String(attrs['bar' + i + '_max']) === String(max)) return 'bar' + i;
      }
    }
    return 'bar1';
  }
  // ---- permission model: never READ into a bind list or WRITE HP for a token the current user
  // isn't allowed to control. A token is controllable if the user is GM, or its controlledby
  // (comma list of player ids) contains the current player id or the literal all.
  function playerId() {
    return (window.currentPlayer && (window.currentPlayer.id || (window.currentPlayer.get && window.currentPlayer.get('id')))) || '';
  }
  function isGM() { return (typeof window.is_gm !== 'undefined' && window.is_gm === true); }
  function mayControl(a) {
    if (isGM()) return true;
    var me = playerId();
    if (!me) return false; // our player id isn't resolved yet → fail safe (don't offer/write)
    var cb = String(a && a.controlledby || '');
    if (!cb) return false; // no controller = NPC / GM-only
    var ids = cb.split(',').map(function (s) { return s.trim(); }); // tolerate stray spaces
    return ids.indexOf(me) !== -1 || ids.indexOf('all') !== -1;
  }

  // Temp HP → the BLUE bar (bar2). If HP already sits on bar2, fall back to bar3 so we never clobber
  // the HP bar. temp>0 fills the bubble; temp<=0 clears it. Skips a linked (sheet-driven) bar.
  function applyTemp(attrs, patch, hpBarName, temp) {
    if (temp == null) return;
    var tbar = hpBarName === 'bar2' ? 'bar3' : 'bar2';
    if (attrs[tbar + '_link']) return;
    var v = Number(temp) > 0 ? String(Number(temp)) : '';
    patch[tbar + '_value'] = v;
    patch[tbar + '_max'] = v;
  }
  return {
    find: function (name, max) {
      return tokens(name).map(function (g) {
        var a = g.attributes;
        var bar = hpBar(a, max);
        return {
          id: g.id, name: a.name, layer: a.layer,
          bar: bar, value: a[bar + '_value'], max: a[bar + '_max'],
          linked: !!a[bar + '_link'], controlledby: a.controlledby,
        };
      });
    },
    // Set HP on every matching token's HP bar. Returns how many were written + which bar.
    setHp: function (name, current, max, temp) {
      var ts = tokens(name);
      if (!ts.length) return { ok: false, found: 0 };
      var bar = 'bar1', wrote = 0, linked = false, blocked = 0;
      ts.forEach(function (g) {
        var a = g.attributes;
        if (!mayControl(a)) { blocked++; return; } // never touch a token the user doesn't control
        bar = hpBar(a, max);
        if (a[bar + '_link']) { linked = true; return; } // linked bars are driven by a sheet attr, not the token
        var patch = {}; patch[bar + '_value'] = String(current);
        if (max != null) patch[bar + '_max'] = String(max);
        applyTemp(a, patch, bar, temp);
        try { g.save ? g.save(patch) : g.set(patch); wrote++; } catch (e) {}
      });
      return { ok: wrote > 0, found: ts.length, wrote: wrote, bar: bar, linked: linked, blocked: blocked };
    },
    // Tokens the current user may bind HP to, for the "bind to token" picker. IMPORTANT: this must
    // only offer tokens the user is permitted to control — never leak NPC/other-player token
    // positions or HP. So we return ONLY object-layer tokens (never map/walls/gmlayer) that the
    // current player controls (controlledby contains their id, or "all"). A GM sees every token.
    // (Roll20 sends visible object-layer tokens to every client, so filtering here is the app's job.)
    list: function () {
      try {
        var page = window.Campaign && window.Campaign.activePage ? window.Campaign.activePage() : null;
        if (!page || !page.thegraphics) return { ok: false, tokens: [] };
        var models = page.thegraphics.models || [];
        var out = models
          // Objects layer for everyone; a GM may also bind hidden NPCs on the GM layer (players
          // never receive gmlayer tokens from Roll20, so this can't leak to them).
          .filter(function (g) { var a = g && g.attributes; return a && (a.layer === 'objects' || (isGM() && a.layer === 'gmlayer')) && mayControl(a); })
          .map(function (g) {
            var a = g.attributes;
            return { id: g.id, name: a.name || '(unnamed)', bar1: a.bar1_value, bar1max: a.bar1_max, x: Math.round(a.left || 0), y: Math.round(a.top || 0) };
          });
        return { ok: true, tokens: out, gm: isGM() };
      } catch (e) { return { ok: false, tokens: [], error: String(e) }; }
    },
    // The token graphic currently SELECTED on the map, by id — kept as a best-effort path for the
    // Legacy (fabric) engine; on Jumpgate it returns no-selection-api and the picker (list) is used.
    selected: function () {
      try {
        var eng = window.d20 && window.d20.engine;
        if (!eng || typeof eng.selected !== 'function') {
          // Engine may have moved off window.d20 under Jumpgate — hunt for a selected()-provider.
          for (var k in window) {
            try {
              var v = window[k];
              if (v && typeof v === 'object') {
                if (typeof v.selected === 'function') { eng = v; break; }
                if (v.engine && typeof v.engine.selected === 'function') { eng = v.engine; break; }
              }
            } catch (e) {}
          }
        }
        if (!eng || typeof eng.selected !== 'function') return { ok: false, reason: 'no-selection-api' };
        var sel = eng.selected();
        if (!sel || !sel.length) return { ok: false, reason: 'nothing-selected' };
        var g0 = sel[0];
        var model = g0 && (g0.model || g0);
        var id = model && (model.id || (model.get && model.get('id')));
        if (!id) return { ok: false, reason: 'no-id' };
        // Resolve full info from the data layer.
        var page = window.Campaign && window.Campaign.activePage ? window.Campaign.activePage() : null;
        var gm = page && page.thegraphics ? page.thegraphics.get(id) : null;
        var a = gm ? gm.attributes : (model.attributes || {});
        return { ok: true, id: id, name: a.name, bar1: a.bar1_value, bar1max: a.bar1_max };
      } catch (e) { return { ok: false, reason: String(e) }; }
    },
    // Set HP on ONE token identified by id (used once a GM binds to a selected token).
    setHpById: function (id, current, max, temp) {
      try {
        var page = window.Campaign && window.Campaign.activePage ? window.Campaign.activePage() : null;
        var g = page && page.thegraphics ? page.thegraphics.get(id) : null;
        if (!g) return { ok: false, reason: 'token-gone' };
        var a = g.attributes;
        if (!mayControl(a)) return { ok: false, reason: 'not-controlled' }; // only your own tokens (GM: all)
        var bar = hpBar(a, max);
        if (a[bar + '_link']) return { ok: false, reason: 'linked', bar: bar };
        var patch = {}; patch[bar + '_value'] = String(current);
        if (max != null) patch[bar + '_max'] = String(max);
        applyTemp(a, patch, bar, temp);
        g.save ? g.save(patch) : g.set(patch);
        return { ok: true, bar: bar, name: a.name };
      } catch (e) { return { ok: false, reason: String(e) }; }
    },
    // Rename ONE token (by id) AND the character it represents to newName. poke5e is the source of
    // truth for names, and the logged-in trainer controls their own tokens/characters, so we may
    // write them. Renaming the CHARACTER is what updates the Roll20 chat speaker (chat attributes to
    // the character, not the token). Only touches objects the user controls (GM: all); no-ops when a
    // name already matches. Returns what changed so the UI can report it.
    renameById: function (id, newName) {
      try {
        var nm = String(newName == null ? '' : newName).trim();
        if (!nm) return { ok: false, reason: 'empty-name' };
        var page = window.Campaign && window.Campaign.activePage ? window.Campaign.activePage() : null;
        var g = page && page.thegraphics ? page.thegraphics.get(id) : null;
        if (!g) return { ok: false, reason: 'token-gone' };
        var a = g.attributes;
        if (!mayControl(a)) return { ok: false, reason: 'not-controlled' };
        var res = { ok: true, prevToken: a.name, prevChar: null, token: false, character: false };
        if (String(a.name || '') === nm) { res.token = 'unchanged'; }
        else { try { g.save ? g.save({ name: nm }) : g.set({ name: nm }); res.token = true; } catch (e) { res.tokenErr = String(e); } }
        var rep = a.represents;
        if (rep) {
          var coll = window.Campaign && window.Campaign.characters;
          var ch = coll && coll.get ? coll.get(rep) : null;
          if (ch && ch.attributes) {
            res.prevChar = ch.attributes.name;
            var ids = String(ch.attributes.controlledby || '').split(',').map(function (s) { return s.trim(); });
            var canChar = isGM() || (playerId() && (ids.indexOf(playerId()) !== -1 || ids.indexOf('all') !== -1));
            if (!canChar) res.charBlocked = true;
            else if (String(ch.attributes.name || '') === nm) res.character = 'unchanged';
            else { try { ch.save ? ch.save({ name: nm }) : ch.set({ name: nm }); res.character = true; } catch (e) { res.charErr = String(e); } }
          } else { res.charNotFound = true; }
        }
        return res;
      } catch (e) { return { ok: false, reason: String(e) }; }
    },
    inGame: function () {
      return !!(window.Campaign && window.Campaign.activePage && window.Campaign.activePage());
    },
    // The token id at the TOP of the turn order (whose turn it is), or null.
    turnTop: function () {
      try {
        var raw = window.Campaign && window.Campaign.get ? window.Campaign.get('turnorder') : null;
        if (!raw) return null;
        var arr = JSON.parse(raw);
        if (!arr || !arr.length) return null;
        return { id: arr[0].id, pr: arr[0].pr, count: arr.length };
      } catch (e) { return null; }
    },
  };
})();
`;

export function r20TokenExpr(method: "find" | "setHp" | "setHpById" | "selected" | "list" | "inGame" | "turnTop" | "renameById", ...args: (string | number | null)[]): string {
  const a = args.map((x) => JSON.stringify(x)).join(", ");
  return `(function(){ ${ROLL20_TOKEN_SRC}\n return window.__r20Token.${method}(${a}); })()`;
}
