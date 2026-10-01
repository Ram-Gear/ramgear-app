"""Stage-dependent gearbox layout shared by the PDF builders and tools/gen_forms.py.
stages = 1 (single), 2 (double), 3 (triple reduction). Double keeps the original field names exactly."""
TYPES = {1: "Single", 2: "Double", 3: "Triple"}
SLUG = {1: "single", 2: "double", 3: "triple"}

def shafts(n):
    """[(key, label)] input, intermediate(s), output"""
    if n == 1: return [("input", "Input"), ("output", "Output")]
    if n == 2: return [("input", "Input"), ("intermediate", "Intermediate"), ("output", "Output")]
    if n == 3: return [("input", "Input"), ("intermediate", "Intermediate 1"), ("intermediate2", "Intermediate 2"), ("output", "Output")]
    raise ValueError(n)

def meshes(n):
    """[(stage, text)]: stage k = pinion on shaft k-1 driving the gear on shaft k"""
    s = shafts(n)
    return [(str(k), f"{s[k-1][1]} pinion to {s[k][1].lower()} gear") for k in range(1, n + 1)]

def locs(n):
    """bearing locations: [(key, shaft label, 'DE'|'NDE')]"""
    out = []
    for k, l in shafts(n): out += [(f"{k}_de", l, "DE"), (f"{k}_nde", l, "NDE")]
    return out

def components(n):
    """teardown component inventory for shafts/gears: [(key, name, kind)] kind = 'shaft' | 'gear'"""
    s = shafts(n); out = []
    for i, (k, l) in enumerate(s):
        out.append((f"{k}_shaft", f"{l} shaft", "shaft"))
        if i > 0: out.append((f"{k}_gear", f"{l} gear (stage {i})", "gear"))
        if i < len(s) - 1: out.append((f"{k}_pinion", f"{l} pinion (stage {i + 1})", "gear"))
    return out

def titles(n):
    t = TYPES[n]
    return {"assembly": f"{t}-Reduction Helical Gearbox Assembly Checklist",
            "teardown": f"{t}-Reduction Helical Gearbox Teardown and Repair Analysis"}

def template(form, n):
    base = {"assembly": "gearbox-assembly-checklist", "teardown": "gearbox-teardown-analysis"}[form]
    return f"{base}-{SLUG[n]}"
