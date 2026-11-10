import { api } from '../../scripts/api.js';
import { uuid, el, button, iconButton, field, request, assetUrl, inputUrl, download, chooseFile, sizeControls } from './client.js';
import { sizeSettings, sizeLabel, imageDimensions } from './size.js';
import { options, defaultAttention, alphaMethods, referenceLimits, controlTypes, redrawModes, tilePatches, installedPatch, initialSettings, buildPrompt, composePrompt, promptSections, referencePrompt, parsePrompt, referencePresets, textGeneratorDefaults, textInstruction } from './prompts.js';
import { newPage, normalizePage, PageEditor } from './editor.js';
import { modelFields, profiles, globalModels, inheritModels, applyPreset, savedPreset } from './models.js';
import { openDrawing } from './drawing.js';
import { combo, segmented, slider, toggle, seed, resizer, summarize } from './controls.js';
import { StoryStudio } from './story.js';
import { assistantSettings } from './assistant.js';
import { openStylePicker } from './style-picker.js';
import { sceneEditor, renderScene, sceneMap } from './scene-editor.js';
import { upload } from './control-layers.js';
import { tagSliderControls } from './tag-sliders.js';
import { editControls } from './edit-panel.js';
import { buildQwenEditPrompt } from './qwen-prompt.js';

const spaces = { story: 'Story', style: 'Style', references: 'References', panels: 'Panels', refine: 'Refinement', design: 'Page layout' };
const deleteWarning = 'The image files are deleted from disk. This cannot be undone.';
const kindNames = { references: 'References', panels: 'Panels', pages: 'Pages' };
const engines = { anima: 'Anima', anima_ref: 'Anima Ref', anima_snapref: 'Anima SnapRef' };
const textTasks = { enhance: 'Enhance section', describe: 'Create reference prompt' };
const clone = x => structuredClone(x);

export class Studio {
    constructor() {
        this.observers = []; this.views = new Map(); this.abort = new AbortController(); this.active = localStorage.getItem('amm-space') || 'references';
        this.busy = new Set(); this.progress = new Map(); this.saving = Promise.resolve(); this.galleryRefresh = new Map(); this.referenceRefresh = new Map(); this.pendingRefresh = new Map();
        this.assetMenu = null; this.stylePreviews = [];
        document.addEventListener('pointerdown', e => { if (this.assetMenu && !this.assetMenu.parentElement.contains(e.target)) this.closeAssetMenu(); }, { signal: this.abort.signal });
        this.dialog = el('dialog', { class: 'amm-studio', lang: 'en', 'aria-label': 'Anima Manga Maker Studio' });
        this.header = el('header', { class: 'amm-header' }); this.nav = el('nav', { class: 'amm-nav', 'aria-label': 'Workspaces' });
        this.body = el('main', { class: 'amm-body' }); this.error = el('div', { class: 'amm-error', role: 'alert', hidden: true });
        this.status = el('footer', { class: 'amm-status', role: 'status' }); this.toasts = el('div', { class: 'amm-toasts', role: 'status', 'aria-live': 'polite' });
        this.dialog.append(this.header, this.nav, this.error, this.body, this.status, this.toasts); document.body.append(this.dialog);
        this.dialog.addEventListener('cancel', e => { e.preventDefault(); this.close(); });
        this.dialog.showModal(); this.load().catch(e => this.fail(e));
        for (const name of ['execution_start', 'progress', 'execution_error', 'execution_interrupted', 'execution_success', 'status', 'anima_manga_maker_error']) api.addEventListener(name, e => this.event(name, e.detail), { signal: this.abort.signal });
    }
    fail(error) {
        this.error.hidden = false; this.error.replaceChildren(el('span', { text: error.message || String(error) }), iconButton('Dismiss message', 'clear', () => this.error.hidden = true));
    }
    notify(text) {
        const toast = el('div', { class: 'amm-toast' }, el('span', { text }), iconButton('Dismiss notification', 'clear', () => toast.remove()));
        this.toasts.append(toast); setTimeout(() => toast.remove(), 5000);
    }
    async action(fn) { try { return await fn(); } catch (e) { this.fail(e); } }
    async load() {
        [this.settings, this.projects, this.defs, this.fonts] = await Promise.all([request('/settings'), request('/projects'), api.getNodeDefs(), request('/fonts')]);
        globalModels(this.settings);
        if (this.abort.signal.aborted) return;
        this.renderHeader(); this.renderNav();
        const id = localStorage.getItem('amm-project');
        if (this.projects.some(p => p.id === id)) await this.open(id);
        else this.empty();
        this.timer = setInterval(() => this.poll(), 2000);
    }
    renderHeader() {
        const select = el('select', { 'aria-label': 'Active project', onchange: e => this.action(() => this.open(e.target.value)) }, el('option', { value: '', text: 'Select a project', disabled: true }), ...this.projects.map(p => el('option', { value: p.id, text: p.name })));
        select.value = this.project?.id || '';
        this.header.replaceChildren(el('div', { class: 'amm-brand' }, el('strong', { text: 'Anima Manga Maker' }), el('span', { text: 'STUDIO' })), select,
            iconButton('Projects', 'folder', () => this.projectManager()), iconButton('Settings', 'settings', () => this.globalSettings()),
            iconButton('Back to ComfyUI', 'back', () => this.close(), { class: 'amm-icon-button amm-close' }));
    }
    renderNav() {
        this.nav.replaceChildren(...Object.entries(spaces).map(([key, title]) => button(title, () => this.switch(key), { 'aria-current': this.active === key ? 'page' : 'false' })));
    }
    empty() { this.body.replaceChildren(el('div', { class: 'amm-empty' }, el('h1', { text: 'Your manga starts here' }), el('p', { text: 'Create a project to store references, panels, and pages on your computer.' }), button('Create project', () => this.createProject(), { class: 'amm-primary' }))); }
    async open(id) {
        if (!id) return;
        await this.flush();
        this.resetViews();
        const project = await request(`/projects/${id}`);
        if (this.abort.signal.aborted) return;
        this.project = project; localStorage.setItem('amm-project', id); this.renderHeader(); this.switch(this.active); this.jobs();
    }
    closeAssetMenu() { if (this.assetMenu?.matches(':popover-open')) this.assetMenu.hidePopover(); this.assetMenu = null; }
    resetViews() { this.closeAssetMenu(); this.observers.forEach(o => o.disconnect()); this.observers = []; this.editor?.destroy(); this.editor = null; this.storyView?.destroy(); this.storyView = null; this.views.clear(); this.galleryRefresh.clear(); this.referenceRefresh.clear(); this.pendingRefresh.clear(); this.body.replaceChildren(); }
    state(space = this.active) { return this.project.workspace[space] ||= { engine: 'anima', selection: [], references: [], search: '', sort: 'newest', filter: 'all', page: 0 }; }
    config(space = this.active, engine = this.state(space).engine) {
        const scope = `${space}:${engine}`;
        const config = this.project.config[scope] ||= { ...initialSettings(engine), ...clone(this.settings.defaults[scope] || {}) };
        Object.assign(config, sizeSettings(config.width && config.height ? { width: config.width, height: config.height } : config));
        delete config.width; delete config.height;
        return inheritModels(config, this.settings.models[engine], engine);
    }
    // Anima reads booru tags and free text alike, so it inherits both project styles, tags first.
    projectStyle() {
        return ['animadex', 'stylebook'].map(source => this.project.style?.[source]?.trim()).filter(Boolean).join('\n');
    }
    // What the Style workspace shares besides the prompt style: its enabled LoRAs, Artist Mixer, tag sliders, encoder and VAE.
    styleSettings() {
        const source = this.config('style', 'anima'), shared = {};
        if (source.loras.some(l => l.enabled)) shared.loras = source.loras.filter(l => l.enabled);
        if (source.artist_chain?.trim()) Object.assign(shared, { artist_chain: source.artist_chain, artist_strength: source.artist_strength });
        if (source.tag_sliders?.enabled) shared.style_tag_sliders = source.tag_sliders;
        for (const key of ['encoder', 'encoder_type', 'vae', 'weight_dtype']) if (key in source.model_overrides) shared[key] = source.model_overrides[key];
        return clone(shared);
    }
    // The operation's settings with the global LoRAs and, unless the operation overrides it, the project style.
    // LoRAs run global, then style, then the operation's own; a file listed twice keeps its first entry.
    // Style tag sliders chain before the operation's own; the Style preview has them only once.
    styled(cfg) {
        const { loras = [], ...shared } = cfg.style_override ? {} : this.styleSettings(), style = !cfg.style_override && this.projectStyle();
        if (JSON.stringify(shared.style_tag_sliders) === JSON.stringify(cfg.tag_sliders)) delete shared.style_tag_sliders;
        const all = [...clone((this.settings.loras || []).filter(l => l.enabled)), ...loras, ...(cfg.loras || [])];
        return { ...cfg, ...shared, loras: all.filter((l, i) => all.findIndex(o => o.name === l.name) === i), ...(style ? { prompt_sections: { ...cfg.prompt_sections, style } } : {}) };
    }
    styleView(view) {
        const space = 'style', style = this.project.style ||= {};
        const controls = el('aside', { class: 'amm-controls' }, el('h2', { text: 'Project style' }),
            el('small', { text: 'References, panels, the drawing editor and Upscale use this style in the Style section, plus the LoRAs, Artist Mixer, tag sliders, text encoder and VAE set for the preview below, unless an operation turns off "Use project style".' }));
        const previewControls = el('div');
        const renderPreviewControls = () => {
            const cfg = this.config(space, 'anima');
            previewControls.replaceChildren(); this.essentials(previewControls, cfg, space); this.runBar(previewControls, cfg, space, 'Generate preview');
            this.jobs();
        };
        // Other workspaces show the inherited style when they are next opened.
        const changed = () => { for (const other of ['references', 'panels']) if (this.views.has(other)) this.rebuild(other); this.saveSoon(); renderPreviewControls(); };
        for (const [source, label] of [['animadex', 'Danbooru tags'], ['stylebook', 'Natural-language style']]) {
            const input = el('textarea', { value: style[source] || '', rows: 4, 'aria-label': label, oninput: e => { style[source] = e.target.value; this.saveSoon(); }, onchange: changed });
            controls.append(field(label, input), iconButton(source === 'animadex' ? 'Browse Animadex styles and characters' : 'Browse Stylebook styles', 'image', () => openStylePicker(this, source, (key, update) => {
                input.value = style[source] = update(input.value); changed();
            }), {}, true));
        }
        controls.append(el('h3', { text: 'Preview' }), el('small', { text: 'Generate test images to tune the style. Previews stay in ComfyUI\'s temp folder and are not saved to the project.' }), previewControls);
        const gallery = el('div', { class: 'amm-style-previews' });
        this.renderStylePreviews = () => {
            const previews = this.stylePreviews.filter(p => p.project === this.project.id);
            gallery.replaceChildren(...previews.length ? previews.map(p => el('figure', {}, el('img', { src: p.url, alt: 'Style preview' })))
                : [el('div', { class: 'amm-empty', text: 'Generated previews appear here. They are discarded when you close Studio.' })]);
        };
        const area = el('section', { class: 'amm-preview-area' }, el('div', { class: 'amm-row' }, button('Clear previews', () => { this.stylePreviews = this.stylePreviews.filter(p => p.project !== this.project.id); this.renderStylePreviews(); })), gallery);
        view.append(controls, area); this.controlLayout(view, controls, space); renderPreviewControls(); this.renderStylePreviews();
    }
    switch(space) {
        this.active = spaces[space] ? space : 'references'; localStorage.setItem('amm-space', this.active); this.renderNav();
        if (!this.project) return this.empty();
        for (const view of this.views.values()) view.hidden = true;
        let view = this.views.get(this.active);
        if (!view) {
            view = el('section', { class: `amm-workspace amm-${this.active}` }); this.views.set(this.active, view); this.body.append(view);
            if (this.active === 'design') this.design(view);
            else if (this.active === 'story') this.storyView = new StoryStudio(this, view);
            else if (this.active === 'style') this.styleView(view);
            else if (this.active === 'refine') this.refine(view);
            else this.generateView(view, this.active);
        } else if (this.active === 'story') this.storyView.render();
        view.hidden = false;
        if (this.active === 'design') this.editor?.fit(); this.jobs();
    }
    rebuild(space) { const current = this.views.get(space); current?.remove(); this.views.delete(space); this.galleryRefresh.delete(space); this.referenceRefresh.delete(space); this.pendingRefresh.delete(space); if (this.active === space) this.switch(space); }
    saveSoon() {
        clearTimeout(this.saveTimer); this.saveTimer = setTimeout(() => this.flush(), 450);
        if (this.status.dataset.save !== 'pending') this.status.dataset.save = 'pending';
    }
    flush() {
        clearTimeout(this.saveTimer);
        if (!this.project) return this.saving;
        const project = this.project;
        const patch = clone({ config: project.config, presets: project.presets, layouts: project.layouts, workspace: project.workspace, story: project.story || {}, style: project.style || {} });
        this.saving = this.saving.catch(() => {}).then(() => request(`/projects/${project.id}`, { ...patch, revision: project.revision }, 'PUT')).then(saved => { project.revision = saved.revision; this.status.dataset.save = 'saved'; }).catch(error => {
            if (error.status === 409 && this.project === project) return this.reload();
            this.status.dataset.save = 'error'; this.fail(new Error(`Could not save: ${error.message}`)); throw error;
        });
        return this.saving;
    }
    async reload() {
        clearTimeout(this.saveTimer); this.resetViews();
        this.project = await request(`/projects/${this.project.id}`); this.status.dataset.save = 'saved';
        this.switch(this.active); this.jobs(); this.notify('The project was changed outside Studio and has been reloaded.');
    }
    async close() {
        try { await this.flush(); } catch { return; }
        clearInterval(this.timer); clearTimeout(this.saveTimer); this.abort.abort(); this.resetViews(); this.dialog.close(); this.dialog.remove();
        this.onClose?.();
    }
    modal(title, content, ...actions) {
        const dialog = el('dialog', { class: 'amm-modal', 'aria-label': title }, el('header', { class: 'amm-modal-header' }, el('h2', { text: title }),
            iconButton('Close', 'clear', () => dialog.close(), { class: 'amm-icon-button amm-modal-close' })), el('div', { class: 'amm-modal-body' }, content),
            actions.length ? el('footer', { class: 'amm-dialog-actions' }, ...actions) : null);
        dialog.addEventListener('close', () => dialog.remove()); this.dialog.append(dialog); dialog.showModal(); return dialog;
    }
    ask(title, value, fn) {
        const input = el('input', { value, required: true, 'aria-label': title });
        const actions = el('div', { class: 'amm-dialog-actions' }, button('Cancel', () => dialog.close()), el('button', { type: 'submit', text: 'Save', class: 'amm-primary' }));
        const form = el('form', { class: 'amm-name-form', onsubmit: e => { e.preventDefault(); this.action(async () => { await fn(input.value); dialog.close(); }); } }, input, actions);
        const dialog = this.modal(title, form); input.focus(); input.select();
    }
    clonePreset(presets, name, save) {
        this.ask('Copy preset name', `${name} · copy`, copyName => {
            copyName = copyName.trim();
            if (!copyName || Object.hasOwn(presets, copyName)) throw new Error('Choose a new preset name.');
            save(copyName, clone(presets[name])); this.saveSoon();
        });
    }
    confirm(title, fn, message = 'Confirm this operation.') {
        const dialog = this.modal(title, el('p', { text: message }),
            button('Cancel', () => dialog.close()), button('Confirm', () => this.action(async () => { await fn(); dialog.close(); }), { class: 'amm-danger' }));
    }
    createProject(onCreated) { this.ask('Project name', 'New manga', async name => { const p = await request('/projects', { name }, 'POST'); this.projects = await request('/projects'); await this.open(p.id); onCreated?.(); }); }
    projectManager() {
        const list = el('div', { class: 'amm-project-list' });
        for (const p of this.projects) list.append(el('div', { class: 'amm-project-row' }, el('strong', { text: p.name }), el('div', { class: 'amm-project-actions', role: 'group', 'aria-label': `Actions for ${p.name}` }, button('Open', () => this.action(async () => { await this.open(p.id); dialog.close(); })),
            button('Rename', () => this.ask('Rename project', p.name, async name => { await request(`/projects/${p.id}`, { name }, 'PUT'); this.projects = await request('/projects'); if (this.project?.id === p.id) this.project.name = name; this.renderHeader(); dialog.close(); this.projectManager(); })),
            button('Duplicate', () => this.ask('Copy name', `${p.name} · copy`, async name => { const copy = await request(`/projects/${p.id}/duplicate`, { name }, 'POST'); this.projects = await request('/projects'); await this.open(copy.id); dialog.close(); })))));
        if (!this.projects.length) list.append(el('p', { class: 'amm-project-empty', text: 'No projects yet. Create one to get started.' }));
        const dialog = this.modal('Projects', list, button('Create project', () => this.createProject(() => dialog.close()), { class: 'amm-primary' })); dialog.classList.add('amm-project-dialog');
    }
    globalSettings() {
        const value = clone(this.settings); this.globalDraft = value;
        const root = el('input', { value: value.root, oninput: e => value.root = e.target.value });
        const general = el('div', {}, field('Project root folder', root, 'To relocate projects, wait for the queue to finish, move the complete folders, and select the new root folder.'));
        const text = value.text_generator = { ...textGeneratorDefaults, ...value.text_generator };
        const textControls = el('div');
        const renderText = () => {
            textControls.replaceChildren(
                combo('Text generator CLIP', options(this.defs, 'CLIPLoader', 'clip_name'), text.encoder, v => text.encoder = v),
                combo('Text generator CLIP type', options(this.defs, 'CLIPLoader', 'type'), text.encoder_type, v => text.encoder_type = v),
                combo('Text generator device', options(this.defs, 'CLIPLoader', 'device'), text.encoder_device, v => text.encoder_device = v),
                slider('Text length · tokens', el('input', { type: 'number', min: 1, max: 32768, value: text.max_length, onchange: e => text.max_length = Number(e.target.value) }), [64, 4096]),
                el('small', { text: 'Use an encoder that supports text generation; describing references also requires vision. Shared across projects and engines. Requires TextGenerate and SaveText.' }));
        }; renderText();
        const engineSelect = el('select', { 'aria-label': 'Global model engine' }, ...Object.entries(engines).map(([value, text]) => el('option', { value, text })));
        if (this.project && engines[this.state().engine]) engineSelect.value = this.state().engine;
        const sharedModel = el('div');
        const controls = el('div'); const render = () => {
            sharedModel.replaceChildren(combo('Global diffusion model', options(this.defs, 'UNETLoader', 'unet_name'), value.models.anima.model, model => {
                value.models.anima.model = model; globalModels(value); render();
            }, 'Used by every operation in Anima, Anima Ref and SnapRef, including saved projects and presets.'));
            controls.replaceChildren(); const engine = engineSelect.value;
            this.modelControls(controls, value.models[engine], engine, () => {}, true, 'references', render);
        };
        engineSelect.onchange = render; render();
        this.globalModelRender = render;
        const globalLoras = el('div'); this.loraControls(globalLoras, value, () => {}, value.presets, 'global');
        const models = el('div', {}, el('small', { text: 'One diffusion model for all engines. Encoder, VAE, sampling and adapter options can be configured below for each engine.' }), sharedModel,
            el('small', { text: 'Global LoRAs apply to every operation in every project, before the project style and operation LoRAs.' }), globalLoras, field('Engine options', engineSelect), controls);
        const transfer = el('div', { class: 'amm-button-grid' }, button('Export global settings', () => download('anima-manga-maker-config.json', value)), button('Import global settings', () => chooseFile('.json', files => this.action(async () => {
                const imported = JSON.parse(await files[0].text()); if (!imported.presets || (!imported.models && !imported.defaults)) throw new Error('Invalid settings file');
                value.defaults = imported.defaults || {}; value.models = imported.models || {}; value.loras = imported.loras || []; globalModels(value); value.presets = imported.presets; Object.assign(text, textGeneratorDefaults, imported.text_generator || {}); renderText(); render();
            }))), button('Export project settings', () => download('manga-project-settings.json', { config: this.project?.config || {}, presets: this.project?.presets || {}, layouts: this.project?.layouts || {} })),
            button('Import project settings', () => chooseFile('.json', files => this.action(async () => {
                if (!this.project) throw new Error('Open a project'); const imported = JSON.parse(await files[0].text());
                this.confirm('Replace project settings and presets', async () => { for (const key of ['config', 'presets', 'layouts']) if (imported[key]) this.project[key] = imported[key]; await this.flush(); this.resetViews(); this.switch(this.active); });
            }))));
        const assistantControls = el('div'); assistantSettings(assistantControls, value, error => this.fail(error)).catch(error => this.fail(error));
        const sections = [['General', general], ['Text generator', textControls], ['Story assistant', assistantControls], ['Models', models], ['Import and export', transfer]].map(([title, content]) => el('section', { 'aria-label': title }, el('h3', { text: title }), content));
        const form = el('div', { class: 'amm-settings' }, el('nav', { class: 'amm-settings-nav', 'aria-label': 'Settings sections' },
            ...sections.map(section => button(section.getAttribute('aria-label'), () => section.scrollIntoView({ block: 'start', behavior: 'smooth' })))), el('div', { class: 'amm-settings-sections' }, ...sections));
        const dialog = this.modal('Global settings', form, button('Refresh models and nodes', () => this.action(async () => { this.defs = await api.getNodeDefs(); renderText(); render(); })),
            button('Save global settings', () => this.action(async () => { let savedBeforeMove = true;
                try { await this.flush(); } catch (error) { if (value.root === this.settings.root) throw error; savedBeforeMove = false; }
                globalModels(value);
                this.settings = await request('/settings', value, 'POST'); this.projects = await request('/projects');
                if (!this.projects.some(p => p.id === this.project?.id)) {
                    if (this.project && !savedBeforeMove) throw new Error('The new root folder does not contain the active project. Changes remain in memory; select the folder containing the relocated project.');
                    this.project = null; this.resetViews(); this.empty();
                } else await this.flush();
                this.error.hidden = true; this.resetViews(); this.renderHeader(); this.switch(this.active); dialog.close(); }), { class: 'amm-primary' }));
        dialog.classList.add('amm-settings-dialog');
        dialog.addEventListener('close', () => { this.globalDraft = null; this.globalModelRender = null; });
    }
    modelControls(host, cfg, engine, changed, expanded = false, space = this.active, restoreView = () => this.rebuild(space)) {
        const technical = el('details', { open: expanded }, el('summary', { text: 'Models and advanced settings' }));
        const describe = () => summarize(technical, cfg.model?.split(/[\\/]/).at(-1) || 'No model');
        const set = key => value => { cfg[key] = value; if (!expanded) (cfg.model_overrides ||= {})[key] = value; describe(); changed(); };
        describe();
        if (!expanded) technical.append(el('small', { text: 'The diffusion model always follows Settings → Models. Other changes here affect only this operation.' }));
        const encoderType = combo('Encoder loading type', options(this.defs, 'CLIPLoader', 'type'), cfg.encoder_type, set('encoder_type'));
        technical.append(field('Diffusion model · global', el('input', { value: cfg.model || '', readOnly: true })),
            combo('Text encoder', options(this.defs, 'CLIPLoader', 'clip_name'), cfg.encoder, set('encoder')),
            encoderType,
            combo('VAE', options(this.defs, 'VAELoader', 'vae_name'), cfg.vae, set('vae')));
        if (engine === 'anima_ref') {
            const adapter = el('details', {}, el('summary', { text: 'Anima reference adapter' }),
                combo('Ref Adapter LoRA', options(this.defs, 'AnimaRefAdapterLoader', 'lora_name'), cfg.ref_adapter_lora, set('ref_adapter_lora')));
            for (const [label, key, step, range] of [['Reference guidance', 'ref_guidance', 0.1, [0, 10]], ['Safe PAG scale · 0 disables', 'pag_scale', 0.1, [0, 5]]]) {
                adapter.append(slider(label, el('input', { type: 'number', value: cfg[key], step, onchange: e => set(key)(Number(e.target.value)) }), range));
            }
            technical.append(adapter);
        }
        if (engine === 'anima_snapref') {
            const adapter = el('details', {}, el('summary', { text: 'SnapRef' }),
                combo('SnapRef adapter', options(this.defs, 'SnapRef', 'adapter'), cfg.snapref_adapter, set('snapref_adapter')),
                segmented('SnapRef mode', [['char', 'Character'], ['cs', 'Character & style']], cfg.snapref_mode, set('snapref_mode')),
                slider('Reference attention · log scale, 0 = as trained', el('input', { type: 'number', value: cfg.snapref_strength, step: 0.1, onchange: e => set('snapref_strength')(Number(e.target.value)) }), [-3, 3]),
                slider('Fidelity · lower follows the prompt more', el('input', { type: 'number', value: cfg.snapref_fidelity, step: 0.05, onchange: e => set('snapref_fidelity')(Number(e.target.value)) }), [0, 1]));
            technical.append(adapter);
        }
        technical.append(combo('Weight precision', options(this.defs, 'UNETLoader', 'weight_dtype'), cfg.weight_dtype, set('weight_dtype')),
            combo('Encoder device', options(this.defs, 'CLIPLoader', 'device'), cfg.encoder_device, set('encoder_device')));
        if (this.defs.ModelAttentionBackend) technical.append(combo('Attention backend', options(this.defs, 'ModelAttentionBackend', 'attention'), cfg.attention || defaultAttention(this.defs, engine), set('attention')));
        technical.append(button('Refresh lists', () => this.action(async () => { this.defs = await api.getNodeDefs(); restoreView(); })));
        if (!expanded) technical.append(button('Use global model configuration', () => this.action(async () => {
            this.settings = await request('/settings');
            globalModels(this.settings); cfg.model_overrides = {}; inheritModels(cfg, this.settings.models[engine], engine);
            changed(); restoreView();
        })));
        if (space !== 'sketch') technical.append(button('Reset engine options and sampling', () => this.action(async () => { await this.useDefaultModels(engine); this.resetViews(); this.switch(this.active); })));
        host.append(technical);
        if (!expanded) this.loraControls(host, cfg, changed, this.project.presets, `${space}:${engine}`);
        if (expanded) this.samplingControls(host, cfg, engine, changed, space, true);
    }
    async useDefaultModels(engine) {
        const settings = await request('/settings'); globalModels(settings);
        Object.assign(settings.models[engine], clone(profiles[engine].settings), { model: settings.models.anima.model });
        globalModels(settings);
        this.settings = await request('/settings', settings, 'POST'); this.defs = await api.getNodeDefs();
        if (this.globalDraft) {
            const model = this.globalDraft.models.anima.model;
            this.globalDraft.models[engine] = { ...clone(this.settings.models[engine]), model };
            globalModels(this.globalDraft); this.globalModelRender();
        }
        this.notify(`${engines[engine]} · Engine options and sampling reset`);
    }
    loraControls(host, cfg, changed, presetStore = this.project.presets, scope = `${this.active}:${cfg.engine}`) {
        cfg.loras ||= [];
        const details = el('details', {}, el('summary', { text: `LoRAs · ${cfg.loras.filter(l => l.enabled).length} enabled` }));
        const rows = el('div'); const refresh = () => {
            details.querySelector('summary').textContent = `LoRAs · ${cfg.loras.filter(l => l.enabled).length} enabled`;
            rows.replaceChildren(...cfg.loras.map((l, index) => el('div', { class: `amm-lora${l.enabled ? '' : ' amm-disabled'}` },
                el('div', { class: 'amm-row' }, toggle('Enabled', el('input', { type: 'checkbox', checked: l.enabled, onchange: e => { l.enabled = e.target.checked; changed(); refresh(); } })),
                    iconButton('Move LoRA up', 'up', () => { [cfg.loras[index - 1], cfg.loras[index]] = [l, cfg.loras[index - 1]]; changed(); refresh(); }, { disabled: !index }),
                    iconButton('Move LoRA down', 'down', () => { [cfg.loras[index + 1], cfg.loras[index]] = [l, cfg.loras[index + 1]]; changed(); refresh(); }, { disabled: index === cfg.loras.length - 1 }),
                    iconButton('Remove', 'trash', () => { cfg.loras.splice(index, 1); changed(); refresh(); })),
                combo('LoRA file', options(this.defs, 'LoraLoaderModelOnly', 'lora_name'), l.name, value => { l.name = value; changed(); }),
                slider('Model strength', el('input', { type: 'number', value: l.model, step: 0.05, onchange: e => { l.model = Number(e.target.value); changed(); } }), [0, 2]))));
        }; refresh();
        details.append(rows, iconButton('Add LoRA', 'plus', () => { cfg.loras.push({ enabled: true, name: '', model: 1 }); changed(); refresh(); }, {}, true), el('div', { class: 'amm-row' },
            button('Save LoRA preset', () => this.ask('LoRA preset name', '', name => { const key = scope; (presetStore[key] ||= {})[`LoRAs · ${name}`] = { loras: clone(cfg.loras) }; this.saveSoon(); })),
            button('Load LoRA preset', () => {
                const presets = { ...(this.settings.presets[scope] || {}), ...(presetStore[scope] || {}) };
                const list = el('div');
                const render = () => list.replaceChildren(...Object.entries(presets).filter(([, v]) => v.loras).map(([name, value]) => el('div', { class: 'amm-row' },
                    button(name, () => { cfg.loras = clone(value.loras); changed(); refresh(); }),
                    iconButton(`Clone LoRA preset ${name}`, 'copy', () => this.clonePreset(presets, name, (copyName, copy) => {
                        (presetStore[scope] ||= {})[copyName] = copy; presets[copyName] = copy; render();
                    })))));
                render(); this.modal('LoRA presets', list);
            })), el('small', { text: 'Applied to the sampler model in this order. A registered selection does not guarantee checkpoint compatibility.' })); host.append(details);
    }
    samplingControls(host, cfg, engine, changed, space, global = false) {
        const group = el('details', {}, el('summary', { text: 'Sampling' }));
        const describe = () => summarize(group, `${cfg.steps} steps · ${cfg.sampler || 'no sampler'}`);
        const set = (key, value) => { cfg[key] = value; if (!global && modelFields.includes(key)) (cfg.model_overrides ||= {})[key] = value; describe(); changed(); };
        describe();
        for (const [label, key, step, range] of [['Steps', 'steps', 1, [1, 50]], ['CFG', 'cfg', 0.1, [0, 10]]]) {
            group.append(slider(label, el('input', { type: 'number', value: cfg[key], step, onchange: e => set(key, Number(e.target.value)) }), range));
        }
        if (space === 'sketch' && !global) group.append(slider('Denoise', el('input', { type: 'number', 'aria-label': 'Denoise', value: cfg.denoise, min: 0, max: 1, step: 0.05,
            onchange: e => { const value = Number(e.target.value); if (Number.isFinite(value)) set('denoise', value); } }), [0, 1], 'Lower values preserve more of the drawing.'));
        group.append(combo('Sampler', options(this.defs, 'KSampler', 'sampler_name'), cfg.sampler, value => set('sampler', value)),
            combo('Scheduler', options(this.defs, 'KSampler', 'scheduler'), cfg.scheduler, value => set('scheduler', value)));
        if (!global) group.append(field('Negative prompt', el('textarea', { value: cfg.negative, oninput: e => { cfg.negative = e.target.value; changed(); } })));
        host.append(group);
    }
    alphaControls(host, cfg, engine, changed) {
        if (!alphaMethods[engine]) return;
        if (!alphaMethods[engine].includes(cfg.alpha)) cfg.alpha = '';
        const set = key => value => { cfg[key] = value; (cfg.model_overrides ||= {})[key] = value; changed(); };
        const files = el('div');
        const render = () => files.replaceChildren(...cfg.alpha === 'lora' ? [combo('Alpha LoRA', options(this.defs, 'LoraLoaderModelOnly', 'lora_name'), cfg.alpha_lora, set('alpha_lora')),
            combo('RGBA VAE', options(this.defs, 'VAELoader', 'vae_name'), cfg.alpha_vae, set('alpha_vae'))] : []);
        host.append(segmented('Transparency', [['', 'Off'], ['lora', 'Alpha LoRA'], ['chromakey', 'Chroma key']], cfg.alpha, value => { cfg.alpha = value; changed(); render(); }),
            el('small', { text: 'Alpha LoRA (localai0301/Anima-RGBA) decodes straight RGBA with its VAE; the prompt asks for a transparent background. Chroma key asks for a flat indigo background and removes it with VNCCS Chroma Key.' }), files);
        render();
    }
    presetChanged(space, host = this.views.get(space)) {
        const state = this.state(space);
        if (state.preset && !state.preset_modified) {
            state.preset_modified = true;
            const select = host?.querySelector('[aria-label="Prompt and settings preset"]');
            if (select?.value === state.preset) select.selectedOptions[0].textContent = `${state.preset} · Modified`;
        }
        this.saveSoon();
    }
    presets(host, space, cfg, builtins = {}, refresh = () => this.rebuild(space)) {
        const key = `${space}:${cfg.engine}`; const named = { ...builtins, ...(this.settings.presets[key] || {}), ...(this.project.presets[key] || {}) };
        const select = el('select', { 'aria-label': 'Prompt and settings preset', onchange: e => {
            if (!e.target.value) { this.state(space).preset = ''; this.state(space).preset_modified = false; this.saveSoon(); refresh(); return; }
            const preset = named[e.target.value];
            const value = builtins[e.target.value] === preset ? { ...preset, prompt_sections: { ...cfg.prompt_sections, ...preset.prompt_sections,
                ...(space === 'references' && cfg.prompt_sections?.style?.trim() ? { style: cfg.prompt_sections.style } : {}) } } : preset;
            applyPreset(cfg, value); inheritModels(cfg, this.settings.models[cfg.engine], cfg.engine);
            this.state(space).preset = e.target.value; this.state(space).preset_modified = false; this.saveSoon(); refresh();
        } }, el('option', { value: '', text: 'Preset…' }), ...Object.keys(named).map(name => el('option', { value: name, text: name })));
        select.value = this.state(space).preset || '';
        if (select.value && this.state(space).preset_modified) select.selectedOptions[0].textContent = `${select.value} · Modified`;
        host.append(el('div', { class: 'amm-preset' }, field('Preset · changing settings creates a variant', select), el('div', { class: 'amm-row' }, iconButton('Save settings as preset', 'save', () => this.ask('Preset name', this.state(space).preset || '', name => { (this.project.presets[key] ||= {})[name] = savedPreset(cfg); this.state(space).preset = name; this.state(space).preset_modified = false; this.saveSoon(); refresh(); })),
            iconButton('Clone preset', 'copy', () => this.clonePreset(named, select.value, (name, value) => {
                (this.project.presets[key] ||= {})[name] = value; this.state(space).preset = name; refresh();
            }), { disabled: !select.value }),
            iconButton('Export presets', 'download', () => download(`manga-${key.replace(':', '-')}-presets.json`, { scope: key, presets: named })), iconButton('Import presets', 'upload', () => chooseFile('.json', files => this.action(async () => {
                const imported = JSON.parse(await files[0].text()); if (imported.scope !== key || !imported.presets) throw new Error('This preset belongs to a different operation or engine');
                this.project.presets[key] = { ...(this.project.presets[key] || {}), ...imported.presets }; this.saveSoon(); refresh();
            }))))));
    }
    engineSelect(host, space) {
        const state = this.state(space);
        const select = el('select', { 'aria-label': 'Engine', onchange: e => { state.engine = e.target.value; this.saveSoon(); this.rebuild(space); } },
            ...Object.entries(engines).map(([value, text]) => el('option', { value, text }))); select.value = state.engine;
        host.append(field('Engine', select));
    }
    essentials(host, cfg, space) {
        const changed = () => this.presetChanged(space);
        this.promptControls(host, cfg, changed, space); this.artistControls(host, cfg, changed);
        host.append(el('div', { class: 'amm-size-controls' })); this.resolutionControls(host, cfg, space);
        this.samplingControls(host, cfg, cfg.engine, changed, space); this.modelControls(host, cfg, cfg.engine, changed, false, space);
    }
    // Anima Artist Mixer: artists from the chain are mixed into the model; an empty chain keeps plain text encoding.
    artistControls(host, cfg, changed) {
        const details = el('details', {}, el('summary', { text: 'Artist Mixer' }));
        const describe = () => summarize(details, cfg.artist_chain?.trim() ? cfg.artist_chain.trim().slice(0, 40) : 'Off');
        const chain = el('textarea', { value: cfg.artist_chain || '', rows: 2, 'aria-label': 'Artist chain', placeholder: '@artist, @another artist::0.6',
            oninput: e => { cfg.artist_chain = e.target.value; describe(); changed(); } });
        details.append(field('Artist chain', chain, 'Comma-separated Animadex artists, optionally weighted as @name::0.6. Requires Anima-Artist-Mixer.'),
            iconButton('Browse Animadex artists', 'image', () => openStylePicker(this, 'animadex', (key, update) => {
                if (key !== 'style') return;
                chain.value = cfg.artist_chain = update(chain.value); describe(); changed();
            }), {}, true),
            slider('Mixer strength', el('input', { type: 'number', 'aria-label': 'Mixer strength', value: cfg.artist_strength ?? 1, step: 0.05, onchange: e => { cfg.artist_strength = Number(e.target.value); changed(); } }), [0, 4]));
        describe(); host.append(details);
    }
    // ControlNet-LLLite controls: each pairs a model patch with a control image from the project.
    controlStack(host, cfg, space) {
        cfg.controls ||= [];
        const changed = () => this.presetChanged(space);
        const details = el('details', {}, el('summary', { text: 'Controls · LLLite' }));
        const rows = el('div');
        const refresh = () => {
            summarize(details, `${cfg.controls.filter(c => c.enabled).length} enabled`);
            rows.replaceChildren(...cfg.controls.map((c, index) => {
                const asset = this.project.assets.find(a => a.id === c.image), scene = c.scene && this.project.workspace.scenes?.find(s => s.id === c.scene.scene);
                const number = (label, key, range, step) => slider(label, el('input', { type: 'number', 'aria-label': label, value: c[key], step, onchange: e => { c[key] = Number(e.target.value); changed(); } }), range);
                return el('div', { class: `amm-lora${c.enabled ? '' : ' amm-disabled'}` },
                    el('div', { class: 'amm-row' }, toggle('Enabled', el('input', { type: 'checkbox', checked: c.enabled, onchange: e => { c.enabled = e.target.checked; changed(); refresh(); } })),
                        iconButton('Move control up', 'up', () => { [cfg.controls[index - 1], cfg.controls[index]] = [c, cfg.controls[index - 1]]; changed(); refresh(); }, { disabled: !index }),
                        iconButton('Move control down', 'down', () => { [cfg.controls[index + 1], cfg.controls[index]] = [c, cfg.controls[index + 1]]; changed(); refresh(); }, { disabled: index === cfg.controls.length - 1 }),
                        iconButton('Remove control', 'trash', () => { cfg.controls.splice(index, 1); changed(); refresh(); })),
                    controlTypes[c.type] ? el('small', { text: `${controlTypes[c.type].label} · ${controlTypes[c.type].hint}` }) : null,
                    combo('Control model', options(this.defs, 'ModelPatchLoader', 'name'), c.patch, value => { c.patch = value; changed(); }),
                    el('div', { class: 'amm-row amm-control-image' }, asset ? el('img', { src: assetUrl(this.project.id, asset.id, true), alt: asset.name, class: 'amm-control-thumb' }) : null,
                        el('small', { text: c.scene ? `Scene · ${scene ? `${scene.name} · ${c.scene.camera}` : 'deleted scene'} · ${sceneMap(c.type)}` : asset ? `${asset.name}${asset.missing ? ' · Missing file' : ''}` : 'No control image' }),
                        iconButton('Choose control image', 'image', () => this.chooseImage('Choose control image', ref => { c.image = ref; delete c.scene; changed(); refresh(); this.jobs(); return true; })),
                        // A scene camera is rendered at the output size on every generation, so edits to the scene reach the next panel.
                        button('From scene…', () => this.action(async () => {
                            const choice = await sceneEditor(this, c.scene, imageDimensions(cfg), true); if (!choice) return;
                            c.scene = choice; c.image = ''; changed(); refresh();
                        }))),
                    number('Control strength', 'strength', [0, 2], 0.05), number('Start · fraction of denoising', 'start', [0, 1], 0.01), number('End · fraction of denoising', 'end', [0, 1], 0.01));
            }));
        };
        // A type fills the benchmarked model and range; the installed copy is found by filename in any subfolder.
        const add = el('select', { 'aria-label': 'Add control', onchange: () => {
            const { patch, strength, start, end } = controlTypes[add.value] || { patch: '', strength: 1, start: 0, end: 1 };
            cfg.controls.push({ type: add.value, enabled: true, patch: options(this.defs, 'ModelPatchLoader', 'name').find(name => name.split('/').at(-1) === patch) || patch, image: '', strength, start, end });
            add.value = ''; changed(); refresh();
        } }, el('option', { value: '', text: 'Add control…' }), ...Object.entries(controlTypes).map(([value, type]) => el('option', { value, text: type.label })), el('option', { value: 'custom', text: 'Other LLLite model' }));
        details.append(rows, field('Add control', add),
            el('small', { text: 'Anima ControlNet-LLLite models from models/model_patches, such as a 3D pose render or a regional color map as the control image. The image is center-cropped to the output size. With Anima Ref, controls need ComfyUI-Anima-CharRef-LLLite.' }));
        refresh(); host.append(details);
    }
    runBar(host, cfg, space, label, operation = space) {
        host.append(el('div', { class: 'amm-run-bar' }, seed('Seed', cfg, () => this.presetChanged(space), 'Random seed for each generation'),
            button(label, () => this.action(() => this.run(operation)), { class: 'amm-primary', 'data-run': operation }), el('small', { class: 'amm-run-hint' })));
    }
    promptControls(host, cfg, changed, space) {
        const sections = cfg.prompt_sections ||= {};
        const preview = el('textarea', { class: 'amm-prompt-preview', readOnly: true, 'aria-label': 'Combined prompt' });
        let previewTimer;
        const combined = el('details', { class: 'amm-prompt-combined', ontoggle: () => {
            clearTimeout(previewTimer);
            if (combined.open) preview.value = composePrompt(this.styled(cfg));
        } }, el('summary', { text: 'Show combined prompt' }), preview);
        const update = () => {
            changed();
            clearTimeout(previewTimer);
            if (combined.open) previewTimer = setTimeout(() => {
                if (combined.isConnected && combined.open) preview.value = composePrompt(this.styled(cfg));
            }, 150);
        };
        const group = el('details', { class: 'amm-prompt-sections', open: true }, el('summary', { text: 'Structured prompt' }),
            el('small', { text: 'Edit only the sections you want to change. Empty fields are omitted; other sections retain their content.' }));
        const snippet = value => value?.trim() ? value.trim().slice(0, 48) : 'Empty';
        const filled = () => summarize(group, `${promptSections.filter(([key]) => sections[key]?.trim()).length} / ${promptSections.length} filled`);
        const enhanceField = (input, key, label) => space ? el('div', { class: 'amm-prompt-field' }, input,
            iconButton(`Enhance ${label}`, 'sparkles', () => this.action(() => this.run('enhance', space, null, key)),
                { 'data-run': 'enhance', title: 'Enhance this field with the global text generator' })) : input;
        const task = combo('TASK', ['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE'], sections.task, value => { sections.task = value; update(); });
        task.querySelector('input').placeholder = 'TEXT_TO_IMAGE';
        task.querySelector('input').addEventListener('input', e => { sections.task = e.target.value; update(); });
        group.append(task);
        const inputs = {}, inherited = this.projectStyle(), shared = inherited || (space !== 'style' && Object.keys(this.styleSettings()).length);
        let showStyle = () => {};
        group.append(el('div', { class: 'amm-row' }, ...['animadex', 'stylebook'].map(source => iconButton(source === 'animadex' ? 'Browse Animadex styles and characters' : 'Browse Stylebook styles', 'image',
            () => openStylePicker(this, source, (key, update) => {
                if (key === 'style' && inherited && !cfg.style_override) { cfg.style_override = true; showStyle(); }
                const input = inputs[key]; input.value = update(input.value);
                input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('change')); input.closest('details').open = true;
            }), {}, true))));
        for (const [key, tag] of promptSections) {
            const status = el('small', { text: snippet(sections[key]), class: sections[key]?.trim() ? 'amm-filled' : '' });
            const input = el('textarea', { value: sections[key] || '', rows: 3, 'aria-label': tag, oninput: e => {
                sections[key] = e.target.value;
                if (status.classList.contains('amm-filled') !== !!e.target.value.trim()) { status.textContent = snippet(e.target.value); status.classList.toggle('amm-filled'); filled(); }
                update();
            }, onchange: e => { status.textContent = snippet(e.target.value); } });
            inputs[key] = input;
            // The project style fills this section until the operation overrides it; the operation's own text is kept for when it does.
            const useProject = key === 'style' && shared ? el('input', { type: 'checkbox', checked: !cfg.style_override, onchange: e => { cfg.style_override = !e.target.checked; showStyle(); update(); } }) : null;
            if (useProject) showStyle = () => {
                useProject.checked = !cfg.style_override; input.disabled = useProject.checked; input.value = useProject.checked ? inherited : sections.style || '';
                status.textContent = useProject.checked ? `Project · ${snippet(inherited)}` : snippet(sections.style); status.classList.toggle('amm-filled', !!input.value.trim());
            };
            group.append(el('details', { class: 'amm-prompt-section' }, el('summary', {}, el('span', { text: tag }), status),
                useProject ? toggle('Use project style', useProject, 'Also applies the Style workspace\'s LoRAs, Artist Mixer, tag sliders, text encoder and VAE. Turn off to style this operation on its own.') : null, enhanceField(input, key, tag)));
        }
        const free = el('textarea', { class: 'amm-prompt', value: cfg.prompt || '', placeholder: 'Additional text or any prompt outside this format…', oninput: e => { cfg.prompt = e.target.value; update(); } });
        group.querySelector('summary').append(iconButton('Clear prompt', 'clear', e => {
            e.preventDefault(); e.stopPropagation();
            for (const key of Object.keys(sections)) delete sections[key];
            cfg.prompt = ''; free.value = ''; preview.value = '';
            for (const input of group.querySelectorAll('input, textarea')) input.value = '';
            for (const status of group.querySelectorAll('.amm-prompt-section summary small')) { status.textContent = 'Empty'; status.classList.remove('amm-filled'); }
            showStyle(); clearTimeout(previewTimer); filled(); changed();
        }, { class: 'amm-icon-button amm-prompt-clear', title: 'Clear TASK, all sections, and the free prompt' }));
        showStyle(); filled(); host.append(group, field('Free prompt', enhanceField(free, 'free', 'free prompt')), combined);
        tagSliderControls(host, cfg, changed, !!this.defs.AnimaTagSliders);
    }
    downloadImageAction(asset) {
        return iconButton('Download image', 'download', () => {
            this.closeAssetMenu();
            el('a', { href: assetUrl(this.project.id, asset.id) + '?original=1', download: '' }).click();
        }, { role: 'menuitem', class: 'amm-menu-item', disabled: !!asset.missing }, true);
    }
    referencePromptAction(asset, space) {
        const available = !!referencePrompt(asset);
        return iconButton('Use image prompt', 'pencil', () => {
            this.closeAssetMenu();
            const saved = referencePrompt(asset);
            if (!saved) return;
            Object.assign(this.config(space), saved);
            this.presetChanged(space); this.rebuild(space);
        }, { role: 'menuitem', class: 'amm-menu-item', disabled: !available,
            title: available ? 'Fill the sections and free prompt for this operation' : 'This image has no recoverable prompt' }, true);
    }
    describeReferenceAction(asset, space) {
        return iconButton('Create prompt from image', 'sparkles', () => {
            this.closeAssetMenu(); this.action(() => this.run('describe', space, asset.id));
        }, { role: 'menuitem', class: 'amm-menu-item', 'data-run': 'describe', 'data-text-source': asset.id,
            disabled: asset.missing || !this.textGeneratorAvailable(),
            title: 'Analyze this reference with the global CLIP and create a structured prompt' }, true);
    }
    textGeneratorAvailable() {
        const config = { ...textGeneratorDefaults, ...this.settings.text_generator };
        return !!this.defs.TextGenerate && !!this.defs.SaveText && options(this.defs, 'CLIPLoader', 'clip_name').includes(config.encoder)
            && options(this.defs, 'CLIPLoader', 'type').includes(config.encoder_type);
    }
    resolutionControls(host, cfg, space) {
        const box = host.querySelector('.amm-size-controls');
        const id = referenceLimits[cfg.engine] ? cfg.references[0] : null;
        const source = this.project.assets.find(a => a.id === id);
        const inherited = !!source && cfg.size_mode !== 'manual';
        const changed = () => this.presetChanged(space);
        const mode = segmented('Output size', [['original', 'Inherit from original', null, !source], ['manual', 'Manual · AR and MP']], inherited ? 'original' : 'manual',
            value => { cfg.size_mode = value; changed(); this.resolutionControls(host, cfg, space); });
        box.replaceChildren(mode, sizeControls(inherited ? source : cfg, size => { Object.assign(cfg, size, { size_mode: 'manual' }); changed(); }, inherited),
            el('small', { text: inherited ? `Inherited from ${source.name}, the first reference.` : 'Select the aspect ratio and resolution in megapixels.' }));
    }
    references(host, space, cfg, slot = host) {
        const limit = referenceLimits[cfg.engine];
        if (!limit) { slot.append(el('small', { text: 'Text-to-image workflow. Reuse a saved reference prompt from its image menu to guide generation.' })); return; }
        const box = el('details', { open: true }, el('summary', { text: 'Connected visual references' }));
        const list = el('div', { class: 'amm-reference-strip' });
        const refresh = () => {
            this.resolutionControls(host, cfg, space);
            list.replaceChildren(...cfg.references.map((id, i) => {
                const a = this.project.assets.find(a => a.id === id);
                const card = el('div', { 'data-asset-id': id }, el('img', { src: assetUrl(this.project.id, id, true), alt: a?.name || 'Missing', loading: 'lazy' }),
                    el('small', { text: `${i + 1}. ${a?.name || 'Missing'}${a?.missing ? ' · Missing file' : ''}` }), el('div', { class: 'amm-row' },
                        iconButton('Move reference up', 'left', () => { [cfg.references[i - 1], cfg.references[i]] = [id, cfg.references[i - 1]]; this.presetChanged(space); refresh(); }, { disabled: !i }),
                        iconButton('Move reference down', 'right', () => { [cfg.references[i + 1], cfg.references[i]] = [id, cfg.references[i + 1]]; this.presetChanged(space); refresh(); }, { disabled: i === cfg.references.length - 1 }),
                        iconButton('Remove', 'clear', () => { cfg.references.splice(i, 1); this.presetChanged(space); refresh(); })));
                if (a) {
                    const actions = el('div', { id: `amm-reference-menu-${space}-${id}`, class: 'amm-asset-menu', popover: 'manual', role: 'menu', 'aria-label': `Actions for ${a.name}` }, this.downloadImageAction(a), this.referencePromptAction(a, space));
                    if (a.kind === 'references') actions.append(this.describeReferenceAction(a, space));
                    this.assetContextMenu(card, actions);
                }
                return card;
            }));
        }; refresh(); this.referenceRefresh.set(space, refresh);
        box.append(list, iconButton('Choose references', 'link', () => this.chooseImage('Connect references', ref => {
            if (!cfg.references.includes(ref) && cfg.references.length < limit) { cfg.references.push(ref); this.presetChanged(space); }
            refresh(); this.jobs(); return false;
        }, ref => cfg.references.length >= limit && !cfg.references.includes(ref)), {}, true));
        box.append(el('small', { text: cfg.engine === 'anima_ref'
            ? 'Anima Ref: connect one to four references; they are placed side by side as one reference. Character and style come from them, so describe only the scene, pose and framing in the prompt.'
            : 'SnapRef: connect up to eight pictures of one character, or up to three different characters. Character mode keeps the style from the model and prompt; Character & style also takes the art style.' }));
        if (cfg.engine === 'anima_snapref') box.append(segmented('SnapRef references', [['separate', 'Same character'], ['stitch', 'Different characters']], cfg.snapref_layout || 'separate',
            value => { cfg.snapref_layout = value; this.presetChanged(space); }),
            el('small', { text: 'Same character merges the pictures into one identity. Different characters places them side by side, as Anima Ref does, left to right in reference order; say who is on the left and who is on the right in the prompt. For a character that still blends, mask it in the drawing editor and use Inpaint with SnapRef.' }));
        slot.append(box);
    }
    // Picks a project image, or imports one from ComfyUI's input folder or the computer into References and picks it in the same step.
    // `pick` gets the asset id and returns true to close the picker; `disabled` greys out images that cannot be added.
    chooseImage(title, pick, disabled = () => false) {
        const choose = id => { if (pick(id)) dialog.close(); else update(); };
        const project = el('div', { class: 'amm-asset-picker' });
        const renderProject = () => project.replaceChildren(...this.project.assets.filter(a => !a.missing).map(a => this.assetPickerItem(a, () => choose(a.id))));
        const importImage = async (blob, filename) => {
            const form = new FormData(); form.append('image', blob, filename); form.append('kind', 'references'); form.append('name', filename.split('/').at(-1).replace(/\.[^.]+$/, ''));
            const projectId = this.project.id, asset = await request(`/projects/${projectId}/import`, form, 'POST');
            if (this.project.id !== projectId) return;
            this.project.assets.push(asset); this.galleryRefresh.forEach(render => render()); renderProject(); choose(asset.id);
        };
        const inputs = el('div', { class: 'amm-asset-picker' }), search = el('input', { type: 'search', placeholder: 'Search ComfyUI input images…', 'aria-label': 'Search ComfyUI input images' });
        const files = options(this.defs, 'LoadImage', 'image');
        const renderInputs = () => {
            const term = search.value.toLowerCase(), matches = files.filter(name => name.toLowerCase().includes(term));
            inputs.replaceChildren(...matches.slice(0, 120).map(name => {
                const b = button('', () => this.action(async () => {
                    const response = await fetch(inputUrl(name)); if (!response.ok) throw new Error(`Could not read ${name} from ComfyUI's input folder.`);
                    await importImage(await response.blob(), name);
                }), { 'data-input': name });
                b.append(el('img', { src: inputUrl(name), alt: name, loading: 'lazy' }), el('span', { text: name })); return b;
            }), ...matches.length > 120 ? [el('small', { text: `${matches.length - 120} more · refine the search` })] : []);
        };
        const update = () => { for (const b of project.children) b.disabled = disabled(b.dataset.assetId); for (const b of inputs.querySelectorAll('button')) b.disabled = disabled(null); upload.disabled = disabled(null); };
        search.oninput = () => { renderInputs(); update(); };
        const upload = iconButton('Upload from computer', 'upload', () => chooseFile('image/*', files => this.action(async () => {
            for (const file of files) { if (!dialog.open) return; await importImage(file, file.name); }
        }), true), {}, true);
        const dialog = this.modal(title, el('div', {}, el('div', { class: 'amm-row' }, upload, el('small', { text: 'Images from the computer or ComfyUI\'s input folder are added to References and connected in one step.' })),
            el('h3', { text: 'Project' }), project, el('h3', { text: 'ComfyUI input' }), search, inputs));
        renderProject(); renderInputs(); update();
    }
    assetPickerItem(a, action) { const b = button('', action, { 'data-asset-id': a.id }); b.append(el('img', { src: assetUrl(this.project.id, a.id, true), alt: a.name, loading: 'lazy' }), el('span', { text: `${a.name} · ${a.kind}` })); return b; }
    controlLayout(view, controls, space) {
        const state = this.state(space); controls.hidden = !!state.controlsCollapsed;
        if (state.controlWidth) controls.style.width = `${state.controlWidth}px`;
        const toggleControls = iconButton('Show or hide controls', 'sidebar', () => {
            controls.hidden = !controls.hidden; state.controlsCollapsed = controls.hidden; toggleControls.setAttribute('aria-pressed', String(!controls.hidden)); this.saveSoon();
        }, { class: 'amm-icon-button amm-controls-toggle', 'aria-pressed': String(!controls.hidden) });
        view.prepend(el('div', { class: 'amm-rail' }, toggleControls)); controls.after(resizer(controls, 'Resize controls'));
        const observer = new ResizeObserver(entries => { const width = Math.round(controls.getBoundingClientRect().width); if (width > 100 && state.controlWidth !== width) { state.controlWidth = width; this.saveSoon(); } });
        observer.observe(controls); this.observers.push(observer);
    }
    generateView(view, space) {
        const controls = el('aside', { class: 'amm-controls' }, el('h2', { text: space === 'references' ? 'Create references' : 'Generate panels' }));
        this.engineSelect(controls, space);
        const cfg = this.config(space); cfg.engine = this.state(space).engine;
        this.presets(controls, space, cfg, space === 'references' ? referencePresets : {});
        const slot = el('div'), controlSlot = el('div'); controls.append(slot, controlSlot);
        this.essentials(controls, cfg, space); this.references(controls, space, cfg, slot); this.controlStack(controlSlot, cfg, space);
        this.runBar(controls, cfg, space, space === 'references' ? 'Generate reference' : 'Generate panel');
        const gallery = el('section', { class: 'amm-gallery-area' }); view.append(controls, gallery); this.gallery(gallery, space === 'references' ? 'references' : 'panels', space); this.controlLayout(view, controls, space);
    }
    assetContextMenu(card, actions) {
        actions.tabIndex = -1;
        const trigger = iconButton('Image actions', 'more', e => openMenu(e), { class: 'amm-icon-button amm-asset-trigger', 'aria-haspopup': 'menu', 'aria-controls': actions.id, 'aria-expanded': 'false' });
        const openMenu = e => {
            e.preventDefault();
            if (actions.matches(':popover-open')) { this.closeAssetMenu(); return; }
            this.closeAssetMenu(); trigger.focus({ preventScroll: true }); actions.showPopover(); this.assetMenu = actions;
            const anchor = trigger.getBoundingClientRect(), menu = actions.getBoundingClientRect();
            const x = e.type === 'contextmenu' ? e.clientX : anchor.right - menu.width;
            const y = e.type === 'contextmenu' ? e.clientY : anchor.bottom + 4;
            actions.style.left = `${Math.max(8, Math.min(x, innerWidth - menu.width - 8))}px`;
            actions.style.top = `${Math.max(8, Math.min(y, innerHeight - menu.height - 8))}px`;
            (actions.querySelector('button:not(:disabled)') || actions).focus({ preventScroll: true });
        };
        actions.addEventListener('toggle', e => { trigger.setAttribute('aria-expanded', String(e.newState === 'open')); if (e.newState === 'closed' && this.assetMenu === actions) this.assetMenu = null; });
        actions.addEventListener('keydown', e => {
            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeAssetMenu(); trigger.focus({ preventScroll: true }); }
            if (e.key === 'Tab') this.closeAssetMenu();
            if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
            e.preventDefault(); const items = [...actions.querySelectorAll('button:not(:disabled)')], index = items.indexOf(document.activeElement);
            if (!items.length) return;
            items[e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
        });
        card.addEventListener('contextmenu', openMenu);
        card.append(trigger, actions);
    }
    gallery(host, kind, space, compact = false) {
        const state = this.state(space); const bar = el('div', { class: 'amm-gallery-toolbar' }), grid = el('div', { class: 'amm-gallery-grid' }), pager = el('div', { class: 'amm-row amm-pager' });
        const pending = el('div', { class: 'amm-gallery-grid amm-pending-grid' }), selection = el('div', { class: 'amm-selection-bar', role: 'toolbar', 'aria-label': 'Selection actions' });
        const setThumb = () => host.style.setProperty('--amm-thumb', `${state.thumb || 185}px`); setThumb();
        let visible = [];
        const render = () => {
            let assets = this.project.assets.filter(a => a.kind === kind);
            const term = (state.search || '').toLowerCase(); assets = assets.filter(a => `${a.name} ${(a.tags || []).join(' ')}`.toLowerCase().includes(term));
            if (state.filter === 'originals') assets = assets.filter(a => !a.parent);
            if (state.filter === 'versions') assets = assets.filter(a => a.parent);
            if (state.filter === 'missing') assets = assets.filter(a => a.missing);
            assets.sort(state.sort === 'name' ? (a, b) => a.name.localeCompare(b.name) : state.sort === 'oldest' ? (a, b) => a.created - b.created : state.sort === 'order' ? (a, b) => (a.order || 0) - (b.order || 0) : (a, b) => b.created - a.created);
            const totalPages = Math.max(1, Math.ceil(assets.length / 48)); state.page = Math.min(state.page || 0, totalPages - 1); visible = assets;
            grid.classList.toggle('amm-selecting', state.selection.length > 0);
            grid.replaceChildren(...assets.slice(state.page * 48, (state.page + 1) * 48).map(a => {
                const checkbox = el('input', { type: 'checkbox', checked: state.selection.includes(a.id), 'aria-label': `Select ${a.name}`, onchange: e => {
                    state.selection = e.target.checked ? [...new Set([...state.selection, a.id])] : state.selection.filter(id => id !== a.id); this.saveSoon(); render();
                } });
                const image = el('img', { src: assetUrl(this.project.id, a.id, true), alt: a.name, loading: 'lazy', decoding: 'async', draggable: false });
                const preview = button('', () => this.preview(a, visible), { 'aria-label': `Preview ${a.name}` }); preview.className = 'amm-thumbnail'; preview.append(image);
                const card = el('article', { class: `amm-asset ${state.selection.includes(a.id) ? 'amm-selected' : ''}`, draggable: a.kind === 'panels', ondragstart: e => { e.dataTransfer.setData('application/x-manga-asset', a.id); e.dataTransfer.effectAllowed = 'copy'; } },
                    checkbox, preview, el('strong', { text: a.name, title: a.name }), el('small', { text: `${sizeLabel(a)} · ${a.parent ? 'Version' : 'Original'} ${a.version}${a.missing ? ' · Missing file' : ''}` }));
                const actions = el('div', { id: `amm-menu-${space}-${a.id}`, class: 'amm-asset-menu', popover: 'manual', role: 'menu', 'aria-label': `Actions for ${a.name}` });
                const addAction = (label, name, action, danger = false) => actions.append(iconButton(label, name, () => { this.closeAssetMenu(); action(); }, { role: 'menuitem', class: `amm-menu-item${danger ? ' amm-danger' : ''}` }, true));
                actions.append(this.downloadImageAction(a));
                addAction('Rename', 'pencil', () => this.ask('Image name', a.name, async name => { await this.patchAssets({ [a.id]: { name } }); render(); }));
                addAction('Settings', 'info', () => this.assetSettings(a));
                if (!['design', 'refine'].includes(space)) actions.append(this.referencePromptAction(a, space));
                if (a.kind === 'references') actions.append(this.describeReferenceAction(a, space));
                if (['references', 'panels'].includes(a.kind)) addAction('Draw with Klecks', 'pencil', () => openDrawing(this, a.kind, a));
                addAction('Upscale', 'wand', () => this.upscaleDialog(a));
                if (['references', 'panels'].includes(a.kind)) addAction('Use with Anima Ref', 'link', () => {
                    this.state(a.kind).engine = 'anima_ref'; this.config(a.kind, 'anima_ref').references = [a.id];
                    this.rebuild(a.kind); this.switch(a.kind); this.saveSoon();
                });
                if (space !== 'refine') addAction('Refine with Qwen', 'wand', () => { this.state('refine').source = a.id; this.saveSoon(); this.rebuild('refine'); this.switch('refine'); });
                if (space === 'refine') addAction('Use as original', 'image', () => { this.state('refine').source = a.id; this.saveSoon(); this.rebuild('refine'); });
                else if (space === 'design') addAction('Place', 'place', () => { if (!this.editor?.panel) this.editor.addPanel(); this.editor.change(() => this.editor.panel.asset = a.id); this.editor.loadImages(); });
                else addAction('Use as reference', 'link', () => {
                    const cfg = this.config(space);
                    if (!cfg.references.includes(a.id)) {
                        const limit = referenceLimits[cfg.engine];
                        if (!limit) { this.fail(new Error('Choose Anima Ref or Anima SnapRef to connect references.')); return; }
                        if (cfg.references.length >= limit) { this.fail(new Error(`${engines[cfg.engine]} supports up to ${limit} references. Remove one before adding another.`)); return; }
                        cfg.references.push(a.id); this.presetChanged(space);
                    }
                    this.saveSoon(); this.rebuild(space);
                });
                addAction('Delete', 'trash', () => this.confirm(`Delete image · ${a.name}`, () => this.deleteAssets([a.id]), deleteWarning), true);
                card.dataset.assetId = a.id; this.assetContextMenu(card, actions); return card;
            }));
            if (!assets.length) grid.append(el('div', { class: 'amm-empty', text: 'This gallery is empty. Import images or generate your first result.' }));
            pager.replaceChildren(iconButton('Previous', 'left', () => { state.page--; render(); this.saveSoon(); }, { disabled: state.page === 0 }), el('span', { text: `${state.page + 1} / ${totalPages} · ${assets.length} images` }), iconButton('Next', 'right', () => { state.page++; render(); this.saveSoon(); }, { disabled: state.page >= totalPages - 1 }));
            selection.hidden = !state.selection.length; selection.firstChild.textContent = `${state.selection.length} selected`;
        };
        bar.append(el('h2', { text: spaces[kind] || 'Pages' }), iconButton('Import images', 'upload', () => this.importImages(kind)),
            ['references', 'panels'].includes(kind) ? iconButton(kind === 'references' ? 'Draw reference' : 'Draw panel', 'pencil', () => openDrawing(this, kind)) : '',
            el('input', { type: 'search', placeholder: 'Search by name or tag…', value: state.search, 'aria-label': 'Search images', oninput: e => { state.search = e.target.value; state.page = 0; render(); this.saveSoon(); } }));
        const sort = el('select', { 'aria-label': 'Sort', onchange: e => { state.sort = e.target.value; state.page = 0; render(); this.saveSoon(); } },
            ...Object.entries({ newest: 'Newest first', oldest: 'Oldest first', name: 'Name', order: 'Manual order' }).map(([value, text]) => el('option', { value, text }))); sort.value = state.sort;
        bar.append(sort, iconButton('Select visible', 'check', () => { state.selection = [...grid.querySelectorAll('article')].map(card => card.dataset.assetId); render(); this.saveSoon(); }),
            iconButton('Collapse gallery', 'collapse', () => { grid.hidden = !grid.hidden; pager.hidden = grid.hidden; state.collapsed = grid.hidden; this.saveSoon(); }),
            segmented('Filter', Object.entries({ all: 'All', originals: 'Originals', versions: 'Versions', missing: 'Missing' }), state.filter, value => { state.filter = value; state.page = 0; render(); this.saveSoon(); }),
            el('input', { type: 'range', class: 'amm-thumb-size', min: 110, max: 340, step: 5, value: state.thumb || 185, 'aria-label': 'Thumbnail size', title: 'Thumbnail size',
                oninput: e => { state.thumb = Number(e.target.value); setThumb(); }, onchange: () => this.saveSoon() }));
        selection.append(el('strong'), iconButton('Clear selection', 'clear', () => { state.selection = []; render(); this.saveSoon(); }),
            iconButton('Delete selected', 'trash', () => this.confirm(`Delete ${state.selection.length} selected images`, () => this.deleteAssets(state.selection), deleteWarning)),
            iconButton('Assign selection order', 'order', () => this.action(async () => { await this.patchAssets(Object.fromEntries(state.selection.map((id, i) => [id, { order: i }]))); state.sort = 'order'; render(); })),
            iconButton('Tag selected', 'tags', () => this.ask('Comma-separated tags', '', async value => { await this.patchAssets(Object.fromEntries(state.selection.map(id => [id, { tags: value.split(',').map(x => x.trim()).filter(Boolean) }]))); render(); })));
        grid.hidden = !!state.collapsed; pager.hidden = grid.hidden;
        const renderPending = () => pending.replaceChildren(...this.project.jobs.filter(j => j.operation === space && j.kind === kind && ['registered', 'queued', 'running'].includes(j.state)).map(j => {
            const progress = this.progress.get(j.id);
            return el('div', { class: 'amm-pending-card', role: 'status', 'aria-label': `${j.name} · ${j.state}` }, el('div', { class: 'amm-pending-preview' }, el('span', { text: j.state === 'running' ? 'Generating…' : 'Queued' })),
                el('progress', { max: progress?.max || 1, ...(progress ? { value: progress.value } : {}) }), el('small', { text: `${engines[j.engine] || j.engine}${progress ? ` · ${progress.value} / ${progress.max}` : ''}` }));
        }));
        host.append(bar, selection, pending, grid, pager); render(); renderPending(); this.galleryRefresh.set(space, render); this.pendingRefresh.set(space, renderPending);
        host.addEventListener('scroll', () => { state.scroll = host.scrollTop; this.saveSoon(); }, { passive: true, signal: this.abort.signal }); host.scrollTop = state.scroll || 0;
    }
    // Deletes the images and their files from disk, and drops them from every gallery selection.
    async deleteAssets(ids) {
        const id = this.project.id, result = await request(`/projects/${id}/assets`, { assets: ids }, 'DELETE');
        if (id !== this.project.id) return;
        this.project.assets = result.assets;
        for (const space of Object.keys(this.project.workspace)) { const state = this.state(space); state.selection = (state.selection || []).filter(a => !ids.includes(a)); }
        this.referenceRefresh.forEach(refresh => refresh()); this.galleryRefresh.forEach(refresh => refresh()); this.saveSoon();
    }
    async patchAssets(changes) {
        const id = this.project.id; const result = await request(`/projects/${id}/assets`, changes, 'PATCH');
        if (id === this.project.id) { this.project.assets = result.assets; this.referenceRefresh.forEach(refresh => refresh()); }
        this.saveSoon();
    }
    importImages(kind) {
        chooseFile('image/*', files => this.action(async () => {
            const project = this.project.id;
            for (const file of files) { const form = new FormData(); form.append('image', file); form.append('kind', kind); await request(`/projects/${project}/import`, form, 'POST'); }
            if (this.project?.id === project) { const data = await request(`/projects/${project}`); this.project.assets = data.assets; this.galleryRefresh.get(this.active)?.(); }
        }), true);
    }
    preview(asset, assets = [asset]) {
        let index = Math.max(0, assets.indexOf(asset)); const project = this.project.id;
        const image = el('img'), info = el('p'), link = el('a', { text: 'Download original file', download: '' });
        const step = offset => show(index + offset), single = assets.length < 2;
        const dialog = this.modal(asset.name, el('div', { class: 'amm-lightbox' }, el('div', { class: 'amm-lightbox-stage' },
            iconButton('Previous image', 'left', () => step(-1), { hidden: single }), image, iconButton('Next image', 'right', () => step(1), { hidden: single })), info, link));
        dialog.classList.add('amm-lightbox-dialog');
        dialog.addEventListener('keydown', e => { if (!single && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); step(e.key === 'ArrowLeft' ? -1 : 1); } });
        const show = next => {
            index = (next + assets.length) % assets.length; const a = assets[index];
            Object.assign(image, { src: assetUrl(project, a.id), alt: a.name });
            dialog.querySelector('h2').textContent = a.name; dialog.setAttribute('aria-label', a.name);
            info.textContent = `${a.kind} · ${sizeLabel(a)} · version ${a.version}${single ? '' : ` · ${index + 1} / ${assets.length}`}`;
            link.href = `${assetUrl(project, a.id)}?original=1`;
        };
        show(index);
    }
    assetSettings(asset) {
        const info = asset.metadata?.settings;
        const content = el('div', {}, el('pre', { text: JSON.stringify(asset.metadata, null, 2) }));
        if (info) content.append(button('Restore settings for this operation', () => {
            const operation = ['references', 'panels'].includes(asset.metadata.operation) ? asset.metadata.operation : this.active;
            const engine = asset.metadata.engine || info.engine; this.project.config[`${operation}:${engine}`] = { ...clone(info), random_seed: false }; this.state(operation).engine = engine;
            this.rebuild(operation); this.switch(operation); this.saveSoon();
        }));
        content.append(button('Export metadata', () => download('manga-result-settings.json', asset.metadata))); this.modal('Result settings', content);
    }
    async design(view) {
        const state = this.state('design');
        state.pages ||= [newPage()]; state.currentPage ||= state.pages[0].id;
        const group = label => el('div', { class: 'amm-toolbar-group', role: 'group', 'aria-label': label });
        const controls = el('div', { class: 'amm-design-top' }), rail = el('aside', { class: 'amm-design-gallery' }), editorHost = el('section', { class: 'amm-editor' });
        const pages = group('Page actions'), layouts = group('Preset layouts'), files = group('Layout files');
        state.galleryVisible ??= window.innerWidth > 650; rail.hidden = !state.galleryVisible; rail.classList.toggle('amm-gallery-open', state.galleryVisible);
        const galleryToggle = iconButton('Gallery', 'image', () => {
            state.galleryVisible = !state.galleryVisible; rail.hidden = !state.galleryVisible; rail.classList.toggle('amm-gallery-open', state.galleryVisible);
            galleryToggle.setAttribute('aria-pressed', String(state.galleryVisible)); this.saveSoon();
        }, { 'aria-pressed': String(state.galleryVisible) });
        controls.append(galleryToggle);
        const pageSelect = el('select', { 'aria-label': 'Active layout', onchange: e => { state.currentPage = e.target.value; this.saveSoon(); this.editor?.destroy(); this.editor = new PageEditor(this, editorHost, state.pages.find(p => p.id === state.currentPage)); } });
        const update = () => { pageSelect.replaceChildren(...state.pages.map(p => el('option', { value: p.id, text: p.name }))); pageSelect.value = state.currentPage; };
        update(); pages.append(pageSelect, iconButton('New page', 'plus', () => { const page = newPage(); page.name = `Page ${state.pages.length + 1}`; state.pages.push(page); state.currentPage = page.id; update(); pageSelect.onchange({ target: pageSelect }); }),
            iconButton('Duplicate page', 'copy', () => { const page = clone(this.editor.page); page.id = uuid(); page.name += ' · copy'; state.pages.push(page); state.currentPage = page.id; update(); pageSelect.onchange({ target: pageSelect }); }),
            iconButton('Delete layout', 'trash', () => this.confirm('Delete page layout', () => { const removed = state.pages.find(p => p.id === state.currentPage); (state.deletedPages ||= []).push(removed); state.pages = state.pages.filter(p => p.id !== state.currentPage); if (!state.pages.length) state.pages.push(newPage()); state.currentPage = state.pages[0].id; update(); pageSelect.onchange({ target: pageSelect }); })),
            iconButton('Restore deleted layout', 'restore', () => { const page = state.deletedPages?.pop(); if (page) { state.pages.push(page); state.currentPage = page.id; update(); pageSelect.onchange({ target: pageSelect }); } }));
        files.append(iconButton('Save layout preset', 'save', () => this.ask('Layout name', this.editor.page.name, name => { this.project.layouts[name] = clone(this.editor.page); this.saveSoon(); fillPresets(); })),
            iconButton('Download page', 'image', () => this.action(async () => download(`${this.editor.page.name}.png`, await this.editor.export()))),
            iconButton('Export layout', 'download', () => download('manga-layout.json', this.editor.page)), iconButton('Import layout', 'upload', () => chooseFile('.json', files => this.action(async () => {
                const layout = JSON.parse(await files[0].text()); this.validateLayout(layout);
                this.confirm('Replace the geometry of this page', () => { this.editor.change(() => { Object.assign(this.editor.page, normalizePage(layout), { id: this.editor.page.id }); }); this.editor.loadImages(); this.editor.fit(); });
            }))), button('Export composition to pages/', () => this.action(async () => {
                const project = this.project.id, editor = this.editor; const page = clone(editor.page); const blob = await editor.export();
                const form = new FormData(); form.append('image', blob, `${page.name}.png`); form.append('kind', 'pages'); form.append('name', page.name);
                form.append('sources', JSON.stringify(page.panels.map(p => p.asset).filter(Boolean))); form.append('metadata', JSON.stringify({ operation: 'composition', layout: page }));
                const prior = this.project.assets.filter(a => a.metadata?.layout?.id === page.id).sort((a, b) => b.created - a.created)[0]; if (prior) form.append('parent', prior.id);
                const asset = await request(`/projects/${project}/import`, form, 'POST');
                if (this.project.id === project) this.project.assets.push(asset);
                this.notify(`Composition saved: ${page.name}`);
            }), { class: 'amm-primary amm-design-export' }));
        const presets = el('select', { 'aria-label': 'Layout presets', onchange: e => {
            const layout = this.project.layouts[e.target.value]; cloneLayout.disabled = !layout; if (!layout) return;
            this.confirm('Apply layout and replace panels', () => this.editor.applyPreset(layout));
        } });
        const fillPresets = () => { presets.replaceChildren(el('option', { value: '', text: 'Free layout / presets…' }), ...Object.keys(this.project.layouts).map(name => el('option', { value: name, text: name }))); cloneLayout.disabled = true; };
        const cloneLayout = iconButton('Clone layout preset', 'copy', () => this.clonePreset(this.project.layouts, presets.value, (name, layout) => {
            layout.name = name; this.project.layouts[name] = layout; fillPresets(); presets.value = name; cloneLayout.disabled = false;
        }), { disabled: true });
        fillPresets(); layouts.append(presets, cloneLayout, iconButton('Import PanelComposer presets', 'upload', () => this.action(async () => {
            const response = await api.fetchApi('/panelcomposer/all_layouts'); if (!response.ok) throw new Error('PanelComposer is unavailable; use free layout or import a JSON layout.');
            const data = await response.json(); for (const [key, layout] of Object.entries(data)) { this.validateLayout(layout); this.project.layouts[`PanelComposer · ${layout.label || key}`] = clone(layout); }
            this.saveSoon(); fillPresets();
        })));
        controls.append(pages, layouts, files, files.querySelector('.amm-design-export'));
        view.append(controls, el('div', { class: 'amm-design-body' }, rail, resizer(rail, 'Resize gallery'), editorHost)); this.gallery(rail, 'panels', 'design');
        this.editor = new PageEditor(this, editorHost, state.pages.find(p => p.id === state.currentPage) || state.pages[0]); this.saveSoon();
    }
    validateLayout(layout) {
        if (!Array.isArray(layout.panels) || layout.panels.some(p => !Array.isArray(p.polygon) || p.polygon.length < 3 || p.polygon.some(pt => !Array.isArray(pt) || pt.length !== 2 || !pt.every(Number.isFinite)))) throw new Error('Invalid layout: polygons must have finite coordinates.');
    }
    async run(operation, space = operation, assetId = null, section = null, dialogue = null) {
        const textTask = operation in textTasks;
        const project = this.project, state = this.state(space), engine = textTask ? 'text' : operation === 'style' ? 'anima' : state.engine;
        const key = `${project.id}:${operation}`; if (this.busy.has(key)) return;
        this.busy.add(key); this.jobs(); this.error.hidden = true;
        let jobId;
        try {
            const cfg = textTask ? { ...textGeneratorDefaults, ...clone(this.settings.text_generator || {}) } : clone(this.config(space, engine)); cfg.engine = engine;
            if (dialogue) {
                if (!dialogue.text.trim()) throw new Error('Enter dialogue text before enhancing it.');
                cfg.instruction = `Improve this manga dialogue or thought text for clarity, natural phrasing and concision. Preserve its original language, meaning, speaker voice, names and tone. Do not invent story details or turn it into an image prompt. Return only the improved dialogue, without tags, quotation marks, markdown fences or explanations.\n\nText to improve:\n${dialogue.text}`;
            } else if (textTask) cfg.instruction = textInstruction(operation, this.styled(this.config(space)), section);
            if (!textTask) Object.assign(cfg, this.styled(cfg));
            if (cfg.random_seed) cfg.seed = Math.floor(Math.random() * 2 ** 48);
            const references = textTask ? operation === 'describe' ? [assetId] : [] : referenceLimits[engine] ? cfg.references : [];
            // Control images are staged with the references and scene controls are rendered; a control without either is skipped.
            const controls = !textTask && ['references', 'panels'].includes(operation) ? (cfg.controls || []).filter(c => c.enabled && (c.image || c.scene)) : [];
            const ids = [...new Set([...references, ...controls.filter(c => c.image).map(c => c.image)])];
            const unavailable = ids.find(id => !project.assets.some(a => a.id === id && !a.missing));
            if (unavailable) {
                const asset = project.assets.find(a => a.id === unavailable);
                throw new Error(asset ? `Selected image "${asset.name}" is missing. Reimport it and select it again, or remove it from the connected references or controls.`
                    : 'A connected reference or control image was deleted. Remove it from the connected references or controls.');
            }
            if (!textTask && references.length && cfg.size_mode !== 'manual') Object.assign(cfg, sizeSettings(project.assets.find(a => a.id === references[0])), { size_mode: 'original' });
            const paths = await request(`/projects/${project.id}/stage`, { assets: ids }, 'POST');
            const staged = new Map(ids.map((id, i) => [id, paths[i]]));
            for (const control of controls) {
                if (!control.scene) { control.image_path = staged.get(control.image); continue; }
                const scene = project.workspace.scenes?.find(s => s.id === control.scene.scene);
                if (!scene) throw new Error('The scene of a control was deleted. Choose another scene or image for it.');
                const png = await (await fetch(await renderScene(scene, control.scene.camera, imageDimensions(cfg), sceneMap(control.type)))).blob();
                // Named by content (FNV-1a): ComfyUI keeps one copy of an identical upload, and a queued job keeps the render it was given.
                let hash = 0x811c9dc5; for (const byte of new Uint8Array(await png.arrayBuffer())) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
                control.image_path = await upload(png, project.id, `scene-${hash.toString(16)}`);
            }
            jobId = uuid(); const built = buildPrompt(this.defs, operation, engine, cfg, references.map(id => staged.get(id)), jobId);
            const kind = textTask || operation === 'references' ? 'references' : 'panels';
            const job = { id: jobId, operation, engine, kind, settings: cfg, prompt: built.graph, output_node: built.outputNode, parent: null, sources: ids,
                ...(textTask ? { space, target_engine: state.engine, section } : {}),
                ...(dialogue ? { dialogue_target: { page: dialogue.page, bubble: dialogue.bubble } } : {}),
                name: `${spaces[space]} · ${new Date().toLocaleString('en-US')}` };
            await this.queue(project, job, built);
        } catch (error) {
            if (jobId && project.jobs.some(j => j.id === jobId)) { await request(`/projects/${project.id}/jobs/${jobId}`, { error: error.message }, 'PATCH'); const job = project.jobs.find(j => j.id === jobId); job.state = 'error'; job.error = error.message; }
            throw new Error(`${textTasks[operation] || spaces[space]} · ${engine}: ${error.message}`);
        } finally { this.busy.delete(key); this.jobs(); }
    }
    // Registers a job with the project and queues its graph; the poll imports its results.
    async queue(project, job, built) {
        await this.flush();
        const registered = await request(`/projects/${project.id}/jobs`, job, 'POST'); project.jobs.push(registered);
        const response = await api.fetchApi('/prompt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
            prompt_id: job.id, client_id: api.clientId, prompt: built.graph,
            extra_data: { anima_manga_maker: { project: project.id, operation: job.operation, job: job.id } },
        }) });
        const result = await response.json();
        if (!response.ok) throw new Error(JSON.stringify(result.node_errors || result.error || result));
        if (result.prompt_id !== job.id) throw new Error('The server did not preserve the execution identifier.');
        registered.state = 'queued'; this.jobs();
    }
    // A larger version of an image: Anima redraws it at the target resolution from the image itself, held by a Tile & Repair LLLite when installed,
    // or else by the any-test LLLite on its grayscale. The image's own prompt is used when it has one; without a tile model, colors it does not name can drift.
    upscaleDialog(asset) {
        const existing = this.project.config['upscale:anima'], cfg = this.config('upscale', 'anima');
        const holds = { tile: { patch: installedPatch(this.defs, tilePatches), denoise: 0.5 }, gray: { patch: installedPatch(this.defs, [controlTypes.anytest.patch]) || controlTypes.anytest.patch, denoise: 0.3 } };
        const hold = mode => ({ redraw_mode: mode, redraw_patch: holds[mode].patch, denoise: holds[mode].denoise });
        if (!existing) Object.assign(cfg, { megapixels: 2, redraw_strength: 1, redraw_end: 1, random_seed: true }, hold(holds.tile.patch ? 'tile' : 'gray'));
        Object.assign(cfg, referencePrompt(asset) || { prompt_sections: {}, prompt: '' });
        const changed = () => this.saveSoon();
        const number = (label, key, range, step) => slider(label, el('input', { type: 'number', 'aria-label': label, value: cfg[key], step, onchange: e => { cfg[key] = Number(e.target.value); changed(); } }), range);
        const mode = el('select', { 'aria-label': 'Hold the image with', onchange: e => { Object.assign(cfg, hold(e.target.value)); changed(); dialog.close(); this.upscaleDialog(asset); } },
            ...['gray', 'tile'].map(value => el('option', { value, text: redrawModes[value].label }))); mode.value = cfg.redraw_mode;
        const content = el('div', { class: 'amm-upscale' }, el('small', { text: `${asset.name} · ${sizeLabel(asset)}. The result is saved as a new version.` }),
            number('Target resolution · MP', 'megapixels', [1, 6], 0.25), number('Denoise · higher adds detail and drifts more', 'denoise', [0, 1], 0.05),
            field('Hold the image with', mode), combo('LLLite', options(this.defs, 'ModelPatchLoader', 'name'), cfg.redraw_patch, value => { cfg.redraw_patch = value; changed(); }),
            number('LLLite strength', 'redraw_strength', [0, 2], 0.05));
        this.promptControls(content, cfg, changed); this.samplingControls(content, cfg, 'anima', changed, 'upscale'); this.modelControls(content, cfg, 'anima', changed, false, 'upscale', () => {});
        const dialog = this.modal(`Upscale · ${asset.name}`, content, button('Upscale', () => this.action(async () => { await this.upscale(asset, cfg); dialog.close(); }), { class: 'amm-primary' }));
    }
    // Qwen Image instruction editing of any project image, pages included; the result is a new version of the original.
    refine(view) {
        const space = 'refine', state = this.state(space), source = this.project.assets.find(a => a.id === state.source);
        const controls = el('aside', { class: 'amm-controls' }), preview = el('section', { class: 'amm-preview-area' });
        const select = el('select', { 'aria-label': 'Original image', onchange: e => { state.source = e.target.value; state.kind = null; this.saveSoon(); this.rebuild(space); } }, el('option', { value: '', text: 'Select original…' }),
            ...this.project.assets.filter(a => !a.missing).map(a => el('option', { value: a.id, text: `${kindNames[a.kind]} · ${a.name} · v${a.version}` })));
        select.value = source?.id || '';
        const edit = editControls(this, 'refine', () => this.saveSoon(), false);
        controls.append(el('h2', { text: 'Refinement · Qwen' }), el('small', { text: 'Edit a reference, panel or page with a Qwen Image instruction. The result is saved as a new version of the original.' }),
            field('Original image', select), edit.element, el('div', { class: 'amm-run-bar' }, button('Refine image', () => this.action(() => this.refineImage(source, edit.cfg)), { class: 'amm-primary', disabled: !source })));
        view.append(controls, preview); this.controlLayout(view, controls, space); this.comparison(preview);
        const gallery = el('div', { class: 'amm-result-gallery' }), kind = state.kind || source?.kind || 'panels';
        preview.append(segmented('Gallery', Object.entries(kindNames), kind, value => { state.kind = value; this.saveSoon(); this.rebuild(space); }), gallery);
        this.gallery(gallery, kind, space, true);
    }
    // The original next to its latest refinement.
    comparison(host) {
        host.querySelector('.amm-comparison')?.remove();
        const source = this.project.assets.find(a => a.id === this.state('refine').source);
        const result = source && this.project.assets.filter(a => a.parent === source.id && a.metadata?.operation === 'refine').sort((a, b) => b.created - a.created)[0];
        const shell = el('div', { class: 'amm-comparison' });
        if (!source) shell.append(el('div', { class: 'amm-empty', text: 'Select an original image from your project, or choose Refine with Qwen in an image menu.' }));
        else {
            const images = el('div', { class: 'amm-compare-images' }, el('figure', {}, el('figcaption', { text: 'Original' }), el('img', { src: assetUrl(this.project.id, source.id), alt: source.name })));
            if (result) images.append(el('figure', {}, el('figcaption', { text: 'Result' }), el('img', { src: assetUrl(this.project.id, result.id), alt: result.name })));
            shell.append(images);
            if (result) {
                const range = el('input', { type: 'range', min: 0, max: 100, value: 50, 'aria-label': 'Before and after comparison', oninput: e => sliding.style.setProperty('--amm-split', `${e.target.value}%`) });
                const sliding = el('div', { class: 'amm-sliding', hidden: true }, el('img', { src: assetUrl(this.project.id, source.id), alt: 'Before' }),
                    el('img', { src: assetUrl(this.project.id, result.id), alt: 'After', class: 'amm-compare-overlay' }), range);
                shell.prepend(segmented('Comparison view', [['split', 'Side by side'], ['slider', 'Before / after slider']], 'split', value => { sliding.hidden = value !== 'slider'; images.hidden = !sliding.hidden; }), sliding);
            }
        }
        host.prepend(shell);
    }
    async refineImage(asset, cfg) {
        const project = this.project, jobId = uuid(), settings = clone(cfg);
        if (settings.random_seed) settings.seed = Math.floor(Math.random() * 2 ** 48);
        const [path] = await request(`/projects/${project.id}/stage`, { assets: [asset.id] }, 'POST');
        const built = buildQwenEditPrompt(this.defs, settings, path);
        await this.queue(project, { id: jobId, operation: 'refine', engine: 'qwen_edit', kind: asset.kind, space: 'refine', settings, prompt: built.graph, output_node: built.outputNode,
            parent: asset.id, sources: [asset.id], name: `Refine · ${asset.name}` }, built);
        this.notify(`Refinement queued · ${asset.name}`);
    }
    async upscale(asset, cfg) {
        const project = this.project, jobId = uuid(), settings = clone(this.styled(cfg));
        if (settings.random_seed) settings.seed = Math.floor(Math.random() * 2 ** 48);
        Object.assign(settings, { aspect_ratio: sizeSettings(asset).aspect_ratio, megapixels: cfg.megapixels });
        const [path] = await request(`/projects/${project.id}/stage`, { assets: [asset.id] }, 'POST');
        settings.redraw = { source_path: path, mode: settings.redraw_mode, patch: settings.redraw_patch, strength: settings.redraw_strength, end: settings.redraw_end };
        const built = buildPrompt(this.defs, 'upscale', 'anima', settings, [], jobId);
        await this.queue(project, { id: jobId, operation: 'upscale', engine: 'anima', kind: asset.kind, space: asset.kind, settings, prompt: built.graph, output_node: built.outputNode,
            parent: asset.id, sources: [asset.id], name: `Upscale · ${asset.name}` }, built);
        this.notify(`Upscale queued · ${asset.name}`);
    }
    textResult(job) {
        const result = el('textarea', { value: job.text || '', 'aria-label': 'Generator proposal', class: 'amm-prompt-preview' });
        const error = el('small', { role: 'alert' });
        const dialog = this.modal(job.dialogue_target ? 'Enhance dialogue' : textTasks[job.operation], el('div', {},
            el('p', { text: job.operation === 'enhance' ? `Proposal for ${job.section === 'free' ? 'Free prompt' : job.section}. Only that field will be replaced.` : 'Prompt created from the reference. Review it before applying.' }), result, error),
            button('Apply proposal', () => {
                if (job.dialogue_target) {
                    const page = this.project.workspace.design.pages.find(p => p.id === job.dialogue_target.page);
                    const bubble = page?.bubbles.find(b => b.id === job.dialogue_target.bubble);
                    if (!bubble) { error.textContent = 'The original dialogue box has been deleted.'; return; }
                    if (this.editor?.page === page) this.editor.change(() => bubble.text = result.value);
                    else { bubble.text = result.value; this.saveSoon(); }
                    dialog.close(); return;
                }
                const cfg = this.config(job.space, job.target_engine);
                if (job.operation === 'enhance') {
                    if (job.section === 'free') cfg.prompt = result.value;
                    else (cfg.prompt_sections ||= {})[job.section] = result.value;
                } else {
                    const parsed = parsePrompt(result.value);
                    if (!parsed) { error.textContent = 'The text contains no recognized sections. Edit it before applying.'; return; }
                    Object.assign(cfg, parsed);
                }
                this.presetChanged(job.space); this.rebuild(job.space); dialog.close();
            }, { class: 'amm-primary' }));
    }
    event(name, detail) {
        if (name === 'anima_manga_maker_error' && detail.project === this.project?.id) this.fail(new Error(detail.error));
        if (name === 'execution_start') this.executing = detail.prompt_id;
        if (name === 'progress') { const id = detail.prompt_id || this.executing; if (id) this.progress.set(id, { value: detail.value, max: detail.max }); }
        if (['execution_error', 'execution_interrupted', 'execution_success'].includes(name)) this.poll();
        this.jobs();
    }
    async poll() {
        if (!this.project || this.polling || this.abort.signal.aborted) return;
        const project = this.project; this.polling = true;
        try {
            const data = await request(`/projects/${project.id}`);
            if (this.project !== project || this.abort.signal.aborted) return;
            if (data.revision > project.revision) {
                await this.saving.catch(() => {});
                // A pending local edit is saved first; its revision conflict reloads the project.
                if (this.project === project && data.revision > project.revision && this.status.dataset.save !== 'pending') { await (this.saving = this.saving.then(() => this.reload())); return; }
            }
            const added = JSON.stringify(data.assets.map(a => [a.id,a.missing,a.name,a.metadata?.description_prompt])) !== JSON.stringify(project.assets.map(a => [a.id,a.missing,a.name,a.metadata?.description_prompt]));
            for (const job of data.jobs) {
                const prior = project.jobs.find(j => j.id === job.id);
                if (job.state === 'error' && prior?.state !== 'error') this.fail(new Error(`${textTasks[job.operation] || (job.operation === 'sketch' ? 'Sketch to Art' : job.operation === 'manga' ? 'Art to Manga Panel' : spaces[job.operation] || job.name)} · ${job.engine}: ${typeof job.error === 'string' ? job.error : JSON.stringify(job.error)}`));
                if (job.state === 'complete' && prior?.state !== 'complete') {
                    if (job.operation in textTasks) this.textResult(job);
                    else if (job.operation === 'style' && job.drawing_output) { this.stylePreviews.unshift({ project: project.id, engine: job.engine, url: api.apiURL('/view?' + new URLSearchParams(job.drawing_output)) }); this.renderStylePreviews?.(); }
                    this.saveSoon();
                }
            }
            project.jobs = data.jobs; project.assets = data.assets;
            if (added) {
                const refine = this.views.get('refine')?.querySelector('.amm-preview-area'); if (refine) this.comparison(refine);
                this.referenceRefresh.forEach(refresh => refresh());
                this.galleryRefresh.forEach(refresh => refresh());
            }
            this.jobs();
        } catch (e) { this.fail(e); } finally { this.polling = false; }
    }
    async cancelJob(job, projectId) {
        const key = `cancel:${projectId}:${job.id}`;
        if (this.busy.has(key) || job.cancel_requested) return;
        this.busy.add(key); this.jobs();
        try {
            for (const [path, body] of [['/queue', { delete: [job.id] }], ['/interrupt', { prompt_id: job.id }]]) {
                const response = await api.fetchApi(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
                if (!response.ok) throw new Error('Could not cancel generation. Please try again.');
            }
            const updated = await request(`/projects/${projectId}/jobs/${job.id}`, { cancel_requested: true }, 'PATCH');
            Object.assign(job, updated);
            if (this.project?.id === projectId) await this.poll();
        } finally { this.busy.delete(key); this.jobs(); }
    }
    jobs() {
        if (!this.project) return;
        const relevant = this.project.jobs.filter(j => (j.space || j.operation) === this.active);
        const active = relevant.filter(j => ['registered', 'queued', 'running'].includes(j.state));
        const labels = { registered: 'Preparing', queued: 'Queued', running: 'Running', complete: 'Completed', error: 'Error', cancelled: 'Cancelled' };
        this.status.replaceChildren(el('span', { text: `${this.project.name} · ${spaces[this.active]} · ${active.length} active jobs` }),
            ...[...active, ...relevant.filter(j => !active.includes(j)).slice(-4)].map(j => el('div', { class: `amm-job amm-job-${j.state}`, role: 'group', 'aria-label': j.name }, button(`${j.cancel_requested && active.includes(j) ? 'Cancelling' : labels[j.state]} · ${j.engine}${j.state === 'running' && this.progress.has(j.id) ? ` · ${this.progress.get(j.id).value} / ${this.progress.get(j.id).max}` : ''}`, () => {
                if (j.operation in textTasks && j.state === 'complete') { this.textResult(j); return; }
                const details = el('div', {}, el('p', { text: `${j.name} · ${j.id}` }), el('pre', { text: j.error ? JSON.stringify(j.error, null, 2) : j.text || JSON.stringify(j.settings, null, 2) }));
                if (['queued', 'running'].includes(j.state)) details.append(button('Cancel generation', () => this.action(() => this.cancelJob(j, this.project.id)), { disabled: !!j.cancel_requested }));
                this.modal('Operation', details);
            }), ['queued', 'running'].includes(j.state) ? iconButton(`Cancel generation ${j.id}`, 'clear', () => this.action(() => this.cancelJob(j, this.project.id)),
                { 'data-cancel-job': j.id, title: j.state === 'running' ? 'Cancel running generation' : 'Cancel queued generation', disabled: !!j.cancel_requested || this.busy.has(`cancel:${this.project.id}:${j.id}`) }) : null,
                j.state === 'running' ? el('progress', { max: this.progress.get(j.id)?.max || 1, ...(this.progress.has(j.id) ? { value: this.progress.get(j.id).value } : {}) }) : null)));
        for (const b of this.dialog.querySelectorAll('[data-run]')) {
            const run = b.dataset.run, limit = ['references', 'panels'].includes(run) && referenceLimits[this.state(run).engine], references = limit ? this.config(run).references.length : null;
            const reason = this.busy.has(`${this.project.id}:${run}`) ? 'Submitting…'
                : references !== null && (references < 1 || references > limit) ? `Connect one to ${limit === 4 ? 'four' : 'eight'} references.`
                : run in textTasks && !this.textGeneratorAvailable() ? 'Configure the global text generator in Settings.'
                : run in textTasks && this.project.jobs.some(j => j.operation === run && ['registered', 'queued', 'running'].includes(j.state)) ? 'A text generation is already running.'
                : run === 'describe' && !this.project.assets.some(a => a.id === b.dataset.textSource && !a.missing) ? 'The source image is unavailable.' : '';
            b.disabled = !!reason;
            const hint = b.closest('.amm-run-bar')?.querySelector('.amm-run-hint'); if (hint) hint.textContent = reason;
        }
        this.pendingRefresh.forEach(render => render());
    }
}
