"""Rev 1.6: Planetary gearbox forms (1-4 planetary stages).
One spec drives both outputs, so field names always match:
  * definitions for forms.json (imported by tools/gen_forms.py: teardown_def(k), assembly_def(k))
  * the fillable PDF templates templates/gearbox-{teardown-analysis|assembly-checklist}-planetary{k}.pdf
python tools/make_planetary.py [k ...]   (default 1 2 3 4; needs reportlab + pypdf)"""
import io, os, sys, copy
HERE = os.path.dirname(os.path.abspath(__file__)); APP = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import gbx_spec as G

# ------------------------------------------------------------------ spec helpers (same block schema as forms.json)
def F(name, label, **kw): d = {"type": "field", "name": name, "label": label}; d.update(kw); return d
def row(fields, rid=None, label=None, req=True):
    b = {"type": "row", "fields": fields}
    if req:
        names = [f["name"] for f in fields if not f.get("calc")]
        b["req"] = {"id": rid or fields[0]["name"], "label": label or " / ".join(f["label"] for f in fields), "all": names}
    return b
def choice(prefix, opts, label=None, exclusive=False, req=None):
    b = {"type": "choice", "label": label, "exclusive": exclusive, "options": [{"name": f"{prefix}_{o[0]}", "label": o[1]} for o in opts]}
    if req: b["req"] = {"id": prefix, "label": req, "any": [o["name"] for o in b["options"]]}
    return b
def check(name, label, fields=(), sec=""):
    sub = [{"name": n, "label": l} for n, l in fields]
    return {"type": "check", "name": name, "label": label, "fields": sub, "req": {"id": name, "label": f"{sec}{label}", "all": [name] + [s["name"] for s in sub]}}
RRR = ("reuse", "repair", "replace")
def comp(key, name, fields=(("pn", "Part no."),), other=False):
    b = {"type": "component", "id": key, "name": name, "photos": True,
         "options": [{"name": f"{key}_{o}", "label": o.capitalize()} for o in RRR],
         "fields": [{"name": f"{key}_{k}", "label": l} for k, l in fields], "findings": f"{key}_findings",
         "req": {"id": key, "label": f"{name}: Reuse / Repair / Replace", "any": [f"{key}_{o}" for o in RRR]}}
    if other: b["nameField"] = f"{key}_name"; b["req"]["onlyIf"] = f"{key}_name"
    return b
def rr(base): return {"kind": "choice", "name": f"{base}_disp", "options": [{"name": f"{base}_replace", "label": "Replace"}, {"name": f"{base}_reuse", "label": "Reuse"}]}
def rrr(base): return {"kind": "choice", "name": f"{base}_disp", "options": [{"name": f"{base}_{o}", "label": o.capitalize()} for o in RRR]}
MAXP = 6   # planet rows per stage; rows above the entered number of planets are not required
MEAS = [("sun_planet_backlash", "Sun-planet backlash"), ("planet_ring_backlash", "Planet-ring backlash"), ("sun_float", "Sun gear float / axial play"),
        ("carrier_endplay", "Carrier endplay"), ("thrust_washer", "Thrust washer thickness")]

def stage_head(p, i):
    return [row([F(f"{p}_sun_teeth", "Sun gear teeth (Z sun)"), F(f"{p}_ring_teeth", "Ring gear teeth (Z ring)"), F(f"{p}_planet_teeth", "Planet gear teeth"), F(f"{p}_planet_count", "Number of planets")],
                f"{p}_teeth", f"Stage {i} tooth counts and number of planets"),
            row([F(f"{p}_ratio_calc", "Stage ratio, calculated (1 + Z ring / Z sun)", suffix=": 1", calc={"planetRatio": [f"{p}_ring_teeth", f"{p}_sun_teeth"]}),
                 F(f"{p}_ratio_measured", "Stage ratio, measured (input turns per carrier turn)", suffix=": 1")], f"{p}_ratio", f"Stage {i} ratio (measured)")]
def meas_table(p, i):
    return {"type": "table", "title": f"Stage {i} measurements", "columns": ["Measurement", "Measured", "Spec", "OK"], "labelCols": 1,
            "rows": [{"label": [l], "cells": [{"kind": "text", "name": f"{p}_{k}_measured"}, {"kind": "text", "name": f"{p}_{k}_spec"}, {"kind": "check", "name": f"{p}_{k}_ok"}],
                      "req": {"id": f"{p}_{k}", "label": f"Stage {i} {l[0].lower() + l[1:]}", "all": [f"{p}_{k}_measured"]}} for k, l in MEAS]}
def coupling_name(i, k): return f"Coupling / spline, stage {i} to stage {i + 1}" if i < k else f"Output spline / coupling (stage {k} carrier to output)"
def titles(k): return {"teardown": f"Planetary Gearbox - {k}-Stage Teardown and Repair Analysis", "assembly": f"Planetary Gearbox - {k}-Stage Assembly Checklist"}
def template(form, k): return {"assembly": "gearbox-assembly-checklist", "teardown": "gearbox-teardown-analysis"}[form] + f"-planetary{k}"

# ------------------------------------------------------------------ Teardown Evaluation
def teardown_def(k, helical_sections):
    """helical_sections: {id: section} from the helical teardown (B, C, G, I, J, K are shared unchanged)"""
    S = []
    S.append({"id": "A", "title": "A. Job information", "photos": True, "blocks": [
        row([F("a_customer_name", "Customer name", link="customer"), F("a_work_order_number", "Work order number", link="wo")], "a_job"),
        row([F("a_date_received", "Date received", input="date"), F("a_manufacturer", "Manufacturer", link="manufacturer")], "a_recv"),
        row([F("a_model", "Model", link="model"), F("a_serial", "Serial number", link="serial")], "a_model"),
        row([F("a_ratio_overall", "Overall reduction", suffix=": 1")] + [F(f"a_ratio_stage{i}", f"Stage {i} ratio", suffix=": 1") for i in range(1, k + 1)], "a_ratios"),
        row([F("a_oil_capacity", "Oil capacity"), F("a_oil_grade", "Oil grade")], "a_oil"),
        row([F("a_application", "Application / driven equipment"), F("a_service_hours", "Service hours (if known)")], req=False),
        {**F("a_reported_failure", "Reported failure / customer complaint", multiline=True, rows=3), "req": {"id": "a_reported_failure", "label": "Reported failure / customer complaint", "all": ["a_reported_failure"]}}]})
    S.append(copy.deepcopy(helical_sections["B"])); S.append(copy.deepcopy(helical_sections["C"]))
    S.append({"id": "D", "title": "D. As-found measurements before teardown", "photos": True, "blocks": [
        row([F("d_endplay_input", "Endplay - Input shaft"), F("d_endplay_output", "Endplay - Output shaft")], "d_endplay", "As-found endplay"),
        row([F("d_backlash_output", "Output rotational backlash (input locked)"), F("d_runout_input", "Ext. runout - Input shaft"), F("d_runout_output", "Ext. runout - Output shaft")], "d_backlash", "As-found backlash / runout")]})
    eb = [check(n, t) for n, t in [("e_match_marked", "Match-mark housing, ring gears, carriers and shafts before disassembly"), ("e_parts_tagged", "Parts tagged and kept in order, by planetary stage"),
                                   ("e_seals_inspected", "Seals removed and inspected")]]
    SH = [("input", "Input"), ("output", "Output")]
    eb.append({"type": "table", "title": "As-found shim record", "columns": ["Shaft", "Drive end (DE) as-found shim (in/mm)", "Non-drive end (NDE) as-found shim (in/mm)", "Shim pack"], "labelCols": 1,
               "rows": [{"label": [l], "cells": [{"kind": "text", "name": f"e_shim_{s}_de_asfound"}, {"kind": "text", "name": f"e_shim_{s}_nde_asfound"}, rr(f"e_shim_{s}")],
                         "req": {"id": f"e_shim_{s}", "label": f"As-found shim: {l}", "all": [f"e_shim_{s}_de_asfound", f"e_shim_{s}_nde_asfound"], "any": [f"e_shim_{s}_replace", f"e_shim_{s}_reuse"]}} for s, l in SH]})
    S.append({"id": "E", "title": "E. Teardown checklist", "photos": True, "blocks": eb})
    for i in range(1, k + 1):
        p = f"p{i}"; st = f"Stage {i} "
        b = stage_head(p, i) + [meas_table(p, i)]
        b += [{"type": "subhead", "text": "Sun gear"},
              choice(f"{p}_sun_cond", [("ok", "No defects"), ("wear", "Tooth wear"), ("pitting", "Pitting / spalling"), ("spline", "Spline wear / fretting"), ("cracks", "Cracks / breakage")], label="Sun gear condition", req=f"{st}sun gear condition"),
              comp(f"{p}_sun", f"{st}sun gear"),
              {"type": "subhead", "text": "Planet gears"},
              {"type": "table", "title": f"Stage {i} planets (one row per planet)", "labelCols": 1,
               "columns": ["Planet", "Gear teeth condition", "Pin / shaft wear & fit", "Bearing / needle rollers", "Thrust washers", "Planet"],
               "rows": [{"label": [f"Planet {j}"], "cells": [{"kind": "text", "name": f"{p}_planet{j}_{c}"} for c in ("teeth", "pin", "bearing", "washer")] + [rrr(f"{p}_planet{j}")],
                         "req": {"id": f"{p}_planet{j}", "label": f"{st}planet {j}: condition / Reuse / Repair / Replace", "all": [f"{p}_planet{j}_teeth", f"{p}_planet{j}_pin", f"{p}_planet{j}_bearing", f"{p}_planet{j}_washer"],
                                 "any": [f"{p}_planet{j}_{o}" for o in RRR], "ifCount": {"field": f"{p}_planet_count", "min": j}}} for j in range(1, MAXP + 1)]},
              comp(f"{p}_planet_pins", f"{st}planet pins / shafts"), comp(f"{p}_planet_bearings", f"{st}planet bearings / needle rollers"), comp(f"{p}_thrust_washers", f"{st}thrust washers"),
              {"type": "subhead", "text": "Ring gear"},
              choice(f"{p}_ring_cond", [("ok", "No defects"), ("wear", "Internal teeth wear"), ("pitting", "Pitting / spalling"), ("cracks", "Cracks"), ("fit", "Mounting / housing fit worn"), ("dowels", "Dowels / bolts loose or damaged")], label="Ring gear condition", req=f"{st}ring gear condition"),
              comp(f"{p}_ring", f"{st}ring gear"),
              {"type": "subhead", "text": "Planet carrier"},
              choice(f"{p}_carrier_cond", [("ok", "No defects"), ("cracks", "Cracks"), ("pin_bores", "Pin bores worn / oval"), ("bearing", "Carrier bearing damage"), ("spline", "Spline / output coupling wear")], label="Carrier condition", req=f"{st}carrier condition"),
              comp(f"{p}_carrier", f"{st}planet carrier"), comp(f"{p}_carrier_bearing", f"{st}carrier bearing", (("cone_pn", "Cone P/N"), ("cup_pn", "Cup P/N"))),
              comp(f"{p}_coupling", f"{st}{coupling_name(i, k)[0].lower()}{coupling_name(i, k)[1:]}")]
        S.append({"id": f"P{i}", "title": f"P{i}. Planetary stage {i}", "photos": True, "blocks": b})
    fb = [comp("f_input_shaft", "Input shaft"), comp("f_input_seal", "Input seal"), comp("f_input_bearings", "Input shaft bearings", (("cone_pn", "Cone P/N"), ("cup_pn", "Cup P/N"))),
          comp("f_output_shaft", "Output shaft"), comp("f_output_bearings", "Output shaft bearings", (("cone_pn", "Cone P/N"), ("cup_pn", "Cup P/N"))), comp("f_output_seals", "Output seals"),
          comp("f_housing", "Housing and bearing bores"), comp("f_lube", "Lubrication: breather, plugs, sight glass, oil lines"), comp("f_caps_shims", "Bearing caps and shims")]
    fb += [comp(f"f_other{j}", f"Other component {j}", other=True) for j in range(1, 4)]
    S.append({"id": "F", "title": "F. Input, output, housing and lubrication", "photos": False, "blocks": fb})
    g = copy.deepcopy(helical_sections["G"])
    g["blocks"].insert(2, choice("g_planetary", [("pin_wear", "Planet pin wear"), ("needles", "Needle roller damage"), ("washers", "Thrust washer wear"), ("carrier_cracks", "Carrier cracks"),
                                                 ("spline_fretting", "Spline fretting"), ("ring_loose", "Ring gear loose in housing")], label="Planetary"))
    S.append(g)
    H = [("input", "Input shaft bearing"), ("output", "Output shaft bearing")] + [(f"carrier{i}", f"Stage {i} carrier bearing") for i in range(1, k + 1)]
    S.append({"id": "H", "title": "H. Dimensional checks", "photos": True, "blocks": [
        {"type": "table", "title": "Bearing bore and journal diameters", "labelCols": 1,
         "columns": ["Location", "Bearing bore measured", "Bearing bore spec", "Bore OK", "Journal measured", "Journal spec", "Journal OK"],
         "rows": [{"label": [l], "cells": [{"kind": "text", "name": f"h_{x}_bore_measured"}, {"kind": "text", "name": f"h_{x}_bore_spec"}, {"kind": "check", "name": f"h_{x}_bore_ok"},
                                           {"kind": "text", "name": f"h_{x}_journal_measured"}, {"kind": "text", "name": f"h_{x}_journal_spec"}, {"kind": "check", "name": f"h_{x}_journal_ok"}],
                   "req": {"id": f"h_{x}", "label": f"Dimensional check: {l}", "all": [f"h_{x}_bore_measured", f"h_{x}_journal_measured"]}} for x, l in H]},
        F("h_seal_journal_notes", "Seal journal condition notes", multiline=True, rows=2)]})
    for sid in ("I", "J", "K", "L"): S.append(copy.deepcopy(helical_sections[sid]))
    t = titles(k)
    return {"key": "teardown", "title": "Teardown Evaluation", "fileTitle": "Teardown-Evaluation", "header": "Ram Gear Gearbox Evaluation", "docTitle": t["teardown"],
            "template": f"templates/{template('teardown', k)}.pdf", "signedByField": "k_inspected_name", "sections": S,
            "footer": "Obtain all dimensional, endplay, backlash, and clearance specs from OEM drawings and bearing manufacturer data."}

# ------------------------------------------------------------------ Assembly Verification
def assembly_def(k):
    S = []
    info = [F("info_customer_name", "Customer name", link="customer"), F("info_work_order_number", "Work order number", link="wo"), F("info_manufacturer", "Manufacturer", link="manufacturer"),
            F("info_model", "Model", link="model"), F("info_serial", "Serial number", link="serial"), F("info_ratio_overall", "Reduction ratio (overall)", suffix=": 1")]
    info += [F(f"info_ratio_stage{i}", f"Stage {i} ratio", suffix=": 1") for i in range(1, k + 1)] + [F("info_oil_capacity", "Oil capacity (gal / L)"), F("info_oil_grade", "Oil grade")]
    S.append({"id": "A", "title": "A. Gearbox information", "photos": True, "blocks": [row(info[j:j + 2], f"info_{j // 2}") for j in range(0, len(info), 2)]})
    def sec(sid, title, items):
        n = sid.lstrip("s")
        blocks = [check(f"{sid}_item{ii:02d}", t, [(f"{sid}_{fk}", fl) for fk, fl in fl_], f"{n}.{ii} ") for ii, (t, fl_) in enumerate(items, 1)]
        S.append({"id": sid, "title": title, "photos": True, "blocks": blocks})
    sec("s1", "1. Prep and inspection", [
        ("Work order, drawings, BOM, and assembly spec on hand at current revision", []),
        ("Clean covered work area, lifting gear rated and inspected", []),
        ("Housing cleaned and deburred, oil passages, drain and breather ports clear", []),
        ("Parts kept by planetary stage, match marks verified", []),
        ("Sun, planet and ring gear teeth and splines inspected, no damage or burrs", []),
        ("Planet pins, pin bores and needle rollers checked; rollers counted per planet", []),
        ("Thrust washers checked for wear and thickness", []),
        ("Bearings checked for part number, cups and cones kept as matched sets", []),
        ("Measuring tools calibrated (micrometers, bore gauges, dial indicators, torque wrench)", [])])
    sec("s2", "2. Input shaft and seal", [
        ("Input shaft bearings installed and fully seated", []),
        ("Input shaft endplay set:", [("input_endplay", "Endplay")]),
        ("Input seal installed (lip direction correct, lubricated, no damage)", []),
        ("Input shaft rotates freely", [])])
    for i in range(1, k + 1):
        p = f"p{i}"; st = f"Stage {i} "
        b = stage_head(p, i)
        items = [("Planet pins installed with correct fit and retained (roll pins / circlips / plates)", []),
                 ("Planet bearings / needle rollers installed, complete count, lubricated", []),
                 ("Thrust washers installed on both sides of each planet (thickness recorded below)", []),
                 ("Planets rotate freely on their pins, no binding", []),
                 ("Sun gear installed; sun float / axial play checked", []),
                 ("Ring gear installed: mounting fit, dowels fitted, bolts torqued:", [("ring_torque", "Bolt torque")]),
                 ("Planet carrier installed; carrier bearing seated", []),
                 (f"{coupling_name(i, k)} engaged, full spline engagement", [])]
        b += [check(f"{p}_item{ii:02d}", t, [(f"{p}_{fk}", fl) for fk, fl in fl_], st) for ii, (t, fl_) in enumerate(items, 1)]
        b.append(meas_table(p, i))
        b.append({"type": "table", "title": f"Stage {i} planets (one row per planet)", "labelCols": 1,
                  "columns": ["Planet", "Pin fit (measured)", "Needle rollers (count / OK)", "Thrust washer thickness", "Rotates freely"],
                  "rows": [{"label": [f"Planet {j}"], "cells": [{"kind": "text", "name": f"{p}_planet{j}_{c}"} for c in ("pinfit", "rollers", "washer")] + [{"kind": "check", "name": f"{p}_planet{j}_free"}],
                            "req": {"id": f"{p}_planet{j}", "label": f"{st}planet {j}", "all": [f"{p}_planet{j}_pinfit", f"{p}_planet{j}_rollers", f"{p}_planet{j}_washer", f"{p}_planet{j}_free"],
                                    "ifCount": {"field": f"{p}_planet_count", "min": j}}} for j in range(1, MAXP + 1)]})
        S.append({"id": f"P{i}", "title": f"P{i}. Planetary stage {i}", "photos": True, "blocks": b})
    sec("s3", "3. Output shaft, bearings and seals", [
        ("Output shaft bearings installed and fully seated", []),
        ("Output shaft endplay / preload set:", [("output_endplay", "Endplay / preload")]),
        ("Output seals installed (lip direction correct, lubricated, no damage)", []),
        ("Output shaft turns smoothly with the input", [])])
    SR = [("input_de", "Input", "Drive end"), ("input_nde", "Input", "Non-drive end"), ("output_de", "Output", "Drive end"), ("output_nde", "Output", "Non-drive end")]
    SR += [(f"carrier{i}", f"Stage {i} carrier", "Carrier bearing") for i in range(1, k + 1)]
    S.append({"id": "s4", "title": "4. Bearing shims", "photos": True, "blocks": [{"type": "table", "title": "Bearing shim record", "labelCols": 2,
        "columns": ["Shaft", "Location", "Starting shim (in/mm)", "Final shim (in/mm)", "Measured endplay/preload", "Spec", "OK", "Shim pack"],
        "rows": [{"label": [a, b], "cells": [{"kind": "text", "name": f"shim_{x}_{c}"} for c in ("start", "final", "measured", "spec")] + [{"kind": "check", "name": f"shim_{x}_ok"}, rr(f"shim_{x}")],
                  "req": {"id": f"shim_{x}", "label": f"Shim record: {a} {b}", "all": [f"shim_{x}_final", f"shim_{x}_measured", f"shim_{x}_ok"], "any": [f"shim_{x}_replace", f"shim_{x}_reuse"]}} for x, a, b in SR]}]})
    sec("s5", "5. Housing and lubrication", [
        ("Housing closed with correct gaskets / sealant, bolts torqued:", [("housing_torque", "Bolt torque")]),
        ("Breather, plugs and sight glass installed", []),
        ("Filled with the specified oil:", [("oil_grade", "Grade"), ("oil_qty", "Quantity")]),
        ("No leaks after fill", [])])
    sec("s6", "6. Final checks and run test", [
        ("Rotates smoothly by hand through a full output revolution", []),
        ("Output rotational backlash measured (input locked):", [("output_backlash", "Backlash")]),
        ("Run test: noise, vibration and temperature acceptable:", [("run_temp", "Temperature rise")]),
        ("Direction of rotation and ratio verified", []),
        ("Serial numbers, shim thicknesses, endplay, backlash, torques and test data recorded", [])])
    S.append({"id": "notes", "title": "Notes", "photos": True, "blocks": [F("notes", "Notes", multiline=True, rows=6)]})
    blocks = []
    for role in ("Assembler", "Inspector"):
        r = role.lower(); names = [f"signoff_{r}_{x}" for x in ("name", "signature", "date")]
        blocks.append({"type": "subhead", "text": role})
        blocks.append({"type": "row", "fields": [F(names[0], "Name"), F(names[1], "Signature (type name)"), F(names[2], "Date", input="date")], "req": {"id": f"signoff_{r}", "label": f"{role} sign-off", "all": names}})
    S.append({"id": "signoff", "title": "Sign-off", "photos": False, "blocks": blocks})
    t = titles(k)
    return {"key": "assembly", "title": "Assembly Verification", "fileTitle": "Assembly-Verification", "header": "Ram Gear Manufacturing Assembly Verification Data", "docTitle": t["assembly"],
            "template": f"templates/{template('assembly', k)}.pdf", "signedByField": "signoff_inspector_name", "sections": S,
            "footer": "Obtain all torque, preload, endplay, backlash, and clearance values from OEM drawings and bearing manufacturer data."}

# ------------------------------------------------------------------ generic PDF renderer for the block schema
def render(form, out):
    from reportlab.lib.pagesizes import letter
    from reportlab.pdfgen import canvas
    from reportlab.lib.utils import simpleSplit
    from reportlab.lib import colors
    W, H = letter; M = 42; TOP = H - 64; BOT = 66; FH = 24; CB = 20; FS = 11; CW = W - 2 * M
    NAVY = colors.HexColor("#1F3A5F"); LIGHT = colors.HexColor("#E8EEF5"); GRID = colors.HexColor("#9AA8B8"); FILL = colors.HexColor("#F7FAFD"); GREY = colors.HexColor("#333333")
    CALC = colors.HexColor("#EEF2F6"); formid = os.path.basename(form["template"])[:-4]
    class D:
        def __init__(s, buf, total):
            s.c = canvas.Canvas(buf, pagesize=letter, pageCompression=1); s.c.setTitle(form["docTitle"]); s.c.setAuthor("Gary Gillham"); s.c.setSubject(form["title"])
            s.total = total; s.page = 0; s.names = set(); s.newpage(True)
        def newpage(s, first=False):
            c = s.c
            if not first: c.showPage()
            s.page += 1
            c.setFillColor(NAVY); c.rect(0, H - 50, W, 50, fill=1, stroke=0); c.setFillColor(colors.white); c.setFont("Helvetica-Bold", 15); c.drawString(M, H - 32, form["header"])
            c.setStrokeColor(GRID); c.setLineWidth(0.5); c.line(M, 50, W - M, 50); c.setFillColor(colors.HexColor("#444444")); c.setFont("Helvetica-Oblique", 7.5); c.drawString(M, 38, form["footer"])
            c.setFont("Helvetica", 9); c.drawRightString(W - M, 24, f"Page {s.page} of {s.total}"); c.drawString(M, 24, "Form: " + formid)
            s.y = TOP
            if s.page == 1:
                c.setFillColor(NAVY); c.setFont("Helvetica-Bold", 14); c.drawString(M, TOP - 8, form["docTitle"]); c.setStrokeColor(NAVY); c.setLineWidth(1); c.line(M, TOP - 16, W - M, TOP - 16); s.y = TOP - 24
        def need(s, h):
            if s.y - h < BOT: s.newpage()
        def tf(s, name, x, y, w, h=FH, tip="", multi=False, fill=FILL):
            assert name not in s.names, name; s.names.add(name)
            s.c.acroForm.textfield(name=name, tooltip=tip or name, x=x, y=y, width=w, height=h, fontName="Helvetica", fontSize=FS, borderColor=GRID, fillColor=fill, textColor=colors.black,
                                   borderWidth=1, borderStyle="solid", forceBorder=True, fieldFlags="multiline" if multi else "", maxlen=100000 if multi else None)
        def cb(s, name, x, y, tip=""):
            assert name not in s.names, name; s.names.add(name)
            s.c.acroForm.checkbox(name=name, tooltip=tip or name, x=x, y=y, size=CB, buttonStyle="check", borderColor=NAVY, fillColor=colors.white, textColor=NAVY,
                                  borderWidth=1.2, borderStyle="solid", forceBorder=True, checked=False)
        def section(s, title, extra):
            s.need(30 + extra); s.y -= 6; c = s.c
            c.setFillColor(LIGHT); c.rect(M, s.y - 20, CW, 22, fill=1, stroke=0); c.setFillColor(NAVY); c.rect(M, s.y - 20, 4, 22, fill=1, stroke=0)
            c.setFont("Helvetica-Bold", 12); c.drawString(M + 10, s.y - 14, title); s.y -= 30
        def subhead(s, text, extra=40):
            s.need(18 + extra); s.c.setFillColor(NAVY); s.c.setFont("Helvetica-Bold", 11); s.c.drawString(M, s.y - 12, text.upper() if s.upper else text); s.y -= 18
        upper = False
        def grid_row(s, fields, x0=M, gap=12):
            n = len(fields); h = FH; s.need(12 + h + 8); x = x0; w = (W - M - x0 - gap * (n - 1)) / n
            for f in fields:
                lab = f["label"]; s.c.setFillColor(GREY); fs = 9
                while s.c.stringWidth(lab, "Helvetica", fs) > w and fs > 6.5: fs -= 0.5
                s.c.setFont("Helvetica", fs); s.c.drawString(x, s.y - 9, lab)
                sfx = f.get("suffix"); fw = w - (26 if sfx else 0)
                s.tf(f["name"], x, s.y - 12 - h, fw, h=h, tip=lab, fill=CALC if f.get("calc") else FILL)
                if sfx: s.c.setFillColor(colors.black); s.c.setFont("Helvetica", 11); s.c.drawString(x + fw + 5, s.y - 12 - h + 8, sfx.strip())
                x += w + gap
            s.y -= 12 + h + 8
        def multiline(s, f):
            h = max(40, 14 * f.get("rows", 3) + 10); s.need(12 + h + 8)
            s.c.setFillColor(GREY); s.c.setFont("Helvetica", 9); s.c.drawString(M, s.y - 9, f["label"]); s.tf(f["name"], M, s.y - 12 - h, CW, h=h, tip=f["label"], multi=True); s.y -= 12 + h + 8
        def check(s, b):
            c = s.c; tw = CW - 34; lines = simpleSplit(b["label"], "Helvetica", 11, tw); h = max(CB, len(lines) * 14)
            s.need(h + 8 + (FH + 6 if b["fields"] else 0)); y0 = s.y
            s.cb(b["name"], M + 6, y0 - CB, tip=b["label"][:80]); c.setFillColor(colors.black); c.setFont("Helvetica", 11); ty = y0 - 14
            for ln in lines: c.drawString(M + 34, ty, ln); ty -= 14
            s.y -= h + 6
            if b["fields"]:
                n = len(b["fields"]); gap = 12; fw_all = (tw - gap * (n - 1)) / n; x = M + 34
                for f in b["fields"]:
                    c.setFont("Helvetica", 9); c.setFillColor(GREY); lw = c.stringWidth(f["label"] + ":", "Helvetica", 9) + 6
                    c.drawString(x, s.y - FH + 8, f["label"] + ":"); s.tf(f["name"], x + lw, s.y - FH, fw_all - lw, tip=f["label"]); x += fw_all + gap
                s.y -= FH + 6
            if b.get("notes"): s.grid_row([{"name": b["notes"], "label": "Notes"}], x0=M + 34)
            s.y -= 2
        def options(s, b):
            c = s.c; s.need(CB + 12); x = M
            if b.get("label"):
                c.setFillColor(colors.black); c.setFont("Helvetica-Bold", 10.5); lab = b["label"] + ":"; c.drawString(x, s.y - 14, lab); x += c.stringWidth(lab, "Helvetica-Bold", 10.5) + 12
            xs = x
            for o in b["options"]:
                fw = 180 if o.get("text") else 0; wid = CB + 6 + c.stringWidth(o["label"], "Helvetica", 11) + (fw + 6 if fw else 0) + 18
                if x + wid - 18 > W - M: s.y -= CB + 10; s.need(CB + 10); x = xs
                s.cb(o["name"], x, s.y - CB, tip=o["label"]); c.setFillColor(colors.black); c.setFont("Helvetica", 11); c.drawString(x + CB + 6, s.y - 14, o["label"])
                if fw: s.tf(o["text"], x + CB + 6 + c.stringWidth(o["label"], "Helvetica", 11) + 6, s.y - FH + 2, fw, tip=o["label"] + " (specify)")
                x += wid
            s.y -= CB + 10
            if b.get("notes"): s.grid_row([{"name": b["notes"], "label": "Notes"}])
        def component(s, b):
            c = s.c; bh = 26; fh = 26; key = b["id"]; s.need(bh + 4 + fh + 12); y = s.y
            c.setFillColor(LIGHT); c.rect(M, y - bh, CW, bh, fill=1, stroke=0); c.setFillColor(NAVY); c.rect(M, y - bh, 4, bh, fill=1, stroke=0)
            if b.get("nameField"):
                c.setFont("Helvetica-Bold", 10); c.drawString(M + 10, y - 17, "Other:"); s.tf(b["nameField"], M + 50, y - bh + 2, 200, h=22, tip="Other component name", fill=colors.white)
            else:
                nm = b["name"]; fsz = 11
                while c.stringWidth(nm, "Helvetica-Bold", fsz) > CW - 230 and fsz > 7.5: fsz -= 0.5
                c.setFont("Helvetica-Bold", fsz); c.drawString(M + 10, y - 17, nm)
            x = W - M - 8
            for o in reversed(b["options"]):
                x -= c.stringWidth(o["label"], "Helvetica", 11) + CB + 5; s.cb(o["name"], x, y - bh + 3, tip=f"{b['name']}: {o['label']}")
                c.setFillColor(colors.black); c.setFont("Helvetica", 11); c.drawString(x + CB + 5, y - 17, o["label"]); x -= 16
            s.y -= bh + 4; xx = M + 10; y = s.y
            for f in b["fields"]:
                c.setFillColor(GREY); c.setFont("Helvetica", 9); c.drawString(xx, y - fh / 2 - 3, f["label"] + ":"); xx += c.stringWidth(f["label"] + ":", "Helvetica", 9) + 5
                s.tf(f["name"], xx, y - fh, 120, h=fh, tip=f"{b['name']} {f['label']}"); xx += 132
            c.setFillColor(GREY); c.setFont("Helvetica", 9); c.drawString(xx, y - fh / 2 - 3, "Findings:"); xx += c.stringWidth("Findings:", "Helvetica", 9) + 5
            s.tf(b["findings"], xx, y - fh, W - M - xx, h=fh, tip=f"{b['name']} findings", multi=True); s.y -= fh + 10
        def table(s, b):
            c = s.c; nl = b["labelCols"]; rows = b["rows"]; rh = 30; fs = 9
            def cw_choice(cell): return sum(CB + 3 + c.stringWidth(o["label"], "Helvetica", 8.5) for o in cell["options"]) + 6 * (len(cell["options"]) - 1) + 10
            cells0 = rows[0]["cells"]
            lw = [max(c.stringWidth(r["label"][i], "Helvetica-Bold" if i == 0 else "Helvetica", 10) for r in rows) + 12 for i in range(nl)]
            lw = [max(w, c.stringWidth(b["columns"][i], "Helvetica-Bold", 8.5) + 10) for i, w in enumerate(lw)]
            fixed = [cw_choice(x) if x["kind"] == "choice" else (40 if x["kind"] == "check" else None) for x in cells0]
            free = CW - sum(lw) - sum(w for w in fixed if w); ntext = sum(1 for w in fixed if w is None)
            widths = lw + [w if w else free / ntext for w in fixed]; assert abs(sum(widths) - CW) < 1, widths
            heads = [simpleSplit(t, "Helvetica-Bold", 8.5, w - 6) for t, w in zip(b["columns"], widths)]; hh = max(22, 11 * max(len(h) for h in heads) + 8)
            def header():
                x = M; c.setFillColor(NAVY); c.rect(M, s.y - hh, CW, hh, fill=1, stroke=0); c.setFillColor(colors.white); c.setFont("Helvetica-Bold", 8.5)
                for lines, w in zip(heads, widths):
                    yy = s.y - hh / 2 + (len(lines) - 1) * 5.5 - 3
                    for ln in lines: c.drawCentredString(x + w / 2, yy, ln); yy -= 11
                    x += w
                s.y -= hh
            s.subhead(b["title"], extra=hh + rh * min(3, len(rows))); header()
            for ri, r in enumerate(rows):
                if s.y - rh < BOT: s.newpage(); header()
                y = s.y; c.setFillColor(LIGHT if ri % 2 else colors.white); c.rect(M, y - rh, CW, rh, fill=1, stroke=0)
                c.setStrokeColor(GRID); c.setLineWidth(0.5); c.rect(M, y - rh, CW, rh, fill=0, stroke=1); x = M
                for i in range(nl):
                    c.setFillColor(colors.black); c.setFont("Helvetica-Bold" if i == 0 else "Helvetica", 10); c.drawString(x + 5, y - rh / 2 - 3.5, r["label"][i]); x += widths[i]
                for cell, w in zip(r["cells"], widths[nl:]):
                    tip = " ".join(r["label"])
                    if cell["kind"] == "text": s.tf(cell["name"], x + 3, y - rh + 3, w - 6, tip=tip)
                    elif cell["kind"] == "check": s.cb(cell["name"], x + (w - CB) / 2, y - rh + (rh - CB) / 2, tip=tip)
                    else:
                        xx = x + (w - cw_choice(cell) + 10) / 2; cy = y - rh + (rh - CB) / 2
                        for o in cell["options"]:
                            s.cb(o["name"], xx, cy, tip=f"{tip}: {o['label']}"); c.setFillColor(colors.black); c.setFont("Helvetica", 8.5); c.drawString(xx + CB + 3, cy + CB / 2 - 3, o["label"])
                            xx += CB + 3 + c.stringWidth(o["label"], "Helvetica", 8.5) + 6
                    x += w
                s.y -= rh
            s.y -= 10
        def signoff_row(s, b): s.grid_row(b["fields"])
    def first_h(b):
        return {"table": 180, "component": 46, "choice": 34, "check": 30}.get(b["type"], 48)
    def build(total):
        buf = io.BytesIO(); d = D(buf, total)
        for sec in form["sections"]:
            if any(b["type"] == "photos" for b in sec["blocks"]): d.newpage()   # L. Teardown photos: own last page
            d.section(sec["title"], extra=first_h(sec["blocks"][0]) if sec["blocks"] else 0)
            for b in sec["blocks"]:
                t = b["type"]
                if t == "subhead": d.subhead(b["text"])
                elif t == "field": d.multiline(b) if b.get("multiline") else d.grid_row([b])
                elif t == "row": d.grid_row(b["fields"])
                elif t == "check": d.check(b)
                elif t == "choice": d.options(b)
                elif t == "component": d.component(b)
                elif t == "table": d.table(b)
                elif t == "photos": G.draw_photo_page(d.c, M, W, d.y, BOT + 10, NAVY, GRID, GREY)
                else: raise ValueError(t)
        d.c.save(); return buf.getvalue(), d.page
    _, n = build(1); data, n2 = build(n); assert n == n2
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import NameObject, BooleanObject
    w = PdfWriter(clone_from=PdfReader(io.BytesIO(data))); w._root_object["/AcroForm"][NameObject("/NeedAppearances")] = BooleanObject(True); w.compress_identical_objects()
    with open(out, "wb") as f: w.write(f)
    return n

def helical_shared():
    import gen_forms as GF
    GF.N = 1; t = GF.teardown(); return {s["id"]: s for s in t["sections"]}

if __name__ == "__main__":
    hs = helical_shared()
    for k in [int(a) for a in (sys.argv[1:] or ["1", "2", "3", "4"])]:
        for f in (teardown_def(k, hs), assembly_def(k)):
            n = render(f, os.path.join(APP, f["template"])); print(f["key"], f"planetary {k}-stage", "pages", n, f["template"])
