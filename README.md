# Carousel Splitter

A Canva app that turns one wide image into a run of carousel slides, cut so
artwork carries across the swipe.

Draw the whole carousel as a single picture anywhere — Canva, Figma, Procreate —
drop it into the app's side panel, and it adds one page per slide to the open
design.

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

## The two modes

**Separate** cuts the composite into N images, uploads each one, and puts one on
each page. Each slide is its own asset in your Uploads, editable on its own.

**Linked** uploads the composite once and puts the same image on every page,
offset one slide-width further left each time. Canva clips at the page boundary,
so each page shows its own window onto one picture. Move the artwork on any page
and the others still line up — useful while you're still nudging the composition.

## Limits worth knowing

- `upload()` caps data URLs at 10MB. The app encodes PNG first and drops to JPEG
  only when PNG would exceed that.
- Canva pages must be 40–8000px per side and under 25M px of area. The slide
  presets are well inside this.
- Browsers cap canvas size, which is what bounds the carousel at 10 slides.
- Instagram shows carousel slides one at a time, not side by side. The
  continuity is an illusion of the swipe, so keep faces and words off the seams.

## Layout

| File         | What's in it                                            |
| ------------ | ------------------------------------------------------- |
| `slicer.ts`  | Fit geometry and canvas work. Geometry is DOM-free.      |
| `split.ts`   | Upload and page creation for both modes.                 |
| `preview.tsx`| Panel-scale render of the composite with seams drawn on. |
| `app.tsx`    | The panel UI.                                            |

All under `src/intents/design_editor/`.

```bash
npx jest src/          # tests for this app
npm run lint:check     # eslint + tsc
```

`examples/` and `reference_apps/` are Canva's starter-kit samples, left in place
as reference. They're separate npm workspaces and don't affect the build.
