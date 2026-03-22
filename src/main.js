import { open as openDialog } from '@tauri-apps/plugin-dialog';
import Database from '@tauri-apps/plugin-sql';
import { join, basename, extname } from '@tauri-apps/api/path';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { copyFile, stat, mkdir, exists, rename, remove } from '@tauri-apps/plugin-fs';
import { invoke } from '@tauri-apps/api/core';

// ── HELPERS ──
function escapeHTML(str) {
  if (!str) return '';
  const el = document.createElement('div');
  el.textContent = str;
  return el.innerHTML;
}

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, n = Number(bytes);
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return (i === 0 ? n : n.toFixed(1)) + ' ' + units[i];
}

// ── DB ──
let db = null;

async function initDB() {
  try {
    db = await Database.load('sqlite:pcomposite.db');
    await loadSettings();
    await loadProjects();
    renderProjects();
    updateHeaderThumb();
    initDragDrop();
  } catch (err) {
    console.error('Failed to load database:', err);
  }
}
window.addEventListener('DOMContentLoaded', initDB);

// ── DRAG & DROP ──
function initDragDrop() {
  getCurrentWebview().onDragDropEvent(async (event) => {
    if (event.payload.type === 'drop') {
      const paths = event.payload.paths;
      if (paths && paths.length > 0) await handleDroppedFiles(paths);
    }
  });
}

async function handleDroppedFiles(paths) {
  if (!globalSettings.root_path) { showToast('No Root Path set in Settings', 'var(--red)'); return; }
  const p = projects.find(x => x.active);
  if (!p) { showToast('No active project', 'var(--red)'); return; }

  let imported = 0;
  for (const filePath of paths) {
    try {
      const baseNm = await basename(filePath);
      let extStr = await extname(filePath);
      let ext = extStr ? '.' + extStr.toUpperCase() : '';
      const lowerExt = ext.toLowerCase();

      let destFolder = 'export';
      if (lowerExt === '.blend') destFolder = 'blender';
      else if (lowerExt === '.spp') destFolder = 'subs';
      else if (['.png','.jpg','.jpeg','.tga','.exr'].includes(lowerExt)) destFolder = 'pictures';
      else if (['.fbx','.obj'].includes(lowerExt)) destFolder = 'fbx';
      else if (['.mat','.unity','.prefab','.cs','.meta'].includes(lowerExt)) destFolder = 'unity';

      const projectDir = await join(globalSettings.root_path, p.id + '_' + p.name);
      const targetDir  = await join(projectDir, destFolder);
      if (!(await exists(targetDir))) await mkdir(targetDir, { recursive: true });

      const destPath = await join(targetDir, baseNm);
      if (await exists(destPath)) await remove(destPath);

      try { await rename(filePath, destPath); }
      catch { await copyFile(filePath, destPath); await remove(filePath); }

      const existing  = await db.select('SELECT id FROM files WHERE project_id=$1 AND name=$2 AND folder_name=$3', [p.id, baseNm, destFolder]);
      const fileInfo  = await stat(destPath);
      const sizeBytes = fileInfo.size;
      const app = { blender:'Blender', subs:'Painter', unity:'Unity', pictures:'Viewer' }[destFolder] || 'Explorer';
      const now = new Date().toLocaleDateString();

      if (existing?.length > 0)
        await db.execute('UPDATE files SET ext=$1,size_bytes=$2,app=$3,created_at=$4 WHERE id=$5', [ext, sizeBytes, app, now, existing[0].id]);
      else
        await db.execute('INSERT INTO files (project_id,folder_name,name,ext,size_bytes,app,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [p.id, destFolder, baseNm, ext, sizeBytes, app, now]);

      imported++;
    } catch (err) {
      showToast('Error: ' + String(err), 'var(--red)');
    }
  }

  if (imported > 0) {
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
    if (!p || !db) return;
    try { await db.execute('INSERT OR REPLACE INTO settings (key,value) VALUES ($1,$2)', ['note_' + p.id, value]); }
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

  if (!skipDb && db) {
    const p = projects.find(x => x.active);
    if (p) {
      p.stage = clampedI + 1;
      db.execute('UPDATE projects SET stage=$1 WHERE id=$2', [p.stage, p.id]);
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
        <div class="view-toggle">
          <button class="vt-btn ${fileView === 'list' ? 'on' : ''}" onclick="setFileView('list')" title="List view">≡</button>
          <button class="vt-btn ${fileView === 'grid' ? 'on' : ''}" onclick="setFileView('grid')" title="Grid view">⊞</button>
        </div>
      </div>
    </div>
  `;

  if (!files.length) {
    document.getElementById('fileListContent').innerHTML = toolbar + `
      <div class="file-empty">
        <div class="file-empty-icon">${folder?.icon || '📁'}</div>
        <div class="file-empty-text">This folder is empty</div>
        <div class="file-empty-sub">Drop files here — PCOMPOSITE sorts them automatically</div>
      </div>
    `;
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


  const rows = files.map(f => `
    <div class="frow ${cls}" oncontextmenu="showCtx(event,${ALL_FILES.indexOf(f)})" onclick="this.classList.toggle('sel')">
      <span class="fr-ico">${f.icon}</span>
      <div class="fr-nm-wrap"><span class="fr-nm">${escapeHTML(f.name)}</span></div>
      <div><span class="fr-ext" style="background:${f.ec}18;color:${f.ec}">${f.ext}</span></div>
      ${!filterKey ? `
        <div class="fr-fldr">
          <span style="width:6px;height:6px;border-radius:1px;background:${f.ec};display:inline-block;flex-shrink:0"></span>
          ${f.folder}/
        </div>` : ''
      }
      <span class="fr-sz">${f.size}</span>
      <span class="fr-dt">${f.date}</span>
      <div class="fr-open-btn" onclick="event.stopPropagation();openFile(${ALL_FILES.indexOf(f)})" title="Open in ${f.app}">
        <span style="font-size:11px">${APP_ICONS[f.app] || '📄'}</span>
        <span>Open in ${f.app}</span>
      </div>
    </div>
  `).join('');

  document.getElementById('fileListContent').innerHTML = toolbar + head + `<div id="fileRows">${rows}</div>`;
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

async function openFile(idx) {
  const f = ALL_FILES[idx];
  if (!globalSettings.root_path) { showToast('No Root Path set in Settings', 'var(--red)'); return; }
  const p = projects.find(x => x.active);
  if (!p) return;
  const targetPath = await join(globalSettings.root_path, p.id + '_' + p.name, f.folder, f.name);

  let exePath = { Blender: globalSettings.blender_path, Painter: globalSettings.painter_path, Unity: globalSettings.unity_path }[f.app] || '';

  if (!exePath && f.app !== 'Viewer' && f.app !== 'Explorer') {
    showToast('No executable set for ' + f.app + ' in Settings', 'var(--orange)'); return;
  }
  try {
    if (exePath) {
      await invoke('open_in_app', { exePath, filePath: targetPath });
      showToast('Launched ' + f.app, 'var(--green)');
      logAction(`Opened ${f.name} in ${f.app}`, 'ok');
    }
  } catch (err) {
    showToast('Failed to launch: ' + err, 'var(--red)');
    logAction(`Failed to open ${f.name}: ${err}`, 'err');
  }
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
  if (!p || !db) return;
  try {
    await db.execute('DELETE FROM files WHERE project_id=$1 AND name=$2 AND folder_name=$3', [p.id, f.name, f.folder]);
    ALL_FILES.splice(idx, 1);
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
  if (db) {
    const p = projects.find(x => x.active);
    if (p) await db.execute('UPDATE checklist SET done=$1 WHERE project_id=$2 AND label=$3', [CHECKLIST[i].done ? 1 : 0, p.id, CHECKLIST[i].l]);
  }
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
  if (!db) return;
  const rows = await db.select('SELECT * FROM projects ORDER BY created_at DESC');
  projects = rows.map(r => ({ id: r.id, name: r.name, date: r.created_at, stage: r.stage || 1, active: false, thumb: r.thumb }));
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

  document.getElementById('sbCnt').textContent = projects.length + ' projects';

  if (!filtered.length) {
    document.getElementById('plist').innerHTML = `<div style="padding:20px;text-align:center;font-size:9px;font-family:'Space Mono',monospace;color:var(--text3)">No projects found</div>`;
    return;
  }

  document.getElementById('plist').innerHTML = filtered.map((p, i) => `
    <div class="pcard ${p.active ? 'active' : ''}" onclick="selectProject(${projects.indexOf(p)})" style="animation-delay:${i * .04}s">
      <div class="pcard-top">
        <div class="pc-thumb" onclick="event.stopPropagation();triggerThumb(${projects.indexOf(p)})" title="Set cover image">
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
  if (!projects[i]) return;
  const p = projects[i];
  projectLog = [];

  // Reset checklist state before loading new project's data
  CHECKLIST.forEach(c => c.done = false);
  sessionNote = '';

  if (db) {
    try {
      const [fileRows, chRows, noteRows] = await Promise.all([
        db.select('SELECT * FROM files WHERE project_id=$1', [p.id]),
        db.select('SELECT * FROM checklist WHERE project_id=$1', [p.id]),
        db.select("SELECT value FROM settings WHERE key=$1", ['note_' + p.id]),
      ]);

      ALL_FILES.length = 0;
      fileRows.forEach(r => {
        const meta = FOLDER_META[r.folder_name] || { color: 'var(--text3)', icon: '📄' };
        ALL_FILES.push({ name: r.name, folder: r.folder_name, ext: r.ext, size: formatBytes(r.size_bytes), sizeBytes: r.size_bytes, date: r.created_at, app: r.app, icon: meta.icon, ec: meta.color });
      });

      chRows.forEach(row => {
        const c = CHECKLIST.find(c => c.l === row.label);
        if (c) c.done = row.done === 1;
      });

      if (noteRows.length > 0) sessionNote = noteRows[0].value || '';
    } catch (e) { console.error('selectProject load error:', e); }
  }

  const rootLabel = globalSettings.root_path ? globalSettings.root_path.split(/[/\\]/).pop() : '3D_Assets';
  document.getElementById('phId').textContent   = p.id;
  document.getElementById('phName').textContent = p.name;
document.getElementById('crumb').innerHTML    = '<b>' + p.id + '</b> <span style="color:var(--text3)">/ ' + escapeHTML(p.name) + '</span>';
  document.getElementById('phPath').innerHTML   = `<span class="seg">${escapeHTML(rootLabel)}</span><span style="color:var(--text3)">›</span><span class="seg" style="color:var(--accent)">${p.id} — ${escapeHTML(p.name)}</span>`;

  updateHeaderThumb();
  // skipDb=true: stage is already in p.stage, no need to write back
  await setPipe(Math.max(0, p.stage - 1), true);
  refreshFolders();
  logAction(`Project "${p.name}" opened`, 'info');
  // Do NOT call goBackFolders() — preserve the current tab
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
function selTmpl(el)  { document.querySelectorAll('.tmpl').forEach(t => t.classList.remove('sel')); el.classList.add('sel'); }
function toggleFci(el) { el.classList.toggle('on'); el.querySelector('.fcbox').textContent = el.classList.contains('on') ? '✓' : ''; }

async function createProject() {
  const name = document.getElementById('nName').value.trim();
  if (!name) { document.getElementById('nName').style.borderColor = 'var(--red)'; return; }

  // Read which folders are checked in the modal
  const checkedFolders = [...document.querySelectorAll('.fchk .fci.on .fcname')].map(el => el.textContent.trim());
  const foldersToCreate = FOLDERS.filter(f => checkedFolders.includes(f.key));
  if (!foldersToCreate.length) { showToast('Select at least one folder', 'var(--orange)'); return; }

  const id      = 'PRJ-' + Math.floor(Math.random() * 0xFFFFF).toString(16).toUpperCase().padStart(5, '0');
  const dateStr = new Date().toLocaleDateString();

  if (db) {
    try {
      await db.execute('INSERT INTO projects (id,name,created_at,updated_at,stage,thumb,platform_tags) VALUES ($1,$2,$3,$4,1,null,$5)', [id, name, dateStr, dateStr, '']);
      await Promise.all([
        ...foldersToCreate.map(f => db.execute('INSERT INTO folders (project_id,name,color,"desc") VALUES ($1,$2,$3,$4)', [id, f.key, f.color, f.desc])),
        ...CHECKLIST.map(c => db.execute('INSERT INTO checklist (project_id,label,done) VALUES ($1,$2,0)', [id, c.l])),
      ]);
      if (globalSettings.root_path) {
        const projectDir = await join(globalSettings.root_path, id + '_' + name);
        if (!(await exists(projectDir))) await mkdir(projectDir, { recursive: true });
        for (const f of foldersToCreate) {
          const fp = await join(projectDir, f.key);
          if (!(await exists(fp))) await mkdir(fp, { recursive: true });
        }
      }
    } catch (e) { showToast('Error: ' + e, 'var(--red)'); return; }
    await loadProjects();
  } else {
    projects.unshift({ id, name, date: dateStr, stage: 1, active: false, thumb: null });
  }

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
function openGallery()  { document.getElementById('galleryOverlay').style.display = 'flex'; renderGallery(); }
function closeGallery() { document.getElementById('galleryOverlay').style.display = 'none'; }
function setGalleryFilter(el, val) {
  galleryFilter = val;
  document.querySelectorAll('#galleryFilters .chip').forEach(c => c.classList.remove('on'));
  el.classList.add('on');
  renderGallery();
}

function renderGallery() {
  const q = (document.getElementById('gallerySearch').value || '').toLowerCase();
  const STAGE_COLORS = ['var(--c-blender)', 'var(--c-subs)', 'var(--c-unity)', 'var(--c-fbx)', 'var(--c-export)'];
  const STAGE_LABELS = ['Blender', 'Painter', 'Unity', 'Package', 'Upload'];

  const filtered = projects.filter(p => {
    const matchQ = p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
    const matchF = galleryFilter === 'all' || (galleryFilter === 'done' && p.stage >= PIPELINE.length) || (galleryFilter === 'wip' && p.stage < PIPELINE.length);
    return matchQ && matchF;
  });

  const grid = document.getElementById('galleryGrid');
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

function openFromGallery(idx) { closeGallery(); selectProject(idx); }

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
    if (db) {
      try { await db.execute('UPDATE projects SET thumb=$1 WHERE id=$2', [dataUrl, projects[thumbTargetIdx].id]); }
      catch (err) { console.error('Failed to save thumb:', err); }
    }
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
let globalSettings = { root_path: '', blender_path: '', painter_path: '', unity_path: '' };

async function loadSettings() {
  if (!db) return;
  try {
    const rows = await db.select('SELECT * FROM settings');
    rows.forEach(r => { globalSettings[r.key] = r.value; });
  } catch (e) { console.error('loadSettings error:', e); }
  Object.keys(globalSettings).forEach(k => { const el = document.getElementById('set_' + k); if (el) el.value = globalSettings[k]; });
}

async function saveSetting(key, value) {
  if (!db) return;
  globalSettings[key] = value;
  const el = document.getElementById('set_' + key);
  if (el) el.value = value;
  try { await db.execute('INSERT OR REPLACE INTO settings ("key","value") VALUES ($1,$2)', [key, value]); }
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

// ── INIT ──
renderPipeline();
renderFolders();
renderProjects();

// ── EXPORTS ──
Object.assign(window, {
  renderPipeline, setPipe, renderFolders, refreshFolders, drillFolder, saveSessionNote,
  renderFileList, setFileView, goBackFolders,
  openFile, revealFile, copyPath, deleteFile, showCtx, removeCtx,
  showToast, logAction, renderLog,
  renderChecklist, toggleCk,
  renderProjects, selectProject, refreshInfoPanel,
  setVTab, setPTab, setSort, toggleFilter,
  openModal, closeModal, closeOvOut, selTmpl, toggleFci, createProject,
  openGallery, closeGallery, setGalleryFilter, renderGallery, openFromGallery,
  triggerThumb, updateHeaderThumb,
  revealProjectRoot, copyProjectPath,
  openSettings, closeSettings, pickSettingPath,
});
