import { escapeHTML, isViewableImage, loadThumbnail, getToolFolders, toolHasCapability, getToolByFolderKey, getAppIcon } from './helpers.js';
import { ALL_FILES, currentFolder, fileView, setCurrentFolder, setFileView as setFileViewState, ctxEl, setCtxEl, projects, globalSettings } from './state.js';
import { join } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/core';
import { openPath } from '@tauri-apps/plugin-opener';
import { mkdir, exists, readFile } from '@tauri-apps/plugin-fs';
import { buildExportSection, loadExportCovers } from './exports.js';
import { writeBridgeContext } from './bridge.js';
import { setVTab, showToast, refreshInfoPanel } from './ui.js';
import { logAction } from './checklist.js';
import { selectProject, saveActiveProject } from './projects.js';
import { refreshFolders } from './folders.js';

function renderFileList(filterKey) {
  const files  = filterKey ? ALL_FILES.filter(f => f.folder === filterKey) : ALL_FILES;
  const folder = getToolFolders().find(f => f.key === filterKey);
  const cls    = filterKey ? 'no-folder' : 'with-folder';
  const hasFbxVer = filterKey ? toolHasCapability(filterKey, 'fbx_versioning') : false;
  const hasCreate = filterKey ? toolHasCapability(filterKey, 'create_file') : false;

  if (hasFbxVer) { writeBridgeContext(); }
  const exportSection = hasFbxVer ? buildExportSection() : '';
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
        ${hasFbxVer ? '<input id="fileFilter" class="file-filter-input" placeholder="filter files..." oninput="filterFileList(this.value)">' : ''}
        ${hasCreate ? `<button class="btn-create" style="background:${folder?.color || 'var(--accent)'}" onclick="createFile('${filterKey}')" title="Create a new file">+ New</button>` : ''}
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
    loadExportCovers();
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

  // Build a lookup of which exports own which files (for versioned export folders)
  const fileToExport = {};
  if (hasFbxVer) {
    const exps = window._currentExports || [];
    for (const ex of exps) if (ex.fileNames) for (const fn of ex.fileNames) fileToExport[fn] = ex.target;
  }

  const rows = files.map((f, fi) => `
    <div class="frow ${cls}" oncontextmenu="showCtx(event,${indices[fi]})" onclick="this.classList.toggle('sel')">
      <span class="fr-ico">${isViewableImage(f.ext) ? `<img class="fr-thumb" data-idx="${indices[fi]}" src="" style="width:28px;height:28px;object-fit:cover;border-radius:3px;vertical-align:middle;">` : f.icon}</span>
      <div class="fr-nm-wrap"><span class="fr-nm">${escapeHTML(f.name)}</span>${fileToExport[f.name] ? '<span class="fr-tag">' + escapeHTML(fileToExport[f.name]) + '</span>' : ''}${f.subfolder ? '<span class="fr-tag" style="background:var(--border2);color:var(--text2)">' + escapeHTML(f.subfolder) + '</span>' : ''}</div>
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
        <span style="font-size:11px">${getAppIcon(f.app)}</span>
        <span>Open in ${f.app}</span>
      </div>
    </div>
  `).join('');

  document.getElementById('fileListContent').innerHTML = toolbar + exportSection + head + `<div id="fileRows">${rows}</div>`;
  loadExportCovers();
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

window.createFile = async function(folderKey) {
  const p = projects.find(x => x.active);
  if (!p) { showToast('No active project', 'var(--red)'); return; }
  const tool = getToolByFolderKey(folderKey);
  if (!tool) { showToast('No tool for this folder', 'var(--red)'); return; }

  const projectDir = await join(globalSettings.root_path, p.id + '_' + p.name);
  const targetDir  = await join(projectDir, tool.folder_key);
  if (!(await exists(targetDir))) await mkdir(targetDir, { recursive: true });

  // Determine exe path: tool's exe_path or fallback by tool name
  const toolExe = tool.exe_path || {
    Blender: globalSettings.blender_path,
    'Substance Painter': globalSettings.painter_path,
    Unity: globalSettings.unity_path
  }[tool.name] || '';

  if (!toolExe) { showToast('No executable set for ' + tool.name + ' in Settings', 'var(--red)'); return; }

  // Pick an untitled name that doesn't collide
  let name = 'untitled';
  let ext = '.blend';
  let filePath = await join(targetDir, name + ext);
  let counter = 1;
  while (await exists(filePath)) {
    filePath = await join(targetDir, name + '-' + counter + ext);
    counter++;
  }

  try {
    // Create file using tool's capabilities; default to Blender headless for .blend
    const escapedPath = filePath.replace(/\\/g, '\\\\');
    if (tool.name === 'Blender') {
      await invoke('run_command', {
        exePath: toolExe,
        args: ['--background', '--python-expr',
          'import bpy; bpy.ops.wm.save_mainfile(filepath="' + escapedPath + '")'],
      });
      await invoke('open_in_app', { exePath: toolExe, filePath });
    } else {
      await invoke('open_in_app', { exePath: toolExe, filePath: targetDir });
    }
  } catch (e) { showToast('Error creating file: ' + String(e), 'var(--red)'); return; }

  logAction('Created ' + name + ext, 'ok');
  showToast('Created ' + name + ext, 'var(--green)');

  const idx = projects.indexOf(p);
  if (idx !== -1) await selectProject(idx);
};

async function openFile(idx) {
  const f = ALL_FILES[idx];
  if (!globalSettings.root_path) { showToast('No Root Path set in Settings', 'var(--red)'); return; }
  const p = projects.find(x => x.active);
  if (!p) return;
  const targetPath = f.subfolder
    ? await join(globalSettings.root_path, p.id + '_' + p.name, f.folder, f.subfolder, f.name)
    : await join(globalSettings.root_path, p.id + '_' + p.name, f.folder, f.name);

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
  const targetPath = f.subfolder
    ? await join(globalSettings.root_path, p.id + '_' + p.name, f.folder, f.subfolder, f.name)
    : await join(globalSettings.root_path, p.id + '_' + p.name, f.folder, f.name);
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
  const targetPath = f.subfolder
    ? await join(globalSettings.root_path, p.id + '_' + p.name, f.folder, f.subfolder, f.name)
    : await join(globalSettings.root_path, p.id + '_' + p.name, f.folder, f.name);
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
      <span class="ctx-ico">${getAppIcon(f.app)}</span> Open in ${f.app}
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

window.filterFileList = function(val) {
  const rows = document.querySelectorAll('#fileRows .frow');
  const q = val.toLowerCase().trim();
  for (const row of rows) {
    const name = row.querySelector('.fr-nm')?.textContent?.toLowerCase() || '';
    row.style.display = !q || name.includes(q) ? '' : 'none';
  }
  const visible = Array.from(rows).filter(r => r.style.display !== 'none').length;
  const cnt = document.querySelector('.file-breadcrumb span:last-child');
  if (cnt) cnt.textContent = '— ' + visible + ' of ' + rows.length + ' items';
};

export { renderFileList, setFileView, goBackFolders, openFile, openImageViewer, closeImageViewer, revealFile, copyPath, deleteFile, showCtx, removeCtx }
