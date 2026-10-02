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

# Rev 1.6: "L. Teardown photos" - last section of every Teardown Evaluation (all gearbox types). Optional (no completeness rule).
# The template gets one page with empty photo frames (paper use); the app replaces it with the captioned photos.
PHOTO_SUGGEST = ["As received", "Nameplate", "Oil drained", "Disassembled", "Housing", "Bearings", "Gears", "Shafts", "Seals", "Shims",
                 "Failure detail", "Cleaned parts", "Parts for reuse", "Parts for replacement"]
def teardown_photos_section():
    return {"id": "L", "title": "L. Teardown photos", "photos": False, "blocks": [
        {"type": "photos", "id": "teardown_photos", "scope": "L", "label": "Teardown photos", "suggest": PHOTO_SUGGEST,
         "help": "Add as many photos as needed (camera or gallery) and give each a short caption, e.g. As received, Disassembled or a component name. They print in this section of the PDF. Optional."}]}
PHOTO_NOTE = ["Attach teardown photos. Label each photo with a short caption, e.g. As received, Disassembled or a component name.",
              "Forms completed in the app print the photos and captions in this section."]
def draw_photo_page(c, M, W, ytop, ybot, navy, grid, grey):
    """2 photo frames with caption lines below ytop (template page of section L)."""
    from reportlab.lib import colors
    c.setFillColor(grey); c.setFont("Helvetica", 10)
    y = ytop
    for ln in PHOTO_NOTE: c.drawString(M, y - 10, ln); y -= 15
    y -= 8; slot = (y - ybot) / 2
    for i in range(2):
        top = y - i * slot; fh = slot - 44
        c.setStrokeColor(grid); c.setLineWidth(0.8); c.setDash(4, 3); c.rect(M, top - fh, W - 2 * M, fh, fill=0, stroke=1); c.setDash()
        c.setFillColor(grid); c.setFont("Helvetica", 10); c.drawCentredString(W / 2, top - fh / 2, f"Photo {i + 1}")
        c.setFillColor(navy); c.setFont("Helvetica-Bold", 10); c.drawString(M, top - fh - 18, "Caption:")
        c.setStrokeColor(grid); c.setLineWidth(0.5); c.line(M + 52, top - fh - 20, W - M, top - fh - 20)
