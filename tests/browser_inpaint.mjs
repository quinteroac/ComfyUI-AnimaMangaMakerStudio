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
    await page.route(/\/(?:api\/)?prompt$/, async route => {
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
    const largest = frame => frame.locator('canvas').evaluateAll(canvases => canvases.map((c, i) => ({ i, area: c.getBoundingClientRect().width * c.getBoundingClientRect().height })).sort((a, b) => b.area - a.area)[0].i);
    const stroke = async (frame, from, to) => {
        const box = await frame.locator('canvas').nth(await largest(frame)).boundingBox();
        await page.mouse.move(box.x + box.width * from[0], box.y + box.height * from[1]); await page.mouse.down();
        await page.mouse.move(box.x + box.width * to[0], box.y + box.height * to[1], { steps: 8 }); await page.mouse.up();
    };
    const project = async () => (await fetch(`${backend.url}/anima-manga-maker/projects/${backend.project}`)).json();
    await studio.getByRole('button', { name: 'Draw panel', exact: true }).click();
    const setup = studio.getByRole('dialog', { name: 'New panel drawing', exact: true });
    await setup.getByLabel('Drawing name', { exact: true }).fill('Inpaint test');
    await setup.getByLabel('Resolution · MP', { exact: true }).fill('0.065536');
    await setup.getByRole('button', { name: 'Start drawing', exact: true }).click();
    const dialog = studio.getByRole('dialog', { name: 'Draw panel · Klecks', exact: true });
    let frame = await (await dialog.locator('iframe').elementHandle()).contentFrame();
    await frame.locator('.g-root:not(.top-overlay)').waitFor();
    await choose(dialog.getByRole('complementary', { name: 'Sketch to Art controls', exact: true }), 'Drawing workflow', 'inpaint');
    const controls = dialog.getByRole('complementary', { name: 'Inpaint controls', exact: true });
    await controls.locator('summary').filter({ hasText: 'Models and advanced settings' }).first().click();
    for (const [label, node, key] of [['Diffusion model', 'UNETLoader', 'unet_name'], ['Text encoder', 'CLIPLoader', 'clip_name'], ['VAE', 'VAELoader', 'vae_name']]) {
        await controls.getByLabel(label, { exact: true }).first().fill(options(defs, node, key)[0]); await controls.getByLabel(label, { exact: true }).first().press('Tab');
    }
    const generate = controls.getByRole('button', { name: 'Generate Inpaint', exact: true }); await generate.waitFor();
    await generate.click();
    await controls.getByText('Paint the area to replace on the Control · Mask layer first.', { exact: true }).waitFor();
    assert.equal(queued.length, 0, 'Nothing is queued without a mask');

    // The mask and a 3D pose control are Klecks layers: painted like any layer, kept in the PSD, left out of the drawing sent to the model.
    await controls.getByRole('button', { name: 'Add mask layer', exact: true }).click();
    await controls.getByRole('button', { name: 'Clear mask', exact: true }).waitFor();
    await stroke(frame, [.49, .5], [.51, .5]);
    await controls.locator('summary').filter({ hasText: /^Control layers$/ }).click();
    await controls.getByLabel('Add control layer', { exact: true }).selectOption('pose3d');
    const poseRow = controls.locator('[data-layer="Control · 3D pose"]');
    await poseRow.getByText(/^Shaded 3D mannequin/).waitFor();
    assert.equal(await poseRow.getByLabel('Control model', { exact: true }).inputValue(), 'anima_3dpose_6200.safetensors');
    await stroke(frame, [.44, .42], [.46, .44]);
    await generate.click();
    await controls.getByText('AI layer added · Save to project to preserve it.', { exact: true }).waitFor({ timeout: 30000 });
    const graph = Object.values(queued.at(-1).prompt);
    assert(graph.some(n => n.class_type === 'SetLatentNoiseMask') && graph.some(n => n.class_type === 'ImageToMask'));
    assert.deepEqual(graph.filter(n => n.class_type === 'AnimaLLLiteApply').map(n => queued.at(-1).prompt[n.inputs.model_patch[0]].inputs.name),
        [options(defs, 'ModelPatchLoader', 'name').find(name => name.includes('inpainting-v2')), 'anima_3dpose_6200.safetensors']);
    assert.equal(uploads.length, 3, 'The masked crop, its mask and the control layer are staged');
    const job = (await project()).jobs.at(-1);
    assert.equal(job.operation, 'inpaint'); assert(job.settings.region.width < 256 && job.settings.region.y > 0, `Only the masked area with its context padding is generated: ${JSON.stringify(job.settings.region)}`);
    const layers = await frame.evaluate(async () => (await editor.readPSD(await (await editor.getPSD()).arrayBuffer())).layers.map(l => {
        const data = l.image.getContext('2d').getImageData(0, 0, l.image.width, l.image.height).data; let painted = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i]) painted++;
        return [l.name, painted];
    }));
    const painted = name => layers.find(([layer]) => layer === name)?.[1] || 0;
    assert(painted('Control · Mask') > 0 && painted('Control · 3D pose') > 0, `Both control layers hold strokes: ${JSON.stringify(layers)}`);
    assert(layers.some(([name, count]) => name.startsWith('Inpaint · ') && count > 0));
    await dialog.getByRole('button', { name: 'Save to project', exact: true }).click();
    await dialog.getByText('Saved to project · Layers preserved', { exact: true }).waitFor();
    const pixels = async asset => page.evaluate(async url => {
        const image = new Image(); image.src = url; await image.decode();
        const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data; let dark = 0, result = 0;
        for (let i = 0; i < data.length; i += 4) { if (data[i] < 60 && data[i + 1] < 60 && data[i + 2] < 60) dark++; if (data[i] < 250 || data[i + 1] < 250 || data[i + 2] < 250) result++; }
        return { width: canvas.width, dark, result };
    }, `/anima-manga-maker/projects/${backend.project}/assets/${asset.id}`);
    const saved = (await project()).assets.find(a => a.name === 'Inpaint test');
    const first = await pixels(saved);
    assert.equal(first.dark, 0, 'Mask and control strokes are not in the saved PNG'); assert(first.result > 10, `The repainted area is: ${JSON.stringify(first)}`);

    // Outpaint: extending reopens the drawing with transparent margins, which are filled with the mask.
    await choose(controls, 'Task', 'outpaint');
    await controls.getByLabel('Extend right · px', { exact: true }).fill('64'); await controls.getByLabel('Extend right · px', { exact: true }).press('Tab');
    await controls.getByLabel('Extend right · px', { exact: true }).waitFor();
    await controls.getByRole('button', { name: 'Clear mask', exact: true }).click();
    await page.waitForTimeout(500);
    await controls.getByRole('button', { name: 'Extend canvas', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.amm-drawing-dialog iframe')?.contentWindow?.document.readyState === 'complete');
    await dialog.getByText('Draw with Klecks, then save to your project.', { exact: true }).waitFor({ timeout: 30000 });
    frame = await (await dialog.locator('iframe').elementHandle()).contentFrame();
    const reopened = await frame.evaluate(async () => { const p = await editor.readPSD(await (await editor.getPSD()).arrayBuffer()); return { width: p.width, layers: p.layers.map(l => l.name) }; });
    assert.equal(reopened.width, 320); assert(reopened.layers.includes('Control · 3D pose'), 'Layers survive the extension');
    await page.waitForTimeout(500);
    await generate.click();
    await controls.getByText('AI layer added · Save to project to preserve it.', { exact: true }).waitFor({ timeout: 30000 });
    const outpaint = (await project()).jobs.at(-1).settings;
    assert.equal(outpaint.task, 'outpaint'); assert.equal(outpaint.region.x + outpaint.region.width, 320, 'The new right margin is filled');
    await dialog.getByRole('button', { name: 'Save to project', exact: true }).click();
    await dialog.getByText('Saved to project · Layers preserved', { exact: true }).waitFor();
    const extended = await pixels((await project()).assets.filter(a => a.name === 'Inpaint test').at(-1));
    assert.equal(extended.width, 320); assert.equal(extended.dark, 0);
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await studio.getByRole('button', { name: 'Back to ComfyUI', exact: true }).click();
    const graphAfter = await page.evaluate(() => window.comfyAPI.app.app.graph.serialize());
    delete graphBefore.extra.k2cf_state_id; delete graphAfter.extra.k2cf_state_id; assert.deepEqual(graphAfter, graphBefore);
    assert.deepEqual(errors, []);
    console.log('Inpaint passed: mask and control layers painted in Klecks and kept out of the model input and saved PNG, masked crop with padding, inpainting and 3D pose LLLites, outpaint after extending the canvas with layers preserved.');
} catch (error) {
    await page.screenshot({ path: '/tmp/manga-inpaint-error.png' }); console.error((await page.locator('.amm-studio').innerText().catch(() => 'Studio closed')).slice(-6000), errors); throw error;
} finally {
    await page.unrouteAll({ behavior: 'wait' }); await browser.close(); fixture.kill();
}
