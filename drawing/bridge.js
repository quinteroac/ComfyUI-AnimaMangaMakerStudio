localStorage.setItem('klecks-language', 'en');
const send = (type, data = {}) => parent.postMessage({ type, ...data }, location.origin);
let editor, saving = false, aiBusy = false, submitSuccess, submitError, canvasRevision = 0, strokeActive = false, boxTool = false;
const partLayers = new Set();
// Layers named `Control · …` hold control images and masks: they stay in the PSD but are left out of the drawing sent to generation and of the saved PNG.
const isControl = name => name.startsWith('Control · ');
let hasControls = false;
const toBlob = canvas => new Promise(resolve => canvas.toBlob(resolve, 'image/png'));

// The embedded Klecks cannot resize the canvas, so extending reopens the drawing with every layer moved by the margins and the new area transparent.
function extend(project, { left = 0, top = 0, right = 0, bottom = 0 }) {
    const width = project.width + left + right, height = project.height + top + bottom;
    return { ...project, width, height, layers: project.layers.map(layer => {
        const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(layer.image, left, top);
        return { ...layer, image: canvas };
    }) };
}

// Without control layers Klecks' own PNG is used; otherwise the layers are composed from the PSD and each control layer is returned separately.
async function capture() {
    if (!hasControls) return { png: await editor.getPNG(), controls: [] };
    const project = await editor.readPSD(await (await editor.getPSD()).arrayBuffer());
    hasControls = project.layers.some(layer => isControl(layer.name));
    const canvas = document.createElement('canvas'); canvas.width = project.width; canvas.height = project.height;
    const ctx = canvas.getContext('2d'), controls = [];
    for (const layer of project.layers) {
        if (isControl(layer.name)) { controls.push({ name: layer.name, png: await toBlob(layer.image) }); continue; }
        if (!layer.isVisible) continue;
        ctx.globalAlpha = layer.opacity; ctx.globalCompositeOperation = layer.mixModeStr || 'source-over'; ctx.drawImage(layer.image, 0, 0);
    }
    return { png: await toBlob(canvas), controls };
}

async function save() {
    if (!editor || saving) return;
    if (aiBusy) { submitError?.(); submitSuccess = submitError = null; send('manga-drawing-error', { error: 'Wait for generation or cancel it before saving.' }); return; }
    saving = true; document.documentElement.inert = true;
    send('manga-drawing-saving');
    try {
        const { png } = await capture(), psd = await editor.getPSD();
        send('manga-drawing-save', { png, psd });
    } catch (error) {
        saving = false; document.documentElement.inert = false; submitError?.(); submitSuccess = submitError = null;
        send('manga-drawing-error', { error: error.message || String(error) });
    }
}

async function fitted(url, r, fit) {
    const image = new Image(); image.src = url; await image.decode();
    const crop = document.createElement('canvas'); crop.width = r.width; crop.height = r.height;
    const ctx = crop.getContext('2d');
    if (fit === 'contain') {
        const scale = Math.min(r.width / image.naturalWidth, r.height / image.naturalHeight);
        const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
        ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, r.width, r.height);
        ctx.drawImage(image, (r.width - width) / 2, (r.height - height) / 2, width, height);
    } else ctx.drawImage(image, 0, 0, r.width, r.height);
    return crop;
}

window.addEventListener('message', async event => {
    if (event.source !== parent || event.origin !== location.origin) return;
    const data = event.data;
    if (data?.type === 'manga-drawing-init' && !editor) {
        editor = new Klecks({ embedUrl: new URL('klecks/', location.href).href, onReady: () => send('manga-drawing-opened'),
            // The live preview covers the drawing; hide it while drawing so the stroke stays visible.
            onStrokeStart: () => { strokeActive = true; canvasRevision++; editor.setPreviewImage(null); send('manga-drawing-changed'); },
            onStrokeEnd: () => { strokeActive = false; send('manga-drawing-stroke-end'); },
            onBoxDrawn: (box, index) => send('manga-drawing-box-drawn', { box, index }),
            onBoxToolEnd: () => { boxTool = false; send('manga-drawing-box-tool-end'); },
            onLayerTransform: (name, matrix) => send('manga-drawing-layer-transformed', { name, matrix }), onSubmit: (success, error) => {
            submitSuccess = success; submitError = error; save();
        } });
        try {
            let project;
            if (data.psdBlob) project = extend(await editor.readPSD(await data.psdBlob.arrayBuffer()), data.margins);
            else if (data.psdUrl) {
                const response = await fetch(data.psdUrl); if (!response.ok) throw new Error('Could not load the layered drawing.');
                project = await editor.readPSD(await response.arrayBuffer());
            } else if (data.imageUrl) {
                const image = new Image(); image.src = data.imageUrl; await image.decode();
                const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
                canvas.getContext('2d').drawImage(image, 0, 0);
                project = { width: canvas.width, height: canvas.height, layers: [{ name: 'Original', opacity: 1, image: canvas }, { name: 'Drawing', opacity: 1, image: { fill: 'transparent' } }] };
            } else {
                project = { width: data.width, height: data.height, layers: [{ name: 'Background', opacity: 1, image: { fill: '#ffffff' } }, { name: 'Drawing', opacity: 1, image: { fill: 'transparent' } }] };
            }
            hasControls = project.layers.some(layer => isControl(layer.name));
            editor.openProject(project);
        } catch (error) {
            editor.initError(error.message || 'Could not open the drawing.');
            send('manga-drawing-error', { error: error.message || 'Could not open the drawing.' });
        }
    } else if (data?.type === 'manga-drawing-guide-region') {
        if (editor) editor.setGuideRegion(data.region);
    } else if (data?.type === 'manga-drawing-guide-boxes') {
        if (editor) editor.setGuideBoxes(data.boxes);
    } else if (data?.type === 'manga-drawing-box-tool') {
        if (editor) { boxTool = !!data.enabled; editor.setBoxTool(boxTool); }
    } else if (data?.type === 'manga-drawing-live-preview') {
        try {
            if (!editor) return;
            editor.setPreviewImage(data.imageUrl ? { image: await fitted(data.imageUrl, data.region, 'contain'), region: data.region } : null);
        } catch (error) { send('manga-drawing-ai-error', { token: 'live', error: error.message || String(error) }); }
    } else if (data?.type === 'manga-drawing-transform-layer') {
        if (!editor) return;
        editor.transformLayer(data.name, data.matrix); send('manga-drawing-changed', { source: 'ai' });
    } else if (data?.type === 'manga-drawing-ai-busy') aiBusy = !!data.busy;
    else if (data?.type === 'manga-drawing-snapshot') {
        try {
            if (!editor || saving) throw new Error('The editor is busy saving.');
            if (strokeActive) throw new Error('Finish the stroke before generating.');
            const revision = `${canvasRevision}:${editor.getRevision()}`; const { png, controls } = await capture(); send('manga-drawing-snapshot-result', { token: data.token, revision, png, controls });
        } catch (error) { send('manga-drawing-ai-error', { token: data.token, error: error.message || String(error) }); }
    } else if (data?.type === 'manga-drawing-apply-art') {
        try {
            if (!editor || saving) throw new Error('The editor is busy saving.');
            if (strokeActive || data.revision !== `${canvasRevision}:${editor.getRevision()}`) { send('manga-drawing-art-stale', { token: data.token }); return; }
            saving = true; document.documentElement.inert = true;
            const r = data.region;
            if (![r.x, r.y, r.width, r.height].every(Number.isInteger) || r.x < 0 || r.y < 0 || r.width < 1 || r.height < 1) throw new Error('The selected region no longer fits the canvas.');
            const crop = await fitted(data.imageUrl, r, data.fit), ctx = crop.getContext('2d');
            const pixels = ctx.getImageData(0, 0, r.width, r.height), feather = Math.max(0, Number(data.feather) || 0);
            // Ink: white lines on black become black lines whose opacity follows the line brightness.
            if (data.ink) for (let i = 0; i < pixels.data.length; i += 4) {
                const line = (pixels.data[i] + pixels.data[i + 1] + pixels.data[i + 2]) / 3;
                pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 0; pixels.data[i + 3] = line;
            }
            let maskPixels, clearMask;
            if (data.mask instanceof Blob) {
                const bitmap = await createImageBitmap(data.mask);
                clearMask = document.createElement('canvas'); clearMask.width = r.width; clearMask.height = r.height;
                const maskCtx = clearMask.getContext('2d'); maskCtx.drawImage(bitmap, 0, 0, r.width, r.height); bitmap.close();
                const original = maskCtx.getImageData(0, 0, r.width, r.height);
                if (feather) {
                    const softened = document.createElement('canvas'); softened.width = r.width; softened.height = r.height;
                    const softCtx = softened.getContext('2d'); softCtx.filter = `blur(${feather}px)`; softCtx.drawImage(clearMask, 0, 0);
                    const blurred = softCtx.getImageData(0, 0, r.width, r.height).data;
                    for (let i = 3; i < original.data.length; i += 4) original.data[i] *= blurred[i] / 255;
                    maskCtx.putImageData(original, 0, 0);
                }
                maskPixels = original.data;
            }
            const opacity = Math.max(0, Math.min(1, Number(data.opacity ?? 100) / 100));
            for (let y = 0; y < r.height; y++) for (let x = 0; x < r.width; x++) {
                const edge = feather ? Math.min(1, (x + 0.5) / feather, (r.width - x - 0.5) / feather, (y + 0.5) / feather, (r.height - y - 0.5) / feather) : 1;
                const index = (y * r.width + x) * 4 + 3;
                pixels.data[index] *= (maskPixels ? maskPixels[index] / 255 : edge) * opacity;
            }
            ctx.putImageData(pixels, 0, 0);
            if (data.parts) {
                // Each box group keeps the union of its boxes; pixels outside every box get their own layer, and groups from earlier results are emptied.
                const layers = [...data.parts.map(part => ({ name: part.name, include: part.rects })),
                    { name: `${data.layerName} · Outside boxes`, exclude: data.parts.flatMap(part => part.rects) }];
                for (const name of partLayers) if (name.startsWith(`${data.layerName} · `) && !layers.some(layer => layer.name === name)) layers.push({ name, include: [] });
                for (const layer of layers) {
                    const piece = document.createElement('canvas'); piece.width = r.width; piece.height = r.height;
                    const pieceCtx = piece.getContext('2d');
                    pieceCtx.beginPath();
                    for (const box of layer.include || [r]) pieceCtx.rect(box.x - r.x, box.y - r.y, box.width, box.height);
                    pieceCtx.clip(); pieceCtx.drawImage(crop, 0, 0);
                    for (const box of layer.exclude || []) pieceCtx.clearRect(box.x - r.x, box.y - r.y, box.width, box.height);
                    if (!partLayers.has(layer.name) && !pieceCtx.getImageData(0, 0, r.width, r.height).data.some((value, i) => i % 4 === 3 && value)) continue;
                    partLayers.add(layer.name); editor.applyLayer({ name: layer.name, image: piece, region: r });
                }
            } else editor.applyLayer({ name: data.layerName, image: crop, region: r, mask: clearMask });
            send('manga-drawing-changed', { source: 'ai' }); send('manga-drawing-art-applied', { token: data.token });
        } catch (error) { send('manga-drawing-ai-error', { token: data.token, error: error.message || String(error) }); }
        finally { saving = false; document.documentElement.inert = false; }
    } else if (data?.type === 'manga-drawing-control-layer') {
        // Creates or replaces a control layer, empty or with an image fitted inside the canvas.
        try {
            if (!editor || saving) throw new Error('The editor is busy saving.');
            const layer = document.createElement('canvas'); layer.width = data.width; layer.height = data.height;
            if (data.imageUrl) {
                const image = new Image(); image.src = data.imageUrl; await image.decode();
                const scale = Math.min(data.width / image.naturalWidth, data.height / image.naturalHeight), width = image.naturalWidth * scale, height = image.naturalHeight * scale;
                layer.getContext('2d').drawImage(image, (data.width - width) / 2, (data.height - height) / 2, width, height);
            }
            editor.applyLayer({ name: data.name, image: layer, region: { x: 0, y: 0, width: data.width, height: data.height } });
            hasControls = true; send('manga-drawing-changed'); send('manga-drawing-control-layer-ready', { name: data.name });
        } catch (error) { send('manga-drawing-ai-error', { token: 'control', error: error.message || String(error) }); }
    } else if (data?.type === 'manga-drawing-extend') {
        try {
            if (!editor || saving || aiBusy) throw new Error('Wait for generation or saving to finish before extending the canvas.');
            send('manga-drawing-extended-psd', { psd: await editor.getPSD(), margins: data.margins });
        } catch (error) { send('manga-drawing-ai-error', { token: 'control', error: error.message || String(error) }); }
    } else if (data?.type === 'manga-drawing-export') await save();
    else if (data?.type === 'manga-drawing-saved') {
        saving = false; document.documentElement.inert = false; submitSuccess?.(); submitSuccess = submitError = null;
    } else if (data?.type === 'manga-drawing-save-failed') {
        saving = false; document.documentElement.inert = false; submitError?.(); submitSuccess = submitError = null;
    }
});
document.addEventListener('pointerdown', event => {
    // Boxes belong to the workflow settings, not to the drawing.
    if (editor && !boxTool && event.target instanceof HTMLCanvasElement) send('manga-drawing-dirty');
}, true);
document.addEventListener('change', () => { if (editor) send('manga-drawing-dirty'); });
// While drawing boxes, undo and redo apply to the boxes instead of the drawing history.
addEventListener('keydown', event => {
    if (!boxTool || !(event.ctrlKey || event.metaKey) || !['z', 'y'].includes(event.key.toLowerCase())) return;
    event.preventDefault(); event.stopImmediatePropagation();
    send(event.key.toLowerCase() === 'y' || event.shiftKey ? 'manga-drawing-box-redo' : 'manga-drawing-box-undo');
}, true);
send('manga-drawing-ready');
