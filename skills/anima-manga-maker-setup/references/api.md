# Studio API and settings contracts

Read this when inspecting a running server or configuring it through HTTP. All paths are relative to the **confirmed ComfyUI server URL**, including any deployment prefix. Use the deployment's existing authentication through available tools; do not weaken authentication or open a public listener for setup. These are local server calls, not a hosted Anima Manga Maker service.

## Inventory and activation

| Request | Use |
| --- | --- |
| `GET /object_info` | Loaded node schemas and registered model/encoder/VAE/LoRA filenames |
| `GET /queue` | `queue_running` and `queue_pending`; both must be empty before an idle restart |
| `GET /anima-manga-maker/settings` | Current global configuration |
| `GET /anima-manga-maker/assistant` | Story assistant: `available` (llama-cpp-python installed), `defaults`, GGUF `models` with compatible `projectors`, scan `errors`, and whether a model is `loaded`. Settings live under `assistant` in `/anima-manga-maker/settings` |
| `POST /anima-manga-maker/settings` | Persist settings; see replacement semantics below |

If `/object_info` responds but Studio routes return 404, check plugin path, startup import errors and whether its Python code was loaded after installation. Do not POST to a missing route or create replacement server code. A stopped server cannot reveal its loaded schemas; inspect configuration/startup logs and defer live verification until it starts.

Schemas may advertise combos as a list in the first input slot or as `COMBO` with an `options` list in the metadata slot. Inspect both `required` and `optional` inputs. Use full registered filenames, including subfolders. Optional cache/attention nodes and enum values vary by installation.

## Settings shape and preservation

Global configuration is stored in the active ComfyUI user directory as `anima-manga-maker-settings.json`; do not assume a fixed absolute user path. Its top-level fields are:

```json
{
  "root": "/absolute/path/to/anima-manga-maker-projects",
  "defaults": {},
  "models": {},
  "presets": {},
  "text_generator": {}
}
```

`models` contains engine profiles keyed by `anima`, `anima_ref` and `anima_snapref`. Relevant fields include `model`, `encoder`, `encoder_type`, `vae`, `weight_dtype`, `encoder_device`, sampling values, for `anima_ref` `ref_adapter_lora`, `ref_guidance` and `pag_scale`, and for `anima_snapref` `snapref_adapter`, `snapref_mode`, `snapref_strength` and `snapref_fidelity`. Operation `controls` (LLLite) and `artist_chain` live in project configuration, not in global models. Defaults come from `profiles` in the checkout's `web/models.js`; use it, `web/prompts.js` (`initialSettings`) and installed schemas rather than creating a new configuration format. Anima uses encoder type `stable_diffusion`.

The backend preserves omitted top-level fields, but submitted `models`, `defaults`, `presets` or `text_generator` maps replace the corresponding stored maps. For example, `{"models":{"anima":{"model":"new.safetensors"}}}` would discard Anima Ref and other stored Anima fields. Read, deep-copy and merge the requested fields first. Preserve unspecified fields, including numeric zeros and user-selected device/precision settings.

A safe request sequence for a user-requested change is:

```python
# Pseudocode: use the confirmed server and its existing authenticated client.
before = get_json('/anima-manga-maker/settings')
save_backup(before)  # local backup outside published repository content
models = deepcopy(before.get('models', {}))
profile = models.setdefault('anima', {})
profile.update(validated_user_requested_fields)
# Re-read before saving if discovery or user decisions took time; re-merge on changes.
post_json('/anima-manga-maker/settings', {'models': models})
after = get_json('/anima-manga-maker/settings')
# Compare all settings with before, allowing only requested profile changes.
```

The plugin uses registered user storage and validates the project root. Do not change `root` to complete model selection. Moving projects requires their complete folders and stable identifiers, as described in repository `docs/projects.md`.

Project configuration stores operation settings under `config`, such as `panels:anima_ref`, `sketch_panels:anima_ref`, `bbox_panels:anima` and `manga_panels:manga_lite`, with corresponding `references` scopes. `model_overrides` takes priority over global model fields. Manga-Lite has no diffusion model; do not create a global `manga_lite` model engine. Prefer Studio's controls for per-project changes. Read its current project API and file format before automating those changes; do not overwrite a live browser session's unsaved state.

## Verification

Schema/UI checks do not load weights or establish image quality. Report actual inference separately from package installation, registered schemas and settings read-back.
