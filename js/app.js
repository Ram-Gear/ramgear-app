/* Ram Gear Jobs - tablet-first offline forms app. Customers > Jobs > Forms. No backend; all data in IndexedDB on this device. */
(() => {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const view = $('#view');
  let FORMS = null, FORM_BY_KEY = {}, KINDS = {}, REQS = {};
  let urls = [];            // object URLs to revoke on navigation
  let pendingPhoto = null;  // {jobId, scope, label}
  let current = {customer: null, job: null, formKey: null};
  let saveTimer = null;
  const P = {
    home: () => '#/',
    cust: c => `#/c/${encodeURIComponent(c)}`,
    job: (c, j) => `#/c/${encodeURIComponent(c)}/j/${encodeURIComponent(j)}`,
    form: (c, j, k) => `#/c/${encodeURIComponent(c)}/j/${encodeURIComponent(j)}/f/${k}`,
  };

  const fmtDate = t => t ? new Date(t).toLocaleString([], {year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'}) : '';
  const fmtDay = t => t ? new Date(t).toLocaleDateString([], {year: 'numeric', month: 'short', day: 'numeric'}) : '';
  const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  function objUrl(blob) { const u = URL.createObjectURL(blob); urls.push(u); return u; }
  function hideToast() { $('#toast').classList.remove('show'); }
  function toast(msg, ms = 2200) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('show'), ms); }

  /* ---------- dialogs ---------- */
  function modal(html, buttons, opts = {}) {
    const dlg = $('#dlg'), f = $('#dlgForm'); f.onclick = null; hideToast();
    f.innerHTML = `<div class="dlg-body">${html}</div><div class="dlg-actions">${buttons.map(b =>
      `<button value="${esc(b.value)}" class="btn ${b.cls || ''}" ${b.value === 'cancel' ? 'formnovalidate' : ''}>${esc(b.label)}</button>`).join('')}</div>`;
    dlg.className = opts.wide ? 'wide' : '';
    return new Promise(res => {
      const done = () => { dlg.removeEventListener('close', done); res(dlg.returnValue || 'cancel'); };
      dlg.addEventListener('close', done);
      dlg.returnValue = ''; dlg.showModal();
      if (opts.onOpen) opts.onOpen(f, dlg);
      const first = $('input,textarea,select', f); if (first && !opts.noFocus) setTimeout(() => first.focus(), 50);
    });
  }
  const confirmBox = (title, msg, okLabel = 'OK', danger = false) =>
    modal(`<h2>${esc(title)}</h2><p>${msg}</p>`, [{label: 'Cancel', value: 'cancel'}, {label: okLabel, value: 'ok', cls: danger ? 'danger' : 'primary'}]).then(v => v === 'ok');

  /* ---------- sharing ---------- */
  async function shareOrDownload(blob, filename, title) {
    const file = new File([blob], filename, {type: blob.type || 'application/octet-stream'});
    if (navigator.canShare && navigator.canShare({files: [file]})) {
      try { await navigator.share({files: [file], title: title || filename}); return 'shared'; }
      catch (e) { if (e.name === 'AbortError') return 'cancelled'; console.warn('share failed, downloading', e); }
    }
    download(blob, filename); return 'downloaded';
  }
  function download(blob, filename) {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
  }
  function openBlob(blob) {
    const u = URL.createObjectURL(blob); setTimeout(() => URL.revokeObjectURL(u), 600000);
    const w = window.open(u, '_blank'); if (!w) location.href = u;
  }
  const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function printPdf(blob, filename) {
    if (isIOS()) { toast('On iPad: use Share, then Print', 3500); return shareOrDownload(blob, filename || 'print.pdf'); }
    const u = URL.createObjectURL(blob), fr = document.createElement('iframe');
    fr.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0';
    fr.src = u; document.body.appendChild(fr);
    fr.onload = () => { try { fr.contentWindow.focus(); fr.contentWindow.print(); } catch (e) { openBlob(blob); } setTimeout(() => { fr.remove(); URL.revokeObjectURL(u); }, 120000); };
  }
  async function fileReady(blob, filename, heading, isPdf = true) {
    // Separate tap so the share sheet keeps the user gesture (required on iPad Safari).
    const v = await modal(`<h2>${esc(heading || 'File ready')}</h2><p class="mono">${esc(filename)}</p><p class="muted">${(blob.size / 1024).toFixed(0)} KB</p>`,
      [{label: 'Close', value: 'cancel'}].concat(isPdf ? [{label: 'Open', value: 'open'}, {label: 'Print', value: 'print'}] : [])
        .concat([{label: 'Download', value: 'dl'}, {label: 'Share', value: 'share', cls: 'primary'}]));
    if (v === 'share') await shareOrDownload(blob, filename);
    else if (v === 'dl') download(blob, filename);
    else if (v === 'open') openBlob(blob);
    else if (v === 'print') printPdf(blob, filename);
  }

  /* ---------- model helpers ---------- */
  function newFormState() { return {enabled: true, status: 'draft', revision: 1, values: {}, na: {}, history: [], createdAt: Date.now()}; }
  function formStates(job) { return FORMS.forms.filter(f => job.forms[f.key] && job.forms[f.key].enabled); }
  function jobStatus(job) {
    const fs = formStates(job); if (!fs.length) return 'draft';
    return fs.every(f => job.forms[f.key].status === 'completed') ? 'completed' : 'draft';
  }
  const badge = st => st === 'completed' ? '<span class="badge done">Completed</span>' : '<span class="badge draft">Draft</span>';
  function custName(job, cust) { return (cust && cust.id === 'unassigned' && job.legacyCustomer) ? job.legacyCustomer : (cust ? cust.name : ''); }
  /* Values that auto-fill into both forms (customer name comes from the customer file). */
  function ctx(job, cust) { return {customer: custName(job, cust), wo: job.wo || '', manufacturer: job.manufacturer || '', model: job.model || '', serial: job.serial || '', date: job.date || ''}; }
  function getVal(job, key, name) {
    const k = KINDS[key][name] || {}, st = job.forms[key];
    if (k.link) return (st.status === 'completed' && st.snapshot ? st.snapshot : ctx(job, current.customer))[k.link];
    return st.values[name];
  }
  const filled = v => v === true || (typeof v === 'string' && v.trim() !== '');
  function reqState(job, key, req) {
    const st = job.forms[key];
    if (req.onlyIf && !filled(st.values[req.onlyIf])) return 'skip';
    if (st.na[req.id]) return 'na';
    const okAll = (req.all || []).every(n => filled(getVal(job, key, n)));
    const okAny = !req.any || req.any.some(n => filled(getVal(job, key, n)));
    return okAll && okAny ? 'done' : 'missing';
  }
  function progress(job, key) {
    let done = 0, total = 0; const missing = [];
    for (const r of REQS[key]) {
      const s = reqState(job, key, r.req); if (s === 'skip') continue;
      total++; if (s === 'done' || s === 'na') done++; else missing.push(r);
    }
    return {done, total, missing};
  }
  async function saveJob(job) { job.updatedAt = Date.now(); await DB.put('jobs', job); }
  async function saveCustomer(c) { c.updatedAt = Date.now(); await DB.put('customers', c); }
  function scheduleSave() {
    const ind = $('#saveInd'); if (ind) ind.textContent = 'Saving…';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(async () => {
      saveTimer = null;
      await saveJob(current.job);
      const i = $('#saveInd'); if (i) i.textContent = 'Saved ' + new Date().toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'});
    }, 400);
  }
  async function flushSave() { if (saveTimer && current.job) { clearTimeout(saveTimer); saveTimer = null; await saveJob(current.job); } }
  window.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
  window.addEventListener('pagehide', flushSave);

  /* ---------- app bar with breadcrumbs ---------- */
  function bar(crumbs, actionsHtml, back) {
    // crumbs: [{label, href}] - last one is the current page
    $('#appbarSub').innerHTML = `<nav class="crumbs" aria-label="Breadcrumb">${crumbs.map((c, i) => i < crumbs.length - 1
      ? `<a href="${esc(c.href)}">${esc(c.label)}</a><span class="sep">›</span>` : `<span class="cur">${esc(c.label)}</span>`).join('')}</nav>`;
    $('#appbarActions').innerHTML = actionsHtml || '';
    const b = $('#backBtn'); b.hidden = !back;
    setBarH && setTimeout(setBarH, 0);
    if (back) { b.innerHTML = `<span class="chev">‹</span><span class="blabel">${esc(back.label)}</span>`; b.onclick = () => { location.hash = back.href; }; }
  }
  const crumbHome = {label: 'Customers', href: P.home()};
  const setBarH = () => document.documentElement.style.setProperty('--appbar-h', $('.appbar').offsetHeight + 'px');
  if (window.ResizeObserver) new ResizeObserver(setBarH).observe($('.appbar')); else window.addEventListener('resize', setBarH);

  /* ---------- router ---------- */
  async function route() {
    await flushSave();
    urls.forEach(u => URL.revokeObjectURL(u)); urls = [];
    const h = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
    window.scrollTo(0, 0);
    try {
      if (h[0] === 'c' && h[1] && h[2] === 'j' && h[3] && h[4] === 'f' && h[5]) await renderForm(h[1], h[3], h[5]);
      else if (h[0] === 'c' && h[1] && h[2] === 'j' && h[3]) await renderJob(h[1], h[3]);
      else if (h[0] === 'c' && h[1]) await renderCustomer(h[1]);
      else await renderHome();
    } catch (e) { console.error(e); view.innerHTML = `<div class="card"><h2>Something went wrong</h2><p>${esc(e.message)}</p><a class="btn" href="#/">Customers</a></div>`; }
    view.focus({preventScroll: true});
  }
  window.addEventListener('hashchange', route);
  async function load(cid, jid) {
    const customer = await DB.get('customers', cid); if (!customer) { location.hash = P.home(); return {}; }
    if (!jid) return {customer};
    const job = await DB.get('jobs', jid); if (!job || job.customerId !== cid) { location.hash = P.cust(cid); return {}; }
    return {customer, job};
  }

  /* ---------- home: customers ---------- */
  async function renderHome() {
    current = {customer: null, job: null, formKey: null};
    bar([{label: 'Customers'}], `<button class="btn ghost" id="blankBtn">Blank PDFs</button><button class="btn ghost" id="backupBtn">Backup</button><button class="btn ghost" id="restoreBtn">Restore</button>`);
    let customers = (await DB.all('customers')).sort((a, b) => (a.id === 'unassigned') - (b.id === 'unassigned') || a.name.localeCompare(b.name));
    const jobs = await DB.all('jobs'), byC = {};
    jobs.forEach(j => (byC[j.customerId] = byC[j.customerId] || []).push(j));
    customers = customers.filter(c => c.id !== 'unassigned' || (byC[c.id] || []).length);   // hide empty Unassigned
    view.innerHTML = `
      <section class="home-head">
        <div><h1>Customers</h1><p class="muted">${customers.length} customer${customers.length === 1 ? '' : 's'} · ${jobs.length} job${jobs.length === 1 ? '' : 's'} · data stays on this tablet · back up regularly</p></div>
        <button class="btn primary big" id="newCustBtn">+ New customer</button>
      </section>
      <input type="search" id="custSearch" class="search" placeholder="Search customers, contacts, phone or work order">
      <div class="joblist" id="custList">${customers.length ? customers.map(c => {
        const js = byC[c.id] || [], nd = js.filter(j => jobStatus(j) === 'draft').length, nc = js.length - nd;
        const last = js.reduce((m, j) => Math.max(m, j.updatedAt || 0), c.updatedAt || 0);
        return `<a class="jobcard custcard ${c.id === 'unassigned' ? 'unassigned' : ''}" href="${P.cust(c.id)}" data-search="${esc([c.name, c.contact, c.phone, c.email, ...js.map(j => j.wo)].join(' ').toLowerCase())}">
          <div class="jc-main"><div class="jc-wo">${esc(c.name)}</div><div class="jc-cust muted">${esc([c.contact, c.phone].filter(Boolean).join(' · ') || ' ')}</div>
          <div class="jc-forms">${nd ? `<span class="formtag">${nd} ${badge('draft')}</span>` : ''}${nc ? `<span class="formtag">${nc} ${badge('completed')}</span>` : ''}</div></div>
          <div class="jc-side"><div class="jobcount">${js.length} job${js.length === 1 ? '' : 's'}</div><div class="muted small">Updated ${esc(fmtDay(last))}</div></div></a>`;
      }).join('') : `<div class="empty"><p>No customers yet.</p><p class="muted">Tap <b>New customer</b>, then add jobs to the customer's file.</p></div>`}</div>
      <p class="muted small center" id="storageInfo"></p>`;
    $('#newCustBtn').onclick = async () => { const c = await editCustomer(null); if (c) location.hash = P.cust(c.id); };
    $('#blankBtn').onclick = blankPdfs; $('#backupBtn').onclick = backup; $('#restoreBtn').onclick = () => $('#fileRestore').click();
    const s = $('#custSearch'); s.oninput = () => { const q = s.value.toLowerCase().trim(); $$('.custcard').forEach(c => c.hidden = !c.dataset.search.includes(q)); };
    if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(async e => {
      const persisted = navigator.storage.persisted ? await navigator.storage.persisted() : false;
      const el = $('#storageInfo'); if (el) el.textContent = `Storage used: ${(e.usage / 1048576).toFixed(1)} MB${e.quota ? ' of ~' + (e.quota / 1073741824).toFixed(1) + ' GB' : ''} · ${persisted ? 'persistent storage granted' : 'storage not marked persistent (back up regularly)'}`;
    });
  }
  function blankPdfs() {
    modal(`<h2>Blank PDF forms</h2><p class="muted">Fillable PDFs, the same templates the app fills in.</p>
      <ul class="linklist">${FORMS.forms.map(f => `<li><a class="btn" href="${esc(f.template)}" download>${esc(f.title)}</a> <span class="muted small">${esc(f.docTitle)}</span></li>`).join('')}</ul>`,
      [{label: 'Close', value: 'cancel'}], {noFocus: true});
  }
  async function editCustomer(c) {
    const isNew = !c; c = c || {id: DB.uid(), name: '', contact: '', phone: '', email: '', address: '', notes: '', createdAt: Date.now()};
    const v = await modal(`<h2>${isNew ? 'New customer' : 'Edit customer'}</h2>
      <label class="fld"><span>Customer name *</span><input name="name" required autocomplete="off" value="${esc(c.name)}"></label>
      <div class="grid2"><label class="fld"><span>Contact name</span><input name="contact" autocomplete="off" value="${esc(c.contact)}"></label>
      <label class="fld"><span>Phone</span><input name="phone" type="tel" inputmode="tel" autocomplete="off" value="${esc(c.phone)}"></label></div>
      <label class="fld"><span>Email</span><input name="email" type="email" inputmode="email" autocomplete="off" value="${esc(c.email)}"></label>
      <label class="fld"><span>Address</span><textarea name="address" rows="2">${esc(c.address)}</textarea></label>
      <label class="fld"><span>Notes</span><textarea name="notes" rows="3">${esc(c.notes)}</textarea></label>`,
      [{label: 'Cancel', value: 'cancel'}, {label: isNew ? 'Create customer' : 'Save', value: 'ok', cls: 'primary'}]);
    if (v !== 'ok') return null;
    const f = $('#dlgForm'); for (const k of ['name', 'contact', 'phone', 'email', 'address', 'notes']) c[k] = f[k].value.trim();
    await saveCustomer(c);
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    toast(isNew ? 'Customer created' : 'Customer saved');
    return c;
  }

  /* ---------- customer file ---------- */
  async function renderCustomer(cid) {
    const {customer} = await load(cid); if (!customer) return;
    current = {customer, job: null, formKey: null};
    bar([crumbHome, {label: customer.name}], `<button class="btn ghost" id="editCustBtn">Edit</button><button class="btn ghost" id="delCustBtn">Delete customer</button>`, {label: 'Customers', href: P.home()});
    const jobs = (await DB.byCustomer(cid)).sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.updatedAt - a.updatedAt);
    const detail = (l, v, href) => v ? `<div><div class="muted small">${l}</div><div>${href ? `<a href="${esc(href)}">${esc(v)}</a>` : esc(v).replace(/\n/g, '<br>')}</div></div>` : '';
    view.innerHTML = `
      <section class="card custfile">
        <div class="card-head"><h1>${esc(customer.name)}</h1><span class="muted small right">Customer file · ${jobs.length} job${jobs.length === 1 ? '' : 's'}</span></div>
        <div class="details">${detail('Contact', customer.contact)}${detail('Phone', customer.phone, customer.phone && 'tel:' + customer.phone)}${detail('Email', customer.email, customer.email && 'mailto:' + customer.email)}${detail('Address', customer.address)}${detail('Notes', customer.notes)}
          ${[customer.contact, customer.phone, customer.email, customer.address, customer.notes].some(Boolean) ? '' : '<p class="muted">No contact details yet. Tap <b>Edit</b> to add them.</p>'}</div>
      </section>
      <section class="home-head"><div><h2>Jobs</h2></div><button class="btn primary big" id="newJobBtn">+ New job</button></section>
      <div class="joblist">${jobs.length ? jobs.map(j => `
        <a class="jobcard" href="${P.job(cid, j.id)}">
          <div class="jc-main"><div class="jc-wo">WO ${esc(j.wo || '—')}</div><div class="jc-cust">${esc([j.manufacturer, j.model].filter(Boolean).join(' ') || 'Gearbox')}${j.serial ? ` <span class="muted small">S/N ${esc(j.serial)}</span>` : ''}${j.legacyCustomer ? ` <span class="muted small">(was: ${esc(j.legacyCustomer)})</span>` : ''}</div>
          <div class="jc-forms">${formStates(j).map(f => `<span class="formtag">${esc(f.title)} ${badge(j.forms[f.key].status)}</span>`).join('')}</div></div>
          <div class="jc-side">${badge(jobStatus(j))}<div class="muted small">${esc(j.date ? fmtDay(j.date + 'T12:00') : '')}</div></div></a>`).join('')
        : `<div class="empty"><p>No jobs for this customer yet.</p><p class="muted">Tap <b>New job</b> to start an assembly verification or teardown evaluation.</p></div>`}</div>`;
    $('#newJobBtn').onclick = () => newJob(customer);
    $('#editCustBtn').onclick = async () => { if (await editCustomer(customer)) renderCustomer(cid); };
    $('#delCustBtn').onclick = async () => {
      let np = 0, nd = 0; for (const j of jobs) { np += (await DB.byJob('photos', j.id)).length; nd += (await DB.byJob('docs', j.id)).length; }
      if (!await confirmBox('Delete customer?', `This permanently deletes <b>${esc(customer.name)}</b> and <b>all of their jobs (${jobs.length}), photos (${np}) and saved PDFs (${nd})</b> from this device. This cannot be undone. Consider a backup first.`, 'Delete customer and all jobs', true)) return;
      await DB.deleteCustomer(cid); toast('Customer deleted'); location.hash = P.home();
    };
  }
  async function newJob(customer) {
    const v = await modal(`<h2>New job for ${esc(customer.name)}</h2>
      <div class="grid2"><label class="fld"><span>Work order number *</span><input name="wo" required autocomplete="off"></label>
      <label class="fld"><span>Date</span><input name="date" type="date" value="${today()}"></label></div>
      <div class="row cols3"><label class="fld"><span>Gearbox manufacturer</span><input name="manufacturer" autocomplete="off"></label>
      <label class="fld"><span>Model</span><input name="model" autocomplete="off"></label>
      <label class="fld"><span>Serial number</span><input name="serial" autocomplete="off"></label></div>
      <fieldset class="fld"><legend>Forms</legend>${FORMS.forms.map(f => `<label class="chk inline"><input type="checkbox" name="form_${f.key}" checked><span class="box"></span><span>${esc(f.title)}</span></label>`).join('')}</fieldset>`,
      [{label: 'Cancel', value: 'cancel'}, {label: 'Create job', value: 'ok', cls: 'primary'}], {wide: true});
    if (v !== 'ok') return;
    const f = $('#dlgForm');
    const job = {id: DB.uid(), customerId: customer.id, wo: f.wo.value.trim(), date: f.date.value, manufacturer: f.manufacturer.value.trim(),
                 model: f.model.value.trim(), serial: f.serial.value.trim(), createdAt: Date.now(), updatedAt: Date.now(), forms: {}};
    for (const fm of FORMS.forms) if (f['form_' + fm.key].checked) job.forms[fm.key] = newFormState();
    await saveJob(job); await saveCustomer(customer);
    location.hash = P.job(customer.id, job.id);
  }

  /* ---------- job folder ---------- */
  async function renderJob(cid, jid) {
    const {customer, job} = await load(cid, jid); if (!job) return;
    current = {customer, job, formKey: null};
    bar([crumbHome, {label: customer.name, href: P.cust(cid)}, {label: `WO ${job.wo}`}], `<button class="btn ghost" id="delJobBtn">Delete job</button>`, {label: customer.name, href: P.cust(cid)});
    const docs = (await DB.byJob('docs', jid)).sort((a, b) => b.createdAt - a.createdAt);
    const customers = (await DB.all('customers')).sort((a, b) => a.name.localeCompare(b.name));
    const jf = (k, label, type = 'text') => `<label class="fld"><span>${label}</span><input data-job="${k}" type="${type}" value="${esc(job[k] || '')}" autocomplete="off"></label>`;
    view.innerHTML = `
      <section class="card">
        <div class="card-head"><h2>Job folder</h2>${badge(jobStatus(job))}<span class="muted small right" id="saveInd"></span></div>
        <div class="row cols2">${jf('wo', 'Work order number')}${jf('date', 'Date', 'date')}</div>
        <div class="row cols3" style="margin-top:12px">${jf('manufacturer', 'Gearbox manufacturer')}${jf('model', 'Model')}${jf('serial', 'Serial number')}</div>
        <div class="row cols2" style="margin-top:12px"><label class="fld"><span>Customer</span><select id="moveCust">${customers.map(c => `<option value="${esc(c.id)}" ${c.id === cid ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
          ${job.legacyCustomer ? `<div class="muted small" style="align-self:end">Customer name on this job before upgrade: <b>${esc(job.legacyCustomer)}</b></div>` : ''}</div>
        <p class="muted small">Customer name, work order, manufacturer, model and serial fill in automatically on both forms.</p>
      </section>
      <section class="card">
        <div class="card-head"><h2>Forms</h2></div>
        <div class="formlist">${FORMS.forms.map(f => {
          const st = job.forms[f.key];
          if (!st || !st.enabled) return `<div class="formrow off"><div><b>${esc(f.title)}</b><div class="muted small">${esc(f.docTitle)}</div></div><button class="btn" data-addform="${f.key}">+ Add form</button></div>`;
          const p = progress(job, f.key);
          return `<div class="formrow" data-formrow="${f.key}"><div class="fr-main"><div><b>${esc(f.title)}</b> ${badge(st.status)} <span class="muted small">rev ${st.revision}</span></div>
              <div class="muted small">${esc(f.docTitle)}</div>
              <div class="bar"><i style="width:${p.total ? Math.round(100 * p.done / p.total) : 0}%"></i></div>
              <div class="muted small">${p.done} of ${p.total} required items complete${st.status === 'completed' ? ` · completed ${esc(fmtDate(st.completedAt))} by ${esc(st.signedBy)}` : ''}</div></div>
            <div class="fr-actions"><button class="btn" data-export="${f.key}">${st.status === 'completed' ? 'Share final PDF' : 'Export PDF'}</button><a class="btn primary" href="${P.form(cid, jid, f.key)}">${st.status === 'completed' ? 'View' : 'Open'}</a></div></div>`;
        }).join('')}</div>
      </section>
      <section class="card">
        <div class="card-head"><h2>Job photos</h2><span class="muted small">Included on the photo pages of every form export</span></div>
        ${photoPanel('job', 'Job photo', false)}
      </section>
      <section class="card">
        <div class="card-head"><h2>Saved documents</h2><span class="muted small">Final PDFs created when a form is finalized · all revisions kept</span></div>
        ${docs.length ? `<div class="doclist">${docs.map(d => `<div class="docrow"><div><b>${esc(d.filename)}</b><div class="muted small">${esc((FORM_BY_KEY[d.formKey] || {}).title || d.formKey)} · revision ${d.revision} · ${esc(fmtDate(d.createdAt))} · signed by ${esc(d.signedBy)} · ${d.pages} pages · ${(d.size / 1024).toFixed(0)} KB</div></div>
          <div class="fr-actions"><button class="btn" data-docview="${d.id}">View</button><button class="btn" data-docprint="${d.id}">Print</button><button class="btn primary" data-docshare="${d.id}">Share</button></div></div>`).join('')}</div>`
          : '<p class="muted">No saved documents yet. Finalize a form to save its PDF here.</p>'}
      </section>
      <section class="card">
        <div class="card-head"><h2>Export job folder</h2></div>
        <p class="muted small">Zip: every saved final PDF (all revisions), all photos (stored copies, max 1600 px) with captions, a job summary, and the combined PDF. Combined PDF: the latest final of each form (or a flattened draft if not finalized yet) in one file.</p>
        <div class="fr-actions" style="justify-content:flex-start"><button class="btn primary" id="zipBtn">Export zip</button><button class="btn" id="combinedBtn">Combined PDF</button></div>
      </section>`;
    $$('[data-job]').forEach(i => i.oninput = () => { job[i.dataset.job] = i.value; scheduleSave(); });
    $('#moveCust').onchange = async e => {
      const to = customers.find(c => c.id === e.target.value);
      if (!await confirmBox('Move job?', `Move WO ${esc(job.wo)} with its forms, photos and saved PDFs to <b>${esc(to.name)}</b>? Finalized PDFs keep the customer name they were signed with.`, 'Move job')) { e.target.value = cid; return; }
      job.customerId = to.id; if (to.id !== 'unassigned') delete job.legacyCustomer;
      await saveJob(job); toast('Job moved'); location.hash = P.job(to.id, job.id);
    };
    $('#delJobBtn').onclick = async () => {
      if (!await confirmBox('Delete job?', `This permanently deletes <b>WO ${esc(job.wo)}</b> for ${esc(customer.name)} from this device, including all form data, photos and saved PDFs. This cannot be undone. Consider a backup first.`, 'Delete job', true)) return;
      clearTimeout(saveTimer); saveTimer = null;
      await DB.deleteJob(job.id); toast('Job deleted'); location.hash = P.cust(cid);
    };
    $$('[data-addform]').forEach(b => b.onclick = async () => { job.forms[b.dataset.addform] = job.forms[b.dataset.addform] || newFormState(); job.forms[b.dataset.addform].enabled = true; await saveJob(job); renderJob(cid, jid); });
    $$('[data-export]').forEach(b => b.onclick = () => exportForm(job, b.dataset.export));
    const docById = i => docs.find(d => d.id === i);
    $$('[data-docview]').forEach(b => b.onclick = () => viewDoc(docById(b.dataset.docview)));
    $$('[data-docprint]').forEach(b => b.onclick = () => { const d = docById(b.dataset.docprint); printPdf(d.blob, d.filename); });
    $$('[data-docshare]').forEach(b => b.onclick = () => { const d = docById(b.dataset.docshare); shareOrDownload(d.blob, d.filename); });
    $('#zipBtn').onclick = () => exportJobZip(job, customer);
    $('#combinedBtn').onclick = async () => { const r = await combinedPdf(job, customer); if (r) fileReady(r.blob, r.filename, 'Combined job PDF ready'); };
    await fillPhotoPanels(job);
  }
  function viewDoc(d) {
    const u = objUrl(d.blob);
    const ov = document.createElement('div'); ov.className = 'viewer';
    ov.innerHTML = `<div class="viewer-bar"><b>${esc(d.filename)}</b><span class="grow"></span><button class="btn" data-a="open">Open in new tab</button><button class="btn" data-a="print">Print</button><button class="btn" data-a="share">Share</button><button class="btn primary" data-a="close">Close</button></div><iframe src="${u}" title="PDF preview"></iframe>`;
    document.body.appendChild(ov);
    ov.onclick = e => { const a = e.target.dataset && e.target.dataset.a; if (!a) return;
      if (a === 'close') ov.remove(); else if (a === 'open') openBlob(d.blob); else if (a === 'print') printPdf(d.blob, d.filename); else if (a === 'share') shareOrDownload(d.blob, d.filename); };
  }

  /* ---------- photos ---------- */
  function photoPanel(scope, label, locked) {
    return `<div class="photos" data-scope="${esc(scope)}" data-label="${esc(label)}" ${locked ? 'data-locked="1"' : ''}>
      ${locked ? '' : `<div class="photo-btns"><label class="btn cam" for="fileCamera" data-scope="${esc(scope)}" data-label="${esc(label)}">📷 Take photo</label><label class="btn" for="fileGallery" data-scope="${esc(scope)}" data-label="${esc(label)}">🖼 Choose from gallery</label></div>`}
      <div class="thumbs"></div></div>`;
  }
  async function fillPhotoPanels(job) {
    const photos = (await DB.byJob('photos', job.id)).sort((a, b) => a.createdAt - b.createdAt);
    for (const panel of $$('.photos')) {
      const list = photos.filter(p => p.scope === panel.dataset.scope), locked = !!panel.dataset.locked;
      $('.thumbs', panel).innerHTML = list.map(p => `<figure class="thumb" data-id="${p.id}"><img src="${objUrl(p.thumb || p.blob)}" alt="${esc(p.caption || 'photo')}" data-full="${p.id}">
        ${locked ? `<figcaption>${esc(p.caption)}</figcaption>` : `<input class="cap" placeholder="Caption" value="${esc(p.caption)}" data-cap="${p.id}"><button class="del" data-delphoto="${p.id}" aria-label="Delete photo">✕</button>`}</figure>`).join('')
        || (locked ? '<p class="muted small">No photos.</p>' : '');
      const summary = panel.closest('details') && $('.pcount', panel.closest('details')); if (summary) summary.textContent = list.length ? `(${list.length})` : '';
    }
    view.onclick = viewClick(photos);
  }
  function viewClick(photos) {
    return async e => {
      const t = e.target;
      if (t.matches('label[for="fileCamera"],label[for="fileGallery"]')) { pendingPhoto = {jobId: current.job.id, scope: t.dataset.scope, label: t.dataset.label}; return; }
      if (t.dataset.full) { const p = photos.find(x => x.id === t.dataset.full) || await DB.get('photos', t.dataset.full); if (p) modal(`<img class="full" src="${objUrl(p.blob)}" alt=""><p>${esc(p.caption || '')}</p><p class="muted small">${esc(p.label)} · ${p.w}×${p.h}</p>`, [{label: 'Close', value: 'cancel'}], {wide: true, noFocus: true}); return; }
      if (t.dataset.delphoto) {
        if (!await confirmBox('Delete photo?', 'This photo will be removed from the job.', 'Delete', true)) return;
        await DB.del('photos', t.dataset.delphoto); t.closest('.thumb').remove(); toast('Photo deleted'); return;
      }
    };
  }
  document.addEventListener('change', async e => {
    if (e.target.dataset && e.target.dataset.cap) {
      const p = await DB.get('photos', e.target.dataset.cap); if (p) { p.caption = e.target.value; await DB.put('photos', p); toast('Caption saved', 1200); }
    }
  });
  async function onFiles(input) {
    const files = Array.from(input.files || []); input.value = '';
    if (!files.length || !pendingPhoto) return;
    const target = pendingPhoto; toast(`Processing ${files.length} photo${files.length > 1 ? 's' : ''}…`, 5000);
    let n = 0;
    for (const f of files) {
      try {
        const c = await Photos.compress(f);
        await DB.put('photos', {id: DB.uid(), jobId: target.jobId, scope: target.scope, label: target.label, caption: '', blob: c.blob, thumb: c.thumb, w: c.w, h: c.h, createdAt: Date.now()});
        n++;
      } catch (err) { console.error(err); toast('Could not read one image: ' + err.message, 4000); }
    }
    if (current.job) { current.job.updatedAt = Date.now(); await DB.put('jobs', current.job); await fillPhotoPanels(current.job); }
    if (n) toast(`${n} photo${n > 1 ? 's' : ''} added`);
  }
  $('#fileCamera').addEventListener('change', e => onFiles(e.target));
  $('#fileGallery').addEventListener('change', e => onFiles(e.target));

  /* ---------- form rendering ---------- */
  function reqAttr(b) { return b.req ? `data-req="${esc(b.req.id)}"` : ''; }
  function naBtn(b, locked) { return b.req && !locked ? `<button type="button" class="na-btn" data-na="${esc(b.req.id)}" title="Mark not applicable">N/A</button>` : ''; }
  function input(f, val, opts = {}) {
    const n = esc(f.name), dis = opts.locked ? 'disabled' : '', link = f.link ? `data-link="${f.link}"` : '';
    const ro = f.link === 'customer' ? 'readonly title="Edit the name in the customer file"' : '';
    if (f.multiline) return `<textarea data-name="${n}" ${link} rows="${f.rows || 3}" ${dis} aria-label="${esc(f.label || '')}">${esc(val)}</textarea>`;
    const type = f.input === 'date' ? 'date' : 'text';
    return `<input type="${type}" data-name="${n}" ${link} ${ro} value="${esc(val)}" ${dis} autocomplete="off" aria-label="${esc(f.label || opts.aria || '')}">`;
  }
  function renderBlock(job, key, b, locked) {
    const v = n => getVal(job, key, n) || '', chk = n => job.forms[key].values[n] ? 'checked' : '', dis = locked ? 'disabled' : '';
    const fieldBox = f => `<label class="fld"><span>${esc(f.label)}${f.link ? ' <i class="auto">auto-filled from job</i>' : ''}</span><div class="with-suffix">${input(f, v(f.name), {locked})}${f.suffix ? `<em>${esc(f.suffix)}</em>` : ''}</div></label>`;
    const cbox = (name, label, cls = '') => `<label class="chk ${cls}"><input type="checkbox" data-name="${esc(name)}" ${chk(name)} ${dis}><span class="box"></span><span class="txt">${esc(label)}</span></label>`;
    switch (b.type) {
      case 'subhead': return `<h4 class="subhead">${esc(b.text)}</h4>`;
      case 'field': return `<div class="blk" ${reqAttr(b)}>${fieldBox(b)}${naBtn(b, locked)}</div>`;
      case 'row': return `<div class="blk" ${reqAttr(b)}><div class="row cols${b.fields.length}">${b.fields.map(fieldBox).join('')}</div>${naBtn(b, locked)}</div>`;
      case 'check': return `<div class="blk item" ${reqAttr(b)}><div class="item-line">${cbox(b.name, b.label)}${naBtn(b, locked)}</div>
          ${b.fields.length ? `<div class="row sub cols${b.fields.length}">${b.fields.map(f => `<label class="fld"><span>${esc(f.label)}</span>${input(f, v(f.name), {locked})}</label>`).join('')}</div>` : ''}
          ${b.notes ? `<label class="fld sub"><span>Notes</span>${input({name: b.notes, label: 'Notes'}, v(b.notes), {locked})}</label>` : ''}</div>`;
      case 'choice': return `<div class="blk item" ${reqAttr(b)}><div class="item-line">${b.label ? `<span class="choice-label">${esc(b.label)}</span>` : ''}${naBtn(b, locked)}</div>
          <div class="choices ${b.exclusive ? 'seg' : ''}" ${b.exclusive ? 'data-exclusive="1"' : ''}>${b.options.map(o => cbox(o.name, o.label, 'pill') + (o.text ? `<input class="other-text" type="text" data-name="${esc(o.text)}" value="${esc(v(o.text))}" placeholder="Specify" ${dis}>` : '')).join('')}</div>
          ${b.notes ? `<label class="fld sub"><span>Notes</span>${input({name: b.notes, label: 'Notes'}, v(b.notes), {locked})}</label>` : ''}</div>`;
      case 'table': return `<div class="blk tablewrap"><h4 class="subhead">${esc(b.title)}</h4><table class="tbl"><thead><tr>${b.columns.map(c => `<th>${esc(c)}</th>`).join('')}<th class="na-col"></th></tr></thead><tbody>
          ${b.rows.map(r => `<tr ${reqAttr(r)}>${r.label.map((l, i) => `<td class="${i ? '' : 'rowlabel'}">${esc(l)}</td>`).join('')}${r.cells.map(c => c.kind === 'check'
            ? `<td class="c">${cbox(c.name, '', 'solo')}</td>` : `<td>${input({name: c.name}, v(c.name), {locked, aria: c.name})}</td>`).join('')}<td class="na-col">${naBtn(r, locked)}</td></tr>`).join('')}</tbody></table></div>`;
      case 'component': return `<div class="blk comp" ${reqAttr(b)} id="comp-${esc(b.id)}">
          <div class="comp-head">${b.nameField ? `<label class="other-name"><span>Other:</span>${input({name: b.nameField, label: 'Other component name'}, v(b.nameField), {locked})}</label>` : `<b>${esc(b.name)}</b>`}
            <div class="choices seg" data-exclusive="1">${b.options.map(o => cbox(o.name, o.label, 'pill ' + o.label.toLowerCase())).join('')}</div>${naBtn(b, locked)}</div>
          <div class="comp-body"><div class="row cols${b.fields.length + 1}">${b.fields.map(f => `<label class="fld"><span>${esc(f.label)}</span>${input(f, v(f.name), {locked})}</label>`).join('')}</div>
            <label class="fld"><span>Findings</span>${input({name: b.findings, label: 'Findings', multiline: true, rows: 2}, v(b.findings), {locked})}</label>
            <details class="comp-photos"><summary>Photos <span class="pcount"></span></summary>${photoPanel(`${key}:${b.id}`, b.name, locked)}</details></div></div>`;
    }
    return '';
  }
  async function renderForm(cid, jid, key) {
    const {customer, job} = await load(cid, jid); if (!job) return;
    const form = FORM_BY_KEY[key];
    if (!form || !job.forms[key]) { location.hash = P.job(cid, jid); return; }
    current = {customer, job, formKey: key};
    const st = job.forms[key], locked = st.status === 'completed';
    bar([crumbHome, {label: customer.name, href: P.cust(cid)}, {label: `WO ${job.wo}`, href: P.job(cid, jid)}, {label: form.title}],
      `<span class="save-ind" id="saveInd"></span><button class="btn ghost" id="exportBtn">${locked ? 'Share final PDF' : 'Export PDF'}</button>` +
      (locked ? `<button class="btn warn" id="reopenBtn">Reopen</button>` : `<button class="btn accent" id="finalizeBtn">Finalize</button>`), {label: `WO ${job.wo}`, href: P.job(cid, jid)});
    view.innerHTML = `
      <div class="form-top">
        <div class="form-meta"><h1>${esc(form.docTitle)}</h1><div>${badge(st.status)} <span class="muted small">rev ${st.revision}</span> <span class="muted small" id="progTxt"></span></div></div>
        ${locked ? `<div class="lockbar">🔒 Completed ${esc(fmtDate(st.completedAt))}, signed by <b>${esc(st.signedBy)}</b>. This form is read-only. The final PDF is saved in the job's documents. Tap <b>Reopen</b> to start revision ${st.revision + 1}.</div>` : ''}
        ${st.history.length && !locked ? `<div class="infobar">Revision ${st.revision} (reopened). Earlier final PDFs are kept in the job's saved documents.</div>` : ''}
      </div>
      <nav class="chips">${form.sections.map(s => `<a href="#" data-jump="sec-${s.id}">${esc(/^[A-Z0-9]+\./.test(s.title) ? s.title.replace(/^([A-Z0-9]+)\.\s*/, '$1 · ') : s.title)}</a>`).join('')}<a href="#" data-jump="sec-photos-all">Photos</a></nav>
      <div class="formbody ${locked ? 'locked' : ''}" id="formBody">
        ${form.sections.map(s => `<section class="sec" id="sec-${s.id}"><h3 class="sec-title">${esc(s.title)}</h3>
          ${s.blocks.map(b => renderBlock(job, key, b, locked)).join('')}
          ${s.photos ? `<details class="sec-photos"><summary>Section photos <span class="pcount"></span></summary>${photoPanel(`${key}:${s.id}`, s.title, locked)}</details>` : ''}
        </section>`).join('')}
        <section class="sec" id="sec-photos-all"><h3 class="sec-title">Job photos</h3><p class="muted small">Job-level photos (shared by all forms of this job) are appended to the PDF along with the section and component photos above.</p>${photoPanel('job', 'Job photo', false)}</section>
      </div>`;
    const body = $('#formBody'); window.scrollTo(0, 0);
    refreshReqUI(job, key);
    $$('.chips a').forEach(a => a.onclick = e => { e.preventDefault(); jumpTo($('#' + a.dataset.jump)); });
    if (!locked) {
      body.addEventListener('input', e => onField(e, job, key));
      body.addEventListener('change', e => onField(e, job, key));
      body.addEventListener('click', e => {
        const na = e.target.dataset && e.target.dataset.na; if (!na) return;
        e.preventDefault(); toggleNA(job, key, na);
      });
      $('#finalizeBtn').onclick = () => finalize(job, key);
    } else {
      $('#reopenBtn').onclick = () => reopen(job, key);
    }
    $('#exportBtn').onclick = () => exportForm(job, key);
    await fillPhotoPanels(job);
  }
  function onField(e, job, key) {
    const t = e.target, name = t.dataset && t.dataset.name; if (!name) return;
    const st = job.forms[key];
    if (t.type === 'checkbox') {
      if (e.type !== 'change') return;
      st.values[name] = t.checked;
      const grp = t.closest('[data-exclusive]');
      if (grp && t.checked) $$('input[type=checkbox]', grp).forEach(o => { if (o !== t && o.checked) { o.checked = false; st.values[o.dataset.name] = false; } });
    } else if (t.dataset.link) {
      if (t.dataset.link === 'customer') return;   // edited in the customer file
      job[t.dataset.link] = t.value;                // job-level value shared by both forms
    } else st.values[name] = t.value;
    scheduleSave(); refreshReqUI(job, key);
  }
  function toggleNA(job, key, id) {
    const st = job.forms[key]; if (st.na[id]) delete st.na[id]; else st.na[id] = true;
    scheduleSave(); refreshReqUI(job, key);
  }
  function refreshReqUI(job, key) {
    for (const r of REQS[key]) {
      const el = document.querySelector(`[data-req="${CSS.escape(r.req.id)}"]`); if (!el) continue;
      const s = reqState(job, key, r.req);
      el.classList.toggle('is-na', s === 'na'); el.classList.toggle('is-done', s === 'done');
      if (s !== 'missing') el.classList.remove('missing');
      const nb = $('.na-btn', el); if (nb) nb.classList.toggle('on', s === 'na');
    }
    const p = progress(job, key), t = $('#progTxt'); if (t) t.textContent = `· ${p.done}/${p.total} required complete`;
    return p;
  }
  function jumpTo(el) {
    if (!el) return;
    const d = el.closest('details'); if (d) d.open = true;
    const y = el.getBoundingClientRect().top + window.scrollY - (document.querySelector('.appbar').offsetHeight + 60);
    window.scrollTo({top: y, behavior: 'smooth'});
    el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600);
    const inp = el.querySelector('input:not([type=checkbox]):not([disabled]):not([readonly]),textarea:not([disabled])');
    if (inp) setTimeout(() => inp.focus({preventScroll: true}), 400);
  }

  /* ---------- finalize / reopen ---------- */
  async function finalize(job, key) {
    await flushSave();
    const form = FORM_BY_KEY[key], st = job.forms[key];
    for (;;) {
      const p = refreshReqUI(job, key);
      $$('.missing').forEach(e => e.classList.remove('missing'));
      p.missing.forEach(m => { const el = document.querySelector(`[data-req="${CSS.escape(m.req.id)}"]`); if (el) el.classList.add('missing'); });
      if (!p.missing.length) break;
      const v = await modal(`<h2>${p.missing.length} required item${p.missing.length > 1 ? 's' : ''} incomplete</h2>
        <p class="muted">Complete each item, or mark it <b>N/A</b> if it does not apply to this job. Items are highlighted in red on the form.</p>
        <ul class="missing-list">${p.missing.map(m => `<li><div><div class="small muted">${esc(m.section)}</div>${esc(m.req.label)}</div>
          <span class="ml-actions"><button type="button" class="btn" data-mgo="${esc(m.req.id)}">Go to</button><button type="button" class="btn" data-mna="${esc(m.req.id)}">N/A</button></span></li>`).join('')}</ul>`,
        [{label: 'Close', value: 'cancel'}, {label: 'Go to first', value: 'first', cls: 'primary'}], {wide: true, noFocus: true,
          onOpen: (f, dlg) => {
            f.onclick = e => {
              const go = e.target.dataset.mgo, na = e.target.dataset.mna;
              if (go) { dlg.close('go:' + go); }
              if (na) { st.na[na] = true; scheduleSave(); refreshReqUI(job, key); e.target.closest('li').remove();
                const left = $$('.missing-list li', f).length; $('h2', f).textContent = left ? `${left} required item${left > 1 ? 's' : ''} incomplete` : 'All required items complete';
                if (!left) dlg.close('recheck'); }
            };
          }});
      if (v === 'recheck') continue;
      if (v === 'first' || v.startsWith('go:')) {
        const id = v === 'first' ? p.missing[0].req.id : v.slice(3);
        jumpTo(document.querySelector(`[data-req="${CSS.escape(id)}"]`));
      }
      return;
    }
    await flushSave();
    const suggested = (st.values[form.signedByField] || '').trim();
    const now = new Date();
    const v = await modal(`<h2>Finalize ${esc(form.title)}</h2>
      <p>All required items are complete${Object.keys(st.na).length ? ` (${Object.keys(st.na).length} marked N/A)` : ''}. Finalizing will:</p>
      <ul><li>lock this form (read-only, status <b>Completed</b>)</li><li>create a flattened final PDF (revision ${st.revision}) with photo pages</li><li>save it in this job's documents</li></ul>
      <label class="fld"><span>Signed by</span><input name="signedBy" required value="${esc(suggested)}" autocomplete="name"></label>
      <p class="muted small">Completion date: ${esc(fmtDate(now))}</p>`,
      [{label: 'Cancel', value: 'cancel'}, {label: 'Finalize & save PDF', value: 'ok', cls: 'accent'}]);
    if (v !== 'ok') return;
    const signedBy = $('#dlgForm').signedBy.value.trim() || suggested || 'Unknown';
    toast('Creating final PDF…', 8000);
    try {
      const c = ctx(job, current.customer);
      const naLabels = REQS[key].filter(r => st.na[r.req.id] && reqState(job, key, r.req) !== 'skip').map(r => `${r.section}: ${r.req.label}`);
      const out = await PdfExport.build({form, job: c, state: st, photos: await photosFor(job, key), final: {signedBy, completedAt: fmtDate(now), revision: st.revision, naLabels}});
      const blob = new Blob([out.bytes], {type: 'application/pdf'});
      const filename = PdfExport.filename(c, form, `_FINAL-rev${st.revision}`);
      const doc = {id: DB.uid(), jobId: job.id, customerId: job.customerId, formKey: key, revision: st.revision, filename, createdAt: now.getTime(), signedBy, pages: out.pages, size: blob.size, blob};
      await DB.put('docs', doc);
      Object.assign(st, {status: 'completed', completedAt: now.getTime(), signedBy, snapshot: c});
      st.history.push({revision: st.revision, completedAt: now.getTime(), signedBy, docId: doc.id});
      await saveJob(job);
      await renderForm(job.customerId, job.id, key);
      await fileReady(blob, filename, `Completed – final PDF saved (rev ${doc.revision})`);
    } catch (e) { console.error(e); modal(`<h2>PDF failed</h2><p>${esc(e.message)}</p>`, [{label: 'Close', value: 'cancel'}]); }
  }
  async function reopen(job, key) {
    const st = job.forms[key];
    const ok = await confirmBox('Reopen form?', `This unlocks the form for editing as <b>revision ${st.revision + 1}</b>. The saved final PDF for revision ${st.revision} is kept unchanged in the job documents. You will need to finalize again to produce a new final PDF.`, `Reopen as rev ${st.revision + 1}`, true);
    if (!ok) return;
    Object.assign(st, {status: 'draft', revision: st.revision + 1, reopenedAt: Date.now()});
    delete st.completedAt; delete st.signedBy; delete st.snapshot;
    await saveJob(job); toast(`Reopened as revision ${st.revision}`); renderForm(job.customerId, job.id, key);
  }

  /* ---------- export ---------- */
  function photoOrder(key) {
    const form = FORM_BY_KEY[key], order = ['job'];
    for (const s of form.sections) { order.push(`${key}:${s.id}`); for (const b of s.blocks) if (b.type === 'component') order.push(`${key}:${b.id}`); }
    return order;
  }
  async function photosFor(job, key) {
    const all = (await DB.byJob('photos', job.id)).sort((a, b) => a.createdAt - b.createdAt), out = [];
    for (const sc of photoOrder(key)) for (const p of all.filter(x => x.scope === sc)) out.push({blob: p.blob, w: p.w, h: p.h, caption: p.caption, label: sc === 'job' ? 'Job photo' : p.label});
    return out;
  }
  async function exportForm(job, key) {
    await flushSave();
    const form = FORM_BY_KEY[key], st = job.forms[key];
    if (st.status === 'completed') {
      const docs = (await DB.byJob('docs', job.id)).filter(d => d.formKey === key).sort((a, b) => b.createdAt - a.createdAt);
      if (docs[0]) return fileReady(docs[0].blob, docs[0].filename, `Final PDF (rev ${docs[0].revision})`);
    }
    toast('Building PDF…', 8000);
    try {
      const c = ctx(job, current.customer);
      const out = await PdfExport.build({form, job: c, state: st, photos: await photosFor(job, key), final: null});
      await fileReady(new Blob([out.bytes], {type: 'application/pdf'}), PdfExport.filename(c, form), 'Draft PDF ready (fields editable)');
    } catch (e) { console.error(e); modal(`<h2>PDF failed</h2><p>${esc(e.message)}</p>`, [{label: 'Close', value: 'cancel'}]); }
  }
  async function combinedPdf(job, customer) {
    await flushSave(); toast('Building combined PDF…', 10000);
    try {
      const c = ctx(job, customer), docs = await DB.byJob('docs', job.id), parts = [];
      for (const f of formStates(job)) {
        const st = job.forms[f.key];
        const fin = docs.filter(d => d.formKey === f.key).sort((a, b) => b.revision - a.revision || b.createdAt - a.createdAt)[0];
        if (st.status === 'completed' && fin) parts.push(new Uint8Array(await fin.blob.arrayBuffer()));
        else parts.push((await PdfExport.build({form: f, job: c, state: st, photos: await photosFor(job, f.key), final: null, flatten: true})).bytes);
      }
      if (!parts.length) { toast('This job has no forms'); return null; }
      const bytes = await PdfExport.combine(parts, `WO ${c.wo} - ${c.customer}`);
      return {blob: new Blob([bytes], {type: 'application/pdf'}), filename: `WO-${PdfExport.safe(c.wo)}_${PdfExport.safe(c.customer)}_Combined.pdf`, bytes};
    } catch (e) { console.error(e); modal(`<h2>PDF failed</h2><p>${esc(e.message)}</p>`, [{label: 'Close', value: 'cancel'}]); return null; }
  }
  async function exportJobZip(job, customer) {
    const c = ctx(job, customer), S = PdfExport.safe, folder = `WO-${S(c.wo)}_${S(c.customer)}`;
    const comb = await combinedPdf(job, customer); if (!comb) return;
    toast('Building zip…', 10000);
    const files = {}, store = {level: 0}, u8 = async b => new Uint8Array(await b.arrayBuffer());
    const docs = (await DB.byJob('docs', job.id)).sort((a, b) => a.createdAt - b.createdAt);
    for (const d of docs) files[`${folder}/Saved documents/${d.filename}`] = [await u8(d.blob), store];
    files[`${folder}/${comb.filename}`] = [new Uint8Array(comb.bytes), store];
    const photos = (await DB.byJob('photos', job.id)).sort((a, b) => a.createdAt - b.createdAt), capLines = [];
    let n = 0;
    for (const p of photos) {
      n++; const name = `${String(n).padStart(2, '0')}_${S(p.scope === 'job' ? 'Job' : p.label)}${p.caption ? '_' + S(p.caption) : ''}.jpg`;
      files[`${folder}/Photos/${name}`] = [await u8(p.blob), store];
      capLines.push(`${name}\t${p.scope === 'job' ? 'Job photo' : (FORM_BY_KEY[p.scope.split(':')[0]] || {}).title + ' / ' + p.label}\t${p.caption || ''}`);
    }
    const summary = [`Ram Gear job folder`, `Customer: ${c.customer}`, `Work order: ${c.wo}`, `Date: ${c.date}`, `Gearbox: ${[c.manufacturer, c.model].filter(Boolean).join(' ')}  S/N ${c.serial}`,
      customer.contact || customer.phone || customer.email ? `Contact: ${[customer.contact, customer.phone, customer.email].filter(Boolean).join(' / ')}` : '', '',
      'Forms:', ...formStates(job).map(f => { const st = job.forms[f.key]; return `  ${f.title}: ${st.status === 'completed' ? `Completed rev ${st.revision} ${fmtDate(st.completedAt)} by ${st.signedBy}` : `Draft (rev ${st.revision})`}`; }),
      '', 'Saved documents:', ...(docs.length ? docs.map(d => `  ${d.filename}  (rev ${d.revision}, ${fmtDate(d.createdAt)}, signed by ${d.signedBy})`) : ['  none']),
      '', `Photos: ${photos.length}`, '', `Exported ${new Date().toString()}`].join('\r\n');
    files[`${folder}/job-summary.txt`] = fflate.strToU8(summary);
    if (capLines.length) files[`${folder}/Photos/captions.tsv`] = fflate.strToU8('file\tsection\tcaption\r\n' + capLines.join('\r\n'));
    const zip = fflate.zipSync(files, {level: 6});
    await fileReady(new Blob([zip], {type: 'application/zip'}), `${folder}_Job.zip`, 'Job folder zip ready', false);
  }

  /* ---------- backup / restore ---------- */
  const blobToDataURL = b => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
  const dataURLToBlob = async d => (await fetch(d)).blob();
  async function backup() {
    toast('Preparing backup…', 5000);
    const customers = await DB.all('customers'), jobs = await DB.all('jobs'), photos = await DB.all('photos'), docs = await DB.all('docs');
    const data = {app: 'ramgear-jobs', version: 2, exportedAt: new Date().toISOString(), customers, jobs,
      photos: await Promise.all(photos.map(async p => ({...p, blob: await blobToDataURL(p.blob), thumb: p.thumb ? await blobToDataURL(p.thumb) : null}))),
      docs: await Promise.all(docs.map(async d => ({...d, blob: await blobToDataURL(d.blob)})))};
    const blob = new Blob([JSON.stringify(data)], {type: 'application/json'});
    const name = `ramgear-backup-${today()}.json`;
    const v = await modal(`<h2>Backup ready</h2><p>${customers.length} customers, ${jobs.length} jobs, ${photos.length} photos, ${docs.length} saved PDFs · ${(blob.size / 1048576).toFixed(1)} MB</p><p class="muted small">Save it to Files / Drive or send it to yourself. Restore it on any device with this app.</p>`,
      [{label: 'Cancel', value: 'cancel'}, {label: 'Download', value: 'dl'}, {label: 'Share', value: 'share', cls: 'primary'}]);
    if (v === 'share') shareOrDownload(blob, name); else if (v === 'dl') download(blob, name);
  }
  $('#fileRestore').addEventListener('change', async e => {
    const f = e.target.files[0]; e.target.value = ''; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (data.app !== 'ramgear-jobs' || !Array.isArray(data.jobs)) throw new Error('Not a Ram Gear backup file');
      const customers = data.customers || [];
      for (const j of data.jobs) if (DB.migrateJob(j) && !customers.some(c => c.id === 'unassigned')) customers.push(DB.unassigned());   // v1 backups
      const existing = new Set((await DB.all('jobs')).map(j => j.id)), clash = data.jobs.filter(j => existing.has(j.id)).length;
      if (!await confirmBox('Restore backup?', `${customers.length} customers, ${data.jobs.length} jobs, ${(data.photos || []).length} photos, ${(data.docs || []).length} saved PDFs from ${esc(data.exportedAt)}.${clash ? ` <b>${clash} job(s) already on this device will be replaced</b> by the backup copy.` : ''} Other customers and jobs on this device are kept.`, 'Restore')) return;
      for (const c of customers) await DB.put('customers', c);
      for (const j of data.jobs) { if (existing.has(j.id)) await DB.deleteJob(j.id); await DB.put('jobs', j); }
      for (const p of data.photos || []) await DB.put('photos', {...p, blob: await dataURLToBlob(p.blob), thumb: p.thumb ? await dataURLToBlob(p.thumb) : null});
      for (const d of data.docs || []) await DB.put('docs', {...d, blob: await dataURLToBlob(d.blob)});
      toast('Backup restored'); route();
    } catch (err) { modal(`<h2>Restore failed</h2><p>${esc(err.message)}</p>`, [{label: 'Close', value: 'cancel'}]); }
  });

  /* ---------- boot ---------- */
  async function boot() {
    FORMS = await (await fetch('forms.json')).json();
    for (const f of FORMS.forms) {
      FORM_BY_KEY[f.key] = f; KINDS[f.key] = PdfExport.fieldKinds(f); REQS[f.key] = [];
      for (const s of f.sections) for (const b of s.blocks) {
        if (b.req) REQS[f.key].push({req: b.req, section: s.title});
        if (b.type === 'table') for (const r of b.rows) if (r.req) REQS[f.key].push({req: r.req, section: s.title});
      }
    }
    window.RG = {FORMS, REQS, DB};  // for debugging/tests
    route();
  }
  boot();
})();
