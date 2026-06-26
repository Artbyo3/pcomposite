import { escapeHTML } from './helpers.js';
import { ALL_FILES, globalSettings, baseIdMap } from './state.js';
import { readDir, exists, readFile } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { showToast } from './ui.js';
import { saveActiveProject } from './projects.js';
import { renderFileList } from './files.js';
import { writeBridgeContext } from './bridge.js';

// ── EXPORTS MANAGEMENT (integrated into fbx folder view) ──
function buildExportSection() {
  const exports = window._currentExports || [];
  const fbxFiles = ALL_FILES.filter(f => f.folder === 'fbx');
  const assigned = new Set();
  for (const ex of exports) if (ex.fileNames) ex.fileNames.forEach(n => assigned.add(n));
  const unassigned = fbxFiles.filter(f => !assigned.has(f.name));

  const groups = {};
  for (const ex of exports) {
    (groups[ex.target] || (groups[ex.target] = [])).push(ex);
  }
  const sortedTargets = Object.keys(groups).sort();

  let html = '<div class="export-section">';
  html += '<div class="exp-header">';
  html += '<span class="exp-header-icon">📦</span>';
  html += '<span class="exp-header-title">EXPORTS</span>';
  html += '<span class="exp-header-count">' + sortedTargets.length + ' target' + (sortedTargets.length !== 1 ? 's' : '') + ' · ' + exports.length + ' version' + (exports.length !== 1 ? 's' : '') + ' · ' + fbxFiles.length + ' files</span>';
  html += '<button class="exp-header-btn sec" onclick="toggleAllCollapse()" id="expCollapseAllBtn">▲ All</button>';
  html += '<button class="exp-header-btn" onclick="addExport()">+ New Export</button>';
  html += '</div>';

  if (sortedTargets.length >= 4) {
    html += '<div class="exp-jump">';
    for (const target of sortedTargets) {
      const esc = escapeHTML(target).replace(/'/g, "\\'");
      html += '<span class="exp-jump-item" onclick="jumpToExport(\'' + esc + '\')">' + escapeHTML(target) + '</span>';
    }
    html += '</div>';
  }

  if (!exports.length) {
    html += '<div class="exp-empty"><div class="exp-empty-text">No exports recorded yet<br>Click <b style="color:var(--accent)">+ New Export</b> to group your FBX files</div></div>';
    if (unassigned.length) html += '<div class="exp-empty-sub" style="padding:0 0 14px;text-align:center">' + unassigned.length + ' unassigned file' + (unassigned.length !== 1 ? 's' : '') + ' below</div>';
    html += '</div>';
    return html;
  }

  for (const target of sortedTargets) {
    const items = groups[target].slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const isCollapsed = localStorage.getItem('pcom_expand_' + target) === '0';

    html += '<div class="exp-target' + (isCollapsed ? ' collapsed' : '') + '" data-target="' + escapeHTML(target).replace(/"/g, '&quot;') + '">';
    html += '<div class="exp-target-body">';
    html += '<div class="exp-target-head" onclick="toggleExportCollapse(\'' + escapeHTML(target).replace(/'/g, "\\'") + '\')">';
    html += '<div class="exp-cover-img" data-initial="' + escapeHTML(target.charAt(0).toUpperCase()) + '"></div>';
    html += '<span class="exp-collapse-arrow">▾</span>';
    html += '<span class="exp-target-name">' + escapeHTML(target) + '</span>';
    html += '<span class="exp-target-vercount">' + items.length + ' version' + (items.length !== 1 ? 's' : '') + '</span>';

    html += '</div>';
    html += '<div class="exp-vrows">';

    for (const ex of items) {
      const exIdx = exports.indexOf(ex);
      html += '<div class="exp-vrow' + (ex.isFinal ? ' exp-vrow-current' : '') + '">';
      html += '<span class="exp-vbadge">v' + (ex.version || '—') + '</span>';
      html += '<span class="exp-vdate">' + (ex.date || '') + '</span>';
      if (ex.isFinal) html += '<span class="exp-vcurrent">CURRENT</span>';
      if (ex.note) html += '<span class="exp-vnote">' + escapeHTML(ex.note) + '</span>';
      html += '<div class="exp-vfiles">';
      if (ex.fileNames) for (const fn of ex.fileNames) {
        const f = fbxFiles.find(x => x.name === fn);
        html += '<span class="exp-file-tag" style="' + (f ? 'background:' + f.ec + '18;color:' + f.ec : '') + '">' + escapeHTML(fn) + '</span>';
      }
      html += '</div>';
      html += '<div class="exp-vactions">';
      html += '<button class="exp-btn" onclick="toggleFinalExport(' + exIdx + ')" title="' + (ex.isFinal ? 'Unmark as current' : 'Mark as current') + '">★</button>';
      html += '</div>';
      html += '</div>';
    }

    html += '</div>'; // exp-vrows
    html += '</div>'; // exp-target-body
    html += '</div>'; // exp-target
  }

  if (unassigned.length) {
    html += '<div class="exp-unassigned">';
    html += '<div class="exp-unassigned-title">' + unassigned.length + ' unassigned file' + (unassigned.length !== 1 ? 's' : '') + '</div>';
    html += '<div class="exp-unassigned-list">';
    for (const f of unassigned) {
      html += '<span class="exp-file-tag" style="background:' + f.ec + '18;color:' + f.ec + ';cursor:default">' + escapeHTML(f.name) + '</span>';
    }
    html += '</div></div>';
  }

  html += '</div>';
  return html;
}

async function _scanBasesGroups() {
  if (!globalSettings.root_path) return [];
  const basesDir = await join(globalSettings.root_path, '_bases');
  if (!(await exists(basesDir))) return [];
  const entries = await readDir(basesDir);
  return entries.filter(e => e.isDirectory).map(e => e.name).sort();
}

async function addExport() {
  const exports = window._currentExports || [];
  const bases = await _scanBasesGroups();

  const existingTargets = [...new Set(exports.map(e => e.target))];
  for (const t of existingTargets) { if (!bases.includes(t)) bases.push(t); }
  bases.sort();

  const hasDirBases = bases.length > 0;

  const baseOptions = bases.map(t =>
    '<option value="' + escapeHTML(t).replace(/"/g, '&quot;') + '">' + escapeHTML(t) + '</option>'
  ).join('');

  const fbxFiles = ALL_FILES.filter(f => f.folder === 'fbx');
  const assigned = new Set();
  for (const ex of exports) if (ex.fileNames) ex.fileNames.forEach(n => assigned.add(n));
  const available = fbxFiles.filter(f => !assigned.has(f.name));

  const filePills = available.map(f =>
    '<span class="exp-file-pill selected" data-file="' + escapeHTML(f.name).replace(/"/g, '&quot;') + '" style="--file-color:' + f.ec + '">' + escapeHTML(f.name) + '</span>'
  ).join('');

  const overlay = document.createElement('div');
  overlay.className = 'ov ov-modal';
  overlay.style.zIndex = '500';
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  const escHandler = e => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', escHandler); } };
  document.addEventListener('keydown', escHandler);

  const basesHint = !globalSettings.root_path
    ? '<span class="modal-hint" style="color:var(--orange)">Set Vault Path in Settings</span>'
    : '<span class="modal-hint" style="color:var(--text3)">' + bases.length + ' base' + (bases.length !== 1 ? 's' : '') + ' found</span>';

  const defaultTarget = bases.length ? bases[0] : (existingTargets.length === 1 ? existingTargets[0] : '');
  const nextVer = defaultTarget ? getNextVersion(exports, defaultTarget) : 1;

  overlay.innerHTML = '<div class="modal-box modal-box-sm">'
    + '<div class="modal-hd">'
    + '<span class="modal-title">New Export</span>'
    + basesHint
    + '</div>'
    + '<div class="modal-bd">'
    + '<div class="fg">'
    + '<label class="fl">TARGET BASE</label>'
    + (hasDirBases
      ? '<select id="_expTarget" class="fi">' + baseOptions + '</select>'
      : '<input id="_expTarget" list="_expTargets" class="fi" placeholder="e.g. Base Male" value="' + (defaultTarget ? escapeHTML(defaultTarget).replace(/"/g, '&quot;') : '') + '">'
      + (existingTargets.length ? '<datalist id="_expTargets">' + baseOptions + '</datalist>' : '')
    )
    + '</div>'
    + '<div class="fg exp-mid-row">'
    + '<div class="vp-box">'
    + '<span class="vp-label">VERSION</span>'
    + '<span id="_expVerPreview" class="vp-value">' + nextVer + '</span>'
    + '</div>'
    + '<input id="_expDate" type="date" class="fi fi-compact" value="' + new Date().toISOString().slice(0, 10) + '">'
    + '<label class="exp-final-label" title="Mark as current"><input type="checkbox" id="_expFinal"> ★</label>'
    + '</div>'
    + '<div class="fg"><input id="_expNote" class="fi" placeholder="Note (optional)"></div>'
    + (available.length
      ? '<div class="fg"><label class="fl">FILES</label><div class="exp-pills" id="_expPills">'
        + filePills
        + '</div></div>'
      : '<div class="fg"><div class="exp-modal-empty">All FBX files are already assigned</div></div>'
    )
    + '</div>'
    + '<div class="modal-ft">'
    + '<button onclick="this.closest(\'.ov\').remove()" class="btn-sec">Cancel</button>'
    + '<button onclick="saveExport(this)" class="btn-pri">Save</button>'
    + '</div></div>';
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('open'));
  setTimeout(() => document.getElementById('_expTarget')?.focus(), 200);

  // Pill toggle
  const pillsEl = document.getElementById('_expPills');
  if (pillsEl) pillsEl.addEventListener('click', e => {
    const pill = e.target.closest('.exp-file-pill');
    if (pill) pill.classList.toggle('selected');
  });

  // Update version preview when target changes
  const targetInput = document.getElementById('_expTarget');
  if (targetInput) {
    targetInput.addEventListener('change', () => {
      const v = getNextVersion(window._currentExports || [], targetInput.value?.trim() || '');
      const verEl = document.getElementById('_expVerPreview');
      if (verEl) verEl.textContent = v;
    });
    targetInput.addEventListener('input', () => {
      const v = getNextVersion(window._currentExports || [], targetInput.value?.trim() || '');
      const verEl = document.getElementById('_expVerPreview');
      if (verEl) verEl.textContent = v;
    });
  }
}

function getNextVersion(exports, target) {
  const versions = exports.filter(e => e.target === target).map(e => parseInt(e.version, 10) || 0);
  return versions.length ? Math.max(...versions) + 1 : 1;
}

function saveExport(btn) {
  const overlay = btn.closest('.ov');
  const targetEl = document.getElementById('_expTarget');
  const target = targetEl?.value?.trim();
  const note = document.getElementById('_expNote')?.value?.trim();
  const dateInput = document.getElementById('_expDate')?.value;
  const isFinal = document.getElementById('_expFinal')?.checked || false;

  if (!target) { showToast('Select or enter a target base name', 'var(--orange)'); return; }

  const selectedFiles = [];
  document.querySelectorAll('#_expPills .exp-file-pill.selected').forEach(p => selectedFiles.push(p.dataset.file));

  const exports = window._currentExports || [];

  // Auto-assign version number
  const version = getNextVersion(exports, target);

  if (isFinal) {
    for (const ex of exports) { if (ex.target === target) ex.isFinal = false; }
  }
  // Look up base_id from current ID map
  let baseId = '';
  for (const [id, name] of Object.entries(baseIdMap)) {
    if (name === target) { baseId = id; break; }
  }
  exports.push({
    id: 'exp_' + Date.now().toString(36),
    base_id: baseId,
    target,
    date: dateInput || new Date().toISOString().slice(0, 10),
    note: note || '',
    isFinal,
    version,
    fileNames: selectedFiles,
  });
  window._currentExports = exports;
  overlay?.remove();
  saveActiveProject();
  renderFileList('fbx');
  writeBridgeContext();
  showToast('Export v' + version + ' logged for ' + target, 'var(--green)');
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
  writeBridgeContext();
}

function deleteExport(idx) {
  const exports = window._currentExports || [];
  exports.splice(idx, 1);
  window._currentExports = exports;
  saveActiveProject();
  renderFileList('fbx');
  writeBridgeContext();
}

function deleteExportGroup(target) {
  const exports = window._currentExports || [];
  window._currentExports = exports.filter(e => e.target !== target);
  saveActiveProject();
  renderFileList('fbx');
  writeBridgeContext();
}

window.jumpToExport = function(target) {
  const card = document.querySelector('.exp-target[data-target="' + target.replace(/"/g, '&quot;') + '"]');
  if (card) {
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    card.classList.remove('collapsed');
    localStorage.setItem('pcom_expand_' + target, '1');
  }
};

window.toggleExportCollapse = function(target) {
  const cards = document.querySelectorAll('.exp-target');
  for (const card of cards) {
    const name = card.querySelector('.exp-target-name');
    if (name && name.textContent === target) {
      card.classList.toggle('collapsed');
      localStorage.setItem('pcom_expand_' + target, card.classList.contains('collapsed') ? '0' : '1');
      break;
    }
  }
  updateCollapseAllLabel();
};

window.toggleAllCollapse = function() {
  const allCollapsed = document.querySelectorAll('.exp-target.collapsed');
  const total = document.querySelectorAll('.exp-target').length;
  const collapseAll = allCollapsed.length < total;
  document.querySelectorAll('.exp-target').forEach(card => {
    const name = card.querySelector('.exp-target-name')?.textContent;
    if (name) {
      card.classList.toggle('collapsed', collapseAll);
      localStorage.setItem('pcom_expand_' + name, collapseAll ? '0' : '1');
    }
  });
  updateCollapseAllLabel();
};

function updateCollapseAllLabel() {
  const btn = document.getElementById('expCollapseAllBtn');
  if (!btn) return;
  const allCollapsed = document.querySelectorAll('.exp-target.collapsed').length;
  const total = document.querySelectorAll('.exp-target').length;
  btn.textContent = allCollapsed >= total ? '▾ All' : '▲ All';
}

async function loadExportCovers() {
  if (!globalSettings.root_path) return;
  const cards = document.querySelectorAll('.exp-target[data-target]');
  // Build name → id lookup for renamed folders
  const nameToId = {};
  for (const [id, name] of Object.entries(baseIdMap)) nameToId[name] = id;

  for (const card of cards) {
    const target = card.dataset.target;
    // Resolve folder name using ID map (handles renames)
    const baseId = nameToId[target];
    const folderName = baseId ? baseIdMap[baseId] : target;
    const baseDir = await join(globalSettings.root_path, '_bases', folderName);
    if (!(await exists(baseDir))) continue;
    const entries = await readDir(baseDir);
    const cover = entries.find(e => !e.isDirectory && e.name.toLowerCase().startsWith('cover'));
    if (!cover) continue;
    try {
      const coverPath = await join(baseDir, cover.name);
      const ext = cover.name.split('.').pop().toLowerCase();
      const mime = { png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',gif:'image/gif',webp:'image/webp',svg:'image/svg+xml',bmp:'image/bmp' }[ext] || 'image/png';
      const bytes = await readFile(coverPath);
      const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
      const imgEl = card.querySelector('.exp-cover-img');
      if (imgEl) imgEl.style.backgroundImage = 'url(' + url + ')';
    } catch (e) { console.warn('Failed to load cover for', target, e); }
  }
}

export { buildExportSection, addExport, saveExport, toggleFinalExport, deleteExport, deleteExportGroup, loadExportCovers };
