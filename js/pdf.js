/* PDF export: fill the bundled AcroForm template with pdf-lib, append photo pages. */
const PdfExport = (() => {
  const {PDFDocument, StandardFonts, rgb} = PDFLib;
  const NAVY = rgb(0x1f / 255, 0x3a / 255, 0x5f / 255), LIGHT = rgb(0xe8 / 255, 0xee / 255, 0xf5 / 255),
        GRID = rgb(0x9a / 255, 0xa8 / 255, 0xb8 / 255), GREY = rgb(0.27, 0.27, 0.27);
  const W = 612, H = 792, M = 42;
  const BRAND = 'Ram-Gear Manufacturing Incorporated';   // app-generated pages only; template form headers are untouched
  const templateCache = {};

  // Standard Helvetica only encodes WinAnsi; map common characters and replace the rest.
  const MAP = {'\u2018': "'", '\u2019': "'", '\u201c': '"', '\u201d': '"', '\u2013': '-', '\u2014': '-', '\u2026': '...', '\u00a0': ' ', '\u2022': '*',
               '\u2264': '<=', '\u2265': '>=', '\u00b1': '+/-', '\u2033': '"', '\u2032': "'", '\u00d8': 'O', '\u2300': 'dia.'};
  function clean(s, multiline) {
    s = String(s == null ? '' : s).replace(/\r\n?/g, '\n');
    let out = '';
    for (const ch of s) {
      if (MAP[ch] !== undefined) { out += MAP[ch]; continue; }
      const c = ch.codePointAt(0);
      if (ch === '\n') { out += multiline ? '\n' : ' '; continue; }
      if (c === 9) { out += ' '; continue; }
      if (c < 32 || (c > 126 && c < 160) || c > 255) { out += c > 255 ? '?' : ''; continue; }
      out += ch;
    }
    return out;
  }
  function wrap(text, font, size, width) {
    const lines = [];
    for (const para of clean(text, true).split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/)) {
        const t = line ? line + ' ' + word : word;
        if (font.widthOfTextAtSize(t, size) <= width || !line) line = t; else { lines.push(line); line = word; }
      }
      lines.push(line);
    }
    return lines;
  }
  // Template /DA strings are written with an octal-escaped slash, which pdf-lib cannot parse; set them explicitly.
  function setFontSize(tf, size) {
    const da = `/Helv ${size} Tf 0 g`;
    tf.acroField.setDefaultAppearance(da);
    for (const w of tf.acroField.getWidgets()) w.setDefaultAppearance(da);
  }
  function fitSize(tf, txt, multi, font) {
    const BASE = 11, w = tf.acroField.getWidgets()[0]; if (!txt || !w) return BASE;
    const r = w.getRectangle(), bw = r.width - 6, bh = r.height - 4;
    if (!multi) { const tw = font.widthOfTextAtSize(txt, BASE); return tw <= bw ? BASE : Math.max(5, Math.floor(BASE * bw / tw * 10) / 10); }
    for (let size = BASE; size >= 5; size -= 0.5) {
      let lines = 0;
      for (const para of txt.split('\n')) lines += Math.max(1, Math.ceil(font.widthOfTextAtSize(para, size) / bw * 1.08));
      if (lines * size * 1.2 <= bh) return size;
    }
    return 5;
  }
  async function template(url) {
    if (!templateCache[url]) templateCache[url] = fetch(url).then(r => { if (!r.ok) throw new Error('Template missing: ' + url); return r.arrayBuffer(); });
    return templateCache[url];
  }
  function fieldKinds(form) {
    const out = {};
    for (const s of form.sections) for (const b of s.blocks) {
      const add = (n, k, extra) => { out[n] = Object.assign({kind: k}, extra || {}); };
      if (b.type === 'field') add(b.name, 'text', {multiline: b.multiline, link: b.link});
      else if (b.type === 'row') b.fields.forEach(f => add(f.name, 'text', {link: f.link}));
      else if (b.type === 'check') { add(b.name, 'check'); b.fields.forEach(f => add(f.name, 'text')); if (b.notes) add(b.notes, 'text'); }
      else if (b.type === 'choice') { b.options.forEach(o => { add(o.name, 'check'); if (o.text) add(o.text, 'text'); }); if (b.notes) add(b.notes, 'text'); }
      else if (b.type === 'table') b.rows.forEach(r => r.cells.forEach(c => c.kind === 'choice' ? c.options.forEach(o => add(o.name, 'check')) : add(c.name, c.kind)));   // 'choice' cell: Replace/Reuse (Rev 1.5.2)
      else if (b.type === 'component') { b.options.forEach(o => add(o.name, 'check')); b.fields.filter(f => !f.appOnly).forEach(f => add(f.name, 'text')); add(b.findings, 'text', {multiline: true}); if (b.nameField) add(b.nameField, 'text'); }
    }
    return out;
  }
  function header(page, font, bold, title, sub) {
    page.drawRectangle({x: 0, y: H - 50, width: W, height: 50, color: NAVY});
    page.drawText(clean(title), {x: M, y: H - 32, size: 15, font: bold, color: rgb(1, 1, 1)});
    if (sub) page.drawText(clean(sub), {x: M, y: H - 72, size: 10.5, font, color: GREY});
  }
  function footer(page, font, left, right) {
    page.drawLine({start: {x: M, y: 50}, end: {x: W - M, y: 50}, thickness: 0.5, color: GRID});
    page.drawText(clean(left), {x: M, y: 24, size: 9, font, color: GREY});
    const r = clean(right); page.drawText(r, {x: W - M - font.widthOfTextAtSize(r, 9), y: 24, size: 9, font, color: GREY});
  }
  function sectionBar(page, bold, y, text) {
    page.drawRectangle({x: M, y: y - 20, width: W - 2 * M, height: 22, color: LIGHT});
    page.drawRectangle({x: M, y: y - 20, width: 4, height: 22, color: NAVY});
    page.drawText(clean(text), {x: M + 10, y: y - 14, size: 12, font: bold, color: NAVY});
  }

  /* Rev 1.6.1: photo grid pages inserted after page `after` (1-based): per group a "Photos - <section>" bar, 3 photos per row
     (~2.3 in wide, aspect preserved) with the caption under each, and a note that full-size photos are in the app / job export. */
  const NOTE = 'Full-size photos available in the Ram-Gear app / job export.';
  async function embedPhoto(doc, blob) {
    // Rev 1.7.2: job / section photos must actually render. Try JPEG, PNG, then canvas re-encode to JPEG
    // (cloud downloads and some device cameras are not pdf-lib-friendly). Never throw — caller skips failures.
    if (!blob) return null;
    const toBytes = async b => new Uint8Array(await (b.arrayBuffer ? b.arrayBuffer() : new Response(b).arrayBuffer()));
    try {
      const bytes = await toBytes(blob);
      try { return await doc.embedJpg(bytes); } catch (_) {}
      try { return await doc.embedPng(bytes); } catch (_) {}
    } catch (_) {}
    try {
      const bmp = await createImageBitmap(blob);
      const c = document.createElement('canvas'); c.width = bmp.width || 1; c.height = bmp.height || 1;
      c.getContext('2d').drawImage(bmp, 0, 0); if (bmp.close) bmp.close();
      const jpeg = await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('toBlob')), 'image/jpeg', 0.92));
      return await doc.embedJpg(await toBytes(jpeg));
    } catch (e) { console.warn('photo embed failed', e); return null; }
  }
  async function photoGrid(doc, groups, after, o) {
    // Rev 1.7.2: embed first, then paginate only photos that loaded — no blank pages reserved for missing images.
    // Pack multiple section groups onto one page when they share an insertion point and fit.
    const prepared = [];
    for (const g of groups || []) {
      const photos = [];
      for (const ph of g.photos || []) {
        const img = await embedPhoto(doc, ph.blob || ph.thumb);
        if (img) photos.push({caption: ph.caption, sub: ph.sub, img});
        else console.warn('Skipping unreadable photo in PDF:', ph.caption || ph.sub || '(no caption)');
      }
      if (photos.length) prepared.push({title: g.title, photos});
    }
    if (!prepared.length) return 0;
    const COLS = 3, GAP = 16, CW = (W - 2 * M - GAP * (COLS - 1)) / COLS, BOXH = 132, CAP = 3, ROWH = BOXH + 8 + CAP * 10.5 + 8, TOP = H - 66, BOT = 64;
    let pg = null, y = 0, idx = Math.min(Math.max(after | 0, 0), doc.getPageCount()), title = '', n0 = doc.getPageCount();
    const foot = () => { if (pg) footer(pg, o.font, o.formId, `Photos - ${title}`); };
    const newPage = () => {
      foot();
      if (idx >= doc.getPageCount()) { pg = doc.addPage([W, H]); idx = doc.getPageCount(); }
      else pg = doc.insertPage(idx++, [W, H]);
      header(pg, o.font, o.bold, o.header, null); o.stamp(pg); y = TOP;
    };
    const bar = t => { sectionBar(pg, o.bold, y, t); y -= 30; };
    const need = h => { if (!pg || y - h < BOT) { newPage(); return true; } return false; };
    for (const g of prepared) {
      title = g.title; const list = g.photos;
      if (need(30 + ROWH + 18)) { /* new page */ } else y -= 8;
      bar(`Photos - ${g.title}`);
      for (let i = 0; i < list.length; i += COLS) {
        if (y - ROWH - 18 < BOT) { title = g.title; need(ROWH + 30 + 18); bar(`Photos - ${g.title} (continued)`); }
        for (let j = 0; j < COLS && i + j < list.length; j++) {
          const ph = list[i + j], x0 = M + j * (CW + GAP), img = ph.img;
          const k = Math.min(CW / img.width, BOXH / img.height), iw = img.width * k, ih = img.height * k;
          pg.drawImage(img, {x: x0, y: y - ih, width: iw, height: ih});
          pg.drawRectangle({x: x0, y: y - ih, width: iw, height: ih, borderColor: GRID, borderWidth: 0.5});
          let cy = y - BOXH - 12;
          const lines = wrap(`Photo ${i + j + 1}: ${ph.caption || '(no caption)'}`, o.bold, 8.5, CW).slice(0, ph.sub ? CAP - 1 : CAP);
          for (const ln of lines) { pg.drawText(ln, {x: x0, y: cy, size: 8.5, font: o.bold, color: NAVY}); cy -= 10.5; }
          if (ph.sub) pg.drawText(wrap(ph.sub, o.font, 8, CW)[0], {x: x0, y: cy, size: 8, font: o.font, color: GREY});
        }
        y -= ROWH;
      }
      pg.drawText(NOTE, {x: M, y: y - 4, size: 8, font: o.ital, color: GREY}); y -= 18;
    }
    foot();
    return doc.getPageCount() - n0;
  }


  /* Rev 1.7: Parts Summary pages. data: {meta: {customer, wo, date, tablet, rev, generated}, gearboxes: [{label, typeLabel, serial,
     manufacturer, model, status: 'DRAFT' | 'FINAL', summary: Parts.gearbox()}], roll: Parts.rollup() | null} */
  async function partsPages(doc, data) {
    const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold), ital = await doc.embedFont(StandardFonts.HelveticaOblique);
    const RED = rgb(0.75, 0.16, 0.12), GREEN = rgb(0.1, 0.45, 0.2), m = data.meta, q = n => Parts.fmtQty(n);
    let pg, y, n0 = doc.getPageCount(), title = '';
    const foot = () => footer(pg, font, `Tablet: ${m.tablet || '-'}   |   App ${m.rev || '-'}   |   Generated ${m.generated || ''}`, `Parts Summary - ${title}`);
    const newPage = () => { pg = doc.addPage([W, H]); foot(); header(pg, font, bold, BRAND, `Parts Summary   |   Work order ${m.wo || '-'}   |   Customer: ${m.customer || '-'}${m.date ? '   |   Date ' + m.date : ''}`); y = H - 92; };
    const need = h => { if (y - h < 66) { newPage(); return true; } return false; };
    function table(head, cols, rows, empty) {
      // cols: [{t, w, align}] ; rows: [[cells]]
      need(22 + 18 + (rows.length ? 16 : 18));
      pg.drawText(clean(head), {x: M, y: y - 12, size: 11, font: bold, color: NAVY}); y -= 20;
      const hdr = () => { pg.drawRectangle({x: M, y: y - 16, width: W - 2 * M, height: 16, color: NAVY}); let x = M; for (const c of cols) { pg.drawText(c.t, {x: c.align === 'r' ? x + c.w - 6 - bold.widthOfTextAtSize(c.t, 8) : x + 4, y: y - 11.5, size: 8, font: bold, color: rgb(1, 1, 1)}); x += c.w; } y -= 16; };
      hdr();
      if (!rows.length) { pg.drawText(clean(empty), {x: M + 4, y: y - 13, size: 9, font: ital, color: GREY}); y -= 24; return; }
      rows.forEach((r, ri) => {
        const lines = r.map((v, i) => wrap(String(v == null ? '' : v), i === 0 ? bold : font, 8.5, cols[i].w - 8));
        const h = Math.max(...lines.map(l => l.length)) * 10.5 + 6;
        if (need(h)) hdr();
        if (ri % 2) pg.drawRectangle({x: M, y: y - h, width: W - 2 * M, height: h, color: LIGHT});
        let x = M;
        lines.forEach((ls, i) => { ls.forEach((ln, k) => { const f = i === 0 ? bold : font, tw = f.widthOfTextAtSize(ln, 8.5); pg.drawText(ln, {x: cols[i].align === 'r' ? x + cols[i].w - 6 - tw : x + 4, y: y - 11 - k * 10.5, size: 8.5, font: f, color: rgb(0, 0, 0)}); }); x += cols[i].w; });
        pg.drawLine({start: {x: M, y: y - h}, end: {x: W - M, y: y - h}, thickness: 0.4, color: GRID}); y -= h;
      });
      y -= 12;
    }
    const PCOLS = [{t: 'Part / description', w: 140}, {t: 'Location', w: 100}, {t: 'Qty', w: 32, align: 'r'}, {t: 'Part no.', w: 96}, {t: 'Failure mode / notes', w: W - 2 * M - 368}];
    const prow = it => [it.desc + (it.type && it.cat !== 'Other' && it.cat !== 'Gears' && it.cat !== 'Shafts' ? ` (${it.type})` : ''), it.loc, q(it.qty), it.pn, it.notes];
    for (const g of data.rollOnly ? [] : data.gearboxes) {
      title = g.label; newPage();
      sectionBar(pg, bold, y, `Parts Summary - ${g.label}  |  ${g.typeLabel}`);
      const st = g.status === 'FINAL' ? 'FINAL' : 'DRAFT', sw = bold.widthOfTextAtSize(st, 12);
      pg.drawRectangle({x: W - M - sw - 18, y: y - 19, width: sw + 14, height: 20, borderColor: st === 'FINAL' ? GREEN : RED, borderWidth: 1.5});
      pg.drawText(st, {x: W - M - sw - 11, y: y - 14, size: 12, font: bold, color: st === 'FINAL' ? GREEN : RED});
      y -= 32;
      const info = [['Customer', m.customer], ['Work order', m.wo], ['Gearbox', `${g.label}  (${g.typeLabel})`], ['Manufacturer / model', [g.manufacturer, g.model].filter(Boolean).join(' ') || '-'], ['Serial number', g.serial || '-'], ['Tablet ID', m.tablet || '-'],
                    ['Status', st === 'FINAL' ? 'Teardown Evaluation finalized' : (g.noTeardown ? 'No Teardown Evaluation for this gearbox' : 'DRAFT - Teardown Evaluation not finalized; quantities may change')]];
      for (const [a, b] of info) { pg.drawText(a, {x: M + 4, y: y - 10, size: 9.5, font: bold, color: NAVY}); pg.drawText(clean(b || '-'), {x: M + 130, y: y - 10, size: 9.5, font}); y -= 14; }
      y -= 10;
      table('Parts to replace', PCOLS, g.summary.replace.map(prow), 'No components marked Replace.');
      table('Parts to repair', PCOLS, g.summary.repair.map(prow), 'No components marked Repair.');
      table('Shim packs to replace', [{t: 'Item', w: 140}, {t: 'Location', w: 180}, {t: 'Qty', w: 32, align: 'r'}, {t: 'From', w: W - 2 * M - 352}], g.summary.shims.map(s => [s.desc, s.loc, q(s.qty), s.src]), 'No shim packs marked Replace.');
      table('Totals by type (parts to replace)', [{t: 'Type', w: 240}, {t: 'Group', w: 160}, {t: 'Qty', w: W - 2 * M - 400, align: 'r'}], g.summary.totals.map(t => [t.type, t.cat, q(t.qty)]), 'No bearings, seals, gaskets or shim packs to replace.');
    }
    if (data.roll) {
      title = 'Job roll-up'; newPage(); sectionBar(pg, bold, y, `Parts Summary - job roll-up (${data.gearboxes.length} gearbox${data.gearboxes.length === 1 ? '' : 'es'})`); y -= 34;
      const drafts = data.gearboxes.filter(g => g.status !== 'FINAL').map(g => g.label);
      if (drafts.length) { pg.drawText(clean(`DRAFT: ${drafts.join(', ')} not finalized; quantities may change.`), {x: M + 4, y: y - 10, size: 9.5, font: bold, color: RED}); y -= 20; }
      table('Totals by type, all gearboxes', [{t: 'Type', w: 240}, {t: 'Group', w: 160}, {t: 'Qty', w: W - 2 * M - 400, align: 'r'}], data.roll.totals.map(t => [t.type, t.cat, q(t.qty)]), 'No bearings, seals, gaskets or shim packs to replace.');
      table('All parts to replace (same part merged)', [{t: 'Part / description', w: 170}, {t: 'Part no.', w: 110}, {t: 'Qty', w: 32, align: 'r'}, {t: 'Gearboxes', w: W - 2 * M - 312}],
            data.roll.lines.map(l => [l.desc + (l.type ? ` (${l.type})` : ''), l.pn, q(l.qty), l.where.join(', ')]), 'Nothing to replace.');
      pg.drawText(clean(`Parts to repair: ${data.roll.repairs} line(s) - see each gearbox.`), {x: M + 4, y: y - 4, size: 9, font: ital, color: GREY}); y -= 16;
    }
    return doc.getPageCount() - n0;
  }
  async function partsPdf(data) {
    const doc = await PDFDocument.create(); await partsPages(doc, data);
    doc.setTitle(`Parts Summary - WO ${data.meta.wo || ''} - ${data.meta.customer || ''}`); doc.setProducer('Ram-Gear Manufacturing Incorporated app (pdf-lib)');
    return doc.save();
  }
  /* opts: {form, job, state,  /* opts: {form, job, state, photos:[{blob,w,h,caption}] (job photos, at the end), groups:[{title, after: template page, photos:[{blob,w,h,caption,sub}], empty}] (Rev 1.6.1), final: null | {signedBy, completedAt, revision, naLabels:[]},
           gearbox: {label:'Gearbox 1 of 2', count, reduction:'Triple', typeLabel:'Triple reduction' | 'Planetary 2-stage', stagesText, serial}} */
  async function build(opts) {
    const {form, job, state, photos, final} = opts;
    const doc = await PDFDocument.load(await template(form.template));
    const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const ital = await doc.embedFont(StandardFonts.HelveticaOblique);
    // Rev 1.6: "L. Teardown photos" is the template's last page (empty frames for paper use); it is replaced by the captioned photos.
    const pSec = form.sections.find(s => s.blocks.some(b => b.type === 'photos')), tplPages = doc.getPageCount();
    if (pSec) doc.removePage(tplPages - 1);
    const af = doc.getForm(), kinds = fieldKinds(form), vals = state.values || {};
    for (const [name, k] of Object.entries(kinds)) {
      let v = k.link ? job[k.link] : vals[name];
      try {
        if (k.kind === 'check') { const cb = af.getCheckBox(name); v ? cb.check() : cb.uncheck(); }
        else {
          const tf = af.getTextField(name), multi = tf.isMultiline(), txt = clean(v, multi);
          tf.setText(txt || undefined);
          setFontSize(tf, fitSize(tf, txt, multi, font));
        }
      } catch (e) { console.warn('field', name, e); }
    }
    af.updateFieldAppearances(font);
    // Register the fonts pdf-lib names in /DA so viewers that regenerate appearances find them.
    const {PDFName, PDFDict} = PDFLib;
    const acro = af.acroForm.dict, ctx = doc.context;
    let dr = acro.lookup(PDFName.of('DR')); if (!dr) { dr = ctx.obj({}); acro.set(PDFName.of('DR'), dr); }
    let fonts = dr.lookup(PDFName.of('Font')); if (!fonts) { fonts = ctx.obj({}); dr.set(PDFName.of('Font'), fonts); }
    fonts.set(PDFName.of(font.name), font.ref);
    const zadb = await doc.embedFont(StandardFonts.ZapfDingbats); fonts.set(PDFName.of('ZaDb'), zadb.ref);
    const gb = opts.gearbox || null, gbText = gb ? `${gb.label}  |  ${gb.typeLabel || gb.reduction + ' reduction'}${gb.serial ? '  |  S/N ' + gb.serial : ''}` : '';
    const woLine = `Work order ${job.wo || '-'}   |   Customer: ${job.customer || '-'}   |   ${form.title}${gb ? '   |   ' + gb.label : ''}`;
    const stamp = pg => { if (!gb) return; const t = clean(gbText), sz = 8.5, tw = bold.widthOfTextAtSize(t, sz); pg.drawText(t, {x: W - M + 20 - tw, y: H - 46, size: sz, font: bold, color: rgb(0.86, 0.91, 0.97)}); };
    for (const pg of doc.getPages()) stamp(pg);   // identify the gearbox on every template page: right-aligned in the navy header bar, under the title line
    // Rev 1.6.1: each section's photos print right after the template page where that section ends (L / Additional photos after the last page)
    const formId = `Form: ${form.template.split('/').pop().replace('.pdf', '')}`, last = doc.getPageCount(), at = {};
    for (const g of opts.groups || []) { const p = Math.min(g.after || last, last); (at[p] = at[p] || []).push(g); }
    for (const p of Object.keys(at).map(Number).sort((a, b) => b - a)) await photoGrid(doc, at[p], p, {font, bold, ital, header: form.header || BRAND, formId, stamp});
    const baseCount = doc.getPageCount();
    if (final || opts.flatten) af.flatten();
    if (final) {
      let pg = doc.addPage([W, H]);
      header(pg, font, bold, BRAND, woLine);
      let y = H - 92; sectionBar(pg, bold, y, 'Completion record'); y -= 38;
      const rows = [['Form', `${form.title} - ${form.docTitle}`], ['Status', 'Completed'], ['Revision', String(final.revision)],
                    ...(gb ? [['Gearbox', gb.label + (gb.serial ? `  (S/N ${gb.serial})` : '')], [form.kind === 'planetary' ? 'Type' : 'Reduction', gb.typeLabel ? `${gb.typeLabel} (${gb.stagesText})` : `${gb.reduction} reduction (${form.stages || '-'} stage${form.stages === 1 ? '' : 's'})`]] : []),
                    ['Completed', final.completedAt], ['Signed by', final.signedBy], ['Finalized by', final.finalizedBy || '-'], ['Inspected on', final.inspectedOn || '-'], ['Customer', job.customer || ''], ['Work order', job.wo || ''], ['App revision', final.appRev || '-']];
      for (const [a, b] of rows) {
        pg.drawText(a, {x: M + 6, y, size: 11, font: bold, color: NAVY});
        pg.drawText(clean(b), {x: M + 120, y, size: 11, font}); y -= 20;
      }
      y -= 8; pg.drawText('Items marked N/A (not applicable) at finalization:', {x: M + 6, y, size: 11, font: bold, color: NAVY}); y -= 18;
      const na = final.naLabels.length ? final.naLabels : ['None'];
      for (const t of na) for (const [i, ln] of wrap(t, font, 10, W - 2 * M - 30).entries()) {
        if (y < 70) {   // long N/A list: continue on another page (Rev 1.5.2; it used to stop at the page bottom)
          footer(pg, font, `Form: ${form.template.split('/').pop().replace('.pdf', '')}`, 'Completion record');
          pg = doc.addPage([W, H]); header(pg, font, bold, BRAND, woLine); y = H - 92; sectionBar(pg, bold, y, 'Completion record (continued)'); y -= 38;
        }
        pg.drawText((i ? '   ' : '- ') + ln, {x: M + 12, y, size: 10, font}); y -= 14;
      }
      footer(pg, font, `Form: ${form.template.split('/').pop().replace('.pdf', '')}`, 'Completion record');
    }
    // Job photos (shared by all forms of the job): same grid, at the end
    const jobPhotos = (photos || []).filter(p => p && (p.blob || p.thumb));
    if (jobPhotos.length) await photoGrid(doc, [{title: 'Job photos', photos: jobPhotos}], doc.getPageCount(), {font, bold, ital, header: BRAND, formId, stamp});
    const partsN = opts.parts ? await partsPages(doc, opts.parts) : 0;   // Rev 1.7: Parts Summary at the end of the final Teardown PDF
    doc.setTitle(`${form.title}${gb ? ' - ' + gb.label : ''} - WO ${job.wo || ''} - ${job.customer || ''}`);
    doc.setProducer('Ram-Gear Manufacturing Incorporated app (pdf-lib)'); doc.setModificationDate(new Date());
    const bytes = await doc.save({updateFieldAppearances: false});
    return {bytes, pages: doc.getPageCount(), formPages: baseCount, partsPages: partsN};
  }
  const safe = s => clean(s || '').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'NA';
  function filename(job, form, suffix) {
    return `WO-${safe(job.wo)}_${safe(job.customer)}_${form.fileTitle}${job.gbTag || ''}${suffix || ''}.pdf`;   // gbTag "_GB1", "_GB2" … (every job, Rev 1.5.1)
  }
  /* list items: PDF bytes, or {divider: {title, sub, lines:[]}} for a gearbox separator page */
  async function combine(pdfBytesList, title) {
    const out = await PDFDocument.create();
    let font = null, bold = null;
    for (const b of pdfBytesList) {
      if (b && b.divider) {
        if (!font) { font = await out.embedFont(StandardFonts.Helvetica); bold = await out.embedFont(StandardFonts.HelveticaBold); }
        const pg = out.addPage([W, H]); header(pg, font, bold, BRAND, b.divider.sub || '');
        sectionBar(pg, bold, H - 300, b.divider.title);
        let y = H - 350; for (const ln of b.divider.lines || []) { pg.drawText(clean(ln), {x: M + 10, y, size: 12, font}); y -= 20; }
        footer(pg, font, clean(title || ''), b.divider.title); continue;
      }
      const src = await PDFDocument.load(b && b.pdf ? b.pdf : b), drop = (b && b.dropLast) || 0;   // {pdf, dropLast}: leave out a final teardown's own Parts Summary pages
      (await out.copyPages(src, src.getPageIndices().slice(0, src.getPageCount() - drop))).forEach(pg => out.addPage(pg));
    }
    out.setTitle(title || 'Ram Gear job'); out.setProducer('Ram-Gear Manufacturing Incorporated app (pdf-lib)');
    return out.save();
  }
  return {build, filename, fieldKinds, clean, safe, combine, partsPdf};
})();
