// SUIT Protocol SDK — Relayer client

import type { RelayerInfo, RelayBundle } from './types';

export async function getRelayerInfo(relayerUrl: string): Promise<RelayerInfo | null> {
  try {
    const r = await fetch(relayerUrl, { method: 'GET' });
    if (!r.ok) return null;
    const j = await r.json();
    return j && typeof j.relayer === 'string'
      ? { relayer: j.relayer, fee: String(j.fee ?? '0') }
      : null;
  } catch { return null; }
}

export async function relaySubmit(relayerUrl: string, body: RelayBundle): Promise<string> {
  const r = await fetch(relayerUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({} as any));
  if (!r.ok || j.error) throw new Error(j.error || `Relayer error (${r.status})`);
  if (!j.hash) throw new Error('Relayer returned no transaction hash.');
  return j.hash as string;
}
