import { escapeHTML, getToolByFolderKey, getToolIcon } from './helpers.js';
import { ALL_FILES, globalSettings, baseIdMap } from './state.js';
import { readDir, exists, readFile } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { showToast, showConfirm } from './ui.js';
import { saveActiveProject } from './projects.js';
import { renderFileList } from './files.js';
import { writeBridgeContext } from './bridge.js';

// ── EXPORTS MANAGEMENT (integrated into fbx folder view) ──
function _fbxKey() {
  const tool = (globalSettings.tools || []).find(t => (t.capabilities || []).includes('fbx_versioning'));
  return tool ? tool.folder_key : 'fbx';
}

function buildExportSection() {
  const exports = window._currentExports || [];
  const fbxFiles = ALL_FILES.filter(f => f.folder === _fbxKey());
  const assigned = new Set();
  for (const ex of exports) if (ex.fileNames) ex.fileNames.forEach(n => assigned.add(n));
  const unassigned = fbxFiles.filter(f => !assigned.has(f.name));

  const groups = {};
  for (const ex of exports) (groups[ex.target] || (groups[ex.target] = [])).push(ex);
  const sortedTargets = Object.keys(groups).sort();

  const fbxTool = getToolByFolderKey(_fbxKey());
  const expIcon = fbxTool ? getToolIcon(fbxTool) : '<span class="icon-letter">E</span>';
  let html = '<div class="export-section">';
  html += '<div class="exp-header">';
  html += `<span class="exp-header-icon">${expIcon}</span>`;
  html += '<span class="exp-header-title">EXPORTS</span>';
  if (sortedTargets.length >= 4) {
    html += '<button class="exp-header-btn sec" onclick="toggleAllCollapse()" id="expCollapseAllBtn">Collapse all</button>';
  }
  html += '<button class="exp-header-btn" onclick="addExport()">+ New Export</button>';
  html += '</div>';

  if (!exports.length) {
    if (fbxFiles.length) {
      html += '<div class="exp-empty"><div class="exp-empty-text">No exports recorded yet — use <b style="color:var(--accent)">+ New Export</b> to group your FBX files into a release</div></div>';
    }
  } else {
    html += '<div class="exp-table">';

    for (const target of sortedTargets) {
      const items = groups[target].slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      const isCollapsed = localStorage.getItem('pcom_expand_' + target) === '0';
      const hasCurrent = items.some(e => e.isFinal);
      const curVersion = items.find(e => e.isFinal);
      const esc = escapeHTML(target).replace(/'/g, "\\'");

      html += '<div class="exp-target' + (isCollapsed ? ' collapsed' : '') + '" data-target="' + escapeHTML(target).replace(/"/g, '&quot;') + '">';
      const latest = items[0];
      const sortedAsc = items.slice().sort((a, b) => (parseInt(a.version, 10) || 0) - (parseInt(b.version, 10) || 0));
      const trail = sortedAsc.slice(-6);
      const trailChips = trail.map(v => '<span class="exp-vtrail-chip' + (v.isFinal ? ' cur' : '') + '">v' + (v.version || '—') + '</span>').join('');
      const trailOverflow = sortedAsc.length > trail.length ? '<span class="exp-vtrail-more">+' + (sortedAsc.length - trail.length) + '</span>' : '';
      const metaHtml = '<div class="exp-card-meta">' + trailChips + trailOverflow + (latest && latest.date ? '<span class="exp-meta-date">' + escapeHTML(latest.date) + '</span>' : '') + '</div>';

      html += '<div class="exp-group-head" onclick="toggleExportCollapse(\'' + esc + '\')" onkeydown="expHeadKey(event,\'' + esc + '\')" tabindex="0" role="button" aria-expanded="' + (!isCollapsed) + '">';
      html += '<span class="exp-cover-img" data-initial="' + escapeHTML(target.charAt(0).toUpperCase()) + '"></span>';
      html += '<div class="exp-card-info">';
      html += '<span class="exp-group-name">' + escapeHTML(target) + '</span>';
      html += metaHtml;
      html += '</div>';
      html += curVersion
        ? '<span class="exp-target-state on">CURRENT v' + (curVersion.version || '—') + '</span>'
        : (items.length > 1 ? '<span class="exp-target-state off">NO CURRENT</span>' : '');
      html += '<button class="exp-act danger" onclick="event.stopPropagation();confirmDeleteExportGroup(\'' + esc + '\')" title="Delete all versions of this target">Delete</button>';
      html += '<span class="exp-caret"></span>';
      html += '</div>';
      html += '<div class="exp-vrows">';

      for (const ex of items) {
        const exIdx = exports.indexOf(ex);
        html += '<div class="exp-vrow' + (ex.isFinal ? ' exp-vrow-current' : '') + '">';
        html += '<span class="exp-vbadge">v' + (ex.version || '—') + '</span>';
        html += '<span class="exp-vdate">' + (ex.date || '') + '</span>';
        if (ex.isFinal) {
          html += '<button class="exp-st is-current" onclick="toggleFinalExport(' + exIdx + ')" aria-pressed="true" title="Unmark as current">CURRENT</button>';
        } else if (hasCurrent) {
          html += '<button class="exp-st is-superseded" onclick="toggleFinalExport(' + exIdx + ')" aria-pressed="false" title="Mark as current">SUPERSEDED</button>';
        } else {
          html += '<button class="exp-st is-none" onclick="toggleFinalExport(' + exIdx + ')" aria-pressed="false" title="Mark this version as current">Set current</button>';
        }
        html += '<div class="exp-vfiles">';
        if (ex.note) html += '<span class="exp-vnote">' + escapeHTML(ex.note) + '</span>';
        if (ex.fileNames) for (const fn of ex.fileNames) {
          const f = fbxFiles.find(x => x.name === fn);
          const fidx = f ? ALL_FILES.indexOf(f) : -1;
          html += fidx >= 0
            ? '<button class="exp-file-tag exp-tag-open" onclick="if(!window._fileDragSuppressClick){openFile(' + fidx + ')}" onmousedown="fileDragStart(event,' + fidx + ')" style="background:' + f.ec + '18;color:' + f.ec + '" title="Open in ' + escapeHTML(f.app || 'default app') + ' — drag to drop into ' + escapeHTML(f.app || 'app') + '">' + escapeHTML(fn) + '</button>'
            : '<span class="exp-file-tag" style="background:var(--bg3);color:var(--text3)">' + escapeHTML(fn) + '</span>';
        }
        html += '</div>';
        html += '<div class="exp-vactions">';
        html += '<button class="exp-act" onclick="openExportForm(' + exIdx + ')" title="Edit version">Edit</button>';
        html += '<button class="exp-act danger" onclick="confirmDeleteExport(' + exIdx + ')" title="Delete version">Delete</button>';
        html += '</div>';
        html += '</div>';
      }

      html += '</div>'; // exp-vrows
      html += '</div>'; // exp-target
    }

    html += '</div>'; // exp-table
  }

  if (unassigned.length) {
    html += '<div class="exp-unassigned">';
    html += '<div class="exp-unassigned-title">UNASSIGNED · ' + unassigned.length + ' FILE' + (unassigned.length !== 1 ? 'S' : '') + '</div>';
    html += '<div class="exp-unassigned-list">';
    for (const f of unassigned) {
      const esc = escapeHTML(f.name).replace(/'/g, "\\'");
      html += '<button class="exp-file-tag exp-assign-tag" style="background:' + f.ec + '18;color:' + f.ec + '" onclick="openExportForm(-1,\'' + esc + '\')" title="Log a new export with this file">+ ' + escapeHTML(f.name) + '</button>';
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

let _editingExportIdx = -1;

function addExport() { openExportForm(-1); }
window.addExport = addExport;

async function openExportForm(editIdx, preselectFile) {
  const exports = window._currentExports || [];
  const editing = (editIdx != null && editIdx >= 0 && exports[editIdx]) ? exports[editIdx] : null;
  _editingExportIdx = editing ? editIdx : -1;

  const bases = await _scanBasesGroups();

  const existingTargets = [...new Set(exports.map(e => e.target))];
  for (const t of existingTargets) { if (!bases.includes(t)) bases.push(t); }
  if (editing && editing.target && !bases.includes(editing.target)) bases.push(editing.target);
  bases.sort();

  const hasDirBases = bases.length > 0;

  const baseOptions = bases.map(t =>
    '<option value="' + escapeHTML(t).replace(/"/g, '&quot;') + '">' + escapeHTML(t) + '</option>'
  ).join('');

  const fbxFiles = ALL_FILES.filter(f => f.folder === _fbxKey());
  const assigned = new Set();
  for (const ex of exports) if (ex.fileNames) ex.fileNames.forEach(n => { if (ex !== editing) assigned.add(n); });
  const available = fbxFiles.filter(f => !assigned.has(f.name));

  const selectedNames = new Set(editing?.fileNames || []);
  if (!editing && preselectFile) selectedNames.add(preselectFile);
  const filePills = available.map(f =>
    '<span class="exp-file-pill' + (selectedNames.has(f.name) ? ' selected' : '') + '" data-file="' + escapeHTML(f.name).replace(/"/g, '&quot;') + '" style="--file-color:' + f.ec + '">' + escapeHTML(f.name) + '</span>'
  ).join('');

  const overlay = document.createElement('div');
  overlay.className = 'ov ov-modal';
  overlay.style.zIndex = '500';
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  const escHandler = e => {
    if (e.key === 'Escape') {
      overlay.remove();
      _editingExportIdx = -1;
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);

  const basesHint = !globalSettings.root_path
    ? '<span class="modal-hint" style="color:var(--orange)">Set Vault Path in Settings</span>'
    : '<span class="modal-hint" style="color:var(--text3)">' + bases.length + ' base' + (bases.length !== 1 ? 's' : '') + ' found</span>';

  const defaultTarget = editing ? editing.target : (bases.length ? bases[0] : (existingTargets.length === 1 ? existingTargets[0] : ''));
  const nextVer = editing ? (editing.version || getNextVersion(exports, editing.target)) : getNextVersion(exports, defaultTarget);
  const today = new Date().toISOString().slice(0, 10);

  overlay.innerHTML = '<div class="modal-box modal-box-sm">'
    + '<div class="modal-hd">'
    + '<span class="modal-title">' + (editing ? 'Edit Export' : 'New Export') + '</span>'
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
    + '<input id="_expDate" type="date" class="fi fi-compact" value="' + (editing?.date || today) + '">'
    + '<label class="exp-final-label" title="Mark as current"><input type="checkbox" id="_expFinal"' + (editing?.isFinal ? ' checked' : '') + '> CURRENT</label>'
    + '</div>'
    + '<div class="fg"><input id="_expNote" class="fi" placeholder="Note (optional)" value="' + (editing?.note ? escapeHTML(editing.note).replace(/"/g, '&quot;') : '') + '"></div>'
    + (available.length
      ? '<div class="fg"><label class="fl">FILES</label><div class="exp-pills" id="_expPills">'
        + filePills
        + '</div></div>'
      : '<div class="fg"><div class="exp-modal-empty">All FBX files are already assigned</div></div>'
    )
    + '</div>'
    + '<div class="modal-ft">'
    + '<button onclick="this.closest(\'.ov\').remove()" class="btn btn-secondary">Cancel</button>'
    + '<button onclick="saveExport(this)" class="btn btn-primary">' + (editing ? 'Save Changes' : 'Save') + '</button>'
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

  // Update version preview when target changes (new exports only)
  if (!editing) {
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
  const editingIdx = _editingExportIdx;
  const today = new Date().toISOString().slice(0, 10);

  if (editingIdx < 0 && !selectedFiles.length) {
    showToast('Select at least one file for the export', 'var(--orange)');
    return;
  }

  // Look up base_id from current ID map
  let baseId = '';
  for (const [id, name] of Object.entries(baseIdMap)) {
    if (name === target) { baseId = id; break; }
  }

  if (editingIdx >= 0 && exports[editingIdx]) {
    const ex = exports[editingIdx];
    if (isFinal) { for (const e of exports) { if (e.target === target) e.isFinal = false; } }
    ex.isFinal = isFinal;
    ex.target = target;
    ex.base_id = baseId;
    ex.date = dateInput || ex.date || today;
    ex.note = note || '';
    ex.fileNames = selectedFiles;
    window._currentExports = exports;
    _editingExportIdx = -1;
    overlay?.remove();
    saveActiveProject();
    renderFileList(_fbxKey());
    writeBridgeContext();
    showToast('Export v' + (ex.version || '—') + ' updated', 'var(--green)');
    return;
  }

  // Auto-assign version number
  const version = getNextVersion(exports, target);

  if (isFinal) {
    for (const ex of exports) { if (ex.target === target) ex.isFinal = false; }
  }
  exports.push({
    id: 'exp_' + Date.now().toString(36),
    base_id: baseId,
    target,
    date: dateInput || today,
    note: note || '',
    isFinal,
    version,
    fileNames: selectedFiles,
  });
  window._currentExports = exports;
  _editingExportIdx = -1;
  overlay?.remove();
  saveActiveProject();
  renderFileList(_fbxKey());
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
  renderFileList(_fbxKey());
  writeBridgeContext();
  if (ex.isFinal) {
    showToast('v' + (ex.version || '—') + ' is now CURRENT for ' + ex.target, 'var(--green)');
  } else {
    showToast('v' + (ex.version || '—') + ' is no longer CURRENT for ' + ex.target, 'var(--text3)');
  }
}

async function confirmDeleteExport(idx) {
  const exports = window._currentExports || [];
  const ex = exports[idx];
  if (!ex) return;
  const ok = await showConfirm('Delete Export', 'Delete version v' + (ex.version || '—') + ' of "<b>' + escapeHTML(ex.target) + '</b>"? This cannot be undone.');
  if (ok) deleteExport(idx);
}

async function confirmDeleteExportGroup(target) {
  const exports = window._currentExports || [];
  const count = exports.filter(e => e.target === target).length;
  if (!count) return;
  const ok = await showConfirm('Delete Target', 'Remove all ' + count + ' version' + (count !== 1 ? 's' : '') + ' of "<b>' + escapeHTML(target) + '</b>"? This cannot be undone.');
  if (ok) deleteExportGroup(target);
}

function deleteExport(idx) {
  const exports = window._currentExports || [];
  const ex = exports[idx];
  if (!ex) return;
  exports.splice(idx, 1);
  window._currentExports = exports;
  saveActiveProject();
  renderFileList(_fbxKey());
  writeBridgeContext();
  _showUndoToast('Deleted v' + (ex.version || '—') + ' of ' + escapeHTML(ex.target), () => {
    const list = window._currentExports || [];
    list.splice(Math.min(idx, list.length), 0, ex);
    window._currentExports = list;
    saveActiveProject();
    renderFileList(_fbxKey());
    writeBridgeContext();
  });
}

function deleteExportGroup(target) {
  const exports = window._currentExports || [];
  const removed = exports.filter(e => e.target === target);
  if (!removed.length) return;
  window._currentExports = exports.filter(e => e.target !== target);
  saveActiveProject();
  renderFileList(_fbxKey());
  writeBridgeContext();
  _showUndoToast('Deleted ' + removed.length + ' version' + (removed.length !== 1 ? 's' : '') + ' of ' + escapeHTML(target), () => {
    const list = window._currentExports || [];
    window._currentExports = list.concat(removed);
    saveActiveProject();
    renderFileList(_fbxKey());
    writeBridgeContext();
  });
}

function _showUndoToast(msg, onUndo) {
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:40px;left:50%;transform:translateX(-50%);background:var(--bg3);border:1px solid var(--orange);border-radius:6px;padding:8px 16px;font-size:11px;font-family:'Space Mono',monospace;color:var(--text);z-index:1000;display:flex;align-items:center;gap:10px;box-shadow:0 4px 20px rgba(0,0,0,.5);animation:fadeUp .15s ease;white-space:nowrap;`;
  t.innerHTML = `<span>${msg}</span><button style="background:var(--accent);color:#000;border:none;border-radius:4px;padding:2px 8px;font-size:10px;font-family:'Space Mono',monospace;font-weight:700;cursor:pointer;letter-spacing:.5px">UNDO</button>`;
  document.body.appendChild(t);

  let undone = false;
  t.querySelector('button').addEventListener('click', () => {
    undone = true;
    onUndo();
    t.style.opacity = '0';
    setTimeout(() => t.remove(), 200);
  });

  setTimeout(() => {
    if (!undone) {
      t.style.opacity = '0';
      setTimeout(() => t.remove(), 200);
    }
  }, 5000);
}

window.openExportForm = openExportForm;
window.confirmDeleteExport = confirmDeleteExport;
window.confirmDeleteExportGroup = confirmDeleteExportGroup;

window.expHeadKey = function(e, target) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    toggleExportCollapse(target);
  }
};

window.toggleExportCollapse = function(target) {
  const cards = document.querySelectorAll('.exp-target');
  for (const card of cards) {
    const name = card.querySelector('.exp-group-name');
    if (name && name.textContent === target) {
      card.classList.toggle('collapsed');
      card.querySelector('.exp-group-head')?.setAttribute('aria-expanded', !card.classList.contains('collapsed'));
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
    const name = card.querySelector('.exp-group-name')?.textContent;
    if (name) {
      card.classList.toggle('collapsed', collapseAll);
      card.querySelector('.exp-group-head')?.setAttribute('aria-expanded', !collapseAll);
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
  btn.textContent = allCollapsed >= total ? 'Expand all' : 'Collapse all';
}

let _coverUrls = [];
async function loadExportCovers() {
  if (!globalSettings.root_path) return;
  _coverUrls.forEach(u => URL.revokeObjectURL(u));
  _coverUrls = [];
  const cards = document.querySelectorAll('.exp-target[data-target]');
  const nameToId = {};
  for (const [id, name] of Object.entries(baseIdMap)) nameToId[name] = id;

  for (const card of cards) {
    const target = card.dataset.target;
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
      _coverUrls.push(url);
      const imgEl = card.querySelector('.exp-cover-img');
      if (imgEl) imgEl.style.backgroundImage = 'url(' + url + ')';
    } catch (e) { console.warn('Failed to load cover for', target, e); }
  }
}

export { buildExportSection, addExport, saveExport, toggleFinalExport, deleteExport, deleteExportGroup, loadExportCovers, openExportForm };
