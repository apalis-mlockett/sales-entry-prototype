/**
 * Explicit external TypeScript definitions for Sales-UI.
 * Re-exports all domain types for use by JS (with checkJs) or TS.
 */

export type {
  SaleType,
  SaleStatus,
  ActionStatus,
  ActionMode,
  SaleRecord
} from './sales';

export type {
  DailyFuturesRow,
  FuturesDataByMonth
} from './futures';

export type {
  DeliveryLocationOption,
  ValidationError,
  ModalFormState,
  TableDataRow
} from './ui';

export type { SalesUIGlobals } from './globals';
