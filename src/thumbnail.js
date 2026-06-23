import { projects, thumbTargetIdx, setThumbTargetIdx } from './state.js';
import { open } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { renderProjects, saveActiveProject } from './projects.js';
import { renderGallery } from './gallery.js';
import { showToast } from './ui.js';

function triggerThumb(idx) {
  setThumbTargetIdx(idx);
  pickImage();
}

function triggerActiveThumb() {
  const idx = projects.findIndex(p => p.active);
  if (idx !== -1) triggerThumb(idx);
}

async function pickImage() {
  try {
    const selected = await open({
      multiple: false,
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'svg'] }],
    });
    if (!selected || thumbTargetIdx === null) return;
    const bytes = await readFile(selected);
    const ext = selected.split('.').pop().toLowerCase();
    const mime = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', gif:'image/gif', bmp:'image/bmp', svg:'image/svg+xml' }[ext] || 'image/png';
    const b64 = btoa(String.fromCharCode(...new Uint8Array(bytes)));
    const dataUrl = `data:${mime};base64,${b64}`;
    projects[thumbTargetIdx].thumb = dataUrl;
    renderProjects();
    updateHeaderThumb();
    if (document.getElementById('galleryOverlay').style.display !== 'none') renderGallery();
    try { await saveActiveProject(); }
    catch (err) { console.error('Failed to save thumb:', err); }
    setThumbTargetIdx(null);
  } catch (err) {
    if (err?.toString?.().includes('cancelled') || err?.toString?.().includes('Cancel')) return;
    console.error('pickImage error:', err);
    showToast('Failed to load image', 'var(--red)');
  }
}

function updateHeaderThumb() {
  const active = projects.find(p => p.active);
  const el = document.getElementById('phThumb');
  if (!el || !active) return;
  el.innerHTML = active.thumb
    ? `<img src="${active.thumb}" style="width:100%;height:100%;object-fit:cover;display:block">`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
}

export { triggerThumb, triggerActiveThumb, updateHeaderThumb }
