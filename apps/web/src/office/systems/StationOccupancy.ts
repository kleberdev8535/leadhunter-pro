import { LOUNGE_SPOTS, STATIONS, stationById, type Station } from "../map/OfficeMap";

/**
 * Ocupação de cadeiras e lugares de descanso: um lugar, uma pessoa.
 * O agente prefere a própria estação; se estiver ocupada, pega outra livre da mesma sala.
 */
export class StationOccupancy {
  private readonly seats = new Map<string, string>(); // stationId → agentId
  private readonly spots = new Map<number, string>(); // índice do lugar → agentId

  claimStation(agentId: string, preferred: string): Station | null {
    const current = [...this.seats].find(([, a]) => a === agentId)?.[0];
    if (current) return stationById(current) ?? null;
    const pref = stationById(preferred);
    const candidates = [pref, ...STATIONS.filter((s) => s.room === pref?.room && s.id !== preferred)].filter(Boolean) as Station[];
    const free = candidates.find((s) => !this.seats.has(s.id));
    if (!free) return null;
    this.seats.set(free.id, agentId);
    return free;
  }

  releaseStation(agentId: string) {
    for (const [s, a] of this.seats) if (a === agentId) this.seats.delete(s);
  }

  claimLoungeSpot(agentId: string, seed = 0): { x: number; y: number } | null {
    const mine = [...this.spots].find(([, a]) => a === agentId);
    if (mine) return LOUNGE_SPOTS[mine[0]]!;
    for (let i = 0; i < LOUNGE_SPOTS.length; i++) {
      const idx = (i + seed) % LOUNGE_SPOTS.length;
      if (!this.spots.has(idx)) {
        this.spots.set(idx, agentId);
        return LOUNGE_SPOTS[idx]!;
      }
    }
    return null;
  }

  releaseLoungeSpot(agentId: string) {
    for (const [i, a] of this.spots) if (a === agentId) this.spots.delete(i);
  }

  stationOf(agentId: string) {
    return [...this.seats].find(([, a]) => a === agentId)?.[0] ?? null;
  }

  occupantOf(stationId: string) {
    return this.seats.get(stationId) ?? null;
  }
}
