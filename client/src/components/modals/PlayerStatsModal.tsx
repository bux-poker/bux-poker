import { BuxModal, BuxModalButton } from "../ui/BuxModal";

type StatsPlayer = {
  name: string;
  chips?: number;
  status?: string;
  seatNumber?: number;
};

interface PlayerStatsModalProps {
  isOpen: boolean;
  onClose: () => void;
  player: StatsPlayer | null;
  /** When true, overlay is absolute (parent must be relative) so chat stays clear. */
  containToParent?: boolean;
}

export default function PlayerStatsModal({
  isOpen,
  onClose,
  player,
  containToParent = false,
}: PlayerStatsModalProps) {
  if (!isOpen || !player) return null;

  return (
    <BuxModal
      open={isOpen}
      title={`${player.name}'s Stats`}
      icon="stats"
      onClose={onClose}
      position={containToParent ? "absolute" : "fixed"}
      maxWidth="md"
      align="left"
      footer={<BuxModalButton variant="primary" onClick={onClose}>Close</BuxModalButton>}
    >
      <div className="space-y-3 text-left">
        <div>
          <span className="text-sm text-slate-400">Name</span>
          <p className="text-slate-100">{player.name}</p>
        </div>
        {player.chips !== undefined && (
          <div>
            <span className="text-sm text-slate-400">Chips</span>
            <p className="tabular-nums text-slate-100">{player.chips.toLocaleString()}</p>
          </div>
        )}
        {player.status && (
          <div>
            <span className="text-sm text-slate-400">Status</span>
            <p className="text-slate-100">{player.status}</p>
          </div>
        )}
        {player.seatNumber !== undefined && (
          <div>
            <span className="text-sm text-slate-400">Seat</span>
            <p className="text-slate-100">{player.seatNumber}</p>
          </div>
        )}
      </div>
    </BuxModal>
  );
}
