export interface ParityViewModel {
  isRunning: boolean;
  canStart: boolean;
  barColor: string;
  progressPct: number;
  progressLabel: string;
  speedText: string;
  etaText: string;
  pauseLabel: string;
  startHandler: () => void;
  pauseHandler: () => void;
  cancelHandler: () => void;
}
