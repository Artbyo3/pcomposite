import { join } from '@tauri-apps/api/path';
import { escapeHTML, formatBytes, sanitizeProjectId, isStreamerMode, getToolFolders, getFolderMeta, getPipelineLength, getStageIcon, getStageColor } from './helpers.js';
import { ALL_FILES, projects, setProjects, sessionNote, setSessionNote, setProjectLog, globalSettings, setCurrentFolder, currentSort, activeFilters } from './state.js';
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
  await saveProject(globalSettings.root_path, data);
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
    <div class="pcard${p.active ? ' active' : ''}${p.thumb ? ' has-thumb' : ''}" onclick="selectProject(${pIndices[i]})" style="animation-delay:${i * .04}s${p.thumb ? `;background-image:url('${p.thumb}')` : ''}">
      <div class="pc-body">
        <div class="pc-name">${escapeHTML(p.name)}</div>
        <div class="pc-bot">
          <span class="pc-date">${p.date}</span>
          <div class="fmini">
            ${getToolFolders().map((f, fi) => `<div class="fmd ${fi < p.stage ? 'has' : ''}" style="background:${f.color}"></div>`).join('')}
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
      const meta = getFolderMeta(f.folder);
      ALL_FILES.push({ name: f.name, folder: f.folder, ext: f.ext, size: formatBytes(f.size_bytes), sizeBytes: f.size_bytes, date: f.created_at, app: f.app, icon: meta.icon, ec: meta.color, _path: projectDir ? projectDir + '/' + f.folder + '/' + f.name : '' });
    }
    for (const f of diskFiles) {
      const key = f.folder + '/' + f.name;
      if (seen.has(key)) continue;
      seen.add(key);
      const meta = getFolderMeta(f.folder);
      ALL_FILES.push({ name: f.name, folder: f.folder, ext: f.ext, size: formatBytes(f.size_bytes), sizeBytes: f.size_bytes, date: f.created_at, app: f.app, icon: meta.icon, ec: meta.color, _path: projectDir ? projectDir + '/' + f.folder + '/' + f.name : '' });
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
  } catch (e) { console.error('selectProject load error:', e); showToast('Error loading project: ' + e, 'var(--red)'); }

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

export { loadProjects, renderProjects, selectProject, saveActiveProject };
