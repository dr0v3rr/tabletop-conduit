import json
from collections import Counter, defaultdict
data=json.load(open("/Users/author/projects/dndbeyond-roll20-app/recon/character_144074405.json"))["data"]

mods=[]
for bucket,arr in (data.get("modifiers") or {}).items():
    if isinstance(arr,list):
        for m in arr: 
            m["_bucket"]=bucket; mods.append(m)

print("=== MODIFIER TAXONOMY (type -> subTypes) — what the engine must aggregate ===")
by_type=defaultdict(Counter)
for m in mods:
    by_type[m.get("type")][m.get("subType")] += 1
for t,subs in sorted(by_type.items()):
    print(f"\n  type={t!r} ({sum(subs.values())})")
    for s,c in subs.most_common():
        print(f"      {s}")

print("\n\n=== ROLL-AFFECTING modifiers (bonus/advantage/expertise/proficiency/set to hit/damage/save/skill) ===")
interesting={"bonus","advantage","disadvantage","expertise","half-proficiency","proficiency","damage","set","reroll","bonus-speed"}
for m in mods:
    if m.get("type") in interesting:
        print(f"  [{m['_bucket']}] type={m.get('type')} sub={m.get('subType')} value={m.get('value')} "
              f"dice={ (m.get('dice') or {}).get('diceString') if m.get('dice') else None } "
              f"| {m.get('friendlyTypeName')}: {m.get('friendlySubtypeName')}")

print("\n\n=== FEATS (definition name + what they grant) ===")
for f in (data.get("feats") or []):
    d=f.get("definition") or {}
    print(f"\n  FEAT: {d.get('name')}")
    # feat-granted modifiers live in the 'feat' modifier bucket keyed by componentId
    fid=d.get("id")
    granted=[m for m in mods if m.get("componentId")==fid or m.get("_bucket")=="feat"]
    # description snippet
    desc=(d.get("description") or "").replace("<p>"," ").replace("</p>"," ")
    import re; desc=re.sub("<[^>]+>","",desc)
    print("     desc:", desc[:220].strip())

print("\n\n=== CLASS ACTIONS / FEATURES that mention roll changes ===")
acts=data.get("actions") or {}
for bucket,arr in acts.items():
    if not isinstance(arr,list): continue
    for a in arr:
        name=a.get("name")
        snippet=(a.get("snippet") or "")
        import re; snippet=re.sub("<[^>]+>","",snippet)
        if any(k in (snippet.lower()+name.lower()) for k in ["advantage","add","bonus","reroll","+","damage","proficiency","instead"]):
            print(f"  [{bucket}] {name}: {snippet[:140].strip()}")
