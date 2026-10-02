/* US phone numbers, shown and typed as XXX-XXX-XXXX (Rev 1.5.3).
   Typing: digits only, max 10; a pasted "+1 (555) 123-4567" becomes 555-123-4567.
   Display: a stored value with 10 digits (or 11 starting with 1) is shown formatted; anything else (extension,
   foreign number) is shown exactly as stored, so no data is lost. */
const Phone = (() => {
  const digits = s => String(s == null ? '' : s).replace(/\D/g, '');
  const ten = s => { const d = digits(s); return d.length === 11 && d[0] === '1' ? d.slice(1) : d; };
  const group = d => d.length <= 3 ? d : d.length <= 6 ? `${d.slice(0, 3)}-${d.slice(3)}` : `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  const typing = s => group(ten(s).slice(0, 10));                       // progressive format while typing
  const conforming = s => ten(s).length === 10 && !/[a-z#]/i.test(String(s));   // "ext 12" / "x12" stays as stored
  const format = s => { const v = String(s == null ? '' : s).trim(); return conforming(v) ? group(ten(v)) : v; };
  const href = s => { const d = ten(s); return d.length === 10 ? `tel:+1${d}` : `tel:${String(s).replace(/[^\d+]/g, '')}`; };
  /* live formatting on an <input> (no maxlength: it would cut a pasted "+1 (555) 123-4567" before it is cleaned up): keeps the caret after the same number of digits; Backspace/Delete next to a dash
     removes the digit beyond it (otherwise the dash would come straight back and the caret would be stuck) */
  function attach(el) {
    el.setAttribute('inputmode', 'tel'); el.setAttribute('placeholder', 'XXX-XXX-XXXX');
    const apply = caretDigits => {
      const v = typing(el.value); el.value = v;
      let pos = v.length;
      if (caretDigits != null) { let n = 0; pos = 0; while (pos < v.length && n < caretDigits) { if (/\d/.test(v[pos])) n++; pos++; } }
      if (document.activeElement === el) try { el.setSelectionRange(pos, pos); } catch (e) {}
    };
    const digitsBefore = (v, i) => digits(v.slice(0, i)).length;
    el.addEventListener('beforeinput', e => {
      const s = el.selectionStart, t = el.selectionEnd, v = el.value;
      if (s !== t || s == null) return;
      if (e.inputType === 'deleteContentBackward' && s > 0 && v[s - 1] === '-') {
        e.preventDefault(); const k = digitsBefore(v, s); if (!k) return;
        const d = digits(v); el.value = d.slice(0, k - 1) + d.slice(k); apply(k - 1); el.dispatchEvent(new Event('input', {bubbles: true}));
      } else if (e.inputType === 'deleteContentForward' && v[s] === '-') {
        e.preventDefault(); const k = digitsBefore(v, s), d = digits(v); if (k >= d.length) return;
        el.value = d.slice(0, k) + d.slice(k + 1); apply(k); el.dispatchEvent(new Event('input', {bubbles: true}));
      }
    });
    el.addEventListener('input', () => {
      if (el.value === typing(el.value)) return;               // already formatted (also our own re-dispatch)
      const s = el.selectionStart == null ? el.value.length : el.selectionStart;
      const raw = el.value.slice(0, s), d = digits(el.value);
      let k = digits(raw).length;
      if (d.length === 11 && d[0] === '1') k = Math.max(0, k - 1);   // pasted +1 country code dropped
      apply(Math.min(k, 10));
    });
  }
  return {digits, typing, format, href, attach, conforming};
})();
self.Phone = Phone;
