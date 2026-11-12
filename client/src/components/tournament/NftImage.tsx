import { useEffect, useState, type ReactNode } from "react";
import {
  normalizeNftImageUrl,
  nextIpfsGatewayUrl,
} from "@shared/utils/nftImageUrl";

/**
 * Loads NFT images with IPFS gateway failover (nftstorage.link often 403s).
 */
export function NftImage({
  src,
  alt,
  className,
  fallback = null,
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  fallback?: ReactNode;
}) {
  const [current, setCurrent] = useState<string | null>(() =>
    normalizeNftImageUrl(src)
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setCurrent(normalizeNftImageUrl(src));
    setFailed(false);
  }, [src]);

  if (!current || failed) return <>{fallback}</>;

  return (
    <img
      src={current}
      alt={alt}
      className={className}
      referrerPolicy="no-referrer"
      onError={() => {
        const next = nextIpfsGatewayUrl(src, current);
        if (next) setCurrent(next);
        else setFailed(true);
      }}
    />
  );
}
