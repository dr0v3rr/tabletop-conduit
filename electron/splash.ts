// Splash renderer — pick a character source + a VTT, then launch the app.
const api = (window as unknown as {
  api: {
    launchApp(config: { source: string; vtt: string }): Promise<{ ok: boolean }>;
    logout(): Promise<{ ok: boolean }>;
  };
}).api;

const $ = (id: string) => document.getElementById(id)!;
const NAMES: Record<string, string> = { ddb: "D&D Beyond", poke5e: "poke5e", roll20: "Roll20", foundry: "Foundry VTT" };

let source = "";
let vtt = "";

function refresh() {
  const ready = !!source && !!vtt;
  ($("launch") as HTMLButtonElement).disabled = !ready;
  $("summary").textContent = ready
    ? `${NAMES[source]} → ${NAMES[vtt]}. Ready when you are.`
    : !source && !vtt
      ? "Choose a character source and a tabletop."
      : !source
        ? "Now choose a character source."
        : "Now choose a tabletop.";
}

for (const btn of document.querySelectorAll<HTMLButtonElement>(".pick")) {
  btn.addEventListener("click", () => {
    if (btn.disabled) return;
    const kind = btn.dataset.kind!; // "source" | "vtt"
    const id = btn.dataset.id!;
    // Single-select within the same group.
    for (const other of document.querySelectorAll<HTMLElement>(`.pick[data-kind="${kind}"]`)) other.classList.remove("sel");
    btn.classList.add("sel");
    if (kind === "source") source = id; else vtt = id;
    refresh();
  });
}

$("launch").addEventListener("click", async () => {
  if (!source || !vtt) return;
  const b = $("launch") as HTMLButtonElement;
  b.disabled = true;
  b.textContent = "Setting up…";
  await api.launchApp({ source, vtt }).catch(() => {});
});

$("resetSession").addEventListener("click", async () => {
  const b = $("resetSession") as HTMLButtonElement;
  if (b.disabled) return;
  b.disabled = true;
  const prev = b.textContent;
  b.textContent = "Signing out…";
  try { await api.logout(); } catch { /* ignore */ }
  b.textContent = "Signed out ✓";
  setTimeout(() => { b.disabled = false; b.textContent = prev; }, 2500);
});

refresh();

export {};
