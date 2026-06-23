export const FOLDERS = [
  { key:'blender',   icon:'<img src="/blender.svg" style="width:1em;height:1em;vertical-align:-0.15em;">',                   color:'var(--c-blender)',  desc:'source meshes',       files:0, size:'-', pct:0, _bytes:0 },
  { key:'subs',      icon:'<img src="/substance-3d-painter.svg" style="width:1em;height:1em;vertical-align:-0.15em;">',      color:'var(--c-subs)',     desc:'painter projects',    files:0, size:'-', pct:0, _bytes:0 },
  { key:'unity',     icon:'<img src="/Unity.svg" style="width:1em;height:1em;vertical-align:-0.15em;">',                     color:'var(--c-unity)',    desc:'unity project files', files:0, size:'-', pct:0, _bytes:0 },
  { key:'fbx',       icon:'📦',                                                                                               color:'var(--c-fbx)',      desc:'exported meshes',     files:0, size:'-', pct:0, _bytes:0 },
  { key:'pictures',  icon:'<svg width="1em" height="1em" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="vertical-align:-0.15em;"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>', color:'var(--c-pictures)', desc:'ref + texture shots', files:0, size:'-', pct:0, _bytes:0 },
  { key:'promo art', icon:'🖼️',                                                                                              color:'var(--c-promo)',    desc:'marketing renders',   files:0, size:'-', pct:0, _bytes:0 },
  { key:'resonite',  icon:'<img src="/RSN_Logomark_Color.svg" style="width:1em;height:1em;vertical-align:-0.15em;">',  color:'var(--c-resonite)', desc:'resonite asset pack', files:0, size:'-', pct:0, _bytes:0 },
  { key:'export',    icon:'🚀',                                                                                               color:'var(--c-export)',   desc:'final upload bundle', files:0, size:'-', pct:0, _bytes:0 },
];

export const FOLDER_META = Object.fromEntries(FOLDERS.map(f => [f.key, { color: f.color, icon: f.icon }]));

export const PIPELINE = [
  { label:'Blender', icon:'<img src="/blender.svg" style="width:1em;height:1em;vertical-align:-0.15em;">', done:false, active:true },
  { label:'Painter', icon:'<img src="/substance-3d-painter.svg" style="width:1em;height:1em;vertical-align:-0.15em;">', done:false, active:false },
  { label:'Unity',   icon:'<img src="/Unity.svg" style="width:1em;height:1em;vertical-align:-0.15em;">', done:false, active:false },
  { label:'Package', icon:'📦', done:false, active:false },
  { label:'Upload',  icon:'🚀', done:false, active:false },
];

export const CHECKLIST = [
  { l:'Blender done',  icon:'<img src="/blender.svg" style="width:1em;height:1em;vertical-align:-0.15em;">', color:'var(--c-blender)', done:false },
  { l:'Painter done',  icon:'<img src="/substance-3d-painter.svg" style="width:1em;height:1em;vertical-align:-0.15em;">', color:'var(--c-subs)', done:false },
  { l:'Unity done',    icon:'<img src="/Unity.svg" style="width:1em;height:1em;vertical-align:-0.15em;">', color:'var(--c-unity)', done:false },
  { l:'Package ready', icon:'📦', color:'var(--c-fbx)', done:false },
  { l:'Uploaded',      icon:'🚀', color:'var(--c-export)', done:false },
];

export const APP_ICONS = {
  Blender: '<img src="/blender.svg" style="width:1em;height:1em;vertical-align:-0.15em;">',
  Painter: '<img src="/substance-3d-painter.svg" style="width:1em;height:1em;vertical-align:-0.15em;">',
  Unity:   '<img src="/Unity.svg" style="width:1em;height:1em;vertical-align:-0.15em;">',
  Viewer: '🖼️', Explorer: '📂',
};

export const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export const DAY_NAMES_SHORT = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
