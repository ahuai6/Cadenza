import type { ProviderCapability } from '../../core/media-identity';
import type { Settings } from '../bridge';

export type HallAppearance = Pick<Settings, 'theme' | 'tone' | 'lang' | 'uiFont'>;
export interface HallProvider {
  id: string;
  name: string;
  label?: string;
  capabilities: Record<ProviderCapability, 'unavailable' | 'public' | 'authorized'>;
}
export interface HallSnapshot {
  providers: HallProvider[];
  accounts: { provider: string; id: string; name: string; state: 'connected' | 'expired' | 'disconnected' }[];
  ai: { id: string; name: string; auth: 'oauth' | 'api-key'; state: 'unavailable' }[];
  appearance: HallAppearance;
}
interface HallApi {
  read(): Promise<HallSnapshot | null>;
  window(op: 'min' | 'max' | 'close'): Promise<void>;
  onMaximized(fn: (value: boolean) => void): () => void;
  onAppearance(fn: (appearance: HallAppearance) => void): () => void;
}
export const hallApi = (window as Window & { cadenzaHall?: HallApi }).cadenzaHall;
