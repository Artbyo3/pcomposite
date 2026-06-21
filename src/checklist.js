import { escapeHTML } from './helpers.js';
import { CHECKLIST, PIPELINE } from './constants.js';
import { sessionNote, setSessionNote, projectLog, projects, globalSettings } from './state.js';
import { saveActiveProject } from './projects.js';
import { setPipe } from './pipeline.js';
import { refreshInfoPanel } from './ui.js';

let _noteSaveTimer = null;
function saveSessionNote(value) {
  setSessionNote(value);
  clearTimeout(_noteSaveTimer);
  _noteSaveTimer = setTimeout(async () => {
    const p = projects.find(x => x.active);
    if (!p || !globalSettings.root_path) return;
    try { await saveActiveProject(); }
    catch (e) { console.error('note save error:', e); }
  }, 600);
}

function renderChecklist() {
  const done   = CHECKLIST.filter(c => c.done).length;
  const allDone = done === CHECKLIST.length;
  document.getElementById('checkContent').innerHTML = `
    <div style="font-size:9px;font-family:'Space Mono',monospace;color:var(--text3);letter-spacing:2px;text-transform:uppercase;margin-bottom:14px">WHERE YOU LEFT OFF</div>
    ${CHECKLIST.map((c, i) => `
      <div onclick="toggleCk(${i})" style="display:flex;align-items:center;gap:12px;padding:11px 13px;border-radius:6px;cursor:pointer;border:1px solid ${c.done ? 'var(--border)' : 'var(--border2)'};background:${c.done ? 'var(--bg3)' : 'var(--bg4)'};margin-bottom:6px;transition:all .12s;${!c.done && i === done ? 'border-color:' + c.color + ';box-shadow:0 0 0 1px ' + c.color + '22' : ''}">
        <div style="width:20px;height:20px;border-radius:50%;flex-shrink:0;border:2px solid ${c.done ? 'var(--green)' : (i === done ? c.color : 'var(--border2)')};background:${c.done ? 'var(--green)' : 'transparent'};display:flex;align-items:center;justify-content:center;font-size:9px;color:#000;transition:all .15s;">${c.done ? '✓' : ''}</div>
        <span style="font-size:13px;line-height:1">${c.icon}</span>
        <span style="font-size:12px;font-weight:700;flex:1;color:${c.done ? 'var(--text3)' : (i === done ? 'var(--text)' : 'var(--text2)')};text-decoration:${c.done ? 'line-through' : 'none'};">${escapeHTML(c.l)}</span>
        ${!c.done && i === done ? `<span style="font-size:8px;font-family:'Space Mono',monospace;color:${c.color};letter-spacing:1px">NOW</span>` : ''}
      </div>
    `).join('')}
    ${allDone ? `<div style="text-align:center;padding:16px;font-size:11px;font-weight:700;color:var(--green);font-family:'Space Mono',monospace;letter-spacing:2px;margin-top:4px">✓ ALL DONE</div>` : ''}
    <div style="margin-top:18px;border-top:1px solid var(--border);padding-top:14px">
      <div style="font-size:8px;font-family:'Space Mono',monospace;color:var(--text3);letter-spacing:2px;text-transform:uppercase;margin-bottom:7px">QUICK NOTE — optional</div>
      <textarea id="sessionNote" placeholder="e.g. left off at weight painting the hood..." oninput="saveSessionNote(this.value)" style="width:100%;min-height:64px;background:var(--bg3);border:1px solid var(--border);border-radius:5px;padding:9px 11px;color:var(--text2);font-family:'Space Mono',monospace;font-size:10px;outline:none;resize:none;line-height:1.6;transition:border-color .15s;">${escapeHTML(sessionNote)}</textarea>
    </div>
  `;
  const ta = document.getElementById('sessionNote');
  if (ta) {
    ta.addEventListener('focus', () => ta.style.borderColor = 'var(--accent)');
    ta.addEventListener('blur',  () => ta.style.borderColor = 'var(--border)');
  }
}

async function toggleCk(i) {
  CHECKLIST[i].done = !CHECKLIST[i].done;
  await saveActiveProject();
  const doneCount = CHECKLIST.filter(c => c.done).length;
  setPipe(Math.min(doneCount, PIPELINE.length - 1));
  renderChecklist();
  refreshInfoPanel();
  logAction(`${CHECKLIST[i].l} marked ${CHECKLIST[i].done ? 'done' : 'undone'}`, CHECKLIST[i].done ? 'ok' : 'info');
}

function logAction(msg, type = 'info') {
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  projectLog.unshift({ msg, type, time: timeStr });
  if (projectLog.length > 50) projectLog.length = 50;
  if (document.getElementById('pLog').style.display !== 'none') renderLog();
}

function renderLog() {
  const el = document.getElementById('pLog');
  if (!projectLog.length) {
    el.innerHTML = `<div style="padding:20px;text-align:center;font-size:9px;font-family:'Space Mono',monospace;color:var(--text3)">No activity yet for this project</div>`;
    return;
  }
  el.innerHTML = projectLog.map(entry => `
    <div class="litem">
      <div class="ldot ${entry.type}"></div>
      <div>
        <div class="lmsg">${escapeHTML(entry.msg)}</div>
        <div class="ltime">${entry.time}</div>
      </div>
    </div>
  `).join('');
}

export { saveSessionNote, renderChecklist, toggleCk, logAction, renderLog };
