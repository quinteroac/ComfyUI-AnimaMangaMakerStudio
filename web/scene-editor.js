import { api } from '../../scripts/api.js';
import { el, button, field, iconButton, uuid, chooseFile } from './client.js';
import { segmented, toggle } from './controls.js';
import { options } from './prompts.js';
import { regionColors } from './pose-editor.js';

// Blockout pieces. Sizes are meters (width, height, depth); `y` is the base elevation and `rotation` turns around the vertical axis.
export const sceneKinds = {
    box: { label: 'Box', size: [1, 1, 1] },
    cylinder: { label: 'Cylinder', size: [0.8, 1, 0.8] },
    stairs: { label: 'Stairs', size: [1.2, 1.5, 2.4] },
    ramp: { label: 'Ramp', size: [1.2, 0.8, 2] },
    panel: { label: 'Panel', size: [2, 2, 0.05] },
    door: { label: 'Door', size: [1, 2.1, 0.05] },
    window: { label: 'Window', size: [1, 1.5, 0.04] },
    model: { label: '3D model (GLB)', size: [1, 1, 1] },
    figure: { label: 'Figure', size: [0.5, 1.6, 0.3] },
};
// Figures only stand in for characters: they become the Regions layer, one flat color each in scene order, and stay out of the other maps.
export const figurePoses = { standing: 'Standing', sitting: 'Sitting' };

const piece = (kind, x, z, extra = {}) => ({ id: uuid(), kind, x, y: 0, z, rotation: 0, ...Object.fromEntries(['width', 'height', 'depth'].map((key, i) => [key, sceneKinds[kind].size[i]])), ...extra });

// Starting points; the classroom is the blockout validated with the Any LLLite.
export const sceneTemplates = {
    room: { label: 'Empty room', build: () => ({ room: { width: 6, depth: 6, height: 3, walls: true, ceiling: false }, objects: [], cameras: [{ name: 'Wide', position: [2.4, 1.5, 2.4], target: [-1, 1, -1.5], fov: 55 }] }) },
    classroom: { label: 'Classroom', build: () => ({
        room: { width: 9, depth: 8, height: 3, walls: true, ceiling: true },
        objects: [
            piece('panel', 0, -3.92, { y: 1, width: 4, height: 1.2 }), piece('box', 0, -2.8, { width: 2, height: 0.8, depth: 0.8 }),
            ...[-2.25, 0, 2.25].map(z => piece('window', -4.43, z, { y: 0.9, rotation: 90, height: 1.7 })),
            piece('door', 4.43, 2.5, { rotation: 90 }),
            ...[0, 1, 2].flatMap(row => [0, 1, 2].flatMap(col => [piece('box', -2.4 + col * 2.4, -0.8 + row * 1.6, { width: 1.1, height: 0.72, depth: 0.6 }),
                piece('box', -2.4 + col * 2.4, -0.25 + row * 1.6, { width: 0.45, height: 0.45, depth: 0.45 })])),
        ],
        cameras: [{ name: 'Back corner', position: [3.6, 1.55, 3.6], target: [-1.5, 1.1, -3], fov: 55 }, { name: 'Low front', position: [-3.4, 1.4, -3.4], target: [2.2, 0.9, 3], fov: 55 }],
    }) },
    ground: { label: 'Open ground', build: () => ({ room: { width: 40, depth: 40, height: 3, walls: false, ceiling: false }, objects: [], cameras: [{ name: 'Street level', position: [0, 1.6, 6], target: [0, 1.4, 0], fov: 55 }] }) },
};

export const newScene = (name, template = 'room') => ({ id: uuid(), name, ...sceneTemplates[template].build() });

const loadThree = () => Promise.all(['three.module.js', 'OrbitControls.js', 'TransformControls.js', 'GLTFLoader.js'].map(file => import(api.apiURL('/anima-manga-maker/drawing/three/') + file)));
// GLB and glTF files in ComfyUI's input/3d folder, where Load3D keeps them.
const modelFiles = defs => options(defs, 'Load3D', 'model_file').filter(name => /\.(glb|gltf)$/i.test(name));
const modelUrl = file => { const slash = file.lastIndexOf('/'); return api.apiURL('/view?' + new URLSearchParams({ filename: file.slice(slash + 1), subfolder: slash < 0 ? '3d' : `3d/${file.slice(0, slash)}`, type: 'input' })); };

// A scene's room and pieces as meshes with black edge children. One material per view is swapped onto every mesh.
function blockoutWorld(THREE, GLTFLoader) {
    const world = new THREE.Scene(), group = new THREE.Group(); world.add(group);
    world.add(new THREE.HemisphereLight(0xffffff, 0x8890a0, 2.2)); const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(4, 8, 5); world.add(sun);
    const depth = new THREE.ShaderMaterial({ uniforms: { near: { value: 0.3 }, far: { value: 14 } },
        vertexShader: 'varying float d; void main(){ vec4 p = modelViewMatrix * vec4(position, 1.0); d = -p.z; gl_Position = projectionMatrix * p; }',
        fragmentShader: 'uniform float near; uniform float far; varying float d; void main(){ float v = 1.0 - clamp((d - near) / (far - near), 0.0, 1.0); gl_FragColor = vec4(v, v, v, 1.0); }' });
    const materials = { shaded: new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 1, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
        picked: new THREE.MeshStandardMaterial({ color: 0xf2b866, roughness: 1, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
        edges: new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }), depth,
        // Ink keeps only the lines: faces still hide the lines behind them but draw nothing.
        ink: new THREE.MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
        black: new THREE.MeshBasicMaterial({ color: 0x000000 }) };
    const regions = regionColors.map(color => ({ shaded: new THREE.MeshStandardMaterial({ color, roughness: 1 }), flat: new THREE.MeshBasicMaterial({ color }) }));
    const ink = new THREE.LineBasicMaterial({ color: 0x000000 });
    // Loaded models for this world only, each mesh already carrying its edges; pieces clone them.
    const models = new Map(), loader = new GLTFLoader();
    async function loadModel(file) {
        const gltf = await loader.loadAsync(modelUrl(file)).catch(() => { throw new Error(`Could not load the 3D model "${file}" from ComfyUI's input/3d folder.`); });
        const root = new THREE.Group(); gltf.scene.updateMatrixWorld(true);
        // Posed or skinned meshes are kept as static meshes in their bind pose.
        gltf.scene.traverse(c => { if (!c.isMesh) return; if (!c.geometry.attributes.normal) c.geometry.computeVertexNormals(); const m = new THREE.Mesh(c.geometry); c.matrixWorld.decompose(m.position, m.quaternion, m.scale); m.userData.shared = true; root.add(m); });
        const box = new THREE.Box3().setFromObject(root), center = box.getCenter(new THREE.Vector3());
        for (const m of root.children) { m.position.sub(new THREE.Vector3(center.x, box.min.y, center.z)); const lines = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 20), ink); lines.userData.shared = true; m.add(lines); }
        return { root, size: box.getSize(new THREE.Vector3()) };
    }
    const mesh = (geometry, x, y, z, id) => {
        const m = new THREE.Mesh(geometry); m.position.set(x, y, z); m.userData.id = id;
        m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 20), ink)); return m;
    };
    // A figure of `height` meters facing +z, built from boxes and a head.
    function buildFigure(o, piece, index) {
        const k = o.height / 1.6, part = (sx, sy, sz, x, y, z) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx * k, sy * k, sz * k)); m.position.set(x * k, y * k, z * k); return m; };
        const sitting = o.pose === 'sitting', hip = sitting ? 0.5 : 0.8;
        const parts = sitting ? [part(0.13, 0.14, 0.45, -0.09, 0.5, 0.2), part(0.13, 0.14, 0.45, 0.09, 0.5, 0.2), part(0.12, 0.45, 0.13, -0.09, 0.225, 0.42), part(0.12, 0.45, 0.13, 0.09, 0.225, 0.42)]
            : [part(0.13, 0.8, 0.14, -0.09, 0.4, 0), part(0.13, 0.8, 0.14, 0.09, 0.4, 0)];
        const head = new THREE.Mesh(new THREE.SphereGeometry(0.11 * k, 16, 12)); head.position.set(0, (hip + 0.67) * k, 0);
        parts.push(part(0.36, 0.55, 0.2, 0, hip + 0.275, 0), part(0.09, 0.6, 0.1, -0.24, hip + 0.25, 0), part(0.09, 0.6, 0.1, 0.24, hip + 0.25, 0), head);
        for (const m of parts) { m.userData.id = o.id; m.userData.figure = index % regions.length; piece.add(m); }
    }
    function buildPiece(o, index) {
        const piece = new THREE.Group(), { width: w, height: h, depth: d } = o; piece.userData.id = o.id;
        if (o.kind === 'figure') buildFigure(o, piece, index);
        else if (o.kind === 'model' && models.get(o.file)?.result) {
            const { root, size } = models.get(o.file).result, model = root.clone(true);
            model.scale.setScalar(Math.min(w / (size.x || 1), h / (size.y || 1), d / (size.z || 1))); model.traverse(c => { if (c.isMesh) c.userData.id = o.id; }); piece.add(model);
        } else if (o.kind === 'cylinder') { const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 24); g.scale(w, h, d); piece.add(mesh(g, 0, h / 2, 0, o.id)); }
        else if (o.kind === 'stairs') {
            const steps = Math.max(2, Math.round(h / 0.18));
            for (let i = 0; i < steps; i++) piece.add(mesh(new THREE.BoxGeometry(w, h * (i + 1) / steps, d / steps), 0, h * (i + 1) / steps / 2, d / 2 - d * (i + 0.5) / steps, o.id));
        } else if (o.kind === 'ramp') {
            const shape = new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(-d / 2, h)]);
            const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false }); g.rotateY(Math.PI / 2); g.translate(-w / 2, 0, 0); piece.add(mesh(g, 0, 0, 0, o.id));
        } else piece.add(mesh(new THREE.BoxGeometry(w, h, d), 0, h / 2, 0, o.id));
        piece.position.set(o.x, o.y, o.z); piece.rotation.y = o.rotation * Math.PI / 180; return piece;
    }
    const clear = () => { for (const child of [...group.children]) { group.remove(child); child.traverse(c => { if (!c.userData.shared) c.geometry?.dispose(); }); } };
    return {
        world, group,
        // Loads the scene's models before `build`; a failed file rejects and is tried again on the next load.
        async load(scene) {
            await Promise.all([...new Set(scene.objects.filter(o => o.kind === 'model' && o.file).map(o => o.file))].map(file => {
                if (!models.has(file)) {
                    const entry = { promise: loadModel(file).then(result => { entry.result = result; }, error => { models.delete(file); throw error; }) };
                    models.set(file, entry);
                }
                return models.get(file).promise;
            }));
        },
        build(scene) {
            clear();
            const { width: w, depth: d, height: h, walls, ceiling } = scene.room, t = 0.1;
            const shell = new THREE.Group(); shell.userData.id = null;
            shell.add(mesh(new THREE.BoxGeometry(w, t, d), 0, -t / 2, 0, null));
            if (ceiling) shell.add(mesh(new THREE.BoxGeometry(w, t, d), 0, h + t / 2, 0, null));
            if (walls) for (const [x, z, sx, sz] of [[0, -d / 2, w, t], [0, d / 2, w, t], [-w / 2, 0, t, d], [w / 2, 0, t, d]]) shell.add(mesh(new THREE.BoxGeometry(sx, h, sz), x, h / 2, z, null));
            group.add(shell);
            let figures = 0;
            for (const o of scene.objects) group.add(buildPiece(o, o.kind === 'figure' ? figures++ : 0));
        },
        paint(mode, eye, picked = null) {
            group.traverse(c => {
                if (c.isLineSegments) c.visible = ['shaded', 'edges', 'ink'].includes(mode);
                else if (c.isMesh && c.userData.figure !== undefined) { c.visible = ['shaded', 'regions'].includes(mode); c.material = regions[c.userData.figure][mode === 'shaded' ? 'shaded' : 'flat']; }
                else if (c.isMesh) c.material = mode === 'regions' ? materials.black : mode === 'shaded' && picked && c.userData.id === picked ? materials.picked : materials[mode];
            });
            world.background = mode === 'ink' ? null : new THREE.Color({ shaded: 0x2b2f36, edges: 0xffffff, depth: 0x000000, regions: 0x000000 }[mode]);
            if (mode === 'depth') {
                // Linear depth from just in front of the camera to the farthest corner of the blockout.
                const box = new THREE.Box3().setFromObject(group), corners = [0, 1, 2, 3, 4, 5, 6, 7].map(i => new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
                depth.uniforms.far.value = Math.max(1, ...corners.map(c => c.distanceTo(eye.position)));
            }
        },
        dispose() {
            clear(); Object.values(materials).forEach(m => m.dispose()); regions.forEach(r => { r.shaded.dispose(); r.flat.dispose(); }); ink.dispose();
            for (const { result } of models.values()) result?.root.traverse(c => c.geometry?.dispose());
        },
    };
}

// Renders one view of the world at `size` as a PNG data URL. Regions stay aliased so each figure keeps one flat color; ink is lines on transparency.
function shoot(THREE, view, eye, size, mode) {
    const renderer = new THREE.WebGLRenderer({ antialias: mode !== 'regions', alpha: true, preserveDrawingBuffer: true }); renderer.setPixelRatio(1); renderer.setSize(size.width, size.height, false); renderer.setClearColor(0x000000, 0);
    const lens = eye.clone(); lens.aspect = size.width / size.height; lens.updateProjectionMatrix();
    view.paint(mode, lens); renderer.render(view.world, lens); const url = renderer.domElement.toDataURL('image/png'); renderer.dispose(); return url;
}

const lensFor = (THREE, c, size) => { const eye = new THREE.PerspectiveCamera(c.fov, size.width / size.height, 0.05, 200); eye.position.set(...c.position); eye.lookAt(...c.target); return eye; };

// A scene camera rendered as `edges`, `depth` or `regions` at `size`, exactly as Apply to layers renders it.
export async function renderScene(scene, cameraName, size, map) {
    const camera = scene.cameras.find(c => c.name === cameraName);
    if (!camera) throw new Error(`Camera "${cameraName}" is no longer in the scene "${scene.name}". Choose another camera for the control.`);
    const [THREE, , , { GLTFLoader }] = await loadThree(), view = blockoutWorld(THREE, GLTFLoader);
    try { await view.load(scene); view.build(scene); return shoot(THREE, view, lensFor(THREE, camera, size), size, map); } finally { view.dispose(); }
}
// The scene map a control of `type` reads.
export const sceneMap = type => type === 'depth' ? 'depth' : type === 'regional' ? 'regions' : 'edges';

// Images that used a scene: panel results whose settings hold a scene control, and drawings saved with a scene layer.
export const sceneUsers = (assets, id) => assets.filter(a => !a.deleted && (a.metadata?.scene?.scene === id || a.metadata?.settings?.controls?.some(c => c.enabled && c.scene?.scene === id)));

// Opens the scene editor on the project's scenes, starting at `current` ({ scene, camera }). Resolves with the chosen scene and camera,
// plus the maps rendered from it at `size` unless `pick` only chooses a camera, or with null when closed.
export async function sceneEditor(studio, current, size, pick = false) {
    const [THREE, { OrbitControls }, { TransformControls }, { GLTFLoader }] = await loadThree();
    const scenes = studio.project.workspace.scenes ||= [];
    if (!scenes.length) scenes.push(newScene('Location 1', 'classroom'));
    let scene = scenes.find(s => s.id === current?.scene) || scenes[0], camera = scene.cameras.find(c => c.name === current?.camera) || scene.cameras[0], selected = null, view = 'shaded';
    const changed = () => studio.saveSoon();

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); renderer.setPixelRatio(1);
    const blockout = blockoutWorld(THREE, GLTFLoader), world = blockout.world, grid = new THREE.GridHelper(40, 40, 0x888888, 0xcccccc); world.add(grid);
    const eye = new THREE.PerspectiveCamera(55, size.width / size.height, 0.05, 200);
    const orbit = new OrbitControls(eye, renderer.domElement), gizmo = new TransformControls(eye, renderer.domElement); world.add(gizmo);
    function rebuild() {
        gizmo.detach(); blockout.build(scene); paint();
        const target = selected && blockout.group.children.find(g => g.userData.id === selected.id); if (target) gizmo.attach(target);
    }
    // Models show as boxes until their file has loaded.
    const loadModels = () => blockout.load(scene).then(rebuild, error => { rebuild(); studio.fail(error); });
    let files = modelFiles(studio.defs);
    function paint() { blockout.paint(view, eye, selected?.id); grid.visible = view === 'shaded' && !scene.room.walls; }
    const look = c => { eye.position.set(...c.position); orbit.target.set(...c.target); eye.fov = c.fov; eye.updateProjectionMatrix(); orbit.update(); };

    // Viewport with the drawing's aspect ratio, so the visible frame is what the layers receive.
    const stage = el('div', { class: 'amm-scene-stage' }); stage.append(renderer.domElement);
    const fit = () => {
        const r = stage.getBoundingClientRect(), scale = Math.min(r.width / size.width, r.height / size.height);
        if (scale > 0) renderer.setSize(Math.floor(size.width * scale), Math.floor(size.height * scale));
    };
    const resize = new ResizeObserver(fit); resize.observe(stage);
    let frame = requestAnimationFrame(function loop() { frame = requestAnimationFrame(loop); renderer.render(world, eye); });
    gizmo.addEventListener('dragging-changed', e => { orbit.enabled = !e.value; });
    gizmo.addEventListener('objectChange', () => {
        const g = gizmo.object; Object.assign(selected, { x: round(g.position.x), y: round(Math.max(0, g.position.y)), z: round(g.position.z), rotation: Math.round(g.rotation.y * 180 / Math.PI) });
        renderObject(); changed();
    });
    gizmo.addEventListener('mouseUp', () => rebuild());
    // A click without dragging selects the piece under the pointer; the room shell and empty space clear the selection.
    let down = null;
    renderer.domElement.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
    renderer.domElement.addEventListener('pointerup', e => {
        if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 4 || gizmo.dragging) return;
        const r = renderer.domElement.getBoundingClientRect(), ray = new THREE.Raycaster();
        ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), eye);
        const hit = ray.intersectObjects(blockout.group.children, true).find(h => h.object.isMesh);
        select(scene.objects.find(o => o.id === hit?.object.userData.id) || null);
    });

    const round = v => Math.round(v * 100) / 100;
    const number = (label, value, set, step = 0.1) => field(label, el('input', { type: 'number', step, value, 'aria-label': label, onchange: e => { set(Number(e.target.value)); rebuild(); changed(); } }));
    const scenePick = el('select', { 'aria-label': 'Scene', onchange: () => { scene = scenes.find(s => s.id === scenePick.value); selected = null; camera = scene.cameras[0]; rebuild(); look(camera); renderPanels(); loadModels(); } });
    const roomPanel = el('div'), objectsPanel = el('div'), objectPanel = el('div'), cameraPanel = el('div');
    const addPiece = el('select', { 'aria-label': 'Add piece', onchange: () => {
        if (!sceneKinds[addPiece.value]) return;
        // New pieces land on the floor where the camera is looking.
        const o = piece(addPiece.value, round(orbit.target.x), round(orbit.target.z)); addPiece.value = '';
        scene.objects.push(o); selected = o; rebuild(); renderPanels(); changed();
    } }, el('option', { value: '', text: 'Add piece…' }), ...Object.entries(sceneKinds).map(([value, k]) => el('option', { value, text: k.label })));
    const mode = segmented('Gizmo', [['translate', 'Move'], ['rotate', 'Rotate']], 'translate', value => { gizmo.setMode(value); gizmo.showX = gizmo.showZ = value === 'translate'; });
    const preview = segmented('Preview', [['shaded', 'Shaded'], ['edges', 'Edges'], ['depth', 'Depth'], ['regions', 'Regions']], view, value => { view = value; paint(); });
    const users = el('small', { role: 'status' });
    function select(o) { selected = o; rebuild(); renderObjects(); renderObject(); }
    function renderObject() {
        if (!selected) { objectPanel.replaceChildren(); return; }
        const o = selected, figure = o.kind === 'figure';
        const file = o.kind === 'model' ? el('select', { 'aria-label': 'Model file', onchange: () => { o.file = file.value; changed(); renderObjects(); loadModels(); } },
            el('option', { value: '', text: 'Choose a GLB…' }), ...files.map(name => el('option', { value: name, text: name, selected: name === o.file }))) : null;
        const upload = () => chooseFile('.glb,.gltf', async ([picked]) => studio.action(async () => {
            const form = new FormData(); form.append('image', picked, picked.name); form.append('subfolder', '3d'); form.append('type', 'input');
            const response = await api.fetchApi('/upload/image', { method: 'POST', body: form }), uploaded = await response.json();
            if (!response.ok) throw new Error(uploaded.error || 'Could not upload the 3D model.');
            o.file = uploaded.subfolder.replace(/^3d\/?/, '') ? `${uploaded.subfolder.replace(/^3d\//, '')}/${uploaded.name}` : uploaded.name;
            if (!files.includes(o.file)) files = [...files, o.file];
            changed(); renderObjects(); renderObject(); loadModels();
        }));
        objectPanel.replaceChildren(...[
            file ? [field('Model file', file, 'GLB or glTF in ComfyUI\'s input/3d folder, scaled to fit the piece\'s size.'), button('Upload GLB…', upload)] : null,
            figure ? segmented('Pose', Object.entries(figurePoses), o.pose || 'standing', value => { o.pose = value; rebuild(); changed(); }) : null,
            el('div', { class: 'amm-scene-grid' },
            ...(figure ? ['height'] : ['width', 'height', 'depth']).map(key => number(key[0].toUpperCase() + key.slice(1), o[key], v => { o[key] = Math.max(0.01, v); })),
            ...['x', 'y', 'z'].map(key => number(key.toUpperCase(), o[key], v => { o[key] = key === 'y' ? Math.max(0, v) : v; })),
            number('Rotation°', o.rotation, v => { o.rotation = v; }, 15)),
        el('div', { class: 'amm-row' }, button('Duplicate', () => { const copy = { ...o, id: uuid(), x: round(o.x + 0.5), z: round(o.z + 0.5) }; scene.objects.push(copy); select(copy); changed(); }),
            button('Delete piece', () => { scene.objects.splice(scene.objects.indexOf(o), 1); select(null); changed(); }, { class: 'amm-danger' }))].flat().filter(Boolean));
    }
    function renderObjects() {
        objectsPanel.replaceChildren(el('div', { class: 'amm-scene-list', role: 'listbox', 'aria-label': 'Scene pieces' }, ...scene.objects.map((o, i) =>
            el('button', { type: 'button', role: 'option', 'aria-selected': String(o === selected), text: `${o.kind === 'model' && o.file ? o.file.split('/').at(-1) : sceneKinds[o.kind].label} ${i + 1}`, onclick: () => select(o) }))));
    }
    function renderCameras() {
        const pick = el('select', { 'aria-label': 'Camera', onchange: () => { camera = scene.cameras[pick.selectedIndex]; look(camera); renderCameras(); } },
            ...scene.cameras.map(c => el('option', { text: c.name, selected: c === camera })));
        const fov = el('input', { type: 'number', min: 15, max: 100, step: 1, value: Math.round(eye.fov), 'aria-label': 'Field of view°', onchange: () => { eye.fov = Number(fov.value); eye.updateProjectionMatrix(); } });
        cameraPanel.replaceChildren(field('Camera', pick), field('Field of view°', fov, 'Narrow for telephoto close-ups, wide for establishing shots.'),
            el('div', { class: 'amm-row' }, button('Save view', () => { Object.assign(camera, capture(camera.name)); changed(); }),
                button('New camera', () => studio.ask('Camera name', `Camera ${scene.cameras.length + 1}`, name => { camera = capture(name); scene.cameras.push(camera); changed(); renderCameras(); })),
                scene.cameras.length > 1 ? iconButton('Delete camera', 'trash', () => { scene.cameras.splice(scene.cameras.indexOf(camera), 1); camera = scene.cameras[0]; look(camera); changed(); renderCameras(); }) : null));
    }
    const capture = name => ({ name, position: eye.position.toArray().map(round), target: orbit.target.toArray().map(round), fov: Math.round(eye.fov) });
    function renderPanels() {
        scenePick.replaceChildren(...scenes.map(s => el('option', { value: s.id, text: s.name, selected: s === scene })));
        const r = scene.room;
        roomPanel.replaceChildren(el('div', { class: 'amm-scene-grid' }, number('Room width', r.width, v => { r.width = Math.max(1, v); }, 0.5), number('Room depth', r.depth, v => { r.depth = Math.max(1, v); }, 0.5),
            number('Room height', r.height, v => { r.height = Math.max(1, v); }, 0.1)),
            el('div', { class: 'amm-row' }, toggle('Walls', el('input', { type: 'checkbox', checked: r.walls, onchange: e => { r.walls = e.target.checked; rebuild(); changed(); } })),
                toggle('Ceiling', el('input', { type: 'checkbox', checked: r.ceiling, onchange: e => { r.ceiling = e.target.checked; rebuild(); changed(); } }))));
        const used = sceneUsers(studio.project.assets, scene.id);
        users.textContent = used.length ? `Used by ${used.length} image${used.length > 1 ? 's' : ''}: ${used.slice(0, 6).map(a => a.name).join(', ')}${used.length > 6 ? '…' : ''}. Changes apply to their next generation.` : 'Not used by any panel yet.';
        renderSceneActions(); renderObjects(); renderObject(); renderCameras();
    }
    const template = el('select', { 'aria-label': 'Template' }, ...Object.entries(sceneTemplates).map(([value, t]) => el('option', { value, text: t.label })));
    const sceneActions = el('div', { class: 'amm-row' });
    const renderSceneActions = () => sceneActions.replaceChildren(
        button('New scene', () => studio.ask('Scene name', `Location ${scenes.length + 1}`, name => { scene = newScene(name, template.value); scenes.push(scene); selected = null; camera = scene.cameras[0]; rebuild(); look(camera); renderPanels(); changed(); })),
        button('Rename', () => studio.ask('Scene name', scene.name, name => { scene.name = name; renderPanels(); changed(); })),
        scenes.length > 1 ? iconButton('Delete scene', 'trash', () => { scenes.splice(scenes.indexOf(scene), 1); scene = scenes[0]; camera = scene.cameras[0]; selected = null; rebuild(); look(camera); renderPanels(); changed(); loadModels(); }) : null);
    const edges = el('input', { type: 'checkbox', checked: current?.edges ?? true }), depthMap = el('input', { type: 'checkbox', checked: current?.depth ?? false });
    const regionsMap = el('input', { type: 'checkbox', checked: current?.regions ?? true }), inkMap = el('input', { type: 'checkbox', checked: current?.ink ?? false });
    const side = el('div', { class: 'amm-scene-side' },
        el('details', { open: true }, el('summary', { text: 'Scene' }), field('Scene', scenePick, 'Scenes belong to the project, one per location, so every panel set there shares the same room.'), users, field('Template for new scenes', template), sceneActions),
        el('details', {}, el('summary', { text: 'Room' }), roomPanel),
        el('details', { open: true }, el('summary', { text: 'Pieces' }), addPiece, mode, objectsPanel, objectPanel),
        el('details', { open: true }, el('summary', { text: 'Camera' }), cameraPanel),
        el('details', { open: true }, el('summary', { text: pick ? 'Preview' : 'Layers' }), preview, pick ? null : [
            toggle('Edges → Any layer', edges, 'Black edges on white for the Any LLLite at 0.7: follows the layout and draws real furniture.'),
            toggle('Depth layer', depthMap, 'White near, black far. Holds the space more firmly; mix it lower with the edges on Turbo.'),
            toggle('Figures → Regions layer', regionsMap, 'One flat color per figure on black, in scene order (red, blue, green, yellow), for the regional LLLite. Name each figure\'s place in the prompt. Needs at least one figure.'),
            toggle('Ink layer', inkMap, 'The scene\'s lines on a transparent drawing layer, to trace or keep as background lines. It is part of the drawing, unlike control layers.')]));
    // The editor helpers stay out of the rendered layers.
    function render(mode) {
        gizmo.visible = grid.visible = false; const url = shoot(THREE, blockout, eye, size, mode);
        gizmo.visible = true; paint(); return url;
    }
    return new Promise(resolve => {
        let applied = false;
        const apply = button(pick ? 'Use this camera' : 'Apply to layers', () => {
            const regions = regionsMap.checked && scene.objects.some(o => o.kind === 'figure'), layers = { edges: edges.checked, depth: depthMap.checked, regions, ink: inkMap.checked };
            if (!pick && !Object.values(layers).some(Boolean)) { studio.fail(new Error('Choose at least one layer to render.')); return; }
            Object.assign(camera, capture(camera.name)); changed(); applied = true;
            resolve(pick ? { scene: scene.id, camera: camera.name } : { scene: scene.id, camera: camera.name, ...layers, regions: regionsMap.checked,
                maps: Object.fromEntries(Object.entries(layers).filter(([, on]) => on).map(([map]) => [map, render(map)])) });
            dialog.close();
        }, { class: 'amm-primary' });
        const dialog = studio.modal('Scene · 3D blockout', el('div', { class: 'amm-scene-body' }, stage, side), apply);
        dialog.classList.add('amm-scene-dialog');
        dialog.addEventListener('close', () => {
            cancelAnimationFrame(frame); resize.disconnect(); gizmo.dispose(); orbit.dispose(); blockout.dispose(); renderer.dispose();
            if (!applied) resolve(null);
        });
        rebuild(); look(camera); renderPanels(); fit(); loadModels();
    });
}
