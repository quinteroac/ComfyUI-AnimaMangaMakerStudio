import { api } from '../../scripts/api.js';
import { el, button, iconButton, field, assetUrl } from './client.js';
import { controlTypes, options } from './prompts.js';
import { combo, slider, toggle } from './controls.js';
import { poseEditor, meshRegions, mannequinColors } from './pose-editor.js';

export const maskLayer = 'Control · Mask';

// Klecks layers named `Control · …` that feed LLLite controls. The list and its settings belong to the drawing scope;
// the layers themselves live in the drawing's PSD, so a listed layer may be missing until it is added again.
export function controlLayers(studio, scope, send, dimensions, changed) {
    const state = studio.state(scope); state.control_layers ||= [];
    let present = new Set(), latest = [];
    const element = el('details', {}, el('summary', { text: 'Control layers' }));
    const rows = el('div');
    const create = (name, imageUrl) => {
        if (!dimensions()) { studio.fail(new Error('Wait for the drawing to open before adding a control layer.')); return; }
        send('manga-drawing-control-layer', { name, ...dimensions(), ...(imageUrl ? { imageUrl } : {}) });
    };
    const render = () => {
        rows.replaceChildren(...state.control_layers.map((c, index) => {
            const number = (label, key, range, step) => slider(label, el('input', { type: 'number', 'aria-label': `${c.name} ${label}`, value: c[key], step, onchange: e => { c[key] = Number(e.target.value); changed(); } }), range);
            return el('div', { class: `amm-lora${c.enabled ? '' : ' amm-disabled'}`, 'data-layer': c.name },
                el('div', { class: 'amm-row' }, toggle(c.name, el('input', { type: 'checkbox', checked: c.enabled, onchange: e => { c.enabled = e.target.checked; changed(); render(); } })),
                    iconButton(`Remove ${c.name} from the list`, 'trash', () => { state.control_layers.splice(index, 1); changed(); render(); })),
                el('small', { text: present.has(c.name) ? controlTypes[c.type]?.hint || '' : 'Layer not found in the drawing · add it again or rename a layer to this name.' }),
                combo('Control model', options(studio.defs, 'ModelPatchLoader', 'name'), c.patch, value => { c.patch = value; changed(); }),
                el('div', { class: 'amm-row' }, button('Fill from image', () => studio.chooseImage(`Fill ${c.name}`, id => { create(c.name, assetUrl(studio.project.id, id)); return true; })),
                    c.type === 'pose3d' ? button('Pose mannequin', () => studio.action(async () => {
                        const posed = await poseEditor(studio, c.pose_studio, dimensions()); if (!posed) return;
                        c.pose_studio = posed.state; create(c.name, posed.image); changed();
                    })) : null,
                    c.type === 'regional' ? button('From 3D pose', () => studio.action(() => regionsFromPose(c))) : null,
                    present.has(c.name) ? null : button('Add layer', () => create(c.name))),
                number('Strength', 'strength', [0, 2], 0.05), number('Start', 'start', [0, 1], 0.01), number('End', 'end', [0, 1], 0.01));
        }));
    };
    // One flat region per mannequin, from the first 3D pose layer in the drawing.
    async function regionsFromPose(target) {
        const pose = state.control_layers.find(c => c.type === 'pose3d' && latest.some(item => item.name === c.name));
        if (!pose) throw new Error('Add and pose a 3D pose control layer first.');
        const bitmap = await createImageBitmap(latest.find(item => item.name === pose.name).png), canvas = document.createElement('canvas');
        canvas.width = bitmap.width; canvas.height = bitmap.height; const ctx = canvas.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close();
        const colors = pose.pose_studio?.characters?.map(character => character.color).filter(Boolean);
        ctx.putImageData(meshRegions(ctx.getImageData(0, 0, canvas.width, canvas.height), colors?.length ? colors : mannequinColors), 0, 0);
        create(target.name, canvas.toDataURL('image/png'));
    }
    const add = el('select', { 'aria-label': 'Add control layer', onchange: () => {
        const type = controlTypes[add.value]; if (!type) return;
        let name = `Control · ${type.label}`;
        for (let i = 2; state.control_layers.some(c => c.name === name); i++) name = `Control · ${type.label} ${i}`;
        state.control_layers.push({ name, type: add.value, enabled: true, patch: options(studio.defs, 'ModelPatchLoader', 'name').find(file => file.split('/').at(-1) === type.patch) || type.patch,
            strength: type.strength, start: type.start, end: type.end });
        add.value = ''; create(name); changed(); render();
    } }, el('option', { value: '', text: 'Add control layer…' }), ...Object.entries(controlTypes).map(([value, type]) => el('option', { value, text: type.label })));
    element.append(field('Add control layer', add, 'Paint on the new layer, or fill it from an image; transparent parts become the background the control expects. Control layers are saved in the PSD but left out of the drawing sent to the model and of the PNG.'), rows);
    render();
    return {
        element,
        // Control layers from the latest snapshot.
        sync(controls) { latest = controls; present = new Set(controls.map(item => item.name)); render(); },
        // Crops each enabled control layer to the generation region, flattens it onto its background and stages it as a temporary input.
        async stage(snapshot, r, project, token) {
            const staged = [];
            for (const c of state.control_layers.filter(c => c.enabled)) {
                const layer = snapshot.find(item => item.name === c.name); if (!layer) continue;
                const bitmap = await createImageBitmap(layer.png), crop = document.createElement('canvas'); crop.width = r.width; crop.height = r.height;
                const ctx = crop.getContext('2d'); ctx.fillStyle = controlTypes[c.type]?.background || 'black'; ctx.fillRect(0, 0, r.width, r.height);
                ctx.drawImage(bitmap, r.x, r.y, r.width, r.height, 0, 0, r.width, r.height); bitmap.close();
                staged.push({ enabled: true, patch: c.patch, strength: c.strength, start: c.start, end: c.end, image_path: await upload(await new Promise(resolve => crop.toBlob(resolve, 'image/png')), project, `${token}-control-${staged.length}`) });
            }
            return staged;
        },
    };
}

// Stages an image as a temporary ComfyUI input for one drawing job; the job's cleanup removes every `<job>…png`.
export async function upload(blob, project, name) {
    const form = new FormData(); form.append('image', blob, `${name}.png`); form.append('type', 'temp'); form.append('subfolder', `anima-manga-maker-drawing/${project}`);
    const response = await api.fetchApi('/upload/image', { method: 'POST', body: form }), uploaded = await response.json();
    if (!response.ok) throw new Error(uploaded.error || 'Could not stage the drawing region.');
    return `${uploaded.subfolder ? uploaded.subfolder + '/' : ''}${uploaded.name} [${uploaded.type}]`;
}
