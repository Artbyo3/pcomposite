import { appDataDir, join } from '@tauri-apps/api/path';
import { writeTextFile, exists, mkdir } from '@tauri-apps/plugin-fs';
import { globalSettings, projects } from './state.js';

const BRIDGE_FILE = 'bridge_context.json';
const DIR = 'pcomposite';

async function getDataDir() {
  return await join(await appDataDir(), DIR);
}

export async function writeBridgeContext() {
  try {
    const p = projects.find(x => x.active);
    if (!p || !globalSettings.root_path) return;

    const projectDir = await join(globalSettings.root_path, p.id + '_' + p.name);

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
      version: 1,
      active_project_path: projectDir,
      active_project_id: p.id,
      active_project_name: p.name,
      bases_path: globalSettings.bases_path || '',
      imported_bases: importedBases,
      export_targets: exportTargets,
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
