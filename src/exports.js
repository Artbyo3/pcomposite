import { escapeHTML } from './helpers.js';
import { FOLDERS, FOLDER_META } from './constants.js';
import { ALL_FILES, setAllFiles, globalSettings, projects } from './state.js';
import { saveProject, loadProject } from './data.js';
import { readDir } from '@tauri-apps/plugin-fs';
import { showToast } from './ui.js';
import { saveActiveProject } from './projects.js';
import { renderFileList } from './files.js';

// ── EXPORTS MANAGEMENT (integrated into export/ folder view) ──
function buildExportSection() {
  const exports = window._currentExports || [];
  const fbxFiles = ALL_FILES.filter(f => f.folder === 'fbx');
  const assigned = new Set();
  for (const ex of exports) if (ex.fileNames) ex.fileNames.forEach(n => assigned.add(n));
  const unassigned = fbxFiles.filter(f => !assigned.has(f.name));

  // Group by target (base name)
  const groups = {};
  for (const ex of exports) {
    const arr = groups[ex.target] || (groups[ex.target] = []);
    arr.push(ex);
  }
  // Sort targets alphabetically
  const sortedTargets = Object.keys(groups).sort();

  // Determine which target to show expanded (first or one with changes)
  // We'll default to first target expanded

  let html = '<div id="exportSection" class="export-section">';
  html += '<div class="exp-header">';
  html += '<span class="exp-header-icon">📦</span>';
  html += '<span class="exp-header-title">EXPORTS</span>';
  html += '<span class="exp-header-count">' + exports.length + ' record' + (exports.length !== 1 ? 's' : '') + ' · ' + fbxFiles.length + ' files</span>';
  html += '<button class="exp-header-btn" onclick="addExport()">+ New Export</button>';
  html += '</div>';

  if (!exports.length) {
    html += '<div class="exp-empty"><div class="exp-empty-text">No exports recorded yet<br>Click <b style="color:var(--accent)">+ New Export</b> to group your FBX files by avatar</div></div>';
    if (unassigned.length) html += '<div class="exp-empty-sub" style="padding:0 20px 14px;text-align:center">' + unassigned.length + ' unassigned file' + (unassigned.length !== 1 ? 's' : '') + ' below</div>';
    html += '</div>';
    return html;
  }

  // Per-base columns
  html += '<div style="display:flex;flex-direction:column;gap:14px">';
  for (const target of sortedTargets) {
    const items = groups[target].slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    const currentIdx = items.findIndex(x => x.isFinal);
    const finalIdx = currentIdx >= 0 ? currentIdx : 0;
    const current = items[finalIdx];
    const others = items.filter((_, i) => i !== finalIdx);

    html += '<div class="exp-col">';
    html += '<div class="exp-col-head" onclick="_toggleExpCollapse(this)">';
    html += '<span class="exp-col-toggle">▾</span>';
    html += '<div class="exp-col-info">';
    html += '<span class="exp-col-name">' + escapeHTML(target) + '</span>';
    html += '<span class="exp-badge">v' + (current.version || items.length) + '</span>';
    if (current.isFinal) html += '<span class="exp-badge">CURRENT</span>';
    html += '</div>';
    html += '<span class="exp-col-version-count">' + items.length + ' version' + (items.length !== 1 ? 's' : '') + '</span>';
    html += '<button class="exp-btn danger" onclick="event.stopPropagation();deleteExportGroup(\'' + escapeHTML(target).replace(/'/g, "\\'") + '\')" title="Delete all">✕</button>';
    html += '</div>';

    // Current version card
    html += '<div class="exp-card" style="' + (current.isFinal ? 'border-left-color:var(--green)' : '') + '">';
    html += '<div class="exp-top">';
    html += '<span class="exp-date">v' + (current.version || items.length) + ' · ' + (current.date || '—') + '</span>';
    if (current.isFinal) html += '<span class="exp-badge">CURRENT</span>';
    html += '<span class="exp-note-tag">' + (current.note ? escapeHTML(current.note) : '') + '</span>';
    html += '<div class="exp-top-actions">';
    html += '<button class="exp-btn" onclick="toggleFinalExport(' + exports.indexOf(current) + ')" title="' + (current.isFinal ? 'Unmark as current' : 'Mark as current') + '">★</button>';
    html += '<button class="exp-btn danger" onclick="deleteExport(' + exports.indexOf(current) + ')" title="Delete">✕</button>';
    html += '</div></div>';
    if (current.fileNames && current.fileNames.length) {
      html += '<div class="exp-files-list">';
      for (const fn of current.fileNames) {
        const f = fbxFiles.find(x => x.name === fn);
        html += '<span class="exp-file-tag" style="' + (f ? 'background:' + f.ec + '18;color:' + f.ec : '') + '">' + escapeHTML(fn) + '</span>';
      }
      html += '</div>';
    }
    html += '</div>';

    // Older versions
    if (others.length) {
      html += '<div class="exp-older-wrap">';
      html += '<div class="exp-older-toggle" onclick="_toggleExpOlder(this)"><span>▸</span> ' + others.length + ' older version' + (others.length !== 1 ? 's' : '') + '</div>';
      html += '<div class="exp-older-list" style="display:none">';
      for (const ex of others) {
        html += '<div class="exp-card exp-old" style="' + (ex.isFinal ? 'border-left-color:var(--green)' : '') + '">';
        html += '<div class="exp-top">';
        html += '<span class="exp-date">v' + (ex.version || '—') + ' · ' + (ex.date || '—') + '</span>';
        if (ex.isFinal) html += '<span class="exp-badge">CURRENT</span>';
        html += '<span class="exp-note-tag">' + (ex.note ? escapeHTML(ex.note) : '') + '</span>';
        html += '<div class="exp-top-actions">';
        html += '<button class="exp-btn" onclick="toggleFinalExport(' + exports.indexOf(ex) + ')" title="Mark as current">★</button>';
        html += '<button class="exp-btn danger" onclick="deleteExport(' + exports.indexOf(ex) + ')" title="Delete">✕</button>';
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
      html += '</div></div>';
    }

    html += '</div>';
  }
  html += '</div></div>';
  return html;
}

function _toggleExpCollapse(el) {
  const col = el.closest('.exp-col');
  const body = col.querySelectorAll('.exp-card, .exp-older-wrap');
  const toggle = el.querySelector('.exp-col-toggle');
  if (col.classList.toggle('exp-col-collapsed')) {
    body.forEach(b => b.style.display = 'none');
    toggle.textContent = '▸';
  } else {
    body.forEach(b => b.style.display = '');
    toggle.textContent = '▾';
    // Also collapse older versions list
    const older = col.querySelector('.exp-older-list');
    if (older) older.style.display = 'none';
  }
}
function _toggleExpOlder(el) {
  const list = el.parentElement.querySelector('.exp-older-list');
  const arrow = el.querySelector('span');
  if (list.style.display === 'none') {
    list.style.display = '';
    arrow.textContent = '▾';
  } else {
    list.style.display = 'none';
    arrow.textContent = '▸';
  }
}

function renderExports() {
  const sec = document.getElementById('exportSection');
  if (sec) sec.outerHTML = buildExportSection();
}

async function addExport() {
  const exports = window._currentExports || [];
  const basesPath = globalSettings.bases_path;
  let bases = [];

  // Try to read bases directory for dropdown
  if (basesPath) {
    try {
      const entries = await readDir(basesPath);
      bases = entries
        .filter(e => !e.isDirectory && /\.(fbx|blend)$/i.test(e.name))
        .map(e => e.name.replace(/\.(fbx|blend)$/i, ''))
        .filter((v, i, a) => a.indexOf(v) === i)
        .sort();
    } catch (e) {
      // Fall back to existing targets
    }
  }
  // Also add existing targets that might not be in the directory
  const existingTargets = [...new Set(exports.map(e => e.target))];
  for (const t of existingTargets) { if (!bases.includes(t)) bases.push(t); }
  bases.sort();

  // If we have bases from the directory, use a proper dropdown; otherwise fall back to datalist
  const hasDirBases = basesPath && bases.length > 0;

  const baseOptions = bases.map(t =>
    '<option value="' + escapeHTML(t).replace(/"/g, '&quot;') + '">' + escapeHTML(t) + '</option>'
  ).join('');

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

  // Show bases hint if bases_path is not set
  const basesHint = !basesPath
    ? '<div style="font-size:7px;font-family:\'Space Mono\',monospace;color:var(--orange);padding:4px 0">Set <b>Avatar Bases Path</b> in Settings to populate the dropdown</div>'
    : (hasDirBases ? '<div style="font-size:7px;font-family:\'Space Mono\',monospace;color:var(--text3);padding:4px 0">' + bases.length + ' base' + (bases.length !== 1 ? 's' : '') + ' found</div>' : '');

  // Auto-version: compute next version for default target
  const defaultTarget = bases.length ? bases[0] : (existingTargets.length === 1 ? existingTargets[0] : '');
  const nextVer = defaultTarget ? getNextVersion(exports, defaultTarget) : 1;

  overlay.innerHTML = '<div style="background:var(--bg2);border:1px solid var(--border2);border-radius:8px;width:380px;padding:20px;display:flex;flex-direction:column;gap:10px;animation:fadeUp .15s ease;max-height:90vh;overflow-y:auto">'
    + '<div style="font-size:12px;font-weight:700">New Export</div>'
    + basesHint
    + '<label style="font-size:7px;font-family:\'Space Mono\',monospace;letter-spacing:1px;color:var(--text3)">TARGET BASE</label>'
    + (hasDirBases
      ? '<select id="_expTarget" style="background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:8px 10px;color:var(--text);font-size:11px;outline:none">' + baseOptions + '</select>'
      : '<input id="_expTarget" list="_expTargets" placeholder="Type base name (e.g. Base Male)" style="background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:8px 10px;color:var(--text);font-size:11px;outline:none" value="' + (defaultTarget ? escapeHTML(defaultTarget).replace(/"/g, '&quot;') : '') + '">'
      + (existingTargets.length ? '<datalist id="_expTargets">' + baseOptions + '</datalist>' : '')
    )
    + '<div style="display:flex;gap:6px;align-items:center;background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:6px 10px">'
    + '<span style="font-size:7px;font-family:\'Space Mono\',monospace;letter-spacing:1px;color:var(--text3)">VERSION</span>'
    + '<span id="_expVerPreview" style="font-size:14px;font-weight:700;color:var(--accent)">' + nextVer + '</span>'
    + '</div>'
    + '<input id="_expNote" placeholder="Note (e.g. final cleanup)" style="background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:8px 10px;color:var(--text);font-size:11px;outline:none">'
    + '<input id="_expDate" type="date" value="' + new Date().toISOString().slice(0, 10) + '" style="background:var(--bg3);border:1px solid var(--border);border-radius:4px;padding:8px 10px;color:var(--text);font-size:11px;outline:none">'
    + (available.length ? '<div style="border-top:1px solid var(--border);padding-top:6px"><div style="font-size:7px;font-family:\'Space Mono\',monospace;letter-spacing:1px;color:var(--text3);margin-bottom:4px">INCLUDE FBX FILES</div>' + fileCheckboxes + '</div>' : '<div style="border-top:1px solid var(--border);padding-top:6px;font-size:8px;color:var(--text3);text-align:center;font-family:\'Space Mono\',monospace">All FBX files are already assigned to exports</div>')
    + '<div style="display:flex;gap:6px">'
    + '<label style="display:flex;align-items:center;gap:6px;font-size:10px;color:var(--text2);cursor:pointer"><input id="_expFinal" type="checkbox"> Mark as current</label>'
    + '</div>'
    + '<div style="display:flex;gap:6px;margin-top:4px">'
    + '<button onclick="this.closest(\'div[style*=\"position:fixed\"]\').remove()" style="flex:1;height:30px;background:var(--bg3);border:1px solid var(--border);border-radius:4px;color:var(--text2);cursor:pointer;font-size:10px;font-weight:600">Cancel</button>'
    + '<button onclick="saveExport(this)" style="flex:1;height:30px;background:var(--accent);color:#000;border:none;border-radius:4px;cursor:pointer;font-size:10px;font-weight:700">Save</button>'
    + '</div></div>';
  document.body.appendChild(overlay);
  setTimeout(() => document.getElementById('_expTarget')?.focus(), 100);

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
  const overlay = btn.closest('div[style*="position:fixed"]');
  const targetEl = document.getElementById('_expTarget');
  const target = targetEl?.value?.trim();
  const note = document.getElementById('_expNote')?.value?.trim();
  const dateInput = document.getElementById('_expDate')?.value;
  const isFinal = document.getElementById('_expFinal')?.checked || false;

  if (!target) { showToast('Select or enter a target base name', 'var(--orange)'); return; }

  const selectedFiles = [];
  document.querySelectorAll('._expFileCb:checked').forEach(cb => selectedFiles.push(cb.value));

  const exports = window._currentExports || [];

  // Auto-assign version number
  const version = getNextVersion(exports, target);

  if (isFinal) {
    for (const ex of exports) { if (ex.target === target) ex.isFinal = false; }
  }
  exports.push({
    id: 'exp_' + Date.now().toString(36),
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
}

function deleteExport(idx) {
  const exports = window._currentExports || [];
  exports.splice(idx, 1);
  window._currentExports = exports;
  saveActiveProject();
  renderFileList('fbx');
}

function deleteExportGroup(target) {
  const exports = window._currentExports || [];
  window._currentExports = exports.filter(e => e.target !== target);
  saveActiveProject();
  renderFileList('fbx');
}

export { buildExportSection, renderExports, addExport, saveExport, toggleFinalExport, deleteExport, deleteExportGroup, getNextVersion, _toggleExpCollapse, _toggleExpOlder };
