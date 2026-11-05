# Bondhu Fund — UI rules

Read with [ARCHITECTURE.md](ARCHITECTURE.md). These rules apply to every screen.

## Shared components (always use these, never native elements)
| Need | Use | Notes |
|---|---|---|
| Dropdown | `SearchableSelect` (alias `Select`) from `components/common/SearchableSelect` | `options=[{value,label,subLabel?,badge?}]`, `value`, `onChange(value)`. Always searchable. `size="sm"` in toolbars/filter bars, default `md` in forms. `clearable` for optional filters. **No native `<select>` anywhere.** |
| Date | `DatePicker` from `components/common/DatePicker` | `value`/`onChange` are ISO `YYYY-MM-DD` (or `''`). Click anywhere opens the calendar; shows dd/mm/yyyy, Bangla digits/months in bn. `min`/`max` ISO. **No `<input type="date">`.** |
| Month | `MonthPicker` from `components/common/MonthPicker` | value like `June 2024`. |
| Dialog | `Modal` from `components/common/Modal` | `open`, `onClose`, `title`, `subtitle`, `icon`, `size` (sm/md/lg/xl), `footer`, `locked` (while saving). Soft frosted backdrop. **Do not hand-roll `fixed inset-0 bg-black/...` overlays.** Confirmations → small `Modal` (`size="sm"`) rather than `window.confirm` where practical. |
| Image upload | `imageFileToDataUrl(file, {maxSize, square, keepTransparency})` from `utils/image` | Returns a data URL to store via the API. |

## Language (Bangla must be complete)
- Every visible string goes through `t('area.key', 'English')` with the Bangla in your area's dictionary file `src/locales/<area>.ts`
  (`'members.add_title': { en: 'Add member', bn: 'সদস্য যোগ করুন' }`). Shared words are in `src/locales/common.ts` (`common.*`, `status.*`, `role.*`) — reuse them.
- Placeholders, tooltips (`title`), aria-labels, empty states, toasts, confirm text, table headers, chart labels and export dialogs too.
- **Data values:** wrap statuses/roles/categories/sectors/payment methods with `tv(value)` (uses master-data `name_bn` + status dictionary).
  Names with a Bangla variant: `bnName(member.name, member.name_bn)`.
- Numbers/money/dates: `formatCurrency`, `toBanglaDigits` for counts/percentages, `formatDate(iso)`, `formatMonth(key)`. Never print a raw number, ISO date or `2024-06` in the UI.
- CSV exports keep English headers and raw values (machine-readable); on-screen text is translated.
- Bangla text runs ~20–30% longer: avoid fixed widths on buttons/labels, allow wrapping, use `min-w-0` + `truncate` only where a tooltip shows the full text.

## Spacing & density
- Form controls: min height 44px (`md`), 38px (`sm`); `gap-4` between fields; labels via `.form-label`.
- Filter bars: wrap (`flex flex-wrap gap-3`), each control has a sensible min width (`min-w-[180px]`).
- Tables in `overflow-x-auto`; row padding `py-3`.

## Performance
- Debounce free-text search inputs (~250 ms) before querying.
- Don't refetch on every keystroke/render; depend on real inputs + `refreshKey`.
- Use settings / master data from `useApp()` (`settings`, `masterData`, `orgName`) instead of re-fetching them per screen.
- Memoize derived lists (`useMemo`) and option arrays passed to `SearchableSelect`.
