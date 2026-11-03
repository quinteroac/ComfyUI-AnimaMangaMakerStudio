# Drawing and manga conversion in Klecks

[Documentation](README.md) · [Project README](../README.md)

Klecks handles drawing and layered editing; the **Drawing workflow** selector adds generation, inpainting, redrawing or manga conversion to that same canvas. The result remains editable before it is saved to the project.

**Draw reference** and **Draw panel**, in each gallery header, open a new canvas with a name, AR and MP. The **Draw with Klecks** context menu action opens an existing image to draw over it. [Klecks](https://github.com/bitbof/klecks) runs in a local iframe with brushes, a stabilizer, layers, selection, shapes, text and filters. **Save to project** or **Submit** saves a PNG usable for inference and a PSD with editable layers. Each subsequent save creates a new version; originals are preserved. Reopening a drawing loads its PSD; an imported or generated image opens as an Original layer plus a transparent Drawing layer. Closing asks for confirmation before discarding drawing changes made since the last save.

## Sketch to Art

**Sketch to Art** sends the **Whole canvas** or a **Selected region** to Anima Ref: the drawing is the reference image and the VAE-encoded starting latent, so **Denoise** in Sampling sets how far the result moves from the sketch (0.6 by default). Use **Update region preview**, drag a rectangle in the preview or enter X/Y/width/height. Dashed guides show the same region on the drawing canvas and follow zoom, panning, rotation and mirroring. They are display-only and are excluded from generation inputs, PNG and PSD. **Generate Sketch to Art** runs on demand. **Realtime on stroke release** starts after Klecks finishes the stroke, including its pressure and smoothing; it does not generate while the pen is held down. Only one job runs at a time. New strokes are combined into a request for the latest drawing, and stale results are skipped. **Cancel generation** targets only this editor's job.

Sketch parameters and prompt/settings presets are stored separately for reference and panel drawings in the project. The preset controls at the top of Sketch to Art save, load, clone, import and export the prompt, sampling settings, model overrides, LoRAs, generation region and blending settings without closing Klecks. Models inherit the global Anima Ref configuration and can be overridden in **Models and advanced settings**. Realtime remains a session toggle and is not enabled by loading a preset.

## Control layers

**Control layers**, below the workflow settings in Sketch to Art, Inpaint and BBox to Image, adds Klecks layers named `Control · <type>` that feed LLLite controls: 3D pose, depth, scribble, lineart, any, regions or the pose skeleton, with the benchmarked model, strength and range from [Configuration](configuration.md#controls--lllite). Paint on the new layer, or use **Fill from image** to place a pose render or map from the project, ComfyUI's input folder or the computer. Transparent parts become the background the control expects (black, or white for lineart and any). Control layers are saved in the PSD and stay editable, but they are left out of the drawing sent to the model and of the saved PNG. A listed layer that was deleted or renamed in Klecks is marked as missing until it is added again.

**Pose mannequin**, on a 3D pose layer, opens [VNCCS Pose Studio](https://github.com/AHEKOT/ComfyUI_VNCCS) from vnccs-utils inside the Studio. Pose one to four mannequins, frame them with Pose Studio's capture frame and **Apply to layer**: the render on black replaces the layer, and the Pose Studio state is kept so the next edit starts from the same pose. **From 3D pose**, on a Regions layer, turns the first 3D pose layer into one flat color per mannequin (red, blue, green and yellow, matched by each mannequin's color), the silhouettes the regional control needs; name each figure's position in the prompt.

## Inpaint, outpaint and fix

**Inpaint** repaints only a masked area with Anima and the inpainting LLLite (`anima-lllite-inpainting-v2`). **Add mask layer** creates `Control · Mask`; paint the area to replace in any color, then **Generate Inpaint**. The masked area plus **Context padding** is cropped, generated at **Working resolution · MP** under a latent noise mask and stitched back into an editable **Inpaint** layer. The mask is widened by **Edge feather** so the model repaints the band where the result fades into the drawing, and the painted area stays fully replaced. Control layers apply as well, so a 3D pose layer can guide a repainted figure. **Clear mask** empties the mask layer.

| Task | Mask | Denoise | Use |
| --- | --- | --- | --- |
| **Inpaint** | Mask layer | 1.0 | Replace clothes, objects or background in an area |
| **Outpaint** | Transparent canvas area, grown into the image by **Outpaint overlap**, plus the mask layer | 1.0 | Extend a panel. Set **Extend left/top/right/bottom · px** and **Extend canvas**: the drawing reopens on a larger canvas with every layer moved and the new area transparent. Klecks' undo history starts again after extending. Describe what the new area should show in the prompt. |
| **Fix details** | Mask layer | 0.5 | Redraw a face, hands or another detail at the working resolution, so small areas gain detail, and keep the original's structure |

## Redraw and lineart

**Redraw** redraws the canvas or selected region with Anima while an LLLite holds a structure extracted from the drawing in the graph (comfyui_controlnet_aux for lineart and depth):

| Keep from the drawing | LLLite | What it does |
| --- | --- | --- |
| **Lineart** (default, fidelity 1.0) | lineart | Keeps every line. With mangaVision and the **Color → Manga** preset it inks a color illustration as clean manga, faithful to the source. |
| **Any** (0.7) | any-test | A looser lineart hold. |
| **Grayscale** (1.0) | any-test | Keeps shapes and shading; manga models turn the shading into screentone. |
| **Depth** (1.0) | depth | Keeps only the layout; clothes and framing can change. |
| **Tile** | your Tile & Repair LLLite | The image itself as the control, for a tile model if installed. |

**Denoise** below 1 starts from the drawing and keeps more of its colors; at 1 the colors come from the prompt. The **Watercolor** preset only fills the Style section, and Turbo applies such styles lightly. **Extract lineart** puts the drawing's lines on an editable ink layer: black, with each line's opacity following its strength.

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
