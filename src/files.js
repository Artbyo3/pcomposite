import { escapeHTML, formatBytes, isViewableImage, loadThumbnail } from './helpers.js';
import { FOLDERS, FOLDER_META, APP_ICONS } from './constants.js';
import { ALL_FILES, currentFolder, fileView, setCurrentFolder, setFileView as setFileViewState, ctxEl, setCtxEl, projects, globalSettings } from './state.js';
import { join, basename, extname } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { openPath } from '@tauri-apps/plugin-opener';
import { stat, mkdir, exists, rename, copyFile, remove, readFile } from '@tauri-apps/plugin-fs';
import { buildExportSection } from './exports.js';
import { setVTab, showToast, refreshInfoPanel } from './ui.js';
import { logAction } from './checklist.js';
import { selectProject, saveActiveProject } from './projects.js';
import { refreshFolders } from './folders.js';

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
      <div class="fr-nm-wrap"><span class="fr-nm">${escapeHTML(f.name)}</span>${fileToExport[f.name] ? '<span class="fr-tag">' + escapeHTML(fileToExport[f.name]) + '</span>' : ''}</div>
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
  setFileViewState(v);
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
  setCurrentFolder(null);
  document.querySelectorAll('.vtab').forEach(t => t.classList.toggle('active', t.textContent === 'Folders'));
  setVTab(null, 'folders');
}

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
  setCtxEl(menu);
  const r = menu.getBoundingClientRect();
  if (r.right  > window.innerWidth)  menu.style.left = (e.clientX - r.width) + 'px';
  if (r.bottom > window.innerHeight) menu.style.top  = (e.clientY - r.height) + 'px';
}
function removeCtx() { if (ctxEl) { ctxEl.remove(); setCtxEl(null); } }

export { renderFileList, loadVisibleThumbnails, setFileView, goBackFolders, createBlendFile, openFile, openImageViewer, closeImageViewer, revealFile, copyPath, deleteFile, showCtx, removeCtx }
