# Drawing and manga conversion in Klecks

[Documentation](README.md) · [Project README](../README.md)

Klecks handles drawing and layered editing; the **Drawing workflow** selector adds generation or manga conversion to that same canvas. The result remains editable before it is saved to the project.

**Draw reference** and **Draw panel**, in each gallery header, open a new canvas with a name, AR and MP. The **Draw with Klecks** context menu action opens an existing image to draw over it. [Klecks](https://github.com/bitbof/klecks) runs in a local iframe with brushes, a stabilizer, layers, selection, shapes, text and filters. **Save to project** or **Submit** saves a PNG usable for inference and a PSD with editable layers. Each subsequent save creates a new version; originals are preserved. Reopening a drawing loads its PSD; an imported or generated image opens as an Original layer plus a transparent Drawing layer. Closing asks for confirmation before discarding drawing changes made since the last save.

## Sketch to Art

**Sketch to Art** sends the **Whole canvas** or a **Selected region** to Anima Ref: the drawing is the reference image and the VAE-encoded starting latent, so **Denoise** in Sampling sets how far the result moves from the sketch (0.6 by default). Use **Update region preview**, drag a rectangle in the preview or enter X/Y/width/height. Dashed guides show the same region on the drawing canvas and follow zoom, panning, rotation and mirroring. They are display-only and are excluded from generation inputs, PNG and PSD. **Generate Sketch to Art** runs on demand. **Realtime on stroke release** starts after Klecks finishes the stroke, including its pressure and smoothing; it does not generate while the pen is held down. Only one job runs at a time. New strokes are combined into a request for the latest drawing, and stale results are skipped. **Cancel generation** targets only this editor's job.

Sketch parameters and prompt/settings presets are stored separately for reference and panel drawings in the project. The preset controls at the top of Sketch to Art save, load, clone, import and export the prompt, sampling settings, model overrides, LoRAs, generation region and blending settings without closing Klecks. Models inherit the global Anima Ref configuration and can be overridden in **Models and advanced settings**. Realtime remains a session toggle and is not enabled by loading a preset.

## Transparency

**Transparency · Chroma key** in Sketch to Art and BBox to Image asks for a flat indigo background and removes it with **VNCCS Chroma Key**, so only the subject covers the drawing.

With transparency on, BBox to Image splits the result into one layer per box, so each element can be moved with Klecks' transform tool. Overlapping boxes, also through a chain of overlaps, share one layer cut to the union of their boxes; its name lists them, such as **Boxes 1+2**. Pixels the model draws outside every box go to an **Outside boxes** layer, created only when it has content. Generating again replaces these layers, and a group that no longer exists is emptied rather than deleted. The cut follows the box rectangles, so a subject that spills past its box keeps that part in another layer.

Boxes and their layers stay linked during the editor session. Moving or resizing a box on the canvas moves or scales its layer, and the other boxes of its group follow. Selecting a box layer and applying **Transform** (Select tool, **All**, **Transform**, then back to **Select**) moves and scales its boxes. Warps and **Clone** transforms are not followed. Box undo and Klecks undo are separate. Links are not kept after closing the editor.

## Regions, masks and blending

**Layer blending** controls edge feather in pixels and blend opacity. Results are inserted into a dedicated editable AI layer, reused within the editor session. Existing drawing layers and pixels outside the selected region are preserved; Klecks' native undo/redo works for AI updates. Individual generated crops stay in ComfyUI output/history and do not become separate project assets; temporary input crops are removed.

**Crop and stitch mask** lets you paint and erase a mask with the mouse on the preview. Enable **Use stitch mask** and choose **Paint mask** or **Erase mask** under **Preview tool**; pink marks show areas to replace. **Crop to mask bounds** sends only their bounding rectangle to inference at the original size. The generated crop is stitched back through mask alpha, inward feather and opacity; pixels outside the mask remain intact. The mask affects compositing only, not model conditioning. Choosing **Whole canvas** disables the previous stitch mask. **Clear mask** also disables masking.

## Art to Manga Panel

**Art to Manga Panel** converts the whole canvas or selected region into an editable layer with **Manga-Lite** (Manga Levels → Manga Finish → Manga Panel), without a diffusion model. It uses the [ComfyUI-MangaScreen](https://github.com/ashukae/ComfyUI-MangaScreen) workflow defaults: 2 MP working resolution and 250 screen lines. Manga output fits inside the selected area without stretching, with the same crop/stitch mask, cancellation, stale-result protection, native undo and layered saving as Sketch to Art. **Extract pen lines** is optional and disabled initially.

**Live preview on canvas** reruns the workflow after each parameter change, slider drag or stroke and draws the result over the drawing area, without adding a layer or an undo step. The drawing is uploaded only when it changes. Lower **Working resolution · MP** for faster updates; use **Generate Art to Manga Panel** to add the layer.

| Control | Effect on the result |
| --- | --- |
| **Input black / Input white / Gamma** | Adjust which source values become black, midtone or paper before finishing |
| **Screen lines** | Controls dot frequency; fewer lines produce coarser dots |
| **Paper white point** | Lower values clear more light tone to paper |
| **Solid black point** | Higher values turn more dark areas into solid ink |
| **Light tone / Dark tone / Gradation** | Set tone coverage and smooth-shadow treatment |
| **White lines in black** | Preserves folds and seams inside solid black areas |
| **Panel shape / Crop X / Crop Y** | Choose the crop shape and its position |
| **Panel border / Paper margin / Paper / Printed ink** | Add the printed panel presentation |

Pen extraction needs **comfyui_controlnet_aux** and its Manga Lineart weights; when it is enabled and run, the package may download missing annotator weights on first use.

## BBox to Image

**BBox to Image** generates the whole canvas with Anima from a scene prompt and boxes drawn on the canvas. The boxes are written in the MOSS-Image layout format through the native `Create Bounding Boxes` and `MOSS-Image Layout Prompt` nodes, and Anima receives that layout as prompt text, so the boxes guide placement rather than enforce it.

Enable **Draw boxes on canvas** and drag on the drawing. Each box gets a number and a type: **Object**, **Character** or **Text** (with the text to render), plus a description. Each new box gets the next unused color; change it with **Color**. Colors only mark boxes on the canvas and are not sent to the model. List background boxes first and foreground boxes last; use the arrows to reorder. Boxes are guides only: they are not part of undo history, the PNG or the PSD, and they are stored with the project. While **Draw boxes on canvas** is on, drag a corner to resize a box, drag its edge or label to move it, and drag anywhere else to draw a new one. Ctrl+Z and Ctrl+Y then undo and redo box changes instead of the drawing. Choosing a Klecks tool ends box drawing.

The drawing is not sent to the model; the result is added as an editable **BBox to Image** layer over the whole canvas. **Working resolution · MP** sets the generation size at the canvas aspect ratio.

## Saving and undo

AI updates use Klecks' native history, so undo and redo apply to layer changes. Saving writes both the composed PNG and the layered PSD. The project gallery receives the saved drawing rather than a separate asset for every preview or stroke.

For required nodes and weights, see [Installation](installation.md). Build and integration details are in [Development](development.md#bundled-klecks-editor).
