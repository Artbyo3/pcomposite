import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { escapeHTML } from './helpers.js';
import { globalSettings, setGlobalSettings } from './state.js';
import { loadSettings as loadJSONSettings, saveSettings } from './data.js';
import { showToast } from './ui.js';

// ── SETTINGS ──

async function loadSettings() {
  try {
    const data = await loadJSONSettings();
    Object.assign(globalSettings, data);
  } catch (e) { console.error('loadSettings error:', e); }
  Object.keys(globalSettings).forEach(k => { const el = document.getElementById('set_' + k); if (el) el.value = globalSettings[k]; });
}

async function saveSetting(key, value) {
  globalSettings[key] = value;
  const el = document.getElementById('set_' + key);
  if (el) el.value = value;
  try { await saveSettings(globalSettings); }
  catch (e) { showToast('Error saving setting', 'var(--red)'); }
}

async function openSettings() {
  await loadSettings();
  document.getElementById('settingsOverlay').style.display = 'flex';
  setSettingsSection('general');
}
function closeSettings() { document.getElementById('settingsOverlay').style.display = 'none'; }

async function pickSettingPath(key, isDir) {
  try {
    const selected = await openDialog({ directory: isDir, multiple: false, defaultPath: globalSettings[key] || undefined });
    if (selected) { await saveSetting(key, selected); showToast('Path updated', 'var(--green)'); }
  } catch (err) { showToast('Failed to open dialog: ' + err, 'var(--red)'); }
}

function setSettingsSection(section) {
  document.querySelectorAll('.set-nav-item').forEach(el => el.classList.remove('active'));
  const navItem = document.querySelector(`.set-nav-item[data-section="${section}"]`);
  if (navItem) navItem.classList.add('active');
  const content = document.getElementById('setContent');
  content.innerHTML = renderSettingsSection(section);
}

function renderSettingsSection(section) {
  const paths = {
    root_path: { label: 'Root Projects Path', placeholder: 'Not set — click 📁 to browse', isDir: true },
    blender_path: { label: 'Blender Executable', placeholder: 'Not set', isDir: false },
    painter_path: { label: 'Substance Painter Executable', placeholder: 'Not set', isDir: false },
    unity_path: { label: 'Unity Executable', placeholder: 'Not set', isDir: false },
  };
  const makeField = (key, cfg) => `
    <div class="set-field">
      <label class="set-label">${cfg.label}</label>
      <div style="display:flex;gap:6px;">
        <input id="set_${key}" readonly class="set-input" placeholder="${cfg.placeholder}" value="${escapeHTML(globalSettings[key] || '')}" />
        <button onclick="pickSettingPath('${key}',${cfg.isDir})" class="set-browse" title="Browse">📁</button>
      </div>
    </div>`;

  if (section === 'general') {
    return makeField('root_path', paths.root_path);
  }
  if (section === 'integrations') {
    const apps = ['blender', 'painter', 'unity'];
    const appIcons = {
      blender: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 002 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>',
      painter: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>',
      unity: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><polygon points="12 2 22 7 22 17 12 22 2 17 2 7 12 2"/><line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="7" x2="22" y2="7"/><line x1="2" y1="17" x2="22" y2="17"/></svg>',
    };
    const appNames = { blender: 'Blender', painter: 'Substance Painter', unity: 'Unity Editor' };
    return `<div class="set-intro">Configure which apps PCOMPOSITE integrates with</div>
      <div class="app-cards">
        ${apps.map(key => {
          const pathKey = key + '_path';
          const val = globalSettings[pathKey] || '';
          const connected = !!val;
          return `<div class="app-card">
            <div class="app-card-head">
              <span class="app-card-icon">${appIcons[key]}</span>
              <div>
                <div class="app-card-name">${appNames[key]}</div>
                <span class="app-card-status ${connected ? 'on' : ''}">${connected ? 'CONNECTED' : 'NOT SET'}</span>
              </div>
            </div>
            <div class="app-card-body">
              <div style="display:flex;gap:6px;">
                <input id="set_${pathKey}" readonly class="set-input" placeholder="Not set" value="${escapeHTML(val)}" />
                <button onclick="pickSettingPath('${pathKey}',false)" class="set-browse" title="Browse">📁</button>
              </div>
              ${key === 'blender' ? `
                <div class="addon-box">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="20" height="8" rx="2"/><rect x="2" y="14" width="20" height="8" rx="2"/></svg>
                  <div>
                    <div style="font-size:8px;font-weight:700;letter-spacing:1px;font-family:'Space Mono',monospace;color:var(--text2)">Blender Addon</div>
                    <div style="font-size:7px;font-family:'Space Mono',monospace;color:var(--text3);margin-top:2px">Import bases directly into your open Blender session</div>
                  </div>
                  <button disabled style="margin-left:auto;height:24px;padding:0 10px;background:var(--bg3);border:1px solid var(--border);border-radius:3px;color:var(--text3);font-size:7px;font-family:'Space Mono',monospace;cursor:default;opacity:.5">Coming soon</button>
                </div>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>`;
  }
  if (section === 'bases') {
    return `<div class="set-field">
        <label class="set-label">Avatar Bases Path</label>
        <div style="display:flex;gap:6px;">
          <input id="set_bases_path" readonly class="set-input" placeholder="Not set — folder with your base files" value="${escapeHTML(globalSettings.bases_path || '')}" />
          <button onclick="pickSettingPath('bases_path',true)" class="set-browse" title="Browse">📁</button>
        </div>
        ${globalSettings.bases_path ? `<div style="margin-top:6px;font-size:7px;font-family:'Space Mono',monospace;color:var(--text3)">Bases loaded from: <span style="color:var(--accent)">${escapeHTML(globalSettings.bases_path)}</span></div>` : ''}
      </div>`;
  }
  if (section === 'appearance') {
    return '<div style="padding:40px 20px;text-align:center;font-size:8px;font-family:\'Space Mono\',monospace;color:var(--text3);letter-spacing:1px">Appearance settings coming soon</div>';
  }
  return '';
}

export { loadSettings, saveSetting, openSettings, closeSettings, setSettingsSection, pickSettingPath };
