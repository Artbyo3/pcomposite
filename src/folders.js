import { escapeHTML, formatBytes, getToolFolders } from './helpers.js';
import { ALL_FILES, setCurrentFolder } from './state.js';
import { setVTab } from './ui.js';
import { renderFileList } from './files.js';

// ── FOLDERS ──
function refreshFolders() {
  const folders = getToolFolders();
  ALL_FILES.forEach(file => {
    const folder = folders.find(f => f.key === file.folder);
    if (folder) { folder.files++; folder._bytes += (file.sizeBytes || 0); }
  });
  folders.forEach(f => {
    f.size = f._bytes > 0 ? formatBytes(f._bytes) : '-';
    f.pct  = f.files > 0 ? 100 : 0;
  });
  renderFolders();
}

function renderFolders() {
  const folders = getToolFolders();
  document.getElementById('fgrid').innerHTML = folders.map(f => `
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
