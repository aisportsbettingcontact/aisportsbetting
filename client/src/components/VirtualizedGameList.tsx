/**
 * VirtualizedGameList
 *
 * Renders a list of GameCards with automatic virtualization when the game
 * count is large (>= VIRTUALIZE_THRESHOLD).
 *
 * Below the threshold: direct DOM rendering (preserves scroll-to-anchor).
 * Above the threshold: react-window 2.x List with useDynamicRowHeight.
 *
 * react-window 2.x key differences from 1.x:
 *   - Uses `rowComponent` + `rowProps` pattern (not children render function)
 *   - `List` fills its container via CSS — no `height` prop
 *   - `rowComponent` receives { ariaAttributes, index, style, ...rowProps }
 *   - `useDynamicRowHeight` returns a DynamicRowHeight object for `rowHeight`
 */

import React, { useRef, useEffect, type CSSProperties } from "react";
import { List, useDynamicRowHeight } from "react-window";
import { GameCard } from "./GameCard";
import { useViewportScale } from "@/hooks/useViewportScale";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/lib/trpc";

type RouterOutput = inferRouterOutputs<AppRouter>;
type GameRow = RouterOutput["games"]["list"][number];
type MobileTab = 'dual' | 'splits' | 'bracket';

// Threshold: only virtualize when game count >= this value
const VIRTUALIZE_THRESHOLD = 15;

// Estimated row heights by device type (px) — used before measurement
const ESTIMATED_HEIGHT: Record<string, number> = {
  mobile: 140,
  tablet: 180,
  desktop: 200,
};

export interface VirtualizedGameListProps {
  games: GameRow[];
  showModel: boolean;
  onToggleModel: () => void;
  favoriteGameIds: Set<number>;
  onToggleFavorite: (gameId: number) => void;
  onFavoriteNotify: (gameId: number) => void;
  isAppAuthed: boolean;
  mobileTab: MobileTab;
  onMobileTabChange: (tab: MobileTab) => void;
}

// ─── Non-virtualized list (< VIRTUALIZE_THRESHOLD games) ─────────────────────

function DirectGameList({
  games,
  showModel,
  onToggleModel,
  favoriteGameIds,
  onToggleFavorite,
  onFavoriteNotify,
  isAppAuthed,
  mobileTab,
  onMobileTabChange,
}: VirtualizedGameListProps) {
  return (
    <div className="bg-card mx-0">
      {games.map((game) => (
        <div key={game!.id} id={`game-card-${game!.id}`}>
          <GameCard
            game={game!}
            mode="full"
            showModel={showModel}
            onToggleModel={onToggleModel}
            favoriteGameIds={favoriteGameIds}
            onToggleFavorite={onToggleFavorite}
            onFavoriteNotify={onFavoriteNotify}
            isAppAuthed={isAppAuthed}
            mobileTab={mobileTab}
            onMobileTabChange={onMobileTabChange}
          />
        </div>
      ))}
    </div>
  );
}

// ─── Row props passed via rowProps to react-window 2.x ───────────────────────

interface GameRowExtraProps {
  games: GameRow[];
  showModel: boolean;
  onToggleModel: () => void;
  favoriteGameIds: Set<number>;
  onToggleFavorite: (gameId: number) => void;
  onFavoriteNotify: (gameId: number) => void;
  isAppAuthed: boolean;
  mobileTab: MobileTab;
  onMobileTabChange: (tab: MobileTab) => void;
  dynamicRowHeight: ReturnType<typeof useDynamicRowHeight>;
}

// ─── Row component for react-window 2.x ──────────────────────────────────────
// Receives: { ariaAttributes, index, style, ...GameRowExtraProps }

interface GameRowComponentProps extends GameRowExtraProps {
  ariaAttributes: {
    "aria-posinset": number;
    "aria-setsize": number;
    role: "listitem";
  };
  index: number;
  style: CSSProperties;
}

function GameRowComponent({
  index,
  style,
  games,
  showModel,
  onToggleModel,
  favoriteGameIds,
  onToggleFavorite,
  onFavoriteNotify,
  isAppAuthed,
  mobileTab,
  onMobileTabChange,
  dynamicRowHeight,
  ariaAttributes: _aria, // consumed by react-window, not forwarded
}: GameRowComponentProps) {
  const game = games[index]!;
  const rowRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!rowRef.current) return;
    const cleanup = dynamicRowHeight.observeRowElements([rowRef.current]);
    return cleanup;
  }, [index, dynamicRowHeight]);

  return (
    <div style={style}>
      <div ref={rowRef} id={`game-card-${game.id}`}>
        <GameCard
          game={game}
          mode="full"
          showModel={showModel}
          onToggleModel={onToggleModel}
          favoriteGameIds={favoriteGameIds}
          onToggleFavorite={onToggleFavorite}
          onFavoriteNotify={onFavoriteNotify}
          isAppAuthed={isAppAuthed}
          mobileTab={mobileTab}
          onMobileTabChange={onMobileTabChange}
        />
      </div>
    </div>
  );
}

// ─── Virtualized list (>= VIRTUALIZE_THRESHOLD games) ────────────────────────

function VirtualList(props: VirtualizedGameListProps) {
  const { deviceType } = useViewportScale();
  const estimatedHeight = ESTIMATED_HEIGHT[deviceType] ?? 180;

  const dynamicRowHeight = useDynamicRowHeight({ defaultRowHeight: estimatedHeight });

  const rowProps: GameRowExtraProps = {
    games: props.games,
    showModel: props.showModel,
    onToggleModel: props.onToggleModel,
    favoriteGameIds: props.favoriteGameIds,
    onToggleFavorite: props.onToggleFavorite,
    onFavoriteNotify: props.onFavoriteNotify,
    isAppAuthed: props.isAppAuthed,
    mobileTab: props.mobileTab,
    onMobileTabChange: props.onMobileTabChange,
    dynamicRowHeight,
  };

  return (
    <div className="bg-card" style={{ height: '100%', overflow: 'auto' }}>
      <List
        rowCount={props.games.length}
        rowHeight={dynamicRowHeight}
        rowComponent={GameRowComponent as (props: { ariaAttributes: { "aria-posinset": number; "aria-setsize": number; role: "listitem" }; index: number; style: CSSProperties } & GameRowExtraProps) => React.ReactElement | null}
        rowProps={rowProps}
        overscanCount={3}
        className="bg-card"
      />
    </div>
  );
}

// ─── Public export ────────────────────────────────────────────────────────────

/**
 * VirtualizedGameList
 *
 * Automatically selects between direct rendering (< 15 games) and
 * react-window virtualization (>= 15 games) based on game count.
 */
export function VirtualizedGameList(props: VirtualizedGameListProps) {
  if (props.games.length < VIRTUALIZE_THRESHOLD) {
    return <DirectGameList {...props} />;
  }
  return <VirtualList {...props} />;
}
