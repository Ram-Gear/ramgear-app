/* In-app camera (getUserMedia): live preview, shutter, switch camera, review (retake / use + caption), multi-shot.
   Works on Windows/macOS/ChromeOS browsers where <input capture> is ignored, plus iOS Safari and Android Chrome. */
const Camera = (() => {
  let ov = null, video = null, stream = null, devices = [], curDevice = null, opts = null, saved = 0, shotBlob = null, shotUrl = null;
  const supported = () => !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia) && window.isSecureContext !== false;
  const $ = s => ov.querySelector(s);
  const RES = {width: {ideal: 1920}, height: {ideal: 1080}};

  function stopTracks() {
    if (stream) stream.getTracks().forEach(t => t.stop());
    stream = null; if (video) video.srcObject = null;
  }
  async function start(deviceId) {
    stopTracks();
    const tries = deviceId
      ? [{video: {...RES, deviceId: {exact: deviceId}}}]
      : [{video: {...RES, facingMode: {ideal: 'environment'}}}, {video: RES}, {video: true}];   // prefer rear camera, then any camera
    let lastErr = null;
    for (const c of tries) {
      try { stream = await navigator.mediaDevices.getUserMedia({...c, audio: false}); break; }
      catch (e) { lastErr = e; if (e.name === 'NotAllowedError' || e.name === 'SecurityError') throw e; }
    }
    if (!stream) throw lastErr || new Error('No camera');
    video.srcObject = stream;
    if (!video.videoWidth) await new Promise(r => { video.onloadedmetadata = r; setTimeout(r, 4000); });
    await video.play().catch(() => {});
    const track = stream.getVideoTracks()[0], st = track && track.getSettings ? track.getSettings() : {};
    curDevice = st.deviceId || deviceId || null;
    try { devices = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'videoinput'); } catch (e) { devices = []; }
    $('.cam-switch').hidden = devices.length < 2;
    $('.cam-res').textContent = `${video.videoWidth}×${video.videoHeight}`;
    // mirror a front ("user") camera preview so it feels natural; captured image is not mirrored
    video.classList.toggle('mirror', st.facingMode === 'user');
  }
  function setMode(mode) { ov.dataset.mode = mode; }
  async function capture() {
    if (!video.videoWidth) return;
    const c = document.createElement('canvas'); c.width = video.videoWidth; c.height = video.videoHeight;
    c.getContext('2d').drawImage(video, 0, 0, c.width, c.height);
    shotBlob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
    if (shotUrl) URL.revokeObjectURL(shotUrl); shotUrl = URL.createObjectURL(shotBlob);
    $('.cam-review img').src = shotUrl; $('.cam-caption').value = '';
    setMode('review'); video.pause();
  }
  function retake() { shotBlob = null; setMode('live'); video.play().catch(() => {}); }
  async function use() {
    if (!shotBlob) return;
    const btn = $('.cam-use'); btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const thumb = await opts.onUse(shotBlob, $('.cam-caption').value.trim());
      saved++; $('.cam-count').textContent = `${saved} saved`;
      if (thumb) { const im = document.createElement('img'); im.src = URL.createObjectURL(thumb); $('.cam-strip').appendChild(im); }
    } catch (e) { alert('Could not save photo: ' + e.message); }
    btn.disabled = false; btn.textContent = 'Use photo';
    retake();
  }
  async function switchCam() {
    if (devices.length < 2) return;
    const i = devices.findIndex(d => d.deviceId === curDevice), next = devices[(i + 1) % devices.length];
    try { await start(next.deviceId); } catch (e) { await start().catch(() => {}); }
  }
  function close() {
    stopTracks();
    if (shotUrl) URL.revokeObjectURL(shotUrl); shotUrl = null; shotBlob = null;
    if (ov) { ov.querySelectorAll('.cam-strip img').forEach(i => URL.revokeObjectURL(i.src)); ov.remove(); }
    ov = null; video = null;
    document.removeEventListener('keydown', onKey, true);
    window.removeEventListener('hashchange', close); window.removeEventListener('pagehide', close);
    const o = opts; opts = null; if (o && o.onClose) o.onClose(saved);
  }
  function onKey(e) {
    if (!ov) return;
    if (e.key === 'Escape') { e.preventDefault(); ov.dataset.mode === 'review' ? retake() : close(); }
    else if ((e.key === ' ' || e.key === 'Enter') && ov.dataset.mode === 'live' && e.target.tagName !== 'INPUT') { e.preventDefault(); capture(); }
  }
  /* o: {title, captionList (datalist id, optional), onUse(blob, caption) -> Promise<thumbBlob>, onClose(savedCount), onUnavailable(error)} */
  async function open(o) {
    if (ov) close();
    opts = o; saved = 0;
    if (!supported()) { const e = new Error('Camera API not available in this browser'); e.name = 'NotSupportedError'; opts = null; return o.onUnavailable(e); }
    ov = document.createElement('div'); ov.className = 'camera'; ov.dataset.mode = 'starting';
    ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-label', 'Camera');
    ov.innerHTML = `
      <div class="cam-top"><button type="button" class="btn cam-close">✕ Done</button><div class="cam-title"></div><span class="cam-count">0 saved</span><span class="cam-res"></span>
        <button type="button" class="btn cam-switch" hidden aria-label="Switch camera">⟲ Switch camera</button></div>
      <div class="cam-stage"><video playsinline muted autoplay></video><div class="cam-msg">Starting camera…</div>
        <div class="cam-review"><img alt="Captured photo"></div></div>
      <div class="cam-bottom">
        <div class="cam-live-ctl"><div class="cam-strip"></div><button type="button" class="cam-shutter" aria-label="Take photo"></button><div class="cam-spacer"></div></div>
        <div class="cam-review-ctl"><input class="cam-caption" placeholder="Caption (optional)" autocomplete="off"><button type="button" class="btn cam-retake">↺ Retake</button><button type="button" class="btn primary cam-use">Use photo</button></div>
      </div>`;
    $('.cam-title').textContent = o.title || 'Camera';
    if (o.captionList) { const ci = $('.cam-caption'); ci.setAttribute('list', o.captionList); ci.placeholder = 'Caption, e.g. As received, Disassembled'; ci.maxLength = 120; }   // Rev 1.6: teardown photo suggestions
    video = $('video'); video.muted = true; video.setAttribute('playsinline', ''); video.setAttribute('webkit-playsinline', '');
    document.body.appendChild(ov);
    $('.cam-close').onclick = close; $('.cam-shutter').onclick = capture; $('.cam-retake').onclick = retake; $('.cam-use').onclick = use; $('.cam-switch').onclick = switchCam;
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('hashchange', close); window.addEventListener('pagehide', close);
    try { await start(); setMode('live'); }
    catch (e) { const cb = o.onUnavailable; close(); cb(e); }
  }
  return {open, close, supported, isOpen: () => !!ov};
})();
