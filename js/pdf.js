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
      else if (b.type === 'table') b.rows.forEach(r => r.cells.forEach(c => add(c.name, c.kind)));
      else if (b.type === 'component') { b.options.forEach(o => add(o.name, 'check')); b.fields.forEach(f => add(f.name, 'text')); add(b.findings, 'text', {multiline: true}); if (b.nameField) add(b.nameField, 'text'); }
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

  /* opts: {form, job, state, photos:[{blob,w,h,caption,label}], final: null | {signedBy, completedAt, revision, naLabels:[]}} */
  async function build(opts) {
    const {form, job, state, photos, final} = opts;
    const doc = await PDFDocument.load(await template(form.template));
    const font = await doc.embedFont(StandardFonts.Helvetica), bold = await doc.embedFont(StandardFonts.HelveticaBold);
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
    const woLine = `Work order ${job.wo || '-'}   |   Customer: ${job.customer || '-'}   |   ${form.title}`;
    const baseCount = doc.getPageCount();
    if (final || opts.flatten) af.flatten();
    if (final) {
      const pg = doc.addPage([W, H]);
      header(pg, font, bold, BRAND, woLine);
      let y = H - 92; sectionBar(pg, bold, y, 'Completion record'); y -= 38;
      const rows = [['Form', `${form.title} - ${form.docTitle}`], ['Status', 'Completed'], ['Revision', String(final.revision)],
                    ['Completed', final.completedAt], ['Signed by', final.signedBy], ['Customer', job.customer || ''], ['Work order', job.wo || '']];
      for (const [a, b] of rows) {
        pg.drawText(a, {x: M + 6, y, size: 11, font: bold, color: NAVY});
        pg.drawText(clean(b), {x: M + 120, y, size: 11, font}); y -= 20;
      }
      y -= 8; pg.drawText('Items marked N/A (not applicable) at finalization:', {x: M + 6, y, size: 11, font: bold, color: NAVY}); y -= 18;
      const na = final.naLabels.length ? final.naLabels : ['None'];
      for (const t of na) for (const [i, ln] of wrap(t, font, 10, W - 2 * M - 30).entries()) {
        if (y < 70) break;
        pg.drawText((i ? '   ' : '- ') + ln, {x: M + 12, y, size: 10, font}); y -= 14;
      }
      footer(pg, font, `Form: ${form.template.split('/').pop().replace('.pdf', '')}`, 'Completion record');
    }
    // Photo pages, two per page
    const total = Math.ceil(photos.length / 2);
    for (let i = 0; i < photos.length; i += 2) {
      const pg = doc.addPage([W, H]);
      header(pg, font, bold, BRAND, `Photos  |  ${woLine}`);
      const slotTop = H - 88, slotH = (slotTop - 62) / 2;
      for (let j = 0; j < 2 && i + j < photos.length; j++) {
        const ph = photos[i + j], top = slotTop - j * slotH;
        const img = await doc.embedJpg(new Uint8Array(await ph.blob.arrayBuffer()));
        sectionBar(pg, bold, top, `Photo ${i + j + 1}: ${ph.label}`);
        const capLines = ph.caption ? wrap(ph.caption, font, 10, W - 2 * M).slice(0, 2) : [];
        const boxTop = top - 28, boxH = slotH - 34 - capLines.length * 13 - 10, boxW = W - 2 * M;
        const k = Math.min(boxW / img.width, boxH / img.height);
        const iw = img.width * k, ih = img.height * k;
        pg.drawImage(img, {x: M + (boxW - iw) / 2, y: boxTop - ih, width: iw, height: ih});
        pg.drawRectangle({x: M + (boxW - iw) / 2, y: boxTop - ih, width: iw, height: ih, borderColor: GRID, borderWidth: 0.5});
        let cy = boxTop - ih - 14;
        for (const ln of capLines) { pg.drawText(ln, {x: M, y: cy, size: 10, font, color: rgb(0, 0, 0)}); cy -= 13; }
      }
      footer(pg, font, `Form: ${form.template.split('/').pop().replace('.pdf', '')}`, `Photo page ${i / 2 + 1} of ${total}`);
    }
    doc.setTitle(`${form.title} - WO ${job.wo || ''} - ${job.customer || ''}`);
    doc.setProducer('Ram-Gear Manufacturing Incorporated app (pdf-lib)'); doc.setModificationDate(new Date());
    const bytes = await doc.save({updateFieldAppearances: false});
    return {bytes, pages: doc.getPageCount(), formPages: baseCount};
  }
  const safe = s => clean(s || '').trim().replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'NA';
  function filename(job, form, suffix) {
    return `WO-${safe(job.wo)}_${safe(job.customer)}_${form.fileTitle}${suffix || ''}.pdf`;
  }
    async function combine(pdfBytesList, title) {
    const out = await PDFDocument.create();
    for (const b of pdfBytesList) {
      const src = await PDFDocument.load(b);
      (await out.copyPages(src, src.getPageIndices())).forEach(pg => out.addPage(pg));
    }
    out.setTitle(title || 'Ram Gear job'); out.setProducer('Ram-Gear Manufacturing Incorporated app (pdf-lib)');
    return out.save();
  }
  return {build, filename, fieldKinds, clean, safe, combine};
})();
