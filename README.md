# Carousel Splitter

A Canva app that turns one wide image into a run of carousel slides, cut so
artwork carries across the swipe.

Draw the whole carousel as one wide picture, then let the app cut it into pages.

## One-time setup

1. Create a developer account at <https://www.canva.com/developers/>.
2. Create an app in the Developer Portal. Any name; you don't need to fill in
   anything else yet.
3. Copy your App ID from the portal into `.env`:

   ```
   CANVA_APP_ID=AAG...
   ```

4. Install the CLI and log in:

   ```bash
   npm install -g @canva/cli@latest && canva login
   ```

## Running it

```bash
npm start
```

That serves the app on `localhost:8080`. You can't open that URL directly —
click **Preview** in the Developer Portal, which opens Canva with the app
running in the side panel. Open a design that supports adding pages (a
presentation or an Instagram post; docs and whiteboards don't) and the panel
will say so if it can't.

To get hot reload, set `CANVA_APP_ORIGIN` in `.env` from **Developer Portal →
your app → Settings → Security**, and `CANVA_HMR_ENABLED=TRUE`.

## Starting from scratch

Pick a slide count and the panel shows the artwork size it needs, then adds a
blank page at exactly that size to draw on:

| Slides | 4:5         | 1:1         |
| ------ | ----------- | ----------- |
| 2      | 2160 × 1350 | 2160 × 1080 |
| 3      | 3240 × 1350 | 3240 × 1080 |
| 4      | 4320 × 1350 | 4320 × 1080 |
| 5      | 5400 × 1350 | 5400 × 1080 |
| 6      | 6480 × 1350 | 6480 × 1080 |
| 7      | 7560 × 1350 | 7560 × 1080 |

Canva caps a page at 8000 px per side, so 8 or more slides get a proportionally
smaller page (93%, 82%, 74% for 8, 9 and 10). Splitting still emits 1080 px
slides, upscaled from the smaller page.

The page comes with guides drawn on it: thick lines on the slide edges, thin
pairs marking a 6% margin to keep faces and words out of. They go in as one
group, so they are a single thing to select and delete by hand. **Draw guides on this
page** adds them to a page you already have, and redraws them if you change the
slide count.

Canva's own guides would be the right tool — visible while designing, never
exported — but the Apps SDK has no API for them. These are real shape elements,
so splitting deletes them first, automatically. That ordering is the whole
point: the failure mode is guides left on a page, never guides baked into a
slide.

Draw the carousel on that page, then choose **Use current page**.

The panel reads the page you have open when it starts, so a 3240 × 1350 page
already says 3 slides before you touch anything.

## Where the artwork comes from

Three sources, picked in the panel:

- **Upload** a file — made anywhere: Figma, Procreate, a screenshot.
- **Use current page** — exports the design as PNG and splits the page you have
  open. `requestExport` only exports whole designs and an `ExportBlob` carries no
  page id, so the page is matched by aspect ratio. A second page of exactly the
  same shape is the one case that can't be told apart, and the panel says so.
- **Use selected image** — takes whatever image is selected on the canvas.
- **Use a group on this page** — crops the page export to a group's box. An app
  can't see the canvas selection (`SelectionScope` covers only image, video and
  text content), so the group is chosen from a list; one group needs no choosing.

The selected-image case is the cheapest: the artwork is already an asset in your
account, so linked mode reuses its ref and never downloads, re-encodes, or
re-uploads anything.

## The two modes

**Separate** cuts the composite into N images, uploads each one, and puts one on
each page. Each slide is its own asset in your Uploads, editable on its own.

**Linked** puts one image on every page, offset one slide-width further left
each time, sized so Canva's own scaling reproduces the cover fit. Canva clips at
the page boundary, so each page shows its own window onto one picture. Move the
artwork on any page and the others still line up.

Linked never touches pixels in the browser, which is why it works on sources the
browser isn't allowed to read (see below).

## Limits worth knowing

- `upload()` caps data URLs at 10MB. The app encodes PNG first and drops to JPEG
  only when PNG would exceed that.
- Canva pages must be 40–8000px per side and under 25M px of area. The slide
  presets are well inside this.
- Browsers cap canvas size, which is what bounds the carousel at 10 slides in
  separate mode. Linked mode has no such limit.
- Canva doesn't document CORS headers on exported-design URLs. If they're
  missing, separate mode can't read the pixels back and says so; linked mode is
  unaffected, because Canva's servers fetch the image rather than the browser.
- Instagram shows carousel slides one at a time, not side by side. The
  continuity is an illusion of the swipe, so keep faces and words off the seams.

## Layout

| File          | What's in it                                                |
| ------------- | ----------------------------------------------------------- |
| `slicer.ts`   | Fit geometry, page sizing, and canvas work. DOM-free maths. |
| `guides.ts`   | Drawing and removing the slide guides.                      |
| `sources.ts`  | Upload, design export, and canvas selection as one type.    |
| `split.ts`    | Upload and page creation for both modes.                    |
| `preview.tsx` | Seam overlay on a CSS cover fit — reads no pixels.          |
| `app.tsx`     | The panel UI.                                               |

All under `src/intents/design_editor/`.

```bash
npx jest src/          # tests for this app
npm run lint:check     # eslint + tsc
```

`examples/` and `reference_apps/` are Canva's starter-kit samples, left in place
as reference. They're separate npm workspaces and don't affect the build.
