"""Assembly Verification fillable PDF template. python3 tools/make_assembly.py [1|2|3 ...] (default: all three types).
Generated from the original double-reduction layout; the stage count drives shafts, ratios, shim rows and backlash meshes."""
import io, re, sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import gbx_spec as G
N = int(os.environ.get("RG_STAGES", "2"))
from reportlab.lib.pagesizes import letter
from reportlab.pdfgen import canvas
from reportlab.lib.utils import simpleSplit
from reportlab.lib import colors

W, H = letter
M = 42
TOP = H - 64
BOT = 66
FH = 24          # text field height
CB = 20          # checkbox size
FS = 11          # field font size
HEADER = "Ram Gear Manufacturing Assembly Verification Data"
TITLE = G.titles(N)["assembly"]
FOOT = "Obtain all torque, preload, endplay, backlash, and clearance values from OEM drawings and bearing manufacturer data."
NAVY = colors.HexColor("#1F3A5F"); LIGHT = colors.HexColor("#E8EEF5"); GRID = colors.HexColor("#9AA8B8")

INFO = [("customer_name","Customer name",""),("work_order_number","Work order number",""),("manufacturer","Manufacturer",""),("model","Model",""),("serial","Serial number",""),
        ("ratio_overall","Reduction ratio (overall)",": 1")] + [(f"ratio_stage{k}",f"Stage {k} ratio",": 1") for k in range(1, N+1)] + [("oil_capacity","Oil capacity (gal / L)",""),
        ("oil_grade","Oil grade","")]
SH = G.shafts(N); SHL = [l.lower() for _, l in SH]

# items: (text, [(fieldkey, label, width_frac)])
S = [
("1. Prep and inspection", [
 ("Work order, drawings, BOM, and assembly spec on hand at current revision", []),
 ("Clean covered work area, lifting gear rated and inspected", []),
 ("Housing halves cleaned and deburred, oil galleries and drain/breather ports clear, no casting sand or chips", []),
 ("Split-line faces flat, no nicks, dowel holes undamaged", []),
 ("Bearing bores measured (diameter and roundness) against spec:", [("bore_spec","Spec / measured")]),
 ("Shafts checked for journal diameters, runout, keyway and thread condition", []),
 ("Gears inspected for tooth damage, burrs, correct hand of helix, mating sets matched by serial/match marks", []),
 ("Bearings checked for part number, cups and cones kept as matched sets in packaging until use", []),
 ("Seals, shims, gaskets, spacers, keys, fasteners counted against BOM", []),
 ("Measuring tools calibrated (micrometers, bore gauges, dial indicators, torque wrench)", []),
]),
(f"2. Shaft subassemblies ({', '.join(SHL)})", [
 ("Keys fitted to keyways with correct fit", []),
 ("Gears/pinions installed by press or shrink fit per spec (induction or oven, never open flame)", [("heat_temp","Heating temperature")]),
 ("Gear fully seated against shoulder, feeler gauge shows no gap", []),
 ("Spacers and retaining rings/locknuts installed and locked", []),
 ("Cones heated and installed (typically about 250\u00b0F/120\u00b0C max, confirm with bearing maker) and held against shoulder until cool", []),
 ("Cone seating rechecked after cooling", []),
 ("Runout of assembled gear checked:", [("gear_runout","Runout")]),
]),
("3. Housing preparation", [
 ("Cups installed square in bores (press or chill), fully seated against shoulder, confirmed with feeler gauge", []),
 ("Seal bores clean, seals ready in correct orientation", []),
 ("Internal surfaces painted or coated if specified", []),
]),
("4. Shaft installation and gear mesh", [
 (f"Shafts lowered in correct order (usually {', '.join(reversed(SHL))}, per drawing)", []),
 ("Helix hands and thrust directions checked against drawing", []),
 ("Mesh alignment confirmed, face widths centered, no axial offset beyond spec", []),
 ("Housing closed with sealant or gasket as specified, dowels installed before bolts", []),
 ("Split-line bolts torqued in sequence:", [("splitline_torque","Torque / sequence")]),
]),
("5. Bearing endplay or preload (each shaft)", [
 ("Bearing caps installed with starting shim pack", []),
 ("Shaft rotated while seating to get rollers onto the cone rib", []),
 ("Axial endplay measured with dial indicator (push-pull while rotating)", []),
 ("Shims adjusted to target endplay or preload (record final shim thickness below):", [("target_endplay","Target")]),
 ("Rolling torque checked if preload specified:", [("rolling_torque","Rolling torque")]),
 ("Cap bolts torqued:", [("cap_bolt_torque","Torque")]),
]),
("SHIM", None),
("6. Gear mesh verification", [
 ("Backlash measured at each stage with dial indicator at several points (record below)" if N > 1 else "Backlash measured at the gear mesh with dial indicator at several points (record below)", []),
 ("Contact pattern checked with marking compound (Prussian blue or gear marking paste) under light load, centered on tooth flank without heavy edge contact", []),
 ("Shafts turn freely by hand, no binding through a full revolution of output", []),
]),
("BACKLASH", None),
("7. Seals, closures, fittings", [
 ("Lip seals lubricated and installed with correct tool, lips undamaged and facing correct way", []),
 ("Shaft surfaces under seals polished, keyway edges covered with sleeve to protect lip", []),
 ("Inspection covers, breather, drain plug, sight glass or dipstick, oil lines installed", []),
 ("All fasteners torqued and torque-marked", []),
]),
("8. Lubrication and run-in", [
 ("Filled with specified oil grade and quantity:", [("oil_fill","Grade / quantity")]),
 ("No-load spin test: direction of rotation, speed, duration", [("spin_speed","Speed"),("spin_duration","Duration")]),
 ("Bearing temperatures monitored, stabilize below:", [("bearing_temp_limit","Temperature")]),
 ("Noise and vibration checked, readings recorded:", [("noise_vib","Readings")]),
 ("Leak check at seals, split line, plugs", []),
 ("Contact pattern rechecked after run-in if required", []),
]),
("9. Final and documentation", [
 ("Nameplate, rotation arrows, lifting points, oil fill tags attached", []),
 ("Shaft ends protected, keys taped or secured, openings capped", []),
 ("Serial numbers, bearing lot numbers, shim thicknesses, endplay, backlash, torques, test data recorded", []),
]),
("NOTES", None),
("SIGNOFF", None),
]

SHIM_ROWS = [(k, l, loc) for k, l in SH for loc in ("Drive end", "Non-drive end")]   # (key, shaft label, location)
BL_ROWS = G.meshes(N)

LAYOUT = []   # Rev 1.6.1: section page ranges -> tools/layout/<template>.json
class Doc:
    def __init__(s, buf, total):
        s.c = canvas.Canvas(buf, pagesize=letter, pageCompression=1)
        s.c.setTitle(TITLE); s.c.setAuthor("Gary Gillham"); s.c.setSubject("Assembly checklist")
        s.total = total; s.page = 0; s.names=set(); s.layout = LAYOUT; LAYOUT.clear()
        s.newpage(first=True)
    def decorate(s):
        c = s.c
        c.setFillColor(NAVY); c.rect(0, H-50, W, 50, fill=1, stroke=0)
        c.setFillColor(colors.white); c.setFont("Helvetica-Bold", 15)
        c.drawString(M, H-32, HEADER)
        c.setStrokeColor(GRID); c.setLineWidth(0.5); c.line(M, 50, W-M, 50)
        c.setFillColor(colors.HexColor("#444444")); c.setFont("Helvetica-Oblique", 7.5)
        c.drawString(M, 38, FOOT)
        c.setFont("Helvetica", 9)
        c.drawRightString(W-M, 24, f"Page {s.page} of {s.total}")
        c.drawString(M, 24, "Form: " + G.template("assembly", N))
    def newpage(s, first=False):
        if not first: s.c.showPage()
        s.page += 1; s.decorate(); s.y = TOP
        if s.page == 1:
            s.c.setFillColor(NAVY); s.c.setFont("Helvetica-Bold", 14)
            s.c.drawString(M, TOP - 8, TITLE)
            s.c.setStrokeColor(NAVY); s.c.setLineWidth(1); s.c.line(M, TOP-16, W-M, TOP-16)
            s.y = TOP - 24
    def need(s, h):
        if s.y - h < BOT: s.newpage()
    def uname(s, n):
        assert n not in s.names, n; s.names.add(n); return n
    def tf(s, name, x, y, w, h=FH, tip="", multi=False):
        s.c.acroForm.textfield(name=s.uname(name), tooltip=tip or name, x=x, y=y, width=w, height=h,
            fontName="Helvetica", fontSize=FS, borderColor=GRID, fillColor=colors.HexColor("#F7FAFD"),
            textColor=colors.black, borderWidth=1, borderStyle="solid", forceBorder=True,
            fieldFlags="multiline" if multi else "", maxlen=100000 if multi else None)
    def cb(s, name, x, y, tip=""):
        s.c.acroForm.checkbox(name=s.uname(name), tooltip=tip or name, x=x, y=y, size=CB,
            buttonStyle="check", borderColor=NAVY, fillColor=colors.white, textColor=NAVY,
            borderWidth=1.2, borderStyle="solid", forceBorder=True, checked=False)
    def section(s, title, extra=0):
        before = s.page; s.need(26 + extra); s.layout.append({"title": title, "before": before, "start": s.page})
        s.y -= 6
        c=s.c; c.setFillColor(LIGHT); c.rect(M, s.y-20, W-2*M, 22, fill=1, stroke=0)
        c.setFillColor(NAVY); c.rect(M, s.y-20, 4, 22, fill=1, stroke=0)
        c.setFont("Helvetica-Bold", 12); c.drawString(M+10, s.y-14, title)
        s.y -= 30

def build(total):
    buf = io.BytesIO(); d = Doc(buf, total); c = d.c
    # Section A
    d.section("A. Gearbox information", extra=len(INFO)*30)
    lw = 190
    for key,label,suffix in INFO:
        d.need(30)
        c.setFillColor(colors.black); c.setFont("Helvetica", 11)
        c.drawString(M+6, d.y-16, label)
        fw = (W-2*M-lw-6) - (40 if suffix else 0)
        d.tf(f"info_{key}", M+lw, d.y-FH, fw, tip=label)
        if suffix: c.drawString(M+lw+fw+8, d.y-16, suffix)
        d.y -= 30
    tx = M+34; tw = W-M-tx
    for si,(title,items) in enumerate(S):
        if title == "SHIM":
            shim_table(d); continue
        if title == "BACKLASH":
            backlash_table(d); continue
        if title == "NOTES":
            d.section("Notes", extra=130)
            nh = max(130, min(170, d.y - BOT - 8 - 180))
            d.tf("notes", M, d.y-nh, W-2*M, h=nh, tip="Notes", multi=True); d.y -= nh+8; continue
        if title == "SIGNOFF":
            signoff(d); continue
        sn = title.split(".")[0]
        first = items[0]
        def item_h(it):
            lines = simpleSplit(it[0], "Helvetica", 11, tw)
            return max(CB, len(lines)*14) + (FH+6 if it[1] else 0) + 7
        d.section(title, extra=item_h(first))
        for ii,(text,fields) in enumerate(items,1):
            lines = simpleSplit(text, "Helvetica", 11, tw)
            h = item_h((text,fields)); d.need(h)
            y0 = d.y
            d.cb(f"s{sn}_item{ii:02d}", M+6, y0-CB, tip=text[:80])
            c.setFillColor(colors.black); c.setFont("Helvetica", 11)
            ty = y0 - 14 if len(lines)>1 else y0-14
            for ln in lines:
                c.drawString(tx, ty, ln); ty -= 14
            d.y = y0 - max(CB, len(lines)*14) - 2
            if fields:
                n=len(fields); gap=12; fw_all=(tw-gap*(n-1))/n; x=tx
                for key,label in fields:
                    c.setFont("Helvetica", 9); c.setFillColor(colors.HexColor("#333333"))
                    lwid = c.stringWidth(label+":", "Helvetica", 9)+6
                    c.drawString(x, d.y-FH+8, label+":")
                    d.tf(f"s{sn}_{key}", x+lwid, d.y-FH, fw_all-lwid, tip=label)
                    x += fw_all+gap
                d.y -= FH+4
            d.y -= 5
    c.save()
    return buf.getvalue(), d.page

def header_row(d, cols, h=30, fsz=9):
    c=d.c; x=M
    c.setFillColor(NAVY); c.rect(M, d.y-h, sum(w for _,w in cols), h, fill=1, stroke=0)
    c.setFillColor(colors.white)
    for label,w in cols:
        lines = label.split("\n")
        c.setFont("Helvetica-Bold", fsz)
        yy = d.y - h/2 + (len(lines)-1)*5.5 - 3
        for ln in lines:
            c.drawCentredString(x+w/2, yy, ln); yy -= 11
        x+=w
    d.y -= h

def shim_table(d):
    c=d.c
    cols=[("Shaft",78),("Location",70),("Starting shim\n(in/mm)",60),("Final shim\n(in/mm)",54),
          ("Measured\nendplay/preload",68),("Spec",40),("OK",34),("Shim pack\nReplace / Reuse",124)]
    tot=sum(w for _,w in cols); assert abs(tot-(W-2*M))<2, tot
    rh=32
    d.need(22+30+rh*len(SHIM_ROWS)+10)
    d.y -= 4
    c.setFillColor(NAVY); c.setFont("Helvetica-Bold", 11); c.drawString(M, d.y-12, "BEARING SHIM RECORD"); d.y -= 20
    header_row(d, cols, fsz=8.5)
    keys=["start","final","measured","spec"]
    for ri,(skey,shaft,loc) in enumerate(SHIM_ROWS):
        y=d.y; c.setFillColor(LIGHT if ri%2 else colors.white); c.rect(M,y-rh,tot,rh,fill=1,stroke=0)
        c.setStrokeColor(GRID); c.setLineWidth(0.5); c.rect(M,y-rh,tot,rh,fill=0,stroke=1)
        c.setFillColor(colors.black); c.setFont("Helvetica-Bold",10); c.drawString(M+5,y-20,shaft)
        c.setFont("Helvetica",10); c.drawString(M+cols[0][1]+5,y-20,loc)
        base=f"shim_{skey}_{'de' if loc=='Drive end' else 'nde'}"
        x=M+cols[0][1]+cols[1][1]
        for k,(lbl,w) in zip(keys,cols[2:6]):
            d.tf(f"{base}_{k}", x+3, y-rh+4, w-6, tip=f"{shaft} {loc} {lbl.replace(chr(10),' ')}"); x+=w
        d.cb(f"{base}_ok", x+(cols[6][1]-CB)/2, y-rh+6, tip=f"{shaft} {loc} OK"); x+=cols[6][1]
        replace_reuse(d, base, x, y, rh, cols[7][1], f"{shaft} {loc} shim pack")
        d.y -= rh
    d.y -= 12

def replace_reuse(d, base, x, y, rh, cw, tip):
    """Rev 1.5.2: single-choice shim disposition, fields <base>_replace / <base>_reuse"""
    c=d.c; fs=9; opts=[("replace","Replace"),("reuse","Reuse")]
    tot=sum(CB+3+c.stringWidth(l,"Helvetica",fs) for _,l in opts)+8
    xx=x+(cw-tot)/2; cy=y-rh+(rh-CB)/2
    for k,l in opts:
        d.cb(f"{base}_{k}", xx, cy, tip=f"{tip}: {l}")
        c.setFillColor(colors.black); c.setFont("Helvetica",fs); c.drawString(xx+CB+3, cy+CB/2-3.2, l)
        xx+=CB+3+c.stringWidth(l,"Helvetica",fs)+8

def backlash_table(d):
    c=d.c
    cols=[("0\u00b0",62),("90\u00b0",62),("180\u00b0",62),("270\u00b0",62),("Min",62),("Max",62),("Spec",86),("OK",70)]
    tot=sum(w for _,w in cols); assert abs(tot-(W-2*M))<2, tot
    rh=32; mh=22
    d.need(20+14+(mh+30+rh)*min(2,len(BL_ROWS))+12+40)
    d.y -= 4
    c.setFillColor(NAVY); c.setFont("Helvetica-Bold", 11); c.drawString(M, d.y-12, "BACKLASH RECORD")
    c.setFont("Helvetica-Oblique",9); c.setFillColor(colors.HexColor("#333333"))
    c.drawString(M+130, d.y-12, "(measured at 4 points 90\u00b0 apart)")
    d.y -= 20
    for stage,mesh in BL_ROWS:
        d.need(mh+22+rh+8+(FH+14 if stage == BL_ROWS[-1][0] else 0))
        c.setFillColor(LIGHT); c.rect(M,d.y-mh,tot,mh,fill=1,stroke=0)
        c.setFillColor(colors.black); c.setFont("Helvetica-Bold",10.5)
        c.drawString(M+6,d.y-15,f"Stage {stage}"); c.setFont("Helvetica",10.5)
        c.drawString(M+60,d.y-15,f"Mesh: {mesh}")
        d.y-=mh
        header_row(d, cols, h=22)
        y=d.y; c.setStrokeColor(GRID); c.setLineWidth(0.5); c.rect(M,y-rh,tot,rh,fill=0,stroke=1)
        x=M
        for lbl,w in cols[:-1]:
            k={"0\u00b0":"deg000","90\u00b0":"deg090","180\u00b0":"deg180","270\u00b0":"deg270"}.get(lbl,lbl.lower())
            d.tf(f"backlash_stage{stage}_{k}", x+3, y-rh+4, w-6, tip=f"Stage {stage} {lbl}"); x+=w
        d.cb(f"backlash_stage{stage}_ok", x+(cols[-1][1]-CB)/2, y-rh+6, tip=f"Stage {stage} OK")
        d.y-=rh+8
    c.setFillColor(colors.black); c.setFont("Helvetica",11)
    c.drawString(M, d.y-16, "Checked by:"); d.tf("backlash_checked_by", M+70, d.y-FH, 250, tip="Backlash checked by")
    c.drawString(M+340, d.y-16, "Date:"); d.tf("backlash_date", M+375, d.y-FH, W-M-(M+375), tip="Backlash check date")
    d.y -= FH+14

def signoff(d):
    c=d.c
    d.section("Sign-off", extra=2*(FH+40))
    for role in ("Assembler","Inspector"):
        d.need(FH+30)
        c.setFillColor(NAVY); c.setFont("Helvetica-Bold",11); c.drawString(M, d.y-12, role); d.y-=18
        c.setFillColor(colors.HexColor("#333333")); c.setFont("Helvetica",9)
        x=M; widths=[("Name",200),("Signature",200),("Date",W-2*M-420)]
        for lbl,w in widths:
            c.drawString(x, d.y-9, lbl); x+=w+10
        d.y-=12; x=M
        for lbl,w in widths:
            d.tf(f"signoff_{role.lower()}_{lbl.lower()}", x, d.y-28, w, h=28, tip=f"{role} {lbl}"); x+=w+10
        d.y-=40

def main():
    _, n = build(1)
    data, n2 = build(n); assert n == n2
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import NameObject, BooleanObject
    r = PdfReader(io.BytesIO(data)); w = PdfWriter(clone_from=r)
    w._root_object["/AcroForm"][NameObject("/NeedAppearances")] = BooleanObject(True)
    w.compress_identical_objects()
    out = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "templates", G.template("assembly", N) + ".pdf")
    with open(out, "wb") as f: w.write(f)
    G.write_layout(out, LAYOUT, n)
    print("assembly", G.TYPES[N], "pages", n, out)

if __name__ == "__main__":
    import subprocess
    if len(sys.argv) > 1 or "RG_STAGES" not in os.environ:
        for a in (sys.argv[1:] or ["1", "2", "3"]): subprocess.run([sys.executable, __file__], env={**os.environ, "RG_STAGES": a}, check=True)
    else: main()
