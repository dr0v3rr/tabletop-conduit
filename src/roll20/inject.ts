// Roll20 chat injector — the DOM technique validated live and confirmed against Beyond20's
// postChatMessage (src/roll20/content-script.js:10-39). Runs in the Roll20 PAGE context
// (Electron: webContents.executeJavaScript in the main world; extension: a page-script).
//
// Modern Roll20 no longer exposes window.d20, so we drive the visible chat textarea + Send
// button directly, and — crucially — save/restore the user's in-progress text and the
// "speaking as" selection so we never clobber what they were typing.

/** The page-context function, as source, to inject/eval inside the Roll20 tab.
 *  Defines window.__b20SendRoll(command, speakingAs) → {ok, method, error?}. */
export const ROLL20_INJECT_SRC = String.raw`
window.__b20SendRoll = function (command, speakingAs) {
  try {
    var wrap = document.querySelector('#textchat-input');
    if (!wrap) return { ok: false, error: 'no #textchat-input' };
    var ta = wrap.querySelector('textarea');
    var btn = wrap.querySelector('button');
    if (!ta || !btn) return { ok: false, error: 'no textarea/button' };

    // Save current state so we don't clobber the user's typing.
    var prevText = ta.value;
    var sel = document.querySelector('#speakingas');
    var prevSpeaking = sel ? sel.value : null;

    try {
      // Set "speaking as" by matching the character name against the option text.
      if (sel && speakingAs) {
        var opts = Array.prototype.slice.call(sel.options);
        var match = opts.find(function (o) {
          return (o.textContent || '').trim().toLowerCase().indexOf(String(speakingAs).toLowerCase()) !== -1;
        });
        if (match) { sel.value = match.value; sel.dispatchEvent(new Event('change', { bubbles: true })); }
      }

      // Inject + send.
      ta.focus();
      ta.value = command;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      btn.click();
    } finally {
      // Always restore prior state — even if btn.click() throws — so an in-progress
      // chat message and the "speaking as" selection are never left clobbered.
      ta.value = prevText;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      if (sel && prevSpeaking != null) { sel.value = prevSpeaking; sel.dispatchEvent(new Event('change', { bubbles: true })); }
    }

    return { ok: true, method: 'textarea+send' };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
};
`;

/** Build the one-line expression to eval in the page to send `command` as `speakingAs`. */
export function buildSendExpression(command: string, speakingAs?: string): string {
  const c = JSON.stringify(command);
  const s = JSON.stringify(speakingAs ?? "");
  return `(function(){ ${ROLL20_INJECT_SRC}\n return window.__b20SendRoll(${c}, ${s}); })()`;
}
