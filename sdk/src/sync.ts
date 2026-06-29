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
    // call rejects — fall back to the newest safe window (older leaves are
    // then served from the persisted LeafCache).
    let res: Awaited<ReturnType<rpc.Server['getEvents']>>;
    try {
      res = await this.server.getEvents({ startLedger: this.config.startLedger, filters, limit: 200 });
    } catch {
      const latest = (await this.server.getLatestLedger()).sequence;
      const start = Math.max(latest - 17000, 1);
      res = await this.server.getEvents({ startLedger: start, filters, limit: 200 });
    }

    const latest = res.latestLedger;
    collect(res.events);
    let guard = 0;
    while ((res as any).cursor && cursorLedger((res as any).cursor) < latest && guard++ < 1000) {
      res = await this.server.getEvents({ filters, limit: 200, cursor: (res as any).cursor } as any);
      collect(res.events);
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
