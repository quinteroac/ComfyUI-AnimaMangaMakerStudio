import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { options } from '../web/prompts.js';

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
    // Headless Chromium cannot start Pose Studio's module worker in a cross-origin-isolated page, so the test page drops COEP/COOP.
    await page.route(url => new URL(url).pathname === '/', async route => {
        const response = await route.fetch(), headers = response.headers();
        delete headers['cross-origin-embedder-policy']; delete headers['cross-origin-opener-policy'];
        await route.fulfill({ response, headers });
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
    const out = process.env.POSE_CAPTURE;
    await studio.getByRole('button', { name: 'Draw panel', exact: true }).click();
    const setup = studio.getByRole('dialog', { name: 'New panel drawing', exact: true });
    await setup.getByLabel('Drawing name', { exact: true }).fill('Pose test');
    await setup.getByRole('button', { name: '2:3', exact: true }).click();
    await setup.getByLabel('Resolution · MP', { exact: true }).fill('1');
    await setup.getByRole('button', { name: 'Start drawing', exact: true }).click();
    const dialog = studio.getByRole('dialog', { name: 'Draw panel · Klecks', exact: true });
    const frame = await (await dialog.locator('iframe').elementHandle()).contentFrame();
    await frame.locator('.g-root:not(.top-overlay)').waitFor();
    const controls = dialog.getByRole('complementary', { name: 'Sketch to Art controls', exact: true });
    await controls.locator('summary').filter({ hasText: /^Control layers$/ }).click();
    await controls.getByLabel('Add control layer', { exact: true }).selectOption('pose3d');
    const poseRow = controls.locator('[data-layer="Control · 3D pose"]');
    await poseRow.getByText(/^Shaded 3D mannequin/).waitFor();
    // VNCCS Pose Studio, embedded from vnccs-utils as installed in the running ComfyUI.
    await poseRow.getByRole('button', { name: 'Pose mannequin', exact: true }).click();
    const poseDialog = studio.getByRole('dialog', { name: 'Pose · 3D mannequin', exact: true });
    const apply = poseDialog.getByRole('button', { name: 'Apply to layer', exact: true });
    await page.waitForFunction(() => { const b = [...document.querySelectorAll('.amm-pose-dialog button')].find(b => b.textContent === 'Apply to layer'); return b && !b.disabled; }, null, { timeout: 180000 });
    assert(await poseDialog.locator('canvas').count() > 0, 'Pose Studio renders into the dialog');
    await page.screenshot({ path: '/tmp/manga-pose-studio.png' });
    await apply.click(); await poseDialog.waitFor({ state: 'detached' });
    const layer = name => frame.evaluate(async name => {
        const l = (await editor.readPSD(await (await editor.getPSD()).arrayBuffer())).layers.find(l => l.name === name);
        const data = l.image.getContext('2d').getImageData(0, 0, l.image.width, l.image.height).data; const colors = {}; let lit = 0;
        for (let i = 0; i < data.length; i += 4) { if (data[i + 3] && Math.max(data[i], data[i + 1], data[i + 2]) > 20) { lit++; const key = `${data[i]},${data[i + 1]},${data[i + 2]}`; colors[key] = (colors[key] || 0) + 1; } }
        return { width: l.image.width, lit, colors: Object.entries(colors).sort((a, b) => b[1] - a[1]).slice(0, 3), url: l.image.toDataURL('image/png') };
    }, name);
    await page.waitForTimeout(1000);
    const pose = await layer('Control · 3D pose');
    assert.equal(pose.width, 816); assert(pose.lit > 5000, `The mannequin render fills the layer: ${pose.lit}`);
    if (out) await fs.writeFile(out, Buffer.from(pose.url.split(',')[1], 'base64'));
    const state = (await (await fetch(`${backend.url}/anima-manga-maker/projects/${backend.project}`)).json()).workspace.drawing_panels.control_layers[0];
    assert(state.pose_studio && typeof state.pose_studio === 'object', 'The Pose Studio state is kept for the next edit');
    await controls.getByLabel('Add control layer', { exact: true }).selectOption('regional');
    const regionRow = controls.locator('[data-layer="Control · Regions"]');
    await regionRow.getByText(/^One flat color per figure/).waitFor();
    await regionRow.getByRole('button', { name: 'From 3D pose', exact: true }).click();
    await page.waitForTimeout(1500);
    const regions = await layer('Control · Regions');
    assert(regions.lit > 5000 && regions.colors[0][0] === '255,64,64', `One mannequin becomes one flat red region: ${JSON.stringify(regions.colors)}`);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await studio.getByRole('dialog', { name: 'Discard unsaved drawing?', exact: true }).getByRole('button', { name: 'Discard changes', exact: true }).click();
    assert.deepEqual(errors, []);
    console.log(`Pose passed: VNCCS Pose Studio embedded, mannequin capture applied to the 3D pose layer (${pose.lit} lit pixels), state kept, regions derived from it.`);
} catch (error) {
    await page.screenshot({ path: '/tmp/manga-pose-error.png' }); console.error((await page.locator('.amm-studio').innerText().catch(() => 'Studio closed')).slice(-4000), errors); throw error;
} finally {
    await page.unrouteAll({ behavior: 'wait' }); await browser.close(); fixture.kill();
}
