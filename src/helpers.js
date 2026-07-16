import { readFile } from '@tauri-apps/plugin-fs';
import { globalSettings } from './state.js';

export function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0, n = Number(bytes);
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return (i === 0 ? n : n.toFixed(1)) + ' ' + units[i];
}

export function isViewableImage(ext) {
  return ['.png','.jpg','.jpeg','.gif','.webp','.svg','.bmp'].includes((ext || '').toLowerCase());
}

const thumbCache = new Map();

export async function loadThumbnail(path, ext) {
  if (thumbCache.has(path)) return thumbCache.get(path);
  try {
    const bytes = await readFile(path);
    const mime = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', webp:'image/webp', svg:'image/svg+xml', bmp:'image/bmp' }[(ext||'').replace('.','').toLowerCase()] || 'image/png';
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    if (ext === '.svg') { thumbCache.set(path, url); return url; }
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const max = 80;
        const scale = Math.min(max / img.width, max / img.height, 1);
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
        URL.revokeObjectURL(url);
        const dataUrl = canvas.toDataURL(mime === 'image/svg+xml' ? 'image/png' : mime, 0.85);
        thumbCache.set(path, dataUrl);
        resolve(dataUrl);
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  } catch (e) { console.warn('loadThumbnail error:', e); return null; }
}

export function pad2(n) { return String(n).padStart(2,'0'); }

export function getDateStr(y,m,d) { return y + '-' + pad2(m+1) + '-' + pad2(d); }

export function isStreamerMode() { return !!globalSettings.streamer_mode; }

export function sanitizePath(path, label) {
  if (!path) return '';
  if (isStreamerMode()) return label || '[redacted]';
  return path;
}

export function sanitizeProjectId(id, fallback) {
  if (!id) return '\u2014';
  if (isStreamerMode()) return fallback || 'Project';
  return id;
}

export function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

// ── TOOL / FOLDER HELPERS (replaces FOLDERS constant) ──

const OFFICIAL_TOOL_ICONS = {
  Blender: '<img src="/blender.svg" style="width:1em;height:1em;vertical-align:-0.15em;">',
  'Substance Painter': '<img src="/substance-3d-painter.svg" style="width:1em;height:1em;vertical-align:-0.15em;">',
  Unity: '<img src="/Unity.svg" style="width:1em;height:1em;vertical-align:-0.15em;">',
  'FBX Exports': '<span style="font-size:1em">📦</span>',
  Pictures: '<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-0.15em;"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>',
  'Promo Art': '<span style="font-size:1em">🖼️</span>',
  Resonite: '<img src="/RSN_Logomark_Color.svg" style="width:1em;height:1em;vertical-align:-0.15em;">',
  Export: '<span style="font-size:1em">🚀</span>',
};

function _firstLetterIcon(name) {
  const letter = (name || '?')[0].toUpperCase();
  return `<span style="display:inline-flex;align-items:center;justify-content:center;width:1em;height:1em;background:var(--bg3);border-radius:3px;font-size:11px;font-weight:700;color:var(--text2);line-height:1;vertical-align:-0.15em">${letter}</span>`;
}

export function getToolIcon(tool) {
  if (!tool) return '<span style="font-size:1em">📁</span>';
  return OFFICIAL_TOOL_ICONS[tool.name] || _firstLetterIcon(tool.name);
}

export function getFolderMeta(folderKey) {
  const tools = globalSettings.tools || [];
  const tool = tools.find(t => t.folder_key === folderKey);
  return { color: tool?.color || 'var(--text3)', icon: getToolIcon(tool) };
}

export function getToolFolders() {
  return (globalSettings.tools || []).map(t => ({
    key: t.folder_key,
    icon: getToolIcon(t),
    color: t.color || 'var(--text3)',
    name: t.name,
    files: 0,
    size: '-',
    pct: 0,
    _bytes: 0,
  }));
}

export function getStageIcon(stage) {
  if (!stage) return '<span style="font-size:1em">📋</span>';
  const tools = globalSettings.tools || [];
  const tool = tools.find(t => t.id === stage.tool_id);
  return tool ? getToolIcon(tool) : '<span style="font-size:1em">📋</span>';
}

export function getStageColor(stage) {
  return stage?.color || 'var(--text3)';
}

const APP_ICON_MAP = {
  Blender: '<img src="/blender.svg" style="width:1em;height:1em;vertical-align:-0.15em;">',
  'Substance Painter': '<img src="/substance-3d-painter.svg" style="width:1em;height:1em;vertical-align:-0.15em;">',
  Painter: '<img src="/substance-3d-painter.svg" style="width:1em;height:1em;vertical-align:-0.15em;">',
  Unity:   '<img src="/Unity.svg" style="width:1em;height:1em;vertical-align:-0.15em;">',
  Viewer: '<span style="font-size:1em">🖼️</span>',
  Explorer: '<span style="font-size:1em">📂</span>',
};

export function getAppIcon(appName) {
  return APP_ICON_MAP[appName] || '<span style="font-size:1em">📄</span>';
}

export function getToolByFolderKey(folderKey) {
  return (globalSettings.tools || []).find(t => t.folder_key === folderKey) || null;
}

export function toolHasCapability(folderKey, cap) {
  const tool = getToolByFolderKey(folderKey);
  return tool ? (tool.capabilities || []).includes(cap) : false;
}

export function getPipelineLength() {
  return (globalSettings.pipelineStages || []).length;
}

export function getStageLabel(stage) {
  return stage?.name || '';
}
