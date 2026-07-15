import { projects, ALL_FILES, sessionNote, globalSettings, galCalView, setGalCalView, galCalYear, setGalCalYear, galCalMonth, setGalCalMonth, galCalDay, setGalCalDay, _galCalDateTarget, setGalCalDateTarget, galleryFilter, setGalleryFilter as setGalleryFilterState, galleryView, setGalleryView as setGalleryViewState } from './state.js';
import { escapeHTML, getDateStr, sanitizeProjectId, getToolFolders, getPipelineLength, getStageLabel, getStageColor } from './helpers.js';
import { MONTH_NAMES, DAY_NAMES_SHORT } from './constants.js';
import { saveProject } from './data.js';
import { showToast } from './ui.js';
import { selectProject } from './projects.js';

// Hidden date picker for setting release dates from calendar
const _calDateInput = document.createElement('input');
_calDateInput.type = 'date';
_calDateInput.style.display = 'none';
_calDateInput.addEventListener('change', function() {
  if (_galCalDateTarget >= 0 && this.value) {
    galCalSetReleaseFor(_galCalDateTarget, this.value);
  }
  this.value = '';
  setGalCalDateTarget(-1);
});
document.body.appendChild(_calDateInput);

function openGallery() { document.getElementById('galleryOverlay').classList.add('open'); renderGallery(); }
function closeGallery() { document.getElementById('galleryOverlay').classList.remove('open'); }

function setGalleryFilter(el, val) {
  setGalleryFilterState(val);
  document.querySelectorAll('#galleryFilters .chip').forEach(c => c.classList.remove('on'));
  el.classList.add('on');
  renderGallery();
}

function setGalleryView(view) {
  setGalleryViewState(view);
  document.querySelectorAll('#galleryViewToggle .chip').forEach(c => c.classList.remove('on'));
  document.querySelector(`#galleryViewToggle .chip[data-view="${view}"]`).classList.add('on');
  renderGallery();
}

function getFilteredProjects() {
  const q = (document.getElementById('gallerySearch').value || '').toLowerCase();
  return projects.filter(p => {
    const matchQ = p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q);
    const pipeLen = getPipelineLength();
    const matchF = galleryFilter === 'all' || (galleryFilter === 'done' && p.stage >= pipeLen) || (galleryFilter === 'wip' && p.stage < pipeLen);
    return matchQ && matchF;
  });
}

function buildDateLookup(filtered) {
  const byDate = {}, filteredSet = new Set(filtered);
  for (let i = 0; i < projects.length; i++) {
    if (!filteredSet.has(projects[i])) continue;
    const rd = projects[i].release_date;
    if (rd) { (byDate[rd] || (byDate[rd] = [])).push(i); }
  }
  return byDate;
}

function calItemHtml(pi) {
  const pp = projects[pi];
  return `<div class="cal-item gal-cal-item" onclick="event.stopPropagation();openFromGallery(${pi})" title="${escapeHTML(pp.name)}">
    ${pp.thumb ? `<img src="${pp.thumb}" class="cal-item-thumb">` : `<div class="cal-item-no-thumb">📄</div>`}
    <span>${escapeHTML(pp.name)}</span>
  </div>`;
}

function unscheduledItemHtml(pi) {
  const pp = projects[pi];
  const stages = globalSettings.pipelineStages || [];
  const s = stages[Math.min(pp.stage - 1, stages.length - 1)] || {};
  const stageLabel = getStageLabel(s);
  const stageColor = getStageColor(s);
  return `<div class="us-card" title="${escapeHTML(pp.name)}">
    <div class="us-thumb" onclick="openFromGallery(${pi})">
      ${pp.thumb ? `<img src="${pp.thumb}">` : `<div class="us-thumb-ph">📄</div>`}
    </div>
    <div class="us-body">
      <div class="us-name" onclick="openFromGallery(${pi})">${escapeHTML(pp.name)}</div>
      <div class="us-meta">
        <span class="us-stage" style="background:${stageColor}18;color:${stageColor}">${stageLabel}</span>
        <span class="us-date">created ${pp.date}</span>
      </div>
    </div>
    <button class="us-set-btn" onclick="event.stopPropagation();triggerDatePicker(${pi})" title="Set release date">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      Set date
    </button>
  </div>`;
}

function renderGallery() {
  if (galleryView === 'calendar') { renderGalleryCalendar(); return; }
  const stages = globalSettings.pipelineStages || [];

  const filtered = getFilteredProjects();

  const grid = document.getElementById('galleryGrid');
  grid.style.display = 'grid';
  if (!filtered.length) { grid.innerHTML = `<div style="grid-column:1/-1;padding:60px;text-align:center;font-size:11px;font-family:'Space Mono',monospace;color:var(--text3)">No projects found</div>`; return; }

  grid.innerHTML = filtered.map((p, i) => {
    const pipeLen = stages.length;
    const pct     = pipeLen > 1 ? Math.round(((p.stage - 1) / (pipeLen - 1)) * 100) : 0;
    const s       = stages[Math.min(p.stage - 1, stages.length - 1)] || {};
    const stageColor = getStageColor(s);
    const stageLabel = getStageLabel(s);
    const idx = projects.indexOf(p);
    return `
      <div class="gcard ${p.active ? 'active-proj' : ''}" style="animation-delay:${i * .03}s" onclick="openFromGallery(${idx})">
        <div class="gthumb">
          ${p.thumb ? `<img src="${p.thumb}">` : `<div class="gthumb-placeholder"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg><span style="font-size:8px;font-family:'Space Mono',monospace;letter-spacing:1px">NO IMAGE</span></div>`}
          <div class="gthumb-upload" onclick="event.stopPropagation();triggerThumb(${idx})">📷 SET IMAGE</div>
        </div>
        <div class="gstage-bar"><div class="gstage-fill" style="width:${pct}%;background:${stageColor}"></div></div>
        <div class="ginfo">
          <div class="g-id">${sanitizeProjectId(p.id)}</div>
          <div class="g-name">${escapeHTML(p.name)}</div>
          <div class="g-stage-label" style="background:${stageColor}18;color:${stageColor}">
            <span style="width:5px;height:5px;border-radius:50%;background:${stageColor};display:inline-block"></span> ${stageLabel}
          </div>
          <div class="g-meta">
            <span class="g-date">${p.date}</span>
            <div class="g-dots">${getToolFolders().map((f, fi) => `<div class="fmd ${fi < p.stage ? 'has' : ''}" style="background:${f.color};width:5px;height:5px;border-radius:1px"></div>`).join('')}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function renderGalleryCalendar() {
  const grid = document.getElementById('galleryGrid');
  grid.style.display = 'block';
  if (galCalView === 'year')  renderCalYear(grid);
  else if (galCalView === 'week') renderCalWeek(grid);
  else renderCalMonth(grid);
}

function renderCalYear(grid) {
  const now = new Date();
  const todayStr = getDateStr(now.getFullYear(), now.getMonth(), now.getDate());
  const filtered = getFilteredProjects();
  const byDate = buildDateLookup(filtered);

  let monthsHtml = '';
  for (let m = 0; m < 12; m++) {
    const firstDay = new Date(galCalYear, m, 1);
    const lastDay = new Date(galCalYear, m + 1, 0);
    const startPad = firstDay.getDay();
    const totalDays = lastDay.getDate();

    let cells = '';
    for (let w = 0; w < 6; w++) {
      for (let d = 0; d < 7; d++) {
        const dayNum = w * 7 + d - startPad + 1;
        if (dayNum < 1 || dayNum > totalDays) { cells += '<div class="yr-day"></div>'; continue; }
        const dateStr = getDateStr(galCalYear, m, dayNum);
        const isToday = dateStr === todayStr;
        const count = (byDate[dateStr] || []).length;
        cells += `<div class="yr-day ${isToday ? 'yr-today' : ''}" onclick="galCalGoMonth(${m})">
          <span class="yr-dnum">${dayNum}</span>
          ${count ? `<span class="yr-dot" style="background:var(--accent)"></span>` : ''}
        </div>`;
      }
    }

    monthsHtml += `<div class="yr-month" onclick="galCalGoMonth(${m})">
      <div class="yr-mtitle">${MONTH_NAMES[m].slice(0,3)}</div>
      <div class="yr-grid">${cells}</div>
    </div>`;
  }

  grid.innerHTML = `
    <div class="cal-wrap">
      <div class="cal-head">
        <button onclick="galCalPrev()">◀</button>
        <div class="cal-title">${galCalYear}</div>
        <button onclick="galCalNext()">▶</button>
        <button class="cal-today" onclick="galCalToday()">Today</button>
        <div class="cal-view-toggle">
          <button class="${galCalView==='year'?'on':''}" onclick="galCalSetView('year')">Year</button>
          <button class="${galCalView==='month'?'on':''}" onclick="galCalSetView('month')">Month</button>
          <button class="${galCalView==='week'?'on':''}" onclick="galCalSetView('week')">Week</button>
        </div>
      </div>
      <div class="yr-wrap">${monthsHtml}</div>
    </div>
  `;
}

function renderCalMonth(grid) {
  const now = new Date();
  const todayStr = getDateStr(now.getFullYear(), now.getMonth(), now.getDate());
  const firstDay = new Date(galCalYear, galCalMonth, 1);
  const lastDay = new Date(galCalYear, galCalMonth + 1, 0);
  const startPad = firstDay.getDay();
  const totalDays = lastDay.getDate();

  const filtered = getFilteredProjects();
  const byDate = buildDateLookup(filtered);

  let cells = '';
  for (let w = 0; w < 6; w++) {
    for (let d = 0; d < 7; d++) {
      const dayNum = w * 7 + d - startPad + 1;
      if (dayNum < 1 || dayNum > totalDays) { cells += '<div class="cal-day cal-day-sm other-month"></div>'; continue; }
      const dateStr = getDateStr(galCalYear, galCalMonth, dayNum);
      const isToday = dateStr === todayStr;
      const dayProjects = byDate[dateStr] || [];

      let items = '';
      for (const pi of dayProjects) items += calItemHtml(pi);

      cells += `<div class="cal-day cal-day-sm ${isToday ? 'today' : ''}">
        <div class="cal-dnum" onclick="galCalSetRelease('${dateStr}')" title="Set release date for active project">${dayNum}</div>
        ${items}
      </div>`;
    }
  }

  let unscheduledHtml = renderUnscheduled(filtered);

  grid.innerHTML = `
    <div class="cal-wrap">
      <div class="cal-head">
        <button onclick="galCalPrev()">◀</button>
        <div class="cal-title">${MONTH_NAMES[galCalMonth]} ${galCalYear}</div>
        <button onclick="galCalNext()">▶</button>
        <button class="cal-today" onclick="galCalToday()">Today</button>
        <div class="cal-view-toggle">
          <button class="${galCalView==='year'?'on':''}" onclick="galCalSetView('year')">Year</button>
          <button class="${galCalView==='month'?'on':''}" onclick="galCalSetView('month')">Month</button>
          <button class="${galCalView==='week'?'on':''}" onclick="galCalSetView('week')">Week</button>
        </div>
      </div>
      <div class="cal-grid cal-grid-sm">
        ${DAY_NAMES_SHORT.map(n => `<div class="cal-dow">${n}</div>`).join('')}
        ${cells}
      </div>
      ${unscheduledHtml}
    </div>
  `;
}

function renderCalWeek(grid) {
  const now = new Date();
  const todayStr = getDateStr(now.getFullYear(), now.getMonth(), now.getDate());

  const weekStart = new Date(galCalYear, galCalMonth, galCalDay);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay());
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);

  const filtered = getFilteredProjects();
  const byDate = buildDateLookup(filtered);

  let colWidth = Math.round(100 / 7 * 10) / 10;
  let cols = '';
  for (let d = 0; d < 7; d++) {
    const date = new Date(weekStart);
    date.setDate(weekStart.getDate() + d);
    const dateStr = getDateStr(date.getFullYear(), date.getMonth(), date.getDate());
    const isToday = dateStr === todayStr;
    const dayProjects = byDate[dateStr] || [];

    let items = '';
    for (const pi of dayProjects) items += calItemHtml(pi);

    cols += `<div class="wk-col ${isToday ? 'wk-today' : ''}" style="width:${colWidth}%">
      <div class="wk-col-head" onclick="galCalSetRelease('${dateStr}')" title="Set release date for active project">
        <div class="wk-dname">${DAY_NAMES_SHORT[d]}</div>
        <div class="wk-dnum ${isToday ? 'wk-dnum-today' : ''}">${date.getDate()}</div>
      </div>
      <div class="wk-items">${items}</div>
    </div>`;
  }

  const titleStr = MONTH_NAMES[weekStart.getMonth()] + ' ' + weekStart.getDate() + ' — ' + MONTH_NAMES[weekEnd.getMonth()] + ' ' + weekEnd.getDate() + ', ' + weekEnd.getFullYear();

  grid.innerHTML = `
    <div class="cal-wrap">
      <div class="cal-head">
        <button onclick="galCalPrev()">◀</button>
        <div class="cal-title">${titleStr}</div>
        <button onclick="galCalNext()">▶</button>
        <button class="cal-today" onclick="galCalToday()">Today</button>
        <div class="cal-view-toggle">
          <button class="${galCalView==='year'?'on':''}" onclick="galCalSetView('year')">Year</button>
          <button class="${galCalView==='month'?'on':''}" onclick="galCalSetView('month')">Month</button>
          <button class="${galCalView==='week'?'on':''}" onclick="galCalSetView('week')">Week</button>
        </div>
      </div>
      <div class="wk-wrap">${cols}</div>
      ${renderUnscheduled(filtered)}
    </div>
  `;
}

function renderUnscheduled(filtered) {
  const list = filtered.filter(p => !p.release_date);
  if (!list.length) return '';
  let html = `<div class="us-section">
    <div class="us-head">
      <span class="us-head-label">UNSCHEDULED</span>
      <span class="us-head-count">${list.length} project${list.length !== 1 ? 's' : ''} without a release date</span>
    </div>
    <div class="us-grid">`;
  for (const up of list) html += unscheduledItemHtml(projects.indexOf(up));
  html += '</div></div>';
  return html;
}

function galCalPrev() {
  if (galCalView === 'year') { setGalCalYear(galCalYear - 1); }
  else if (galCalView === 'week') {
    const d = new Date(galCalYear, galCalMonth, galCalDay);
    d.setDate(d.getDate() - 7);
    setGalCalYear(d.getFullYear());
    setGalCalMonth(d.getMonth());
    setGalCalDay(d.getDate());
  } else {
    let m = galCalMonth - 1;
    let y = galCalYear;
    if (m < 0) { m = 11; y--; }
    setGalCalMonth(m);
    setGalCalYear(y);
  }
  renderGalleryCalendar();
}

function galCalNext() {
  if (galCalView === 'year') { setGalCalYear(galCalYear + 1); }
  else if (galCalView === 'week') {
    const d = new Date(galCalYear, galCalMonth, galCalDay);
    d.setDate(d.getDate() + 7);
    setGalCalYear(d.getFullYear());
    setGalCalMonth(d.getMonth());
    setGalCalDay(d.getDate());
  } else {
    let m = galCalMonth + 1;
    let y = galCalYear;
    if (m > 11) { m = 0; y++; }
    setGalCalMonth(m);
    setGalCalYear(y);
  }
  renderGalleryCalendar();
}

function galCalToday() {
  const now = new Date();
  setGalCalYear(now.getFullYear());
  setGalCalMonth(now.getMonth());
  setGalCalDay(now.getDate());
  renderGalleryCalendar();
}

function galCalGoMonth(m) {
  setGalCalMonth(m);
  setGalCalView('month');
  renderGalleryCalendar();
}

function galCalSetView(view) {
  setGalCalView(view);
  renderGalleryCalendar();
}

function galCalSetRelease(dateStr) {
  const p = projects.find(x => x.active);
  if (!p) { showToast('Select a project first in the sidebar, or use 📅 in Unscheduled', 'var(--orange)'); return; }
  const idx = projects.indexOf(p);
  p.release_date = p.release_date === dateStr ? null : dateStr;
  saveReleaseDate(p);
  renderGalleryCalendar();
  showToast(p.release_date ? `Release set to ${dateStr}` : 'Release date cleared', 'var(--green)');
}

function galCalSetReleaseFor(idx, dateStr) {
  const p = projects[idx];
  if (!p) return;
  p.release_date = dateStr;
  saveReleaseDate(p);
  renderGalleryCalendar();
  showToast(`Release set to ${dateStr} for ${p.name}`, 'var(--green)');
}

function saveReleaseDate(p) {
  if (!globalSettings.root_path) return;
  const data = {
    id: p.id, name: p.name, date: p.date, stage: p.stage, thumb: p.thumb,
    release_date: p.release_date || null,
    files: ALL_FILES.map(f => ({ name: f.name, folder: f.folder, ext: f.ext, size_bytes: f.sizeBytes, app: f.app, created_at: f.date })),
    checklist: (window._currentChecklist || []).map(c => ({ label: c.name, done: c.done })),
    note: sessionNote,
    exports: window._currentExports || [],
  };
  saveProject(globalSettings.root_path, data);
}

function triggerDatePicker(projectIdx) {
  setGalCalDateTarget(projectIdx);
  _calDateInput.showPicker ? _calDateInput.showPicker() : _calDateInput.click();
}

function openFromGallery(idx) { closeGallery(); selectProject(idx); }

export { openGallery, closeGallery, setGalleryFilter, setGalleryView, renderGallery, renderGalleryCalendar, galCalPrev, galCalNext, galCalToday, galCalGoMonth, galCalSetView, galCalSetRelease, triggerDatePicker, openFromGallery };
