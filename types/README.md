# TypeScript type definitions

Explicit, external TypeScript definition files for all objects in the Sales-UI application.

## Layout

| File | Contents |
|------|----------|
| `sales.d.ts` | `SaleRecord`, `SaleType`, `SaleStatus`, `ActionStatus`, `ActionMode` |
| `futures.d.ts` | `DailyFuturesRow`, `FuturesDataByMonth` |
| `ui.d.ts` | `DeliveryLocationOption`, `ValidationError`, `ModalFormState`, `TableDataRow` |
| `globals.d.ts` | `Window.sales_date_picker`, `SalesUIGlobals` |
| `jquery.d.ts` | Minimal `JQuery` / `$` for validation and DOM helpers |
| `index.d.ts` | Re-exports all public types |

## Usage

- **Type-check (no emit):** `npm run typecheck` or `npx tsc --noEmit`
- **From TypeScript:** `import type { SaleRecord } from './types';` or from `./types/sales`
- **From JSDoc (in .js):** Enable `// @ts-check` and use e.g. `@param {import('./types/sales').SaleRecord} record`

The project `tsconfig.json` includes `js/**/*.js` and `types/**/*.d.ts` with `allowJs: true`, so you can turn on `checkJs` later to type-check the JavaScript against these definitions.
