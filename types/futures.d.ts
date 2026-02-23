/**
 * Explicit external type definitions for futures/market data objects.
 */

/**
 * One row from the daily futures API/JSON (e.g. assets/daily-futures.json).
 * Prices are string values as returned from the API.
 */
export interface DailyFuturesRow {
  date: string;
  crop: string;
  specific_commodity: string;
  futures_month: string;
  open: string;
  high: string;
  low: string;
  last: string;
  commodity_code: string;
}

/**
 * Map of futures month key (YYYY-MM) to the corresponding daily futures row.
 * Used for lookup when populating futures dropdowns and prices.
 */
export type FuturesDataByMonth = Record<string, DailyFuturesRow>;
