import { join } from '@tauri-apps/api/path';
import { exists, rename, mkdir } from '@tauri-apps/plugin-fs';
import { escapeHTML, formatBytes, sanitizeProjectId, isStreamerMode, getFolderMeta, getPipelineLength, getStageIcon, getStageColor, renderStageDots } from './helpers.js';
import { ALL_FILES, projects, setProjects, sessionNote, setSessionNote, setProjectLog, globalSettings, setCurrentFolder, currentFolder, currentSort, activeFilters } from './state.js';
import { loadProject, saveProject, syncProjectFiles, scanVault } from './data.js';
import { showToast, setVTab } from './ui.js';
import { updateHeaderThumb } from './thumbnail.js';
import { setPipe } from './pipeline.js';
import { refreshFolders } from './folders.js';
import { logAction } from './checklist.js';
import { writeBridgeContext } from './bridge.js';

async function saveActiveProject() {
  const p = projects.find(x => x.active);
  if (!p || !globalSettings.root_path) return;
  const checklistItems = window._currentChecklist || [];
  const data = {
    id: p.id,
    name: p.name,
    date: p.date,
    stage: p.stage,
    thumb: p.thumb,
    release_date: p.release_date || null,
    files: ALL_FILES.map(f => ({ name: f.name, folder: f.folder, ext: f.ext, size_bytes: f.sizeBytes, app: f.app, created_at: f.date })),
    checklist: checklistItems.map(c => ({ label: c.name, done: c.done })),
    note: sessionNote,
    exports: window._currentExports || [],
    imported_bases: window._importedBases || [],
  };
  const folder = p.folder_name || (p.id + '_' + p.name);
  await saveProject(globalSettings.root_path, data, folder);
}

async function loadProjects() {
  const rows = await scanVault(globalSettings.root_path);
  setProjects(rows.map(r => ({ ...r, active: false })));
  document.getElementById('sbCnt').textContent = projects.length + ' projects';
}

function renderProjects() {
  const q = (document.getElementById('searchInput').value || '').toLowerCase();
  const pipeLen = getPipelineLength();
  let filtered = projects.filter(p => {
    const matchQ = p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
    const matchFilter = activeFilters.size === 0
      || (activeFilters.has('wip')  && p.stage < pipeLen)
      || (activeFilters.has('done') && p.stage >= pipeLen);
    return matchQ && matchFilter;
  });

  if (currentSort === 'name')  filtered.sort((a, b) => a.name.localeCompare(b.name));
  if (currentSort === 'stage') filtered.sort((a, b) => b.stage - a.stage);

  const list = document.getElementById('plist');
  if (!filtered.length) {
    list.innerHTML = `<div class="plist-empty">No projects found</div>`;
    return;
  }

  const pIndices = filtered.map(p => projects.indexOf(p));

    list.innerHTML = filtered.map((p, i) => `
    <div class="pcard${p.active ? ' active' : ''}${p.thumb ? ' has-thumb' : ''}" onclick="selectProject(${pIndices[i]})" tabindex="0" role="option" aria-selected="${p.active}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectProject(${pIndices[i]})}if(event.key==='ArrowDown'){event.preventDefault();const list=document.getElementById('plist');const cards=[...list.querySelectorAll('.pcard')];const idx=cards.indexOf(this);if(idx<cards.length-1)cards[idx+1].focus()}if(event.key==='ArrowUp'){event.preventDefault();const list=document.getElementById('plist');const cards=[...list.querySelectorAll('.pcard')];const idx=cards.indexOf(this);if(idx>0)cards[idx-1].focus()}" style="animation-delay:${i * .04}s${p.thumb ? `;background-image:url('${p.thumb}')` : ''}">
      <div class="pc-body">
        <div class="pc-name">${escapeHTML(p.name)}</div>
        <div class="pc-bot">
          <span class="pc-date">${p.date}</span>
          <div class="fmini">
            ${renderStageDots(p.stage)}
          </div>
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
  setProjectLog([]);

  window._currentChecklist = [];
  setSessionNote('');

  try {
    const folder = p.folder_name || (p.id + '_' + p.name);
    const data = await loadProject(globalSettings.root_path, p.id, p.name, folder);
    let projectDir = globalSettings.root_path ? await join(globalSettings.root_path, folder) : '';
    if (projectDir) projectDir = projectDir.replace(/\\/g, '/');

    // Sync files from disk (source of truth) and merge with project.json metadata
    const diskFiles = globalSettings.root_path ? await syncProjectFiles(globalSettings.root_path, p.id, p.name, folder) : [];
    const jsonFiles = (data && data.files) || [];
    const missingKeys = await applyFileSync(projectDir, diskFiles, jsonFiles);

    // Prune JSON entries that no longer exist on disk (deleted outside the app)
    if (missingKeys.size && data) {
      data.files = jsonFiles.filter(f => !missingKeys.has(f.folder + '/' + f.name));
      try { await saveProject(globalSettings.root_path, data, folder); }
      catch (e) { console.warn('Could not prune deleted files from project data', e); }
    }

    if (data) {
      const stages = globalSettings.pipelineStages || [];
      let savedChecklist = (data.checklist || []).map(item => ({
        label: ({'Blender done':'Blender','Painter done':'Painter','Unity done':'Unity','Package ready':'Package','Uploaded':'Upload'})[item.label] || item.label,
        done: item.done
      }));
      window._currentChecklist = stages.map(s => {
        const saved = savedChecklist.find(c => c.label === s.name);
        return { name: s.name, icon: getStageIcon(s), color: s.color || '#888', done: saved ? saved.done : false };
      });
      setSessionNote(data.note || '');
      // Migrate exports: add version field if missing (auto-number within each target)
      const rawExports = (data.exports || []).slice();
      const verCounts = {};
      for (const ex of rawExports) {
        if (ex.version == null) {
          if (!verCounts[ex.target]) verCounts[ex.target] = 0;
          ex.version = ++verCounts[ex.target];
        }
      }
      window._currentExports = rawExports;
      window._importedBases = (data.imported_bases || []).map(i => typeof i === 'string' ? { file: i, group: i.replace(/_[^_]+$/, ''), imported_at: null } : { ...i }).slice();
    }
  } catch (e) { console.error('selectProject load error:', e); showToast('Could not load project data', 'var(--red)'); }

  const rootLabel = globalSettings.root_path ? (isStreamerMode() ? 'Vault' : globalSettings.root_path.split(/[/\\]/).pop()) : '3D_Assets';
  const safeId = sanitizeProjectId(p.id, 'Project');
  document.getElementById('phId').textContent   = safeId;
  document.getElementById('phName').textContent = p.name;
  document.getElementById('crumb').innerHTML    = '<b>' + safeId + '</b> <span style="color:var(--text3)">/ ' + escapeHTML(p.name) + '</span>';
  document.getElementById('phPath').innerHTML   = `<span class="seg">${escapeHTML(rootLabel)}</span><span style="color:var(--text3)">›</span><span class="seg" style="color:var(--accent)">${safeId} — ${escapeHTML(p.name)}</span>`;

  // Reset view state when switching projects
  setCurrentFolder(null);
  document.querySelectorAll('.vtab').forEach(t => t.classList.remove('active'));
  document.querySelector('.vtab').classList.add('active');
  setVTab(null, 'folders');

  updateHeaderThumb();
  // skipDb=true: stage is already in p.stage, no need to write back
  await setPipe(Math.max(0, p.stage - 1), true);
  refreshFolders();
  logAction(`Project "${p.name}" opened`, 'info');
  await writeBridgeContext();
}

// ── FILE SYNC (disk is the source of truth) ──

// Build ALL_FILES from disk records, enriched with saved JSON metadata (app, created_at).
// Returns the set of JSON-only keys that no longer exist on disk (e.g. deleted in Explorer).
async function applyFileSync(projectDir, diskFiles, jsonFiles) {
  const diskMap = new Map();
  for (const f of diskFiles) diskMap.set(f.folder + '/' + (f.subfolder ? f.subfolder + '/' : '') + f.name, f);

  for (const f of jsonFiles) {
    const diskF = diskMap.get(f.folder + '/' + (f.subfolder ? f.subfolder + '/' : '') + f.name);
    if (diskF) {
      diskF.app = f.app || diskF.app;
      diskF.created_at = f.created_at || diskF.created_at;
    }
  }

  const missingKeys = new Set(
    jsonFiles.filter(f => !diskMap.has(f.folder + '/' + (f.subfolder ? f.subfolder + '/' : '') + f.name)).map(f => f.folder + '/' + (f.subfolder ? f.subfolder + '/' : '') + f.name)
  );

  ALL_FILES.length = 0;
  for (const f of diskMap.values()) {
    const meta = getFolderMeta(f.folder);
    ALL_FILES.push({ name: f.name, folder: f.folder, subfolder: f.subfolder || '', ext: f.ext, size: formatBytes(f.size_bytes), sizeBytes: f.size_bytes, date: f.created_at, app: f.app, icon: meta.icon, ec: meta.color, _path: projectDir ? projectDir + '/' + f.folder + '/' + (f.subfolder ? f.subfolder + '/' : '') + f.name : '' });
  }
  return missingKeys;
}

// Re-read the active project from disk and refresh whatever view is showing.
// Used when the window regains focus so external file changes (Explorer deletes) show up.
async function resyncActiveProject() {
  const p = projects.find(x => x.active);
  if (!p || !globalSettings.root_path) return;
  try {
    const folder = p.folder_name || (p.id + '_' + p.name);
    let projectDir = globalSettings.root_path ? await join(globalSettings.root_path, folder) : '';
    if (projectDir) projectDir = projectDir.replace(/\\/g, '/');

    const data = await loadProject(globalSettings.root_path, p.id, p.name, folder);
    const diskFiles = await syncProjectFiles(globalSettings.root_path, p.id, p.name, folder);
    const jsonFiles = (data && data.files) || [];
    const missingKeys = await applyFileSync(projectDir, diskFiles, jsonFiles);

    if (missingKeys.size && data) {
      data.files = jsonFiles.filter(f => !missingKeys.has(f.folder + '/' + f.name));
      try { await saveProject(globalSettings.root_path, data, folder); }
      catch (e) { console.warn('Could not prune deleted files from project data', e); }
    }

    // Re-render the current view without resetting navigation
    const vFiles = document.getElementById('vFiles');
    if (vFiles && vFiles.style.display !== 'none') {
      const { renderFileList } = await import('./files.js');
      renderFileList(currentFolder);
    } else {
      refreshFolders();
    }
  } catch (e) { console.error('resyncActiveProject error:', e); }
}

async function editProjectTitle(newTitle, projectIdx) {
  const idx = (projectIdx != null && projectIdx >= 0) ? projectIdx : projects.findIndex(x => x.active);
  if (idx === -1 || !projects[idx]) {
    showToast('No project selected to edit', 'var(--red)');
    return false;
  }
  const p = projects[idx];
  const trimmed = (newTitle || '').trim();
  if (!trimmed) {
    showToast('Project title cannot be empty', 'var(--red)');
    return false;
  }
  if (/[<>:"/\\|?*]/.test(trimmed)) {
    showToast('Title contains invalid characters (< > : " / \\ | ? *)', 'var(--red)');
    return false;
  }
  if (trimmed === p.name) {
    return true;
  }
  if (!globalSettings.root_path) {
    showToast('Set Root Path in settings first', 'var(--orange)');
    return false;
  }

  const oldName = p.name;
  const oldFolderName = p.folder_name || (p.id + '_' + oldName);
  const newFolderName = p.id + '_' + trimmed;
  const oldDir = await join(globalSettings.root_path, oldFolderName);
  const newDir = await join(globalSettings.root_path, newFolderName);

  if (oldFolderName.toLowerCase() !== newFolderName.toLowerCase()) {
    if (await exists(newDir)) {
      showToast('A project folder with that title already exists', 'var(--orange)');
      return false;
    }
  }

  if (p.active) {
    try { await saveActiveProject(); } catch (e) { console.warn('Pre-rename save failed', e); }
  }

  const oldDirExists = await exists(oldDir);
  if (oldDirExists) {
    try {
      await rename(oldDir, newDir);
    } catch (e) {
      console.error('Rename project folder failed:', e);
      showToast('Could not rename project folder on disk (file may be in use): ' + (e.message || e), 'var(--red)');
      return false;
    }
  } else {
    try {
      await mkdir(newDir, { recursive: true });
    } catch (e) {
      showToast('Could not create project folder on disk: ' + (e.message || e), 'var(--red)');
      return false;
    }
  }

  p.name = trimmed;
  p.folder_name = newFolderName;

  try {
    const data = await loadProject(globalSettings.root_path, p.id, trimmed, newFolderName);
    if (data) {
      data.name = trimmed;
      await saveProject(globalSettings.root_path, data, newFolderName);
    }
  } catch (e) {
    console.warn('Could not update project.json title:', e);
  }

  if (p.active) {
    const normNewDir = newDir.replace(/\\/g, '/');
    ALL_FILES.forEach(f => {
      f._path = normNewDir + '/' + f.folder + '/' + (f.subfolder ? f.subfolder + '/' : '') + f.name;
    });

    const rootLabel = globalSettings.root_path ? (isStreamerMode() ? 'Vault' : globalSettings.root_path.split(/[/\\]/).pop()) : '3D_Assets';
    const safeId = sanitizeProjectId(p.id, 'Project');
    const phName = document.getElementById('phName');
    const crumb = document.getElementById('crumb');
    const phPath = document.getElementById('phPath');
    if (phName) phName.textContent = p.name;
    if (crumb) crumb.innerHTML = '<b>' + safeId + '</b> <span style="color:var(--text3)">/ ' + escapeHTML(p.name) + '</span>';
    if (phPath) phPath.innerHTML = `<span class="seg">${escapeHTML(rootLabel)}</span><span style="color:var(--text3)">›</span><span class="seg" style="color:var(--accent)">${safeId} — ${escapeHTML(p.name)}</span>`;
  }

  await writeBridgeContext();
  renderProjects();

  const galOv = document.getElementById('galleryOverlay');
  if (galOv && galOv.classList.contains('open')) {
    const { renderGallery } = await import('./gallery.js');
    renderGallery();
  }

  logAction(`Project "${oldName}" renamed to "${trimmed}"`, 'ok');
  showToast(`Project renamed to "${trimmed}"`, 'var(--green)');
  return true;
}

export { loadProjects, renderProjects, selectProject, saveActiveProject, resyncActiveProject, editProjectTitle };
