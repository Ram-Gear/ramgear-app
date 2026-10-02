/* Rev 1.7: Parts Summary (bad pieces and quantities needed) per gearbox, built from the Teardown Evaluation
   (components marked Replace / Repair, planet rows) and the shim Replace / Reuse choices of both forms.
   Pure functions on form definitions + values; used by the app view, the PDFs and the zip CSV. */
const Parts = (() => {
  const filled = v => v === true || (typeof v === 'string' && v.trim() !== '');
  const txt = v => (typeof v === 'string' ? v.trim() : '');
  const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) && n > 0 ? n : null; };
  const CAT_ORDER = ['Bearings', 'Seals', 'Gaskets / O-rings', 'Shim packs'];
  function defaultQty(meta, vals) {
    if (meta.perPlanet) {
      const n = parseInt(vals[meta.countField], 10);
      return n > 0 ? {qty: n * meta.perPlanet, note: ''} : {qty: 3 * meta.perPlanet, note: 'number of planets not entered, 3 assumed'};
    }
    return {qty: meta.qty || 1, note: ''};
  }
  const qtyHint = meta => meta.perPlanet ? `${meta.perPlanet} per planet` : String(meta.qty || 1);
  function classifyOther(name) {   // "Other component" rows: category from the typed name
    if (/bearing/i.test(name)) return {cat: 'Bearings', type: 'Bearing'};
    if (/seal/i.test(name)) return {cat: 'Seals', type: 'Oil seal'};
    if (/o-?\s?ring/i.test(name)) return {cat: 'Gaskets / O-rings', type: 'O-ring'};
    if (/gasket/i.test(name)) return {cat: 'Gaskets / O-rings', type: 'Gasket'};
    return {cat: 'Other', type: ''};
  }
  function shimRows(def, vals) {   // [{shaft, end, disp}] from tables marked "shims"
    const out = [];
    if (!def) return out;
    for (const s of def.sections) for (const b of s.blocks) if (b.type === 'table' && b.shims) for (const r of b.rows) {
      const c = r.cells.find(x => x.kind === 'choice'); if (!c) continue;
      const rep = c.options.find(o => o.label === 'Replace'), reu = c.options.find(o => o.label === 'Reuse');
      out.push({shaft: r.label[0], end: r.label[1] || '', disp: vals[rep.name] ? 'replace' : vals[reu.name] ? 'reuse' : null});
    }
    return out;
  }
  /* {td, tdVals, as, asVals} -> {replace, repair, shims, totals} */
  function gearbox({td, tdVals = {}, as, asVals = {}}) {
    const replace = [], repair = [], shims = [];
    if (td) for (const sec of td.sections) for (const b of sec.blocks) {
      if (b.type === 'component' && b.parts) {
        const disp = tdVals[`${b.id}_replace`] ? 'replace' : tdVals[`${b.id}_repair`] ? 'repair' : null; if (!disp) continue;
        const name = b.nameField ? (txt(tdVals[b.nameField]) || b.name) : b.name;
        const pnF = b.fields.filter(f => /_pn$/.test(f.name)), pn = pnF.filter(f => filled(tdVals[f.name])).map(f => (pnF.length > 1 ? f.label + ' ' : '') + txt(tdVals[f.name])).join(' / ');
        const d = defaultQty(b.parts, tdVals), q = num(tdVals[`${b.id}_qty`]);
        let cat = b.parts.cat, type = txt(tdVals[`${b.id}_btype`]) || b.parts.type || '';
        if (b.nameField) { const k = classifyOther(name); cat = k.cat; type = type || k.type; }
        const notes = [txt(tdVals[b.findings]), q ? '' : d.note].filter(Boolean).join('; ');
        (disp === 'replace' ? replace : repair).push({desc: name, loc: b.parts.loc || '', qty: q || d.qty, pn, notes, cat, type, id: b.id});
      }
      if (b.type === 'table' && b.parts) {   // planet rows: one line per stage and disposition
        const cf = b.rows[0] && b.rows[0].req && b.rows[0].req.ifCount, count = cf ? parseInt(tdVals[cf.field], 10) : NaN;
        for (const disp of ['replace', 'repair']) {
          const rows = b.rows.filter(r => (!(count > 0) || !r.req || !r.req.ifCount || count >= r.req.ifCount.min) && r.cells.some(c => c.kind === 'choice' && tdVals[c.options.find(o => o.name.endsWith('_' + disp)).name]));
          if (!rows.length) continue;
          const notes = rows.map(r => { const t = r.cells.filter(c => c.kind === 'text').map(c => txt(tdVals[c.name])).filter(Boolean); return t.length ? `${r.label[0]}: ${t.join(', ')}` : ''; }).filter(Boolean).join('; ');
          (disp === 'replace' ? replace : repair).push({desc: b.parts.name, loc: `${b.parts.loc}, ${rows.map(r => r.label[0].toLowerCase()).join(', ')}`, qty: rows.length, pn: '', notes, cat: b.parts.cat, type: '', id: b.title});
        }
      }
    }
    // shim packs: the Assembly Verification decides per shaft once it has a choice for that shaft, else the teardown (as found)
    const tr = shimRows(td, tdVals), ar = shimRows(as, asVals), shafts = [...new Set([...ar.map(r => r.shaft), ...tr.map(r => r.shaft)])];
    for (const sh of shafts) {
      const a = ar.filter(r => r.shaft === sh && r.disp);
      if (a.length) a.filter(r => r.disp === 'replace').forEach(r => shims.push({desc: 'Shim pack', loc: `${sh}${r.end ? ' - ' + r.end : ''}`, qty: 1, src: 'Assembly Verification'}));
      else tr.filter(r => r.shaft === sh && r.disp === 'replace').forEach(r => shims.push({desc: 'Shim pack', loc: sh, qty: 1, src: 'Teardown Evaluation (as found)'}));
    }
    return {replace, repair, shims, totals: totals([{replace, shims}])};
  }
  function totals(list) {   // bearings / seals / gaskets by type, shim packs
    const m = new Map();
    const add = (cat, type, q) => { const k = cat + '|' + type; m.set(k, {cat, type, qty: (m.has(k) ? m.get(k).qty : 0) + q}); };
    for (const g of list) {
      for (const it of g.replace) if (CAT_ORDER.includes(it.cat)) add(it.cat, it.type || it.cat.replace(/s$/, ''), it.qty);
      for (const s of g.shims) add('Shim packs', 'Shim pack', s.qty);
    }
    return [...m.values()].sort((a, b) => CAT_ORDER.indexOf(a.cat) - CAT_ORDER.indexOf(b.cat) || a.type.localeCompare(b.type));
  }
  /* job roll-up: [{label, summary}] -> {totals, lines:[{desc, type, pn, qty, where}]} (Replace items + shim packs, same part merged) */
  function rollup(gbs) {
    const m = new Map();
    for (const g of gbs) for (const it of [...g.summary.replace, ...g.summary.shims]) {
      const k = [it.desc, it.type || '', it.pn || ''].join('|'), e = m.get(k) || {desc: it.desc, type: it.type || '', pn: it.pn || '', qty: 0, where: []};
      e.qty += it.qty; if (!e.where.includes(g.label)) e.where.push(g.label); m.set(k, e);
    }
    return {totals: totals(gbs.map(g => g.summary)), lines: [...m.values()], repairs: gbs.reduce((n, g) => n + g.summary.repair.length, 0)};
  }
  const fmtQty = q => Number.isInteger(q) ? String(q) : String(Math.round(q * 100) / 100);
  function csv(meta, gbs, roll) {
    const q = v => { const s = String(v == null ? '' : v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const rows = [['Work order', 'Customer', 'Gearbox', 'Type', 'Serial', 'Status', 'List', 'Part / description', 'Location', 'Qty', 'Part number', 'Failure mode / notes', 'Category', 'Part type']];
    for (const g of gbs) {
      const base = [meta.wo, meta.customer, g.label, g.typeLabel, g.serial || '', g.status];
      for (const it of g.summary.replace) rows.push([...base, 'Replace', it.desc, it.loc, fmtQty(it.qty), it.pn, it.notes, it.cat, it.type]);
      for (const it of g.summary.repair) rows.push([...base, 'Repair', it.desc, it.loc, fmtQty(it.qty), it.pn, it.notes, it.cat, it.type]);
      for (const s of g.summary.shims) rows.push([...base, 'Shim pack to replace', s.desc, s.loc, fmtQty(s.qty), '', s.src, 'Shim packs', 'Shim pack']);
      for (const t of g.summary.totals) rows.push([...base, 'Total', t.type, '', fmtQty(t.qty), '', '', t.cat, t.type]);
    }
    if (roll) for (const t of roll.totals) rows.push([meta.wo, meta.customer, 'All gearboxes', '', '', '', 'Job total', t.type, '', fmtQty(t.qty), '', '', t.cat, t.type]);
    return '\ufeff' + rows.map(r => r.map(q).join(',')).join('\r\n') + '\r\n';
  }
  return {gearbox, rollup, totals, csv, qtyHint, defaultQty, fmtQty};
})();
