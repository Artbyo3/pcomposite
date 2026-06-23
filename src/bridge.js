import { appDataDir, join } from '@tauri-apps/api/path';
import { writeTextFile, exists, mkdir, readDir } from '@tauri-apps/plugin-fs';
import { globalSettings, projects } from './state.js';

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
  // Flat files at _bases/ root: group by prefix before last underscore
  const flat = entries.filter(e => !e.isDirectory);
  const underscoreGroups = {};
  for (const f of flat) {
    const stem = f.name.replace(/\.[^.]+$/, '');
    const idx = stem.lastIndexOf('_');
    const group = idx > 0 ? stem.slice(0, idx) : stem;
    const arr = underscoreGroups[group] || (underscoreGroups[group] = []);
    arr.push({ name: f.name, size: f.size || 0 });
  }
  // Merge flat groups into main groups, prefixing group names to avoid collision
  for (const [g, files] of Object.entries(underscoreGroups)) {
    if (groups[g]) {
      groups[g] = groups[g].concat(files);
    } else {
      groups[g] = files;
    }
  }
  return { path: basesDir, groups };
}

export async function writeBridgeContext(pendingAction) {
  try {
    const p = projects.find(x => x.active);
    if (!p || !globalSettings.root_path) return;

    const projectDir = await join(globalSettings.root_path, p.id + '_' + p.name);

    const { path: basesPath, groups: basesLibrary } = await scanBasesLibrary(globalSettings.root_path);

    const importedBases = (window._importedBases || []).slice();

    const exports = window._currentExports || [];
    const seen = new Set();
    const exportTargets = [];
    for (const ex of exports) {
      if (!seen.has(ex.target)) {
        seen.add(ex.target);
        exportTargets.push({
          target: ex.target,
          version: ex.version || 1,
          is_final: ex.isFinal || false,
        });
      }
    }

    const context = {
      version: 2,
      active_project_path: projectDir,
      active_project_id: p.id,
      active_project_name: p.name,
      bases_path: basesPath,
      bases_library: basesLibrary,
      imported_bases: importedBases,
      export_targets: exportTargets,
      pending_action: pendingAction || null,
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
