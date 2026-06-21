import { PIPELINE } from './constants.js';
import { projects, globalSettings } from './state.js';
import { saveProject } from './data.js';
import { saveActiveProject } from './projects.js';
import { refreshInfoPanel } from './ui.js';

// ── PIPELINE ──
function renderPipeline() {
  document.getElementById('pipebar').innerHTML = PIPELINE.map((s, i) => `
    <div class="pstep">
      <div class="pnode ${s.done ? 'done' : s.active ? 'active' : 'inactive'}" onclick="setPipe(${i})">
        <span class="picon">${s.icon}</span>
        <span class="plabel">${s.label}</span>
        ${s.done ? '<div class="pcheck">✓</div>' : ''}
      </div>
      ${i < PIPELINE.length - 1 ? '<span class="parr">›</span>' : ''}
    </div>
  `).join('');
}

async function setPipe(i, skipDb = false) {
  const clampedI = Math.max(0, Math.min(i, PIPELINE.length - 1));
  PIPELINE.forEach((s, j) => { s.done = j < clampedI; s.active = j === clampedI; });
  renderPipeline();

  if (!skipDb) {
    const p = projects.find(x => x.active);
    if (p) {
      p.stage = clampedI + 1;
      await saveActiveProject();
    }
  }
  refreshInfoPanel();
}

export { renderPipeline, setPipe };
