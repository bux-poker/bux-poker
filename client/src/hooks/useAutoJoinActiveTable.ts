import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@shared/features/auth/AuthContext";
import { getSocket } from "../services/socket";
import api from "../services/api";
import { openTournamentGameWindow } from "../utils/openTournamentGameWindow";

type ActiveTableResponse = {
  gameId?: string;
  tournamentId?: string;
};

/**
 * From any non-game screen, pull registered players into their table when the
 * tournament seats or starts — without requiring the lobby page.
 */
export function useAutoJoinActiveTable() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const openedRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    if (!user?.id) return;

    const path = location.pathname || "";
    if (path.startsWith("/game/") || path === "/table-test") return;

    const tryOpen = async (reason: string) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      try {
        const token =
          typeof localStorage !== "undefined"
            ? localStorage.getItem("sessionToken")
            : null;
        if (!token) return;

        const res = await api.get<ActiveTableResponse>(
          "/api/tournaments/my-active-table",
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const gid = res.data?.gameId;
        if (!gid) return;

        const key = `${user.id}:${gid}`;
        if (openedRef.current === key) return;
        if (location.pathname === `/game/${gid}`) {
          openedRef.current = key;
          return;
        }

        openedRef.current = key;
        console.log(`[AUTO JOIN] Opening table (${reason}):`, gid);
        openTournamentGameWindow(`/game/${gid}`, navigate);
      } catch {
        // 404 = not seated / eliminated — ignore
      } finally {
        inFlightRef.current = false;
      }
    };

    void tryOpen("mount");

    const socket = getSocket();
    const onSeated = () => {
      openedRef.current = null;
      void tryOpen("tournament-seated");
    };
    const onStarted = () => {
      openedRef.current = null;
      void tryOpen("tournament-started");
    };
    const onUpdated = (payload?: { status?: string }) => {
      if (
        payload?.status === "SEATED" ||
        payload?.status === "RUNNING" ||
        payload?.status === "ACTIVE"
      ) {
        openedRef.current = null;
        void tryOpen("tournament_updated");
      } else {
        void tryOpen("tournament_updated");
      }
    };
    const onStarting = () => {
      void tryOpen("tournament-starting");
    };

    socket.on("tournament-seated", onSeated);
    socket.on("tournament-started", onStarted);
    socket.on("tournament-starting", onStarting);
    socket.on("tournament_updated", onUpdated);

    const poll = window.setInterval(() => {
      void tryOpen("poll");
    }, 20000);

    return () => {
      socket.off("tournament-seated", onSeated);
      socket.off("tournament-started", onStarted);
      socket.off("tournament-starting", onStarting);
      socket.off("tournament_updated", onUpdated);
      window.clearInterval(poll);
    };
  }, [user?.id, location.pathname, navigate]);
}
