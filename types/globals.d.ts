/**
 * Explicit external type definitions for global/window extensions and app globals.
 */

import type { SaleRecord, ActionStatus, ActionMode } from './sales';
import type { FuturesDataByMonth } from './futures';
import type { DeliveryLocationOption } from './ui';

/** TempusDominus date picker instance (from tempus-dominus). */
interface TempusDominusInstance {
  updateOptions(options: { restrictions?: { minDate?: Date | undefined } }): void;
  subscribe(event: unknown, handler: () => void): void;
  hide(): void;
}

declare global {
  interface Window {
    /** Global sale date picker instance (TempusDominus). */
    sales_date_picker: TempusDominusInstance;
  }
}

/**
 * Application-level global variables (module scope in sales-ui.js).
 * Declared here for reference when converting to TS or for JSDoc @type.
 */
export interface SalesUIGlobals {
  sales_data: SaleRecord[];
  salesStorageKey: string;
  modalInitialState: string;
  modalIsDirty: boolean;
  allowModalClose: boolean;
  isInitializingModal: boolean;
  modalInitTimer: ReturnType<typeof setTimeout> | null;
  currentActionStatus: ActionStatus;
  currentActionMode: ActionMode;
  currentActionRecord: SaleRecord | null;
  expandedSaleId: number | null;
  currentSetRecord: SaleRecord | null;
  currentRollRecord: SaleRecord | null;
  currentRollOriginMonth: string | null;
  defaultSaleDateLabel: string;
  defaultModalTitle: string;
  defaultModalSubtitle: string;
  deliveryLocationOptions: DeliveryLocationOption[];
  futuresDataByMonth: FuturesDataByMonth;
}

export {};
