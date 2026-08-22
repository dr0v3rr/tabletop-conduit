import json, math
PROJ="/Users/author/projects/dndbeyond-roll20-app"
data=json.load(open(f"{PROJ}/recon/character_144074405.json"))["data"]

ABIL={1:"STR",2:"DEX",3:"CON",4:"INT",5:"WIS",6:"CHA"}
ABIL_KEY={1:"strength",2:"dexterity",3:"constitution",4:"intelligence",5:"wisdom",6:"charisma"}
SKILLS={"acrobatics":2,"animal-handling":5,"arcana":4,"athletics":1,"deception":6,"history":4,
"insight":5,"intimidation":6,"investigation":4,"medicine":5,"nature":4,"perception":5,
"performance":6,"persuasion":6,"religion":4,"sleight-of-hand":2,"stealth":2,"survival":5}

# gather all modifiers
mods=[]
for bucket in (data.get("modifiers") or {}).values():
    if isinstance(bucket,list): mods+=bucket

def mods_by(type_=None, sub=None):
    out=[]
    for m in mods:
        if type_ and m.get("type")!=type_: continue
        if sub and m.get("subType")!=sub: continue
        out.append(m)
    return out

# --- ability scores ---
base={s["id"]:s["value"] or 0 for s in data["stats"]}
bonus={s["id"]:(s["value"] or 0) for s in data.get("bonusStats",[])}
override={s["id"]:s["value"] for s in data.get("overrideStats",[])}
scores={}
for i in range(1,7):
    v=base[i]+bonus.get(i,0)
    # modifier-granted score bonuses e.g. subType 'strength-score'
    for m in mods_by("bonus", f"{ABIL_KEY[i]}-score"):
        v+=m.get("value") or 0
    if override.get(i): v=override[i]
    scores[i]=v
def mod(score): return math.floor((score-10)/2)

total_level=sum(c["level"] for c in data["classes"])
prof=math.ceil(total_level/4)+1

# --- save & skill proficiencies ---
def is_prof(sub):
    return bool(mods_by("proficiency",sub))
def is_expert(sub):
    return bool(mods_by("expertise",sub))
def is_half(sub):
    return bool(mods_by("half-proficiency",sub))

def prof_bonus(sub):
    if is_expert(sub): return prof*2
    if is_prof(sub): return prof
    if is_half(sub): return prof//2
    return 0

print(f"=== {data['name']}  |  {'/'.join(c['definition']['name']+' '+str(c['level']) for c in data['classes'])}  |  Prof +{prof} ===\n")
print("ABILITIES:")
for i in range(1,7):
    print(f"  {ABIL[i]} {scores[i]:2d} ({mod(scores[i]):+d})")

print("\nSAVING THROWS:")
saves={}
for i in range(1,7):
    sub=f"{ABIL_KEY[i]}-saving-throws"
    tot=mod(scores[i])+prof_bonus(sub)
    saves[i]=tot
    tag=" (prof)" if is_prof(sub) else ""
    print(f"  {ABIL[i]} {tot:+d}{tag}")

print("\nSKILLS:")
rollmodel={"name":data["name"],"prof":prof,"abilities":{},"saves":{},"skills":{}}
for i in range(1,7):
    rollmodel["abilities"][ABIL[i]]={"score":scores[i],"mod":mod(scores[i])}
    rollmodel["saves"][ABIL[i]]=saves[i]
for sk,ab in sorted(SKILLS.items()):
    tot=mod(scores[ab])+prof_bonus(sk)
    tag = " (exp)" if is_expert(sk) else (" (prof)" if is_prof(sk) else (" (half)" if is_half(sk) else ""))
    rollmodel["skills"][sk]={"mod":tot,"ability":ABIL[ab],"prof":is_prof(sk) or is_expert(sk)}
    if is_prof(sk) or is_expert(sk) or is_half(sk):
        print(f"  {sk:16s} {tot:+d}{tag}  [{ABIL[ab]}]")

json.dump(rollmodel, open(f"{PROJ}/recon/rollmodel.json","w"), indent=2)

# --- example Roll20 chat commands the app would inject ---
per=rollmodel["skills"]["perception"]["mod"]
dexsave=saves[2]
print("\n=== Roll20 chat commands the bridge would inject (NOT sent) ===")
print(f"  Perception check : /roll 1d20{per:+d}")
print(f"  DEX save         : /roll 1d20{dexsave:+d}")
print(f"  Advantage attack : /roll 2d20kh1{mod(scores[4])+prof:+d}")
print("  Templated (nicer):")
print(f"    &{{template:default}} {{{{name=Aldric: Perception}}}} {{{{Result=[[1d20{per:+d}]]}}}}")
print("\nsaved -> recon/rollmodel.json")
