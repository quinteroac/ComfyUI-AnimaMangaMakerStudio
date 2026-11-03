import { api } from '../../scripts/api.js';
import { el, button, field, iconButton, uuid } from './client.js';
import { segmented, toggle } from './controls.js';

// Blockout pieces. Sizes are meters (width, height, depth); `y` is the base elevation and `rotation` turns around the vertical axis.
export const sceneKinds = {
    box: { label: 'Box', size: [1, 1, 1] },
    cylinder: { label: 'Cylinder', size: [0.8, 1, 0.8] },
    stairs: { label: 'Stairs', size: [1.2, 1.5, 2.4] },
    ramp: { label: 'Ramp', size: [1.2, 0.8, 2] },
    panel: { label: 'Panel', size: [2, 2, 0.05] },
    door: { label: 'Door', size: [1, 2.1, 0.05] },
    window: { label: 'Window', size: [1, 1.5, 0.04] },
};

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

const loadThree = () => Promise.all(['three.module.js', 'OrbitControls.js', 'TransformControls.js'].map(file => import(api.apiURL('/anima-manga-maker/drawing/three/') + file)));

// A scene's room and pieces as meshes with black edge children. One material per view is swapped onto every mesh.
function blockoutWorld(THREE) {
    const world = new THREE.Scene(), group = new THREE.Group(); world.add(group);
    world.add(new THREE.HemisphereLight(0xffffff, 0x8890a0, 2.2)); const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(4, 8, 5); world.add(sun);
    const depth = new THREE.ShaderMaterial({ uniforms: { near: { value: 0.3 }, far: { value: 14 } },
        vertexShader: 'varying float d; void main(){ vec4 p = modelViewMatrix * vec4(position, 1.0); d = -p.z; gl_Position = projectionMatrix * p; }',
        fragmentShader: 'uniform float near; uniform float far; varying float d; void main(){ float v = 1.0 - clamp((d - near) / (far - near), 0.0, 1.0); gl_FragColor = vec4(v, v, v, 1.0); }' });
    const materials = { shaded: new THREE.MeshStandardMaterial({ color: 0xd8d4cc, roughness: 1, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
        picked: new THREE.MeshStandardMaterial({ color: 0xf2b866, roughness: 1, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }),
        edges: new THREE.MeshBasicMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }), depth };
    const ink = new THREE.LineBasicMaterial({ color: 0x000000 });
    const mesh = (geometry, x, y, z, id) => {
        const m = new THREE.Mesh(geometry); m.position.set(x, y, z); m.userData.id = id;
        m.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 20), ink)); return m;
    };
    function buildPiece(o) {
        const piece = new THREE.Group(), { width: w, height: h, depth: d } = o; piece.userData.id = o.id;
        if (o.kind === 'cylinder') { const g = new THREE.CylinderGeometry(0.5, 0.5, 1, 24); g.scale(w, h, d); piece.add(mesh(g, 0, h / 2, 0, o.id)); }
        else if (o.kind === 'stairs') {
            const steps = Math.max(2, Math.round(h / 0.18));
            for (let i = 0; i < steps; i++) piece.add(mesh(new THREE.BoxGeometry(w, h * (i + 1) / steps, d / steps), 0, h * (i + 1) / steps / 2, d / 2 - d * (i + 0.5) / steps, o.id));
        } else if (o.kind === 'ramp') {
            const shape = new THREE.Shape([new THREE.Vector2(-d / 2, 0), new THREE.Vector2(d / 2, 0), new THREE.Vector2(-d / 2, h)]);
            const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false }); g.rotateY(Math.PI / 2); g.translate(-w / 2, 0, 0); piece.add(mesh(g, 0, 0, 0, o.id));
        } else piece.add(mesh(new THREE.BoxGeometry(w, h, d), 0, h / 2, 0, o.id));
        piece.position.set(o.x, o.y, o.z); piece.rotation.y = o.rotation * Math.PI / 180; return piece;
    }
    const clear = () => { for (const child of [...group.children]) { group.remove(child); child.traverse(c => c.geometry?.dispose()); } };
    return {
        world, group,
        build(scene) {
            clear();
            const { width: w, depth: d, height: h, walls, ceiling } = scene.room, t = 0.1;
            const shell = new THREE.Group(); shell.userData.id = null;
            shell.add(mesh(new THREE.BoxGeometry(w, t, d), 0, -t / 2, 0, null));
            if (ceiling) shell.add(mesh(new THREE.BoxGeometry(w, t, d), 0, h + t / 2, 0, null));
            if (walls) for (const [x, z, sx, sz] of [[0, -d / 2, w, t], [0, d / 2, w, t], [-w / 2, 0, t, d], [w / 2, 0, t, d]]) shell.add(mesh(new THREE.BoxGeometry(sx, h, sz), x, h / 2, z, null));
            group.add(shell);
            for (const o of scene.objects) group.add(buildPiece(o));
        },
        paint(mode, eye, picked = null) {
            group.traverse(c => {
                if (c.isLineSegments) c.visible = mode !== 'depth';
                else if (c.isMesh) c.material = mode === 'shaded' && picked && c.userData.id === picked ? materials.picked : materials[mode];
            });
            world.background = new THREE.Color({ shaded: 0x2b2f36, edges: 0xffffff, depth: 0x000000 }[mode]);
            if (mode === 'depth') {
                // Linear depth from just in front of the camera to the farthest corner of the blockout.
                const box = new THREE.Box3().setFromObject(group), corners = [0, 1, 2, 3, 4, 5, 6, 7].map(i => new THREE.Vector3(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z));
                depth.uniforms.far.value = Math.max(1, ...corners.map(c => c.distanceTo(eye.position)));
            }
        },
        dispose() { clear(); Object.values(materials).forEach(m => m.dispose()); ink.dispose(); },
    };
}

// Renders one view of the world at `size` as a PNG data URL.
function shoot(THREE, view, eye, size, mode) {
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); renderer.setPixelRatio(1); renderer.setSize(size.width, size.height, false);
    const lens = eye.clone(); lens.aspect = size.width / size.height; lens.updateProjectionMatrix();
    view.paint(mode, lens); renderer.render(view.world, lens); const url = renderer.domElement.toDataURL('image/png'); renderer.dispose(); return url;
}

const lensFor = (THREE, c, size) => { const eye = new THREE.PerspectiveCamera(c.fov, size.width / size.height, 0.05, 200); eye.position.set(...c.position); eye.lookAt(...c.target); return eye; };

// A scene camera rendered as `edges` or `depth` at `size`, exactly as Apply to layers renders it.
export async function renderScene(scene, cameraName, size, map) {
    const camera = scene.cameras.find(c => c.name === cameraName);
    if (!camera) throw new Error(`Camera "${cameraName}" is no longer in the scene "${scene.name}". Choose another camera for the control.`);
    const [THREE] = await loadThree(), view = blockoutWorld(THREE); view.build(scene);
    try { return shoot(THREE, view, lensFor(THREE, camera, size), size, map); } finally { view.dispose(); }
}

// Images that used a scene: panel results whose settings hold a scene control, and drawings saved with a scene layer.
export const sceneUsers = (assets, id) => assets.filter(a => !a.deleted && (a.metadata?.scene?.scene === id || a.metadata?.settings?.controls?.some(c => c.enabled && c.scene?.scene === id)));

// Opens the scene editor on the project's scenes, starting at `current` ({ scene, camera }). Resolves with the chosen scene and camera,
// plus the maps rendered from it at `size` unless `pick` only chooses a camera, or with null when closed.
export async function sceneEditor(studio, current, size, pick = false) {
    const [THREE, { OrbitControls }, { TransformControls }] = await loadThree();
    const scenes = studio.project.workspace.scenes ||= [];
    if (!scenes.length) scenes.push(newScene('Location 1', 'classroom'));
    let scene = scenes.find(s => s.id === current?.scene) || scenes[0], camera = scene.cameras.find(c => c.name === current?.camera) || scene.cameras[0], selected = null, view = 'shaded';
    const changed = () => studio.saveSoon();

    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); renderer.setPixelRatio(1);
    const blockout = blockoutWorld(THREE), world = blockout.world, grid = new THREE.GridHelper(40, 40, 0x888888, 0xcccccc); world.add(grid);
    const eye = new THREE.PerspectiveCamera(55, size.width / size.height, 0.05, 200);
    const orbit = new OrbitControls(eye, renderer.domElement), gizmo = new TransformControls(eye, renderer.domElement); world.add(gizmo);
    function rebuild() {
        gizmo.detach(); blockout.build(scene); paint();
        const target = selected && blockout.group.children.find(g => g.userData.id === selected.id); if (target) gizmo.attach(target);
    }
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
    const scenePick = el('select', { 'aria-label': 'Scene', onchange: () => { scene = scenes.find(s => s.id === scenePick.value); selected = null; camera = scene.cameras[0]; rebuild(); look(camera); renderPanels(); } });
    const roomPanel = el('div'), objectsPanel = el('div'), objectPanel = el('div'), cameraPanel = el('div');
    const addPiece = el('select', { 'aria-label': 'Add piece', onchange: () => {
        if (!sceneKinds[addPiece.value]) return;
        // New pieces land on the floor where the camera is looking.
        const o = piece(addPiece.value, round(orbit.target.x), round(orbit.target.z)); addPiece.value = '';
        scene.objects.push(o); selected = o; rebuild(); renderPanels(); changed();
    } }, el('option', { value: '', text: 'Add piece…' }), ...Object.entries(sceneKinds).map(([value, k]) => el('option', { value, text: k.label })));
    const mode = segmented('Gizmo', [['translate', 'Move'], ['rotate', 'Rotate']], 'translate', value => { gizmo.setMode(value); gizmo.showX = gizmo.showZ = value === 'translate'; });
    const preview = segmented('Preview', [['shaded', 'Shaded'], ['edges', 'Edges'], ['depth', 'Depth']], view, value => { view = value; paint(); });
    const users = el('small', { role: 'status' });
    function select(o) { selected = o; rebuild(); renderObjects(); renderObject(); }
    function renderObject() {
        if (!selected) { objectPanel.replaceChildren(); return; }
        const o = selected;
        objectPanel.replaceChildren(el('div', { class: 'amm-scene-grid' },
            ...['width', 'height', 'depth'].map(key => number(key[0].toUpperCase() + key.slice(1), o[key], v => { o[key] = Math.max(0.01, v); })),
            ...['x', 'y', 'z'].map(key => number(key.toUpperCase(), o[key], v => { o[key] = key === 'y' ? Math.max(0, v) : v; })),
            number('Rotation°', o.rotation, v => { o.rotation = v; }, 15)),
        el('div', { class: 'amm-row' }, button('Duplicate', () => { const copy = { ...o, id: uuid(), x: round(o.x + 0.5), z: round(o.z + 0.5) }; scene.objects.push(copy); select(copy); changed(); }),
            button('Delete piece', () => { scene.objects.splice(scene.objects.indexOf(o), 1); select(null); changed(); }, { class: 'amm-danger' })));
    }
    function renderObjects() {
        objectsPanel.replaceChildren(el('div', { class: 'amm-scene-list', role: 'listbox', 'aria-label': 'Scene pieces' }, ...scene.objects.map((o, i) =>
            el('button', { type: 'button', role: 'option', 'aria-selected': String(o === selected), text: `${sceneKinds[o.kind].label} ${i + 1}`, onclick: () => select(o) }))));
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
        scenes.length > 1 ? iconButton('Delete scene', 'trash', () => { scenes.splice(scenes.indexOf(scene), 1); scene = scenes[0]; camera = scene.cameras[0]; selected = null; rebuild(); look(camera); renderPanels(); changed(); }) : null);
    const edges = el('input', { type: 'checkbox', checked: current?.edges ?? true }), depthMap = el('input', { type: 'checkbox', checked: current?.depth ?? false });
    const side = el('div', { class: 'amm-scene-side' },
        el('details', { open: true }, el('summary', { text: 'Scene' }), field('Scene', scenePick, 'Scenes belong to the project, one per location, so every panel set there shares the same room.'), users, field('Template for new scenes', template), sceneActions),
        el('details', {}, el('summary', { text: 'Room' }), roomPanel),
        el('details', { open: true }, el('summary', { text: 'Pieces' }), addPiece, mode, objectsPanel, objectPanel),
        el('details', { open: true }, el('summary', { text: 'Camera' }), cameraPanel),
        el('details', { open: true }, el('summary', { text: pick ? 'Preview' : 'Layers' }), preview, pick ? null : [
            toggle('Edges → Any layer', edges, 'Black edges on white for the Any LLLite at 0.7: follows the layout and draws real furniture.'),
            toggle('Depth layer', depthMap, 'White near, black far. Holds the space more firmly; mix it lower with the edges on Turbo.')]));
    // The editor helpers stay out of the rendered layers.
    function render(mode) {
        gizmo.visible = grid.visible = false; const url = shoot(THREE, blockout, eye, size, mode);
        gizmo.visible = true; paint(); return url;
    }
    return new Promise(resolve => {
        let applied = false;
        const apply = button(pick ? 'Use this camera' : 'Apply to layers', () => {
            if (!pick && !edges.checked && !depthMap.checked) { studio.fail(new Error('Choose at least one layer to render.')); return; }
            Object.assign(camera, capture(camera.name)); changed(); applied = true;
            resolve(pick ? { scene: scene.id, camera: camera.name } : { scene: scene.id, camera: camera.name, edges: edges.checked, depth: depthMap.checked,
                maps: { ...(edges.checked ? { edges: render('edges') } : {}), ...(depthMap.checked ? { depth: render('depth') } : {}) } });
            dialog.close();
        }, { class: 'amm-primary' });
        const dialog = studio.modal('Scene · 3D blockout', el('div', { class: 'amm-scene-body' }, stage, side), apply);
        dialog.classList.add('amm-scene-dialog');
        dialog.addEventListener('close', () => {
            cancelAnimationFrame(frame); resize.disconnect(); gizmo.dispose(); orbit.dispose(); blockout.dispose(); renderer.dispose();
            if (!applied) resolve(null);
        });
        rebuild(); look(camera); renderPanels(); fit();
    });
}
