import { projects, globalSettings } from './state.js';
import { saveActiveProject } from './projects.js';
import { refreshInfoPanel, showConfirm } from './ui.js';
import { getStageIcon, getPipelineLength, getStageLabel } from './helpers.js';

function renderPipeline() {
  const stages = globalSettings.pipelineStages || [];
  const p = projects.find(x => x.active);
  const stagePos = p ? Math.max(0, Math.min(p.stage - 1, stages.length - 1)) : 0;
  document.getElementById('pipebar').innerHTML = stages.map((s, i) => {
    const done = i < stagePos;
    const active = i === stagePos;
    const toolName = s.tool_id ? (globalSettings.tools || []).find(t => t.id === s.tool_id)?.name : null;
    const tipParts = [];
    if (toolName) tipParts.push('Uses ' + toolName);
    if (done) tipParts.push('Completed');
    else if (active) tipParts.push('Current stage');
    else tipParts.push('Not yet reached');
    const tip = tipParts.join(' · ');
    const nextStage = getStageLabel(stages[i]);
    return `<div class="pstep" role="tab" aria-selected="${active}" tabindex="0" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();setPipe(${i})}if(event.key==='ArrowRight'){const s=this.parentElement;const tabs=[...s.querySelectorAll('[role=tab]')];const idx=tabs.indexOf(this);if(idx<tabs.length-1)tabs[idx+1].focus()}if(event.key==='ArrowLeft'){const s=this.parentElement;const tabs=[...s.querySelectorAll('[role=tab]')];const idx=tabs.indexOf(this);if(idx>0)tabs[idx-1].focus()}">
      <div class="pnode ${done ? 'done' : active ? 'active' : 'inactive'}" onclick="setPipe(${i})" data-tip="${tip}" data-stage-label="${nextStage}">
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
  const p = projects.find(x => x.active);
  const currentStage = p ? p.stage - 1 : 0;

  if (!skipDb && p) {
    const diff = clampedI - currentStage;
    if (diff > 1) {
      const confirmed = await showConfirm(
        'Skip Pipeline Stages',
        `Move forward ${diff} stage${diff !== 1 ? 's' : ''}? This marks intermediate stages as completed.`
      );
      if (!confirmed) return;
    } else if (diff < 0) {
      return;
    }
    p.stage = clampedI + 1;
    await saveActiveProject();
  }
  renderPipeline();
  refreshInfoPanel();
}

export { renderPipeline, setPipe };
