/**
 * Explicit external type definitions for sales domain objects.
 */

/** Sale type as selected in the form and stored on records. */
export type SaleType = 'Cash' | 'HTA' | 'Basis' | '';

/** Record status for display and business logic. */
export type SaleStatus = 'Created' | 'Updated' | 'Set' | 'Rolled' | 'Pending';

/** Action flow: "Set" or "Rolled" when in Set/Roll modal. */
export type ActionStatus = 'Set' | 'Rolled' | null;

/** Internal action mode for Set vs Roll. */
export type ActionMode = 'set' | 'roll' | null;

/**
 * A single sales ledger record (origin or tracking/child).
 * Persisted in localStorage and used throughout the UI.
 */
export interface SaleRecord {
  id: number;
  parent_id: number | null;
  sale_date: string | null;
  sale_type: SaleType;
  status: SaleStatus;
  quantity: number | null;
  futures_month: string | null;
  futures_price: number | null;
  basis_price: number | null;
  service_fee: number | null;
  cash_price: number | null;
  delivery_month: string | null;
  comments: string | null;
  merch_gain: number | null;
  nearby_futures_month: string | null;
  nearby_futures_price: number | null;
  hta_contract_holder: string | null;
  basis_contract_holder: string | null;
  delivery_location: string | null;
  initial_basis_price: number | null;
  carry: number | null;
  updated_at: string;
}
