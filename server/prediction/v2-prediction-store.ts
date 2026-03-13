/**
 * v2-prediction-store.ts — Almacenamiento en memoria de predicciones V2.
 *
 * Almacenamiento simple en memoria por matchId. Persistencia en disco
 * en el mismo formato que PredictionStore (JSON atómico).
 *
 * Coexistencia controlada con V1: este store es independiente del store V1.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { V2PredictionOutput } from '@sportpulse/prediction';

const STORE_PATH = path.resolve(process.cwd(), 'cache/v2-predictions.json');

interface V2StoreDoc {
  version: 1;
  savedAt: string;
  predictions: Record<string, V2StoredPrediction>;
}

export interface V2StoredPrediction {
  matchId: string;
  competitionId: string;
  homeTeamId: string;
  awayTeamId: string;
  kickoffUtc: string;
  computedAt: string;
  output: V2PredictionOutput;
}

export class V2PredictionStore {
  private predictions = new Map<string, V2StoredPrediction>();

  constructor() {
    this._load();
  }

  save(prediction: V2StoredPrediction): void {
    this.predictions.set(prediction.matchId, prediction);
  }

  get(matchId: string): V2StoredPrediction | undefined {
    return this.predictions.get(matchId);
  }

  getAll(): V2StoredPrediction[] {
    return Array.from(this.predictions.values());
  }

  async persist(): Promise<void> {
    const doc: V2StoreDoc = {
      version: 1,
      savedAt: new Date().toISOString(),
      predictions: Object.fromEntries(this.predictions),
    };
    const tmpPath = STORE_PATH.replace(/\.json$/, '.tmp');
    try {
      fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
      fs.writeFileSync(tmpPath, JSON.stringify(doc, null, 2), 'utf-8');
      fs.renameSync(tmpPath, STORE_PATH);
    } catch (err) {
      console.error('[V2Store] persist failed:', err);
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
  }

  private _load(): void {
    try {
      if (!fs.existsSync(STORE_PATH)) return;
      const raw = fs.readFileSync(STORE_PATH, 'utf-8');
      const doc = JSON.parse(raw) as V2StoreDoc;
      if (doc.version !== 1 || typeof doc.predictions !== 'object') return;
      for (const [matchId, pred] of Object.entries(doc.predictions)) {
        this.predictions.set(matchId, pred);
      }
      console.log(`[V2Store] loaded ${this.predictions.size} cached predictions`);
    } catch {
      // Cache corrupto → arrancar vacío
    }
  }
}
