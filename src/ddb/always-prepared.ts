// Always-prepared spells — a Paladin's Oath spells, a Cleric's Domain spells, and the spells the 2024
// classes always have prepared. D&D Beyond does NOT include these in the character JSON; its sheet
// fetches them per class (and per subclass) from a separate game-data endpoint. Without them Conduit
// listed an Oath of Vengeance Paladin with no Bane, Hunter's Mark, Hold Person or Misty Step.

/** The lookups to make: one per class and per subclass, at that class's level. */
export function alwaysPreparedRequests(data: unknown): { classEntryId: number; defId: number; level: number }[] {
  const out: { classEntryId: number; defId: number; level: number }[] = [];
  for (const c of (data as { classes?: any[] })?.classes ?? []) {
    if (typeof c?.id !== "number" || !c?.level) continue;
    for (const defId of [c.definition?.id, c.subclassDefinition?.id]) {
      if (typeof defId === "number") out.push({ classEntryId: c.id, defId, level: c.level });
    }
  }
  return out;
}

export function alwaysPreparedUrl(defId: number, level: number): string {
  return `https://character-service.dndbeyond.com/character/v5/game-data/always-prepared-spells?classId=${defId}&classLevel=${level}&sharingSetting=2`;
}

/** Add fetched always-prepared spells to their class's `classSpells` group (creating it if needed),
 *  skipping any spell the class already lists. Returns a new object; `data` is not mutated. */
export function mergeAlwaysPrepared<T>(data: T, byClassEntry: Map<number, any[]>): T {
  const d = data as { classSpells?: { characterClassId?: number; spells?: any[] }[] };
  const groups = (d.classSpells ?? []).map((g) => ({ ...g, spells: [...(g.spells ?? [])] }));
  for (const [classEntryId, spells] of byClassEntry) {
    let group = groups.find((g) => g.characterClassId === classEntryId);
    if (!group) groups.push((group = { characterClassId: classEntryId, spells: [] }));
    const have = new Set(group.spells.map((s) => s?.definition?.name));
    for (const s of spells) {
      const name = s?.definition?.name;
      if (!name || have.has(name)) continue;
      have.add(name);
      group.spells.push({ ...s, alwaysPrepared: true });
    }
  }
  return { ...data, classSpells: groups };
}
