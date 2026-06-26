import { appDataDir, join } from '@tauri-apps/api/path';
import { writeTextFile, readTextFile, exists, mkdir, readDir, rename } from '@tauri-apps/plugin-fs';
import { globalSettings, projects, setBaseIdMap, baseIdMap } from './state.js';

const BRIDGE_FILE = 'bridge_context.json';
const DIR = 'pcomposite';

async function getDataDir() {
  return await join(await appDataDir(), DIR);
}

async function scanBasesLibrary(vaultPath) {
  const basesDir = await join(vaultPath, '_bases');
  if (!(await exists(basesDir))) return { path: basesDir, groups: {} };
  const entries = await readDir(basesDir);
  const groups = {};
  for (const entry of entries) {
    if (entry.isDirectory) {
      const dirPath = await join(basesDir, entry.name);
      const files = await readDir(dirPath);
      groups[entry.name] = files
        .filter(f => !f.isDirectory)
        .map(f => ({ name: f.name, size: f.size || 0 }));
    }
  }
  const flat = entries.filter(e => !e.isDirectory);
  const underscoreGroups = {};
  for (const f of flat) {
    const stem = f.name.replace(/\.[^.]+$/, '');
    const idx = stem.lastIndexOf('_');
    const group = idx > 0 ? stem.slice(0, idx) : stem;
    const arr = underscoreGroups[group] || (underscoreGroups[group] = []);
    arr.push({ name: f.name, size: f.size || 0 });
  }
  for (const [g, files] of Object.entries(underscoreGroups)) {
    if (groups[g]) {
      groups[g] = groups[g].concat(files);
    } else {
      groups[g] = files;
    }
  }
  return { path: basesDir, groups };
}

export async function readBridgeContext() {
  try {
    const dataDir = await getDataDir();
    const filePath = await join(dataDir, BRIDGE_FILE);
    if (!(await exists(filePath))) return null;
    const text = await readTextFile(filePath);
    return JSON.parse(text);
  } catch { return null; }
}

async function getNextVersion(exports, target) {
  const versions = exports.filter(e => e.target === target).map(e => parseInt(e.version, 10) || 0);
  return versions.length ? Math.max(...versions) + 1 : 1;
}

async function consumePendingExport() {
  const ctx = await readBridgeContext();
  if (!ctx?.pending_export) return;
  const pe = ctx.pending_export;

  const exports = window._currentExports || [];
  const nextVer = await getNextVersion(exports, pe.target);
  if (pe.version !== nextVer) return;

  const nameToId = {};
  for (const [id, name] of Object.entries(baseIdMap)) nameToId[name] = id;

  exports.push({
    id: 'exp_' + Date.now().toString(36),
    base_id: nameToId[pe.target] || '',
    target: pe.target,
    version: pe.version,
    date: pe.date,
    note: '',
    isFinal: false,
    fileNames: [pe.file],
  });
  window._currentExports = exports;

  const { saveActiveProject } = await import('./projects.js');
  const { renderFileList } = await import('./files.js');
  await saveActiveProject();
  renderFileList('fbx');

  ctx.pending_export = null;
  const dataDir = await getDataDir();
  await writeTextFile(await join(dataDir, BRIDGE_FILE), JSON.stringify(ctx, null, 2));
}

export async function writeBridgeContext(pendingAction) {
  try {
    await consumePendingExport();

    const p = projects.find(x => x.active);
    if (!p || !globalSettings.root_path) return;

    const projectDir = await join(globalSettings.root_path, p.id + '_' + p.name);
    const { path: basesPath, groups: basesLibrary } = await scanBasesLibrary(globalSettings.root_path);
    const importedBases = (window._importedBases || []).slice();
    const exports = window._currentExports || [];

    // ── Detect base folder renames and sync exports ──
    const { scanBaseIds } = await import('./data.js');
    const idMap = await scanBaseIds(globalSettings.root_path);
    setBaseIdMap(idMap);
    let exportsChanged = false;
    const nameToId = {};
    for (const [id, name] of Object.entries(idMap)) nameToId[name] = id;

    for (const ex of exports) {
      // Assign base_id if missing
      if (!ex.base_id) {
        if (nameToId[ex.target]) {
          ex.base_id = nameToId[ex.target];
        } else {
          // Target folder no longer exists — try reverse lookup
          for (const [id, name] of Object.entries(idMap)) {
            if (name === ex.target) { ex.base_id = id; break; }
          }
        }
      }
      // Detect rename: target doesn't match current folder name but ID exists
      if (ex.base_id && idMap[ex.base_id] && idMap[ex.base_id] !== ex.target) {
        const oldTarget = ex.target;
        const newTarget = idMap[ex.base_id];
        // Rename fbx subfolder if it exists
        const oldFbxDir = await join(projectDir, 'fbx', oldTarget);
        const newFbxDir = await join(projectDir, 'fbx', newTarget);
        if (await exists(oldFbxDir) && !(await exists(newFbxDir))) {
          try { await rename(oldFbxDir, newFbxDir); } catch (e) { console.warn('rename fbx folder failed:', e); }
        }
        ex.target = newTarget;
        exportsChanged = true;
      }
    }
    if (exportsChanged) {
      window._currentExports = exports;
      const { saveActiveProject } = await import('./projects.js');
      await saveActiveProject();
    }

    const targetMap = {};
    for (const ex of exports) {
      const ver = parseInt(ex.version, 10) || 0;
      const existing = targetMap[ex.target];
      if (!existing || ver > existing.version) {
        targetMap[ex.target] = {
          target: ex.target,
          version: ver,
          is_final: ex.isFinal || false,
        };
      }
    }

    for (const groupName of Object.keys(basesLibrary)) {
      if (!targetMap[groupName]) {
        targetMap[groupName] = {
          target: groupName,
          version: 0,
          is_final: false,
        };
      }
    }

    const exportTargets = Object.values(targetMap).map(t => ({
      target: t.target,
      latest_version: t.version,
      next_version: t.version + 1,
      is_final: t.is_final,
    }));

    const context = {
      version: 2,
      active_project_path: projectDir,
      active_project_id: p.id,
      active_project_name: p.name,
      bases_path: basesPath,
      bases_library: basesLibrary,
      imported_bases: importedBases,
      export_targets: exportTargets,
      export_naming_pattern: globalSettings.export_naming || '{target}_v{version}',
      pending_action: pendingAction || null,
      pending_export: null,
    };

    const dataDir = await getDataDir();
    if (!(await exists(dataDir))) {
      await mkdir(dataDir, { recursive: true });
    }
    await writeTextFile(await join(dataDir, BRIDGE_FILE), JSON.stringify(context, null, 2));
  } catch (err) {
    console.error('writeBridgeContext error:', err);
  }
}
