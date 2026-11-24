# Graph Shift App

A tool for visualizing graph data directly in the browser - your data never leaves your machine.

Write a graph in [DOT](https://graphviz.org/doc/info/lang.html) on the left and see it drawn on the right. Drag nodes until the picture reads well: edges follow, and your DOT text stays as it is. Nodes and edges you add or remove on the canvas are written back to the DOT text. Download the result as SVG.

- Five layouts: hierarchical, force-directed, radial, circular, compact grid
- Hand-placed positions are never overwritten without asking
- Undo/redo, autosave in your browser, works offline as an installable app (PWA)

The full specification is in [PRODUCT.md](PRODUCT.md), the visual design in [DESIGN.md](DESIGN.md).

## Development

```sh
npm install
npm run dev        # dev server (no service worker)
npm test           # unit tests (Vitest)
npm run build      # typecheck, build to dist/, verify the build
npm run preview    # serve dist/ on http://localhost:4173
npm run test:e2e   # end-to-end tests (Playwright, uses the installed Chrome)
```

The build output in `dist/` is fully static, uses relative paths and works under any sub-path, e.g. `https://<user>.github.io/graph-shift-app/`. Pushing to `main` deploys it with `.github/workflows/deploy.yml` (enable GitHub Pages with "GitHub Actions" as the source).
