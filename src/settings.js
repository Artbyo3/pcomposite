import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { escapeHTML } from './helpers.js';
import { globalSettings } from './state.js';
import { loadSettings as loadJSONSettings, saveSettings, migrateOldBases, ensureVaultBasesDir } from './data.js';
import { showToast } from './ui.js';

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
  } catch (e) { console.error('loadSettings error:', e); }
  Object.keys(globalSettings).forEach(k => { const el = document.getElementById('set_' + k); if (el) el.value = globalSettings[k]; });
}

async function saveSetting(key, value) {
  globalSettings[key] = value;
  const el = document.getElementById('set_' + key);
  if (el) el.value = value;
  try { await saveSettings(globalSettings); }
  catch (e) { showToast('Error saving setting', 'var(--red)'); }
  if (key === 'root_path' && value) {
    await ensureVaultBasesDir(value);
  }
}

async function openSettings() {
  await loadSettings();
  document.getElementById('settingsOverlay').classList.add('open');
  renderSettings();
}

function renderSettings() {
  const sections = ['general','integrations','appearance'];
  const names = { general:'General', integrations:'App Integrations', appearance:'Appearance' };
  document.getElementById('setContent').innerHTML =
    sections.map(s => `<div class="set-section">
      <div class="set-section-head">${names[s]}</div>
      ${renderSectionContent(s)}
    </div>`).join('');
}

function closeSettings() { document.getElementById('settingsOverlay').classList.remove('open'); }

async function pickSettingPath(key, isDir) {
  try {
    const selected = await openDialog({ directory: isDir, multiple: false, defaultPath: globalSettings[key] || undefined });
    if (selected) { await saveSetting(key, selected); showToast('Path updated', 'var(--green)'); }
  } catch (err) { showToast('Failed to open dialog: ' + err, 'var(--red)'); }
}

function makeField(key, cfg) {
  return `<div class="fg">
    <label class="fl">${cfg.label}</label>
    <div class="set-path-row">
      <input id="set_${key}" readonly class="fi" placeholder="${cfg.placeholder}" value="${escapeHTML(globalSettings[key] || '')}" />
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
    return `<div class="set-group">
      <div class="set-group-title">Vault</div>
      ${makeField('root_path', paths.root_path)}
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
                <input id="set_${pathKey}" readonly class="fi" placeholder="Not set" value="${escapeHTML(val)}" />
                <button onclick="pickSettingPath('${pathKey}',false)" class="set-browse" title="Browse"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg></button>
              </div>
                ${key === 'blender' ? `
                  <div class="addon-box" onmousedown="dragStart(event)" onmousemove="dragMove(event)" onmouseup="dragEnd(event)">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/></svg>
                  <div class="addon-title">Blender Addon</div>
                  <div class="addon-sub">Drag this card into Blender to install</div>
                </div>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }

  if (section === 'appearance') {
    return `<div class="set-group">
      <div class="set-group-title">Theme</div>
      <div class="set-empty">Appearance settings coming soon</div>
    </div>`;
  }

  return '';
}

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
    clone.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/></svg><div class="addon-title">BLENDER ADDON</div><div class="addon-sub">Drop on Blender to install</div>';
    clone.style.left = (e.clientX - 100) + 'px';
    clone.style.top = (e.clientY - 48) + 'px';
    document.body.appendChild(clone);
    dragClone = clone;

    try {
      await invoke('drag_addon');
    } catch (err) {
      showToast('Drag failed: ' + err, 'var(--red)');
    } finally {
      if (dragClone) { dragClone.remove(); dragClone = null; }
    }
  }
};

window.dragEnd = function() {
  if (dragClone) { dragClone.remove(); dragClone = null; }
  dragState = null;
};

export { loadSettings, openSettings, closeSettings, pickSettingPath };
