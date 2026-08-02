import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { escapeHTML, isStreamerMode, sanitizePath, generateId } from './helpers.js';
import { globalSettings, projects } from './state.js';
import { loadSettings as loadJSONSettings, saveSettings, migrateOldBases, ensureVaultBasesDir } from './data.js';
import { showToast, showConfirm } from './ui.js';
import { DEFAULT_TOOLS, DEFAULT_PIPELINE_STAGES } from './constants.js';

async function loadSettings() {
  try {
    const data = await loadJSONSettings();
    // Migrate old bases_path to vault _bases/ if present
    const oldBases = data.bases_path;
    delete data.bases_path;
    Object.assign(globalSettings, data);
    if (oldBases && globalSettings.root_path) {
      await migrateOldBases(globalSettings.root_path, oldBases);
    }
    // Ensure vault _bases/ directory exists
    if (globalSettings.root_path) {
      await ensureVaultBasesDir(globalSettings.root_path);
    }
    // Pre-populate default tools and pipeline stages if missing
    let needsSave = false;
    if (!globalSettings.tools || !globalSettings.tools.length) {
      globalSettings.tools = DEFAULT_TOOLS;
      needsSave = true;
    } else {
      // Seed file_types on existing tools that don't have any yet
      let toolsChanged = false;
      globalSettings.tools = globalSettings.tools.map(t => {
        const def = DEFAULT_TOOLS.find(d => d.id === t.id || d.name === t.name);
        if (def && def.file_types && !(Array.isArray(t.file_types) && t.file_types.length)) {
          toolsChanged = true;
          return { ...t, file_types: [...def.file_types] };
        }
        return t;
      });
      if (toolsChanged) needsSave = true;
    }
    if (!globalSettings.pipelineStages || !globalSettings.pipelineStages.length) {
      globalSettings.pipelineStages = DEFAULT_PIPELINE_STAGES;
      needsSave = true;
    }
    if (needsSave) {
      try { await saveSettings(globalSettings); }
      catch (e) { console.warn('Could not save default tools/stages', e); }
    }
    applyTheme();
  } catch (e) { console.error('loadSettings error:', e); }
  Object.keys(globalSettings).forEach(k => { const el = document.getElementById('set_' + k); if (el) el.value = globalSettings[k]; });
}

function applyTheme() {
  document.body.classList.toggle('theme-pink', globalSettings.theme === 'pink');
}

async function saveSetting(key, value) {
  globalSettings[key] = value;
  const el = document.getElementById('set_' + key);
  if (el) el.value = value;
  try { await saveSettings(globalSettings); }
  catch (e) { showToast('Could not save setting', 'var(--red)'); }
  if (key === 'root_path' && value) {
    await ensureVaultBasesDir(value);
  }
}

async function openSettings() {
  await loadSettings();
  document.getElementById('settingsOverlay').classList.add('open');
  renderSettings();
}

const TOOL_COLORS = ['#ff6b35','#a78bfa','#47c5ff','#3ddc84','#fb923c','#f472b6','#fbbf24','#e8ff47'];

function renderSettings() {
  const sections = ['general','naming','workflow','integrations','appearance'];
  const names = { general:'General', naming:'Export Naming', workflow:'Tools & Pipeline', integrations:'App Integrations', appearance:'Appearance' };
  document.getElementById('setContent').innerHTML =
    sections.map(s => `<div class="set-section">
      <div class="set-section-head">${names[s]}</div>
      ${renderSectionContent(s)}
    </div>`).join('');
  initWorkflowDrag();
  setTimeout(updateNamingPreview, 50);
}

function closeSettings() { document.getElementById('settingsOverlay').classList.remove('open'); }

async function pickSettingPath(key, isDir) {
  try {
    const selected = await openDialog({ directory: isDir, multiple: false, defaultPath: globalSettings[key] || undefined });
    if (selected) { await saveSetting(key, selected); showToast('Path updated', 'var(--green)'); }
  } catch (err) { showToast('Could not open file browser', 'var(--red)'); }
}

function makeField(key, cfg) {
  const display = sanitizePath(globalSettings[key] || '', cfg.label === 'Vault Path' ? '[vault]' : '[path set]');
  return `<div class="fg">
    <label class="fl">${cfg.label}</label>
    <div class="set-path-row">
      <input id="set_${key}" readonly class="fi" placeholder="${cfg.placeholder}" value="${escapeHTML(display)}" />
      <button onclick="pickSettingPath('${key}',${cfg.isDir})" class="set-browse" title="Browse"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg></button>
    </div>
  </div>`;
}

function renderSectionContent(section) {
  const paths = {
    root_path: { label: 'Vault Path', placeholder: 'Not set — click folder to browse', isDir: true },
    blender_path: { label: 'Blender Executable', placeholder: 'Not set', isDir: false },
    painter_path: { label: 'Substance Painter Executable', placeholder: 'Not set', isDir: false },
    unity_path: { label: 'Unity Executable', placeholder: 'Not set', isDir: false },
  };

  if (section === 'general') {
    const smOn = isStreamerMode();
    return `<div class="set-group">
      <div class="set-group-title">Vault</div>
      ${makeField('root_path', paths.root_path)}
    </div>
    <div class="set-group">
      <div class="set-group-title">Privacy</div>
      <div class="toggle-row">
        <div style="flex:1;min-width:0">
          <div class="toggle-label">Streamer Mode</div>
          <div class="toggle-desc">Hide file paths and project IDs from the UI</div>
        </div>
        <div class="toggle-btns">
          <button class="toggle-btn${smOn ? '' : ' on'}" onclick="toggleStreamerMode()">OFF</button>
          <button class="toggle-btn${smOn ? ' on' : ''}" onclick="toggleStreamerMode()">ON</button>
        </div>
      </div>
    </div>`;
  }

  if (section === 'naming') {
    const projectName = projects.find(x => x.active)?.name || 'MyProject';
    return `<div class="set-group">
      <div class="set-group-title">Export File Naming</div>
      <div class="set-group-desc">Customise the filename pattern for exports. Variables auto-replace when exporting.</div>
      <div class="fg"><input id="set_export_naming" class="fi" value="${escapeHTML(globalSettings.export_naming || '{target}_v{version}')}" oninput="saveNamingPattern()"></div>
      <div class="naming-vars">
        <span class="nv-chip">{project}</span> <span class="nv-chip">{target}</span> <span class="nv-chip">{version}</span> <span class="nv-chip">{date}</span>
      </div>
      <div class="naming-preview" id="namingPreview"></div>
    </div>`;
  }

  if (section === 'integrations') {
    const apps = ['blender', 'painter', 'unity'];
    const appIcons = {
      blender: '<img src="/blender.svg" width="16" height="16" />',
      painter: '<img src="/substance-3d-painter.svg" width="16" height="16" />',
      unity: '<img src="/Unity.svg" width="16" height="16" />',
    };
    const appNames = { blender: 'Blender', painter: 'Substance Painter', unity: 'Unity Editor' };
    return `<div class="set-group">
      <div class="set-group-title">App Integrations</div>
      <div class="set-group-desc">Configure which apps PCOMPOSITE integrates with</div>
      <div class="app-cards">
        ${apps.map(key => {
          const pathKey = key + '_path';
          const val = globalSettings[pathKey] || '';
          const display = sanitizePath(val, '[path set]');
          const connected = !!val;
          return `<div class="app-card">
            <div class="app-card-head">
              <span class="app-card-icon">${appIcons[key]}</span>
              <div style="flex:1">
                <div class="app-card-name">${appNames[key]}</div>
                <span class="app-card-status ${connected ? 'on' : ''}">${connected ? 'CONNECTED' : 'NOT SET'}</span>
              </div>
            </div>
            <div class="app-card-body">
              <div class="set-path-row">
                <input id="set_${pathKey}" readonly class="fi" placeholder="Not set" value="${escapeHTML(display)}" />
                <button onclick="pickSettingPath('${pathKey}',false)" class="set-browse" title="Browse"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg></button>
              </div>
                ${key === 'blender' ? `
                  <div class="addon-box" onmousedown="dragStart(event)" onmousemove="dragMove(event)" onmouseup="dragEnd(event)" data-tip="Drag this card into Blender's window to install the addon">
                  <img src="/addon_icon.png" width="22" height="22" style="object-fit:contain">
                  <div class="addon-title">Blender Addon</div>
                  <div class="addon-sub">Drag this card into Blender to install</div>
                </div>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  if (section === 'workflow') {
    const tools = globalSettings.tools || [];
    const stages = globalSettings.pipelineStages || [];
    return `<div class="wf-bento">
      <div class="set-group">
        <div class="set-group-title">Tools <span class="wf-count">${tools.length}</span></div>
        <div class="set-group-desc">Define the tools and folders in your pipeline. Official tools are built-in; custom tools you can add and remove freely. Drag tiles to set the order.</div>
        <div class="wf-search"><input id="wfToolsSearch" class="fi" placeholder="Search tools..." oninput="filterToolsList()"></div>
        <div id="toolsListContent" class="wf-tiles">
          ${_renderToolsList(tools)}
          <div class="wtile wtile-add" onclick="showToolForm()" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();showToolForm()}">+ ADD TOOL</div>
        </div>
        <div id="wfToolsEmpty" class="wf-empty" style="display:none">No tools match your search</div>
      </div>
      <div class="set-group">
        <div class="set-group-title">Pipeline Stages <span class="wf-count">${stages.length}</span></div>
        <div class="set-group-desc">Stages shown in the pipeline bar and used to generate checklists for new projects. Drag rows to set the order.</div>
        <div id="stagesListContent" class="wf-stages">
          ${_renderStagesList(stages, tools)}
          <div class="wstage wstage-add" onclick="showStageForm()" role="button" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();showStageForm()}">+ ADD STAGE</div>
        </div>
      </div>
    </div>`;
  }

  if (section === 'appearance') {
    const themes = [
      { id:'dark', label:'Dark', colors:'--text2:#7a7a90;--accent:#e8ff47;--border:var(--border)' },
      { id:'pink', label:'Pink', colors:'--text2:#a07a90;--accent:#ff6bb5;--border:#382238' },
    ];
    return `<div class="set-group">
      <div class="set-group-title">Theme</div>
      <div class="theme-row">
        ${themes.map(t => `
          <div class="theme-card${globalSettings.theme === t.id ? ' active' : ''}" onclick="setTheme('${t.id}')">
            <div class="theme-preview"><div class="tp-bg" style="${t.colors}"><div class="tp-side"></div><div class="tp-main"><div class="tp-bar"></div><div class="tp-acl" style="background:${t.id === 'dark' ? '#e8ff47' : '#ff6bb5'}"></div></div></div></div>
            <div class="tcl">${t.label}</div>
          </div>
        `).join('')}
      </div>
    </div>`;
  }

  return '';
}

function previewNaming(pattern) {
  const p = projects.find(x => x.active);
  const subs = {
    '{project}': p?.name || 'MyProject',
    '{target}': 'Character',
    '{version}': '3',
    '{date}': new Date().toISOString().slice(0, 10),
  };
  let out = pattern;
  for (const [k, v] of Object.entries(subs)) out = out.replaceAll(k, v);
  return out.replace(/[<>:"/\\|?*]/g, '_').replace(/ /g, '_') + '.fbx';
}

window.updateNamingPreview = function() {
  const el = document.getElementById('set_export_naming');
  const preview = document.getElementById('namingPreview');
  if (el && preview) preview.textContent = previewNaming(el.value);
};

window.saveNamingPattern = async function() {
  const el = document.getElementById('set_export_naming');
  if (!el) return;
  const val = el.value.trim() || '{target}_v{version}';
  await saveSetting('export_naming', val);
  updateNamingPreview();
};

let dragState = null;
let dragClone = null;

window.dragStart = function(e) {
  if (e.target.closest('.set-btn, span')) return;
  dragState = { startX: e.screenX, startY: e.screenY, triggered: false };
};

window.dragMove = async function(e) {
  if (dragClone) {
    dragClone.style.left = (e.clientX - 100) + 'px';
    dragClone.style.top = (e.clientY - 48) + 'px';
  }
  if (!dragState || dragState.triggered) return;
  const dx = e.screenX - dragState.startX;
  const dy = e.screenY - dragState.startY;
  if (dx * dx + dy * dy > 100) {
    dragState.triggered = true;

    const clone = document.createElement('div');
    clone.className = 'addon-box drag-clone';
    clone.innerHTML = '<img src="/addon_icon.png" width="22" height="22" style="object-fit:contain"><div class="addon-title">BLENDER ADDON</div><div class="addon-sub">Drop on Blender to install</div>';
    clone.style.left = (e.clientX - 100) + 'px';
    clone.style.top = (e.clientY - 48) + 'px';
    document.body.appendChild(clone);
    dragClone = clone;

    try {
      await invoke('drag_addon');
    } catch (err) {
      showToast('Drag cancelled', 'var(--red)');
    } finally {
      if (dragClone) { dragClone.remove(); dragClone = null; }
    }
  }
};

window.dragEnd = function() {
  if (dragClone) { dragClone.remove(); dragClone = null; }
  dragState = null;
};

window.toggleStreamerMode = async function() {
  globalSettings.streamer_mode = !globalSettings.streamer_mode;
  await saveSettings(globalSettings);
  renderSettings();
  const { projects } = await import('./state.js');
  const p = projects.find(x => x.active);
  if (p) {
    const { selectProject } = await import('./projects.js');
    await selectProject(p);
  }
};

window.setTheme = async function(theme) {
  globalSettings.theme = theme;
  applyTheme();
  await saveSettings(globalSettings);
  renderSettings();
};

// ── TOOLS LIST RENDERER ──

function _renderToolsList(tools) {
  if (!tools.length) return '<div class="wf-empty">No tools configured</div>';
  return tools.map((t) => {
    const sd = escapeHTML((t.name + ' ' + t.folder_key + ' ' + (t.file_types || []).join(' ')).toLowerCase());
    return `<div class="wtile" style="--fc:${t.color}" data-search="${sd}" data-id="${t.id}" draggable="true" tabindex="0" title="Drag to reorder" onkeydown="keyReorderTool(event, this)">
      <div class="wtile-top">
        <span class="wtile-color" style="background:${t.color}"></span>
        <span class="wf-tier ${t.tier}">${t.tier.toUpperCase()}</span>
      </div>
      <div class="wtile-name">${escapeHTML(t.name)}</div>
      <div class="wtile-meta">${escapeHTML(t.folder_key)}</div>
      <div class="wtile-types">${(t.file_types || []).map(x => `<span>${escapeHTML(x)}</span>`).join('')}</div>
      <div class="wtile-actions">
        <button class="wf-btn" onclick="showToolForm('${t.id}')" title="Edit ${escapeHTML(t.name)}" aria-label="Edit ${escapeHTML(t.name)}">✎</button>
        ${t.tier !== 'official' ? `<button class="wf-btn danger" onclick="deleteTool('${t.id}')" title="Remove ${escapeHTML(t.name)}" aria-label="Remove ${escapeHTML(t.name)}">✕</button>` : ''}
      </div>
    </div>`;
  }).join('');
}

function _renderStagesList(stages, tools) {
  if (!stages.length) return '<div class="wf-empty">No stages configured</div>';
  return stages.map((s, i) => {
    const toolName = s.tool_id ? (tools.find(t => t.id === s.tool_id)?.name || '?') : null;
    const num = String(i + 1).padStart(2, '0');
    return `<div class="wstage" data-idx="${i}" draggable="true" tabindex="0" title="Drag to reorder" onkeydown="keyReorderStage(event, this)">
      <span class="wstage-pos">${num}</span>
      <span class="wstage-color" style="background:${s.color}"></span>
      <div class="wstage-info">
        <div class="wstage-name">${escapeHTML(s.name)}</div>
        ${toolName ? `<span class="wf-tag">→ ${escapeHTML(toolName)}</span>` : ''}
      </div>
      <div class="wf-actions">
        <button class="wf-btn" onclick="showStageForm(${i})" title="Edit ${escapeHTML(s.name)}" aria-label="Edit ${escapeHTML(s.name)}">✎</button>
        <button class="wf-btn danger" onclick="deleteStage(${i})" title="Remove ${escapeHTML(s.name)}" aria-label="Remove ${escapeHTML(s.name)}">✕</button>
      </div>
    </div>`;
  }).join('');
}

// ── TOOL CRUD ──

let _editingToolId = null;

window.showToolForm = function(toolId) {
  _editingToolId = toolId || null;
  const tool = toolId ? (globalSettings.tools || []).find(t => t.id === toolId) : null;
  const isOfficial = tool?.tier === 'official';
  const currentColor = tool?.color || TOOL_COLORS[0];

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'toolFormOverlay';
  overlay.style.zIndex = '950';
  overlay.onclick = (e) => { if (e.target === overlay) closeToolForm(); };

  overlay.innerHTML = `
    <div class="modal">
      <div class="mhead">
        <span class="mtitle">${tool ? 'Edit Tool' : 'Add Tool'}</span>
        <button class="mclose" onclick="closeToolForm()">✕</button>
      </div>
      <div class="mbody2">
        <div class="fg">
          <label class="fl">Name</label>
          <input id="wf_toolName" class="fi" placeholder="e.g. Maya" value="${escapeHTML(tool?.name || '')}" ${isOfficial ? 'readonly' : ''}>
        </div>
        <div class="fg">
          <label class="fl">Folder Key</label>
          <input id="wf_toolFolder" class="fi" placeholder="e.g. maya" value="${escapeHTML(tool?.folder_key || '')}" ${isOfficial ? 'readonly' : ''}>
          <div class="wf-meta" style="margin-top:3px">Folder name created inside each project</div>
        </div>
        <div class="fg">
          <label class="fl">File Types</label>
          <input id="wf_toolTypes" class="fi" placeholder="e.g. blend, fbx, zip" value="${escapeHTML((tool?.file_types || []).join(', '))}">
          <div class="wf-meta" style="margin-top:3px">Comma-separated extensions. Dropped files with these extensions auto-sort into this tool's folder. Anything else falls back to the Export folder.</div>
        </div>
        <div class="fg">
          <label class="fl">Color</label>
          <div class="wf-palette">
            ${TOOL_COLORS.map(c => `<div class="wf-palette-item ${c === currentColor ? 'active' : ''}" style="background:${c}" data-color="${c}" onclick="selectPalette(this,'wf_toolColor')"></div>`).join('')}
          </div>
          <input id="wf_toolColor" type="hidden" value="${currentColor}">
        </div>
        <div class="fg">
          <label class="fl">Launch Method</label>
          <div class="set-path-row">
            <input id="wf_toolExe" class="fi" placeholder="Browse for .exe or tap Detect" value="${escapeHTML(tool?.exe_path || '')}">
            <button onclick="browseFilePath('wf_toolExe')" class="set-browse" title="Browse"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg></button>
          </div>
          <div style="margin-top:4px;display:flex;align-items:center;gap:6px">
            <button onclick="detectApps()" class="btn btn-ghost" style="font-size:11px;padding:3px 8px" type="button">Detect installed apps...</button>
            <span id="wf_aumidBadge" style="${tool?.aumid ? '' : 'display:none'};font-size:10px;color:var(--text3);background:var(--bg3);padding:2px 6px;border-radius:4px">MSIX app</span>
            <input id="wf_toolAumid" type="hidden" value="${escapeHTML(tool?.aumid || '')}">
          </div>
        </div>
      </div>
      <div class="mfoot">
        <button class="btn btn-secondary" onclick="closeToolForm()">Cancel</button>
        <button class="btn btn-primary" onclick="saveToolFromForm()">Save</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => { overlay.classList.add('open'); const el = document.getElementById('wf_toolName'); if (el) el.focus(); });
};

window.closeToolForm = function() {
  const el = document.getElementById('toolFormOverlay');
  if (el) el.remove();
  _editingToolId = null;
};

window.saveToolFromForm = async function() {
  const name = document.getElementById('wf_toolName')?.value.trim();
  const folderKey = document.getElementById('wf_toolFolder')?.value.trim();
  const color = document.getElementById('wf_toolColor')?.value;
  const exePath = document.getElementById('wf_toolExe')?.value.trim() || '';
  const aumid = document.getElementById('wf_toolAumid')?.value.trim() || '';
  const fileTypes = (document.getElementById('wf_toolTypes')?.value || '')
    .split(/[, ]+/).map(s => s.trim().toLowerCase().replace(/^\.+/, '')).filter(Boolean);

  if (!name) { showToast('Tool name is required', 'var(--orange)'); return; }
  if (!folderKey) { showToast('Folder key is required', 'var(--orange)'); return; }
  if (!color) { showToast('Select a color', 'var(--orange)'); return; }
  if (!/^[a-z0-9_ -]+$/i.test(folderKey)) {
    showToast('Folder key: letters, numbers, hyphens and underscores only', 'var(--orange)');
    return;
  }

  const tools = [...(globalSettings.tools || [])];
  const dup = tools.find(t => t.folder_key === folderKey && t.id !== _editingToolId);
  if (dup) { showToast('Another tool already uses this folder key', 'var(--orange)'); return; }

  if (_editingToolId) {
    const idx = tools.findIndex(t => t.id === _editingToolId);
    if (idx >= 0) tools[idx] = { ...tools[idx], name, folder_key: folderKey, color, exe_path: exePath, aumid, file_types: fileTypes };
  } else {
    const maxOrder = tools.reduce((m, t) => Math.max(m, t.order), -1);
    tools.push({ id:'tool_' + generateId(), name, folder_key: folderKey, color, exe_path: exePath, aumid, tier:'custom', capabilities:[], file_types: fileTypes, order: maxOrder + 1 });
  }

  globalSettings.tools = tools;
  try {
    await saveSettings(globalSettings);
    closeToolForm();
    renderSettings();
    showToast('Tool saved', 'var(--green)');
  } catch (e) { showToast('Could not save tool', 'var(--red)'); }
};

let _detectOverlay = null;
window.detectApps = async function() {
  if (_detectOverlay) return;
  const raw = await invoke('detect_installed_apps').catch(() => '[]');
  let list;
  try { list = JSON.parse(raw); if (!Array.isArray(list)) list = [list]; } catch(e) { list = []; }
  const filtered = list.filter(a => a.AppID && a.Name && !a.Name.includes('Settings') && !a.Name.includes('Microsoft'));
  filtered.sort((a,b) => a.Name.localeCompare(b.Name));

  const ov = document.createElement('div');
  ov.className = 'overlay';
  ov.style.zIndex = '960';
  _detectOverlay = ov;
  ov.onclick = e => { if (e.target === ov) closeDetectOverlay(); };

  ov.innerHTML = `
    <div class="modal" style="width:460px;max-height:520px">
      <div class="mhead">
        <span class="mtitle">Installed Apps</span>
        <button class="mclose" onclick="closeDetectOverlay()">✕</button>
      </div>
      <div class="mbody2" style="padding:8px">
        <input id="detectSearch" class="fi" placeholder="Search apps..." style="margin-bottom:6px" oninput="filterDetectList()">
        <div id="detectList" style="max-height:360px;overflow-y:auto;display:flex;flex-direction:column;gap:2px">
          ${filtered.map(a => {
            const isMsix = a.AppID.includes('!');
            return `<div class="detect-row" data-appid="${escapeHTML(a.AppID)}" data-name="${escapeHTML(a.Name)}" onclick="selectDetectedApp(this)">
              <span>${escapeHTML(a.Name)}</span>
              <span style="font-size:9px;color:var(--text3)">${isMsix ? 'MSIX' : 'EXE'}</span>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(ov);
  requestAnimationFrame(() => {
    ov.classList.add('open');
    document.getElementById('detectSearch')?.focus();
  });
};

window.filterDetectList = function() {
  const q = (document.getElementById('detectSearch')?.value || '').toLowerCase();
  document.querySelectorAll('.detect-row').forEach(r => {
    r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
};

window.selectDetectedApp = function(row) {
  const name = row.dataset.name;
  const appId = row.dataset.appid;
  const isMsix = appId.includes('!');

  document.getElementById('wf_toolName').value = name;
  document.getElementById('wf_toolFolder').value = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  if (isMsix) {
    document.getElementById('wf_toolExe').value = '';
    document.getElementById('wf_toolAumid').value = appId;
    const badge = document.getElementById('wf_aumidBadge');
    if (badge) badge.style.display = '';
  } else {
    document.getElementById('wf_toolExe').value = appId;
    document.getElementById('wf_toolAumid').value = '';
    const badge = document.getElementById('wf_aumidBadge');
    if (badge) badge.style.display = 'none';
  }
  closeDetectOverlay();
};

window.closeDetectOverlay = function() {
  if (_detectOverlay) { _detectOverlay.remove(); _detectOverlay = null; }
};

window.deleteTool = async function(toolId) {
  const tools = globalSettings.tools || [];
  const tool = tools.find(t => t.id === toolId);
  if (!tool) return;
  if (tool.tier === 'official') { showToast('Cannot remove an official tool', 'var(--orange)'); return; }

  const linked = (globalSettings.pipelineStages || []).filter(s => s.tool_id === toolId).length;
  const msg = linked
    ? `Remove "<b>${escapeHTML(tool.name)}</b>" from the pipeline? ${linked} stage${linked > 1 ? 's' : ''} using it will be unlinked.`
    : `Remove "<b>${escapeHTML(tool.name)}</b>" from the pipeline? This cannot be undone.`;
  const confirmed = await showConfirm('Remove Tool', msg);
  if (!confirmed) return;

  const stages = (globalSettings.pipelineStages || []).map(s =>
    s.tool_id === toolId ? { ...s, tool_id: null } : s
  );

  globalSettings.tools = tools.filter(t => t.id !== toolId);
  globalSettings.pipelineStages = stages;
  try {
    await saveSettings(globalSettings);
    renderSettings();
    showToast('"' + tool.name + '" removed', 'var(--green)');
  } catch (e) { showToast('Could not remove tool', 'var(--red)'); }
};

// ── REORDER: DRAG & DROP + KEYBOARD ──

let _dragType = null;
let _dragId = null;
let _dragIdx = null;

function initWorkflowDrag() {
  const toolsBox = document.getElementById('toolsListContent');
  if (toolsBox) {
    toolsBox.querySelectorAll('.wtile[draggable="true"]').forEach(tile => {
      tile.addEventListener('dragstart', onToolDragStart);
      tile.addEventListener('dragover', onToolDragOver);
      tile.addEventListener('dragleave', onDragLeave);
      tile.addEventListener('drop', onToolDrop);
      tile.addEventListener('dragend', onDragEnd);
    });
  }
  const stagesBox = document.getElementById('stagesListContent');
  if (stagesBox) {
    stagesBox.querySelectorAll('.wstage[draggable="true"]').forEach(row => {
      row.addEventListener('dragstart', onStageDragStart);
      row.addEventListener('dragover', onStageDragOver);
      row.addEventListener('dragleave', onDragLeave);
      row.addEventListener('drop', onStageDrop);
      row.addEventListener('dragend', onDragEnd);
    });
  }
}

function onToolDragStart(e) {
  _dragType = 'tool'; _dragId = e.currentTarget.dataset.id;
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', _dragId);
  e.currentTarget.classList.add('dragging');
}

function onStageDragStart(e) {
  _dragType = 'stage'; _dragIdx = parseInt(e.currentTarget.dataset.idx, 10);
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', String(_dragIdx));
  e.currentTarget.classList.add('dragging');
}

function onDragLeave(e) {
  e.currentTarget.classList.remove('drop', 'drop-top', 'drop-bottom');
}

function onDragEnd(e) {
  e.currentTarget.classList.remove('dragging', 'drop', 'drop-top', 'drop-bottom');
  _dragType = null; _dragId = null; _dragIdx = null;
}

function onToolDragOver(e) {
  if (_dragType !== 'tool') return;
  e.preventDefault();
  e.currentTarget.classList.add('drop');
}

function onStageDragOver(e) {
  if (_dragType !== 'stage') return;
  e.preventDefault();
  const t = e.currentTarget;
  t.classList.remove('drop-top', 'drop-bottom');
  const rect = t.getBoundingClientRect();
  t.classList.add((e.clientY - rect.top) < rect.height / 2 ? 'drop-top' : 'drop-bottom');
}

function onToolDrop(e) {
  if (_dragType !== 'tool') return;
  e.preventDefault();
  const t = e.currentTarget;
  t.classList.remove('drop');
  if (t.dataset.id === _dragId) return;
  const tools = [...(globalSettings.tools || [])];
  const from = tools.findIndex(x => x.id === _dragId);
  const to = tools.findIndex(x => x.id === t.dataset.id);
  if (from < 0 || to < 0) return;
  const [moved] = tools.splice(from, 1);
  tools.splice(tools.findIndex(x => x.id === t.dataset.id) + 1, 0, moved);
  tools.forEach((x, i) => x.order = i);
  globalSettings.tools = tools;
  saveToolOrder();
}

function onStageDrop(e) {
  if (_dragType !== 'stage') return;
  e.preventDefault();
  const t = e.currentTarget;
  const after = t.classList.contains('drop-bottom');
  t.classList.remove('drop-top', 'drop-bottom');
  const stages = [...(globalSettings.pipelineStages || [])];
  const from = _dragIdx;
  const to = parseInt(t.dataset.idx, 10);
  if (from < 0 || to < 0 || from === to) return;
  const [moved] = stages.splice(from, 1);
  let insertAt = to > from ? to - 1 : to;
  if (after) insertAt += 1;
  stages.splice(insertAt, 0, moved);
  stages.forEach((s, i) => s.order = i);
  globalSettings.pipelineStages = stages;
  saveStageOrder();
}

async function saveToolOrder() {
  try { await saveSettings(globalSettings); renderSettings(); showToast('Tool order updated', 'var(--green)'); }
  catch (e) { showToast('Could not reorder tools', 'var(--red)'); }
}

async function saveStageOrder() {
  try { await saveSettings(globalSettings); renderSettings(); showToast('Stage order updated', 'var(--green)'); }
  catch (e) { showToast('Could not reorder stages', 'var(--red)'); }
}

window.keyReorderTool = async function(e, tile) {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  e.preventDefault();
  const tools = [...(globalSettings.tools || [])];
  const idx = tools.findIndex(x => x.id === tile.dataset.id);
  const newIdx = idx + (e.key === 'ArrowUp' ? -1 : 1);
  if (idx < 0 || newIdx < 0 || newIdx >= tools.length) return;
  [tools[idx], tools[newIdx]] = [tools[newIdx], tools[idx]];
  tools.forEach((t, i) => t.order = i);
  globalSettings.tools = tools;
  try {
    await saveSettings(globalSettings);
    renderSettings();
    const next = document.querySelector(`.wtile[data-id="${tile.dataset.id}"]`);
    if (next) next.focus();
    showToast('Tool order updated', 'var(--green)');
  } catch (err) { showToast('Could not reorder tools', 'var(--red)'); }
};

window.keyReorderStage = async function(e, row) {
  if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
  e.preventDefault();
  const stages = [...(globalSettings.pipelineStages || [])];
  const idx = parseInt(row.dataset.idx, 10);
  const newIdx = idx + (e.key === 'ArrowUp' ? -1 : 1);
  if (idx < 0 || newIdx < 0 || newIdx >= stages.length) return;
  [stages[idx], stages[newIdx]] = [stages[newIdx], stages[idx]];
  stages.forEach((s, i) => s.order = i);
  globalSettings.pipelineStages = stages;
  try {
    await saveSettings(globalSettings);
    renderSettings();
    showToast('Stage order updated', 'var(--green)');
  } catch (err) { showToast('Could not reorder stages', 'var(--red)'); }
};

// ── STAGE CRUD ──

let _editingStageIdx = null;

window.showStageForm = function(idx) {
  _editingStageIdx = idx !== undefined ? idx : null;
  const stages = globalSettings.pipelineStages || [];
  const tools = globalSettings.tools || [];
  const stage = _editingStageIdx !== null ? stages[_editingStageIdx] : null;
  const currentColor = stage?.color || TOOL_COLORS[0];

  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.id = 'stageFormOverlay';
  overlay.style.zIndex = '950';
  overlay.onclick = (e) => { if (e.target === overlay) closeStageForm(); };

  overlay.innerHTML = `
    <div class="modal">
      <div class="mhead">
        <span class="mtitle">${stage ? 'Edit Stage' : 'Add Stage'}</span>
        <button class="mclose" onclick="closeStageForm()">✕</button>
      </div>
      <div class="mbody2">
        <div class="fg">
          <label class="fl">Name</label>
          <input id="wf_stageName" class="fi" placeholder="e.g. Rigging" value="${escapeHTML(stage?.name || '')}">
        </div>
        <div class="fg">
          <label class="fl">Color</label>
          <div class="wf-palette">
            ${TOOL_COLORS.map(c => `<div class="wf-palette-item ${c === currentColor ? 'active' : ''}" style="background:${c}" data-color="${c}" onclick="selectPalette(this,'wf_stageColor')"></div>`).join('')}
          </div>
          <input id="wf_stageColor" type="hidden" value="${currentColor}">
        </div>
        <div class="fg">
          <label class="fl">Associated Tool (optional)</label>
          <select id="wf_stageTool" class="fi">
            <option value="">— None —</option>
            ${tools.map(t => `<option value="${t.id}" ${stage?.tool_id === t.id ? 'selected' : ''}>${escapeHTML(t.name)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="mfoot">
        <button class="btn btn-secondary" onclick="closeStageForm()">Cancel</button>
        <button class="btn btn-primary" onclick="saveStageFromForm()">Save</button>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => { overlay.classList.add('open'); const el = document.getElementById('wf_stageName'); if (el) el.focus(); });
};

window.closeStageForm = function() {
  const el = document.getElementById('stageFormOverlay');
  if (el) el.remove();
  _editingStageIdx = null;
};

window.saveStageFromForm = async function() {
  const name = document.getElementById('wf_stageName')?.value.trim();
  const color = document.getElementById('wf_stageColor')?.value;
  const toolId = document.getElementById('wf_stageTool')?.value || null;

  if (!name) { showToast('Stage name is required', 'var(--orange)'); return; }
  if (!color) { showToast('Select a color', 'var(--orange)'); return; }

  const stages = [...(globalSettings.pipelineStages || [])];

  if (_editingStageIdx !== null) {
    stages[_editingStageIdx] = { ...stages[_editingStageIdx], name, color, tool_id: toolId };
  } else {
    stages.push({ name, color, tool_id: toolId, order: stages.length });
  }

  globalSettings.pipelineStages = stages;
  try {
    await saveSettings(globalSettings);
    closeStageForm();
    renderSettings();
    showToast('Stage saved', 'var(--green)');
  } catch (e) { showToast('Could not save stage', 'var(--red)'); }
};

window.deleteStage = async function(idx) {
  const stages = globalSettings.pipelineStages || [];
  if (idx < 0 || idx >= stages.length) return;
  const name = stages[idx].name;
  const confirmed = await showConfirm(
    'Remove Stage',
    `Remove "<b>${escapeHTML(name)}</b>" from the pipeline? This cannot be undone.`
  );
  if (!confirmed) return;
  globalSettings.pipelineStages = stages.filter((_, i) => i !== idx);
  try { await saveSettings(globalSettings); renderSettings(); showToast('"' + name + '" removed', 'var(--green)'); }
  catch (e) { showToast('Could not remove stage', 'var(--red)'); }
};

window.filterToolsList = function() {
  const q = document.getElementById('wfToolsSearch')?.value.toLowerCase() || '';
  let shown = 0;
  document.querySelectorAll('#toolsListContent .wtile[data-search]').forEach(el => {
    const match = !q || (el.dataset.search || '').includes(q);
    el.style.display = match ? '' : 'none';
    if (match) shown++;
  });
  const empty = document.getElementById('wfToolsEmpty');
  if (empty) empty.style.display = shown === 0 && q ? '' : 'none';
};

// ── FORM HELPERS ──

window.browseFilePath = async function(inputId) {
  try {
    const selected = await openDialog({ directory: false, multiple: false });
    if (selected) document.getElementById(inputId).value = selected;
  } catch (err) { showToast('Failed to open dialog', 'var(--red)'); }
};

window.selectPalette = function(el, hiddenId) {
  el.parentElement.querySelectorAll('.wf-palette-item').forEach(e => e.classList.remove('active'));
  el.classList.add('active');
  document.getElementById(hiddenId).value = el.dataset.color;
};

export { loadSettings, openSettings, closeSettings, pickSettingPath };
