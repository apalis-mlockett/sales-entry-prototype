# Sales Entry UI — Prototype Documentation

This document describes the **logic, conditions, forms, and behavior** of the Sales Entry UI prototype in enough detail for another team to reverse-engineer it into an existing application. Data is stored in-memory (with optional `localStorage` persistence); there is no backend.

---

## 1. Overview and Purpose

The app is a **grain sales entry and tracking** UI. Users can:

- Create new sales of type **Cash**, **HTA** (Hedge-to-Arrive), or **Basis**.
- For HTA and Basis, **track** those sales over time by **Setting** (closing) or **Rolling** (deferring) some or all of the quantity.
- Edit or delete records subject to business rules.

**Form terminology used in this doc:**

- **Sale Form** — The main modal form used for: creating a new sale (Add Sale), editing an existing record (Edit), completing a **Set** (Delivery Date + required fields), or completing a **Roll** (Roll Date + new futures month + Carry).
- **Set Quantity Modal** — A small modal with a slider to choose how many bushels to Set or Roll; after confirming, it opens the Sale Form in Set or Roll mode with that quantity.

---

## 2. Tech Stack and Project Structure

- **HTML:** Single page (`index.html`), Bootstrap 5.3.8 (dark theme), one main table and several modals.
- **CSS:** `css/style.css` — layout, table styling, dropdowns, toolbars, calendar dropdown, disabled states.
- **JS:** `js/sales-ui.js` — all application logic (no framework; jQuery 3.7.1, Moment.js, Tempus Dominus 6.7.7 for date/month pickers).
- **Data:** In-memory array `sales_data`; optionally persisted to `localStorage` under key `sales_ui_records`.

**External scripts (CDN):** jQuery, Popper, Bootstrap JS, Tempus Dominus, Moment.js.

---

## 3. Data Model

### 3.1 Record structure

Every sale or tracking record is a single object in the `sales_data` array. Fields used in the app:

| Field | Type | Notes |
|-------|------|--------|
| `id` | number | Unique; auto-incremented on create. |
| `parent_id` | number \| null | `null` = top-level (origin) sale; otherwise = `id` of the origin record. |
| `sale_date` | string | Date only, e.g. `YYYY-MM-DD`. Used as Sale Date, Delivery Date (Set), or Roll Date (Roll). |
| `sale_type` | string | `"Cash"` \| `"HTA"` \| `"Basis"`. |
| `status` | string | `"Created"` \| `"Set"` \| `"Rolled"` \| `"Updated"`. |
| `quantity` | number | Bushels for this record. |
| `futures_month` | string | Typically `YYYY-MM` or full date; compared as first 7 chars. |
| `futures_price` | number | 4-decimal. |
| `basis_price` | number | 4-decimal. |
| `service_fee` | number | 4-decimal. |
| `cash_price` | number | 4-decimal; often derived. |
| `delivery_month` | string | Month only, e.g. `YYYY-MM`. |
| `delivery_location` | string | Text. |
| `comments` | string | Optional. |
| `merch_gain` | number | 4-decimal, optional. |
| `nearby_futures_month` | string | HTA: comparison futures month. |
| `nearby_futures_price` | number | HTA: captured nearby price. |
| `initial_basis_price` | number | HTA: initial basis. |
| `hta_contract_holder` | string | HTA only. |
| `basis_contract_holder` | string | Basis only. |
| `carry` | number | Roll only (fee/carry for rolling). |
| `updated_at` | string | ISO timestamp; used only for "Last Updated" and backfilled if missing. |

### 3.2 Parent/child and “origin”

- **Origin (top-level) record:** `parent_id === null`. There is exactly one per “sale” in the UI. Its `id` is the group identifier.
- **Child (tracking) records:** `parent_id === origin.id`. They are the same “sale” over time (Created → Set or Rolled).
- **Origin record for any record:** Resolved by `getOriginRecord(record)`: if `record.parent_id` is null, the record is the origin; otherwise the origin is the record in `sales_data` with `id === record.parent_id`.

All children (including a copy of the origin for display) are sorted by `sale_date` (oldest first) for the inner tracking table and for quantity math.

### 3.3 Status and quantity accounting

- **Created** — Initial HTA/Basis contract (or the origin row shown as “Created”).
- **Set** — A portion (or all) of the contract was closed (delivery date, basis/futures price, etc.). That quantity is no longer “pending.”
- **Rolled** — A portion was rolled to a later futures month; that quantity is still “pending” (not Set) but is tied to a new tracking row.
- **Updated** — Used when editing an existing record; displayed like “Set” in the Action column where relevant.

**Remaining quantity (at origin):**

- `remainingQuantity = origin.quantity - totalSetQuantity - totalRolledQuantity`
- `totalSetQuantity` = sum of `quantity` over all children with `status === 'Set'`.
- `totalRolledQuantity` = sum of `quantity` over all children with `status === 'Rolled'`.

**Remaining from a specific tracking record:**

- For a given row (e.g. a Rolled row), “remaining from this record” = that row’s quantity minus the sum of quantities of all **later** rows (by `sale_date`) that are Set or Rolled. That is the max bushels that can still be Set or Rolled from that row.

---

## 4. Main Table (Parent Rows)

- **Data source:** All records with `parent_id === null` (top-level sales).
- **Row click:** Toggles expand/collapse of that sale’s **inner tracking table** (child records). Only one sale can be expanded at a time; expanding another collapses the previous.
- **Columns:**
  1. Empty (no toolbar).
  2. **Originating Sale Date** — `sale_date` of the origin record (first in sorted children).
  3. **Last Updated** — Relative time from the child with the latest `updated_at` (e.g. “5 mins ago”). Stored in `data-last-updated` on the cell; a `setInterval(60000)` updates the displayed text every minute.
  4. **Sale Type** — Origin’s `sale_type`.
  5. **Status** — See below.
  6. **Merch Value** — Merch Gain + Carry + (Set Basis − Initial Basis) − Fees across all children (record set), formatted with "/bu."
  7. **Quantity (bu.)** — Origin’s `quantity`.

### 4.1 Parent status logic

- **Cash:** Always show **"Set"**.
- **HTA/Basis:**
  - If **all** origin quantity has been Set (`totalSetQuantity >= origin.quantity`): show **"Set"**.
  - Else if **some** has been Set (`totalSetQuantity > 0`): show **"Set: &lt;qty&gt;"** and **"Pending: &lt;qty&gt;"** where Pending = `origin.quantity - totalSetQuantity` (includes Rolled quantity that is not yet Set).
  - Else: show **"Pending: &lt;origin qty&gt;"** and, if any Rolled, **"Rolled: &lt;qty&gt;"**.

---

## 5. Inner Tracking Table (Ledger)

- Renders when a parent row is expanded. One row per “child” in the sorted list: **origin copy first**, then all other children by `sale_date`.
- **Columns (order):** Sale Date, Action, Quantity (bu.), Pending (bu.), Futures Month, Delivery Month, Futures Price, Merch Gain, Carry, Basis Price, Service Fee, Cash Price, Contract Holder, Delivery Location, Comments.

### 5.1 Row types and Action label

- **First row (origin copy):** Action = **"Created"** (HTA/Basis) or **"Set"** (Cash).
- **Other rows:** Action = **"Created"** | **"Set"** | **"Rolled"** | **"Pending"** from `ledger.status` (with “Set” shown for `status === 'Updated'` where appropriate).

### 5.2 Pending (bu.) column

- For each row, **Pending (bu.)** = max bushels that can still be Set or Rolled from that row.
  - **Origin row:** If that row has Set/Roll actions, value = **remaining quantity at origin** (`remainingQuantity`). Otherwise `"--"`.
  - **Non-origin row:** If that row has Set/Roll actions, value = **remaining from this record** (this row’s quantity minus later Set/Rolled quantities). Otherwise `"--"`.
- Rows that have Set/Roll actions get class `ledger-row-has-set-roll` and white text (`#FFFFFF`).

### 5.3 When Set and Roll actions appear

Set and Roll toolbar buttons are shown only when **both**:

- Sale type is HTA or Basis, and  
- The row has “pending” quantity to act on:

  - **Origin row:** `remainingQuantity > 0`.
  - **Any other row:** Row is not a Set record (`status !== 'Set'`) and **remaining from this record** &gt; 0 (i.e. this row’s quantity not fully consumed by later Set/Roll rows).

So: the first (Created) row can show Set/Roll until the origin is fully Set or Rolled; a Rolled row can show Set/Roll until its quantity is fully consumed by later Set/Roll rows.

### 5.4 Edit and Delete

- **Edit:** Shown for all rows except when the row is the origin **and** there is at least one child with status Set or Rolled (then origin is not editable).
- **Delete:** Always shown. If the record has children, delete confirms that all children will be deleted too.

### 5.5 Comments column

- Cell content is wrapped in a div with class `ledger-comments-cell`, styled with `width: 250px`, `max-height: 30px`, `overflow: auto`, `text-wrap: auto`.

---

## 6. Set Quantity Modal (Slider)

- **When:** User clicks Set or Roll on a tracking row. The app opens the **Set Quantity** modal first.
- **Purpose:** Choose how many bushels to Set or Roll (min 5,000, step 5,000; if max &lt; 5,000 the min is set to max so one value is possible).
- **Max quantity:**
  - If the row is the **origin** record: max = **remaining quantity at origin** (`getRemainingQuantity(record)`).
  - If the row is **not** the origin (e.g. a Rolled row): max = **remaining from this record** (`getRemainingFromRecord(record)`).
- If max ≤ 0 the modal is not opened.
- After the user confirms, the modal closes and the **Sale Form** opens in Set or Roll mode with that quantity and the rest of the form populated from the same record.

---

## 7. Sale Form — General

- One modal (`#salesModal`) is used for: **Add Sale**, **Edit**, **Set**, and **Roll**.
- **Hidden inputs:** `#sale_id`, `#parent_id` (set for Set/Roll to origin id).
- **Modal subtitle:** “Add Sale” | “Edit Record” | “Set HTA”/“Set Basis” | “Roll HTA”/“Roll Basis”.
- **Buttons:** Cancel, Save (Add/Edit), or “Set”/“Roll” (Set/Roll). Set/Roll mode hides the normal Save button and shows the action button instead.
- **Dirty check:** On close, if the form state changed from when it was opened, user is prompted “Exit without saving?” (or similar); they can cancel to stay or confirm to close without saving.

---

## 8. Add Sale Form

- **Trigger:** “Add Sale” button. `clearSalesForm()` and then show modal; subtitle “Add Sale”; Save button visible.
- **Sale type** select enables/disables sections via `checkSalesType()`:
  - **Cash:** Merch Gain, Sale Date, Futures Month, Delivery Month, Quantity, Futures Price, Basis Price, Service Fee, Cash Price (auto), Delivery Location, storage deduction, Comments.
  - **HTA:** Adds Comp. Fut. Month, Initial Basis Price; HTA Contract Holder; HTA Delivery Location (disabled); Delivery Month disabled.
  - **Basis:** Basis Contract Holder; Basis Delivery Location (disabled); Delivery Month, Futures Price (disabled), Basis Price (required).
- **Defaults:** Sale Date = today (unless overridden elsewhere). Merch Gain, Service Fee, etc. can be empty.
- **Futures Month:** Custom dropdown (`#futures_month_options`) populated by `populatFutureSelection()` (from `/assets/daily-futures.json` or similar). Selecting a month fills Futures Price.
- **Delivery/Location fields:** Delivery Location, HTA Contract Holder, Basis Contract Holder use a shared `<datalist id="delivery_location_list">` and placeholder “Search locations…”. Options are shown on **focus** (synthetic `input` + click) so the list appears without a second click.
- **Cash Price:** Auto-calculated: `futures_price + basis_price + carry - service_fee` (carry only for Roll; for Add/Cash it’s 0 if empty).
- **Validation:** See section 11. On save, new record gets `parent_id: null`, `status: 'Created'` (or `'Set'` for Cash), and a new `id`; `updated_at` set to now.

---

## 9. Edit Form

- **Trigger:** Edit on a tracking row. Record loaded by id; form populated; subtitle “Edit Record”; Save button shows “Save Changes”.
- **Set/Rolled records:** If the record’s status is Set, Rolled, or Updated, the **Quantity** field is **disabled** so it cannot be changed.
- **Futures options:** When the modal is shown, `populatFutureSelection()` runs, then the current record’s futures month (and nearby for HTA) is selected in the dropdowns.
- On save, existing record is updated in `sales_data` and `updated_at` set to now. Origin record (no parent) keeps status “Created” unless it’s Cash (then “Set”); others keep or get “Updated”/action status as appropriate.

---

## 10. Set Form (Delivery Date + Close Contract)

- **Trigger:** From Set Quantity modal, user confirms quantity and chooses Set; `openActionModal('Set', record, qty)` is called.
- **Field behavior:**
  - **Delivery Date** (the Sale Date field, relabeled): Initially **null**; placeholder **"-Select-"**. Calendar **min date** = tracking record’s **Sale Date** (local start-of-day via Moment) so only dates **on or after** that date are selectable.
  - **Merch Gain** and **Service Fee** are **reset to null** (not copied from the record).
  - Quantity, Futures Month, and several other fields are **disabled** (from record). HTA: Basis Price editable; Basis: Futures Price editable. Delivery Month and Delivery Location (HTA/Basis) required and editable.
- **Validation:** Sale Date (Delivery Date) required; Delivery Date must be **≥** tracking record’s Sale Date; Delivery Month and Delivery Location required; HTA requires Basis Price; Basis requires Futures Price.
- **Save:** New child record with `parent_id = origin.id`, `status: 'Set'`, `quantity` = chosen Set quantity; `updated_at` set.

---

## 11. Roll Form (Roll Date + New Futures Month)

- **Trigger:** From Set Quantity modal, user confirms quantity and chooses Roll; `openActionModal('Roll', record, qty)` is called.
- **Field behavior:**
  - **Roll Date** (Sale Date field, relabeled): Initially **null**; placeholder **"-Select-"**. Calendar **min date** = tracking record’s **Sale Date** (local), so only dates **≥** that date are selectable.
  - **Futures Month:** Required; must be **later than the origin’s** futures month and **strictly after** the **tracking record’s** futures month (the row the Roll spawned from). In the dropdown, options with month **≤** that tracking record’s month are **disabled/dimmed** (class `futures-month-disabled`, CSS: reduced opacity, `pointer-events: none`). Options are populated when the modal is shown via `populatFutureSelection()`; then `applyRollFuturesMonthRestrictions()` applies the disable.
  - **Carry** field is shown and required.
  - **Merch Gain** and **Service Fee** reset to null. Quantity and several other fields disabled.
- **Validation:** Roll Date required; Roll Date must be **≥** tracking record’s Sale Date; Futures Month required; Futures Month &gt; origin month; Futures Month &gt; tracking record’s futures month; Carry required.
- **Save:** New child record with `parent_id = origin.id`, `status: 'Rolled'`, `quantity` = chosen Roll quantity; `updated_at` set.

---

## 12. Validation Reference (Save)

- **Common:** Sale Type, Sale Date, Futures Month, Quantity &gt; 0.
- **Roll:** Carry required; Futures Month &gt; origin month; Futures Month &gt; tracking record’s futures month; Roll Date ≥ tracking record’s Sale Date.
- **Set:** Delivery Date ≥ tracking record’s Sale Date; Delivery Month and Delivery Location required; HTA → Basis Price required; Basis → Futures Price required.
- **Add Sale — Cash:** Delivery Month, Futures Price, Basis Price, Delivery Location.
- **Add Sale — HTA:** Comp. Fut. Month, Initial Basis Price, Futures Price, HTA Contract Holder.
- **Add Sale — Basis:** Basis Price, Basis Contract Holder.
- **Storage:** If “Deduct from customer storage” is checked, Storage Location required.

Errors are shown by adding `is-invalid` to the field and appending an `invalid-feedback` message; first error is scrolled into view and focused where possible.

---

## 13. Key Functions (Logic to Reimplement)

- **getOriginRecord(record)** — Returns the top-level sale for `record` (self if `parent_id` null, else the record with `id === parent_id`).
- **getRemainingQuantity(record)** — Origin’s quantity minus total Set quantity minus total Rolled quantity (at origin level).
- **getRemainingFromRecord(record)** — For this record, quantity minus the sum of quantities of all **later** (by `sale_date`) Set/Rolled children. Used as max selectable when Setting/Rolling from a non-origin row.
- **openActionModal(actionType, record, splitQuantity)** — Puts the form in Set or Roll mode: sets `currentActionRecord`, `currentActionStatus` (‘Set’ or ‘Rolled’), `currentRollOriginMonth` (Roll only), populates fields, disables/enables inputs, sets date picker min to tracking record’s Sale Date (local), and for Roll registers a one-time `shown.bs.modal` that runs `populatFutureSelection().then(applyRollFuturesMonthRestrictions)`.
- **applyRollFuturesMonthRestrictions()** — Adds class `futures-month-disabled` to each `#futures_month_options li` whose `data-futures-month` ≤ currentActionRecord’s futures month (YYYY-MM).
- **resetActionState()** — Clears action mode, re-enables Sale Type and quantity/other fields, clears date picker min, removes `futures-month-disabled` from list items, restores labels.
- **openSetSelection(record)** / **openRollSelection(record)** — Set `currentSetRecord` or `currentRollRecord`, compute max quantity (origin → getRemainingQuantity; non-origin → getRemainingFromRecord), configure slider min/max and open Set Quantity modal.
- **renderSalesTable()** — Builds main table from `sales_data`: for each origin, builds sorted `allChildRecords`, computes `remainingQuantity`, `totalSetQuantity`, `totalRolledQuantity`, `remainingFromThisRecord` per row, parent status text, Last Updated, then for each child row decides `canAddTracking`, Pending (bu.) value, and toolbar buttons (Set, Roll, Edit, Delete).
- **saveSale()** — Reads form, validates, then either creates a new record (new id, push to `sales_data`) or updates by id; sets `updated_at`; then `renderSalesTable()` and closes modal.

---

## 14. UI Behaviors and Prototype Details

- **Futures Month dropdown:** Custom dropdown (not native select). Options are `<li>` with `data-futures-month`, `data-futures-price`, `data-sm-txt`. Click selects month and updates hidden `#futures_month` and Futures Price. CSS prevents drag (`user-drag: none`) and keeps dropdown above other content (`z-index: 1060`, solid background).
- **Date picker (Tempus Dominus):** Used for Sale Date and Delivery Month. For Set/Roll, `minDate` is set to the tracking record’s `sale_date` as a **local** start-of-day (`moment(record.sale_date).startOf('day').toDate()`) to avoid timezone issues. Restrictions cleared in `resetActionState()`.
- **Delivery/Location fields:** Same datalist; on focus, a short-delay `input` + `click()` is fired so the list opens without a second click.
- **Last Updated:** Cell has `data-last-updated="<iso timestamp>"`. Every 60 seconds, all such cells have their inner text updated to `formatRelativeDate(timestamp)` (e.g. “X mins ago”, “X hours ago”, “X days ago”).
- **Expand/collapse:** One expanded sale at a time; `expandedSaleId` is restored after `renderSalesTable()` so the same row stays expanded.

---

## 15. Grain Marketing Sale Types (Business Context)

- **Cash:** One-time sale; no tracking. Status is always “Set.”
- **HTA (Hedge-to-Arrive):** Locks futures price; basis set later. Can be partially or fully Set (delivery) or Rolled (new futures month, carry).
- **Basis:** Locks basis; futures open. Same Set/Roll tracking idea as HTA for this prototype.

Customer, crop, and year are fixed in the UI (e.g. “Customer ABC / CORN 2025”); the prototype does not parameterize them.

---

## 16. Getting Started (Dev)

```bash
npm install
npm run dev
```

Open the URL shown (e.g. `http://localhost:5173/`). Data is in-memory; optional `localStorage` key `sales_ui_records` can persist between reloads. Refreshing may reset data depending on load/save implementation.

---

## 17. File Reference

- **index.html** — Page structure, modals (Sales, Set Quantity, Delete Confirm), form fields and IDs.
- **css/style.css** — Table layout, ledger columns, calendar dropdown, `.ledger-row-has-set-roll`, `.ledger-comments-cell`, `.futures-month-disabled`, toolbar buttons, etc.
- **js/sales-ui.js** — All state (`sales_data`, `currentActionRecord`, `currentActionStatus`, etc.), data load/save, rendering, validation, and event handlers.

This README and the code together should be sufficient to reimplement the same logic and behavior in another stack.
