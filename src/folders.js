import { escapeHTML, formatBytes, getToolFolders } from './helpers.js';
import { ALL_FILES, setCurrentFolder } from './state.js';
import { setVTab } from './ui.js';
import { renderFileList } from './files.js';

// ── FOLDERS ──
function _countFolders(folders) {
  ALL_FILES.forEach(file => {
    const folder = folders.find(f => f.key === file.folder);
    if (folder) { folder.files++; folder._bytes += (file.sizeBytes || 0); }
  });
  folders.forEach(f => {
    f.size = f._bytes > 0 ? formatBytes(f._bytes) : '-';
    f.pct  = f.files > 0 ? 100 : 0;
  });
  return folders;
}

function refreshFolders() {
  renderFolders();
}

function renderFolders() {
  const folders = _countFolders(getToolFolders());
  document.getElementById('fgrid').innerHTML = folders.map(f => {
    const tip = f.files > 0
      ? `${f.files} file${f.files !== 1 ? 's' : ''} — ${f.size || 'empty'}`
      : `${f.key}/ is empty — drop files here`;
    const isLetter = f.icon.startsWith('<span style=');
    const iconHtml = isLetter
      ? `<div class="ft-letter">${(f.name || '?')[0].toUpperCase()}</div>`
      : `<div class="ft-icon">${f.icon}</div>`;
    return `
    <div class="ftile ${f.files === 0 ? 'empty' : ''}" onclick="drillFolder('${escapeHTML(f.key).replace(/'/g,"\\'")}')" style="--fc:${f.color}" data-tip="${tip}">
      <div class="ft-glow"></div>
      <div class="ft-content">
        <div class="ft-badge">${f.files} ITEM${f.files !== 1 ? 'S' : ''}</div>
        ${iconHtml}
        <div class="ft-title">${escapeHTML(f.key)}</div>
      </div>
    </div>`;
  }).join('');
}

function drillFolder(key) {
  setCurrentFolder(key);
  document.querySelectorAll('.vtab').forEach(t => t.classList.toggle('active', t.textContent === 'All Files'));
  setVTab(null, 'files');
  renderFileList(key);
}

export { refreshFolders, renderFolders, drillFolder };
