// ── 3D PREVIEW ──
// Self-contained three.js viewer modal. To relocate: move this file + preview3d.css
// and re-add the integration calls (openPreview3dIdx / openPreview3dVersion).
import { convertFileSrc } from '@tauri-apps/api/core';
import { join } from '@tauri-apps/api/path';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { ALL_FILES, globalSettings, projects } from './state.js';

export const VIEWABLE_3D = ['.fbx', '.obj', '.glb', '.gltf', '.stl'];

export function isViewable3dName(name) {
  const ext = '.' + (String(name).split('.').pop() || '').toLowerCase();
  return VIEWABLE_3D.includes(ext);
}

let _ov = null;
let _body = null;
let _renderer = null;
let _scene = null;
let _camera = null;
let _controls = null;
let _model = null;
let _mixer = null;
let _clock = null;
let _raf = 0;
let _wire = false;
let _grid = null;
let _resizeObs = null;
let _keyHandler = null;
let _loadToken = 0;
let _mode = 'original';
let _clayMat = null;
let _normMat = null;
let _matcapTex = null;

const CUBE_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>';
const X_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

function _ensureDom() {
  if (_ov) return;
  _ov = document.createElement('div');
  _ov.id = 'p3dOverlay';
  _ov.innerHTML = `
    <div id="p3dWin" role="dialog" aria-label="3D preview">
      <div id="p3dHead">
        <span class="p3d-hico">${CUBE_SVG}</span>
        <span id="p3dName">3D Preview</span>
        <span style="flex:1"></span>
        <div class="p3d-seg" id="p3dModes" role="group" aria-label="Material mode">
          <button class="p3d-seg-btn on" data-mode="original" title="Original materials">ORIG</button>
          <button class="p3d-seg-btn" data-mode="matcap" title="Studio matcap shading">MATCAP</button>
          <button class="p3d-seg-btn" data-mode="normals" title="Normal map colors">NORMALS</button>
        </div>
        <button id="p3dWire" class="p3d-btn" title="Toggle wireframe">WIRE</button>
        <button id="p3dReset" class="p3d-btn" title="Reset camera">RESET</button>
        <button id="p3dClose" class="p3d-btn p3d-x" title="Close">${X_SVG}</button>
      </div>
      <div id="p3dBody"></div>
      <div id="p3dFoot"><span>drag rotate</span><span>scroll zoom</span><span>right-drag pan</span></div>
    </div>`;
  document.body.appendChild(_ov);
  _body = _ov.querySelector('#p3dBody');

  _ov.querySelector('#p3dClose').addEventListener('click', closePreview3d);
  _ov.querySelector('#p3dWire').addEventListener('click', () => { _wire = !_wire; _applyWire(); });
  _ov.querySelector('#p3dReset').addEventListener('click', () => { if (_model) _frame(_model); });
  _ov.querySelectorAll('.p3d-seg-btn').forEach(b =>
    b.addEventListener('click', () => { _mode = b.dataset.mode; _syncModeButtons(); if (_model) { _applyMode(); } }));
  _ov.addEventListener('mousedown', e => { if (e.target === _ov) closePreview3d(); });

  _keyHandler = e => { if (e.key === 'Escape') closePreview3d(); };
  document.addEventListener('keydown', _keyHandler);

  _resizeObs = new ResizeObserver(() => _onResize());
  _resizeObs.observe(_body);
}

function _initGL() {
  if (_renderer) return;
  const w = Math.max(_body.clientWidth, 100);
  const h = Math.max(_body.clientHeight, 100);
  _renderer = new THREE.WebGLRenderer({ antialias: true });
  _renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  _renderer.setSize(w, h);
  _renderer.toneMapping = THREE.ACESFilmicToneMapping;
  _renderer.toneMappingExposure = 1.15;
  _renderer.domElement.id = 'p3dCanvas';
  _body.appendChild(_renderer.domElement);

  _scene = new THREE.Scene();
  _scene.background = new THREE.Color('#101013');

  _camera = new THREE.PerspectiveCamera(50, w / h, 0.01, 5000);
  _camera.position.set(4, 3, 5);

  const hemi = new THREE.HemisphereLight(0xe8eeff, 0x1c1c24, 1.6);
  const key = new THREE.DirectionalLight(0xffffff, 3.2);
  key.position.set(5, 10, 7);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 1.0);
  fill.position.set(-4, 2, 6);
  const rim = new THREE.DirectionalLight(0x8fb0ff, 1.1);
  rim.position.set(-6, 4, -8);
  _scene.add(hemi, key, fill, rim);

  _controls = new OrbitControls(_camera, _renderer.domElement);
  _controls.enableDamping = true;
  _controls.dampingFactor = 0.08;

  _clock = new THREE.Clock();
}

function _onResize() {
  if (!_renderer || !_body) return;
  const w = Math.max(_body.clientWidth, 10);
  const h = Math.max(_body.clientHeight, 10);
  _renderer.setSize(w, h);
  if (_camera) {
    _camera.aspect = w / h;
    _camera.updateProjectionMatrix();
  }
}

function _disposeObject(root) {
  root.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        for (const k of Object.keys(m)) {
          const v = m[k];
          if (v && v.isTexture) v.dispose();
        }
        m.dispose();
      }
    }
  });
}

function _clearModel() {
  if (_mixer) { _mixer.stopAllAction(); _mixer = null; }
  if (_model) {
    _scene.remove(_model);
    _disposeObject(_model);
    _model = null;
  }
  // Shared mode materials are disposed as part of the model traverse above;
  // null them so `_applyMode` recreates fresh ones next time.
  _clayMat = null;
  _normMat = null;
  if (_grid) {
    _scene.remove(_grid);
    _grid.geometry.dispose();
    _grid.material.dispose();
    _grid = null;
  }
}

function _frame(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  if (box.isEmpty()) return;
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;

  obj.position.y -= box.min.y;
  obj.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(obj);
  const c = box2.getCenter(new THREE.Vector3());

  if (_grid) { _scene.remove(_grid); _grid.geometry.dispose(); _grid.material.dispose(); }
  const gs = Math.max(maxDim * 2, 1);
  _grid = new THREE.GridHelper(gs, 40, 0x353545, 0x232330);
  _grid.position.y = 0.0001;
  _scene.add(_grid);

  _controls.target.copy(c);
  _camera.near = maxDim / 200;
  _camera.far = maxDim * 50;
  _camera.position.set(c.x + maxDim * 0.85, c.y + maxDim * 0.55, c.z + maxDim * 0.95);
  _camera.updateProjectionMatrix();
  _controls.update();
}

function _eachMeshMat(fn) {
  if (!_model) return;
  _model.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) fn(m);
  });
}

function _makeMatcap() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');

  const base = g.createLinearGradient(0, 0, 0, 256);
  base.addColorStop(0, '#f4f6fc');
  base.addColorStop(0.55, '#b9becb');
  base.addColorStop(1, '#565a66');
  g.fillStyle = base;
  g.beginPath(); g.arc(128, 128, 128, 0, Math.PI * 2); g.fill();

  const key = g.createRadialGradient(86, 78, 8, 86, 78, 112);
  key.addColorStop(0, 'rgba(255,255,255,.95)');
  key.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = key;
  g.beginPath(); g.arc(128, 128, 128, 0, Math.PI * 2); g.fill();

  const rim = g.createRadialGradient(192, 192, 16, 192, 192, 122);
  rim.addColorStop(0, 'rgba(158,178,226,.55)');
  rim.addColorStop(1, 'rgba(158,178,226,0)');
  g.fillStyle = rim;
  g.beginPath(); g.arc(128, 128, 128, 0, Math.PI * 2); g.fill();

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function _applyMode() {
  if (!_model) return;
  _eachMeshMat(m => { m.wireframe = false; });
  if (_mode === 'matcap') {
    if (!_matcapTex) _matcapTex = _makeMatcap();
    if (!_clayMat || !_clayMat.isMeshMatcapMaterial) {
      if (_clayMat) _clayMat.dispose();
      _clayMat = new THREE.MeshMatcapMaterial({ matcap: _matcapTex });
    }
    _model.traverse(o => {
      if (!o.isMesh) return;
      if (!o.userData.__origMat) o.userData.__origMat = o.material;
      o.material = _clayMat;
    });
  } else if (_mode === 'normals') {
    if (!_normMat) _normMat = new THREE.MeshNormalMaterial();
    _model.traverse(o => {
      if (!o.isMesh) return;
      if (!o.userData.__origMat) o.userData.__origMat = o.material;
      o.material = _normMat;
    });
  } else {
    _model.traverse(o => {
      if (!o.isMesh) return;
      if (o.userData.__origMat) o.material = o.userData.__origMat;
      delete o.userData.__origMat;
    });
  }
  _applyWire();
}

function _applyWire() {
  _eachMeshMat(m => { m.wireframe = _wire; });
}

function _syncModeButtons() {
  if (!_ov) return;
  _ov.querySelectorAll('.p3d-seg-btn').forEach(b =>
    b.classList.toggle('on', b.dataset.mode === _mode));
}

function _startLoop() {
  cancelAnimationFrame(_raf);
  const tick = () => {
    if (!_renderer) return;
    _raf = requestAnimationFrame(tick);
    const dt = _clock.getDelta();
    if (_mixer) _mixer.update(dt);
    _controls.update();
    _renderer.render(_scene, _camera);
  };
  tick();
}

function _setState(msg, isError) {
  let el = _ov.querySelector('#p3dState');
  if (!msg) { if (el) el.remove(); return; }
  if (!el) {
    el = document.createElement('div');
    el.id = 'p3dState';
    _body.appendChild(el);
  }
  el.innerHTML = `<div class="p3d-state-ico">${isError ? X_SVG : CUBE_SVG}</div><div>${msg}</div>`;
  el.classList.toggle('err', !!isError);
}

function _loadByExt(url, ext) {
  return new Promise((resolve, reject) => {
    const onErr = err => reject(err || new Error('load failed'));
    if (ext === '.glb' || ext === '.gltf') {
      new GLTFLoader().load(url, g => resolve({ object: g.scene, animations: g.animations || [] }), undefined, onErr);
    } else if (ext === '.fbx') {
      new FBXLoader().load(url, o => resolve({ object: o, animations: o.animations || [] }), undefined, onErr);
    } else if (ext === '.obj') {
      new OBJLoader().load(url, o => resolve({ object: o, animations: [] }), undefined, onErr);
    } else if (ext === '.stl') {
      new STLLoader().load(url,
        geo => {
          geo.computeVertexNormals();
          resolve({ object: new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0xb9bfd0, roughness: 0.55, metalness: 0.15, side: THREE.DoubleSide })), animations: [] });
        },
        undefined, onErr);
    } else {
      reject(new Error('unsupported'));
    }
  });
}

export async function openPreview3d(path, name) {
  _ensureDom();
  const ext = '.' + (String(name).split('.').pop() || '').toLowerCase();

  _ov.classList.add('open');
  document.getElementById('p3dName').textContent = name || '3D Preview';
  _setState('Loading model…');

  if (!VIEWABLE_3D.includes(ext)) {
    _setState('.' + ext.replace('.', '') + " can't be rendered locally yet — open it in its native app.", true);
    return;
  }

  _initGL();
  _clearModel();
  const token = ++_loadToken;
  _onResize();

  try {
    const { object, animations } = await _loadByExt(convertFileSrc(path), ext);
    if (token !== _loadToken) return;
    _setState(null);
    _model = object;
    _scene.add(_model);
    _frame(_model);
    _applyMode();
    _syncModeButtons();
    if (animations.length) {
      _mixer = new THREE.AnimationMixer(object);
      _mixer.clipAction(animations[0]).play();
    }
    _startLoop();
  } catch (err) {
    if (token !== _loadToken) return;
    console.warn('preview3d load failed:', err);
    _setState('Could not load this model — the format or its textures may be unsupported.', true);
  }
}

export function closePreview3d() {
  if (!_ov || !_ov.classList.contains('open')) return;
  _ov.classList.remove('open');
  cancelAnimationFrame(_raf);
  _raf = 0;
  _clearModel();
  if (_clayMat) { _clayMat.dispose(); _clayMat = null; }
  if (_normMat) { _normMat.dispose(); _normMat = null; }
  if (_matcapTex) { _matcapTex.dispose(); _matcapTex = null; }
  _mode = 'original';
  if (_renderer) {
    _renderer.dispose();
    _renderer.domElement.remove();
    _renderer = null;
    _scene = null;
    _camera = null;
    _controls = null;
    _clock = null;
    _wire = false;
    _loadToken++;
  }
}

export async function openPreview3dIdx(idx) {
  const f = ALL_FILES[idx];
  if (!f || !globalSettings.root_path) return;
  const p = projects.find(x => x.active);
  if (!p) return;
  const path = f.subfolder
    ? await join(globalSettings.root_path, p.id + '_' + p.name, f.folder, f.subfolder, f.name)
    : await join(globalSettings.root_path, p.id + '_' + p.name, f.folder, f.name);
  openPreview3d(path, f.name);
}

window.openPreview3dVersion = async function(exIdx) {
  const ex = (window._currentExports || [])[exIdx];
  if (!ex || !ex.fileNames || !ex.fileNames.length) return;
  const fn = ex.fileNames.find(n => isViewable3dName(n));
  const idx = ALL_FILES.findIndex(f => f.name === fn);
  if (idx === -1) return;
  openPreview3dIdx(idx);
};

window.openPreview3dIdx = openPreview3dIdx;
window.closePreview3d = closePreview3d;
