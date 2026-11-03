import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

// A 2 × 1 × 1 m crate as a binary glTF: eight corners and twelve triangles.
function crateGlb() {
    const positions = new Float32Array([-1, 0, -0.5, 1, 0, -0.5, 1, 1, -0.5, -1, 1, -0.5, -1, 0, 0.5, 1, 0, 0.5, 1, 1, 0.5, -1, 1, 0.5]);
    const indices = new Uint16Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 7, 6, 3, 6, 2, 0, 4, 7, 0, 7, 3, 1, 2, 6, 1, 6, 5]);
    const bin = Buffer.concat([Buffer.from(positions.buffer), Buffer.from(indices.buffer)]), padded = Buffer.concat([bin, Buffer.alloc((4 - bin.length % 4) % 4)]);
    const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
        buffers: [{ byteLength: padded.length }], bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 96 }, { buffer: 0, byteOffset: 96, byteLength: 72 }],
        accessors: [{ bufferView: 0, componentType: 5126, count: 8, type: 'VEC3', min: [-1, 0, -0.5], max: [1, 1, 0.5] }, { bufferView: 1, componentType: 5123, count: 36, type: 'SCALAR' }] }));
    const text = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
    const chunk = (type, data) => { const head = Buffer.alloc(8); head.writeUInt32LE(data.length, 0); head.writeUInt32LE(type, 4); return Buffer.concat([head, data]); };
    const body = Buffer.concat([chunk(0x4e4f534a, text), chunk(0x004e4942, padded)]), header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + body.length, 8);
    return Buffer.concat([header, body]);
}
const require = createRequire(import.meta.url), { chromium } = require(process.argv[2]);
const root = path.resolve(import.meta.dirname, '..');
const fixture = spawn(process.argv[3], [path.join(root, 'tests/browser_backend.py')], { stdio: ['ignore', 'pipe', 'pipe'] });
fixture.stderr.on('data', b => process.stderr.write(b));
const [chunk] = await once(fixture.stdout, 'data'), backend = JSON.parse(chunk.toString());
const defs = process.argv[4] ? JSON.parse(await fs.readFile(process.argv[4], 'utf8')) : await (await fetch((process.env.COMFY_URL || 'http://127.0.0.1:8188') + '/object_info')).json();
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const queued = [], uploads = [], cancellations = []; let hold = false;
try {
    if (process.argv[4]) await page.route(/\/(?:api\/)?object_info(?:\?.*)?$/, route => route.fulfill({ json: defs }));
    await page.addInitScript(({ project }) => { localStorage.setItem('amm-project', project); localStorage.setItem('amm-space', 'panels'); }, { project: backend.project });
    await page.route('**/extensions/ComfyUI-AnimaMangaMakerStudio/**', async route => {
        const name = new URL(route.request().url()).pathname.split('/').at(-1);
        await route.fulfill({ body: await fs.readFile(path.join(root, 'web', name)), contentType: name.endsWith('.css') ? 'text/css' : 'application/javascript' });
    });
    await page.route(/\/extensions\/?(?:\?.*)?$/, async route => {
        const response = await route.fetch(), list = await response.json();
        if (!list.includes('/extensions/ComfyUI-AnimaMangaMakerStudio/extension.js')) list.push('/extensions/ComfyUI-AnimaMangaMakerStudio/extension.js');
        await route.fulfill({ json: list });
    });
    await page.route(/\/(?:api\/)?anima-manga-maker\//, async route => {
        const url = new URL(route.request().url()), pathname = url.pathname.replace(/^\/api\//, '/');
        // ComfyUI serves every response with COEP; the Klecks iframe is blocked inside the Studio page without it.
        const response = await route.fetch({ url: backend.url + pathname + url.search });
        await route.fulfill({ response, headers: { ...response.headers(), 'cross-origin-embedder-policy': 'credentialless' } });
    });
    await page.route(/\/(?:api\/)?upload\/image$/, async route => {
        const response = await route.fetch({ url: `${backend.url}/test/upload` }); const uploaded = await response.json(); uploads.push(uploaded);
        await route.fulfill({ json: uploaded });
    });
    await page.route(/\/(?:api\/)?view\?/, async route => {
        await route.fulfill({ response: await route.fetch({ url: `${backend.url}/test/view${new URL(route.request().url()).search}` }) });
    });
    await page.route(/\/(?:api\/)?(?:queue|interrupt)$/, async route => {
        if (route.request().method() !== 'POST') return route.fallback();
        const endpoint = new URL(route.request().url()).pathname.split('/').at(-1), body = route.request().postDataJSON(); cancellations.push({ endpoint, body });
        const response = await fetch(`${backend.url}/test/${endpoint}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        await route.fulfill({ json: await response.json() });
    });
    await page.route(url => /^\/(?:api\/)?prompt$/.test(new URL(url).pathname), async route => {
        if (route.request().method() !== 'POST') return route.fallback();
        const body = route.request().postDataJSON(); queued.push(body);
        const response = await fetch(`${backend.url}/test/${hold ? 'enqueue' : 'complete'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        await route.fulfill({ json: await response.json() });
        // Studio jobs are polled; the Manga-Lite live preview waits for ComfyUI's completion event instead.
        if (!body.extra_data && !hold) await page.evaluate(id => window.comfyAPI.api.api.dispatchCustomEvent('execution_success', { prompt_id: id }), body.prompt_id);
    });
    await page.route(/\/(?:api\/)?history\/[\w-]+$/, async route => {
        await route.fulfill({ response: await route.fetch({ url: `${backend.url}/test/history/${new URL(route.request().url()).pathname.split('/').at(-1)}` }) });
    });
    await page.goto(process.env.COMFY_URL || 'http://127.0.0.1:8188', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.comfyAPI?.app?.app?.graph && window.comfyAPI.app.app.extensions.some(e => e.name === 'AnimaMangaMaker.Studio'));
    await page.waitForTimeout(2500);
    // The last workflow can finish loading after the app reports ready; snapshot the graph once it stops changing.
    for (let previous = ''; ;) {
        const current = await page.evaluate(() => JSON.stringify(window.comfyAPI.app.app.graph.serialize()));
        if (current === previous) break;
        previous = current; await page.waitForTimeout(1500);
    }
    const graphBefore = await page.evaluate(() => {
        const app = window.comfyAPI.app.app, graph = app.graph.serialize();
        app.extensions.find(e => e.name === 'AnimaMangaMaker.Studio').commands[0].function(); return graph;
    });
    const studio = page.locator('.amm-studio'); await studio.waitFor();
    const segment = (scope, label) => scope.getByRole('radiogroup', { name: label, exact: true });
    const choose = (scope, label, value) => segment(scope, label).locator(`input[value="${value}"]`).check();
    const chosen = (scope, label) => segment(scope, label).locator('input:checked').inputValue();
    const out = process.env.SCENE_CAPTURE;
    await studio.getByRole('button', { name: 'Draw panel', exact: true }).click();
    const setup = studio.getByRole('dialog', { name: 'New panel drawing', exact: true });
    await setup.getByLabel('Drawing name', { exact: true }).fill('Scene test');
    await setup.getByRole('button', { name: '3:2', exact: true }).click();
    await setup.getByLabel('Resolution · MP', { exact: true }).fill('1');
    await setup.getByRole('button', { name: 'Start drawing', exact: true }).click();
    const dialog = studio.getByRole('dialog', { name: 'Draw panel · Klecks', exact: true });
    const frame = await (await dialog.locator('iframe').elementHandle()).contentFrame();
    await frame.locator('.g-root:not(.top-overlay)').waitFor();
    const controls = dialog.getByRole('complementary', { name: 'Sketch to Art controls', exact: true });
    await controls.locator('summary').filter({ hasText: /^Control layers$/ }).click();
    await page.waitForTimeout(1000);
    await controls.getByRole('button', { name: 'Build scene…', exact: true }).click();
    const sceneDialog = studio.getByRole('dialog', { name: 'Scene · 3D blockout', exact: true });
    // The first scene of a project starts from the classroom template with its two cameras.
    await sceneDialog.getByLabel('Camera', { exact: true }).waitFor();
    assert.deepEqual(await sceneDialog.getByLabel('Camera', { exact: true }).locator('option').allTextContents(), ['Back corner', 'Low front']);
    await sceneDialog.getByLabel('Camera', { exact: true }).selectOption('Low front');
    const list = sceneDialog.getByRole('listbox', { name: 'Scene pieces' }), pieces = await list.getByRole('option').count();
    // New pieces land where the camera looks; X moves each one.
    const add = async (kind, x) => {
        await sceneDialog.getByLabel('Add piece', { exact: true }).selectOption(kind);
        if (x !== undefined) { await sceneDialog.getByLabel('X', { exact: true }).fill(String(x)); await sceneDialog.getByLabel('X', { exact: true }).dispatchEvent('change'); }
    };
    await add('stairs', 3); await add('figure', 1.2); await add('figure', 2.6);
    await sceneDialog.getByRole('radiogroup', { name: 'Pose', exact: true }).locator('input[value="sitting"]').check();
    await add('model', 0.2);
    assert.equal(await list.getByRole('option').count(), pieces + 4);
    // A GLB uploaded from the computer goes to input/3d and loads into the scene.
    const chooser = page.waitForEvent('filechooser');
    await sceneDialog.getByRole('button', { name: 'Upload GLB…', exact: true }).click();
    await (await chooser).setFiles({ name: 'scene-crate.glb', mimeType: 'model/gltf-binary', buffer: crateGlb() });
    await list.getByRole('option', { name: /^scene-crate\.glb \d+$/ }).waitFor();
    await sceneDialog.getByRole('switch', { name: 'Depth layer' }).check();
    await sceneDialog.getByRole('switch', { name: 'Ink layer' }).check();
    assert(await sceneDialog.getByRole('switch', { name: 'Figures → Regions layer' }).isChecked(), 'Regions are on by default');
    await page.waitForTimeout(800);
    await page.screenshot({ path: '/tmp/manga-scene-editor.png' });
    await sceneDialog.getByRole('button', { name: 'Apply to layers', exact: true }).click(); await sceneDialog.waitFor({ state: 'detached' });
    const layer = name => frame.evaluate(async name => {
        const l = (await editor.readPSD(await (await editor.getPSD()).arrayBuffer())).layers.find(l => l.name === name);
        const data = l.image.getContext('2d').getImageData(0, 0, l.image.width, l.image.height).data; let dark = 0, light = 0, mid = 0, clear = 0; const colors = {};
        for (let i = 0; i < data.length; i += 4) {
            if (!data[i + 3]) { clear++; continue; }
            const v = data[i]; if (v < 60) dark++; else if (v > 200) light++; else mid++;
            const key = `${data[i]},${data[i + 1]},${data[i + 2]}`; colors[key] = (colors[key] || 0) + 1;
        }
        return { width: l.image.width, height: l.image.height, dark, light, mid, clear, colors, url: l.image.toDataURL('image/png') };
    }, name);
    await page.waitForTimeout(1500);
    const edges = await layer('Control · Scene edges'), depth = await layer('Control · Scene depth'), regions = await layer('Control · Scene regions'), ink = await layer('Scene ink'), total = edges.width * edges.height;
    if (out) for (const [name, l] of Object.entries({ edges, depth, regions, ink })) await fs.writeFile(`${out}_${name}.png`, Buffer.from(l.url.split(',')[1], 'base64'));
    // Figures are one flat region each, red then blue, on black, and stay out of the other maps.
    assert(regions.colors['255,64,64'] > 2000 && regions.colors['64,128,255'] > 500, `Two flat figure regions: ${JSON.stringify(Object.entries(regions.colors).sort((a, b) => b[1] - a[1]).slice(0, 4))}`);
    assert.equal(Object.keys(regions.colors).length, 3, 'Regions hold only black, red and blue');
    assert(ink.clear > total * 0.9 && ink.dark > total * 0.001, `Ink lines on transparency: ${ink.dark} dark, ${ink.clear} clear`);
    assert(edges.width > edges.height && depth.width === edges.width, `Layers fill the 3:2 canvas: ${edges.width}x${edges.height}`);
    assert(edges.light > total * 0.8 && edges.dark > total * 0.002, `Black edges on white: ${edges.dark} dark of ${total}`);
    assert(depth.mid > total * 0.5, `Grey depth gradient: ${depth.mid} mid-grey of ${total}`);
    const project = async () => (await fetch(`${backend.url}/anima-manga-maker/projects/${backend.project}`)).json();
    const workspace = (await project()).workspace;
    const added = workspace.scenes[0].objects.slice(-4);
    assert.equal(workspace.scenes.length, 1); assert.deepEqual(added.map(o => [o.kind, o.x]), [['stairs', 3], ['figure', 1.2], ['figure', 2.6], ['model', 0.2]]);
    assert.equal(added[2].pose, 'sitting'); assert.equal(added[3].file, 'scene-crate.glb');
    assert.deepEqual(workspace.drawing_panels.control_layers.map(c => [c.name, c.type, c.strength, c.end]), [['Control · Scene edges', 'anytest', 0.7, 1], ['Control · Scene depth', 'depth', 1, 1], ['Control · Scene regions', 'regional', 1, 0.3]]);
    // The drawing keeps its own scene and camera.
    await dialog.getByRole('button', { name: 'Save to project', exact: true }).click();
    await dialog.getByText('Saved to project · Layers preserved', { exact: true }).waitFor();
    const drawing = (await project()).assets.find(a => a.name === 'Scene test');
    assert.deepEqual({ ...drawing.metadata.scene, scene: typeof drawing.metadata.scene.scene }, { scene: 'string', camera: 'Low front', edges: true, depth: true, regions: true, ink: true });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click(); await dialog.waitFor({ state: 'detached' });
    // Reopening it starts from that camera, lists the drawing as a user of the scene, and a new render replaces the layers.
    const card = studio.locator(`.amm-panels [data-asset-id="${drawing.id}"]`).first();
    await card.getByRole('button', { name: 'Image actions', exact: true }).click();
    await card.getByRole('menuitem', { name: 'Draw with Klecks', exact: true }).click();
    const reopened = await (await dialog.locator('iframe').elementHandle()).contentFrame();
    await reopened.locator('.g-root:not(.top-overlay)').waitFor(); await page.waitForTimeout(1500);
    await controls.locator('summary').filter({ hasText: /^Control layers$/ }).click();
    await controls.getByRole('button', { name: 'Build scene…', exact: true }).click();
    assert.equal(await sceneDialog.getByLabel('Camera', { exact: true }).inputValue(), 'Low front');
    await sceneDialog.getByText('Used by 1 image: Scene test. Changes apply to their next generation.', { exact: true }).waitFor();
    await sceneDialog.getByRole('button', { name: 'Apply to layers', exact: true }).click(); await sceneDialog.waitFor({ state: 'detached' });
    await page.waitForTimeout(1000);
    assert.equal((await project()).workspace.drawing_panels.control_layers.length, 3);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await studio.getByRole('dialog', { name: 'Discard unsaved drawing?', exact: true }).getByRole('button', { name: 'Discard changes', exact: true }).click();

    // Panels: an Any control takes the Back corner camera; each generation renders it at the output size and stages it.
    const view = studio.locator('.amm-panels');
    const stack = view.locator('details').filter({ has: page.getByLabel('Add control', { exact: true, includeHidden: true }) });
    await stack.locator('summary').click();
    await stack.getByLabel('Add control', { exact: true }).selectOption('anytest');
    await stack.getByRole('button', { name: 'From scene…', exact: true }).click();
    await sceneDialog.getByLabel('Camera', { exact: true }).waitFor();
    assert.equal(await sceneDialog.getByRole('switch', { name: 'Depth layer' }).count(), 0, 'Choosing a camera renders no layers');
    await sceneDialog.getByLabel('Camera', { exact: true }).selectOption('Back corner');
    await sceneDialog.getByRole('button', { name: 'Use this camera', exact: true }).click(); await sceneDialog.waitFor({ state: 'detached' });
    await stack.getByText('Scene · Location 1 · Back corner · edges', { exact: true }).waitFor();
    const before = queued.length, uploaded = uploads.length;
    await view.getByRole('button', { name: 'Generate panel', exact: true }).click();
    for (let i = 0; i < 60 && queued.length === before; i++) await page.waitForTimeout(100);
    assert.equal(queued.length, before + 1, await studio.locator('.amm-error').textContent());
    const graph = queued.at(-1).prompt, lllite = Object.values(graph).find(n => n.class_type === 'AnimaLLLiteApply');
    assert.equal(graph[lllite.inputs.model_patch[0]].inputs.name, 'anima-lllite-any-test-like-v2.safetensors');
    assert.match(graph[lllite.inputs.image[0]].inputs.image, new RegExp(`^anima-manga-maker-drawing/${backend.project}/scene-[0-9a-f]+\\.png \\[temp\\]$`));
    assert.equal(uploads.length, uploaded + 1);
    if (out) { const u = uploads.at(-1); await fs.writeFile(`${out}_panel.png`, Buffer.from(await (await fetch(`${backend.url}/test/view?${new URLSearchParams({ filename: u.name, subfolder: u.subfolder })}`)).arrayBuffer())); }
    // The panel's settings keep the scene control, so it counts as a user of the scene.
    await page.waitForTimeout(2500);
    const panel = (await project()).assets.find(a => a.metadata?.settings?.controls?.some(c => c.scene));
    assert(panel, 'The generated panel keeps the scene control in its settings');
    assert.deepEqual(panel.metadata.settings.controls.find(c => c.scene).scene, { scene: workspace.scenes[0].id, camera: 'Back corner' });
    assert.deepEqual(errors, []);
    console.log(`Scene passed: classroom blockout with stairs, an uploaded GLB and two figures rendered into edge (${edges.dark} ink px), depth, regions and ink layers; the drawing keeps its scene and camera on reopen; a panel control renders its scene camera on every generation and its result counts as a user of the scene.`);
} catch (error) {
    await page.screenshot({ path: '/tmp/manga-scene-error.png' }); console.error((await page.locator('.amm-studio').innerText().catch(() => 'Studio closed')).slice(-4000), errors); throw error;
} finally {
    await page.unrouteAll({ behavior: 'wait' }); await browser.close(); fixture.kill();
}
