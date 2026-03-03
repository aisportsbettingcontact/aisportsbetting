/**
 * TeamLogo — resolves team logos dynamically from ESPN CDN via the DB.
 * The server auto-syncs ESPN team data on startup and daily.
 * Falls back to a colored circle badge with initials if no logo is found.
 */

import { trpc } from "@/lib/trpc";

const PALETTE = [
  "#e63946", "#2a9d8f", "#e9c46a", "#f4a261", "#264653",
  "#6c63ff", "#48cae4", "#f77f00", "#06d6a0", "#ef476f",
  "#118ab2", "#ffd166", "#7209b7", "#3a86ff", "#fb5607",
  "#8338ec", "#ff006e", "#06a77d", "#d62828", "#023e8a",
];

function colorFromName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

function abbrev(name: string): string {
  const parts = name.replace(/_/g, " ").trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 4).toUpperCase();
  if (parts.length === 2) return (parts[0].slice(0, 2) + parts[1].slice(0, 2)).toUpperCase();
  return parts.map((p) => p[0]).join("").slice(0, 4).toUpperCase();
}

interface TeamLogoProps {
  /** Team slug as it appears in the model file, e.g. "duke", "nc_state" */
  name: string;
  size?: number;
}

export default function TeamLogo({ name, size = 36 }: TeamLogoProps) {
  const { data: team } = trpc.teams.bySlug.useQuery(
    { slug: name },
    {
      staleTime: 1000 * 60 * 60, // 1 hour — ESPN data is stable
      retry: false,
    }
  );

  const logoUrl = team?.logoUrl;

  if (logoUrl) {
    return (
      <img
        src={logoUrl}
        alt={team?.displayName ?? name}
        width={size}
        height={size}
        style={{
          width: size,
          height: size,
          minWidth: size,
          objectFit: "contain",
          borderRadius: "4px",
        }}
        onError={(e) => {
          (e.target as HTMLImageElement).style.display = "none";
        }}
      />
    );
  }

  // Fallback: colored badge with initials
  const bg = colorFromName(name);
  const text = abbrev(name);
  const fontSize = size <= 28 ? 9 : size <= 36 ? 11 : 13;

  return (
    <div
      style={{
        width: size,
        height: size,
        minWidth: size,
        borderRadius: "50%",
        background: bg,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "'Barlow Condensed', sans-serif",
        fontWeight: 700,
        fontSize,
        color: "#fff",
        letterSpacing: "0.04em",
        userSelect: "none",
      }}
    >
      {text}
    </div>
  );
}
