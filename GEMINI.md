# Instructions for AI assistants working in this repository

This project was refactored (v2). Before changing anything, read:
- `docs/ARCHITECTURE.md`: the database runs in the Electron **main process** (`electron/database.ts`). The renderer calls `src/services/db.ts`. Dates are stored as `YYYY-MM-DD` and months as `YYYY-MM`. Never use mock or hardcoded figures.
- `docs/UI_GUIDE.md`: use `SearchableSelect`, `DatePicker` and `Modal` from `src/components/common`. Never use native `<select>`, `<input type="date">` or hand-made overlays. Every string goes through `t()` with Bangla in `src/locales/*`.
- `docs/RELEASE.md`: how to build and sign.

Rules:
1. **Do not restore older versions of files.** `src/context/AppContext.tsx`, `src/services/db.ts` and `electron/*` are the source of truth.
   Files from before v2 (e.g. `selectedMonth` defaulting to `'June 2024'`, or a renderer-side sql.js database) are obsolete.
2. Work on top of the latest git commit. Run `git status` / `git diff` first, and commit small, reviewable changes.
3. Schema changes go through migrations in `electron/database.ts` (`SCHEMA_VERSION`, idempotent `addColumn`). Never edit user data files directly.
4. Run `npm run typecheck` before finishing.
