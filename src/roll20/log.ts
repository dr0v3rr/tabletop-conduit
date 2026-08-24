// Roll20 chat-log scraper — runs in the Roll20 page context and reads the game chat into
// structured roll records (every player's rolls, not just ours). Roll20 groups consecutive
// messages from one speaker, so `.by`/timestamp only appear on the first of a run — we carry
// them forward. d20-ness comes from the inline roll's title formula; nat-20/nat-1 from the
// fullcrit/fullfail classes Roll20 puts on d20 results.

export const ROLL20_LOG_SRC = String.raw`
window.__roll20Log = {
  read: function () {
    var out = [];
    var curBy = null, curTs = null;
    var campaignId = (typeof window.campaign_id !== 'undefined' && window.campaign_id != null) ? String(window.campaign_id) : null;
    var msgs = document.querySelectorAll('#textchat .content .message');
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      var byEl = m.querySelector('.by');
      if (byEl && byEl.textContent) curBy = byEl.textContent.replace(/:\s*$/, '').trim();
      var tsAttr = m.getAttribute('data-timestamp');
      var tsEl = m.querySelector('.tstamp');
      if (tsAttr) curTs = tsAttr; else if (tsEl && tsEl.textContent) curTs = tsEl.textContent.trim();

      var rolls = m.querySelectorAll('.inlinerollresult');
      if (!rolls.length) {
        // NATIVE Roll20 rolls (/roll, /gmroll, sheet macros, manual dice) are rendered as
        // 'message rollresult' with a totally different DOM (.formula / .rolled / .dicegrouping)
        // and NO .inlinerollresult — so the template path below would miss them entirely.
        var isNative = /rollresult/.test(m.className || '') || m.querySelector('.dicegrouping, .rolled');
        if (isNative) {
          var nid = m.getAttribute('data-messageid');
          var fEl = m.querySelector('.formula'); // raw "rolling 1d20 + 5" (or "(To GM)rolling ...")
          var fRaw = (fEl && fEl.textContent) || '';
          var nName = fRaw.replace(/\(to gm\)/i, '').replace(/^\s*rolling\s*/i, '').replace(/\s+/g, ' ').trim();
          var rEl = m.querySelector('.rolled');
          var nTotal = rEl ? parseInt((rEl.textContent || '').trim(), 10) : NaN;
          var d20El = m.querySelector('.diceroll.d20');
          var nD20 = !!d20El || /\bd20\b/i.test(nName);
          var nRaw = null, nCrit = false, nFumble = false;
          if (d20El) {
            var didroll = d20El.querySelector('.didroll');
            var dv = parseInt(((didroll ? didroll.textContent : d20El.textContent) || '').replace(/[^\d-]/g, ''), 10);
            if (!isNaN(dv)) nRaw = dv;
            var d20cls = d20El.className || '';
            nCrit = nRaw === 20 || /critsuccess/.test(d20cls);
            nFumble = nRaw === 1 || /critfail/.test(d20cls);
          }
          // Non-d20 native roll (damage/heal etc.): any single die that came up 1 counts as a fumble.
          if (!nD20) {
            var dds = m.querySelectorAll('.dicegrouping .didroll');
            for (var dd = 0; dd < dds.length; dd++) { if (parseInt((dds[dd].textContent || '').replace(/[^\d-]/g, ''), 10) === 1) nFumble = true; }
          }
          var nGM = /\bprivate\b/.test(m.className || '') || /\(to gm\)/i.test(fRaw);
          var ffEl = m.querySelector('.formattedformula');
          out.push({
            id: nid, campaign: campaignId,
            player: (curBy || 'Unknown').replace(/\s*\(GM\)\s*$/i, ''),
            isGM: nGM, character: null,
            name: nName || 'Roll',
            total: isNaN(nTotal) ? null : nTotal,
            totals: isNaN(nTotal) ? [] : [nTotal],
            damage: (!nD20 && !isNaN(nTotal)) ? nTotal : 0,
            d20: nD20, rawD20: nRaw, crit: nCrit, fumble: nFumble,
            breakdown: (ffEl ? ffEl.textContent : nName).replace(/\s+/g, ' ').trim(),
            ts: curTs,
          });
        }
        continue; // native handled (or a non-roll message) — skip the template path
      }

      var id = m.getAttribute('data-messageid');
      var text = (m.innerText || '').replace(/\s+/g, ' ').trim();
      // Strip the leading "Player (GM):" label from the first message of a group.
      if (byEl && byEl.textContent) {
        var idx = text.indexOf(byEl.textContent);
        if (idx >= 0) text = text.slice(idx + byEl.textContent.length).trim();
      }

      var character = null, name = text;
      var cm = text.match(/^(.*?)\s+Charname\s+(.+?)\s+Roll\b/i);
      if (cm) { name = cm[1].trim(); character = cm[2].trim(); }
      else {
        // D&D-5e sheet templates put the roll label in .sheet-label; the message innerText also
        // has the result number prepended ("15 Sleight of Hand"), which must NOT be in the name.
        var labelEl = m.querySelector('.sheet-label');
        if (labelEl && labelEl.textContent && labelEl.textContent.trim()) {
          name = labelEl.textContent.replace(/\s+/g, ' ').trim();
        } else {
          name = text.replace(/\s*Roll\s+-?\d+\s*$/i, '').trim();
        }
      }

      var totals = [], isD20 = false, crit = false, fumble = false;
      var d20Result = null, damage = 0;
      for (var j = 0; j < rolls.length; j++) {
        var rr = rolls[j];
        var t = parseInt(rr.textContent, 10);
        if (!isNaN(t)) totals.push(t);
        var title = rr.getAttribute('title') || rr.getAttribute('original-title') || '';
        // STRIP TAGS before splitting on '=' — Roll20 prefixes a quantum-roll <img src="…"> whose
        // src= would otherwise truncate the formula, hiding the d20 (broke item/weapon attacks).
        var formula = title.replace(/<[^>]+>/g, '').split('=')[0] || '';
        if (/d20/i.test(formula)) {
          isD20 = true;
          if (!d20Result) d20Result = rr;
        } else if (/\dd\d/i.test(formula) && !isNaN(t)) {
          damage += t; // a dice roll that isn't a d20 → damage (or a spell effect die)
        }
      }
      // User preference: on NON-d20 rolls (potions, damage, healing), ANY die that came up 1 is
      // counted as a fumble too. (d20 rolls already use the kept die above, so an attack that hit
      // but rolled a 1 on its damage die is NOT flagged.)
      if (!isD20) {
        for (var k = 0; k < rolls.length; k++) {
          var tk = (rolls[k].getAttribute('title') || rolls[k].getAttribute('original-title') || '').replace(/<[^>]+>/g, '');
          var after = tk.split('=').slice(1).join('='); // the results portion, e.g. "(1+3)+2 = 6"
          var dm, dre = /\(([^)]*)\)/g;
          while ((dm = dre.exec(after))) {
            var parts = dm[1].split(/[+,]/);
            for (var pi = 0; pi < parts.length; pi++) {
              if (parseInt(parts[pi], 10) === 1) fumble = true;
            }
          }
        }
      }
      // Don't count healing/temp-HP rolls as damage.
      if (/\b(cure|heal|mending|revivif|goodberr|aid|false life|inspir)/i.test(name)) damage = 0;
      // Fallback: Roll20 populates the tooltip title asynchronously, so a fresh d20 roll may
      // have an empty title at scrape time. Recognize d20 rolls by their name too.
      var d20Name = /\b(save|check|initiative|attack)\b/i.test(name) ||
        /\b(acrobatics|animal handling|arcana|athletics|deception|history|insight|intimidation|investigation|medicine|nature|perception|performance|persuasion|religion|sleight of hand|stealth|survival)\b/i.test(name);
      if (!isD20 && d20Name) { isD20 = true; d20Result = rolls[0]; }
      var rawD20 = null, breakdown = '';
      if (isD20 && d20Result) {
        var dtitle = d20Result.getAttribute('title') || d20Result.getAttribute('original-title') || '';
        breakdown = dtitle.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').replace(/^Rolling\s*/i, '').trim();
        // Format A (our template + native rolls): kept natural d20 = first non-dropped
        // basicdiceroll span. SKIP value-0 spans — Beyond20 injects a 1d0 marker die (renders
        // as a basicdiceroll of 0) to force crit/fumble coloring; a real d20 is never 0.
        var re = /class="([^"]*basicdiceroll[^"]*)"[^>]*>(\d+)</g, mm;
        while ((mm = re.exec(dtitle))) {
          var v = parseInt(mm[2], 10);
          if (/dropped/.test(mm[1]) || v === 0) continue;
          rawD20 = v;
          break;
        }
        // Format B (D&D-5e sheet + Beyond20 relayed rolls): the real die is plain text after the
        // bracketed d20 group, e.g. "… [1d20 + 14] = (1) + 14 = 15". Prefer the die tied to the
        // 1d20 formula; fall back to the first parenthesized number after any '='.
        if (rawD20 == null) {
          var plain = dtitle.replace(/<[^>]+>/g, '');
          var pm = plain.match(/\[[^\]]*d20[^\]]*\]\s*=\s*\(?\s*(\d+)/i) || plain.match(/=\s*\(?\s*(\d+)/);
          if (pm) rawD20 = parseInt(pm[1], 10);
        }
        // Prefer the actual kept die (unambiguous) over Roll20's fullcrit/fullfail class — Roll20
        // does NOT reliably apply those (e.g. an attack's cs>20 suppresses the nat-1 fullfail flag),
        // so nat 1 / nat 20 must be read from the die value. Class is only a fallback when the
        // tooltip title (and thus rawD20) hasn't rendered yet.
        var cls = d20Result.className;
        crit = rawD20 === 20 || (rawD20 == null && /\bfullcrit\b/.test(cls));
        fumble = rawD20 === 1 || (rawD20 == null && /\bfullfail\b/.test(cls));
      }

      // GM roll = rolled by the GM account (Roll20 appends "(GM)" to the name) or a private/whispered roll.
      var isGM = /\(gm\)/i.test(curBy || '') || /\bprivate\b/.test(m.className || '');

      out.push({
        id: id,
        campaign: campaignId,
        player: (curBy || 'Unknown').replace(/\s*\(GM\)\s*$/i, ''),
        isGM: isGM,
        character: character,
        name: name || 'Roll',
        total: totals.length ? totals[0] : null,
        totals: totals,
        damage: damage,
        d20: isD20,
        rawD20: rawD20,
        crit: crit,
        fumble: fumble,
        breakdown: breakdown,
        ts: curTs,
      });
    }
    return out;
  },
};
`;

export interface RollRecord {
  id: string;
  campaign: string | null; // Roll20 campaign id (window.campaign_id) — for per-campaign history
  player: string;
  isGM: boolean; // rolled by the GM (or a private/whispered roll) — hidden from stats by default
  character: string | null;
  name: string;
  total: number | null;
  totals: number[];
  damage: number; // total damage dice rolled in this message (non-d20 dice; healing excluded)
  d20: boolean;
  rawD20: number | null; // the kept natural d20 die (before modifiers) — for true luck stats
  crit: boolean;
  fumble: boolean;
  breakdown: string; // plain-text dice breakdown, for hover
  ts: string | null;
}

/** Page-context expression that (re)defines the reader and returns the parsed records. */
export function roll20LogExpr(): string {
  return `(function(){ ${ROLL20_LOG_SRC}\n return window.__roll20Log.read(); })()`;
}
