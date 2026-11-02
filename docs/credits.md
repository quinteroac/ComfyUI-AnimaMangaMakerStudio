# Credits and attribution

[Documentation](README.md) · [Project README](../README.md)

Anima Manga Maker Studio integrates the following projects and workflows. Credit belongs to their authors and contributors; linked projects and model weights retain their respective licenses.

| Project / authors | Contribution used by Studio |
| --- | --- |
| [ComfyUI](https://github.com/Comfy-Org/ComfyUI), [ComfyUI frontend](https://github.com/Comfy-Org/ComfyUI_frontend) and their contributors | Execution server, model loading, native nodes, queue/history APIs and the extension interface. |
| [Klecks — bitbof](https://github.com/bitbof/klecks) | Bundled painting editor, brushes, layers, PSD support and native history. The embed is locally patched for Studio integration. Its [MIT license](../drawing/klecks/LICENSE.txt), dependency/font credits and [upstream revision/build record](../drawing/klecks/UPSTREAM.json) are included in the repository. |
| [ComfyUI-MangaScreen — ashukae](https://github.com/ashukae/ComfyUI-MangaScreen) | Manga Levels, Manga Finish and Manga Panel; the [Manga-Lite](https://github.com/ashukae/ComfyUI-MangaScreen/blob/main/workflows/Manga-Lite.json) pipeline adapted for Art to Manga Panel. MangaScreen is a separate MIT-licensed dependency. |
| [Manga Maker Studio — quinteroac](https://github.com/quinteroac/ComfyUI-MangaMakerStudio) | The project this one is derived from: projects, galleries, Klecks integration, page layout, Story Studio and MCP server. |
| [Anima — CircleStone Labs](https://huggingface.co/circlestone-labs/Anima) | The base model family. Weights are under the CircleStone Labs Non-Commercial License and are not included. |
| [ComfyUI-Anima-Ref-Adapter — ElectronGirl](https://github.com/ElectronGirl/ComfyUI-Anima-Ref-Adapter) and [anima-ref-adapter](https://huggingface.co/ElectronGirl/anima-ref-adapter) | Reference adapter, latent and guider used by Anima Ref and Sketch to Art, following its `anima_ref_adapter_pag_multi` workflow. |
| [comfyui-anima-safe-pag — iljung1106](https://github.com/iljung1106/comfyui-anima-safe-pag) | Safe PAG used by Anima Ref. |
| [ComfyUI_VNCCS — AHEKOT](https://github.com/AHEKOT/ComfyUI_VNCCS) | VNCCS Chroma Key for transparent results. |
| [comfyui-anima-style-nodes — fulletLab](https://github.com/fulletLab/comfyui-anima-style-nodes) and [comfyui-stylebook — EnragedAntelope](https://github.com/EnragedAntelope/comfyui-stylebook) | Animadex and Stylebook catalogs read by the style pickers. |
| [ControlNet Auxiliary Preprocessors — Fannovel16 and contributors](https://github.com/Fannovel16/comfyui_controlnet_aux) | Optional Manga Lineart extraction via `Manga2Anime_LineArt_Preprocessor`, based on Li et al., *Deep Extraction of Manga Structural Lines*, SIGGRAPH 2017. |
| [ComfyUI-PanelComposer — INuBq8](https://github.com/INuBq8/ComfyUI-PanelComposer) | Compatible panel-layout presets imported by Studio's page editor. |

Klecks also bundles third-party libraries and fonts; their upstream notices are preserved in `drawing/klecks/`. Custom node packages and model weights are installed separately and are not relicensed by this project.
