/**
 * NEXUS Odds Module — Public API
 *
 * Exports types, raw store operations, and canonical serving view
 * for Track 4 (Market Signal) per market-signal-policy spec.
 *
 * Public surface:
 *   Types:         OddsRecord, OddsProvider, OddsMarket, ProviderRole,
 *                  ImpliedProbs, OddsConfidence, CanonicalOddsSnapshot,
 *                  OddsQuality
 *   Constants:     PROVIDER_PRECEDENCE, OVERROUND_BOUNDS
 *   Raw store:     appendOddsRecord, loadOddsRecords, loadOddsRecordsForProvider
 *   Serving view:  deVigProportional, computeOddsConfidence,
 *                  selectFeatureProvider, selectBenchmarkProvider,
 *                  getCanonicalOddsSnapshot
 *
 * BOUNDARY: This module does NOT expose V3 internals and must NOT be
 * imported by V3 engine code (master S8.4, S8.5).
 */

export type {
  OddsRecord,
  OddsProvider,
  OddsMarket,
  ProviderRole,
  ImpliedProbs,
  OddsConfidence,
  CanonicalOddsSnapshot,
  OddsQuality,
} from './types.js';

export { PROVIDER_PRECEDENCE, OVERROUND_BOUNDS } from './types.js';

export {
  appendOddsRecord,
  loadOddsRecords,
  loadOddsRecordsForProvider,
} from './raw-odds-store.js';

export {
  deVigProportional,
  computeOddsConfidence,
  selectFeatureProvider,
  selectBenchmarkProvider,
  getCanonicalOddsSnapshot,
} from './canonical-serving-view.js';
