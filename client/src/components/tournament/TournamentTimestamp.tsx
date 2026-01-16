import { useEffect, useState } from 'react';

interface TournamentTimestampProps {
  startTime: Date | string;
  showCountdown?: boolean;
}

export function TournamentTimestamp({ startTime, showCountdown = true }: TournamentTimestampProps) {
  const [countdown, setCountdown] = useState<string>('');

  const start = new Date(startTime);
  const timestamp = Math.floor(start.getTime() / 1000);

  useEffect(() => {
    if (!showCountdown) return;

    const updateCountdown = () => {
      const now = Date.now();
      const diff = start.getTime() - now;

      if (diff <= 0) {
        setCountdown('Started');
        return;
      }

      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      if (days > 0) {
        setCountdown(`${days}d ${hours}h`);
      } else if (hours > 0) {
        setCountdown(`${hours}h ${minutes}m`);
      } else if (minutes > 0) {
        setCountdown(`${minutes}m ${seconds}s`);
      } else {
        setCountdown(`${seconds}s`);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, 1000);

    return () => clearInterval(interval);
  }, [start, showCountdown]);

  return (
    <div className="space-y-1">
      <div className="text-sm text-slate-400">
        <span>Starts: </span>
        <span suppressHydrationWarning title={start.toLocaleString()}>
          {start.toLocaleString()}
        </span>
      </div>
      {showCountdown && countdown && (
        <div className="text-xs text-emerald-400">
          Starts in: {countdown}
        </div>
      )}
    </div>
  );
}
