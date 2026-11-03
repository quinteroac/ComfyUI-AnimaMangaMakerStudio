# Installation and dependencies

[Documentation](README.md) · [Project README](../README.md)

Prefer to use an agent? The included [setup skill and agent guide](agent-setup.md) support feature-specific installation and configuration.

## Installing the plugin

Clone the plugin into an existing ComfyUI installation:

```sh
# Run from your ComfyUI directory:
git clone https://github.com/quinteroac/ComfyUI-AnimaMangaMakerStudio.git custom_nodes/ComfyUI-AnimaMangaMakerStudio
```

When there are no active jobs, restart ComfyUI and reload the browser. Project management, page layout and drawing use aiohttp and Pillow included with ComfyUI, plus a bundled Klecks build. The plugin does not modify ComfyUI core and does not download weights.

Open **Anima Manga Maker Studio** from the sidebar or the **Anima Manga Maker** menu. It uses the same ComfyUI server and queue as the graph editor. It can be installed next to Manga Maker Studio; each keeps its own projects, settings, routes and menu entry.

## Weights

Place these files in ComfyUI's model folders. The defaults match the Anima Turbo workflows; any compatible Anima checkpoint, such as Anima Base, Aesthetic or a manga finetune, can be selected instead.

| Role | Default file | Folder |
| --- | --- | --- |
| Diffusion model | `anima/anima-turbo-v1.0-int8-convrot.safetensors` | `diffusion_models` |
| Text encoder (loading type `stable_diffusion`) | `qwen_3_06b_base.safetensors` | `text_encoders` |
| VAE | `qwen_image_vae.safetensors` | `vae` |
| Anima Ref adapter | `anima_ref_adapter_v2_r64.safetensors` (or `anima_ref_adapter_pilot_r32.safetensors`) | `loras` |
| SnapRef adapter | `snapref_v2a_pre2.safetensors` (or `snapref_v1b.safetensors`) | `loras` |
| ControlNet-LLLite controls | Any Anima LLLite v2 file, such as toyxyz `anima_3dpose_outline_7000` or `anima_regional_4335`, or kohya/Comfy-Org `anima-lllite-*` | `model_patches` |

LoRAs are applied to the model only, in list order.

## Node dependencies

Managing projects, importing images, drawing with Klecks, editing pages and exporting them requires no additional node packages. Install these under `ComfyUI/custom_nodes` only for the features you use.

| Feature | Dependencies |
| --- | --- |
| Anima text to image, BBox to Image | Native ComfyUI nodes. BBox to Image also uses the native `CreateBoundingBoxes` and `MOSSImageLayoutPrompt` nodes. |
| Anima Ref and Sketch to Art | [ComfyUI-Anima-Ref-Adapter](https://github.com/ElectronGirl/ComfyUI-Anima-Ref-Adapter) (`AnimaRefAdapterLoader`, `AnimaRefLatent`, `AnimaRefGuider`) and [comfyui-anima-safe-pag](https://github.com/iljung1106/comfyui-anima-safe-pag) (`AnimaSafePAG`, used when the PAG scale is above 0). |
| Anima SnapRef | [SnapRef](https://huggingface.co/0ppxnhximxr/snapref-v1b) custom node (`SnapRef`). |
| ControlNet-LLLite controls | Native `ModelPatchLoader` and `AnimaLLLiteApply`. With Anima Ref, [ComfyUI-Anima-CharRef-LLLite](https://github.com/quinteroac/ComfyUI-Anima-CharRef-LLLite) (`ExperimentalAnimaLLLiteRefApply`, `ExperimentalAnimaRefAdapterControlsLoader`), because the stock LLLite patch does not combine with the reference frame. |
| Artist Mixer | [Anima-Artist-Mixer](https://github.com/An1X3R/Anima-Artist-Mixer): `AnimaArtistPack` and `AnimaArtistAdapterMixer`. |
| Transparency · Chroma key | [ComfyUI_VNCCS](https://github.com/AHEKOT/ComfyUI_VNCCS): `VNCCSChromaKey`. |
| Art to Manga Panel · Manga-Lite | [ComfyUI-MangaScreen](https://github.com/ashukae/ComfyUI-MangaScreen): `MangaLevels`, `MangaFinish` and `MangaPanel`. Requires `opencv-python` and `numpy`; no diffusion model is needed. |
| Art to Manga Panel · Extract pen lines | [comfyui_controlnet_aux](https://github.com/Fannovel16/comfyui_controlnet_aux): `Manga2Anime_LineArt_Preprocessor` and its Manga Lineart weights. Optional and disabled initially. |
| Animadex and Stylebook style pickers | [comfyui-anima-style-nodes](https://github.com/fulletLab/comfyui-anima-style-nodes) with its Animadex index, and [comfyui-stylebook](https://github.com/EnragedAntelope/comfyui-stylebook). Studio only reads their installed catalogs. |
| Story assistant | [llama-cpp-python](https://github.com/abetlen/llama-cpp-python) in ComfyUI's Python environment and a GGUF language model in `models/LLM`. A matching `mmproj` projector is needed for vision. Optional; Story works without it. |
| Enhancing fields and creating reference prompts | Native `TextGenerate`, `SaveText` and `CLIPLoader` nodes; uses the CLIP configured in the global text generator. Reference analysis requires an encoder with vision. |
| Importing PanelComposer presets | [ComfyUI-PanelComposer](https://github.com/INuBq8/ComfyUI-PanelComposer), optional. Studio renders and exports layouts with its own editor. |

For **Art to Manga Panel**, install MangaScreen and its Python requirements in the same Python environment that runs ComfyUI:

```sh
# Run from your ComfyUI directory:
git clone https://github.com/ashukae/ComfyUI-MangaScreen.git custom_nodes/ComfyUI-MangaScreen
python -m pip install -r custom_nodes/ComfyUI-MangaScreen/requirements.txt
```

Anima Ref and SnapRef add the native `ModelAttentionBackend` node with `comfy kitchen attention` when available, otherwise `pytorch attention`; plain Anima adds it only when a backend is selected. If a node is missing, the operation reports its name and other features remain available. After installing a package, restart ComfyUI when no jobs are active and use **Refresh lists**.

## Choosing what to install

For drawing and page composition, the plugin and its bundled Klecks editor are sufficient. Add Anima weights for text-to-image generation and BBox to Image, and the Ref Adapter packages for Anima Ref and Sketch to Art. Add MangaScreen for Manga-Lite without loading a diffusion model.

After installation, see [Configuration](configuration.md) for model selection and [Using Studio](usage.md) for the workspaces.
