import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { join, basename, extname } from '@tauri-apps/api/path';
import { getCurrentWebview } from '@tauri-apps/api/webview';

import { copyFile, stat, mkdir, exists, rename, remove, readFile, readDir } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';
import { openPath } from '@tauri-apps/plugin-opener';
import { initDataStore, loadSettings as loadJSONSettings, saveSettings, scanVault, loadProject, saveProject, syncProjectFiles } from './data.js';

// ── HELPERS ──
function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, n = Number(bytes);
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return (i === 0 ? n : n.toFixed(1)) + ' ' + units[i];
}

// ── DATA ──

async function initData() {
  try {
    await initDataStore();
    await loadSettings();
    renderPipeline();
    renderFolders();
    await loadProjects();
    renderProjects();
    updateHeaderThumb();
    initDragDrop();
  } catch (err) {
    console.error('Failed to load data:', err);
  }
}
window.addEventListener('DOMContentLoaded', initData);


async function saveActiveProject() {
  const p = projects.find(x => x.active);
  if (!p || !globalSettings.root_path) return;
  const data = {
    id: p.id,
    name: p.name,
    date: p.date,
    stage: p.stage,
    thumb: p.thumb,
    release_date: p.release_date || null,
    files: ALL_FILES.map(f => ({ name: f.name, folder: f.folder, ext: f.ext, size_bytes: f.sizeBytes, app: f.app, created_at: f.date })),
    checklist: CHECKLIST.map(c => ({ label: c.l, done: c.done })),
    note: sessionNote,
    exports: window._currentExports || [],
  };
  await saveProject(globalSettings.root_path, data);
}

// ── DRAG & DROP ──
function initDragDrop() {
  const zone = document.querySelector('.dzone');
  getCurrentWebview().onDragDropEvent(async (event) => {
    if (event.payload.type === 'enter') {
      zone && zone.classList.add('dzone-over');
    } else if (event.payload.type === 'leave') {
      zone && zone.classList.remove('dzone-over');
    } else if (event.payload.type === 'drop') {
      zone && zone.classList.remove('dzone-over');
      const paths = event.payload.paths;
      if (paths && paths.length > 0) await handleDroppedFiles(paths);
    }
  });
}

async function collectFilesRecursive(dirPath) {
  let files = [];
  const entries = await readDir(dirPath);
  for (const entry of entries) {
    const fullPath = await join(dirPath, entry.name);
    if (entry.isDirectory) {
      const sub = await collectFilesRecursive(fullPath);
      files = files.concat(sub);
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

function destFolderForExt(lowerExt) {
  if (lowerExt === '.blend' || /^\.blend\d+$/.test(lowerExt)) return 'blender';
  if (lowerExt === '.spp') return 'subs';
  if (['.png','.jpg','.jpeg','.tga','.exr'].includes(lowerExt)) return 'pictures';
  if (['.fbx','.obj'].includes(lowerExt)) return 'fbx';
  if (['.mat','.unity','.prefab','.cs','.meta'].includes(lowerExt)) return 'unity';
  return 'export';
}

async function handleDroppedFiles(paths) {
  if (!globalSettings.root_path) { showToast('No Root Path set in Settings', 'var(--red)'); return; }
  const p = projects.find(x => x.active);
  if (!p) { showToast('No active project', 'var(--red)'); return; }

  const data = await loadProject(globalSettings.root_path, p.id, p.name);
  if (!data) return;

  // Flatten: expand directories into their file contents
  let allFiles = [];
  for (const fp of paths) {
    try {
      const info = await stat(fp);
      if (info.isDirectory) {
        const sub = await collectFilesRecursive(fp);
        allFiles = allFiles.concat(sub);
      } else {
        allFiles.push(fp);
      }
    } catch { allFiles.push(fp); }
  }

  let imported = 0;
  for (const filePath of allFiles) {
    try {
      const baseNm = await basename(filePath);
      let extStr = await extname(filePath);
      let ext = extStr ? '.' + extStr.toUpperCase() : '';
      const lowerExt = ext.toLowerCase();

      const destFolder = destFolderForExt(lowerExt);

      const projectDir = await join(globalSettings.root_path, p.id + '_' + p.name);
      const targetDir  = await join(projectDir, destFolder);
      if (!(await exists(targetDir))) await mkdir(targetDir, { recursive: true });

      const destPath = await join(targetDir, baseNm);
      if (await exists(destPath)) await remove(destPath);

      try { await rename(filePath, destPath); }
      catch { await copyFile(filePath, destPath); await remove(filePath); }

      const fileInfo  = await stat(destPath);
      const sizeBytes = fileInfo.size;
      const app = { blender:'Blender', subs:'Painter', unity:'Unity', pictures:'Viewer' }[destFolder] || 'Explorer';
      const now = new Date().toLocaleDateString();

      const existingIdx = data.files.findIndex(f => f.name === baseNm && f.folder === destFolder);
      if (existingIdx !== -1)
        data.files[existingIdx] = { ...data.files[existingIdx], ext, size_bytes: sizeBytes, app, created_at: now };
      else
        data.files.push({ name: baseNm, folder: destFolder, ext, size_bytes: sizeBytes, app, created_at: now });

      imported++;
    } catch (err) {
      showToast('Error: ' + String(err), 'var(--red)');
    }
  }

  if (imported > 0) {
    await saveProject(globalSettings.root_path, data);
    logAction(`Imported ${imported} file(s)`, 'ok');
    showToast(`Imported ${imported} file(s)`, 'var(--green)');
    selectProject(projects.findIndex(x => x.active));
  }
}

// ── STATIC DATA ──
const FOLDERS = [
  { key:'blender',   icon:'<img src="/blender.svg" style="width:1em;height:1em;vertical-align:-0.15em;">',                   color:'var(--c-blender)',  desc:'source meshes',       files:0, size:'-', pct:0, _bytes:0 },
  { key:'subs',      icon:'<img src="/substance-3d-painter.svg" style="width:1em;height:1em;vertical-align:-0.15em;">',      color:'var(--c-subs)',     desc:'painter projects',    files:0, size:'-', pct:0, _bytes:0 },
  { key:'unity',     icon:'<img src="/Unity.svg" style="width:1em;height:1em;vertical-align:-0.15em;">',                     color:'var(--c-unity)',    desc:'unity project files', files:0, size:'-', pct:0, _bytes:0 },
  { key:'fbx',       icon:'📦',                                                                                               color:'var(--c-fbx)',      desc:'exported meshes',     files:0, size:'-', pct:0, _bytes:0 },
  { key:'pictures',  icon:'📷',                                                                                               color:'var(--c-pictures)', desc:'ref + texture shots', files:0, size:'-', pct:0, _bytes:0 },
  { key:'promo art', icon:'🖼️',                                                                                              color:'var(--c-promo)',    desc:'marketing renders',   files:0, size:'-', pct:0, _bytes:0 },
  { key:'resonite',  icon:'🎮',                                                                                               color:'var(--c-resonite)', desc:'resonite asset pack', files:0, size:'-', pct:0, _bytes:0 },
  { key:'export',    icon:'🚀',                                                                                               color:'var(--c-export)',   desc:'final upload bundle', files:0, size:'-', pct:0, _bytes:0 },
];

const FOLDER_META = Object.fromEntries(FOLDERS.map(f => [f.key, { color: f.color, icon: f.icon }]));

const PIPELINE = [
  { label:'Blender', icon:'<img src="/blender.svg" style="width:1em;height:1em;vertical-align:-0.15em;">', done:false, active:true },
  { label:'Painter', icon:'<img src="/substance-3d-painter.svg" style="width:1em;height:1em;vertical-align:-0.15em;">', done:false, active:false },
  { label:'Unity',   icon:'<img src="/Unity.svg" style="width:1em;height:1em;vertical-align:-0.15em;">', done:false, active:false },
  { label:'Package', icon:'📦', done:false, active:false },
  { label:'Upload',  icon:'🚀', done:false, active:false },
];

let ALL_FILES = [];
const thumbCache = new Map();

function isViewableImage(ext) {
  return ['.png','.jpg','.jpeg','.gif','.webp','.svg','.bmp'].includes((ext || '').toLowerCase());
}

async function loadThumbnail(path, ext) {
  if (thumbCache.has(path)) return thumbCache.get(path);
  try {
    const bytes = await readFile(path);
    const mime = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', svg:'image/svg+xml', bmp:'image/bmp' }[(ext||'').replace('.','').toLowerCase()] || 'image/png';
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    if (ext === '.svg') { thumbCache.set(path, url); return url; }
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const max = 80;
        const scale = Math.min(max / img.width, max / img.height, 1);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        const dataUrl = canvas.toDataURL(mime === 'image/svg+xml' ? 'image/png' : mime, 0.85);
        thumbCache.set(path, dataUrl);
        resolve(dataUrl);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  } catch (e) { console.warn('loadThumbnail error:', e); return null; }
}

const CHECKLIST = [
  { l:'Blender done',  icon:'<img src="/blender.svg" style="width:1em;height:1em;vertical-align:-0.15em;">', color:'var(--c-blender)', done:false },
  { l:'Painter done',  icon:'<img src="/substance-3d-painter.svg" style="width:1em;height:1em;vertical-align:-0.15em;">', color:'var(--c-subs)', done:false },
  { l:'Unity done',    icon:'<img src="/Unity.svg" style="width:1em;height:1em;vertical-align:-0.15em;">', color:'var(--c-unity)', done:false },
  { l:'Package ready', icon:'📦', color:'var(--c-fbx)', done:false },
  { l:'Uploaded',      icon:'🚀', color:'var(--c-export)', done:false },
];

let sessionNote = '';
let projectLog  = [];

let _noteSaveTimer = null;
function saveSessionNote(value) {
  sessionNote = value;
  clearTimeout(_noteSaveTimer);
  _noteSaveTimer = setTimeout(async () => {
    const p = projects.find(x => x.active);
    if (!p || !globalSettings.root_path) return;
    try { await saveActiveProject(); }
    catch (e) { console.error('note save error:', e); }
  }, 600);
}

// ── PIPELINE ──
function renderPipeline() {
  document.getElementById('pipebar').innerHTML = PIPELINE.map((s, i) => `
    <div class="pstep">
      <div class="pnode ${s.done ? 'done' : s.active ? 'active' : 'inactive'}" onclick="setPipe(${i})">
        <span class="picon">${s.icon}</span>
        <span class="plabel">${s.label}</span>
        ${s.done ? '<div class="pcheck">✓</div>' : ''}
      </div>
      ${i < PIPELINE.length - 1 ? '<span class="parr">›</span>' : ''}
    </div>
  `).join('');
}

async function setPipe(i, skipDb = false) {
  const clampedI = Math.max(0, Math.min(i, PIPELINE.length - 1));
  PIPELINE.forEach((s, j) => { s.done = j < clampedI; s.active = j === clampedI; });
  renderPipeline();

  if (!skipDb) {
    const p = projects.find(x => x.active);
    if (p) {
      p.stage = clampedI + 1;
      await saveActiveProject();
    }
  }
  refreshInfoPanel();
}

// ── FOLDERS ──
function refreshFolders() {
  FOLDERS.forEach(f => { f.files = 0; f.size = '-'; f.pct = 0; f._bytes = 0; });
  ALL_FILES.forEach(file => {
    const folder = FOLDERS.find(f => f.key === file.folder);
    if (folder) { folder.files++; folder._bytes += (file.sizeBytes || 0); }
  });
  FOLDERS.forEach(f => {
    f.size = f._bytes > 0 ? formatBytes(f._bytes) : '-';
    f.pct  = f.files > 0 ? 100 : 0;
  });
  renderFolders();
}

function renderFolders() {
  // fhgrid is owned by refreshInfoPanel, not here
  document.getElementById('fgrid').innerHTML = FOLDERS.map(f => `
    <div class="ftile ${f.files === 0 ? 'empty' : ''}" onclick="drillFolder('${f.key}')" style="--fc:${f.color}">
      <div class="ft-glow"></div>
      <div class="ft-content">
        <div class="ft-badge">${f.files} ITEM${f.files !== 1 ? 'S' : ''}</div>
        <div class="ft-icon">${f.icon}</div>
        <div class="ft-title">${escapeHTML(f.key)}</div>
      </div>
    </div>
  `).join('');

}

function drillFolder(key) {
  currentFolder = key;
  document.querySelectorAll('.vtab').forEach(t => t.classList.toggle('active', t.textContent === 'All Files'));
  setVTab(null, 'files');
  renderFileList(key);
}

// ── FILE LIST ──
let currentFolder = null;
let fileView = 'list';

function renderFileList(filterKey) {
  const files  = filterKey ? ALL_FILES.filter(f => f.folder === filterKey) : ALL_FILES;
  const folder = FOLDERS.find(f => f.key === filterKey);
  const cls    = filterKey ? 'no-folder' : 'with-folder';

  const exportSection = filterKey === 'fbx' ? buildExportSection() : '';

  const toolbar = `
    <div class="file-toolbar">
      <div class="file-breadcrumb">
        <span class="bc-root" onclick="goBackFolders()">folders</span>
        ${filterKey ? `
          <span class="bc-sep">›</span>
          <span style="font-size:13px;line-height:1">${folder?.icon || ''}</span>
          <span class="bc-cur" style="color:${folder?.color || 'var(--text)'}">${filterKey}/</span>
        ` : `
          <span class="bc-sep">›</span>
          <span class="bc-cur">all files</span>
        `}
        <span style="color:var(--text3);font-size:8px;margin-left:4px">— ${files.length} item${files.length !== 1 ? 's' : ''}</span>
      </div>
      <div class="file-toolbar-right">
        ${filterKey === 'blender' ? `<button class="btn-blend" onclick="createBlendFile()" title="Create a new .blend file">+ New</button>` : ''}
        <div class="view-toggle">
          <button class="vt-btn ${fileView === 'list' ? 'on' : ''}" onclick="setFileView('list')" title="List view">≡</button>
          <button class="vt-btn ${fileView === 'grid' ? 'on' : ''}" onclick="setFileView('grid')" title="Grid view">⊞</button>
        </div>
      </div>
    </div>
  `;

  if (!files.length) {
    document.getElementById('fileListContent').innerHTML = toolbar + (exportSection || `<div class="file-empty">
        <div class="file-empty-icon">${folder?.icon || '📁'}</div>
        <div class="file-empty-text">This folder is empty</div>
        <div class="file-empty-sub">Drop files here — PCOMPOSITE sorts them automatically</div>
      </div>`);
    return;
  }

  const head = `
    <div class="file-table-head ${cls}">
      <div></div>
      <div class="th-col sorted">NAME <span style="color:var(--accent)">↑</span></div>
      <div class="th-col">TYPE</div>
      ${!filterKey ? '<div class="th-col">FOLDER</div>' : ''}
      <div class="th-col">SIZE</div>
      <div class="th-col">MODIFIED</div>
    </div>
  `;


  const indices = files.map(f => ALL_FILES.indexOf(f));

  // Build a lookup of which exports own which files (for fbx folder)
  const fileToExport = {};
  if (filterKey === 'fbx') {
    const exps = window._currentExports || [];
    for (const ex of exps) if (ex.fileNames) for (const fn of ex.fileNames) fileToExport[fn] = ex.target;
  }

  const rows = files.map((f, fi) => `
    <div class="frow ${cls}" oncontextmenu="showCtx(event,${indices[fi]})" onclick="this.classList.toggle('sel')">
      <span class="fr-ico">${isViewableImage(f.ext) ? `<img class="fr-thumb" data-idx="${indices[fi]}" src="" style="width:28px;height:28px;object-fit:cover;border-radius:3px;vertical-align:middle;">` : f.icon}</span>
      <div class="fr-nm-wrap"><span class="fr-nm">${escapeHTML(f.name)}</span>${fileToExport[f.name] ? '<span class="fr-tag" style="margin-left:4px;font-size:6px;background:var(--accent-dim);color:var(--accent);padding:1px 4px;border-radius:2px;font-family:\'Space Mono\',monospace;vertical-align:middle">' + escapeHTML(fileToExport[f.name]) + '</span>' : ''}</div>
      <div><span class="fr-ext" style="background:${f.ec}18;color:${f.ec}">${f.ext}</span></div>
      ${!filterKey ? `
        <div class="fr-fldr">
          <span style="width:6px;height:6px;border-radius:1px;background:${f.ec};display:inline-block;flex-shrink:0"></span>
          ${f.folder}/
        </div>` : ''
      }
      <span class="fr-sz">${f.size}</span>
      <span class="fr-dt">${f.date}</span>
      <div class="fr-open-btn" onclick="event.stopPropagation();openFile(${indices[fi]})" title="Open in ${f.app}">
        <span style="font-size:11px">${APP_ICONS[f.app] || '📄'}</span>
        <span>Open in ${f.app}</span>
      </div>
    </div>
  `).join('');

  document.getElementById('fileListContent').innerHTML = toolbar + exportSection + head + `<div id="fileRows">${rows}</div>`;
  setTimeout(loadVisibleThumbnails, 50);
}

function loadVisibleThumbnails() {
  document.querySelectorAll('.fr-thumb[src=""]').forEach(el => {
    const idx = parseInt(el.dataset.idx);
    const f = ALL_FILES[idx];
    if (!f || !f._path || !isViewableImage(f.ext)) return;
    loadThumbnail(f._path, f.ext).then(url => { if (url) el.src = url; });
  });
}

function setFileView(v) {
  fileView = v;
  const rows = document.getElementById('fileRows');
  if (!rows) { renderFileList(currentFolder); return; }
  if (v === 'grid') {
    rows.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:8px;margin-top:12px';
    rows.querySelectorAll('.frow').forEach(r => {
      r.style.cssText = 'display:flex;flex-direction:column;align-items:center;text-align:center;padding:14px 10px;gap:6px';
      r.className = 'frow';
    });
    rows.querySelectorAll('.fr-nm').forEach(el => { el.style.fontSize = '10px'; el.style.whiteSpace = 'normal'; el.style.wordBreak = 'break-all'; });
    rows.querySelectorAll('.fr-ico').forEach(el => { el.style.fontSize = '28px'; });
    rows.querySelectorAll('.fr-thumb').forEach(el => { el.style.width = '80px'; el.style.height = '80px'; el.style.borderRadius = '6px'; });
    rows.querySelectorAll('.fr-sz,.fr-dt,.fr-fldr').forEach(el => el.style.display = 'none');
  } else {
    renderFileList(currentFolder);
  }
}

function goBackFolders() {
  currentFolder = null;
  document.querySelectorAll('.vtab').forEach(t => t.classList.toggle('active', t.textContent === 'Folders'));
  setVTab(null, 'folders');
}

// ── FILE ACTIONS ──
const APP_ICONS = {
  Blender: '<img src="/blender.svg" style="width:1em;height:1em;vertical-align:-0.15em;">',
  Painter: '<img src="/substance-3d-painter.svg" style="width:1em;height:1em;vertical-align:-0.15em;">',
  Unity:   '<img src="/Unity.svg" style="width:1em;height:1em;vertical-align:-0.15em;">',
  Viewer: '🖼️', Explorer: '📂',
};

async function createBlendFile() {
  const p = projects.find(x => x.active);
  if (!p) { showToast('No active project', 'var(--red)'); return; }
  if (!globalSettings.blender_path) { showToast('Set Blender path in Settings first', 'var(--red)'); return; }

  const projectDir = await join(globalSettings.root_path, p.id + '_' + p.name);
  const blenderDir  = await join(projectDir, 'blender');
  if (!(await exists(blenderDir))) await mkdir(blenderDir, { recursive: true });

  // Pick an untitled name that doesn't collide
  let name = 'untitled';
  let blendPath = await join(blenderDir, name + '.blend');
  let counter = 1;
  while (await exists(blendPath)) {
    blendPath = await join(blenderDir, name + '-' + counter + '.blend');
    counter++;
  }

  try {
    // Create the .blend file via Blender headless
    const escapedPath = blendPath.replace(/\\/g, '\\\\');
    await invoke('run_command', {
      exePath: globalSettings.blender_path,
      args: ['--background', '--python-expr',
        'import bpy; bpy.ops.wm.save_mainfile(filepath="' + escapedPath + '")'],
    });
  } catch (e) { showToast('Error creating .blend: ' + String(e), 'var(--red)'); return; }

  // Open Blender with the new file
  try { await invoke('open_in_app', { exePath: globalSettings.blender_path, filePath: blendPath }); }
  catch { /* ignore */ }

  logAction('Created ' + name + '.blend', 'ok');
  showToast('Created ' + name + '.blend', 'var(--green)');

  // Re-sync to pick up the new file
  const idx = projects.indexOf(p);
  if (idx !== -1) await selectProject(idx);
}

async function openFile(idx) {
  const f = ALL_FILES[idx];
  if (!globalSettings.root_path) { showToast('No Root Path set in Settings', 'var(--red)'); return; }
  const p = projects.find(x => x.active);
  if (!p) return;
  const targetPath = await join(globalSettings.root_path, p.id + '_' + p.name, f.folder, f.name);

  if (f.app === 'Viewer') {
    const ext = f.ext ? f.ext.toLowerCase() : '';
    if (['.png','.jpg','.jpeg','.gif','.webp','.svg','.bmp'].includes(ext)) {
      openImageViewer(targetPath, f.name);
      return;
    }
    // fall through to system default for unsupported image types
  }

  let exePath = { Blender: globalSettings.blender_path, Painter: globalSettings.painter_path, Unity: globalSettings.unity_path }[f.app] || '';

  if (!exePath && f.app !== 'Viewer' && f.app !== 'Explorer') {
    showToast('No executable set for ' + f.app + ' in Settings', 'var(--orange)'); return;
  }
  try {
    if (exePath) {
      await invoke('open_in_app', { exePath, filePath: targetPath });
      showToast('Launched ' + f.app, 'var(--green)');
      logAction(`Opened ${f.name} in ${f.app}`, 'ok');
    } else {
      await openPath(targetPath);
      showToast('Opened ' + f.name, 'var(--green)');
      logAction(`Opened ${f.name}`, 'ok');
    }
  } catch (err) {
    showToast('Failed to launch: ' + err, 'var(--red)');
    logAction(`Failed to open ${f.name}: ${err}`, 'err');
  }
}

async function openImageViewer(path, filename) {
  const viewer = document.getElementById('imageViewer');
  try {
    const bytes = await readFile(path);
    const ext = (filename || '').split('.').pop().toLowerCase();
    const mime = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp' }[ext] || 'image/png';
    document.getElementById('ivImg').src = URL.createObjectURL(new Blob([bytes], { type: mime }));
    document.getElementById('ivFilename').textContent = filename || '';
    viewer.style.display = 'flex';
  } catch (err) {
    showToast('Failed to load image: ' + err, 'var(--red)');
  }
}

function closeImageViewer() {
  const viewer = document.getElementById('imageViewer');
  const img = document.getElementById('ivImg');
  viewer.style.display = 'none';
  if (img.src) URL.revokeObjectURL(img.src);
  img.src = '';
}

async function revealFile(idx) {
  const f = ALL_FILES[idx];
  if (!globalSettings.root_path) { showToast('No root path set', 'var(--red)'); return; }
  const p = projects.find(x => x.active);
  if (!p) return;
  const targetPath = await join(globalSettings.root_path, p.id + '_' + p.name, f.folder, f.name);
  try {
    await invoke('open_in_app', { exePath: 'explorer', filePath: '/select,' + targetPath });
    logAction(`Revealed ${f.name} in Explorer`, 'info');
  } catch (err) {
    showToast('Failed to reveal: ' + err, 'var(--red)');
  }
}

async function copyPath(idx) {
  const f = ALL_FILES[idx];
  if (!globalSettings.root_path) { showToast('No root path set', 'var(--red)'); return; }
  const p = projects.find(x => x.active);
  if (!p) return;
  const targetPath = await join(globalSettings.root_path, p.id + '_' + p.name, f.folder, f.name);
  try {
    await navigator.clipboard.writeText(targetPath);
    showToast('Path copied to clipboard', 'var(--green)');
    logAction(`Copied path for ${f.name}`, 'info');
  } catch (err) {
    showToast('Failed to copy: ' + err, 'var(--red)');
  }
}

async function deleteFile(idx) {
  const f = ALL_FILES[idx];
  const p = projects.find(x => x.active);
  if (!p) return;
  try {
    ALL_FILES.splice(idx, 1);
    await saveActiveProject();
    renderFileList(currentFolder);
    refreshFolders();
    refreshInfoPanel();
    logAction(`Removed ${f.name} from project`, 'warn');
    showToast(`Removed ${f.name}`, 'var(--orange)');
  } catch (err) {
    showToast('Failed to remove: ' + err, 'var(--red)');
  }
}

// ── CONTEXT MENU ──
let ctxEl = null;
function showCtx(e, idx) {
  e.preventDefault();
  removeCtx();
  const f = ALL_FILES[idx];
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.style.left = e.clientX + 'px';
  menu.style.top  = e.clientY + 'px';
  menu.innerHTML = `
    <div class="ctx-item primary" onclick="openFile(${idx});removeCtx()">
      <span class="ctx-ico">${APP_ICONS[f.app] || '📄'}</span> Open in ${f.app}
    </div>
    <div class="ctx-sep"></div>
    <div class="ctx-item" onclick="revealFile(${idx});removeCtx()">
      <span class="ctx-ico">📂</span> Reveal in Explorer
    </div>
    <div class="ctx-item" onclick="copyPath(${idx});removeCtx()">
      <span class="ctx-ico">📋</span> Copy File Path
    </div>
    <div class="ctx-sep"></div>
    <div class="ctx-item" style="color:var(--red)" onclick="deleteFile(${idx});removeCtx()">
      <span class="ctx-ico">🗑️</span> Remove from Project
    </div>
  `;
  document.body.appendChild(menu);
  ctxEl = menu;
  const r = menu.getBoundingClientRect();
  if (r.right  > window.innerWidth)  menu.style.left = (e.clientX - r.width) + 'px';
  if (r.bottom > window.innerHeight) menu.style.top  = (e.clientY - r.height) + 'px';
}
function removeCtx() { if (ctxEl) { ctxEl.remove(); ctxEl = null; } }
document.addEventListener('click', removeCtx);
document.addEventListener('keydown', e => { if (e.key === 'Escape') { removeCtx(); closeModal(); } });

// ── TOAST ──
function showToast(msg, color = 'var(--accent)') {
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:40px;left:50%;transform:translateX(-50%);background:var(--bg3);border:1px solid ${color};border-radius:6px;padding:8px 16px;font-size:11px;font-family:'Space Mono',monospace;color:var(--text);z-index:1000;white-space:nowrap;box-shadow:0 4px 20px rgba(0,0,0,.5);animation:fadeUp .15s ease;`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.style.opacity = '0', 1800);
  setTimeout(() => t.remove(), 2000);
}

// ── LOG ──
function logAction(msg, type = 'info') {
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  projectLog.unshift({ msg, type, time: timeStr });
  if (projectLog.length > 50) projectLog.length = 50;
  if (document.getElementById('pLog').style.display !== 'none') renderLog();
}

function renderLog() {
  const el = document.getElementById('pLog');
  if (!projectLog.length) {
    el.innerHTML = `<div style="padding:20px;text-align:center;font-size:9px;font-family:'Space Mono',monospace;color:var(--text3)">No activity yet for this project</div>`;
    return;
  }
  el.innerHTML = projectLog.map(entry => `
    <div class="litem">
      <div class="ldot ${entry.type}"></div>
      <div>
        <div class="lmsg">${escapeHTML(entry.msg)}</div>
        <div class="ltime">${entry.time}</div>
      </div>
    </div>
  `).join('');
}

// ── CHECKLIST ──
function renderChecklist() {
  const done   = CHECKLIST.filter(c => c.done).length;
  const allDone = done === CHECKLIST.length;
  document.getElementById('checkContent').innerHTML = `
    <div style="font-size:9px;font-family:'Space Mono',monospace;color:var(--text3);letter-spacing:2px;text-transform:uppercase;margin-bottom:14px">WHERE YOU LEFT OFF</div>
    ${CHECKLIST.map((c, i) => `
      <div onclick="toggleCk(${i})" style="display:flex;align-items:center;gap:12px;padding:11px 13px;border-radius:6px;cursor:pointer;border:1px solid ${c.done ? 'var(--border)' : 'var(--border2)'};background:${c.done ? 'var(--bg3)' : 'var(--bg4)'};margin-bottom:6px;transition:all .12s;${!c.done && i === done ? 'border-color:' + c.color + ';box-shadow:0 0 0 1px ' + c.color + '22' : ''}">
        <div style="width:20px;height:20px;border-radius:50%;flex-shrink:0;border:2px solid ${c.done ? 'var(--green)' : (i === done ? c.color : 'var(--border2)')};background:${c.done ? 'var(--green)' : 'transparent'};display:flex;align-items:center;justify-content:center;font-size:9px;color:#000;transition:all .15s;">${c.done ? '✓' : ''}</div>
        <span style="font-size:13px;line-height:1">${c.icon}</span>
        <span style="font-size:12px;font-weight:700;flex:1;color:${c.done ? 'var(--text3)' : (i === done ? 'var(--text)' : 'var(--text2)')};text-decoration:${c.done ? 'line-through' : 'none'};">${escapeHTML(c.l)}</span>
        ${!c.done && i === done ? `<span style="font-size:8px;font-family:'Space Mono',monospace;color:${c.color};letter-spacing:1px">NOW</span>` : ''}
      </div>
    `).join('')}
    ${allDone ? `<div style="text-align:center;padding:16px;font-size:11px;font-weight:700;color:var(--green);font-family:'Space Mono',monospace;letter-spacing:2px;margin-top:4px">✓ ALL DONE</div>` : ''}
    <div style="margin-top:18px;border-top:1px solid var(--border);padding-top:14px">
      <div style="font-size:8px;font-family:'Space Mono',monospace;color:var(--text3);letter-spacing:2px;text-transform:uppercase;margin-bottom:7px">QUICK NOTE — optional</div>
      <textarea id="sessionNote" placeholder="e.g. left off at weight painting the hood..." oninput="saveSessionNote(this.value)" style="width:100%;min-height:64px;background:var(--bg3);border:1px solid var(--border);border-radius:5px;padding:9px 11px;color:var(--text2);font-family:'Space Mono',monospace;font-size:10px;outline:none;resize:none;line-height:1.6;transition:border-color .15s;">${escapeHTML(sessionNote)}</textarea>
    </div>
  `;
  const ta = document.getElementById('sessionNote');
  if (ta) {
    ta.addEventListener('focus', () => ta.style.borderColor = 'var(--accent)');
    ta.addEventListener('blur',  () => ta.style.borderColor = 'var(--border)');
  }
}

async function toggleCk(i) {
  CHECKLIST[i].done = !CHECKLIST[i].done;
  await saveActiveProject();
  const doneCount = CHECKLIST.filter(c => c.done).length;
  setPipe(Math.min(doneCount, PIPELINE.length - 1));
  renderChecklist();
  refreshInfoPanel();
  logAction(`${CHECKLIST[i].l} marked ${CHECKLIST[i].done ? 'done' : 'undone'}`, CHECKLIST[i].done ? 'ok' : 'info');
}

// ── PROJECTS LIST ──
let projects      = [];
let currentSort   = 'date';
let activeFilters = new Set();

async function loadProjects() {
  const rows = await scanVault(globalSettings.root_path);
  projects = rows.map(r => ({ ...r, active: false }));
  document.getElementById('sbCnt').textContent = projects.length + ' projects';
}

function renderProjects() {
  const q = (document.getElementById('searchInput').value || '').toLowerCase();
  let filtered = projects.filter(p => {
    const matchQ = p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
    const matchFilter = activeFilters.size === 0
      || (activeFilters.has('wip')  && p.stage < PIPELINE.length)
      || (activeFilters.has('done') && p.stage >= PIPELINE.length);
    return matchQ && matchFilter;
  });

  if (currentSort === 'name')  filtered.sort((a, b) => a.name.localeCompare(b.name));
  if (currentSort === 'stage') filtered.sort((a, b) => b.stage - a.stage);

  const list = document.getElementById('plist');
  if (!filtered.length) {
    list.innerHTML = `<div style="padding:20px;text-align:center;font-size:9px;font-family:'Space Mono',monospace;color:var(--text3)">No projects found</div>`;
    return;
  }

  const pIndices = filtered.map(p => projects.indexOf(p));

  list.innerHTML = filtered.map((p, i) => `
    <div class="pcard ${p.active ? 'active' : ''}" onclick="selectProject(${pIndices[i]})" style="animation-delay:${i * .04}s">
      <div class="pcard-top">
        <div class="pc-thumb" onclick="event.stopPropagation();triggerThumb(${pIndices[i]})" title="Set cover image">
          ${p.thumb ? `<img src="${p.thumb}">` : `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`}
        </div>
        <div class="pc-name">${escapeHTML(p.name)}</div>
      </div>
      <div class="pc-bot">
        <span class="pc-date">${p.date}</span>
        <div class="fmini">
          ${FOLDERS.map((f, fi) => `<div class="fmd ${fi < p.stage ? 'has' : ''}" style="background:${f.color}"></div>`).join('')}
        </div>
      </div>
    </div>
  `).join('');
}

async function selectProject(i) {
  projects.forEach((p, j) => p.active = j === i);
  renderProjects();

  const emptyState = document.getElementById('emptyState');
  const projectContent = document.getElementById('projectContent');
  if (!projects[i]) {
    emptyState.style.display = 'flex';
    projectContent.style.display = 'none';
    return;
  }
  emptyState.style.display = 'none';
  projectContent.style.display = '';
  const p = projects[i];
  projectLog = [];

  // Reset checklist state before loading new project's data
  CHECKLIST.forEach(c => c.done = false);
  sessionNote = '';

  try {
    const data = await loadProject(globalSettings.root_path, p.id, p.name);
    ALL_FILES.length = 0;
    let projectDir = globalSettings.root_path ? await join(globalSettings.root_path, p.id + '_' + p.name) : '';
    if (projectDir) projectDir = projectDir.replace(/\\/g, '/');

    // Sync files from disk and merge with project.json
    const diskFiles = globalSettings.root_path ? await syncProjectFiles(globalSettings.root_path, p.id, p.name) : [];
    const jsonFiles = (data && data.files) || [];

    // Merge: prefer JSON version (has app metadata), add disk-only files
    const seen = new Set();
    for (const f of jsonFiles) {
      const key = f.folder + '/' + f.name;
      seen.add(key);
      const meta = FOLDER_META[f.folder] || { color: 'var(--text3)', icon: '📄' };
      ALL_FILES.push({ name: f.name, folder: f.folder, ext: f.ext, size: formatBytes(f.size_bytes), sizeBytes: f.size_bytes, date: f.created_at, app: f.app, icon: meta.icon, ec: meta.color, _path: projectDir ? projectDir + '/' + f.folder + '/' + f.name : '' });
    }
    for (const f of diskFiles) {
      const key = f.folder + '/' + f.name;
      if (seen.has(key)) continue;
      seen.add(key);
      const meta = FOLDER_META[f.folder] || { color: 'var(--text3)', icon: '📄' };
      ALL_FILES.push({ name: f.name, folder: f.folder, ext: f.ext, size: formatBytes(f.size_bytes), sizeBytes: f.size_bytes, date: f.created_at, app: f.app, icon: meta.icon, ec: meta.color, _path: projectDir ? projectDir + '/' + f.folder + '/' + f.name : '' });
    }

    if (data) {
      (data.checklist || []).forEach(row => {
        const c = CHECKLIST.find(c => c.l === row.label);
        if (c) c.done = row.done;
      });
      sessionNote = data.note || '';
      window._currentExports = (data.exports || []).slice();
    }
  } catch (e) { console.error('selectProject load error:', e); showToast('Error loading project: ' + e, 'var(--red)'); }

  const rootLabel = globalSettings.root_path ? globalSettings.root_path.split(/[/\\]/).pop() : '3D_Assets';
  document.getElementById('phId').textContent   = p.id;
  document.getElementById('phName').textContent = p.name;
document.getElementById('crumb').innerHTML    = '<b>' + p.id + '</b> <span style="color:var(--text3)">/ ' + escapeHTML(p.name) + '</span>';
  document.getElementById('phPath').innerHTML   = `<span class="seg">${escapeHTML(rootLabel)}</span><span style="color:var(--text3)">›</span><span class="seg" style="color:var(--accent)">${p.id} — ${escapeHTML(p.name)}</span>`;

  // Reset view state when switching projects
  currentFolder = null;
  document.querySelectorAll('.vtab').forEach(t => t.classList.remove('active'));
  document.querySelector('.vtab').classList.add('active');
  setVTab(null, 'folders');

  updateHeaderThumb();
  // skipDb=true: stage is already in p.stage, no need to write back
  await setPipe(Math.max(0, p.stage - 1), true);
  refreshFolders();
  logAction(`Project "${p.name}" opened`, 'info');
}

// ── INFO PANEL ──
function refreshInfoPanel() {
  const p = projects.find(x => x.active);
  if (!p) return;

  // Stage label
  const stageIdx = Math.max(0, Math.min(p.stage - 1, PIPELINE.length - 1));
  const stageEl  = document.getElementById('piStage');
  if (stageEl) {
    stageEl.textContent = PIPELINE[stageIdx]?.label + ' (' + p.stage + '/' + PIPELINE.length + ')';
    stageEl.className   = 'iv ' + (p.stage >= PIPELINE.length ? 'ok' : 'warn');
  }

  // Pipeline % (setPipe owns ppct/pfill; sync here too for initial load)
  const pipePct = Math.round(((stageIdx) / (PIPELINE.length - 1)) * 100);
  const ppct = document.getElementById('ppct');
  const pfill = document.getElementById('pfill');
  if (ppct) ppct.textContent = pipePct + '%';
  if (pfill) pfill.style.width = pipePct + '%';

  const ckDone  = CHECKLIST.filter(c => c.done).length;
  const ckTotal = CHECKLIST.length;
  const ckPct   = ckTotal > 0 ? Math.round((ckDone / ckTotal) * 100) : 0;

  const folderStats = {};
  ALL_FILES.forEach(f => {
    if (!folderStats[f.folder]) folderStats[f.folder] = { count: 0, bytes: 0 };
    folderStats[f.folder].count++;
    folderStats[f.folder].bytes += (f.sizeBytes || 0);
  });
  const populated  = Object.values(folderStats).filter(s => s.count > 0).length;
  const totalFolders = FOLDERS.length;
  const folderPct  = totalFolders > 0 ? Math.round((populated / totalFolders) * 100) : 0;
  const totalBytes = ALL_FILES.reduce((sum, f) => sum + (f.sizeBytes || 0), 0);

  const foldersSpan = document.getElementById('piFoldersPct');
  const foldersFill = document.getElementById('piFoldersFill');
  const checkSpan   = document.getElementById('piCheckPct');
  const checkFill   = document.getElementById('piCheckFill');
  if (foldersSpan) foldersSpan.textContent = `${populated} / ${totalFolders}`;
  if (foldersFill) foldersFill.style.width = folderPct + '%';
  if (checkSpan)   checkSpan.textContent   = `${ckDone} / ${ckTotal}`;
  if (checkFill)   checkFill.style.width   = ckPct + '%';

  const totalSizeEl = document.getElementById('piTotalSize');
  if (totalSizeEl) totalSizeEl.textContent = formatBytes(totalBytes);

  const storageRows = document.getElementById('piStorageRows');
  if (storageRows) {
    storageRows.innerHTML = FOLDERS.map(f => {
      const stats = folderStats[f.key];
      return `<div class="irow"><span class="ik">${f.key}/</span><span class="iv ${stats ? '' : 'warn'}">${stats ? formatBytes(stats.bytes) : '— empty'}</span></div>`;
    }).join('');
  }

  document.getElementById('fhgrid').innerHTML = FOLDERS.slice(0, 6).map(f => {
    const stats = folderStats[f.key] || { count: 0, bytes: 0 };
    return `<div class="fhcard" onclick="drillFolder('${f.key}')"><div class="fh-n">${f.key}/</div><div class="fh-v" style="color:${f.color}">${stats.count}</div><div class="fh-s">${stats.count > 0 ? formatBytes(stats.bytes) : 'empty'}</div></div>`;
  }).join('');
}

// ── TAB SWITCHING ──
function setVTab(el, tab) {
  if (el) { document.querySelectorAll('.vtab').forEach(t => t.classList.remove('active')); el.classList.add('active'); }
  document.getElementById('vFolders').style.display   = tab === 'folders'   ? 'block' : 'none';
  document.getElementById('vFiles').style.display     = tab === 'files'     ? 'block' : 'none';
  document.getElementById('vChecklist').style.display = tab === 'checklist' ? 'block' : 'none';
  if (tab === 'files')     renderFileList(currentFolder);
  if (tab === 'checklist') renderChecklist();
}

function setPTab(el, name) {
  document.querySelectorAll('.ptab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  ['pInfo', 'pActions', 'pLog'].forEach(id => document.getElementById(id).style.display = 'none');
  document.getElementById('p' + name).style.display = 'block';
  if (name === 'Log') renderLog();
}

function setSort(el, key) {
  currentSort = key;
  document.querySelectorAll('.sort-row .chip[data-sort]').forEach(c => c.classList.remove('on'));
  el.classList.add('on');
  renderProjects();
}

function toggleFilter(el, key) {
  if (activeFilters.has(key)) { activeFilters.delete(key); el.classList.remove('ac'); }
  else { activeFilters.add(key); el.classList.add('ac'); }
  renderProjects();
}

// ── MODAL ──
function openModal()  { document.getElementById('overlay').classList.add('open'); setTimeout(() => document.getElementById('nName').focus(), 200); }
function closeModal() { document.getElementById('overlay').classList.remove('open'); }
function closeOvOut(e) { if (e.target === document.getElementById('overlay')) closeModal(); }
function toggleFci(el) { el.classList.toggle('on'); el.querySelector('.fcbox').textContent = el.classList.contains('on') ? '✓' : ''; }

async function createProject() {
  const name = document.getElementById('nName').value.trim();
  if (!name) { document.getElementById('nName').style.borderColor = 'var(--red)'; return; }

  // Read which folders are checked in the modal
  const checkedFolders = [...document.querySelectorAll('.fchk .fci.on .fcname')].map(el => el.textContent.trim());
  const foldersToCreate = FOLDERS.filter(f => checkedFolders.includes(f.key));
  if (!foldersToCreate.length) { showToast('Select at least one folder', 'var(--orange)'); return; }
  if (!globalSettings.root_path) { showToast('Set Root Path in settings first', 'var(--orange)'); return; }

  const id      = 'PRJ-' + (crypto.randomUUID ? crypto.randomUUID().slice(0,8).toUpperCase() : Math.floor(Math.random() * 0xFFFFF).toString(16).toUpperCase().padStart(5, '0'));
  const dateStr = new Date().toLocaleDateString();

  try {
    const projectDir = await join(globalSettings.root_path, id + '_' + name);
    if (!(await exists(projectDir))) await mkdir(projectDir, { recursive: true });
    for (const f of foldersToCreate) {
      const fp = await join(projectDir, f.key);
      if (!(await exists(fp))) await mkdir(fp, { recursive: true });
    }
    const projectData = {
      id, name, date: dateStr, stage: 1, thumb: null,
      release_date: null,
      files: [],
      checklist: CHECKLIST.map(c => ({ label: c.l, done: false })),
      note: '',
    };
    await saveProject(globalSettings.root_path, projectData);
  } catch (e) { showToast('Error: ' + e, 'var(--red)'); return; }
  await loadProjects();

  closeModal();
  document.getElementById('nName').value = '';
  document.getElementById('nName').style.borderColor = '';
  showToast(`Project "${name}" created`, 'var(--green)');

  // Auto-select the newly created project
  const newIdx = projects.findIndex(p => p.id === id);
  if (newIdx !== -1) await selectProject(newIdx);
  else renderProjects();
}

// ── GALLERY ──
let galleryFilter = 'all';
let galleryView = 'grid';

function openGallery()  { document.getElementById('galleryOverlay').style.display = 'flex'; renderGallery(); }
function closeGallery() { document.getElementById('galleryOverlay').style.display = 'none'; }

function setGalleryFilter(el, val) {
  galleryFilter = val;
  document.querySelectorAll('#galleryFilters .chip').forEach(c => c.classList.remove('on'));
  el.classList.add('on');
  renderGallery();
}

function setGalleryView(view) {
  galleryView = view;
  document.querySelectorAll('#galleryViewToggle .chip').forEach(c => c.classList.remove('on'));
  document.querySelector(`#galleryViewToggle .chip[data-view="${view}"]`).classList.add('on');
  renderGallery();
}

// ── GALLERY CALENDAR STATE ──
let galCalView = 'month'; // 'year' | 'month' | 'week'
let galCalYear = new Date().getFullYear();
let galCalMonth = new Date().getMonth();
let galCalDay = new Date().getDate();
let _galCalDateTarget = -1; // project index being assigned a date

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAY_NAMES_SHORT = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

function pad2(n) { return String(n).padStart(2,'0'); }

function getDateStr(y,m,d) { return y + '-' + pad2(m+1) + '-' + pad2(d); }

// Hidden date picker for setting release dates from calendar
const _calDateInput = document.createElement('input');
_calDateInput.type = 'date';
_calDateInput.style.display = 'none';
_calDateInput.addEventListener('change', function() {
  if (_galCalDateTarget >= 0 && this.value) {
    galCalSetReleaseFor(_galCalDateTarget, this.value);
  }
  this.value = '';
  _galCalDateTarget = -1;
});
document.body.appendChild(_calDateInput);

function triggerDatePicker(projectIdx) {
  _galCalDateTarget = projectIdx;
  _calDateInput.showPicker ? _calDateInput.showPicker() : _calDateInput.click();
}

function getFilteredProjects() {
  const q = (document.getElementById('gallerySearch').value || '').toLowerCase();
  return projects.filter(p => {
    const matchQ = p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
    const matchF = galleryFilter === 'all' || (galleryFilter === 'done' && p.stage >= PIPELINE.length) || (galleryFilter === 'wip' && p.stage < PIPELINE.length);
    return matchQ && matchF;
  });
}

function buildDateLookup(filtered) {
  const byDate = {}, filteredSet = new Set(filtered);
  for (let i = 0; i < projects.length; i++) {
    if (!filteredSet.has(projects[i])) continue;
    const rd = projects[i].release_date;
    if (rd) { (byDate[rd] || (byDate[rd] = [])).push(i); }
  }
  return byDate;
}

function calItemHtml(pi) {
  const pp = projects[pi];
  return `<div class="cal-item gal-cal-item" onclick="event.stopPropagation();openFromGallery(${pi})" title="${escapeHTML(pp.name)}">
    ${pp.thumb ? `<img src="${pp.thumb}" class="cal-item-thumb">` : `<div class="cal-item-no-thumb">📄</div>`}
    <span>${escapeHTML(pp.name)}</span>
  </div>`;
}

function unscheduledItemHtml(pi) {
  const pp = projects[pi];
  const stageLabel = ['Blender','Painter','Unity','Package','Upload'][Math.min(pp.stage-1,4)] || '';
  const stageColor = ['var(--c-blender)','var(--c-subs)','var(--c-unity)','var(--c-fbx)','var(--c-export)'][Math.min(pp.stage-1,4)] || '';
  return `<div class="us-card" title="${escapeHTML(pp.name)}">
    <div class="us-thumb" onclick="openFromGallery(${pi})">
      ${pp.thumb ? `<img src="${pp.thumb}">` : `<div class="us-thumb-ph">📄</div>`}
    </div>
    <div class="us-body">
      <div class="us-name" onclick="openFromGallery(${pi})">${escapeHTML(pp.name)}</div>
      <div class="us-meta">
        <span class="us-stage" style="background:${stageColor}18;color:${stageColor}">${stageLabel}</span>
        <span class="us-date">created ${pp.date}</span>
      </div>
    </div>
    <button class="us-set-btn" onclick="event.stopPropagation();triggerDatePicker(${pi})" title="Set release date">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      Set date
    </button>
  </div>`;
}

function renderGallery() {
  if (galleryView === 'calendar') { renderGalleryCalendar(); return; }
  const STAGE_COLORS = ['var(--c-blender)', 'var(--c-subs)', 'var(--c-unity)', 'var(--c-fbx)', 'var(--c-export)'];
  const STAGE_LABELS = ['Blender', 'Painter', 'Unity', 'Package', 'Upload'];

  const filtered = getFilteredProjects();

  const grid = document.getElementById('galleryGrid');
  grid.style.display = 'grid';
  if (!filtered.length) { grid.innerHTML = `<div style="grid-column:1/-1;padding:60px;text-align:center;font-size:11px;font-family:'Space Mono',monospace;color:var(--text3)">No projects found</div>`; return; }

  grid.innerHTML = filtered.map((p, i) => {
    const pct        = Math.round(((p.stage - 1) / (PIPELINE.length - 1)) * 100);
    const stageColor = STAGE_COLORS[Math.min(p.stage - 1, STAGE_COLORS.length - 1)];
    const stageLabel = STAGE_LABELS[Math.min(p.stage - 1, STAGE_LABELS.length - 1)];
    const idx = projects.indexOf(p);
    return `
      <div class="gcard ${p.active ? 'active-proj' : ''}" style="animation-delay:${i * .03}s" onclick="openFromGallery(${idx})">
        <div class="gthumb">
          ${p.thumb ? `<img src="${p.thumb}">` : `<div class="gthumb-placeholder"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg><span style="font-size:8px;font-family:'Space Mono',monospace;letter-spacing:1px">NO IMAGE</span></div>`}
          <div class="gthumb-upload" onclick="event.stopPropagation();triggerThumb(${idx})">📷 SET IMAGE</div>
        </div>
        <div class="gstage-bar"><div class="gstage-fill" style="width:${pct}%;background:${stageColor}"></div></div>
        <div class="ginfo">
          <div class="g-id">${p.id}</div>
          <div class="g-name">${escapeHTML(p.name)}</div>
          <div class="g-stage-label" style="background:${stageColor}18;color:${stageColor}">
            <span style="width:5px;height:5px;border-radius:50%;background:${stageColor};display:inline-block"></span> ${stageLabel}
          </div>
          <div class="g-meta">
            <span class="g-date">${p.date}</span>
            <div class="g-dots">${FOLDERS.map((f, fi) => `<div class="fmd ${fi < p.stage ? 'has' : ''}" style="background:${f.color};width:5px;height:5px;border-radius:1px"></div>`).join('')}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

// ── CALENDAR DISPATCHER ──
function renderGalleryCalendar() {
  const grid = document.getElementById('galleryGrid');
  grid.style.display = 'block';
  if (galCalView === 'year')  renderCalYear(grid);
  else if (galCalView === 'week') renderCalWeek(grid);
  else renderCalMonth(grid);
}

function galCalSetView(view) {
  galCalView = view;
  renderGalleryCalendar();
}

// ── YEAR VIEW ──
function renderCalYear(grid) {
  const now = new Date();
  const todayStr = getDateStr(now.getFullYear(), now.getMonth(), now.getDate());
  const filtered = getFilteredProjects();
  const byDate = buildDateLookup(filtered);

  let monthsHtml = '';
  for (let m = 0; m < 12; m++) {
    const firstDay = new Date(galCalYear, m, 1);
    const lastDay = new Date(galCalYear, m + 1, 0);
    const startPad = firstDay.getDay();
    const totalDays = lastDay.getDate();

    let cells = '';
    for (let w = 0; w < 6; w++) {
      for (let d = 0; d < 7; d++) {
        const dayNum = w * 7 + d - startPad + 1;
        if (dayNum < 1 || dayNum > totalDays) { cells += '<div class="yr-day"></div>'; continue; }
        const dateStr = getDateStr(galCalYear, m, dayNum);
        const isToday = dateStr === todayStr;
        const count = (byDate[dateStr] || []).length;
        cells += `<div class="yr-day ${isToday ? 'yr-today' : ''}" onclick="galCalGoMonth(${m})">
          <span class="yr-dnum">${dayNum}</span>
          ${count ? `<span class="yr-dot" style="background:var(--accent)"></span>` : ''}
        </div>`;
      }
    }

    monthsHtml += `<div class="yr-month" onclick="galCalGoMonth(${m})">
      <div class="yr-mtitle">${MONTH_NAMES[m].slice(0,3)}</div>
      <div class="yr-grid">${cells}</div>
    </div>`;
  }

  grid.innerHTML = `
    <div class="cal-wrap">
      <div class="cal-head">
        <button onclick="galCalPrev()">◀</button>
        <div class="cal-title">${galCalYear}</div>
        <button onclick="galCalNext()">▶</button>
        <button class="cal-today" onclick="galCalToday()">Today</button>
        <div class="cal-view-toggle">
          <button class="${galCalView==='year'?'on':''}" onclick="galCalSetView('year')">Year</button>
          <button class="${galCalView==='month'?'on':''}" onclick="galCalSetView('month')">Month</button>
          <button class="${galCalView==='week'?'on':''}" onclick="galCalSetView('week')">Week</button>
        </div>
      </div>
      <div class="yr-wrap">${monthsHtml}</div>
    </div>
  `;
}

// ── MONTH VIEW ──
function renderCalMonth(grid) {
  const now = new Date();
  const todayStr = getDateStr(now.getFullYear(), now.getMonth(), now.getDate());
  const firstDay = new Date(galCalYear, galCalMonth, 1);
  const lastDay = new Date(galCalYear, galCalMonth + 1, 0);
  const startPad = firstDay.getDay();
  const totalDays = lastDay.getDate();

  const filtered = getFilteredProjects();
  const byDate = buildDateLookup(filtered);

  let cells = '';
  for (let w = 0; w < 6; w++) {
    for (let d = 0; d < 7; d++) {
      const dayNum = w * 7 + d - startPad + 1;
      if (dayNum < 1 || dayNum > totalDays) { cells += '<div class="cal-day cal-day-sm other-month"></div>'; continue; }
      const dateStr = getDateStr(galCalYear, galCalMonth, dayNum);
      const isToday = dateStr === todayStr;
      const dayProjects = byDate[dateStr] || [];

      let items = '';
      for (const pi of dayProjects) items += calItemHtml(pi);

      cells += `<div class="cal-day cal-day-sm ${isToday ? 'today' : ''}">
        <div class="cal-dnum" onclick="galCalSetRelease('${dateStr}')" title="Set release date for active project">${dayNum}</div>
        ${items}
      </div>`;
    }
  }

  let unscheduledHtml = renderUnscheduled(filtered);

  grid.innerHTML = `
    <div class="cal-wrap">
      <div class="cal-head">
        <button onclick="galCalPrev()">◀</button>
        <div class="cal-title">${MONTH_NAMES[galCalMonth]} ${galCalYear}</div>
        <button onclick="galCalNext()">▶</button>
        <button class="cal-today" onclick="galCalToday()">Today</button>
        <div class="cal-view-toggle">
          <button class="${galCalView==='year'?'on':''}" onclick="galCalSetView('year')">Year</button>
          <button class="${galCalView==='month'?'on':''}" onclick="galCalSetView('month')">Month</button>
          <button class="${galCalView==='week'?'on':''}" onclick="galCalSetView('week')">Week</button>
        </div>
      </div>
      <div class="cal-grid cal-grid-sm">
        ${DAY_NAMES_SHORT.map(n => `<div class="cal-dow">${n}</div>`).join('')}
        ${cells}
      </div>
      ${unscheduledHtml}
    </div>
  `;
}

// ── WEEK VIEW ──
function renderCalWeek(grid) {
  const now = new Date();
  const todayStr = getDateStr(now.getFullYear(), now.getMonth(), now.getDate());

  // Find the Monday of the current week
  const weekStart = new Date(galCalYear, galCalMonth, galCalDay);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Sunday
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const filtered = getFilteredProjects();
  const byDate = buildDateLookup(filtered);

  let colWidth = Math.round(100 / 7 * 10) / 10;
  let cols = '';
  for (let d = 0; d < 7; d++) {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + d);
    const dateStr = getDateStr(date.getFullYear(), date.getMonth(), date.getDate());
    const isToday = dateStr === todayStr;
    const dayProjects = byDate[dateStr] || [];

    let items = '';
    for (const pi of dayProjects) items += calItemHtml(pi);

    cols += `<div class="wk-col ${isToday ? 'wk-today' : ''}" style="width:${colWidth}%">
      <div class="wk-col-head" onclick="galCalSetRelease('${dateStr}')" title="Set release date for active project">
        <div class="wk-dname">${DAY_NAMES_SHORT[d]}</div>
        <div class="wk-dnum ${isToday ? 'wk-dnum-today' : ''}">${date.getDate()}</div>
      </div>
      <div class="wk-items">${items}</div>
    </div>`;
  }

  const titleStr = MONTH_NAMES[weekStart.getMonth()] + ' ' + weekStart.getDate() + ' — ' + MONTH_NAMES[weekEnd.getMonth()] + ' ' + weekEnd.getDate() + ', ' + weekEnd.getFullYear();

  grid.innerHTML = `
    <div class="cal-wrap">
      <div class="cal-head">
        <button onclick="galCalPrev()">◀</button>
        <div class="cal-title">${titleStr}</div>
        <button onclick="galCalNext()">▶</button>
        <button class="cal-today" onclick="galCalToday()">Today</button>
        <div class="cal-view-toggle">
          <button class="${galCalView==='year'?'on':''}" onclick="galCalSetView('year')">Year</button>
          <button class="${galCalView==='month'?'on':''}" onclick="galCalSetView('month')">Month</button>
          <button class="${galCalView==='week'?'on':''}" onclick="galCalSetView('week')">Week</button>
        </div>
      </div>
      <div class="wk-wrap">${cols}</div>
      ${renderUnscheduled(filtered)}
    </div>
  `;
}

// ── UNSCHEDULED RENDERER ──
function renderUnscheduled(filtered) {
  const list = filtered.filter(p => !p.release_date);
  if (!list.length) return '';
  let html = `<div class="us-section">
    <div class="us-head">
      <span class="us-head-label">UNSCHEDULED</span>
      <span class="us-head-count">${list.length} project${list.length !== 1 ? 's' : ''} without a release date</span>
    </div>
    <div class="us-grid">`;
  for (const up of list) html += unscheduledItemHtml(projects.indexOf(up));
  html += '</div></div>';
  return html;
}

// ── CALENDAR NAVIGATION ──
function galCalPrev() {
  if (galCalView === 'year') { galCalYear--; }
  else if (galCalView === 'week') {
    const d = new Date(galCalYear, galCalMonth, galCalDay);
    d.setDate(d.getDate() - 7);
    galCalYear = d.getFullYear(); galCalMonth = d.getMonth(); galCalDay = d.getDate();
  } else {
    galCalMonth--;
    if (galCalMonth < 0) { galCalMonth = 11; galCalYear--; }
  }
  renderGalleryCalendar();
}

function galCalNext() {
  if (galCalView === 'year') { galCalYear++; }
  else if (galCalView === 'week') {
    const d = new Date(galCalYear, galCalMonth, galCalDay);
    d.setDate(d.getDate() + 7);
    galCalYear = d.getFullYear(); galCalMonth = d.getMonth(); galCalDay = d.getDate();
  } else {
    galCalMonth++;
    if (galCalMonth > 11) { galCalMonth = 0; galCalYear++; }
  }
  renderGalleryCalendar();
}

function galCalToday() {
  const now = new Date();
  galCalYear = now.getFullYear();
  galCalMonth = now.getMonth();
  galCalDay = now.getDate();
  renderGalleryCalendar();
}

function galCalGoMonth(m) {
  galCalMonth = m;
  galCalView = 'month';
  renderGalleryCalendar();
}

function galCalSetRelease(dateStr) {
  const p = projects.find(x => x.active);
  if (!p) { showToast('Select a project first in the sidebar, or use 📅 in Unscheduled', 'var(--orange)'); return; }
  const idx = projects.indexOf(p);
  p.release_date = p.release_date === dateStr ? null : dateStr;
  saveReleaseDate(p);
  renderGalleryCalendar();
  showToast(p.release_date ? `Release set to ${dateStr}` : 'Release date cleared', 'var(--green)');
}

function galCalSetReleaseFor(idx, dateStr) {
  const p = projects[idx];
  if (!p) return;
  p.release_date = dateStr;
  saveReleaseDate(p);
  renderGalleryCalendar();
  showToast(`Release set to ${dateStr} for ${p.name}`, 'var(--green)');
}

function saveReleaseDate(p) {
  if (!globalSettings.root_path) return;
  const data = {
    id: p.id, name: p.name, date: p.date, stage: p.stage, thumb: p.thumb,
    release_date: p.release_date || null,
    files: ALL_FILES.map(f => ({ name: f.name, folder: f.folder, ext: f.ext, size_bytes: f.sizeBytes, app: f.app, created_at: f.date })),
    checklist: CHECKLIST.map(c => ({ label: c.l, done: c.done })),
    note: sessionNote,
    exports: window._currentExports || [],
  };
  saveProject(globalSettings.root_path, data);
}

function openFromGallery(idx) { closeGallery(); selectProject(idx); }

// ── AVATAR BASES ──
function openBases() {
  document.getElementById('basesOverlay').style.display = 'flex';
  renderBases();
}
function closeBases() { document.getElementById('basesOverlay').style.display = 'none'; }

async function renderBases() {
  const grid = document.getElementById('basesGrid');
  const count = document.getElementById('basesCount');
  const bp = globalSettings.bases_path;
  if (!bp) {
    count.textContent = '';
    grid.innerHTML = `<div style="grid-column:1/-1;padding:60px;text-align:center;font-size:11px;font-family:'Space Mono',monospace;color:var(--text3)">Set your Avatar Bases Path in Settings</div>`;
    return;
  }
  let entries;
  try { entries = await readDir(bp); }
  catch { count.textContent = ''; grid.innerHTML = `<div style="grid-column:1/-1;padding:60px;text-align:center;font-size:11px;font-family:'Space Mono',monospace;color:var(--text3)">Could not read bases path</div>`; return; }
  const files = entries.filter(e => !e.isDirectory);
  count.textContent = files.length + ' file' + (files.length !== 1 ? 's' : '');
  if (!files.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;padding:60px;text-align:center;font-size:11px;font-family:'Space Mono',monospace;color:var(--text3)">No base files found in that folder</div>`;
    return;
  }
  grid.innerHTML = files.map((e, i) => {
    const ext = e.name.includes('.') ? '.' + e.name.split('.').pop().toUpperCase() : '';
    const sizeStr = e.size ? formatBytes(e.size) : '';
    return `<div class="base-card" style="animation-delay:${i * .03}s">
      <div class="base-top">
        <div class="base-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        </div>
        <div class="base-info">
          <div class="base-name">${escapeHTML(e.name)}</div>
          <div class="base-meta">
            ${ext ? `<span class="base-ext">${ext}</span>` : ''}
            ${sizeStr ? `<span class="base-size">${sizeStr}</span>` : ''}
          </div>
        </div>
      </div>
      <button class="base-import" onclick="importBase('${escapeHTML(e.name).replace(/'/g, "\\'")}')">Import →</button>
    </div>`;
  }).join('');
}

async function importBase(fileName) {
  const p = projects.find(x => x.active);
  if (!p) { showToast('No active project', 'var(--red)'); return; }
  if (!globalSettings.root_path) { showToast('No Root Path set', 'var(--red)'); return; }
  if (!globalSettings.bases_path) { showToast('No Avatar Bases Path set', 'var(--red)'); return; }

  const srcPath = await join(globalSettings.bases_path, fileName);
  const projectDir = await join(globalSettings.root_path, p.id + '_' + p.name);
  const targetDir = await join(projectDir, 'blender');
  if (!(await exists(targetDir))) await mkdir(targetDir, { recursive: true });
  const destPath = await join(targetDir, fileName);

  try { await copyFile(srcPath, destPath); }
  catch (e) { showToast('Error: ' + String(e), 'var(--red)'); return; }

  logAction('Copied base ' + fileName + ' to blender/', 'ok');
  showToast(fileName + ' ready in blender/ — drag into Blender or File > Import', 'var(--green)');

  const idx = projects.indexOf(p);
  if (idx !== -1) await selectProject(idx);
  closeBases();
}

// ── EXPORTS MANAGEMENT (integrated into export/ folder view) ──
function buildExportSection() {
  const exports = window._currentExports || [];
  const fbxFiles = ALL_FILES.filter(f => f.folder === 'fbx');
  const assigned = new Set();
  for (const ex of exports) if (ex.fileNames) ex.fileNames.forEach(n => assigned.add(n));
  const unassigned = fbxFiles.filter(f => !assigned.has(f.name));

  let html = '<div id="exportSection" style="margin-bottom:10px">';
  html += '<div style="display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--bg2);border:1px solid var(--border);border-radius:6px;margin-bottom:10px">';
  html += '<span style="font-size:11px">📦</span>';
  html += '<span style="font-size:8px;font-weight:700;font-family:\'Space Mono\',monospace;letter-spacing:2px;color:var(--text2);flex:1">EXPORTS</span>';
  html += '<span style="font-size:7px;font-family:\'Space Mono\',monospace;color:var(--text3)">' + exports.length + ' record' + (exports.length !== 1 ? 's' : '') + ' · ' + fbxFiles.length + ' files</span>';
  html += '<button class="abtn" onclick="addExport()" style="margin:0;padding:4px 12px;height:auto;font-size:9px;background:var(--accent);color:#000;border-color:var(--accent);font-weight:700;">+ New Export</button>';
  html += '</div>';

  if (!exports.length) {
    html += '<div style="padding:20px;text-align:center;font-size:8px;font-family:\'Space Mono\',monospace;color:var(--text3);letter-spacing:1px;line-height:1.8">No exports recorded yet<br>Click <b style="color:var(--accent)">+ New Export</b> to group your FBX files by avatar</div>';
    if (unassigned.length) html += '<div style="padding:0 20px 14px;text-align:center;font-size:7px;font-family:\'Space Mono\',monospace;color:var(--text3)">' + unassigned.length + ' unassigned file' + (unassigned.length !== 1 ? 's' : '') + ' below</div>';
    html += '</div>';
    return html;
  }

  const groups = {};
  for (const ex of exports) { (groups[ex.target] || (groups[ex.target] = [])).push(ex); }
  const sortedTargets = Object.keys(groups).sort();

  for (const target of sortedTargets) {
    const items = groups[target];
    const hasFinal = items.some(x => x.isFinal);
    html += '<div style="margin-bottom:10px">';
    html += '<div style="display:flex;align-items:center;gap:6px;padding:4px 6px;margin-bottom:4px">';
    html += '<span style="font-size:7px;font-family:\'Space Mono\',monospace;letter-spacing:2px;font-weight:700;color:var(--text2)">' + escapeHTML(target) + '</span>';
    if (hasFinal) html += '<span style="font-size:6px;padding:1px 4px;border-radius:2px;background:var(--green);color:#000;font-family:\'Space Mono\',monospace;font-weight:700;letter-spacing:1px">FINAL</span>';
    html += '<span style="margin-left:auto;font-size:7px;font-family:\'Space Mono\',monospace;color:var(--text3)">' + items.length + ' export' + (items.length > 1 ? 's' : '') + '</span>';
    html += '</div>';
    items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    for (const ex of items) {
      const idx = exports.indexOf(ex);
      html += '<div class="exp-card" style="' + (ex.isFinal ? 'border-left-color:var(--green)' : '') + '">';
      html += '<div class="exp-top">';
      html += '<span class="exp-date">' + (ex.date || '—') + '</span>';
      if (ex.isFinal) html += '<span class="exp-badge-final">FINAL</span>';
      html += '<span class="exp-note-tag" style="margin-left:6px">' + (ex.note ? escapeHTML(ex.note) : '') + '</span>';
      html += '<div style="margin-left:auto;display:flex;gap:2px">';
      html += '<button class="exp-btn" onclick="toggleFinalExport(' + idx + ')" title="' + (ex.isFinal ? 'Unmark as final' : 'Mark as final') + '">★</button>';
      html += '<button class="exp-btn" onclick="deleteExport(' + idx + ')" title="Delete" style="color:var(--red)">✕</button>';
      html += '</div></div>';
      if (ex.fileNames && ex.fileNames.length) {
        html += '<div class="exp-files-list">';
        for (const fn of ex.fileNames) {
          const f = fbxFiles.find(x => x.name === fn);
          html += '<span class="exp-file-tag" style="' + (f ? 'background:' + f.ec + '18;color:' + f.ec : '') + '">' + escapeHTML(fn) + '</span>';
        }
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div>';
  }
  html += '</div>';
  return html;
}

function renderExports() {
  // Legacy - now builds into renderFileList
  const sec = document.getElementById('exportSection');
  if (sec) sec.outerHTML = buildExportSection();
}

function addExport() {
  const exports = window._currentExports || [];
  const targets = [...new Set(exports.map(e => e.target))];
  const targetHtml = targets.map(t => '<option value="' + escapeHTML(t).replace(/"/g, '&quot;') + '">' + escapeHTML(t) + '</option>').join('');
  const fbxFiles = ALL_FILES.filter(f => f.folder === 'fbx');
  const assigned = new Set();
  for (const ex of exports) if (ex.fileNames) ex.fileNames.forEach(n => assigned.add(n));
  const available = fbxFiles.filter(f => !assigned.has(f.name));

  const fileCheckboxes = available.map(f =>
    '<label style="display:flex;align-items:center;gap:6px;font-size:9px;color:var(--text2);cursor:pointer;padding:2px 0">' +
    '<input type="checkbox" class="_expFileCb" value="' + escapeHTML(f.name).replace(/"/g, '&quot;') + '" checked>' +
    '<span style="width:6px;height:6px;border-radius:1px;background:' + f.ec + ';display:inline-block"></span> ' +
    escapeHTML(f.name) +
    '</label>'
  ).join('');

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:500;display:flex;align-items:center;justify-content:center;';
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  const escHandler = e => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); } };
  document.addEventListener('keydown', escHandler);
  overlay.innerHTML = '<div style="background:var(--bg2);border:1px solid var(--border2);border-radius:8px;width:360px;padding:20px;display:flex;flex-direction:column;gap:10px;animation:fadeUp .15s ease;max-height:90vh;overflow-y:auto">'
    + '<div style="font-size:12px;font-weight:700">New Export</div>'
    + '<input id="_expTarget" list="_expTargets" placeholder="Target avatar (e.g. Base Male)" style="background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:8px 10px;color:var(--text);font-size:11px;outline:none" value="' + (targets.length === 1 ? escapeHTML(targets[0]).replace(/"/g, '&quot;') : '') + '">'
    + (targets.length ? '<datalist id="_expTargets">' + targetHtml + '</datalist>' : '')
    + '<input id="_expNote" placeholder="Note (e.g. v2 final)" style="background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:8px 10px;color:var(--text);font-size:11px;outline:none">'
    + '<input id="_expDate" type="date" value="' + new Date().toISOString().slice(0, 10) + '" style="background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:8px 10px;color:var(--text);font-size:11px;outline:none">'
    + (available.length ? '<div style="border-top:1px solid var(--border);padding-top:6px"><div style="font-size:7px;font-family:\'Space Mono\',monospace;letter-spacing:1px;color:var(--text3);margin-bottom:4px">INCLUDE FBX FILES</div>' + fileCheckboxes + '</div>' : '<div style="border-top:1px solid var(--border);padding-top:6px;font-size:8px;color:var(--text3);text-align:center;font-family:\'Space Mono\',monospace">All FBX files are already assigned to exports</div>')
    + '<div style="display:flex;gap:6px">'
    + '<label style="display:flex;align-items:center;gap:6px;font-size:10px;color:var(--text2);cursor:pointer"><input id="_expFinal" type="checkbox"> Mark as final</label>'
    + '</div>'
    + '<div style="display:flex;gap:6px;margin-top:4px">'
    + '<button onclick="this.closest(\'div[style*=\"position:fixed\"]\').remove()" style="flex:1;height:30px;background:var(--bg3);border:1px solid var(--border);border-radius:4px;color:var(--text2);cursor:pointer;font-size:10px;font-weight:600">Cancel</button>'
    + '<button onclick="saveExport(this)" style="flex:1;height:30px;background:var(--accent);color:#000;border:none;border-radius:4px;cursor:pointer;font-size:10px;font-weight:700">Save</button>'
    + '</div></div>';
  document.body.appendChild(overlay);
  setTimeout(() => document.getElementById('_expTarget')?.focus(), 100);
}

function saveExport(btn) {
  const overlay = btn.closest('div[style*="position:fixed"]');
  const target = document.getElementById('_expTarget')?.value?.trim();
  const note = document.getElementById('_expNote')?.value?.trim();
  const dateInput = document.getElementById('_expDate')?.value;
  const isFinal = document.getElementById('_expFinal')?.checked || false;

  if (!target) { showToast('Enter a target avatar name', 'var(--orange)'); return; }

  const selectedFiles = [];
  document.querySelectorAll('._expFileCb:checked').forEach(cb => selectedFiles.push(cb.value));

  const exports = window._currentExports || [];
  if (isFinal) {
    for (const ex of exports) { if (ex.target === target) ex.isFinal = false; }
  }
  exports.push({
    id: 'exp_' + Date.now().toString(36),
    target,
    date: dateInput || new Date().toISOString().slice(0, 10),
    note: note || '',
    isFinal,
    fileNames: selectedFiles,
  });
  window._currentExports = exports;
  overlay?.remove();
  saveActiveProject();
  renderFileList('fbx');
  showToast('Export logged for ' + target, 'var(--green)');
}

function toggleFinalExport(idx) {
  const exports = window._currentExports || [];
  const ex = exports[idx];
  if (!ex) return;
  if (ex.isFinal) {
    ex.isFinal = false;
  } else {
    for (const e of exports) { if (e.target === ex.target) e.isFinal = false; }
    ex.isFinal = true;
  }
  saveActiveProject();
  renderFileList('fbx');
}

function deleteExport(idx) {
  const exports = window._currentExports || [];
  exports.splice(idx, 1);
  window._currentExports = exports;
  saveActiveProject();
  renderFileList('fbx');
}

document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); openModal(); }
});

// ── THUMBNAIL ──
const thumbInput = document.createElement('input');
thumbInput.type = 'file'; thumbInput.accept = 'image/*'; thumbInput.style.display = 'none';
document.body.appendChild(thumbInput);
let thumbTargetIdx = null;

function triggerThumb(idx) { thumbTargetIdx = idx; thumbInput.click(); }

thumbInput.addEventListener('change', () => {
  const file = thumbInput.files[0];
  if (!file || thumbTargetIdx === null) return;
  const reader = new FileReader();
  reader.onload = async e => {
    const dataUrl = e.target.result;
    projects[thumbTargetIdx].thumb = dataUrl;
    renderProjects();
    updateHeaderThumb();
    if (document.getElementById('galleryOverlay').style.display !== 'none') renderGallery();
    try { await saveActiveProject(); }
    catch (err) { console.error('Failed to save thumb:', err); }
  };
  reader.readAsDataURL(file);
  thumbInput.value = '';
});

function updateHeaderThumb() {
  const active = projects.find(p => p.active);
  const el = document.getElementById('phThumb');
  if (!el || !active) return;
  el.innerHTML = active.thumb
    ? `<img src="${active.thumb}" style="width:100%;height:100%;object-fit:cover;display:block">`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text3)" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>`;
}

// ── HEADER ACTIONS ──
async function revealProjectRoot() {
  const p = projects.find(x => x.active);
  if (!p) { showToast('No project selected', 'var(--orange)'); return; }
  if (!globalSettings.root_path) { showToast('No Root Path set in Settings', 'var(--red)'); return; }
  const projectDir = await join(globalSettings.root_path, p.id + '_' + p.name);
  try { await invoke('open_in_app', { exePath: 'explorer', filePath: projectDir }); logAction('Opened project folder', 'info'); }
  catch (err) { showToast('Failed: ' + err, 'var(--red)'); }
}

async function copyProjectPath() {
  const p = projects.find(x => x.active);
  if (!p) { showToast('No project selected', 'var(--orange)'); return; }
  if (!globalSettings.root_path) { showToast('No Root Path set in Settings', 'var(--red)'); return; }
  const projectDir = await join(globalSettings.root_path, p.id + '_' + p.name);
  try { await navigator.clipboard.writeText(projectDir); showToast('Project path copied', 'var(--green)'); logAction('Copied project path', 'info'); }
  catch (err) { showToast('Failed to copy: ' + err, 'var(--red)'); }
}

// ── SETTINGS ──
let globalSettings = { root_path: '', blender_path: '', painter_path: '', unity_path: '', bases_path: '' };

async function loadSettings() {
  try {
    const data = await loadJSONSettings();
    Object.assign(globalSettings, data);
  } catch (e) { console.error('loadSettings error:', e); }
  Object.keys(globalSettings).forEach(k => { const el = document.getElementById('set_' + k); if (el) el.value = globalSettings[k]; });
}

async function saveSetting(key, value) {
  globalSettings[key] = value;
  const el = document.getElementById('set_' + key);
  if (el) el.value = value;
  try { await saveSettings(globalSettings); }
  catch (e) { showToast('Error saving setting', 'var(--red)'); }
}

async function openSettings() { await loadSettings(); document.getElementById('settingsOverlay').style.display = 'flex'; }
function closeSettings() { document.getElementById('settingsOverlay').style.display = 'none'; }

async function pickSettingPath(key, isDir) {
  try {
    const selected = await openDialog({ directory: isDir, multiple: false, defaultPath: globalSettings[key] || undefined });
    if (selected) { await saveSetting(key, selected); showToast('Path updated', 'var(--green)'); }
  } catch (err) { showToast('Failed to open dialog: ' + err, 'var(--red)'); }
}

// ── IMAGE VIEWER EVENTS ──
document.getElementById('imageViewer').addEventListener('click', closeImageViewer);
document.getElementById('ivClose').addEventListener('click', (e) => { e.stopPropagation(); closeImageViewer(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeImageViewer(); });

// ── EXPORTS ──
Object.assign(window, {
  renderPipeline, setPipe, renderFolders, refreshFolders, drillFolder, saveSessionNote,
  renderFileList, setFileView, goBackFolders,
  openFile, revealFile, copyPath, deleteFile, showCtx, removeCtx, createBlendFile,
  showToast, logAction, renderLog,
  renderChecklist, toggleCk,
  renderProjects, selectProject, refreshInfoPanel,
  setVTab, setPTab, setSort, toggleFilter,
  openModal, closeModal, closeOvOut, toggleFci, createProject,
  openGallery, closeGallery, setGalleryFilter, setGalleryView, renderGallery, openFromGallery,
  renderGalleryCalendar, galCalPrev, galCalNext, galCalToday, galCalSetView, galCalGoMonth, galCalSetRelease, triggerDatePicker,
  openBases, closeBases, importBase,
  addExport, saveExport, toggleFinalExport, deleteExport,
  triggerThumb, updateHeaderThumb,
  revealProjectRoot, copyProjectPath, saveActiveProject,
  openSettings, closeSettings, pickSettingPath,
  closeImageViewer,
});
