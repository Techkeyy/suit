// SUIT Protocol SDK — On-chain leaf sync from Soroban transact events

import { rpc, scValToNative } from '@stellar/stellar-sdk';
import type { LeafCache } from './types';
import { bytesToBig } from './crypto';

export interface SyncConfig {
  rpcUrl: string;
  poolId: string;
  startLedger: number;
}

export class LeafSyncer {
  private server: rpc.Server;
  private config: SyncConfig;
  private cache: LeafCache | null;
  private memCache: bigint[] | null = null;

  constructor(config: SyncConfig, cache?: LeafCache) {
    this.server = new rpc.Server(config.rpcUrl);
    this.config = config;
    this.cache = cache || null;
  }

  invalidate() {
    this.memCache = null;
  }

  async sync(force = false): Promise<bigint[]> {
    if (this.memCache && !force) return this.memCache;

    const indexed = this.loadCache();
    const filters = [{ type: 'contract' as const, contractIds: [this.config.poolId], topics: [['*']] }];

    const collect = (events: any[]) => {
      for (const e of events) {
        try {
          const data: any = scValToNative(e.value);
          if (data && typeof data.leaf_index !== 'undefined' && data.out_commitment_0) {
            const idx = Number(data.leaf_index);
            indexed.set(idx, bytesToBig(data.out_commitment_0));
            indexed.set(idx + 1, bytesToBig(data.out_commitment_1));
          }
        } catch { /* not a transact event */ }
      }
    };

    // getEvents scans forward in bounded (~10k-ledger) windows: a short or
    // empty page does NOT mean we're done — the cursor keeps advancing until
    // it reaches latestLedger. Paginate by cursor, not by page fullness.
    const cursorLedger = (c?: string): number => {
      if (!c) return Number.MAX_SAFE_INTEGER;
      try { return Number(BigInt(c.split('-')[0]) >> 32n); } catch { return Number.MAX_SAFE_INTEGER; }
    };

    // Start from the pool's deploy ledger so every deposit is recoverable.
    // If that ledger has aged out of the RPC's event-retention window the
    // call rejects with the current valid range, e.g.
    //   "startLedger must be within the ledger range: 3258853 - 3379812".
    // Scan from that retention FLOOR — not a fixed `latest - N` guess — so we
    // recover every event the RPC still holds. The floor advances by one every
    // ledger (~5 s), so the exact value from one error can already be stale by
    // the retry; re-parse and retry a few times, with a small safety margin.
    let res: Awaited<ReturnType<rpc.Server['getEvents']>> | undefined;
    let start = this.config.startLedger;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        res = await this.server.getEvents({ startLedger: start, filters, limit: 200 });
        break;
      } catch (e: any) {
        const m = String(e?.message || e).match(/ledger range:\s*(\d+)\s*-\s*(\d+)/);
        if (!m) {
          const latest = (await this.server.getLatestLedger()).sequence;
          start = Math.max(latest - 100000, 1);
        } else {
          // +5 ledgers of headroom so the floor can't advance past us mid-flight
          start = Number(m[1]) + 5;
        }
      }
    }
    if (!res) throw new Error('LeafSyncer: could not open an event window within RPC retention');

    // Next cursor: prefer the response's paging token, but fall back to the
    // last event's id — stellar-sdk v16 does not reliably surface a top-level
    // `cursor`, and relying on it alone silently stops after the first window,
    // dropping the newest deposits (→ stale tree → UnknownRoot on withdraw).
    const nextCursor = (r: any): string | undefined => {
      if (r?.cursor) return r.cursor;
      const evs = r?.events;
      return evs && evs.length ? evs[evs.length - 1].id : undefined;
    };

    const latest = res.latestLedger;
    collect(res.events);
    let cursor = nextCursor(res);
    let guard = 0;
    while (cursor && cursorLedger(cursor) < latest && guard++ < 5000) {
      res = await this.server.getEvents({ filters, limit: 200, cursor } as any);
      collect(res.events);
      const nc = nextCursor(res);
      if (!nc || nc === cursor) break; // no forward progress
      cursor = nc;
    }

    this.saveCache(indexed);
    const maxIdx = indexed.size ? Math.max(...indexed.keys()) : -1;
    const leaves: bigint[] = [];
    for (let i = 0; i <= maxIdx; i++) leaves.push(indexed.get(i) ?? 0n);
    this.memCache = leaves;
    return leaves;
  }

  private loadCache(): Map<number, bigint> {
    const m = new Map<number, bigint>();
    if (!this.cache) return m;
    const raw = this.cache.load(this.config.poolId);
    for (const [k, v] of raw) m.set(k, BigInt(v));
    return m;
  }

  private saveCache(indexed: Map<number, bigint>) {
    if (!this.cache) return;
    const data = new Map<number, string>();
    for (const [k, v] of indexed) data.set(k, v.toString());
    this.cache.save(this.config.poolId, data);
  }
}
