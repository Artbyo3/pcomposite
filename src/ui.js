import { formatBytes } from './helpers.js';
import { FOLDERS, PIPELINE, CHECKLIST } from './constants.js';
import { ALL_FILES, projects, globalSettings, setCurrentSort, activeFilters, currentFolder } from './state.js';
import { join, basename, extname } from '@tauri-apps/api/path';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { copyFile, stat, mkdir, exists, rename, remove, readDir } from '@tauri-apps/plugin-fs';
import { loadProject, saveProject } from './data.js';
import { loadProjects, renderProjects, selectProject } from './projects.js';
import { renderFileList } from './files.js';
import { renderChecklist, renderLog, logAction } from './checklist.js';

// ── TOAST ──
function showToast(msg, color = 'var(--accent)') {
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:40px;left:50%;transform:translateX(-50%);background:var(--bg3);border:1px solid ${color};border-radius:6px;padding:8px 16px;font-size:11px;font-family:'Space Mono',monospace;color:var(--text);z-index:1000;white-space:nowrap;box-shadow:0 4px 20px rgba(0,0,0,.5);animation:fadeUp .15s ease;`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.style.opacity = '0', 1800);
  setTimeout(() => t.remove(), 2000);
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
  setCurrentSort(key);
  document.querySelectorAll('.sort-row .chip[data-sort]').forEach(c => c.classList.remove('on'));
  el.classList.add('on');
  renderProjects();
}

function toggleFilter(el, key) {
  if (activeFilters.has(key)) { activeFilters.delete(key); el.classList.remove('ac'); }
  else { activeFilters.add(key); el.classList.add('ac'); }
  renderProjects();
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

export { showToast, openModal, closeModal, closeOvOut, toggleFci, createProject, setVTab, setPTab, setSort, toggleFilter, refreshInfoPanel, initDragDrop }
