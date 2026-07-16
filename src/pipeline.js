import { projects, globalSettings } from './state.js';
import { saveActiveProject } from './projects.js';
import { refreshInfoPanel } from './ui.js';
import { getStageIcon, getPipelineLength, getStageLabel } from './helpers.js';

function renderPipeline() {
  const stages = globalSettings.pipelineStages || [];
  const p = projects.find(x => x.active);
  const stagePos = p ? Math.max(0, Math.min(p.stage - 1, stages.length - 1)) : 0;
  document.getElementById('pipebar').innerHTML = stages.map((s, i) => {
    const done = i < stagePos;
    const active = i === stagePos;
    return `<div class="pstep">
      <div class="pnode ${done ? 'done' : active ? 'active' : 'inactive'}" onclick="setPipe(${i})">
        <span class="picon">${getStageIcon(s)}</span>
        <span class="plabel">${getStageLabel(s)}</span>
        ${done ? '<div class="pcheck">✓</div>' : ''}
      </div>
      ${i < stages.length - 1 ? '<span class="parr">›</span>' : ''}
    </div>`;
  }).join('');
}

async function setPipe(i, skipDb = false) {
  const len = getPipelineLength();
  const clampedI = Math.max(0, Math.min(i, len - 1));

  if (!skipDb) {
    const p = projects.find(x => x.active);
    if (p) {
      p.stage = clampedI + 1;
      await saveActiveProject();
    }
  }
  renderPipeline();
  refreshInfoPanel();
}

export { renderPipeline, setPipe };
