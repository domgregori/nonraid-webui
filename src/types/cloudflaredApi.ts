export interface CloudflaredStatus {
  installed: boolean;
  version: string | null;
  running: boolean;
  hasToken: boolean;
  featureEnabled: boolean;
  publicUrl: string;
}
