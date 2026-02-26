# Sales Entry UI — Prototype Documentation

**Handoff document for development teams.** This README describes the **Sales Entry UI** prototype in full detail: every feature, dependency, workflow, data model, and behavioral nuance. The app is a grain sales entry and tracking UI with no backend; data lives in memory and is optionally persisted to `localStorage`. It is intended to be reimplemented or extended by a team using **Cursor** (or any IDE).

---

## Table of Contents

1. [Overview and Business Purpose](#1-overview-and-business-purpose)
2. [Tech Stack and Dependencies](#2-tech-stack-and-dependencies)
3. [Project Structure and File Reference](#3-project-structure-and-file-reference)
4. [Data Model](#4-data-model)
5. [Persistence and Export/Import](#5-persistence-and-exportimport)
6. [Main Table (Parent Rows)](#6-main-table-parent-rows)
7. [Inner Tracking Table (Ledger)](#7-inner-tracking-table-ledger)
8. [Sale Form — General](#8-sale-form--general)
9. [Form Layout and Field Visibility](#9-form-layout-and-field-visibility)
10. [Add Sale Form](#10-add-sale-form)
11. [Edit Form](#11-edit-form)
12. [Set Form (Delivery Date + Close Contract)](#12-set-form-delivery-date--close-contract)
13. [Roll Form (Roll Date + New Futures Month)](#13-roll-form-roll-date--new-futures-month)
14. [Set Quantity Modal](#14-set-quantity-modal)
15. [Validation Reference](#15-validation-reference)
16. [Cash Price Calculation](#16-cash-price-calculation)
17. [Merch Value Calculation](#17-merch-value-calculation)
18. [Futures Data and Dev Note](#18-futures-data-and-dev-note)
19. [Date and Month Pickers](#19-date-and-month-pickers)
20. [Key Functions and Logic](#20-key-functions-and-logic)
21. [UI Behaviors and Nuances](#21-ui-behaviors-and-nuances)
22. [Cursor and Development Setup](#22-cursor-and-development-setup)
23. [Getting Started](#23-getting-started)

---

## 1. Overview and Business Purpose

The app is a **grain sales entry and tracking** prototype. Users can:

- **Create** new sales of type **Cash**, **HTA** (Hedge-to-Arrive), or **Basis**.
- For **HTA** and **Basis**, **track** those sales over time by **Setting** (closing a portion with a delivery date) or **Rolling** (deferring a portion to a later futures month, with carry).
- **Edit** or **Delete** records subject to business rules (e.g. origin not editable once Set/Roll children exist; quantity locked on Set/Rolled records).

**Terminology:**

- **Sale Form** — The main modal (`#salesModal`) used for: **Add Sale**, **Edit**, **Set**, and **Roll**. One modal, four modes; field visibility and validation depend on mode and sale type.
- **Set Quantity Modal** — A smaller modal with a slider to choose how many bushels to Set or Roll. After confirming, it opens the Sale Form in Set or Roll mode with that quantity pre-filled and many fields disabled.
- **Origin** — The top-level sale record (`parent_id === null`). Its `id` is the group identifier; all tracking (Set/Roll) records have `parent_id === origin.id`.
- **Ledger / record set** — The list of records for one sale: the origin plus all child (tracking) records, sorted by `sale_date`.

**Grain marketing context:**

- **Cash:** One-time sale; no tracking. Status is always “Set.”
- **HTA (Hedge-to-Arrive):** Locks futures price; basis set later. Can be partially or fully **Set** (delivery) or **Rolled** (new futures month, carry).
- **Basis:** Locks basis; futures open. Same Set/Roll tracking as HTA for this prototype.

Customer, crop, and year are fixed in the UI (e.g. “Customer ABC / CORN 2025”); the prototype does not parameterize them.

---

## 2. Tech Stack and Dependencies

### 2.1 NPM (package.json)

- **Runtime/build:** None; the app runs as static HTML/JS in the browser, served by Vite in dev.
- **Dev:**
  - **vite** ^5.0.0 — Dev server and production build.
  - **typescript** ^5.0.0 — Type-checking only (`tsc --noEmit`). No TS compilation of app code; `js/sales-ui.js` is plain JavaScript.

Scripts:

- `npm run dev` — Start Vite dev server (e.g. http://localhost:5173/).
- `npm run build` — Production build (output in `dist/`).
- `npm run preview` — Preview production build.
- `npm run typecheck` — Run `tsc --noEmit` (uses `tsconfig.json` and `types/*.d.ts`; `checkJs` is false so JS is not type-checked unless enabled).

### 2.2 CDN (index.html)

All application runtime dependencies are loaded from CDN in `index.html` (no npm runtime packages):

| Dependency        | Version | Purpose |
|-------------------|---------|--------|
| Bootstrap         | 5.3.8   | Layout, modal, dropdown, form controls, dark theme (`data-bs-theme="dark"`). |
| jQuery            | 3.7.1   | DOM, events, AJAX (fetch for JSON is native). |
| Popper.js         | 2.11.8  | Bootstrap dropdown/tooltip positioning. |
| Moment.js         | 2.30.1  | Date parsing/formatting, `sale_date` comparisons. |
| Tempus Dominus    | 6.7.7   | Date picker for Sale/Set/Roll Date and month picker for Delivery Month. |
| Font Awesome      | 6.5.1   | Icons (optional; some UI uses inline SVG). |

Tempus Dominus is attached to:

- `#sale_date_select` — Sale Date / Set Date / Roll Date (single date input).
- `#delivery_month_select` — Delivery Month (month-only, used for Set and Cash).

### 2.3 Local Assets

- **css/style.css** — All custom styles: dark theme, table, ledger, modals, form rows, separator lines, toolbar buttons, disabled states, popovers.
- **js/sales-ui.js** — Entire application logic (~3.3k lines): state, load/save, render, validation, event handlers, Cash Price and Merch Value calculations.

### 2.4 TypeScript Definitions (types/)

Used for editor/IDE support and `npm run typecheck`; the app is not compiled from TypeScript.

- **types/sales.d.ts** — `SaleType`, `SaleStatus`, `ActionStatus`, `ActionMode`, `SaleRecord` (note: `SaleRecord` in code also includes `storage_interest`, `source_id`; see Data Model).
- **types/futures.d.ts** — `DailyFuturesRow`, `FuturesDataByMonth` for daily futures JSON shape.
- **types/globals.d.ts** — `Window.sales_date_picker`, `SalesUIGlobals` for module-level globals.
- **types/ui.d.ts** — `DeliveryLocationOption`, `ValidationError`, `ModalFormState`, `TableDataRow`.

`tsconfig.json` targets ES2020, `allowJs: true`, `checkJs: false`, `typeRoots: ["./types"]`, `include: ["js/**/*.js", "types/**/*.d.ts"]`.

---

## 3. Project Structure and File Reference

```
Sales-UI/
├── index.html              # Single page: main table, modals (Sales, Set Quantity, Delete Confirm), form markup
├── css/
│   └── style.css           # All custom CSS
├── js/
│   └── sales-ui.js         # All application logic
├── daily-futures/          # Spoofed JSON (replaces assets/ in code)
│   ├── daily-futures.json       # Futures months/prices for “today” (Add Sale, Edit)
│   └── future-daily-futures.json # Futures months/prices for “roll date” (Roll form, Carry)
├── types/                  # TypeScript declaration files only
│   ├── sales.d.ts
│   ├── futures.d.ts
│   ├── globals.d.ts
│   └── ui.d.ts
├── package.json
├── tsconfig.json
├── .gitignore              # node_modules/, package-lock.json
└── README.md               # This file
```

- **index.html** — Page structure, table header, footer (Export/Import), Sales modal (form rows, split section, deduct section), Set Quantity modal, Delete confirmation modal. Form field IDs and `data-td-*` attributes for Tempus Dominus.
- **css/style.css** — Table (._table, ._table-inner), ledger (ledger-date-cell, ledger-action-cell, Pending, toolbar), modal/form (hideByDefault, _show, row separators, ._hr), futures dropdown (calendar-dropdown, futures-month-disabled), buttons, invalid-feedback. **Important:** `.hideByDefault._show.row { display: flex }` so that rows used as flex containers (e.g. HTA Comp. Fut. Month + Initial Basis Price) remain side-by-side when shown.
- **js/sales-ui.js** — State (`sales_data`, `currentActionStatus`, `currentActionRecord`, etc.), `loadSalesData`/`saveSalesData`, `renderSalesTable`, `openActionModal`, `saveSale`, `calculateCashPrice`, `buildFormCashPriceBreakdownHtml`, `buildMerchValueBreakdownHtml`, `populatFutureSelection`, validation, all event handlers.

---

## 4. Data Model

### 4.1 Record Shape (sales_data array)

Every sale or tracking record is one object in the in-memory array `sales_data`. Fields used in the app:

| Field | Type | Notes |
|-------|------|--------|
| `id` | number | Unique; auto-incremented on create. |
| `parent_id` | number \| null | `null` = origin (top-level) sale; otherwise = `id` of the origin record. |
| `source_id` | number \| null | Set on create when in Set/Roll mode: the tracking record id that “source” row was used to open the form. Optional; not always present in legacy data. |
| `sale_date` | string | Date only, e.g. `YYYY-MM-DD`. Interpreted as Sale Date, Delivery Date (Set), or Roll Date (Roll). |
| `sale_type` | string | `"Cash"` \| `"HTA"` \| `"Basis"`. |
| `status` | string | `"Created"` \| `"Set"` \| `"Rolled"` \| `"Updated"`. |
| `quantity` | number | Bushels for this record. |
| `futures_month` | string | Typically `YYYY-MM` or full date; compared as first 7 characters. |
| `futures_price` | number | 4-decimal. |
| `basis_price` | number | 4-decimal. |
| `service_fee` | number | 4-decimal; optional. |
| `storage_interest` | number | 4-decimal; optional. Storage/Interest cost per bushel; always subtracted in Cash Price. |
| `cash_price` | number | 4-decimal; usually derived (see Cash Price Calculation). |
| `delivery_month` | string | Month only, e.g. `YYYY-MM`. |
| `delivery_location` | string | Text; used for Cash “Delivery Location,” HTA Set “HTA Delivery Location,” Basis Set “Basis Delivery Location.” |
| `comments` | string | Optional. |
| `merch_gain` | number | 4-decimal; optional. |
| `nearby_futures_month` | string | HTA: comparison futures month. |
| `nearby_futures_price` | number | HTA: captured nearby price. |
| `initial_basis_price` | number | HTA: initial basis. |
| `hta_contract_holder` | string | HTA only. |
| `basis_contract_holder` | string | Basis only. |
| `carry` | number | Roll only (carry for rolling to new futures month). |
| `updated_at` | string | ISO timestamp; used for “Last Updated” and backfilled if missing. |

### 4.2 Parent/Child and Origin

- **Origin:** The record with `parent_id === null`. There is exactly one per “sale” in the UI. Its `id` is the group identifier.
- **Children:** All records with `parent_id === origin.id`. They represent the same sale over time (Created → Set or Rolled).
- **getOriginRecord(record):** If `record.parent_id` is null, returns `record`; otherwise returns the record in `sales_data` with `id === record.parent_id`.

All children (and a copy of the origin for display) are sorted by `sale_date` (oldest first) for the inner tracking table and for quantity math.

### 4.3 Status and Quantity Accounting

- **Created** — Initial HTA/Basis contract (or the origin row shown as “Created”).
- **Set** — A portion (or all) of the contract was closed (delivery date, basis/futures price, etc.). That quantity is no longer “pending.”
- **Rolled** — A portion was rolled to a later futures month; that quantity is still “pending” but tied to a new tracking row.
- **Updated** — Used when editing an existing record; displayed like “Set” in the Action column where appropriate.

**Remaining quantity at origin:**

- `remainingQuantity = origin.quantity - totalSetQuantity - totalRolledQuantity`
- `totalSetQuantity` = sum of `quantity` over all children with `status === 'Set'` (or `'Updated'` where treated as Set).
- `totalRolledQuantity` = sum of `quantity` over all children with `status === 'Rolled'`.

**Remaining from a specific tracking record:**

- For a given row (e.g. a Rolled row), “remaining from this record” = that row’s quantity minus the sum of quantities of all **later** rows (by `sale_date`) that are Set or Rolled. That is the maximum bushels that can still be Set or Rolled from that row.
- Implemented in **getRemainingFromRecord(record)**.

---

## 5. Persistence and Export/Import

- **Persistence:** Optional. On load, `loadSalesData()` reads `localStorage` key **`sales_ui_records`**. If present and valid JSON array, it is used to populate `sales_data`. Any record missing `updated_at` is backfilled with current ISO timestamp and saved.
- **Save:** On every create/update/delete, `saveSalesData()` writes `sales_data` to `localStorage` under the same key.
- **Export:** Footer button **Export JSON** downloads a file `sales_ui_export_YYYY-MM-DD_HH-mm.json` containing `{ sales_ui_records: sales_data, exported_at: "<iso>" }`.
- **Import file:** Footer “Import file” accepts a `.json` file. The file must be either an array of records or an object with a `sales_ui_records` array. `updated_at` is backfilled if missing. On success, `sales_data` is replaced, saved to `localStorage`, and the table re-rendered.
- **Import paste:** Footer “Import paste” opens a prompt for pasted JSON; same normalization and replace logic as file import. A short-lived message indicates success or error.

---

## 6. Main Table (Parent Rows)

- **Data source:** All records with `parent_id === null` (top-level sales).
- **Row click:** Toggles expand/collapse of that sale’s **inner tracking table** (ledger). Only one sale can be expanded at a time; expanding another collapses the previous. `expandedSaleId` is restored after re-renders so the same row stays expanded.
- **Columns (order):**
  1. Empty (no toolbar).
  2. **Orig. Sale Date** — `sale_date` of the origin record.
  3. **Last Updated** — Relative time from the child with the latest `updated_at` (e.g. “5 mins ago”). Stored in `data-last-updated` on the cell; a `setInterval(60000)` updates the displayed text every minute.
  4. **Sale Type** — Origin’s `sale_type`.
  5. **Status** — See below.
  6. **Quantity (bu.)** — Origin’s `quantity`.
  7. **Merch Value** — Sum of drivers (Merch Gain, Carry, Net Initial Basis, Storage/Interest, Service Fee) across the record set, formatted with “/bu.” and a tooltip with breakdown (see Merch Value Calculation).
  8. **Avg. Cash Price** — Weighted average cash price across Set records; tooltip shows breakdown.
  9. **Final Sale Value** — Derived total value; tooltip.
  10. **Contract Location** — Origin’s contract holder or delivery location depending on type.

### 6.1 Parent Status Logic

- **Cash:** Always show **“Set”.**
- **HTA/Basis:**
  - If **all** origin quantity has been Set (`totalSetQuantity >= origin.quantity`): show **“Set”.**
  - Else if **some** has been Set (`totalSetQuantity > 0`): show **“Set: &lt;qty&gt;”** and **“Pending: &lt;qty&gt;”** where Pending = `origin.quantity - totalSetQuantity`.
  - Else: show **“Pending: &lt;origin qty&gt;”** and, if any Rolled, **“Rolled: &lt;qty&gt;”.**

---

## 7. Inner Tracking Table (Ledger)

Renders when a parent row is expanded. One row per “child” in the sorted list: **origin copy first**, then all other children by `sale_date`.

### 7.1 Column Order

Sale Date, Action, Quantity (bu.), Futures Month, Pending (bu.), Delivery Month, Futures Price, Merch Gain, Carry, Basis Price, **Storage/Interest**, Service Fee, Cash Price, Contract Holder, Delivery Location, Comments.

- **Storage/Interest** is displayed before Service Fee. If value is null or 0, default cell color; if &gt; 0, red and value shown in parentheses to indicate loss (same convention as Service Fee).

### 7.2 Row Types and Action Label

- **First row (origin copy):** Action = **“Created”** (HTA/Basis) or **“Set”** (Cash).
- **Other rows:** Action = **“Created”** | **“Set”** | **“Rolled”** | **“Pending”** from `ledger.status` (“Set” shown for `status === 'Updated'` where appropriate).

### 7.3 Pending (bu.) Column

- For each row, **Pending (bu.)** = max bushels that can still be Set or Rolled from that row.
  - **Origin row:** If that row has Set/Roll actions available, value = **remaining quantity at origin**. Otherwise `"--"`.
  - **Non-origin row:** If that row has Set/Roll actions, value = **remaining from this record**. Otherwise `"--"`.
- Rows that have Set/Roll actions get class `ledger-row-has-set-roll` and white text.

### 7.4 Set and Roll Buttons

Set and Roll toolbar buttons are shown only when **both**:

- Sale type is HTA or Basis, and
- The row has “pending” quantity:
  - **Origin row:** `remainingQuantity > 0`.
  - **Any other row:** Row is not a Set record and **remaining from this record** &gt; 0.

### 7.5 Edit and Delete

- **Edit:** Shown for all rows except when the row is the origin **and** there is at least one child with status Set or Rolled (then origin is not editable).
- **Delete:** Always shown. If the record has children, delete confirms that all children will be deleted too.

### 7.6 Comments Column

Cell content is wrapped in a div with class `ledger-comments-cell` (fixed width, max-height, overflow auto).

---

## 8. Sale Form — General

- **One modal** `#salesModal` is used for: **Add Sale**, **Edit**, **Set**, and **Roll**.
- **Hidden inputs:** `#sale_id`, `#parent_id` (set for Set/Roll to origin id).
- **Modal subtitle:** “Add Sale” | “Edit Record” | “Set HTA”/“Set Basis” | “Roll HTA”/“Roll Basis”.
- **Buttons:** Cancel, Save (Add/Edit), or “Set”/“Roll” (Set/Roll). Set/Roll mode hides the normal Save button and shows the action button instead.
- **Dirty check:** On close, if the form state changed from when it was opened, the user is prompted to confirm exit without saving. State is captured after modal is shown (`getSalesModalState` → `normalizeModalState`) and compared on close; a short timer after `shown.bs.modal` is used to avoid capturing initializing changes.

---

## 9. Form Layout and Field Visibility

The form is divided into **rows**. Many sections use the class **`hideByDefault`** and are shown via **`_show`** when a sale type is selected (and optionally when in Set/Roll mode). CSS: `.hideByDefault { display: none }`, `.hideByDefault._show { display: block }`. For **rows** that must keep flex layout when shown, `.hideByDefault._show.row { display: flex }` is applied so columns (e.g. Comp. Fut. Month and Initial Basis Price) stay side-by-side.

**Row layout (conceptual):**

1. **Row 1:** Sale Type (always), Sale Date (shown when type selected), Merch Gain (Cash only when type selected).
2. **Row 2 (HTA only):** Comp. Fut. Month, Initial Basis Price. This row has `id="hta_comp_initial_row"` and `flex-nowrap`; the two columns are `col-3` so they remain single-column width but side-by-side. For Basis this row is **not** shown (avoids a blank row).
3. **Separator line** (`._hr`) then main form.
4. **Row 3:** Futures Month, Delivery Month (when relevant), **Storage/Interest**, Quantity. Storage/Interest is optional, same UI as Merch Gain ($ + p/bu.), visible for all types and all modes (Create, Set, Roll).
5. **Row 4:** Futures Price, Carry (Roll only), Basis Price, Service Fee, Cash Price (read-only, calculated).
6. **Row 5:** HTA Contract Holder / Basis Contract Holder / Delivery Location (one visible depending on type and mode; label changes to “HTA Delivery Location” or “Basis Delivery Location” for Set).
7. **Row 6:** Comments.
8. **Split section** (Set/Roll only): slider for split quantity.
9. **Deduct section** (Cash, or Set/Roll for Basis): checkbox “Deduct from customer storage location inventory” and Storage Location.

**Labels that change by mode:**

- Sale Date field label: “Sale Date” | “Set Date” | “Roll Date” (via `setActionLabels`).
- Delivery/location label: “Delivery Location” | “HTA Delivery Location” | “Basis Delivery Location” (via `checkSalesType` and Set/Roll logic).

**Separator lines:** Every form row in the modal has a bottom border (separator line) via CSS: `#salesModal .modal-body .container > .row, #salesModal .modal-body .container .row { border-bottom: 1px solid #3d4d60; padding-bottom: 1rem }`.

---

## 10. Add Sale Form

- **Trigger:** “Add Sale” button. `clearSalesForm()` then show modal; subtitle “Add Sale”; Save button visible.
- **Sale type** select drives visibility via **checkSalesType()**:
  - **Cash:** Merch Gain, Sale Date, Futures Month, Delivery Month, Quantity, Futures Price, Basis Price, Service Fee, Storage/Interest, Cash Price (auto), Delivery Location, storage deduction, Comments.
  - **HTA:** Sale Date, Comp. Fut. Month, Initial Basis Price (row 2), Futures Month, Quantity, Futures Price, Basis Price (disabled), Delivery Month (disabled), Service Fee, Storage/Interest, Cash Price, HTA Contract Holder, Comments. For HTA Create, Cash Price = Futures + Initial Basis − Service Fee − Storage/Interest (no Carry).
  - **Basis:** Sale Date, Futures Month, Quantity, Futures Price, Basis Price, Delivery Month (disabled for create), Service Fee, Storage/Interest, Cash Price, Basis Contract Holder, Comments.
- **Defaults:** Sale Date = today. Merch Gain, Service Fee, Storage/Interest, etc. can be empty.
- **Futures Month:** Custom dropdown `#futures_month_options` populated by **populatFutureSelection()** (from `./daily-futures/daily-futures.json`). Selecting a month fills Futures Price.
- **Delivery/Location fields:** Delivery Location, HTA Contract Holder, Basis Contract Holder use a shared `<datalist id="delivery_location_list">` and placeholder “Search locations…”. Options are populated from `deliveryLocationOptions`; on **focus** a synthetic `input` + click is used so the list appears without a second click.
- **Cash Price:** Auto-calculated (see Cash Price Calculation). Recalculated on input/change/blur of futures_price, basis_price, service_fee, carry, storage_interest.
- **Validation:** See Validation Reference. On save, new record gets `parent_id: null`, `status: 'Created'` (or `'Set'` for Cash), new `id`, and `updated_at` set to now.

---

## 11. Edit Form

- **Trigger:** Edit on a tracking row. Record loaded by id; form populated; subtitle “Edit Record”; Save button shows “Save Changes”.
- **Set/Rolled records:** If the record’s status is Set, Rolled, or Updated, **Quantity** is **disabled**.
- **Futures options:** When the modal is shown, **populatFutureSelection()** runs; then the current record’s futures month (and nearby for HTA) is selected in the dropdowns.
- **HTA Set/Basis Set:** When editing a Set (or Updated) child, Delivery Location is populated from `record.delivery_location` (the form shows “HTA Delivery Location” or “Basis Delivery Location” and uses the same `#delivery_location` input). HTA Contract Holder / Basis Contract Holder are also populated from the record; for Set children those contract holder fields are disabled and the editable location is `#delivery_location`.
- On save, existing record is updated in `sales_data` and `updated_at` set to now.

---

## 12. Set Form (Delivery Date + Close Contract)

- **Trigger:** From Set Quantity modal, user confirms quantity and chooses Set; **openActionModal('Set', record, qty)** is called.
- **Field behavior:**
  - **Set Date** (Sale Date field): Initially empty; placeholder “-Select-”. Calendar **min date** = tracking record’s **Sale Date** (local start-of-day). **viewDate** is set to that min date (using Tempus Dominus `DateTime`) when the picker is configured so the calendar opens on the first selectable month. No max date.
  - Merch Gain and Service Fee are **reset to empty**. Storage/Interest is also reset for the new Set record.
  - Quantity, Futures Month, and (depending on type) other fields are **disabled**. HTA: Basis Price editable; Basis: Futures Price editable. Delivery Month and Delivery Location (labeled “HTA Delivery Location” or “Basis Delivery Location”) are required and editable.
- **Validation:** Set Date required; Set Date ≥ tracking record’s Sale Date; Delivery Month and Delivery Location required; HTA requires Basis Price; Basis requires Futures Price.
- **Save:** New child record with `parent_id = origin.id`, `status: 'Set'`, `quantity` = chosen Set quantity; `updated_at` set.

---

## 13. Roll Form (Roll Date + New Futures Month)

- **Trigger:** From Set Quantity modal, user confirms quantity and chooses Roll; **openActionModal('Roll', record, qty)** is called.
- **Field behavior:**
  - **Roll Date** (Sale Date field): Initially empty; placeholder “-Select-”. Calendar min date = tracking record’s Sale Date (local); viewDate set to first selectable month.
  - **Futures Month:** Required; must be **later than** the origin’s futures month and **strictly after** the **tracking record’s** futures month. Options with month ≤ that tracking record’s month are **disabled** (class `futures-month-disabled`). Options are populated from **getFutureDailyFuturesForRoll()** (./daily-futures/future-daily-futures.json); then **applyRollFuturesMonthRestrictions()** applies the disable.
  - **Carry** field is shown and required. Carry tip content is built dynamically (formula: Current Roll Month price − Current Orig. Month price from future-daily-futures).
  - Merch Gain and Service Fee reset to empty. Quantity and other fields disabled.
- **Validation:** Roll Date required; Roll Date ≥ tracking record’s Sale Date; Futures Month required; Futures Month &gt; origin month; Futures Month &gt; tracking record’s futures month; Carry required.
- **Save:** New child record with `parent_id = origin.id`, `status: 'Rolled'`, `quantity` = chosen Roll quantity; `updated_at` set.

---

## 14. Set Quantity Modal

- **When:** User clicks Set or Roll on a tracking row. The app opens the **Set Quantity** modal first.
- **Purpose:** Choose how many bushels to Set or Roll. Slider and numeric input; min 1 or 1,000 (if max ≥ 1,000 step is 1,000), max = **remaining quantity at origin** (if row is origin) or **remaining from this record** (if row is not origin). If max ≤ 0 the modal is not opened.
- After the user confirms, the modal closes and the **Sale Form** opens in Set or Roll mode with that quantity and the rest of the form populated from the same record.

---

## 15. Validation Reference

- **Common:** Sale Type, Sale Date, Futures Month, Quantity &gt; 0.
- **Roll:** Carry required; Futures Month &gt; origin month; Futures Month &gt; tracking record’s futures month; Roll Date ≥ tracking record’s Sale Date.
- **Set:** Set Date (Delivery Date) ≥ tracking record’s Sale Date; Delivery Month and Delivery Location required; HTA → Basis Price required; Basis → Futures Price required.
- **Add Sale — Cash:** Delivery Month, Futures Price, Basis Price, Delivery Location.
- **Add Sale — HTA:** Comp. Fut. Month, Initial Basis Price, Futures Price, HTA Contract Holder.
- **Add Sale — Basis:** Basis Price, Basis Contract Holder.
- **Storage:** If “Deduct from customer storage” is checked, Storage Location required.

Errors are shown by adding `is-invalid` to the field and appending an `invalid-feedback` message; the first error is scrolled into view and focused where possible.

---

## 16. Cash Price Calculation

**Formula (unified):**  
`cash_price = futures_price + basis_price + carry - service_fee - storage_interest`  
with the following nuances:

- **HTA Create:** Basis price used is Initial Basis Price; Carry = 0. So: Futures + Initial Basis − Service Fee − Storage/Interest.
- **HTA Roll:** Futures price is taken from **currentActionRecord** (the row we’re rolling from); Carry and Service Fee (and Storage/Interest) from form. So: Orig. Futures + Carry − Storage/Interest − Service Fee.
- **All other (Cash, HTA Set, Basis, etc.):** Futures + Basis + Carry (if Roll) − Storage/Interest − Service Fee.

**Storage/Interest** is always subtracted when present; it is optional (no validation). **calculateCashPrice()** runs on input/change/blur of futures_price, basis_price, service_fee, carry, storage_interest and writes the result to `#cash_price`.

**Cash Price tooltip (form):** The Cash Price field has a popover that shows the formula breakdown. Content is built by **buildFormCashPriceBreakdownHtml()** and varies by sale type and mode (HTA Create, HTA Set, HTA Roll, Cash, Basis). Each line shows a component (e.g. Futures Price, Basis Price, Carry, **Storage/Interest**, Service Fee) with a value; then a total line “(Cash Price)”. **Storage/Interest** appears **above** Service Fee in the list and is always shown with a minus sign; its value is **red** when non-null and non-zero, gray when zero. Same color rules as Service Fee and Initial Basis Price (red for costs). Total is bold green, or red if negative.

---

## 17. Merch Value Calculation

**Merch Value** is the sum of “driver” contributions across the record set (origin + children), displayed per-bushel in the main table and in a tooltip with a breakdown table.

**Drivers (order):** Merch Gain, Carry, Net Initial Basis, **Storage/Interest**, Service Fee.

- **Merch Gain** — From each record’s `merch_gain`; positive = green, negative = red (with parentheses).
- **Carry** — From each record’s `carry` (Roll records).
- **Net Initial Basis** — For Set records only: (Set Basis − Initial Basis) when origin has Initial Basis Price.
- **Storage/Interest** — From each record’s `storage_interest`; only shown when &gt; 0. Stored as positive; displayed as **negative** (cost) in the breakdown. Order: **before** Service Fee.
- **Service Fee** — From each record’s `service_fee`; displayed as negative (cost).

**buildMerchValueBreakdownHtml(saleId)** builds an HTML table: Date, Action, Qty, Fut. Month, Driver, Value / bu. Rows are sorted by date then by driver order. When a record has only a portion of the origin quantity (e.g. partial Set), the driver values are adjusted by weight (recQty/originQty) and shown with a struck-through full value plus “X%” and the adjusted value. The last row is **Merch Value:** total (green if positive, red if negative).

---

## 18. Futures Data and Dev Note

- **Add Sale / Edit:** Futures months and prices come from **./daily-futures/daily-futures.json**. Loaded by **getDailyFuturesForToday()** and processed in **populatFutureSelection()** (default `useFutureFile = false`). Data is grouped by futures month (first 7 chars); the dropdown lists months and stores selected month and price in the form and in `#futures_price` (and `#futures_price_reference`).
- **Roll form:** Futures options come from **./daily-futures/future-daily-futures.json** (simulating “as of roll date”). Loaded by **getFutureDailyFuturesForRoll()** and passed to **populatFutureSelection(true)**. **Carry** is computed as (Current Roll Month price − Current Orig. Month price) from this file when available.
- **Dev note link:** Next to the Futures Month label in the form, a “Dev note” link toggles a message in **#futures_month_dev_note_msg**. The message states: *“Will use API: [/api/external/market/futures/crop/[CROP]/daily] to pull accurate/current futures months/prices. For now, reading from spoofed .json flat files in ./assets/*”* (note: actual path in code is `./daily-futures/`; the dev note text still says ./assets/* for historical reference).
- **JSON shape:** See **types/futures.d.ts** (`DailyFuturesRow`, `FuturesDataByMonth`). Expected fields include date, crop, futures_month, last (price), etc.

---

## 19. Date and Month Pickers

- **Tempus Dominus 6.7.7** is used for:
  - **Sale / Set / Roll Date:** Attached to `#sale_date_select` (wrapper) and `#sale_date` (input). Picker instance is **window.sales_date_picker**. For Set/Roll, **restrictions.minDate** is set to the tracking record’s `sale_date` (local start-of-day via Moment); **maxDate** is cleared. **viewDate** is set using the library’s **DateTime** (via **toTempusDominusDateTime()**) so the calendar opens on the first selectable month; setting viewDate is done when applying restrictions (in openActionModal and in shown.bs.modal), not inside the picker’s “show” event, to avoid the calendar failing to open. **resetActionState()** clears min date.
  - **Delivery Month:** Attached to `#delivery_month_select`; month-only view.
- **Active picker:** Only one date/month picker is “active” at a time. When the sale date picker is shown, any other open picker (e.g. delivery month) is closed via a **show** event subscription. Subscriptions use **tempusDominus.Namespace.events.show** and **hide**.
- **Validation:** When the user closes the Sale Date or Delivery Month picker after selecting a value, field validation is cleared for that field (so previous invalid state doesn’t persist).

---

## 20. Key Functions and Logic

- **getOriginRecord(record)** — Returns the top-level sale for `record`.
- **getRemainingQuantity(record)** — Origin’s quantity minus total Set quantity minus total Rolled quantity.
- **getRemainingFromRecord(record)** — For this record, quantity minus the sum of quantities of all **later** (by sale_date) Set/Rolled children.
- **openActionModal(actionType, record, splitQuantity)** — Puts the form in Set or Roll mode: sets `currentActionRecord`, `currentActionStatus`, `currentRollOriginMonth` (Roll only), populates fields, disables/enables inputs, sets date picker min and viewDate to tracking record’s Sale Date, and for Roll runs **populatFutureSelection(true).then(applyRollFuturesMonthRestrictions)** on modal shown.
- **applyRollFuturesMonthRestrictions()** — Adds class `futures-month-disabled` to each `#futures_month_options li` whose futures month (YYYY-MM) ≤ currentActionRecord’s futures month.
- **resetActionState()** — Clears action mode, re-enables Sale Type and quantity/other fields, clears date picker min, removes `futures-month-disabled`, restores labels.
- **openSetSelection(record)** / **openRollSelection(record)** — Set currentSetRecord or currentRollRecord, compute max quantity (origin → getRemainingQuantity; non-origin → getRemainingFromRecord), configure slider and open Set Quantity modal.
- **renderSalesTable()** — Builds main table from `sales_data`: for each origin, builds sorted child list, computes remainingQuantity, totalSetQuantity, totalRolledQuantity, remainingFromThisRecord per row, parent status text, Last Updated, Merch Value, Avg. Cash Price, Final Sale Value; for each child row decides canAddTracking, Pending value, toolbar buttons (Set, Roll, Edit, Delete), and cell content (including Storage/Interest and Service Fee with parentheses and red when &gt; 0).
- **saveSale()** — Reads form (getSalesModalState-style collection including storage_interest), validates, then either creates a new record (new id, push to sales_data) or updates by id; sets updated_at; then renderSalesTable() and closes modal.
- **calculateCashPrice()** — Computes cash price from form fields (including storage_interest) and sets `#cash_price`.
- **buildFormCashPriceBreakdownHtml()** — Returns HTML for the Cash Price popover (formula lines + total), including Storage/Interest above Service Fee, with red for costs when non-zero.
- **buildMerchValueBreakdownHtml(saleId)** — Returns HTML table for Merch Value tooltip (drivers: Merch Gain, Carry, Net Initial Basis, Storage/Interest, Service Fee; order and weighting).
- **toTempusDominusDateTime(date)** — Converts a native Date to Tempus Dominus DateTime for use as viewDate (avoids setLocalization errors).

---

## 21. UI Behaviors and Nuances

- **Futures Month dropdown:** Custom dropdown (not native select). Options are `<li>` with `data-futures-month`, `data-futures-price`, `data-sm-txt`. Click selects month and updates hidden `#futures_month` and Futures Price. Disabled options have class `futures-month-disabled` (opacity, pointer-events: none).
- **Delivery/Location fields:** Same datalist; on focus, a short-delay synthetic input + click so the list opens without a second click.
- **Last Updated:** Cell has `data-last-updated="<iso timestamp>"`. Every 60 seconds, all such cells have their text updated to a relative format (e.g. “X mins ago”).
- **Expand/collapse:** One expanded sale at a time; `expandedSaleId` is restored after render so the same row stays expanded.
- **hideByDefault / _show:** Sections (e.g. sale date column, HTA row, sales_form_elem, delivery_month_elem) are hidden until sale type (and mode) is set. Adding the class `_show` displays them. Rows must keep `display: flex` when shown so that `.hideByDefault._show.row { display: flex }` is in style.css.
- **Decimals:** Price inputs use class `dec4`; on blur, value is formatted to 4 decimal places. Quantity is formatted with commas (e.g. 15,000) via **formatSetQuantity** / **parseSetQuantityInput**.

---

## 22. Cursor and Development Setup

- The project is a standard Vite + static HTML/JS app. **Cursor** can open the repo and run `npm run dev` for the dev server and `npm run typecheck` for TypeScript checking (types only; JS is not compiled).
- **.gitignore** includes `node_modules/` and `package-lock.json` so they are not committed. After clone, run `npm install` to install Vite and TypeScript.
- No Cursor-specific config files (e.g. .cursorrules) are included in this repo; the team may add their own.

---

## 23. Getting Started

```bash
npm install
npm run dev
```

Open the URL shown (e.g. http://localhost:5173/). Data is in-memory and persisted to **localStorage** under key **sales_ui_records**. Use the footer to **Export JSON** to back up data or **Import file** / **Import paste** to load a JSON array (or object with `sales_ui_records` array).

To type-check without running the app:

```bash
npm run typecheck
```

---

This README and the code together are intended to give our awesome development team full context to maintain, extend, or reimplement the Sales Entry UI prototype with their creative brilliance.
