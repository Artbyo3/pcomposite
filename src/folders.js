import { escapeHTML, formatBytes } from './helpers.js';
import { FOLDERS } from './constants.js';
import { ALL_FILES, setCurrentFolder } from './state.js';
import { setVTab } from './ui.js';
import { renderFileList } from './files.js';

// ── FOLDERS ──
function refreshFolders() {
  FOLDERS.forEach(f => { f.files = 0; f.size = '-'; f.pct = 0; f._bytes = 0; });
  ALL_FILES.forEach(file => {
    const folder = FOLDERS.find(f => f.key === file.folder);
    if (folder) { folder.files++; folder._bytes += (file.sizeBytes || 0); }
  });
  FOLDERS.forEach(f => {
    f.size = f._bytes > 0 ? formatBytes(f._bytes) : '-';
    f.pct  = f.files > 0 ? 100 : 0;
  });
  renderFolders();
}

function renderFolders() {
  // fhgrid is owned by refreshInfoPanel, not here
  document.getElementById('fgrid').innerHTML = FOLDERS.map(f => `
    <div class="ftile ${f.files === 0 ? 'empty' : ''}" onclick="drillFolder('${f.key}')" style="--fc:${f.color}">
      <div class="ft-glow"></div>
      <div class="ft-content">
        <div class="ft-badge">${f.files} ITEM${f.files !== 1 ? 'S' : ''}</div>
        <div class="ft-icon">${f.icon}</div>
        <div class="ft-title">${escapeHTML(f.key)}</div>
      </div>
    </div>
  `).join('');

}

function drillFolder(key) {
  setCurrentFolder(key);
  document.querySelectorAll('.vtab').forEach(t => t.classList.toggle('active', t.textContent === 'All Files'));
  setVTab(null, 'files');
  renderFileList(key);
}

export { refreshFolders, renderFolders, drillFolder };
