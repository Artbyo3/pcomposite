import { escapeHTML, formatBytes } from './helpers.js';
import { projects, globalSettings } from './state.js';
import { readDir, copyFile, mkdir, exists, remove, rename } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { showToast } from './ui.js';
import { logAction } from './checklist.js';
import { selectProject, saveActiveProject } from './projects.js';
import { writeBridgeContext } from './bridge.js';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { getCurrentWebview } from '@tauri-apps/api/webview';

let _currentGroup = null;
let _backOnEscape = null;
const COVER_EXTS = ['.png', '.jpg', '.jpeg', '.webp'];
const BASE_EXT_COLORS = {
  blend: 'var(--c-blender)',
  fbx:   'var(--c-fbx)',
  obj:   'var(--c-subs)',
  glb:   'var(--c-export)',
  gltf:  'var(--c-export)',
};

async function basesDir() {
  return await join(globalSettings.root_path, '_bases');
}

async function findCoverFile(groupDir) {
  for (const ext of COVER_EXTS) {
    const p = await join(groupDir, 'cover' + ext);
    if (await exists(p)) return { path: p, ext };
  }
  return null;
}

function openBases() {
  _currentGroup = null;
  document.getElementById('basesOverlay').classList.add('open');
  renderBases();
}
function closeBases() {
  document.getElementById('basesOverlay').classList.remove('open');
  _currentGroup = null;
}

function getHue(name) {
  return [...name].reduce((a, c) => a + c.charCodeAt(0), 0) * 17 % 360;
}

async function scanGroups() {
  if (!globalSettings.root_path) return { path: null, groups: {} };
  const bp = await basesDir();
  if (!(await exists(bp))) return { path: bp, groups: {} };
  const entries = await readDir(bp);
  const groups = {};
  for (const entry of entries) {
    if (entry.isDirectory) {
      const dirPath = await join(bp, entry.name);
      const all = await readDir(dirPath);
      groups[entry.name] = all
        .filter(f => !f.isDirectory && !COVER_EXTS.includes('.' + f.name.split('.').pop().toLowerCase()))
        .map(f => ({ name: f.name, size: f.size || 0 }));
    }
  }
  const flat = entries.filter(e => !e.isDirectory);
  const flatGroups = {};
  for (const f of flat) {
    const stem = f.name.replace(/\.[^.]+$/, '');
    const idx = stem.lastIndexOf('_');
    const g = idx > 0 ? stem.slice(0, idx) : stem;
    const arr = flatGroups[g] || (flatGroups[g] = []);
    arr.push({ name: f.name, size: f.size || 0 });
  }
  for (const [g, files] of Object.entries(flatGroups)) {
    if (groups[g]) groups[g] = groups[g].concat(files);
    else groups[g] = files;
  }
  return { path: bp, groups };
}

// ── Drag-drop listener (set up once) ──
let _dragUnlisten = null;
let _dragOverCard = false;
let _dragOverFiles = false;

function initDragDrop() {
  if (_dragUnlisten) return;
  getCurrentWebview().onDragDropEvent(async (event) => {
    if (!_currentGroup) return;
    const card = document.querySelector('.bd-card-preview');
    const fileArea = document.querySelector('.bd-file-area');

    if (event.payload.type === 'over') {
      const px = event.payload.position.x;
      const py = event.payload.position.y;
      _dragOverCard = false;
      _dragOverFiles = false;
      if (card) {
        const r = card.getBoundingClientRect();
        _dragOverCard = px >= r.left && px <= r.right && py >= r.top && py <= r.bottom;
        card.classList.toggle('bd-drag-over', _dragOverCard);
      }
      if (fileArea && !_dragOverCard) {
        const r = fileArea.getBoundingClientRect();
        _dragOverFiles = px >= r.left && px <= r.right && py >= r.top && py <= r.bottom;
        fileArea.classList.toggle('bd-drag-over', _dragOverFiles);
      }
    } else if (event.payload.type === 'leave') {
      _dragOverCard = false; _dragOverFiles = false;
      if (card) card.classList.remove('bd-drag-over');
      if (fileArea) fileArea.classList.remove('bd-drag-over');
    } else if (event.payload.type === 'drop') {
      if (card) card.classList.remove('bd-drag-over');
      if (fileArea) fileArea.classList.remove('bd-drag-over');
      const paths = event.payload.paths;
      if (_dragOverCard) {
        for (const src of paths) {
          const ext = (src.split('.').pop() || '').toLowerCase();
          if (COVER_EXTS.includes('.' + ext)) {
            await _setCoverFile(_currentGroup, src);
            return;
          }
        }
        showToast('Drop an image file (PNG, JPG, WebP)', 'var(--orange)');
      } else if (_dragOverFiles) {
        let count = 0;
        const basesDirPath = await basesDir();
        const groupDir = await join(basesDirPath, _currentGroup);
        if (!(await exists(groupDir))) await mkdir(groupDir, { recursive: true });
        for (const src of paths) {
          const name = src.split(/[/\\]/).pop();
          const dest = await join(groupDir, name);
          if (!(await exists(dest))) {
            try { await copyFile(src, dest); count++; }
            catch (e) { console.warn('drag-drop: could not copy', name, e); }
          }
        }
        if (count > 0) {
          await writeBridgeContext();
          if (_currentGroup) await openGroup(_currentGroup);
          showToast(count + ' file' + (count !== 1 ? 's' : '') + ' added', 'var(--green)');
        } else {
          showToast('No new files to add', 'var(--orange)');
        }
      }
    }
  }).then(fn => { _dragUnlisten = fn; });
}

// ── LEVEL 1: Character card grid ──

async function renderBases() {
  const grid = document.getElementById('basesGrid');
  const detail = document.getElementById('basesDetail');
  const count = document.getElementById('basesCount');
  const title = document.getElementById('basesTitle');
  const newBtn = document.getElementById('basesNewGroupBtn');
  const addBtn = document.getElementById('basesAddFilesBtn');

  _currentGroup = null;
  grid.style.display = 'grid';
  detail.style.display = 'none';
  newBtn.style.display = '';
  addBtn.style.display = 'none';
  title.textContent = 'BASES LIBRARY';

  // Remove escape listener when on grid
  if (_backOnEscape) { document.removeEventListener('keydown', _backOnEscape); _backOnEscape = null; }

  if (!globalSettings.root_path) {
    count.textContent = '';
    grid.innerHTML = `<div class="base-empty">Set a Vault Path in Settings first</div>`;
    return;
  }

  const { path: bp, groups } = await scanGroups();
  const groupNames = Object.keys(groups).sort();
  count.textContent = groupNames.length + ' group' + (groupNames.length !== 1 ? 's' : '');

  if (!groupNames.length) {
    grid.innerHTML = `<div class="base-empty">No bases registered yet.<br><br><button onclick="createGroup()" class="tbtn" style="font-size:10px;padding:5px 14px">+ NEW GROUP</button></div>`;
    return;
  }

  const cards = [];
  for (let i = 0; i < groupNames.length; i++) {
    const g = groupNames[i];
    const files = groups[g];
    const totalSize = files.reduce((s, f) => s + (f.size || 0), 0);
    const importedCount = (window._importedBases || []).filter(ib => ib.group === g).length;
    const allImported = importedCount === files.length && files.length > 0;
    const initial = g.charAt(0).toUpperCase();
    const hue = getHue(g);
    const bg = `hsl(${hue}, 40%, 20%)`;
    const groupDir = await join(bp, g);
    const cover = await findCoverFile(groupDir);
    const coverUrl = cover ? convertFileSrc(cover.path) : null;
    let imgStyle, imgInit;
    if (coverUrl) {
      imgStyle = `background:${bg};background-image:url('${coverUrl}');background-size:cover;background-position:center`;
      imgInit = `<span class="bc-img-initial" style="opacity:0">${initial}</span>`;
    } else {
      imgStyle = `background:${bg}`;
      imgInit = `<span class="bc-img-initial">${initial}</span>`;
    }
    cards.push(`<div class="bc-card" style="animation-delay:${i * .03}s" onclick="openGroup('${escapeHTML(g).replace(/'/g, "\\'")}')">
      <div class="bc-img" style="${imgStyle}">
        ${imgInit}
        <div class="bc-img-overlay">
          <div class="bc-img-name">${escapeHTML(g)}</div>
        </div>
      </div>
      <div class="bc-body">
        <div class="bc-info">
          <span class="bc-count">${files.length} file${files.length !== 1 ? 's' : ''}</span>
          <span class="bc-size">${formatBytes(totalSize)}</span>
        </div>
        ${allImported ? '<span class="bc-badge all-imported">IMPORTED</span>' : importedCount > 0 ? '<span class="bc-badge partial">' + importedCount + '/' + files.length + '</span>' : ''}
      </div>
    </div>`);
  }
  grid.innerHTML = cards.join('');
}

// ── LEVEL 2: Inside a group ──

async function openGroup(group) {
  _currentGroup = group;
  initDragDrop();

  const grid = document.getElementById('basesGrid');
  const detail = document.getElementById('basesDetail');
  const count = document.getElementById('basesCount');
  const newBtn = document.getElementById('basesNewGroupBtn');
  const addBtn = document.getElementById('basesAddFilesBtn');

  grid.style.display = 'none';
  detail.style.display = 'flex';
  newBtn.style.display = 'none';
  addBtn.style.display = 'none';
  count.textContent = '';

  const { groups } = await scanGroups();
  const files = groups[group] || [];
  const totalSize = files.reduce((s, f) => s + (f.size || 0), 0);
  const initial = group.charAt(0).toUpperCase();
  const hue = getHue(group);
  const bg = `hsl(${hue}, 40%, 20%)`;

  // Check for cover image
  const basesDirPath = await basesDir();
  const groupDir = await join(basesDirPath, group);
  const cover = await findCoverFile(groupDir);
  const coverUrl = cover ? convertFileSrc(cover.path) : null;

  const importedCount = (window._importedBases || []).filter(ib => ib.group === group).length;
  const allImported = importedCount === files.length && files.length > 0;

  // Left: card preview with cover support
  let coverStyle = '';
  let coverContent = '';
  if (coverUrl) {
    coverStyle = `background:${bg};background-image:url('${coverUrl}');background-size:cover;background-position:center`;
    coverContent = `<span class="bc-img-initial" style="opacity:0">${initial}</span>`;
  } else {
    coverStyle = `background:${bg}`;
    coverContent = `<span class="bc-img-initial">${initial}</span>`;
  }

  const imgIconSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
    <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
    <polyline points="21 15 16 10 5 21"/>
  </svg>`;

  let leftHtml = `<div class="bd-card-preview" ondragover="event.preventDefault()">
    <div class="bc-img" style="${coverStyle}">
      ${coverContent}
      <div class="bc-img-overlay">
        <div class="bc-img-name" id="bcImgName">${escapeHTML(group)}</div>
      </div>
      <div class="bc-cover-actions">
        <button class="bc-cover-btn" onclick="event.stopPropagation();setCoverImage()" title="Set cover image">${imgIconSvg}</button>
        ${cover ? '<button class="bc-cover-btn" onclick="event.stopPropagation();removeCoverImage()" title="Remove cover">✕</button>' : ''}
      </div>
    </div>
    <div class="bc-body">
      <div class="bc-count">${files.length} file${files.length !== 1 ? 's' : ''}</div>
      <div class="bc-bot">
        ${allImported ? '<span class="bc-badge all-imported">ALL IMPORTED</span>' : importedCount > 0 ? '<span class="bc-badge partial">' + importedCount + '/' + files.length + ' imported</span>' : '<span class="bc-badge partial" style="opacity:.4;pointer-events:none">0 imported</span>'}
        <span class="bc-size">${formatBytes(totalSize)}</span>
      </div>
      <div class="bc-hint">drag image here</div>
    </div>
  </div>`;

  // Right: file list
  const dropHintSvg = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>`;
  let rightHtml = '';
  if (!files.length) {
    rightHtml = `<div class="bd-dropzone" onclick="addFilesToDetail()">
      <div class="bd-dz-icon">${dropHintSvg}</div>
      <div class="bd-dz-text">Drop files — PCOMPOSITE copies them to this group</div>
      <div class="bd-dz-sub">.BLEND .FBX .OBJ .GLB .GLTF and more</div>
    </div>`;
  } else {
    rightHtml = files.map((f, i) => {
      const extRaw = f.name.includes('.') ? f.name.split('.').pop().toLowerCase() : '';
      const ext = extRaw ? '.' + extRaw.toUpperCase() : '';
      const ec = BASE_EXT_COLORS[extRaw] || 'var(--text3)';
      const isImported = (window._importedBases || []).some(ib => ib.file === f.name && ib.group === group);
      const escapedGroup = escapeHTML(group).replace(/'/g, "\\'");
      const escapedName = escapeHTML(f.name).replace(/'/g, "\\'");
      return `<div class="bf-row" style="animation-delay:${i * .03}s">
        <span class="bf-ico">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        </span>
        <div class="bf-nm-wrap">
          <span class="bf-nm">${escapeHTML(f.name)}</span>
          ${isImported ? '<span class="bf-tag">IMPORTED</span>' : ''}
        </div>
        <span class="bf-ext" style="background:${ec}18;color:${ec}">${ext}</span>
        <span class="bf-sz">${f.size ? formatBytes(f.size) : ''}</span>
        <div class="bf-actions">
          <button onclick="event.stopPropagation();importInBlender('${escapedGroup}','${escapedName}')" class="bf-act blender" title="Copy to project and open Blender">${isImported ? 'RE-IMPORT' : 'IMPORT'} in Blender</button>
          <button onclick="event.stopPropagation();removeBaseFile('${escapedGroup}','${escapedName}')" class="bf-act danger" title="Remove file">✕</button>
        </div>
      </div>`;
    }).join('') + `<div class="bd-dz-hint" onclick="addFilesToDetail()">
      <div class="bd-dz-hint-icon">${dropHintSvg}</div>
      <div class="bd-dz-hint-text">drop files to add</div>
    </div>`;
  }

  detail.innerHTML = `<div class="bd-header">
    <button onclick="backToBasesGrid()" class="bd-back-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"/></svg> Back</button>
    <div style="flex:1"></div>
    <div class="bd-actions">
      <button onclick="addFilesToDetail()" class="bd-btn">+ ADD FILES</button>
      <button onclick="startInlineRename()" class="bd-btn">RENAME</button>
      <button onclick="removeGroup('${escapeHTML(group).replace(/'/g, "\\'")}')" class="bd-btn danger">DELETE</button>
    </div>
  </div>
  <div class="bd-split">
    ${leftHtml}
    <div class="bd-file-area">${rightHtml}</div>
  </div>`;

  // Make the card preview name clickable for inline rename
  const nameEl = document.getElementById('bcImgName');
  if (nameEl) nameEl.style.cursor = 'pointer';

  // Escape to go back
  _backOnEscape = (e) => { if (e.key === 'Escape') renderBases(); };
  document.addEventListener('keydown', _backOnEscape);
}

window.openGroup = openGroup;
window.backToBasesGrid = renderBases;

// ── Cover image ──

async function _setCoverFile(group, srcPath) {
  const ext = (srcPath.split('.').pop() || '').toLowerCase();
  const basesDirPath = await basesDir();
  const groupDir = await join(basesDirPath, group);
  const dest = await join(groupDir, 'cover.' + ext);
  try {
    // Remove old cover if exists
    for (const oldExt of COVER_EXTS) {
      const old = await join(groupDir, 'cover' + oldExt);
      if (old !== dest && await exists(old)) await remove(old);
    }
    await copyFile(srcPath, dest);
    await writeBridgeContext();
    if (_currentGroup) await openGroup(_currentGroup);
    showToast('Cover image set', 'var(--green)');
  } catch (e) { showToast('Error setting cover: ' + e, 'var(--red)'); }
}

async function setCoverImage() {
  if (!_currentGroup) return;
  try {
    const selected = await openDialog({
      directory: false,
      multiple: false,
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    });
    if (!selected) return;
    await _setCoverFile(_currentGroup, selected);
  } catch (e) { showToast('Error: ' + e, 'var(--red)'); }
}

async function removeCoverImage() {
  if (!_currentGroup) return;
  const basesDirPath = await basesDir();
  const groupDir = await join(basesDirPath, _currentGroup);
  for (const ext of COVER_EXTS) {
    const p = await join(groupDir, 'cover' + ext);
    if (await exists(p)) { await remove(p); break; }
  }
  await writeBridgeContext();
  if (_currentGroup) await openGroup(_currentGroup);
  showToast('Cover removed', 'var(--green)');
}

window.setCoverImage = setCoverImage;
window.removeCoverImage = removeCoverImage;

// ── Inline rename ──

async function startInlineRename() {
  const titleEl = document.getElementById('bcImgName');
  if (!titleEl || !_currentGroup) return;
  const oldName = _currentGroup;
  const input = document.createElement('input');
  input.className = 'bd-title-input';
  input.value = oldName;
  input.style.cssText = 'font-size:13px;font-weight:700;flex:1;background:var(--bg3);border:1px solid var(--accent);border-radius:5px;padding:3px 8px;color:var(--text);font-family:inherit;outline:none';
  titleEl.replaceWith(input);
  input.focus();
  input.select();

  const commit = async () => {
    const val = input.value.trim();
    if (!val || val === oldName) { _cancelRename(input, oldName); return; }
    const basesDirPath = await basesDir();
    const oldPath = await join(basesDirPath, oldName);
    const newPath = await join(basesDirPath, val);
    if (await exists(newPath)) { showToast('A group with that name already exists', 'var(--orange)'); _cancelRename(input, oldName); return; }
    try {
      await rename(oldPath, newPath);
      if (window._importedBases) window._importedBases.forEach(i => { if (i.group === oldName) i.group = val; });
      await saveActiveProject();
      await writeBridgeContext();
      _currentGroup = val;
      showToast('Renamed to "' + val + '"', 'var(--green)');
      if (_currentGroup) await openGroup(_currentGroup);
      else await renderBases();
    } catch (e) { showToast('Error: ' + e, 'var(--red)'); _cancelRename(input, oldName); }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { _cancelRename(input, oldName); }
  });
  input.addEventListener('blur', () => { setTimeout(() => commit(), 150); });
}

function _cancelRename(input, oldName) {
  const span = document.createElement('span');
  span.className = 'bc-img-name';
  span.id = 'bcImgName';
  span.textContent = oldName;
  span.style.cursor = 'pointer';
  input.replaceWith(span);
}

window.startInlineRename = startInlineRename;

// ── Actions ──

async function importBase(group, fileName) {
  const p = projects.find(x => x.active);
  if (!p) { showToast('No active project', 'var(--red)'); return; }
  if (!globalSettings.root_path) { showToast('No Root Path set', 'var(--red)'); return; }

  const basesDirPath = await basesDir();
  const srcPath = await join(basesDirPath, group, fileName);
  const projectDir = await join(globalSettings.root_path, p.id + '_' + p.name);
  const targetDir = await join(projectDir, 'blender');
  if (!(await exists(targetDir))) await mkdir(targetDir, { recursive: true });
  const destPath = await join(targetDir, fileName);

  try { await copyFile(srcPath, destPath); }
  catch (e) { showToast('Error: ' + String(e), 'var(--red)'); return; }

  if (!window._importedBases) window._importedBases = [];
  const existing = window._importedBases.findIndex(i => i.file === fileName && i.group === group);
  if (existing >= 0) {
    window._importedBases[existing].imported_at = new Date().toISOString();
  } else {
    window._importedBases.push({ file: fileName, group, imported_at: new Date().toISOString() });
  }
  await saveActiveProject();

  logAction('Copied base ' + fileName + ' from ' + group + ' to blender/', 'ok');
  showToast(fileName + ' ready in blender/', 'var(--green)');

  const idx = projects.indexOf(p);
  if (idx !== -1) await selectProject(idx);
  await writeBridgeContext();
  if (_currentGroup) await openGroup(_currentGroup);
  else await renderBases();
}

async function importInBlender(group, fileName) {
  await importBase(group, fileName);
  // Pre-stage import in bridge context so the addon shows the button
  await writeBridgeContext({ type: 'import', file: fileName, group });
  try {
    await invoke('focus_blender');
  } catch (e) {
    showToast('Could not focus Blender: ' + e + '. Make sure Blender is open.', 'var(--orange)');
  }
}

async function addFilesToDetail() {
  const group = _currentGroup;
  if (!group) return;
  await addFilesToGroup(group);
}

async function addFilesToGroup(group) {
  try {
    const selected = await openDialog({ directory: false, multiple: true, filters: [{ name: 'Base Files', extensions: ['fbx', 'obj', 'blend', 'glb', 'gltf'] }] });
    if (!selected || !selected.length) return;
    const basesDirPath = await basesDir();
    const groupDir = await join(basesDirPath, group);
    if (!(await exists(groupDir))) await mkdir(groupDir, { recursive: true });
    let count = 0;
    for (const src of (Array.isArray(selected) ? selected : [selected])) {
      const name = src.split(/[/\\]/).pop();
      const dest = await join(groupDir, name);
      if (!(await exists(dest))) {
        try { await copyFile(src, dest); count++; }
        catch (e) { console.warn('addFilesToGroup: could not copy', name, e); }
      }
    }
    await writeBridgeContext();
    if (_currentGroup) await openGroup(_currentGroup);
    else await renderBases();
    showToast(count + ' file' + (count !== 1 ? 's' : '') + ' added to ' + group, 'var(--green)');
  } catch (e) { showToast('Error: ' + e, 'var(--red)'); }
}

async function removeBaseFile(group, fileName) {
  const basesDirPath = await basesDir();
  const filePath = await join(basesDirPath, group, fileName);
  try {
    await remove(filePath);
    if (window._importedBases) {
      window._importedBases = window._importedBases.filter(i => !(i.file === fileName && i.group === group));
    }
    await saveActiveProject();
    await writeBridgeContext();
    if (_currentGroup) await openGroup(_currentGroup);
    else await renderBases();
    showToast(fileName + ' removed', 'var(--green)');
  } catch (e) { showToast('Error: ' + e, 'var(--red)'); }
}

async function removeGroup(group) {
  if (!confirm('Delete group "' + group + '" and all its files?')) return;
  const basesDirPath = await basesDir();
  const groupPath = await join(basesDirPath, group);
  try {
    await remove(groupPath, { recursive: true });
    if (window._importedBases) {
      window._importedBases = window._importedBases.filter(i => i.group !== group);
    }
    await saveActiveProject();
    await writeBridgeContext();
    _currentGroup = null;
    await renderBases();
    showToast('Group "' + group + '" deleted', 'var(--green)');
  } catch (e) { showToast('Error: ' + e, 'var(--red)'); }
}

async function renameGroup(oldName) {
  // Deprecated — use startInlineRename instead; kept for backwards compat
  await startInlineRename();
}

async function createGroup() {
  const name = prompt('New group name:');
  if (!name) return;
  const basesDirPath = await basesDir();
  const groupPath = await join(basesDirPath, name.trim());
  if (await exists(groupPath)) { showToast('Group already exists', 'var(--orange)'); return; }
  try {
    await mkdir(groupPath, { recursive: true });
    _currentGroup = name.trim();
    await openGroup(_currentGroup);
    await writeBridgeContext();
    showToast('Group "' + name.trim() + '" created', 'var(--green)');
  } catch (e) { showToast('Error: ' + e, 'var(--red)'); }
}

export { openBases, closeBases, renderBases, importBase, importInBlender, addFilesToGroup, removeBaseFile, removeGroup, renameGroup, createGroup };
