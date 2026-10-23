# Dual-Mode Portal Lab

Procedural level generation, reachability analysis and a two-character solver for a co-op portal puzzle game with Zelda (top-down) and Mario (platformer) movement on the same grid. See `README.md` for the full description.

## Project structure

```
├── src/core/      # Pure JS: geometry, physics, analysis, solver, metrics, grammar, generator, replay
├── src/ui/        # Canvas editor / visualizer / game / generation browser
├── tests/         # node:test suite (npm test)
├── scripts/       # CLI generator (npm run generate)
├── index.html
└── vite.config.js # Replit-specific dev server config (port 5000)
```

## Development

- `npm run dev` serves on `0.0.0.0:5000`.
- `npm test` runs the automated tests.
- Deployment is static: `./build.sh` (npm install + vite build), output in `dist/`.
