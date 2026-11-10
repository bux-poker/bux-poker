/**
 * Open (or focus) the player's table. Mobile / standalone: in-app navigate.
 * Desktop browser: dedicated game window when possible.
 */
export function openTournamentGameWindow(
  url: string,
  navigate: (path: string) => void
): void {
  const isMobile =
    /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    ) || window.innerWidth <= 768;
  const isStandalone =
    typeof window !== "undefined" &&
    (window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true);

  if (isMobile || isStandalone) {
    navigate(url);
    return;
  }

  const winName = "buxpoker-game-window";
  let w = window.open("", winName);
  if (w && !w.closed) {
    w.location.href = url;
    w.focus();
    return;
  }

  w = window.open(
    url,
    winName,
    "width=1400,height=900,menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=no"
  );
  if (w) {
    w.focus();
    w.addEventListener("load", () => {
      setTimeout(() => {
        if (w?.document?.documentElement?.requestFullscreen) {
          w.document.documentElement.requestFullscreen().catch(() => {});
        }
      }, 500);
    });
  } else {
    // Popup blocked — fall back to in-app navigation.
    navigate(url);
  }
}
