/* Rev 1.8: customer card (shared with the Cardfile app). The SAME formatting as public.rg_card_title / rg_card_body in
   supabase/migrations/002_customer_cards.sql, so the card shown offline matches the one the database writes.
   title: customer name, max 39 characters (truncated; the full name stays in the customer record).
   body: plain text, one "Label: value" line per non-empty field: Contact, Phone (XXX-XXX-XXXX), Email, Address, Notes. */
const CustomerCard = (() => {
  const MAX_TITLE = 39;
  const clean = s => String(s == null ? '' : s).replace(/\r\n?/g, '\n').replace(/^[ \t\n]+|[ \t\n]+$/g, '');
  function phone(p) {   // same rule as js/phone.js format(): 10 digits (or 11 starting with 1), no letters / '#'
    const s = clean(p), d = s.replace(/\D/g, ''), ten = d.length === 11 && d[0] === '1' ? d.slice(1) : d;
    return ten.length === 10 && !/[a-z#]/i.test(s) ? `${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}` : s;
  }
  const title = c => Array.from(clean(c && c.name) || '(no name)').slice(0, MAX_TITLE).join('').replace(/[ \t\n]+$/, '');   // code points like Postgres left(), then rtrim
  function body(c) {
    c = c || {};
    return [['Contact', clean(c.contact)], ['Phone', phone(c.phone)], ['Email', clean(c.email)], ['Address', clean(c.address)], ['Notes', clean(c.notes)]]
      .filter(([, v]) => v).map(([l, v]) => `${l}: ${v}`).join('\n');
  }
  /* Card -> customer fields for "Find in card file" (defensive: Cardfile bodies may be free text).
     1) QC's own "Label: value" lines (plus common aliases); a line without a label continues the field above it
        (multi-line address / notes). Unknown labels ("Fax: ...") are kept as notes.
     2) Text before any label: the first e-mail and the first phone number found go to their fields; other lines go to
        address if they look like an address (digits, "City, ST 12345", PO Box), otherwise to notes. Nothing is dropped. */
  const LABELS = [[/^(contact|contact name|contact person|attn|attention|name)$/, 'contact'], [/^(phone|tel|telephone|ph|phone no|office|mobile|cell)$/, 'phone'],
    [/^(e-?mail|mail)$/, 'email'], [/^(address|addr|street|location|ship to|mailing address)$/, 'address'], [/^(notes?|comments?|remarks?)$/, 'notes']];
  const EMAIL = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
  const PHONE = /(?:\+?1[\s.-]*)?(?:\(\d{3}\)|\d{3})[\s.-]*\d{3}[\s.-]*\d{4}(?:\s*(?:x|ext\.?|extension|#)\s*\d{1,6})?/i;
  const ADDRESS = /\d|\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b|\bP\.?\s*O\.?\s*Box\b/i;
  function parse(t, b) {
    const out = {name: clean(t), contact: '', phone: '', email: '', address: '', notes: ''}, add = (k, v) => { v = clean(v); if (v) out[k] = out[k] ? `${out[k]}\n${v}` : v; };
    let cur = null, free = 0;
    for (const raw of clean(b).split('\n')) {
      const line = clean(raw); if (!line) continue;
      const m = /^([A-Za-z][A-Za-z .-]{0,24}?)\s*:\s*(.*)$/.exec(line), hit = m && LABELS.find(([re]) => re.test(m[1].trim().toLowerCase()));
      if (hit) {
        const k = hit[1], v = m[2];
        if (k === 'phone' || k === 'email' || k === 'contact') { if (v && !out[k]) out[k] = k === 'phone' ? phone(v) : clean(v); else if (v) add('notes', line); cur = null; }   // single-line fields; a 2nd phone etc. -> notes
        else { add(k, v); cur = k; }
        continue;
      }
      if (m && /^[A-Za-z][A-Za-z .-]{0,24}$/.test(m[1]) && !/^https?$/i.test(m[1])) { add('notes', line); cur = 'notes'; continue; }   // unknown label: keep it
      if (cur) { add(cur, line); continue; }                                                                                        // continuation line
      let rest = line;
      const e = !out.email && EMAIL.exec(rest); if (e) { out.email = e[0]; rest = rest.replace(e[0], ' '); }
      const ph = !out.phone && PHONE.exec(rest); if (ph) { out.phone = phone(ph[0]); rest = rest.replace(ph[0], ' '); }
      rest = clean(rest.replace(/\s{2,}/g, ' ').replace(/^[\s,;:|-]+|[\s,;:|-]+$/g, ''));
      if (e || ph) { if (rest && !/^(phone|tel|ph|e-?mail)\.?$/i.test(rest)) add('notes', rest); free++; continue; }
      if (!free++ && !out.contact && /^[A-Z][A-Za-z'.-]+(?:\s+[A-Z][A-Za-z'.-]+){1,3}$/.test(line)) { out.contact = line; continue; }   // "Bob Smith" on the first line
      add(!EMAIL.test(line) && !PHONE.test(line) && ADDRESS.test(line) ? 'address' : 'notes', line);
    }
    return out;
  }
  return {MAX_TITLE, clean, phone, title, body, parse, format: c => ({title: title(c), body: body(c)})};
})();
self.CustomerCard = CustomerCard;
