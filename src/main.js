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
import './modal.css';
import './settings.css';
import './exports.css';
import './bases.css';

// ── DATA ──
import { invoke } from '@tauri-apps/api/core';
import { initDataStore } from './data.js';

import { projects, globalSettings } from './state.js';

import { loadSettings, openSettings, closeSettings, setSettingsSection, pickSettingPath } from './settings.js';
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
  openSettings, closeSettings, setSettingsSection, pickSettingPath,
  closeImageViewer,
});
