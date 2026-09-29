/* Client-side photo compression: max 1600px long edge, JPEG 0.8. */
const Photos = (() => {
  const MAX = 1600, Q = 0.8;
  async function decode(file) {
    if (window.createImageBitmap) {
      try { return await createImageBitmap(file, {imageOrientation: 'from-image'}); } catch (e) { /* fall back */ }
    }
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => { res(img); setTimeout(() => URL.revokeObjectURL(url), 1000); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Could not read image')); };
      img.src = url;
    });
  }
  async function compress(file) {
    const img = await decode(file);
    const w0 = img.width || img.naturalWidth, h0 = img.height || img.naturalHeight;
    const k = Math.min(1, MAX / Math.max(w0, h0));
    const w = Math.round(w0 * k), h = Math.round(h0 * k);
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
    if (img.close) img.close();
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', Q));
    const tc = document.createElement('canvas'), tk = Math.min(1, 320 / Math.max(w, h));
    tc.width = Math.round(w * tk); tc.height = Math.round(h * tk);
    tc.getContext('2d').drawImage(c, 0, 0, tc.width, tc.height);
    const thumb = await new Promise(r => tc.toBlob(r, 'image/jpeg', 0.7));
    return {blob, thumb, w, h};
  }
  return {compress};
})();
