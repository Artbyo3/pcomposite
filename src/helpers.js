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
