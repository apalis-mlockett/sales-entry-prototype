/**
 * Explicit external type definitions for UI and form objects.
 */

/**
 * Delivery location option for datalist/dropdown (id + label).
 */
export interface DeliveryLocationOption {
  id: number;
  label: string;
}

/**
 * Validation error item used when displaying form errors.
 * elem is a jQuery wrapper for the field to highlight.
 */
export interface ValidationError {
  err: string;
  elem: JQuery;
  field: string;
}

/**
 * Modal form state: key-value map from form control ids to string or boolean values.
 * Used for dirty checking (getSalesModalState / normalizeModalState).
 */
export type ModalFormState = Record<string, string | boolean>;

/**
 * Minimal table data row shape (e.g. tabledata sample in code).
 */
export interface TableDataRow {
  id: number;
  sale_type: string;
  sale_date: string;
}
