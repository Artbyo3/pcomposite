// ── CSS IMPORTS ──
import './style.css';
import './titlebar.css';
import './sidebar.css';
import './pipeline.css';
import './project-header.css';
import './files.css';
import './gallery.css';
import './panel.css';
import './statusbar.css';
import './components.css';
import './modal.css';
import './settings.css';
import './exports.css';
import './bases.css';

// ── DATA ──
import { invoke } from '@tauri-apps/api/core';
import { initDataStore } from './data.js';

import { projects, globalSettings } from './state.js';

import { loadSettings, openSettings, closeSettings, pickSettingPath } from './settings.js';
import { renderPipeline, setPipe } from './pipeline.js';
import { refreshFolders, renderFolders, drillFolder } from './folders.js';
import { saveSessionNote, renderChecklist, toggleCk, logAction, renderLog } from './checklist.js';
import { loadProjects, renderProjects, selectProject, saveActiveProject } from './projects.js';
import { renderFileList, setFileView as setFileViewFn, goBackFolders,
  createBlendFile, openFile, openImageViewer, closeImageViewer, revealFile, copyPath, deleteFile,
  showCtx, removeCtx } from './files.js';
import { addExport, saveExport, toggleFinalExport, deleteExport, deleteExportGroup,
  _toggleExpCollapse, _toggleExpOlder } from './exports.js';
import { openGallery, closeGallery, setGalleryFilter, setGalleryView, renderGallery, renderGalleryCalendar,
  galCalPrev, galCalNext, galCalToday, galCalGoMonth, galCalSetView, galCalSetRelease,
  triggerDatePicker, openFromGallery } from './gallery.js';
import { openBases, closeBases, renderBases, importBase } from './bases.js';
import { triggerThumb, triggerActiveThumb, updateHeaderThumb } from './thumbnail.js';
import { showToast, openModal, closeModal, closeOvOut, toggleFci, createProject, setVTab, setPTab,
  setSort, toggleFilter, refreshInfoPanel, initDragDrop } from './ui.js';

// ── INIT ──
async function initData() {
  try {
    await initDataStore();
    await loadSettings();
    renderPipeline();
    renderFolders();
    await loadProjects();
    renderProjects();
    updateHeaderThumb();
    initDragDrop();
  } catch (err) {
    console.error('Failed to load data:', err);
  }
}
window.addEventListener('DOMContentLoaded', initData);

// ── REVEAL PROJECT ROOT ──
window.revealProjectRoot = function() {
  const p = projects.find(x => x.active);
  if (!p || !globalSettings.root_path) return;
  invoke('open_in_app', { exePath: 'explorer', filePath: globalSettings.root_path + '\\' + p.id + '_' + p.name });
};
window.copyProjectPath = function() {
  const p = projects.find(x => x.active);
  if (!p || !globalSettings.root_path) return;
  navigator.clipboard.writeText(globalSettings.root_path + '\\' + p.id + '_' + p.name);
  showToast('Project path copied', 'var(--green)');
};

// ── CHANGELOG ──
const CHANGELOG = [
  { ver: 'v0.0.3', date: '', msg: 'Fix: Prevent in-window drop from WebView2 handling' },
  { ver: 'v0.0.2', date: '', msg: 'Quick Export FBX button, imported bases tracking, addon UI tabs' },
  { ver: 'v0.0.1', date: '', msg: 'Initial addon bridge: OLE drag-drop, import/export tabs, bridge context' },
];
window.toggleChangelog = function(e) {
  if (e) e.stopPropagation();
  const card = document.getElementById('changelogCard');
  if (card.classList.contains('open')) { closeChangelog(); return; }
  const body = document.getElementById('changelogBody');
  body.innerHTML = CHANGELOG.map(i =>
    `<div class="changelog-item"><span class="changelog-ver">${i.ver}</span><span class="changelog-date">${i.date || '—'}</span><span class="changelog-msg">${i.msg}</span></div>`
  ).join('');
  card.classList.add('open');
};
window.closeChangelog = function(e) {
  if (e) e.stopPropagation();
  document.getElementById('changelogCard').classList.remove('open');
};
document.addEventListener('click', function(e) {
  if (!e.target.closest('#changelogCard') && !e.target.closest('#versionLabel')) closeChangelog();
});

// ── EVENT LISTENERS ──
document.getElementById('imageViewer').addEventListener('click', closeImageViewer);
document.getElementById('ivClose').addEventListener('click', (e) => { e.stopPropagation(); closeImageViewer(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeImageViewer(); });
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'n') { e.preventDefault(); openModal(); }
});
document.addEventListener('click', removeCtx);
document.addEventListener('keydown', e => { if (e.key === 'Escape') { removeCtx(); closeModal(); } });

// ── WINDOW EXPORTS ──
Object.assign(window, {
  renderPipeline, setPipe, renderFolders, refreshFolders, drillFolder, saveSessionNote,
  renderFileList, setFileView: setFileViewFn, goBackFolders,
  openFile, revealFile, copyPath, deleteFile, showCtx, removeCtx, createBlendFile,
  showToast, logAction, renderLog,
  renderChecklist, toggleCk,
  renderProjects, selectProject, refreshInfoPanel,
  setVTab, setPTab, setSort, toggleFilter,
  openModal, closeModal, closeOvOut, toggleFci, createProject,
  openGallery, closeGallery, setGalleryFilter, setGalleryView, renderGallery, openFromGallery,
  renderGalleryCalendar, galCalPrev, galCalNext, galCalToday, galCalSetView, galCalGoMonth, galCalSetRelease, triggerDatePicker,
  openBases, closeBases, importBase,
  addExport, saveExport, toggleFinalExport, deleteExport, deleteExportGroup,
  _toggleExpCollapse, _toggleExpOlder,
  triggerThumb, triggerActiveThumb, updateHeaderThumb,
  revealProjectRoot: window.revealProjectRoot, copyProjectPath: window.copyProjectPath, saveActiveProject,
  openSettings, closeSettings, pickSettingPath,
  closeImageViewer,
});
