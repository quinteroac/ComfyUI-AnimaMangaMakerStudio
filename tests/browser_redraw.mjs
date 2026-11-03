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
    const project = async () => (await fetch(`${backend.url}/anima-manga-maker/projects/${backend.project}`)).json();
    const fillModels = async scope => {
        await scope.locator('summary').filter({ hasText: 'Models and advanced settings' }).first().click();
        for (const [label, node, key] of [['Diffusion model', 'UNETLoader', 'unet_name'], ['Text encoder', 'CLIPLoader', 'clip_name'], ['VAE', 'VAELoader', 'vae_name']]) {
            await scope.getByLabel(label, { exact: true }).first().fill(options(defs, node, key)[0]); await scope.getByLabel(label, { exact: true }).first().press('Tab');
        }
    };
    await studio.getByRole('button', { name: 'Draw panel', exact: true }).click();
    const setup = studio.getByRole('dialog', { name: 'New panel drawing', exact: true });
    await setup.getByLabel('Drawing name', { exact: true }).fill('Redraw test');
    await setup.getByLabel('Resolution · MP', { exact: true }).fill('0.065536');
    await setup.getByRole('button', { name: 'Start drawing', exact: true }).click();
    const dialog = studio.getByRole('dialog', { name: 'Draw panel · Klecks', exact: true });
    const frame = await (await dialog.locator('iframe').elementHandle()).contentFrame();
    await frame.locator('.g-root:not(.top-overlay)').waitFor();
    await choose(dialog.getByRole('complementary', { name: 'Sketch to Art controls', exact: true }), 'Drawing workflow', 'redraw');
    const controls = dialog.getByRole('complementary', { name: 'Redraw controls', exact: true });
    assert.equal(await controls.getByLabel('Keep from the drawing', { exact: true }).inputValue(), 'lineart');
    assert.equal(await controls.getByLabel('Redraw LLLite', { exact: true }).inputValue(), 'anima-lllite-lineart-1.safetensors');
    await controls.getByLabel('Prompt and settings preset', { exact: true }).selectOption('Color → Manga');
    await fillModels(controls);
    await controls.getByRole('button', { name: 'Generate Redraw', exact: true }).click();
    await controls.getByText('AI layer added · Save to project to preserve it.', { exact: true }).waitFor({ timeout: 30000 });
    let graph = queued.at(-1).prompt;
    const lllite = Object.values(graph).find(n => n.class_type === 'AnimaLLLiteApply');
    assert.equal(graph[lllite.inputs.image[0]].class_type, 'ImageInvert'); assert.equal(graph[lllite.inputs.model_patch[0]].inputs.name, 'anima-lllite-lineart-1.safetensors');
    assert(Object.values(graph).find(n => n.class_type === 'CLIPTextEncode').inputs.text.includes('monochrome, greyscale, manga, screentone'), 'The Color → Manga preset fills the style');
    await choose(controls, 'Redraw task', 'lineart');
    await controls.getByRole('button', { name: 'Generate Redraw', exact: true }).click();
    await controls.getByText('AI layer added · Save to project to preserve it.', { exact: true }).waitFor({ timeout: 30000 });
    graph = queued.at(-1).prompt;
    assert.deepEqual(Object.values(graph).map(n => n.class_type), ['LoadImage', 'AnimeLineArtPreprocessor', 'PreviewImage']);
    const ink = await frame.evaluate(async () => {
        const layer = (await editor.readPSD(await (await editor.getPSD()).arrayBuffer())).layers.find(l => l.name.startsWith('Lineart · '));
        const data = layer.image.getContext('2d').getImageData(0, 0, layer.image.width, layer.image.height).data;
        const i = (128 * layer.image.width + 128) * 4;
        return [data[i], data[i + 1], data[i + 2], data[i + 3], (await editor.readPSD(await (await editor.getPSD()).arrayBuffer())).layers.map(l => l.name)];
    });
    // The fixture result is #c1d8cb everywhere: an ink layer of black with the lines' brightness as opacity (canvas center, away from the feathered edge).
    assert.deepEqual(ink.slice(0, 3), [0, 0, 0]); assert(Math.abs(ink[3] - 204) <= 2, `Ink opacity follows the line brightness: ${ink}`);
    assert(ink[4].some(name => name.startsWith('Redraw · ')));
    await dialog.getByRole('button', { name: 'Save to project', exact: true }).click();
    await dialog.getByText('Saved to project · Layers preserved', { exact: true }).waitFor();
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();

    // Upscale from the gallery: a new version of the panel, drawn from the panel itself under the grayscale LLLite.
    const panel = (await project()).assets.find(a => a.name === 'Redraw test');
    await studio.locator(`.amm-panels .amm-asset[data-asset-id="${panel.id}"]`).getByRole('button', { name: 'Image actions', exact: true }).click();
    await studio.locator(`.amm-panels .amm-asset[data-asset-id="${panel.id}"]`).getByRole('menuitem', { name: 'Upscale', exact: true }).click();
    const upscale = studio.getByRole('dialog', { name: 'Upscale · Redraw test', exact: true });
    assert.equal(await upscale.getByLabel('Target resolution · MP', { exact: true }).inputValue(), '2');
    assert.equal(await upscale.getByLabel('Hold the image with', { exact: true }).inputValue(), 'gray');
    await fillModels(upscale);
    await upscale.getByRole('button', { name: 'Upscale', exact: true }).click(); await upscale.waitFor({ state: 'detached' });
    await page.waitForFunction(async ({ url, id }) => (await (await fetch(url)).json()).assets.some(a => a.parent === id && a.metadata?.operation === 'upscale'),
        { url: `/anima-manga-maker/projects/${backend.project}`, id: panel.id }, { timeout: 30000, polling: 500 });
    graph = queued.at(-1).prompt;
    const up = Object.values(graph).find(n => n.class_type === 'AnimaLLLiteApply');
    assert.equal(graph[up.inputs.image[0]].class_type, 'MaskToImage'); assert.equal(Object.values(graph).find(n => n.class_type === 'KSampler').inputs.denoise, 0.3);
    const scale = Object.values(graph).find(n => n.class_type === 'ImageScale').inputs; assert(scale.width * scale.height > 1.8e6 && scale.width === scale.height, 'Square panel to about 2 MP');
    const version = (await project()).assets.find(a => a.parent === panel.id && a.metadata?.operation === 'upscale');
    assert.equal(version.kind, 'panels'); assert.equal(version.version, panel.version + 1);
    await studio.getByRole('button', { name: 'Back to ComfyUI', exact: true }).click();
    const graphAfter = await page.evaluate(() => window.comfyAPI.app.app.graph.serialize());
    delete graphBefore.extra.k2cf_state_id; delete graphAfter.extra.k2cf_state_id; assert.deepEqual(graphAfter, graphBefore);
    assert.deepEqual(errors, []);
    console.log('Redraw passed: lineart redraw with the Color → Manga preset, lineart extraction as an ink layer, and gallery upscale as a new version under the grayscale LLLite.');
} catch (error) {
    await page.screenshot({ path: '/tmp/manga-redraw-error.png' }); console.error((await page.locator('.amm-studio').innerText().catch(() => 'Studio closed')).slice(-4000), errors); throw error;
} finally {
    await page.unrouteAll({ behavior: 'wait' }); await browser.close(); fixture.kill();
}
