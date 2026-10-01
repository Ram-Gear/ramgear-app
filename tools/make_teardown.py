"""Teardown Evaluation fillable PDF template. python3 tools/make_teardown.py [1|2|3 ...] (default: all three types)."""
import io, sys, os
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
FH = 24; CB = 20; FS = 11
HEADER = "Ram Gear Gearbox Evaluation"
TITLE = G.titles(N)["teardown"]
FOOT = "Obtain all dimensional, endplay, backlash, and clearance specs from OEM drawings and bearing manufacturer data."
FORMID = "Form: " + G.template("teardown", N)
OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "templates", G.template("teardown", N) + ".pdf")
NAVY = colors.HexColor("#1F3A5F"); LIGHT = colors.HexColor("#E8EEF5"); GRID = colors.HexColor("#9AA8B8")
FILL = colors.HexColor("#F7FAFD"); GREY = colors.HexColor("#333333")
CW = W - 2*M

class Doc:
    def __init__(s, buf, total):
        s.c = canvas.Canvas(buf, pagesize=letter, pageCompression=1)
        s.c.setTitle(TITLE); s.c.setAuthor("Gary Gillham"); s.c.setSubject("Gearbox teardown and repair analysis")
        s.total = total; s.page = 0; s.names = set()
        s.newpage(first=True)
    def decorate(s):
        c = s.c
        c.setFillColor(NAVY); c.rect(0, H-50, W, 50, fill=1, stroke=0)
        c.setFillColor(colors.white); c.setFont("Helvetica-Bold", 15); c.drawString(M, H-32, HEADER)
        c.setStrokeColor(GRID); c.setLineWidth(0.5); c.line(M, 50, W-M, 50)
        c.setFillColor(colors.HexColor("#444444")); c.setFont("Helvetica-Oblique", 7.5); c.drawString(M, 38, FOOT)
        c.setFont("Helvetica", 9); c.drawRightString(W-M, 24, f"Page {s.page} of {s.total}"); c.drawString(M, 24, FORMID)
    def newpage(s, first=False):
        if not first: s.c.showPage()
        s.page += 1; s.decorate(); s.y = TOP
        if s.page == 1:
            s.c.setFillColor(NAVY); s.c.setFont("Helvetica-Bold", 14); s.c.drawString(M, TOP-8, TITLE)
            s.c.setStrokeColor(NAVY); s.c.setLineWidth(1); s.c.line(M, TOP-16, W-M, TOP-16)
            s.y = TOP - 24
    def need(s, h):
        if s.y - h < BOT: s.newpage()
    def uname(s, n):
        assert n not in s.names, n; s.names.add(n); return n
    def tf(s, name, x, y, w, h=FH, tip="", multi=False, fill=FILL):
        s.c.acroForm.textfield(name=s.uname(name), tooltip=tip or name, x=x, y=y, width=w, height=h,
            fontName="Helvetica", fontSize=FS, borderColor=GRID, fillColor=fill, textColor=colors.black,
            borderWidth=1, borderStyle="solid", forceBorder=True,
            fieldFlags="multiline" if multi else "", maxlen=100000 if multi else None)
    def cb(s, name, x, y, tip=""):
        s.c.acroForm.checkbox(name=s.uname(name), tooltip=tip or name, x=x, y=y, size=CB, buttonStyle="check",
            borderColor=NAVY, fillColor=colors.white, textColor=NAVY, borderWidth=1.2, borderStyle="solid",
            forceBorder=True, checked=False)
    def section(s, title, extra=0):
        s.need(30 + extra); s.y -= 6
        c = s.c; c.setFillColor(LIGHT); c.rect(M, s.y-20, CW, 22, fill=1, stroke=0)
        c.setFillColor(NAVY); c.rect(M, s.y-20, 4, 22, fill=1, stroke=0)
        c.setFont("Helvetica-Bold", 12); c.drawString(M+10, s.y-14, title); s.y -= 30
    def subhead(s, text, extra=0):
        s.need(18 + extra)
        s.c.setFillColor(NAVY); s.c.setFont("Helvetica-Bold", 11); s.c.drawString(M, s.y-12, text); s.y -= 18

    # ---- primitives ----
    def grid_row(s, items, gap=12):
        """items: (key, label, frac, dict opts: suffix, h, multi). Label above field."""
        hmax = max(o.get("h", FH) for *_, o in items)
        s.need(12 + hmax + 8)
        x = M; tot = sum(f for _, _, f, _ in items); avail = CW - gap*(len(items)-1)
        for key, label, frac, o in items:
            w = avail*frac/tot; h = o.get("h", FH)
            s.c.setFillColor(GREY); s.c.setFont("Helvetica", 9); s.c.drawString(x, s.y-9, label)
            fw = w - (26 if o.get("suffix") else 0)
            s.tf(key, x, s.y-12-h, fw, h=h, tip=label, multi=o.get("multi", False))
            if o.get("suffix"):
                s.c.setFillColor(colors.black); s.c.setFont("Helvetica", 11); s.c.drawString(x+fw+5, s.y-12-h+8, o["suffix"])
            x += w + gap
        s.y -= 12 + hmax + 8
    def options(s, prefix, opts, label=None, x0=None):
        """horizontal checkbox group; opts: (key, text) or (key, text, fieldwidth) for 'other' with field"""
        c = s.c; s.need(CB + 10)
        x = x0 if x0 is not None else M
        if label:
            c.setFillColor(colors.black); c.setFont("Helvetica-Bold", 10.5); c.drawString(x, s.y-14, label)
            x += c.stringWidth(label, "Helvetica-Bold", 10.5) + 12
        xs = x
        for o in opts:
            key, text = o[0], o[1]; fw = o[2] if len(o) > 2 else 0
            wid = CB + 6 + c.stringWidth(text, "Helvetica", 11) + (fw + 6 if fw else 0) + 18
            if x + wid - 18 > W - M:
                s.y -= CB + 10; s.need(CB + 10); x = xs
            s.cb(f"{prefix}_{key}", x, s.y-CB, tip=text)
            c.setFillColor(colors.black); c.setFont("Helvetica", 11); c.drawString(x+CB+6, s.y-14, text)
            if fw:
                fx = x + CB + 6 + c.stringWidth(text, "Helvetica", 11) + 6
                s.tf(f"{prefix}_{key}_text", fx, s.y-FH+2, fw, tip=f"{text} (specify)")
            x += wid
        s.y -= CB + 10
    def item_notes(s, key, text, yesno=False, tw=215):
        """checkbox (or Yes/No) + text + notes field on same row"""
        c = s.c
        lines = simpleSplit(text, "Helvetica", 11, tw)
        h = max(FH, len(lines)*13 + 4); s.need(h + 8)
        y0 = s.y
        tx = M + 34
        if yesno:
            tx = M + 6
        else:
            s.cb(f"{key}_chk", M+6, y0-CB-2, tip=text)
        c.setFillColor(colors.black); c.setFont("Helvetica", 11)
        ty = y0 - 15
        for ln in lines: c.drawString(tx, ty, ln); ty -= 13
        nx = M + 34 + tw + 10
        if yesno:
            for lab in ("Yes", "No"):
                s.cb(f"{key}_{lab.lower()}", nx, y0-CB-2, tip=f"{text}: {lab}")
                c.setFillColor(colors.black); c.drawString(nx+CB+5, y0-15, lab); nx += CB + 5 + c.stringWidth(lab, "Helvetica", 11) + 14
        c.setFillColor(GREY); c.setFont("Helvetica", 9); c.drawString(nx, y0-15, "Notes:")
        nx += 32
        s.tf(f"{key}_notes", nx, y0-FH, W-M-nx, tip=f"{text} - notes")
        s.y -= h + 8
    def check_item(s, key, text):
        c = s.c; tw = CW - 34
        lines = simpleSplit(text, "Helvetica", 11, tw); h = max(CB, len(lines)*14)
        s.need(h + 8); y0 = s.y
        s.cb(key, M+6, y0-CB, tip=text); c.setFillColor(colors.black); c.setFont("Helvetica", 11)
        ty = y0 - 14
        for ln in lines: c.drawString(M+34, ty, ln); ty -= 14
        s.y -= h + 8
    def header_row(s, cols, h=26):
        c = s.c; x = M
        c.setFillColor(NAVY); c.rect(M, s.y-h, sum(w for _, w, *_ in cols), h, fill=1, stroke=0); c.setFillColor(colors.white)
        for col in cols:
            label, w = col[0], col[1]; lines = label.split("\n")
            c.setFont("Helvetica-Bold", 9); yy = s.y - h/2 + (len(lines)-1)*5.5 - 3
            for ln in lines: c.drawCentredString(x+w/2, yy, ln); yy -= 11
            x += w
        s.y -= h
    def table(s, prefix, cols, rows, rh=32, title=None):
        """cols: (header, width, kind, key) kind: label|tf|cb ; rows: (rowkey, [labels])"""
        tot = sum(cw for _, cw, *_ in cols); assert abs(tot - CW) < 2, tot
        if title: s.subhead(title, extra=26 + rh*min(3, len(rows)))
        s.need(26 + rh*min(3, len(rows))); s.header_row(cols)
        c = s.c
        for ri, (rk, labels) in enumerate(rows):
            if s.y - rh < BOT:
                s.newpage(); s.header_row(cols)
            y = s.y; c.setFillColor(LIGHT if ri % 2 else colors.white); c.rect(M, y-rh, tot, rh, fill=1, stroke=0)
            c.setStrokeColor(GRID); c.setLineWidth(0.5); c.rect(M, y-rh, tot, rh, fill=0, stroke=1)
            x = M; li = 0
            for hdr, cw, kind, key in cols:
                tip = f"{' '.join(labels)} {hdr.replace(chr(10), ' ')}"
                if kind == "label":
                    c.setFillColor(colors.black); c.setFont("Helvetica-Bold" if li == 0 else "Helvetica", 10)
                    c.drawString(x+5, y-rh/2-3.5, labels[li]); li += 1
                elif kind == "tf":
                    s.tf(f"{prefix}_{rk}_{key}", x+3, y-rh+4, cw-6, tip=tip)
                else:
                    s.cb(f"{prefix}_{rk}_{key}", x+(cw-CB)/2, y-rh+(rh-CB)/2, tip=tip)
                x += cw
            s.y -= rh
        s.y -= 10
    def multiline(s, key, label, h):
        s.need(12 + h + 8)
        s.c.setFillColor(GREY); s.c.setFont("Helvetica", 9); s.c.drawString(M, s.y-9, label)
        s.tf(key, M, s.y-12-h, CW, h=h, tip=label, multi=True); s.y -= 12 + h + 8
    def component(s, key, name, pn_fields, editable_name=False):
        """label bar with Reuse/Repair/Replace, then P/N fields + findings"""
        c = s.c; bh = 26; fh = 26
        s.need(bh + 4 + 12 + fh + 10)
        y = s.y
        c.setFillColor(LIGHT); c.rect(M, y-bh, CW, bh, fill=1, stroke=0)
        c.setFillColor(NAVY); c.rect(M, y-bh, 4, bh, fill=1, stroke=0)
        if editable_name:
            c.setFont("Helvetica-Bold", 10); c.drawString(M+10, y-17, "Other:")
            s.tf(f"{key}_name", M+50, y-bh+2, 200, h=22, tip="Other component name", fill=colors.white)
        else:
            c.setFont("Helvetica-Bold", 11); c.drawString(M+10, y-17, name)
        x = W - M - 8
        opts = ["Replace", "Repair", "Reuse"]
        for o in opts:
            x -= c.stringWidth(o, "Helvetica", 11) + CB + 5
            s.cb(f"{key}_{o.lower()}", x, y-bh+3, tip=f"{name}: {o}")
            c.setFillColor(colors.black); c.setFont("Helvetica", 11); c.drawString(x+CB+5, y-17, o)
            x -= 16
        s.y -= bh + 4
        # fields row (inline labels)
        xx = M + 10; y = s.y
        def lab(t, x):
            c.setFillColor(GREY); c.setFont("Helvetica", 9); c.drawString(x, y-fh/2-3, t)
            return x + c.stringWidth(t, "Helvetica", 9) + 5
        for fk, flabel, fw in pn_fields:
            xx = lab(flabel + ":", xx)
            s.tf(f"{key}_{fk}", xx, y-fh, fw, h=fh, tip=f"{name} {flabel}"); xx += fw + 12
        xx = lab("Findings:", xx)
        s.tf(f"{key}_findings", xx, y-fh, W-M-xx, h=fh, tip=f"{name} findings", multi=True)
        s.y -= fh + 10

LOC6 = G.locs(N); SH = G.shafts(N)

def build(total):
    buf = io.BytesIO(); d = Doc(buf, total); c = d.c
    # A
    d.section("A. Job information", extra=90)
    d.grid_row([("a_customer_name", "Customer name", 3, {}), ("a_work_order_number", "Work order number", 2, {})])
    d.grid_row([("a_date_received", "Date received", 2, {}), ("a_manufacturer", "Manufacturer", 3, {})])
    d.grid_row([("a_model", "Model", 1, {}), ("a_serial", "Serial number", 1, {})])
    d.grid_row([("a_ratio_overall", "Overall reduction", 1, {"suffix": ": 1"})] + [(f"a_ratio_stage{k}", f"Stage {k} ratio", 1, {"suffix": ": 1"}) for k in range(1, N + 1)])
    d.grid_row([("a_oil_capacity", "Oil capacity", 1, {}), ("a_oil_grade", "Oil grade", 1, {})])
    d.grid_row([("a_application", "Application / driven equipment", 3, {}), ("a_service_hours", "Service hours (if known)", 1, {})])
    d.multiline("a_reported_failure", "Reported failure / customer complaint", 52)
    # B
    d.section("B. As-received condition", extra=40)
    B = [("photos", "Photos taken as received"), ("external_damage", "External damage, cracks, missing parts"),
         ("nameplate", "Nameplate present and legible"), ("turns_freely", "Shafts turn freely by hand"),
         ("noise", "Noise or roughness when turned"), ("oil_leaks", "Oil leaks at seals / split line / plugs"),
         ("breather", "Breather condition")]
    for k, t in B:
        d.item_notes(f"b_{k}", t, yesno=(k == "turns_freely"))
    # C
    d.section("C. Oil condition", extra=45)
    d.grid_row([("c_oil_volume", "Oil drained - volume recovered", 1, {}), ("c_sample_id", "Oil sample ID (lab analysis)", 1, {})])
    d.options("c_sample_taken", [("yes", "Oil sample taken for lab analysis")])
    d.options("c_appearance", [("clean", "Clean"), ("dark", "Dark"), ("milky", "Milky (water)"), ("sludge", "Sludge"),
                               ("metallic", "Metallic particles")], label="Appearance:")
    d.multiline("c_drain_plug_debris", "Magnetic drain plug debris description", 40)
    # D
    d.section("D. As-found measurements before teardown", extra=45)
    d.grid_row([(f"d_endplay_{k}", f"Endplay - {l} shaft", 1, {}) for k, l in SH], gap=10)
    BL = [(f"d_backlash_stage{k}", f"Backlash - Stage {k}", 1, {}) for k in range(1, N + 1)]
    RO = [("d_runout_input", "Ext. runout - Input shaft", 1, {}), ("d_runout_output", "Ext. runout - Output shaft", 1, {})]
    if N <= 2: d.grid_row(BL + RO, gap=10)
    else: d.grid_row(BL, gap=10); d.grid_row(RO, gap=10)
    # E
    d.section("E. Teardown checklist", extra=30)
    d.check_item("e_match_marked", "Match-mark housing, caps, and shafts before disassembly")
    d.check_item("e_parts_tagged", "Parts tagged and kept in order")
    d.check_item("e_seals_inspected", "Seals removed and inspected")
    d.table("e_shim", [("Shaft", 150, "label", None), ("Drive end (DE)\nas-found shim (in/mm)", (CW-150)/2, "tf", "de_asfound"),
                       ("Non-drive end (NDE)\nas-found shim (in/mm)", (CW-150)/2, "tf", "nde_asfound")],
            [(k, [l]) for k, l in SH], rh=30, title="AS-FOUND SHIM RECORD")
    # F
    d.section("F. Component inventory and repair assessment", extra=90)
    PN = [("pn", "Part no.", 140)]
    GEAR = [("pn", "Part no.", 120), ("teeth", "Teeth", 44)]
    for k, n, kind in G.components(N):
        d.component(f"f_{k}", n, GEAR if kind == "gear" else PN)
    for k, a, b in LOC6:
        d.component(f"f_bearing_{k}", f"Bearing - {a} {b}", [("cone_pn", "Cone P/N", 110), ("cup_pn", "Cup P/N", 110)])
    for k, n in [("input_seal", "Input seal"), ("output_seal", "Output seal"), ("keys", "Keys and keyways"),
                 ("spacers", "Spacers and locknuts"), ("caps_shims", "Bearing caps and shims"),
                 ("housing", "Housing and bearing bores"), ("breather_plugs", "Breather, plugs, sight glass")]:
        d.component(f"f_{k}", n, PN)
    for i in range(1, 4):
        d.component(f"f_other{i}", f"Other component {i}", PN, editable_name=True)
    # G
    d.section("G. Failure modes observed", extra=120)
    d.subhead("Gears")
    d.options("g_gear", [("pitting", "Pitting"), ("spalling", "Spalling"), ("scuffing", "Scuffing/scoring"), ("wear", "Wear"),
                         ("breakage", "Tooth breakage"), ("plastic_def", "Plastic deformation"), ("corrosion", "Corrosion"),
                         ("contact_pattern", "Misaligned contact pattern")])
    d.subhead("Bearings", extra=60)
    d.options("g_bearing", [("spalling", "Spalling/fatigue"), ("brinelling", "Brinelling"), ("dents", "Contamination dents"),
                            ("overheating", "Overheating/discoloration"), ("corrosion", "Corrosion/etching"),
                            ("fluting", "Electrical fluting"), ("cage", "Cage damage"), ("skidding", "Skidding")])
    d.multiline("g_location_notes", "Location / notes", 52)
    # H
    d.section("H. Dimensional checks", extra=26+30*3+18)
    hc = [("Shaft", 78, "label", None), ("Loc.", 36, "label", None),
          ("Bearing bore\nmeasured", 80, "tf", "bore_measured"), ("Bearing bore\nspec", 80, "tf", "bore_spec"), ("Bore\nOK", 50, "cb", "bore_ok"),
          ("Shaft journal\nmeasured", 80, "tf", "journal_measured"), ("Shaft journal\nspec", 80, "tf", "journal_spec"), ("Journal\nOK", CW-484, "cb", "journal_ok")]
    d.table("h", hc, [(k, [a, b]) for k, a, b in LOC6], rh=30, title="BEARING BORE AND SHAFT JOURNAL DIAMETERS")
    d.multiline("h_seal_journal_notes", "Seal journal condition notes", 40)
    # I
    d.section("I. Root cause", extra=100)
    d.options("i_cause", [("lubrication", "Lubrication failure"), ("contamination", "Contamination"), ("overload", "Overload / shock load"),
                          ("misalignment", "Misalignment"), ("installation", "Improper installation"), ("fatigue", "Fatigue / end of life"),
                          ("mfg_defect", "Manufacturing defect"), ("other", "Other", 200)])
    d.multiline("i_narrative", "Root cause narrative", 80)
    # J
    d.section("J. Repair summary", extra=80)
    d.multiline("j_parts_to_replace", "Parts to replace", 56)
    d.multiline("j_machining", "Machining / repair work required", 56)
    d.multiline("j_upgrades", "Recommended upgrades or changes", 40)
    d.grid_row([("j_labor_hours", "Estimated labor hours", 1, {}), ("j_parts_cost", "Estimated parts cost", 1, {}),
                ("j_quote_number", "Quote number", 1, {})])
    d.options("j_recommend", [("repair", "Repair"), ("replace_unit", "Replace unit"), ("not_economical", "Not economical to repair")],
              label="Recommendation:")
    # K
    d.section("K. Sign-off", extra=170)
    for role, rk in (("Inspected by", "inspected"), ("Reviewed / approved by", "reviewed")):
        d.need(60)
        d.grid_row([(f"k_{rk}_name", f"{role} - name", 200, {"h": 28}), (f"k_{rk}_signature", "Signature", 200, {"h": 28}),
                    (f"k_{rk}_date", "Date", CW-420, {"h": 28})], gap=10)
    d.need(40)
    y0 = d.y
    d.cb("k_customer_approval", M+6, y0-CB-2, tip="Customer approval received")
    c.setFillColor(colors.black); c.setFont("Helvetica", 11); c.drawString(M+34, y0-15, "Customer approval received")
    c.setFillColor(GREY); c.setFont("Helvetica", 9); c.drawString(M+220, y0-15, "Date:")
    d.tf("k_customer_approval_date", M+250, y0-FH, 150, tip="Customer approval date")
    d.y -= FH + 10
    c.save()
    return buf.getvalue(), d.page

def main():
    _, n = build(1)
    data, n2 = build(n); assert n == n2
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import NameObject, BooleanObject
    r = PdfReader(io.BytesIO(data)); w = PdfWriter(clone_from=r)
    w._root_object["/AcroForm"][NameObject("/NeedAppearances")] = BooleanObject(True)
    w.compress_identical_objects()
    with open(OUT, "wb") as f: w.write(f)
    print("teardown", G.TYPES[N], "pages", n, OUT)

if __name__ == "__main__":
    import subprocess
    if len(sys.argv) > 1 or "RG_STAGES" not in os.environ:
        for a in (sys.argv[1:] or ["1", "2", "3"]): subprocess.run([sys.executable, __file__], env={**os.environ, "RG_STAGES": a}, check=True)
    else: main()
