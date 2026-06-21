import { escapeHTML, formatBytes } from './helpers.js';
import { projects, globalSettings } from './state.js';
import { readDir, copyFile, mkdir, exists } from '@tauri-apps/plugin-fs';
import { join } from '@tauri-apps/api/path';
import { saveProject, loadProject } from './data.js';
import { showToast } from './ui.js';
import { logAction } from './checklist.js';
import { selectProject } from './projects.js';

function openBases() {
  document.getElementById('basesOverlay').style.display = 'flex';
  renderBases();
}
function closeBases() { document.getElementById('basesOverlay').style.display = 'none'; }

async function renderBases() {
  const grid = document.getElementById('basesGrid');
  const count = document.getElementById('basesCount');
  const bp = globalSettings.bases_path;
  if (!bp) {
    count.textContent = '';
    grid.innerHTML = `<div style="grid-column:1/-1;padding:60px;text-align:center;font-size:11px;font-family:'Space Mono',monospace;color:var(--text3)">Set your Avatar Bases Path in Settings</div>`;
    return;
  }
  let entries;
  try { entries = await readDir(bp); }
  catch { count.textContent = ''; grid.innerHTML = `<div style="grid-column:1/-1;padding:60px;text-align:center;font-size:11px;font-family:'Space Mono',monospace;color:var(--text3)">Could not read bases path</div>`; return; }
  const files = entries.filter(e => !e.isDirectory);
  count.textContent = files.length + ' file' + (files.length !== 1 ? 's' : '');
  if (!files.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;padding:60px;text-align:center;font-size:11px;font-family:'Space Mono',monospace;color:var(--text3)">No base files found in that folder</div>`;
    return;
  }
  grid.innerHTML = files.map((e, i) => {
    const ext = e.name.includes('.') ? '.' + e.name.split('.').pop().toUpperCase() : '';
    const sizeStr = e.size ? formatBytes(e.size) : '';
    return `<div class="base-card" style="animation-delay:${i * .03}s">
      <div class="base-top">
        <div class="base-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        </div>
        <div class="base-info">
          <div class="base-name">${escapeHTML(e.name)}</div>
          <div class="base-meta">
            ${ext ? `<span class="base-ext">${ext}</span>` : ''}
            ${sizeStr ? `<span class="base-size">${sizeStr}</span>` : ''}
          </div>
        </div>
      </div>
      <button class="base-import" onclick="importBase('${escapeHTML(e.name).replace(/'/g, "\\'")}')">Import →</button>
    </div>`;
  }).join('');
}

async function importBase(fileName) {
  const p = projects.find(x => x.active);
  if (!p) { showToast('No active project', 'var(--red)'); return; }
  if (!globalSettings.root_path) { showToast('No Root Path set', 'var(--red)'); return; }
  if (!globalSettings.bases_path) { showToast('No Avatar Bases Path set', 'var(--red)'); return; }

  const srcPath = await join(globalSettings.bases_path, fileName);
  const projectDir = await join(globalSettings.root_path, p.id + '_' + p.name);
  const targetDir = await join(projectDir, 'blender');
  if (!(await exists(targetDir))) await mkdir(targetDir, { recursive: true });
  const destPath = await join(targetDir, fileName);

  try { await copyFile(srcPath, destPath); }
  catch (e) { showToast('Error: ' + String(e), 'var(--red)'); return; }

  logAction('Copied base ' + fileName + ' to blender/', 'ok');
  showToast(fileName + ' ready in blender/ — drag into Blender or File > Import', 'var(--green)');

  const idx = projects.indexOf(p);
  if (idx !== -1) await selectProject(idx);
  closeBases();
}

export { openBases, closeBases, renderBases, importBase };
