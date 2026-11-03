import { el, button } from './client.js';

// VNCCS Pose Studio (vnccs-utils), embedded the way its UniCanvas host does: an isolated `pose_data` adapter instead of a graph node.
// Resolves with the capture-frame render on black and the Pose Studio state, or null when closed without applying.
export async function poseEditor(studio, state, size) {
    let module;
    try { module = await import('../vnccs-utils/vnccs_pose_studio.js'); }
    catch { throw new Error('Install vnccs-utils for the VNCCS Pose Studio mannequin, or fill the layer from a pose render.'); }
    return new Promise(resolve => {
        const node = { id: `amm_pose_${Date.now()}`, widgets: [{ name: 'pose_data', value: JSON.stringify(state || {}) }], size: [1100, 760] };
        let applied = false;
        const widget = new module.PoseStudioWidget(node, { embedded: true });
        const stage = el('div', { class: 'amm-pose-stage' }); stage.append(widget.container);
        const status = el('small', { role: 'status', text: 'Loading the mannequin…' });
        const apply = button('Apply to layer', () => {
            const p = widget.exportParams;
            const image = widget.viewer.capture(size.width, size.height, p.cam_zoom, [0, 0, 0], p.cam_offset_x, p.cam_offset_y, p.cam_yaw_deg || 0, p.cam_pitch_deg || 0, { hideReference: true });
            if (!image) { status.textContent = 'The mannequin is not ready yet.'; return; }
            // Pose Studio writes its full state into the `pose_data` adapter.
            widget.syncToNode(false, { skipCapture: true, notify: false });
            applied = true; resolve({ image, state: JSON.parse(node.widgets[0].value || 'null') }); dialog.close();
        }, { class: 'amm-primary', disabled: true });
        const dialog = studio.modal('Pose · 3D mannequin', el('div', {}, stage, status), apply);
        dialog.classList.add('amm-pose-dialog');
        dialog.addEventListener('close', () => { widget.dispose(); if (!applied) resolve(null); });
        (async () => {
            await widget._viewerInitPromise; widget.loadFromNode();
            Object.assign(widget.exportParams, { view_width: size.width, view_height: size.height });
            await widget.loadModel(true, false); await widget.awaitReadyForCompositeCapture();
            apply.disabled = false; status.textContent = 'Pose the mannequins; the capture frame is what the layer receives, on black.';
        })().catch(error => { status.textContent = `Pose Studio failed: ${error.message}`; });
    });
}

// Port of ExperimentalAnimaMeshRegions (ComfyUI-Anima-CharRef-LLLite): each lit pixel takes the flat region color of the mannequin color
// closest in hue (cosine similarity), dark pixels stay black. Pose Studio colors its mannequins white, blue, pink and green by default.
export const mannequinColors = ['#ffffff', '#8ec5ff', '#f0a6ca', '#a7e3a1'];
export const regionColors = ['#ff4040', '#4080ff', '#40ff80', '#ffdf40'];
export function meshRegions(image, palette = mannequinColors, threshold = 0.02) {
    const rgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const unit = values => { const length = Math.hypot(...values) || 1; return values.map(v => v / length); };
    const sources = palette.map(hex => unit(rgb(hex))), targets = regionColors.map(rgb);
    const data = image.data;
    for (let i = 0; i < data.length; i += 4) {
        const pixel = [data[i], data[i + 1], data[i + 2]];
        if (Math.max(...pixel) / 255 <= threshold || !data[i + 3]) { data.fill(0, i, i + 3); data[i + 3] = 255; continue; }
        const u = unit(pixel); let best = 0, score = -2;
        sources.forEach((s, k) => { const dot = s[0] * u[0] + s[1] * u[1] + s[2] * u[2]; if (dot > score) { score = dot; best = k; } });
        data.set(targets[best % targets.length], i); data[i + 3] = 255;
    }
    return image;
}
