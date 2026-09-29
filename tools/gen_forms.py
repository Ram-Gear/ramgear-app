"""Generate forms.json (shared field definition) from the PDF builder scripts and
validate it against the real AcroForm templates. Run with a Python that has pypdf.
  python tools/gen_forms.py [--copy-templates]
"""
import json, re, sys, os, shutil
from pypdf import PdfReader

HERE = os.path.dirname(os.path.abspath(__file__)); APP = os.path.dirname(HERE)
SRC_A = "/workspace/gbx/make.py"; SRC_T = "/workspace/gbx/make_teardown.py"
PDF_A = "/workspace/gearbox-assembly-checklist.pdf"; PDF_T = "/workspace/gearbox-teardown-analysis.pdf"

def load_assembly_data():
    src = open(SRC_A).read()
    src = src[:src.index("class Doc")]
    ns = {}; exec(src, ns); return ns

def F(name, label, **kw):
    d = {"type": "field", "name": name, "label": label}; d.update(kw); return d

# ---------------- Assembly Verification ----------------
def assembly():
    ns = load_assembly_data()
    secs = []
    info = []
    for key, label, suffix in ns["INFO"]:
        f = F(f"info_{key}", label)
        if suffix: f["suffix"] = suffix.strip()
        if key == "customer_name": f["link"] = "customer"
        if key == "work_order_number": f["link"] = "wo"
        if key in ("manufacturer", "model", "serial"): f["link"] = key
        info.append(f)
    blocks = []
    for i in range(0, len(info), 2):
        row = info[i:i+2]
        blocks.append({"type": "row", "fields": row,
                       "req": {"id": "info_" + str(i//2), "label": " / ".join(x["label"] for x in row), "all": [x["name"] for x in row]}})
    secs.append({"id": "A", "title": "A. Gearbox information", "blocks": blocks, "photos": True})
    for title, items in ns["S"]:
        if title == "SHIM":
            rows = []
            for shaft, loc in ns["SHIM_ROWS"]:
                base = f"shim_{shaft.lower()}_{'de' if loc=='Drive end' else 'nde'}"
                rows.append({"label": [shaft, loc], "cells": [{"kind": "text", "name": f"{base}_{k}"} for k in ("start","final","measured","spec")] + [{"kind": "check", "name": f"{base}_ok"}],
                             "req": {"id": base, "label": f"Shim record: {shaft} {loc}", "all": [f"{base}_final", f"{base}_measured", f"{base}_ok"]}})
            secs[-1]["blocks"].append({"type": "table", "title": "Bearing shim record",
                "columns": ["Shaft", "Location", "Starting shim (in/mm)", "Final shim (in/mm)", "Measured endplay/preload", "Spec", "OK"], "labelCols": 2, "rows": rows})
            continue
        if title == "BACKLASH":
            rows = []
            for stage, mesh in ns["BL_ROWS"]:
                b = f"backlash_stage{stage}"
                rows.append({"label": [f"Stage {stage}", mesh], "cells": [{"kind": "text", "name": f"{b}_{k}"} for k in ("deg000","deg090","deg180","deg270","min","max","spec")] + [{"kind": "check", "name": f"{b}_ok"}],
                             "req": {"id": b, "label": f"Backlash stage {stage}", "all": [f"{b}_min", f"{b}_max", f"{b}_ok"]}})
            secs[-1]["blocks"].append({"type": "table", "title": "Backlash record (measured at 4 points 90\u00b0 apart)",
                "columns": ["Stage", "Mesh", "0\u00b0", "90\u00b0", "180\u00b0", "270\u00b0", "Min", "Max", "Spec", "OK"], "labelCols": 2, "rows": rows})
            secs[-1]["blocks"].append({"type": "row", "fields": [F("backlash_checked_by", "Backlash checked by"), F("backlash_date", "Date", input="date")],
                                       "req": {"id": "backlash_signed", "label": "Backlash checked by / date", "all": ["backlash_checked_by", "backlash_date"]}})
            continue
        if title == "NOTES":
            secs.append({"id": "notes", "title": "Notes", "photos": True, "blocks": [F("notes", "Notes", multiline=True, rows=6)]}); continue
        if title == "SIGNOFF":
            blocks = []
            for role in ("Assembler", "Inspector"):
                r = role.lower(); names = [f"signoff_{r}_{k}" for k in ("name", "signature", "date")]
                blocks.append({"type": "subhead", "text": role})
                blocks.append({"type": "row", "fields": [F(names[0], "Name"), F(names[1], "Signature (type name)"), F(names[2], "Date", input="date")],
                               "req": {"id": f"signoff_{r}", "label": f"{role} sign-off", "all": names}})
            secs.append({"id": "signoff", "title": "Sign-off", "photos": False, "blocks": blocks}); continue
        sn = title.split(".")[0]; blocks = []
        for ii, (text, fields) in enumerate(items, 1):
            nm = f"s{sn}_item{ii:02d}"
            sub = [{"name": f"s{sn}_{k}", "label": l} for k, l in fields]
            blocks.append({"type": "check", "name": nm, "label": text, "fields": sub,
                           "req": {"id": nm, "label": f"{sn}.{ii} {text}", "all": [nm] + [s["name"] for s in sub]}})
        secs.append({"id": f"s{sn}", "title": title, "blocks": blocks, "photos": True})
    return {"key": "assembly", "title": "Assembly Verification", "fileTitle": "Assembly-Verification",
            "header": ns["HEADER"], "docTitle": ns["TITLE"], "template": "templates/gearbox-assembly-checklist.pdf",
            "signedByField": "signoff_inspector_name", "sections": secs}

# ---------------- Teardown Evaluation ----------------
LOC6 = [("input_de", "Input", "DE"), ("input_nde", "Input", "NDE"), ("intermediate_de", "Intermediate", "DE"),
        ("intermediate_nde", "Intermediate", "NDE"), ("output_de", "Output", "DE"), ("output_nde", "Output", "NDE")]

def row(fields, rid=None, label=None, req=True):
    b = {"type": "row", "fields": fields}
    if req: b["req"] = {"id": rid or fields[0]["name"], "label": label or " / ".join(f["label"] for f in fields), "all": [f["name"] for f in fields]}
    return b

def choice(prefix, opts, label=None, exclusive=False, req=None, notes=None):
    b = {"type": "choice", "label": label, "exclusive": exclusive,
         "options": [{"name": f"{prefix}_{o[0]}", "label": o[1], **({"text": f"{prefix}_{o[0]}_text"} if len(o) > 2 else {})} for o in opts]}
    if notes: b["notes"] = notes
    if req: b["req"] = {"id": prefix, "label": req, "any": [o["name"] for o in b["options"]]}
    return b

def teardown():
    S = []
    S.append({"id": "A", "title": "A. Job information", "photos": True, "blocks": [
        row([F("a_customer_name", "Customer name", link="customer"), F("a_work_order_number", "Work order number", link="wo")], "a_job"),
        row([F("a_date_received", "Date received", input="date"), F("a_manufacturer", "Manufacturer", link="manufacturer")], "a_recv"),
        row([F("a_model", "Model", link="model"), F("a_serial", "Serial number", link="serial")], "a_model"),
        row([F("a_ratio_overall", "Overall reduction", suffix=": 1"), F("a_ratio_stage1", "Stage 1 ratio", suffix=": 1"), F("a_ratio_stage2", "Stage 2 ratio", suffix=": 1")], "a_ratios"),
        row([F("a_oil_capacity", "Oil capacity"), F("a_oil_grade", "Oil grade")], "a_oil"),
        row([F("a_application", "Application / driven equipment"), F("a_service_hours", "Service hours (if known)")], req=False),
        {**F("a_reported_failure", "Reported failure / customer complaint", multiline=True, rows=3), "req": {"id": "a_reported_failure", "label": "Reported failure / customer complaint", "all": ["a_reported_failure"]}},
    ]})
    B = [("photos", "Photos taken as received"), ("external_damage", "External damage, cracks, missing parts"),
         ("nameplate", "Nameplate present and legible"), ("turns_freely", "Shafts turn freely by hand"),
         ("noise", "Noise or roughness when turned"), ("oil_leaks", "Oil leaks at seals / split line / plugs"),
         ("breather", "Breather condition")]
    bb = []
    for k, t in B:
        if k == "turns_freely":
            bb.append(choice(f"b_{k}", [("yes", "Yes"), ("no", "No")], label=t, exclusive=True, req=t, notes=f"b_{k}_notes"))
        else:
            bb.append({"type": "check", "name": f"b_{k}_chk", "label": t, "notes": f"b_{k}_notes", "fields": [],
                       "req": {"id": f"b_{k}", "label": t, "all": [f"b_{k}_chk"]}})
    S.append({"id": "B", "title": "B. As-received condition", "photos": True, "blocks": bb})
    S.append({"id": "C", "title": "C. Oil condition", "photos": True, "blocks": [
        row([F("c_oil_volume", "Oil drained - volume recovered"), F("c_sample_id", "Oil sample ID (lab analysis)")], req=False),
        choice("c_sample_taken", [("yes", "Oil sample taken for lab analysis")]),
        choice("c_appearance", [("clean", "Clean"), ("dark", "Dark"), ("milky", "Milky (water)"), ("sludge", "Sludge"), ("metallic", "Metallic particles")], label="Appearance", req="Oil appearance"),
        F("c_drain_plug_debris", "Magnetic drain plug debris description", multiline=True, rows=2),
    ]})
    S.append({"id": "D", "title": "D. As-found measurements before teardown", "photos": True, "blocks": [
        row([F("d_endplay_input", "Endplay - Input shaft"), F("d_endplay_intermediate", "Endplay - Intermediate shaft"), F("d_endplay_output", "Endplay - Output shaft")], "d_endplay", "As-found endplay"),
        row([F("d_backlash_stage1", "Backlash - Stage 1"), F("d_backlash_stage2", "Backlash - Stage 2"), F("d_runout_input", "Ext. runout - Input shaft"), F("d_runout_output", "Ext. runout - Output shaft")], "d_backlash", "As-found backlash / runout"),
    ]})
    eb = [{"type": "check", "name": n, "label": t, "fields": [], "req": {"id": n, "label": t, "all": [n]}} for n, t in [
        ("e_match_marked", "Match-mark housing, caps, and shafts before disassembly"), ("e_parts_tagged", "Parts tagged and kept in order"), ("e_seals_inspected", "Seals removed and inspected")]]
    eb.append({"type": "table", "title": "As-found shim record", "columns": ["Shaft", "Drive end (DE) as-found shim (in/mm)", "Non-drive end (NDE) as-found shim (in/mm)"], "labelCols": 1,
               "rows": [{"label": [l], "cells": [{"kind": "text", "name": f"e_shim_{k}_de_asfound"}, {"kind": "text", "name": f"e_shim_{k}_nde_asfound"}],
                         "req": {"id": f"e_shim_{k}", "label": f"As-found shim: {l}", "all": [f"e_shim_{k}_de_asfound", f"e_shim_{k}_nde_asfound"]}}
                        for k, l in [("input", "Input"), ("intermediate", "Intermediate"), ("output", "Output")]]})
    S.append({"id": "E", "title": "E. Teardown checklist", "photos": True, "blocks": eb})
    PN = [("pn", "Part no.")]; GEAR = [("pn", "Part no."), ("teeth", "Teeth")]
    comps = [(f"f_{k}", n, f, False) for k, n, f in [("input_shaft", "Input shaft", PN), ("input_pinion", "Input pinion (stage 1)", GEAR),
             ("intermediate_shaft", "Intermediate shaft", PN), ("intermediate_gear", "Intermediate gear (stage 1)", GEAR),
             ("intermediate_pinion", "Intermediate pinion (stage 2)", GEAR), ("output_shaft", "Output shaft", PN), ("output_gear", "Output gear (stage 2)", GEAR)]]
    comps += [(f"f_bearing_{k}", f"Bearing - {a} {b}", [("cone_pn", "Cone P/N"), ("cup_pn", "Cup P/N")], False) for k, a, b in LOC6]
    comps += [(f"f_{k}", n, PN, False) for k, n in [("input_seal", "Input seal"), ("output_seal", "Output seal"), ("keys", "Keys and keyways"),
              ("spacers", "Spacers and locknuts"), ("caps_shims", "Bearing caps and shims"), ("housing", "Housing and bearing bores"), ("breather_plugs", "Breather, plugs, sight glass")]]
    comps += [(f"f_other{i}", f"Other component {i}", PN, True) for i in range(1, 4)]
    fb = []
    for key, name, fl, other in comps:
        b = {"type": "component", "id": key, "name": name, "photos": True,
             "options": [{"name": f"{key}_{o}", "label": o.capitalize()} for o in ("reuse", "repair", "replace")],
             "fields": [{"name": f"{key}_{k}", "label": l} for k, l in fl], "findings": f"{key}_findings",
             "req": {"id": key, "label": f"{name}: Reuse / Repair / Replace", "any": [f"{key}_{o}" for o in ("reuse", "repair", "replace")]}}
        if other:
            b["nameField"] = f"{key}_name"; b["req"]["onlyIf"] = f"{key}_name"
        fb.append(b)
    S.append({"id": "F", "title": "F. Component inventory and repair assessment", "photos": False, "blocks": fb})
    S.append({"id": "G", "title": "G. Failure modes observed", "photos": True, "blocks": [
        choice("g_gear", [("pitting", "Pitting"), ("spalling", "Spalling"), ("scuffing", "Scuffing/scoring"), ("wear", "Wear"), ("breakage", "Tooth breakage"),
                          ("plastic_def", "Plastic deformation"), ("corrosion", "Corrosion"), ("contact_pattern", "Misaligned contact pattern")], label="Gears"),
        choice("g_bearing", [("spalling", "Spalling/fatigue"), ("brinelling", "Brinelling"), ("dents", "Contamination dents"), ("overheating", "Overheating/discoloration"),
                             ("corrosion", "Corrosion/etching"), ("fluting", "Electrical fluting"), ("cage", "Cage damage"), ("skidding", "Skidding")], label="Bearings"),
        F("g_location_notes", "Location / notes", multiline=True, rows=3),
    ]})
    S.append({"id": "H", "title": "H. Dimensional checks", "photos": True, "blocks": [
        {"type": "table", "title": "Bearing bore and shaft journal diameters", "labelCols": 2,
         "columns": ["Shaft", "Loc.", "Bearing bore measured", "Bearing bore spec", "Bore OK", "Shaft journal measured", "Shaft journal spec", "Journal OK"],
         "rows": [{"label": [a, b], "cells": [{"kind": "text", "name": f"h_{k}_bore_measured"}, {"kind": "text", "name": f"h_{k}_bore_spec"}, {"kind": "check", "name": f"h_{k}_bore_ok"},
                                               {"kind": "text", "name": f"h_{k}_journal_measured"}, {"kind": "text", "name": f"h_{k}_journal_spec"}, {"kind": "check", "name": f"h_{k}_journal_ok"}],
                   "req": {"id": f"h_{k}", "label": f"Dimensional check: {a} {b}", "all": [f"h_{k}_bore_measured", f"h_{k}_journal_measured"]}} for k, a, b in LOC6]},
        F("h_seal_journal_notes", "Seal journal condition notes", multiline=True, rows=2),
    ]})
    S.append({"id": "I", "title": "I. Root cause", "photos": True, "blocks": [
        choice("i_cause", [("lubrication", "Lubrication failure"), ("contamination", "Contamination"), ("overload", "Overload / shock load"), ("misalignment", "Misalignment"),
                           ("installation", "Improper installation"), ("fatigue", "Fatigue / end of life"), ("mfg_defect", "Manufacturing defect"), ("other", "Other", 1)], req="Root cause"),
        {**F("i_narrative", "Root cause narrative", multiline=True, rows=4), "req": {"id": "i_narrative", "label": "Root cause narrative", "all": ["i_narrative"]}},
    ]})
    S.append({"id": "J", "title": "J. Repair summary", "photos": True, "blocks": [
        F("j_parts_to_replace", "Parts to replace", multiline=True, rows=3),
        F("j_machining", "Machining / repair work required", multiline=True, rows=3),
        F("j_upgrades", "Recommended upgrades or changes", multiline=True, rows=2),
        row([F("j_labor_hours", "Estimated labor hours"), F("j_parts_cost", "Estimated parts cost"), F("j_quote_number", "Quote number")], req=False),
        choice("j_recommend", [("repair", "Repair"), ("replace_unit", "Replace unit"), ("not_economical", "Not economical to repair")], label="Recommendation", exclusive=True, req="Recommendation"),
    ]})
    S.append({"id": "K", "title": "K. Sign-off", "photos": False, "blocks": [
        {"type": "subhead", "text": "Inspected by"},
        row([F("k_inspected_name", "Name"), F("k_inspected_signature", "Signature (type name)"), F("k_inspected_date", "Date", input="date")], "k_inspected", "Inspected by sign-off"),
        {"type": "subhead", "text": "Reviewed / approved by"},
        row([F("k_reviewed_name", "Name"), F("k_reviewed_signature", "Signature (type name)"), F("k_reviewed_date", "Date", input="date")], req=False),
        choice("k_customer_approval", [("x", "Customer approval received")]),
        F("k_customer_approval_date", "Customer approval date", input="date"),
    ]})
    # k_customer_approval is a single checkbox without suffix
    S[-1]["blocks"][4]["options"][0]["name"] = "k_customer_approval"
    return {"key": "teardown", "title": "Teardown Evaluation", "fileTitle": "Teardown-Evaluation",
            "header": "Ram Gear Gearbox Evaluation", "docTitle": "Double-Reduction Gearbox Teardown and Repair Analysis",
            "template": "templates/gearbox-teardown-analysis.pdf", "signedByField": "k_inspected_name", "sections": S}

def names_in(form):
    out = {}
    def add(n, kind): out[n] = kind
    for s in form["sections"]:
        for b in s["blocks"]:
            t = b["type"]
            if t == "field": add(b["name"], "text")
            elif t == "row": [add(f["name"], "text") for f in b["fields"]]
            elif t == "check":
                add(b["name"], "check"); [add(f["name"], "text") for f in b["fields"]]
                if b.get("notes"): add(b["notes"], "text")
            elif t == "choice":
                for o in b["options"]:
                    add(o["name"], "check")
                    if o.get("text"): add(o["text"], "text")
                if b.get("notes"): add(b["notes"], "text")
            elif t == "table":
                for r in b["rows"]:
                    for c in r["cells"]: add(c["name"], c["kind"])
            elif t == "component":
                for o in b["options"]: add(o["name"], "check")
                for f in b["fields"]: add(f["name"], "text")
                add(b["findings"], "text")
                if b.get("nameField"): add(b["nameField"], "text")
    return out

def validate(form, pdf):
    fl = PdfReader(pdf).get_fields()
    pdfk = {k: ("check" if v.get("/FT") == "/Btn" else "text") for k, v in fl.items()}
    mine = names_in(form)
    missing = set(pdfk) - set(mine); extra = set(mine) - set(pdfk)
    wrong = [k for k in mine if k in pdfk and pdfk[k] != mine[k]]
    print(f"{form['key']}: pdf={len(pdfk)} json={len(mine)} missing={sorted(missing)} extra={sorted(extra)} kindmismatch={wrong}")
    return not (missing or extra or wrong)

if __name__ == "__main__":
    # Order matters: the app lists forms in this order everywhere (Teardown Evaluation first).
    forms = {"version": 1, "forms": [teardown(), assembly()]}
    ok = validate(forms["forms"][0], PDF_T) & validate(forms["forms"][1], PDF_A)
    json.dump(forms, open(os.path.join(APP, "forms.json"), "w"), indent=1, ensure_ascii=False)
    if "--copy-templates" in sys.argv:
        shutil.copy(PDF_A, os.path.join(APP, "templates")); shutil.copy(PDF_T, os.path.join(APP, "templates"))
    print("OK" if ok else "MISMATCH"); sys.exit(0 if ok else 1)
