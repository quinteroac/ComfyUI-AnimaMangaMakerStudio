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
const defs = process.argv[4] && JSON.parse(await fs.readFile(process.argv[4], 'utf8'));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH });
const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });
const errors = []; page.on('pageerror', error => errors.push(error.message));
const queued = [];
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
        await route.fulfill({ response: await route.fetch({ url: backend.url + pathname + url.search }) });
    });
    await page.route(/\/(?:api\/)?prompt$/, async route => {
        const body = route.request().postDataJSON(); queued.push(body);
        const response = await fetch(`${backend.url}/test/complete`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        await route.fulfill({ json: await response.json() });
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
    for (const space of ['references', 'panels']) {
        await studio.getByRole('button', { name: space === 'references' ? 'References' : 'Panels', exact: true }).click();
        const view = studio.locator(`.amm-${space}`);
        await view.getByLabel('Engine', { exact: true }).selectOption('anima');
        assert.deepEqual(await view.getByLabel('Engine', { exact: true }).locator('option').evaluateAll(options => options.map(o => o.value)), ['anima', 'anima_ref', 'anima_snapref']);
        assert.equal(await view.getByText('Connected visual references', { exact: true }).count(), 0);
        await view.locator('summary').filter({ hasText: /^Models and advanced settings$/ }).click();
        assert.equal(await view.getByLabel('Diffusion model · global', { exact: true }).inputValue(), 'anima/anima-turbo-v1.0-int8-convrot.safetensors');
        assert.equal(await view.getByLabel('Encoder loading type', { exact: true }).inputValue(), 'stable_diffusion');
        await view.locator('summary').filter({ hasText: /^Sampling$/ }).click();
        assert((await view.getByLabel('Negative prompt', { exact: true }).inputValue()).includes('worst quality'));
        await view.getByLabel('Resolution · MP', { exact: true }).fill('0.5');
        await view.getByLabel('Resolution · MP', { exact: true }).press('Tab');
        const before = queued.length;
        await view.getByRole('button', { name: space === 'references' ? 'Generate reference' : 'Generate panel', exact: true }).click();
        await page.waitForTimeout(1000);
        assert.equal(queued.length, before + 1, await studio.locator('.amm-error').textContent());
        const nodes = Object.values(queued.at(-1).prompt);
        const sampler = nodes.find(n => n.class_type === 'KSampler');
        assert.equal(sampler.inputs.steps, 8); assert.equal(sampler.inputs.cfg, 1); assert.equal(sampler.inputs.sampler_name, 'er_sde');
        assert(nodes.some(n => n.class_type === 'EmptyLatentImage'));
        await page.waitForTimeout(2200);
        if (space === 'panels') {
            // A control image from the gallery and an artist chain reach the queued graph.
            const controls = view.locator('details').filter({ has: page.getByLabel('Add control', { exact: true, includeHidden: true }) });
            await controls.locator('summary').click();
            await controls.getByLabel('Add control', { exact: true }).selectOption('pose3d');
            const patch = 'anima_3dpose_6200.safetensors';
            assert.equal(await controls.getByLabel('Control model', { exact: true }).inputValue(), patch, 'The control type fills its model');
            await controls.getByText(/^3D pose · Shaded 3D mannequin/).waitFor();
            await controls.getByRole('button', { name: 'Choose control image', exact: true }).click();
            const picker = studio.getByRole('dialog', { name: 'Choose control image', exact: true });
            const controlImage = await picker.locator('.amm-asset-picker > button').first().getAttribute('data-asset-id');
            await picker.locator('.amm-asset-picker > button').first().click(); await picker.waitFor({ state: 'detached' });
            await controls.locator('.amm-control-thumb').waitFor();
            const artists = view.locator('details').filter({ has: page.getByLabel('Artist chain', { exact: true, includeHidden: true }) });
            await artists.locator('summary').click();
            await artists.getByLabel('Artist chain', { exact: true }).fill('@kubo tite');
            const queuedBefore = queued.length;
            await view.getByRole('button', { name: 'Generate panel', exact: true }).click();
            for (let i = 0; i < 40 && queued.length === queuedBefore; i++) await page.waitForTimeout(100);
            const controlled = Object.values(queued.at(-1).prompt);
            const lllite = controlled.find(n => n.class_type === 'AnimaLLLiteApply');
            assert(lllite, await studio.locator('.amm-error').textContent());
            assert.equal(queued.at(-1).prompt[lllite.inputs.model_patch[0]].inputs.name, patch);
            assert(queued.at(-1).prompt[lllite.inputs.image[0]].inputs.image.includes(controlImage));
            assert.equal(controlled.find(n => n.class_type === 'AnimaArtistPack').inputs.artist_chain, '@kubo tite');
            await page.waitForTimeout(2200);
        }
        // SnapRef takes up to eight pictures of one character.
        await view.getByLabel('Engine', { exact: true }).selectOption('anima_snapref');
        await view.getByText('Connected visual references', { exact: true }).waitFor();
        assert.equal(await view.locator('.amm-run-hint').innerText(), 'Connect one to eight references.');
        if (space === 'panels') {
            // Images from the computer or ComfyUI's input folder join References and get connected in one step.
            const png = Buffer.from((await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 64; c.height = 96; c.getContext('2d').fillRect(0, 0, 64, 96); return c.toDataURL('image/png'); })).split(',')[1], 'base64');
            const inputName = await page.evaluate(async () => (await (await fetch('/object_info/LoadImage')).json()).LoadImage.input.required.image[0].find(name => /\.(png|jpe?g|webp)$/i.test(name)));
            const projectBefore = (await (await fetch(`${backend.url}/anima-manga-maker/projects/${backend.project}`)).json()).assets.length;
            await view.getByRole('button', { name: 'Choose references', exact: true }).click();
            const picker = studio.getByRole('dialog', { name: 'Connect references', exact: true });
            const [chooser] = await Promise.all([page.waitForEvent('filechooser'), picker.getByRole('button', { name: 'Upload from computer', exact: true }).click()]);
            await chooser.setFiles({ name: 'outside.png', mimeType: 'image/png', buffer: png });
            await view.locator('.amm-reference-strip > [data-asset-id]').filter({ hasText: 'outside' }).waitFor();
            await picker.getByLabel('Search ComfyUI input images', { exact: true }).fill(inputName);
            await picker.locator(`.amm-asset-picker > button[data-input="${inputName}"]`).click();
            await view.locator('.amm-reference-strip > [data-asset-id]').nth(1).waitFor();
            await picker.getByRole('button', { name: 'Close', exact: true }).click();
            const imported = (await (await fetch(`${backend.url}/anima-manga-maker/projects/${backend.project}`)).json()).assets;
            assert.equal(imported.length, projectBefore + 2, 'Both outside images joined the project');
            assert.deepEqual(await view.locator('.amm-reference-strip > [data-asset-id]').evaluateAll(cards => cards.map(c => c.dataset.assetId)), imported.slice(-2).map(a => a.id));
            assert(imported.slice(-2).every(a => a.kind === 'references'));
            await page.waitForFunction(() => document.querySelector('.amm-panels [aria-label="Resolution · MP"]')?.disabled);
            const queuedBefore = queued.length;
            await view.getByRole('button', { name: 'Generate panel', exact: true }).click();
            for (let i = 0; i < 40 && queued.length === queuedBefore; i++) await page.waitForTimeout(100);
            const graph = queued.at(-1).prompt, snap = Object.values(graph).find(n => n.class_type === 'SnapRefSimple');
            assert(snap, await studio.locator('.amm-error').textContent());
            assert.deepEqual([snap.inputs.reference, snap.inputs.reference_2], imported.slice(-2).map(a => `anima-manga-maker/${backend.project}/${a.id}.png`));
            const latent = Object.values(graph).find(n => n.class_type === 'EmptyLatentImage').inputs;
            assert(Math.abs(latent.width / latent.height - 2 / 3) < 0.02, 'The size is inherited from the uploaded first reference');
            await page.waitForTimeout(700);
            assert.equal((await (await fetch(`${backend.url}/anima-manga-maker/projects/${backend.project}`)).json()).assets.length, projectBefore + 3);
            await page.waitForTimeout(1500);
        }
        // Anima Ref takes character and style from connected references, so it waits for at least one.
        await view.getByLabel('Engine', { exact: true }).selectOption('anima_ref');
        await view.getByText('Connected visual references', { exact: true }).waitFor();
        assert.equal(await view.locator('.amm-run-hint').innerText(), 'Connect one to four references.');
        await view.locator('summary').filter({ hasText: /^Models and advanced settings$/ }).click();
        await view.locator('summary').filter({ hasText: /^Anima reference adapter$/ }).click();
        assert.equal(await view.getByLabel('Ref Adapter LoRA', { exact: true }).inputValue(), 'anima_ref_adapter_v2_r64.safetensors');
    }
    assert.deepEqual(await page.evaluate(() => window.comfyAPI.app.app.graph.serialize()), graphBefore);
    assert.deepEqual(errors, []);
    console.log('Anima, Anima Ref and SnapRef: engine list, Turbo defaults, negative prompt, AR/MP, simulated generations, an LLLite control image and Artist Mixer chain in the queued graph, and reference limits passed; open graph unchanged.');
} finally { await page.unrouteAll({ behavior: 'wait' }); await browser.close(); fixture.kill(); }
