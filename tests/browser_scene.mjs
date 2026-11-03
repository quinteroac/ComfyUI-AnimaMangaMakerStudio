import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

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
    const pieces = await sceneDialog.getByRole('listbox', { name: 'Scene pieces' }).getByRole('option').count();
    await sceneDialog.getByLabel('Add piece', { exact: true }).selectOption('stairs');
    assert.equal(await sceneDialog.getByRole('listbox', { name: 'Scene pieces' }).getByRole('option').count(), pieces + 1);
    await sceneDialog.getByLabel('X', { exact: true }).fill('3'); await sceneDialog.getByLabel('X', { exact: true }).dispatchEvent('change');
    await sceneDialog.getByLabel('Camera', { exact: true }).selectOption('Low front');
    await sceneDialog.getByRole('switch', { name: 'Depth layer' }).check();
    await page.waitForTimeout(500);
    await page.screenshot({ path: '/tmp/manga-scene-editor.png' });
    await sceneDialog.getByRole('button', { name: 'Apply to layers', exact: true }).click(); await sceneDialog.waitFor({ state: 'detached' });
    const layer = name => frame.evaluate(async name => {
        const l = (await editor.readPSD(await (await editor.getPSD()).arrayBuffer())).layers.find(l => l.name === name);
        const data = l.image.getContext('2d').getImageData(0, 0, l.image.width, l.image.height).data; let dark = 0, light = 0, mid = 0;
        for (let i = 0; i < data.length; i += 4) { const v = data[i]; if (v < 60) dark++; else if (v > 200) light++; else mid++; }
        return { width: l.image.width, height: l.image.height, dark, light, mid, url: l.image.toDataURL('image/png') };
    }, name);
    await page.waitForTimeout(1500);
    const edges = await layer('Control · Scene edges'), depth = await layer('Control · Scene depth'), total = edges.width * edges.height;
    if (out) { await fs.writeFile(`${out}_edges.png`, Buffer.from(edges.url.split(',')[1], 'base64')); await fs.writeFile(`${out}_depth.png`, Buffer.from(depth.url.split(',')[1], 'base64')); }
    assert(edges.width > edges.height && depth.width === edges.width, `Layers fill the 3:2 canvas: ${edges.width}x${edges.height}`);
    assert(edges.light > total * 0.8 && edges.dark > total * 0.002, `Black edges on white: ${edges.dark} dark of ${total}`);
    assert(depth.mid > total * 0.5, `Grey depth gradient: ${depth.mid} mid-grey of ${total}`);
    const saved = (await (await fetch(`${backend.url}/anima-manga-maker/projects/${backend.project}`)).json()).workspace;
    assert.equal(saved.scenes.length, 1); assert.equal(saved.scenes[0].objects.at(-1).kind, 'stairs'); assert.equal(saved.scenes[0].objects.at(-1).x, 3);
    assert.deepEqual({ ...saved.drawing_panels.scene, scene: undefined }, { scene: undefined, camera: 'Low front', edges: true, depth: true });
    const rows = saved.drawing_panels.control_layers;
    assert.deepEqual(rows.map(c => [c.name, c.type, c.strength]), [['Control · Scene edges', 'anytest', 0.7], ['Control · Scene depth', 'depth', 1]]);
    // Reopening keeps the location and camera; a second render replaces the layers instead of adding more.
    await controls.getByRole('button', { name: 'Build scene…', exact: true }).click();
    assert.equal(await sceneDialog.getByLabel('Camera', { exact: true }).inputValue(), 'Low front');
    await sceneDialog.getByRole('button', { name: 'Apply to layers', exact: true }).click(); await sceneDialog.waitFor({ state: 'detached' });
    await page.waitForTimeout(1000);
    assert.equal((await (await fetch(`${backend.url}/anima-manga-maker/projects/${backend.project}`)).json()).workspace.drawing_panels.control_layers.length, 2);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await studio.getByRole('dialog', { name: 'Discard unsaved drawing?', exact: true }).getByRole('button', { name: 'Discard changes', exact: true }).click();
    assert.deepEqual(errors, []);
    console.log(`Scene passed: classroom blockout edited, rendered from a saved camera into edge (${edges.dark} ink px) and depth layers, scene and camera kept, re-render replaces layers.`);
} catch (error) {
    await page.screenshot({ path: '/tmp/manga-scene-error.png' }); console.error((await page.locator('.amm-studio').innerText().catch(() => 'Studio closed')).slice(-4000), errors); throw error;
} finally {
    await page.unrouteAll({ behavior: 'wait' }); await browser.close(); fixture.kill();
}
