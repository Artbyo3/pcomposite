export const DEFAULT_TOOLS = [
  { id:'tool_blender',   name:'Blender',           folder_key:'blender',   color:'#ff6b35', exe_path:'', tier:'official', capabilities:['create_file','open_file','bridge'],          order:0 },
  { id:'tool_subs',      name:'Substance Painter', folder_key:'subs',      color:'#a78bfa', exe_path:'', tier:'official', capabilities:['open_file'],                                 order:1 },
  { id:'tool_unity',     name:'Unity',             folder_key:'unity',     color:'#47c5ff', exe_path:'', tier:'official', capabilities:['open_file'],                                 order:2 },
  { id:'tool_fbx',       name:'FBX Exports',       folder_key:'fbx',       color:'#3ddc84', exe_path:'', tier:'official', capabilities:['fbx_versioning','open_file'],                 order:3 },
  { id:'tool_pictures',  name:'Pictures',          folder_key:'pictures',  color:'#fb923c', exe_path:'', tier:'official', capabilities:[],                                            order:4 },
  { id:'tool_promo',     name:'Promo Art',         folder_key:'promo art', color:'#f472b6', exe_path:'', tier:'official', capabilities:[],                                            order:5 },
  { id:'tool_resonite',  name:'Resonite',          folder_key:'resonite',  color:'#fbbf24', exe_path:'', tier:'official', capabilities:[],                                            order:6 },
  { id:'tool_export',    name:'Export',            folder_key:'export',    color:'#e8ff47', exe_path:'', tier:'official', capabilities:[],                                            order:7 },
];

export const DEFAULT_PIPELINE_STAGES = [
  { name:'Blender', color:'#ff6b35', tool_id:'tool_blender', order:0 },
  { name:'Painter', color:'#a78bfa', tool_id:'tool_subs',    order:1 },
  { name:'Unity',   color:'#47c5ff', tool_id:'tool_unity',   order:2 },
  { name:'Package', color:'#3ddc84', tool_id:null,           order:3 },
  { name:'Upload',  color:'#e8ff47', tool_id:null,           order:4 },
];

export const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
export const DAY_NAMES_SHORT = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
