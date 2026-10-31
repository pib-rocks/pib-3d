import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const LEFT_ARM = new Set([
  'rotation_inner_shoulder_1', 'rotation_shoulder_left_1', 'central_rotator_rotation_1',
  'rotation_elbow_1', 'rotate_forearm_1', 'dof_wrist_1', 'rotation_wrist_left',
]);
const RIGHT_ARM = new Set([
  'rotation_inner_shoulder', 'rotation_shoulder_left', 'central_rotator_rotation',
  'rotation_elbow', 'rotate_forearm', 'dof_wrist', 'rotation_wrist_right',
]);
const HEAD = new Set(['gearing_rotation__new_body_', 'nodding_rotation']);

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d1117);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.01, 200);
camera.position.set(1.5, 1.15, 1.8);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.2;
controls.maxDistance = 14;
controls.target.set(0, 0.55, 0);
controls.autoRotateSpeed = 0.7;

scene.add(new THREE.HemisphereLight(0xffffff, 0x2b3138, 1.35));
const key = new THREE.DirectionalLight(0xffffff, 2.0);
key.position.set(2.5, 4.0, 2.0);
scene.add(key);
const fill = new THREE.DirectionalLight(0xbfd4ff, 0.75);
fill.position.set(-2.5, 1.5, -2.0);
scene.add(fill);
const rim = new THREE.DirectionalLight(0xffffff, 0.5);
rim.position.set(0, 2.0, -3.0);
scene.add(rim);

const grid = new THREE.GridHelper(4, 40, 0x3d444d, 0x21262d);
grid.material.transparent = false;
scene.add(grid);

// URDF is Z-up, three.js is Y-up
const modelRoot = new THREE.Group();
modelRoot.rotation.x = -Math.PI / 2;
scene.add(modelRoot);

const el = {
  bar: document.getElementById('load-bar'),
  txt: document.getElementById('load-txt'),
  err: document.getElementById('load-err'),
  box: document.getElementById('loading'),
  stats: document.getElementById('stats'),
  joints: document.getElementById('joints'),
};

function rpyQuat(r, p, y) {
  const m = new THREE.Matrix4()
    .multiply(new THREE.Matrix4().makeRotationZ(y))
    .multiply(new THREE.Matrix4().makeRotationY(p))
    .multiply(new THREE.Matrix4().makeRotationX(r));
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

function fail(message) {
  el.err.textContent = message;
  el.txt.textContent = 'Laden fehlgeschlagen';
  console.error(message);
}

async function main() {
  const response = await fetch('./model.json');
  if (!response.ok) throw new Error(`model.json: HTTP ${response.status}`);
  const model = await response.json();

  const loader = new GLTFLoader();
  const linkNodes = new Map();
  const partsOf = new Map(model.links.map((l) => [l.name, l.parts || [l.name]]));
  const done = { count: 0 };
  const total = model.links.length;

  el.txt.textContent = `0 / ${total} Bauteile`;

  // bounded parallelism: the browser copes better with a few big files at a time
  const queue = model.links.slice();
  async function worker() {
    while (queue.length) {
      const link = queue.shift();
      const gltf = await loader.loadAsync(`./${link.mesh}?v=${model.build || ''}`);
      const node = gltf.scene;
      node.name = link.name;
      node.traverse((o) => {
        o.userData.link = link.name;
        if (o.isMesh && o.material) {
          o.material.envMapIntensity = 0.6;
          if (o.material.metalness !== undefined) o.material.metalness = Math.min(o.material.metalness, 0.35);
        }
      });
      linkNodes.set(link.name, node);
      done.count += 1;
      el.bar.style.width = `${(done.count / total) * 100}%`;
      el.txt.textContent = `${done.count} / ${total} Bauteile`;
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));

  // hierarchy
  const parentOf = new Map();
  const motions = [];
  const jointOfLink = new Map();
  for (const joint of model.joints) {
    parentOf.set(joint.child, joint.parent);
    jointOfLink.set(joint.child, joint);
    const pivot = new THREE.Group();
    pivot.name = `pivot:${joint.name}`;
    pivot.position.fromArray(joint.origin.xyz);
    pivot.quaternion.copy(rpyQuat(...joint.origin.rpy));
    pivot.add(linkNodes.get(joint.child));
    linkNodes.get(joint.parent).add(pivot);

    const motion = linkNodes.get(joint.child);
    const axis = new THREE.Vector3().fromArray(joint.axis).normalize();
    motions.push({ joint, motion, axis });
  }

  const rootLink = model.links.map((l) => l.name).find((n) => !parentOf.has(n));
  modelRoot.add(linkNodes.get(rootLink));

  // The URDF root frame sits inside the body, not at the feet: the whole robot
  // hangs below y=0 and the floor plane cut straight through it. Lift the model
  // so its lowest point rests on the floor, then frame it.
  const raw = new THREE.Box3().setFromObject(modelRoot);
  modelRoot.position.y -= raw.min.y;

  // camera framing
  const box = new THREE.Box3().setFromObject(modelRoot);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z);
  controls.target.set(center.x, center.y * 0.95, center.z);
  camera.position.set(center.x + radius * 1.05, center.y + radius * 0.42, center.z + radius * 1.15);
  camera.near = radius / 200;
  camera.far = radius * 60;
  camera.updateProjectionMatrix();

  let triangles = 0;
  modelRoot.traverse((o) => {
    if (o.isMesh && o.geometry?.index) triangles += o.geometry.index.count / 3;
  });
  el.stats.innerHTML =
    `<b>${model.links.length}</b> Links · <b>${model.joints.length}</b> Joints<br>` +
    `<b>${Math.round(triangles).toLocaleString('de-DE')}</b> Dreiecke · ` +
    `${size.x.toFixed(2)} × ${size.y.toFixed(2)} × ${size.z.toFixed(2)} m`;

  buildJointPanel(motions);
  el.box.style.display = 'none';

  // ---- controls -------------------------------------------------------
  const setPose = (fn) => {
    for (const m of motions) {
      const { joint, motion, axis } = m;
      const v = fn(joint);
      if (joint.type === 'prismatic') {
        motion.position.copy(axis).multiplyScalar(v);
      } else {
        motion.quaternion.setFromAxisAngle(axis, v);
      }
      const input = document.getElementById(`in:${joint.name}`);
      if (input) input.value = String(toUi(joint, v));
    }
  };
  const zero = () => setPose(() => 0);
  const mid = () => setPose((j) => (j.limit && !j.name.endsWith('_door_rotation')
    ? (j.limit.lower + j.limit.upper) / 2 : 0));

  document.getElementById('btn-zero').onclick = zero;
  document.getElementById('btn-mid').onclick = mid;
  const gridBtn = document.getElementById('btn-grid');
  gridBtn.onclick = () => {
    grid.visible = !grid.visible;
    gridBtn.classList.toggle('on', grid.visible);
  };
  const spinBtn = document.getElementById('btn-spin');
  spinBtn.onclick = () => {
    controls.autoRotate = !controls.autoRotate;
    spinBtn.classList.toggle('on', controls.autoRotate);
  };

  function buildJointPanel(list) {
    const order = ['Kopf', 'Linker Arm', 'Rechter Arm', 'Linke Hand', 'Rechte Hand', 'Körper'];
    const groups = new Map(order.map((k) => [k, []]));
    const chainOf = (link) => {
      const out = [];
      let cur = link;
      while (cur) {
        out.push(cur);
        cur = parentOf.has(cur) ? model.joints.find((j) => j.child === cur).parent : null;
      }
      return out;
    };
    for (const m of list) {
      const chain = chainOf(m.joint.child);
      const palm = chain.find((n) => n.includes('palm'));
      let region;
      if (HEAD.has(m.joint.name)) region = 'Kopf';
      else if (LEFT_ARM.has(m.joint.name)) region = 'Linker Arm';
      else if (RIGHT_ARM.has(m.joint.name)) region = 'Rechter Arm';
      else if (palm) region = palm.includes('_l_') ? 'Linke Hand' : 'Rechte Hand';
      else region = 'Körper';
      groups.get(region).push(m);
    }

    for (const [region, items] of groups) {
      if (!items.length) continue;
      const h = document.createElement('h2');
      h.textContent = `${region} · ${items.length}`;
      el.joints.appendChild(h);
      for (const m of items) {
        const { joint } = m;
        const wrap = document.createElement('div');
        wrap.className = 'j';
        wrap.id = `row:${joint.name}`;
        const [min, max] = uiRange(joint);
        wrap.innerHTML = `
          <div class="row"><span class="name" title="${joint.name}">${pretty(joint.name)}</span>
          <span class="val" id="v:${joint.name}"></span></div>
          <input type="range" id="in:${joint.name}" min="${min}" max="${max}" step="1" value="0">`;
        el.joints.appendChild(wrap);
        const input = wrap.querySelector('input');
        const out = wrap.querySelector('.val');
        out.textContent = label(joint, 0);
        input.addEventListener('input', () => {
          const ui = Number(input.value);
          const v = fromUi(joint, ui);
          if (joint.type === 'prismatic') m.motion.position.copy(m.axis).multiplyScalar(v);
          else m.motion.quaternion.setFromAxisAngle(m.axis, v);
          out.textContent = label(joint, v);
        });
      }
    }
  }

  function uiRange(joint) {
    if (joint.type === 'prismatic') return [-80, 80];
    if (!joint.limit) return [-180, 180];
    return [Math.round(THREE.MathUtils.radToDeg(joint.limit.lower)),
            Math.round(THREE.MathUtils.radToDeg(joint.limit.upper))];
  }
  function fromUi(joint, ui) {
    return joint.type === 'prismatic' ? ui / 1000 : THREE.MathUtils.degToRad(ui);
  }
  function toUi(joint, v) {
    return joint.type === 'prismatic' ? v * 1000 : THREE.MathUtils.radToDeg(v);
  }
  function label(joint, v) {
    return joint.type === 'prismatic' ? `${(v * 1000).toFixed(1)} mm` : `${THREE.MathUtils.radToDeg(v).toFixed(0)}°`;
  }
  function pretty(name) {
    return name.replace(/_hinge$/, '').replace(/_/g, ' ').replace(/\b(\w)/g, (c) => c.toUpperCase());
  }

  // ---- click a part, its joint's slider becomes active ----------------
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const originals = new Map();
  let selected = null;

  function highlight(linkName, on) {
    const node = linkNodes.get(linkName);
    if (!node) return;
    node.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      for (const m of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (on) {
          if (!originals.has(m)) originals.set(m, { color: m.emissive ? m.emissive.getHex() : null, intensity: m.emissiveIntensity });
          if (m.emissive) { m.emissive.setHex(0x1f6feb); m.emissiveIntensity = 0.28; m.needsUpdate = true; }
        } else {
          const before = originals.get(m);
          if (before && m.emissive && before.color !== null) {
            m.emissive.setHex(before.color);
            m.emissiveIntensity = before.intensity;
            m.needsUpdate = true;
          }
        }
      }
    });
  }

  function selectLink(linkName) {
    if (selected === linkName) return;
    // a welded part (the torso) has no joint of its own: walk up until a link
    // with a joint is found, and leave the selection alone if there is none
    let cur = linkName;
    let joint = jointOfLink.get(cur);
    while (!joint && parentOf.has(cur)) { cur = parentOf.get(cur); joint = jointOfLink.get(cur); }
    if (!joint) return;
    if (selected) {
      highlight(selected, false);
      const prev = jointOfLink.get(selected);
      if (prev) document.getElementById(`row:${prev.name}`)?.classList.remove('active');
    }
    selected = cur;
    linkName = cur;
    highlight(linkName, true);
    const info = document.getElementById('info');
    document.getElementById('info-link').textContent = cur;
    document.getElementById('info-joint').textContent = joint.name;
    const parts = partsOf.get(cur) || [cur];
    document.getElementById('info-summary').textContent =
      `${parts.length} Teil${parts.length === 1 ? '' : 'e'} im CAD`;
    document.getElementById('info-list').textContent = parts.join(', ');
    info.classList.add('show');
    const row = document.getElementById(`row:${joint.name}`);
    if (!row) return;
    row.classList.add('active');
    row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    const input = row.querySelector('input');
    input.focus({ preventScroll: true });
  }

  function pick(event) {
    camera.updateMatrixWorld();          // the ray must use the camera as it is now
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const hits = raycaster.intersectObject(modelRoot, true);
    return hits.length ? hits[0].object.userData.link : null;
  }

  let down = null;
  renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 500;
    down = null;
    if (moved > 5 || !quick) return;          // that was an orbit, not a click
    const link = pick(e);
    if (link) selectLink(link);
  });
  // hover: name the part under the cursor, without a click
  const tip = document.getElementById('tip');
  let lastHover = 0;
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (e.buttons) { tip.classList.add('hidden'); tip.style.display = 'none'; return; }
    const now = performance.now();
    if (now - lastHover < 60) return;
    lastHover = now;
    const link = pick(e);
    renderer.domElement.style.cursor = link ? 'pointer' : '';
    if (!link) { tip.style.display = 'none'; return; }
    const parts = partsOf.get(link) || [link];
    tip.textContent = `${link} · ${parts.length} Teil${parts.length === 1 ? '' : 'e'}`;
    tip.style.display = 'block';
    tip.style.left = `${e.clientX + 14}px`;
    tip.style.top = `${e.clientY + 14}px`;
  });
  renderer.domElement.addEventListener('pointerleave', () => { tip.style.display = 'none'; });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // publish only once everything is wired, so a caller never sees a half-built page
  window.pibModel = { scene, modelRoot, motions, linkNodes, camera, controls, renderer, selectLink: (n) => selectLink(n) };
  window.THREE = THREE;

  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });
}

main().catch((e) => fail(String(e && e.stack ? e.stack : e)));
