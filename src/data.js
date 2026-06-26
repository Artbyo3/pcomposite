import { appDataDir, join } from '@tauri-apps/api/path';
import { readTextFile, writeTextFile, exists, mkdir, readDir, stat, copyFile } from '@tauri-apps/plugin-fs';

const DIR = 'pcomposite';
let _base = null;

async function base() {
  if (!_base) _base = await join(await appDataDir(), DIR);
  return _base;
}

export async function initDataStore() {
  const d = await base();
  if (!(await exists(d))) await mkdir(d, { recursive: true });
}

async function loadJSON(name) {
  const p = await join(await base(), name);
  if (!(await exists(p))) return null;
  return JSON.parse(await readTextFile(p));
}

async function saveJSON(name, data) {
  await writeTextFile(await join(await base(), name), JSON.stringify(data, null, 2));
}

// ── Settings (app data dir) ──

export async function loadSettings() {
  return (await loadJSON('settings.json')) || {};
}

export async function saveSettings(s) {
  await saveJSON('settings.json', s);
}

// ── Projects (vault directory) ──

function projectDir(vaultPath, id, name) {
  return join(vaultPath, id + '_' + name);
}

function projectFilePath(vaultPath, id, name) {
  return join(vaultPath, id + '_' + name, 'project.json');
}

export async function scanVault(vaultPath) {
  const results = [];
  if (!vaultPath || !(await exists(vaultPath))) return results;
  const entries = await readDir(vaultPath);
  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    const pjPath = await join(vaultPath, entry.name, 'project.json');
    if (!(await exists(pjPath))) continue;
    try {
      const data = JSON.parse(await readTextFile(pjPath));
      results.push({
        id: data.id || '',
        name: data.name || entry.name,
        date: data.date || '',
        stage: data.stage || 1,
        thumb: data.thumb || null,
        release_date: data.release_date || null,
      });
    } catch (e) { console.warn('scanVault: failed to parse project.json in', entry.name, e); }
  }
  return results;
}

export async function loadProject(vaultPath, id, name) {
  const p = await projectFilePath(vaultPath, id, name);
  if (!(await exists(p))) return null;
  return JSON.parse(await readTextFile(p));
}

export async function saveProject(vaultPath, project) {
  const dir = await projectDir(vaultPath, project.id, project.name);
  if (!(await exists(dir))) await mkdir(dir, { recursive: true });
  const p = await projectFilePath(vaultPath, project.id, project.name);
  await writeTextFile(p, JSON.stringify(project, null, 2));
}

export async function ensureVaultBasesDir(vaultPath) {
  if (!vaultPath) return null;
  const d = await join(vaultPath, '_bases');
  if (!(await exists(d))) await mkdir(d, { recursive: true });
  return d;
}

export async function migrateOldBases(vaultPath, oldBasesPath) {
  if (!oldBasesPath || !vaultPath) return;
  if (!(await exists(oldBasesPath))) return;
  const baseDir = await ensureVaultBasesDir(vaultPath);
  const entries = await readDir(oldBasesPath);
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const src = await join(oldBasesPath, entry.name);
    const dest = await join(baseDir, entry.name);
    if (!(await exists(dest))) {
      try {
        await copyFile(src, dest);
      } catch (e) { console.warn('migrateBases: could not copy', entry.name, e); }
    }
  }
}

const FOLDER_APP = { blender:'Blender', subs:'Painter', unity:'Unity', fbx:'Explorer', pictures:'Viewer', 'promo art':'Viewer', resonite:'Explorer', export:'Explorer' };

export async function syncProjectFiles(vaultPath, id, name) {
  const dir = await projectDir(vaultPath, id, name);
  if (!(await exists(dir))) return [];
  const entries = await readDir(dir);
  const results = [];
  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    const folder = entry.name;
    const folderPath = await join(dir, folder);
    try {
      if (folder === 'fbx') {
        const subdirs = await readDir(folderPath);
        for (const sub of subdirs) {
          if (!sub.isDirectory) {
            const filePath = await join(folderPath, sub.name);
            const ext = '.' + (sub.name.split('.').pop() || '').toUpperCase();
            const info = await stat(filePath);
            results.push({
              name: sub.name,
              folder,
              ext,
              size_bytes: info.size,
              app: FOLDER_APP[folder] || 'Explorer',
              created_at: info.mtime ? new Date(info.mtime).toLocaleDateString() : new Date().toLocaleDateString(),
            });
            continue;
          }
          const subFolderPath = await join(folderPath, sub.name);
          try {
            const files = await readDir(subFolderPath);
            for (const file of files) {
              if (file.isDirectory) continue;
              const filePath = await join(subFolderPath, file.name);
              const ext = '.' + (file.name.split('.').pop() || '').toUpperCase();
              const info = await stat(filePath);
              results.push({
                name: file.name,
                folder,
                subfolder: sub.name,
                ext,
                size_bytes: info.size,
                app: FOLDER_APP[folder] || 'Explorer',
                created_at: info.mtime ? new Date(info.mtime).toLocaleDateString() : new Date().toLocaleDateString(),
              });
            }
          } catch (e) { console.error('sync subfolder error:', e); }
        }
      } else {
        const files = await readDir(folderPath);
        for (const file of files) {
          if (file.isDirectory) continue;
          const filePath = await join(folderPath, file.name);
          const ext = '.' + (file.name.split('.').pop() || '').toUpperCase();
          const info = await stat(filePath);
          results.push({
            name: file.name,
            folder,
            ext,
            size_bytes: info.size,
            app: FOLDER_APP[folder] || 'Explorer',
            created_at: info.mtime ? new Date(info.mtime).toLocaleDateString() : new Date().toLocaleDateString(),
          });
        }
      }
    } catch (e) { console.error('syncProjectFiles error:', e); }
  }
  return results;
}

export async function scanBaseIds(vaultPath) {
  const basesDir = await join(vaultPath, '_bases');
  if (!(await exists(basesDir))) return {};
  const entries = await readDir(basesDir);
  const map = {};
  for (const entry of entries) {
    if (!entry.isDirectory) continue;
    const folderPath = await join(basesDir, entry.name);
    const idPath = await join(folderPath, '.pcom_id');
    let id;
    if (await exists(idPath)) {
      id = (await readTextFile(idPath)).trim();
    } else {
      const { generateId } = await import('./helpers.js');
      id = generateId();
      await writeTextFile(idPath, id);
    }
    map[id] = entry.name;
  }
  return map;
}
