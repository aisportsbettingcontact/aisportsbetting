# AI Sports Betting Models - TODO

- [x] Initialize project scaffold
- [x] Upgrade to full-stack (web-db-user)
- [x] Add model_files and games tables to schema
- [x] Run db:push to sync schema
- [x] Build storage helpers for CSV file upload
- [x] Add tRPC router: files.upload, files.list, files.delete
- [x] Add tRPC router: games.list (reads from DB)
- [x] Build XLSX/CSV parser on server to ingest uploaded files into games table
- [x] Build Login page (Manus OAuth sign-in)
- [x] Build Dashboard page (MODEL PROJECTIONS with game cards, sport tabs, date grouping)
- [x] Build File Manager page (upload CSV/XLSX, list files with status, delete)
- [x] Wire App.tsx routes: /, /login, /files
- [x] Dark theme CSS tokens (matching reference site)
- [x] Upload 62 NCAAM team logos to S3 with original filenames (NCAAM/teamname.png)
- [x] Build TeamLogo component (CDN logos + colored badge fallback)
- [x] Write vitest tests for fileParser (13 tests passing)
- [x] Re-upload logos with original filenames (no hash suffix)
- [x] Save checkpoint and deliver
- [x] Inspect Google Sheets structure and verify public CSV export access
- [x] Build server-side Google Sheets sync (fetch latest sheet, parse, upsert games)
- [x] Add tRPC procedures: sheets.syncLatest (public) and sheets.syncAll (protected)
- [x] Add auto-sync on dashboard load + manual refresh button with status indicator
- [x] Save checkpoint with Sheets integration
- [x] Remove NFL and NCAAF tabs from dashboard sport selector
- [x] Verify all 62 NCAAM logos are present in S3 storage
- [x] Re-upload any missing logos (none missing)
- [x] Ensure teamLogos.ts has all 62 entries in A-Z order
- [x] Rebuild GameCard to match reference screenshot (date header, BOOKS/MODEL LINE/MODEL O/U columns, team rows with logo+spread+O/U pills, edge footer)
- [x] Rewrite GameCard to match reference implementation (edge color scale, consensus column, dark pills, formatTeamName, framer-motion) with Google Sheets data
- [x] Scrape ESPN NCAAM teams page and build slug→ESPN logo URL map
- [x] Update GameCard to use ESPN CDN logo URLs instead of local PNGs
- [x] Add espn_teams table to DB schema (slug, espn_id, display_name, conference, sport)
- [x] Build ESPN scraper service (scrapes on server startup + daily schedule)
- [x] Add tRPC procedure to expose team data to frontend
- [x] Update TeamLogo to use ESPN CDN URLs resolved from DB dynamically
- [x] Remove static teamLogos.ts hardcoded map
- [x] Delete local PNG files from webdev-static-assets (S3 delete API not available)
- [x] Remove bottom footer from dashboard
- [x] Change sync toast to "ALL NCAAM Games Updated"
- [x] Fix logo visibility on dark background (changed mix-blend-mode from multiply to screen)
- [x] Create hardcoded static ESPN team ID map (espnTeamIds.ts) for all 62 NCAAM teams
- [x] Fix incorrect ESPN IDs (portland_state: 2502, sacramento_state: 16, and 12 others)
- [x] Update GameCard to use static ESPN ID map as primary logo source (no DB/API needed)
- [x] All 16 team logos loading correctly across 8 game cards
- [x] Remove Model Files page (/files route) from App.tsx
- [x] Remove upload button from Dashboard header
- [x] Remove any nav links pointing to /files
- [x] Change top-left branding text from "AI MODELS" to "PREZ BETS AI"
- [x] Keep "MODEL PROJECTIONS" title absolutely centered in the header
- [x] Redesign header to be more organized and professional
- [x] Ensure header displays correctly on mobile (no overflow, proper spacing, centered title)
- [x] Header: single centered line with chart icon + "PREZ BETS" (bold white) + "AI MODEL PROJECTIONS" (light gray), user icon right, larger font on desktop
- [x] Remove NBA, MLB, NHL tabs — keep only NCAAM
- [x] Reduce excessive whitespace — tighten header padding, date header, card gaps
- [x] Fix sticky date row gap — must sit flush against header when scrolling
- [x] Set Barlow Condensed as the uniform global font throughout the site
- [x] Show two-line team names in GameCard: school name on top, nickname on bottom
- [x] Enforce strict single-line per row for school name and nickname (no wrapping, truncate with ellipsis)
- [x] Widen name column so no school names are ever truncated
- [x] Update Google Sheets sync to pull from 03-03-2026 tab
- [x] Fix fileParser to be header-name-driven (handles any column order)
- [x] Add teamNormalizer to convert display names to snake_case slugs
- [x] Expand ESPN ID map and team nicknames map to cover all NCAAM teams (200+ teams)
- [x] Remove March 2nd game data from database (only March 3rd data remains, 44 games)
- [x] Update DB schema: add username, passwordHash, role (owner/admin/user), hasAccess, expiryDate to users table
- [x] Backend: custom login (email+password), register, and owner-only user CRUD procedures
- [x] Frontend: Owner-only User Management panel (create/edit/delete accounts)
- [x] Add "User Management" to profile dropdown for owner role only
- [x] Create @prez owner account (aisportbettingcontact@gmail.com, Tailered101$, lifetime access)
- [x] Replace Manus OAuth with custom email/password authentication on Login page
- [x] Add auth guards to Dashboard and UserManagement pages
- [x] Test login flow end-to-end with @prez credentials
- [x] Test User Management CRUD (create, delete)
- [x] Fix AgeModal text: replace "EdgeGuide" with "Prez Bets AI"
- [x] Add "Last Updated" timestamp next to refresh button in date row
- [x] Add show/hide password toggle to UserManagement create/edit account modal
- [x] Add termsAccepted (boolean) and termsAcceptedAt (timestamp) to app_users DB schema
- [x] Add tRPC procedure: appUsers.acceptTerms (sets termsAccepted=true, termsAcceptedAt=now)
- [x] Update Dashboard: show Age modal only if termsAccepted is false/null (DB-backed, not sessionStorage)
- [x] Call acceptTerms mutation when user clicks "I Understand & Accept"
- [x] Add TERMS column to User Management dashboard table showing accepted/pending status
- [x] Redesign Home page as paywall landing (feature highlights + inline login panel, no redirect)
- [x] Remove Manus OAuth sign-in button and all Manus branding from public-facing pages
- [x] Add Stay Logged In checkbox to login form (extends session to 90 days vs 1 day)
- [x] Gate dashboard behind app_session cookie check; redirect unauthenticated users to home
- [x] Add per-column filter/sort dropdowns to User Management table (sort asc/desc + multi-select filter per column)
- [x] Add search field to User Management (filter by username or email)
- [x] Fix Role sort hierarchy: Owner→Admin→User (asc), User→Admin→Owner (desc)
- [x] Fix Expiry sort: ascending = soonest first, Lifetime at bottom; descending = Lifetime at top
- [x] Enforce expiry date: block login if current time > expiryDate (set hasAccess=false automatically)
- [x] Add session-level expiry check: even if already logged in, redirect expired users out of dashboard
- [x] Test expiry enforcement with a test account (expired date)
- [x] Show Last Sign In as HH:MM AM/PM EST in User Management table
- [x] Show expiry dates with full precision and EST label in User Management table
- [x] Add 3 hours to all existing non-lifetime expiry dates in the database
- [x] Fix game feed: only show games for today's date (EST), remove previous days' games automatically
- [x] Fix todayEst() date format mismatch: was MM-DD-YYYY, now YYYY-MM-DD to match DB storage (parseDate output)
- [x] Add daily 6am EST cron job to delete games older than today (purge previous day's games automatically)
- [x] Replace all user-facing "Google Sheets" references with "Model Database"
- [x] Scrape WagerTalk for 40 March 4 NCAAM games (22 regular season + 18 conference tournament)
- [x] Add gameType, conference, and publishedToFeed fields to games DB schema
- [x] Import 40 March 4 games with Consensus odds, blank model projections, and unpublished status
- [x] Build owner-only Publish Model Projections page with editable game rows and publish toggles
- [x] Add Publish Projections to profile dropdown (owner-only)
- [x] Update public games.list to only return publishedToFeed=true games
- [x] Redesign PublishProjections page to match GameCard feed style with inline MODEL LINE and MODEL O/U inputs
- [x] Enforce strict owner-only access on PublishProjections (frontend redirect + backend ownerProcedure)
- [x] Show all 40 March 4 games on Dashboard feed with book lines (model columns empty until published)\n
- [x] Debug: March 4 games not showing on feed — fixed by using gte(today) instead of eq(today)
- [x] Show March 3 and March 4 games on feed grouped by date (March 4 below March 3)
- [x] Populate ESPN team logos for all 40 March 4 WagerTalk games
- [x] Add team nicknames for all 40 March 4 WagerTalk schools to teamNicknames.ts
- [x] Fix Oral Roberts ESPN ID (was 2497, now 198)
- [x] Replace NaN with '-' for games without book lines on GameCard
- [x] Replace partial ESPN ID map with complete mapping of all NCAAM teams from ESPN (362 teams)
- [x] Regenerate teamNicknames.ts with correct school names and mascot nicknames for all 362 NCAAM teams
- [ ] Add missing ESPN IDs for teams not in bulk API (Lindenwood, etc.)
- [x] Add UL Lafayette (309), Georgia Southern (290), Lindenwood (2815) ESPN IDs to map
- [x] Full audit: confirm all 40 March 4 games, lines/totals, and school names/nicknames
- [x] Delete all March 3rd games from DB permanently
- [x] Remove Google Sheets sync code (sheetsSync.ts, syncLatest/syncAll procedures, dashboard auto-sync call)
- [x] Remove Sheets-related UI (sync button, status indicator) from Dashboard
- [x] Reorder Publish Projections games to match WagerTalk order (by wagerTalkId / sortOrder)
- [ ] Store VSIN_EMAIL and VSIN_PASSWORD as app secrets
- [ ] Update vsinScraper to auto-login with stored credentials
- [ ] Test Refresh Books end-to-end
- [x] Fix refresh progress count to use VSiN game count (not DB game count)
- [x] Add vsinRowIndex to ScrapedOdds and write it as sortOrder to DB during refresh
- [x] Display games in VSiN order on Publish Projections page and public feed
- [x] Build smart auto-refresh cron: update today's odds, auto-import tomorrow's games as unpublished stubs, ignore past dates
- [x] Expose last-refresh result via tRPC games.lastRefresh query
- [x] Remove manual Refresh Books button from Publish Projections UI
- [x] Show last-auto-refreshed timestamp on Publish Projections page
- [x] Sort Publish Projections and public feed by VSiN sortOrder
- [x] Investigate NCAA scoreboard page structure for start time extraction
- [x] Build ncaaScoreboard.ts scraper: fetch games with EST start times, match to DB slugs
- [x] Integrate NCAA start time scraper into auto-refresh cron
- [x] Apply NCAA start times to existing March 4 DB games
- [x] Fix edge footer: display the book line (the line with the edge), not the model line; recalculate spread and total edge correctly
- [x] Pull James Madison game spread from VSiN
- [x] Fix Georgia Southern opponent: TBD → old_dominion
- [x] Audit and correct all March 4 start times in EST
- [x] Audit and verify edge calculation math in GameCard.tsx for all scenarios
- [ ] Verify every March 4 game's book spread/total in DB against live VSiN page
- [ ] Fix Georgia Southern book spread to match current VSiN line (+2.5/-2.5)
- [ ] Import 9 missing VSiN games as unpublished stubs (UW-Milwaukee, Cleveland ST, Stonehill, Wagner, Chicago ST, N Florida, Florida ST, Ark-Little Rock, Colorado ST)
- [ ] Fix alias maps in vsinScraper.ts and ncaaScoreboard.ts for the 9 new teams
- [x] Fix duplicate game entries in DB (Rutgers vs Michigan State, lemoyne, c_conn_st, w_georgia)
- [x] Add michigan-st, c-conn-st, and other missing aliases to HREF_SLUG_MAP in vsinScraper.ts
- [x] Add slugsMatch() fuzzy fallback to vsinAutoRefresh to prevent future duplicate inserts
- [x] Purge 4 duplicate wrong-slug rows from DB (lemoyne, c_conn_st, w_georgia, michigan_st)
- [x] Fix PublishProjections gameDate to be dynamic (today PST, not hardcoded 2026-03-04)
- [x] Add VSiN odds status indicator (green/red dot) on EditableGameCard header
- [x] Fix formatMilitaryTime in PublishProjections to handle TBD gracefully (returns "TBD" not "12:BD AM EST")
- [x] Add withOddsCount / missingOddsCount stats row to PublishProjections header
- [x] Verify games display in VSiN page order (sortOrder) on Dashboard and PublishProjections
- [ ] Add search bar to public feed (Dashboard) filtering by school name and nickname
- [ ] Add date picker to Publish Projections page (default today PST, navigate to future dates)
- [ ] Add Refresh Now button to Publish Projections to manually trigger VSiN + NCAA re-scrape
- [ ] Load all NCAA games for 03/04-03/10 on Publish Projections (not just VSiN games)
- [ ] Fix TBA -> TBD for teams without confirmed start times
- [ ] Ensure all times display in EST on both Feed and Publish Projections
- [x] Feed: only show games with live VSiN odds (awayBookSpread or bookTotal not null)
- [x] Publish Projections: block publish toggle for games without live VSiN odds
- [x] Publish All: only publish games that have live VSiN odds
- [x] Feed: show ALL games with live VSiN odds (remove publishedToFeed filter from listGames)
- [x] GameCard: show model projections (MODEL LINE/O/U/edge) only when publishedToFeed=true, otherwise show dashes
- [x] Fix missing team logos in PublishProjections EditableGameCard (logos show on feed but not admin page)
- [x] Feed: replace search icon button with always-visible search input bar between header and first date group; dropdown results ordered by start time EST
- [x] Feed search: move bar into sticky header, placeholder "Search for Games", 3-at-a-time dropdown with scroll, team logo+name layout, solid bg overlay, highlight animation on select
- [x] Fix "miami fl" → "Miami (FL)" in teamNicknames.ts; desktop dropdown full-width row layout; mobile stacked
- [x] Fix gap between sticky search bar and first date banner (no gap on desktop and mobile)
- [ ] Fix search dropdown: TEAM_NAMES lookup for all slugs (no lowercase slug fallback), home team Logo+School+Nickname layout, Miami (FL) correct display
- [x] Migrate DB to canonical CSV dbSlugs (121 rows updated), purge non-365-team games (223 rows deleted)
- [x] Generate shared/ncaamTeams.ts registry from authoritative 365-team CSV
- [x] Refactor GameCard.tsx to use registry getTeamByDbSlug() for names/nicknames/logos
- [x] Refactor Dashboard.tsx search to use registry for team names/logos
- [x] Add server-side VALID_DB_SLUGS filtering to games.list, games.listStaging, games.listPublished
- [x] Update ncaaScoreboard.ts to use registry BY_NCAA_SLUG as primary lookup
- [x] Update vsinScraper.ts: remove HREF_SLUG_FALLBACK legacy map, use BY_VSIN_SLUG registry as sole lookup
- [x] Update vsinAutoRefresh.ts: replace legacy slugsMatch() alias map with registry-based lookup
- [x] Update vsinAutoRefresh.ts: replace hardcoded 03/04-03/10 date range with dynamic 7-day rolling window
- [x] Update refreshBooksRoute.ts: replace matchTeam() name-based matching with slug-based matching
- [x] Remove dead matchTeam/scrapeVsinOdds imports from routers.ts
- [x] Delete orphaned teamNicknames.ts (no longer imported anywhere)
- [x] Update vsinScraper.test.ts: remove normalizeTeamName tests, update matchTeam tests
- [x] All 24 tests passing after refactoring

## Pipeline Audit Fixes (2026-03-06)
- [x] Fix epochToEst() DST bug in ncaaScoreboard.ts (hardcoded UTC-5 breaks after March 8 DST change, should use Intl)
- [x] Remove deprecated matchTeam() and its 100-line abbrevMap from vsinScraper.ts (not called anywhere)
- [x] Fix stale comments in vsinAutoRefresh.ts (still references "03/04-03/10" in 3 places)
- [x] Fix per-date log count in vsinAutoRefresh.ts (uses different filter than actual update/insert logic)
- [x] Delete orphaned sheetsSync.ts (not imported anywhere, all references removed)
- [x] Delete orphaned csvParser.ts (only imported by sheetsSync.ts which is dead)
- [x] Delete orphaned teamNormalizer.ts — replaced with inline registry lookup in fileParser.ts
- [x] Remove NCAA_ALIAS entirely from ncaaScoreboard.ts — registry is sole lookup, non-D1 teams filtered by VALID_DB_SLUGS
- [x] Fix refreshBooksRoute.ts: hardcoded default date "2026-03-04" replaced with dynamic today PST
- [ ] Consolidate ESPN logo source: teams.list DB query is redundant since registry has NCAA logos for all 365 teams (deferred — ESPN sync still used as fallback)

## Publish Projections + Feed Correctness (2026-03-06)
- [ ] Audit and fix duplicate game sources in vsinAutoRefresh (contestId + slug dedup)
- [ ] Add DB-level unique constraint on (gameDate, awayTeam, homeTeam) to prevent duplicates at insert
- [ ] Fix game ordering: sort by startTimeEst (earliest to latest) in all DB queries and frontend
- [ ] Ensure Publish Projections page shows NCAA name, nickname, logo URL from registry
- [ ] Ensure Feed shows NCAA name, nickname, logo URL from registry
- [ ] Enforce 365-team filter on all game queries (server-side, not just at insert time)
- [ ] Fix start time display: always show EST, never TBD on Feed
- [ ] Populate all NCAA.com games where both teams are in 365-team registry

## Midnight Game Date + Start Time Fixes (2026-03-06)
- [ ] Fix midnight game date: 12:00 AM ET games (West Coast late-night) should be assigned to the prior calendar day
- [ ] Investigate Youngstown St. vs Robert Morris showing 12:00 AM ET — likely TBD stored as 00:00
- [ ] Fix epochToEst() to return "TBD" instead of "00:00" when NCAA API returns no start time
- [ ] Clean up existing DB rows with bad 00:00 start times

## Midnight Game Header Display Fix (2026-03-06)
- [x] GameCard: when startTimeEst = "00:00", display header date as gameDate + 1 day (next ET calendar day), e.g. "Fri, Mar 6 · 12:00 AM ET"
- [x] EditableGameCard (PublishProjections): same fix — show next-day ET date in header for midnight games
- [x] Game remains grouped under gameDate (Thu, Mar 5) in the feed — only the header label changes

## Midnight Game Sort Order Fix (2026-03-06)
- [x] DB queries: treat startTimeEst = "00:00" as "24:00" in ORDER BY so midnight games sort last on the day's slate

## NBA Team Registry (2026-03-06)
- [ ] Read NBAMapping-MASTERSHEET.csv and inspect NBA.com slug/logo URL patterns
- [ ] Build shared/nbaTeams.ts registry (same structure as ncaamTeams.ts)
- [ ] Add nba_teams DB table to drizzle/schema.ts and push migration
- [ ] Wire up NBA registry to server (db.ts helpers, routers.ts procedure)
- [ ] Run tests and save checkpoint

## ESPN Removal + NBA Teams (2026-03-06)
- [x] Drop espn_teams DB table and remove from drizzle/schema.ts
- [x] Remove listEspnTeams, getEspnTeamBySlug, upsertEspnTeam helpers from db.ts
- [x] Remove all ESPN imports from routers.ts and any other files
- [x] Delete espnScraper.ts; TeamLogo.tsx updated to use registry directly
- [x] Add upsertNbaTeams, listNbaTeams, getNbaTeamByDbSlug, getNbaTeamByNbaSlug helpers to db.ts
- [x] Seed nba_teams table from NBA_TEAMS registry (30 teams inserted)
- [x] Add nbaTeams.list and nbaTeams.byDbSlug tRPC procedures to routers.ts

## NBA Data Pipeline (2026-03-07)
- [ ] Inspect NBA.com/schedule API endpoint structure
- [ ] Inspect VSiN NBA betting-splits page structure
- [ ] Build nbaScoreboard.ts — NBA.com schedule scraper with registry mapping
- [ ] Build nbaVsinScraper.ts — VSiN NBA betting splits scraper
- [ ] Build nbaAutoRefresh.ts — merge scoreboard + odds, upsert games table
- [ ] Wire up to server startup cron and tRPC refresh procedure
- [ ] Run tests and save checkpoint

## League Logos + Sport Filter (2026-03-07)
- [ ] Download NCAA and NBA league SVG logos and upload to CDN
- [ ] Store league logos in shared/leagues.ts registry
- [ ] Add sport field (ncaam | nba) to games table schema and push migration
- [ ] Update all game queries to accept optional sport filter
- [ ] Add NCAAM/NBA sport filter toggle to Dashboard feed
- [ ] Add NCAAM/NBA sport filter toggle to Publish Projections page
- [ ] Persist selected sport in URL query param or localStorage

## NBA Pipeline + Sport Filter Completion (2026-03-07)
- [x] Rebuilt nbaTeams.ts from NBAMapping-MASTERSHEET.csv (authoritative source)
- [x] Built nbaScoreboard.ts — NBA.com CDN JSON schedule scraper
- [x] Built nbaVsinScraper.ts — VSiN NBA betting splits scraper (same structure as NCAAM)
- [x] Updated vsinAutoRefresh.ts to handle NBA games alongside NCAAM
- [x] NBA games now auto-refresh every 30 min (13 live today + 46 schedule-only for next 7 days)
- [x] Added NCAAM/NBA sport filter toggle with logos to Dashboard feed
- [x] Added NCAAM/NBA sport filter toggle with logos to Publish Projections page
- [x] publishAll mutation now scoped to selected sport
- [x] GameCard, SearchResultRow, TeamBadge all resolve NBA team names/logos
- [x] normalizeEdgeLabel resolves NBA team names in edge verdict display

## Betting Splits Feature (2026-03-07)
- [ ] Audit existing DB schema for splits columns
- [ ] Add splits columns to DB schema (spreadAwayBetsPct, spreadAwayMoneyPct, totalOverBetsPct, totalOverMoneyPct, mlAwayBetsPct, mlAwayMoneyPct)
- [ ] Run db:push migration
- [ ] Update vsinScraper.ts to parse and store all 6 splits fields
- [ ] Update nbaVsinScraper.ts to parse and store all 6 splits fields
- [ ] Update db.ts query helpers to return splits fields
- [ ] Update tRPC procedures to expose splits data
- [ ] Build BettingSplitsPanel component (side-by-side with model projections)
- [ ] Integrate splits panel on Dashboard feed game cards (expandable)
- [ ] Add splits view to Publish Projections page

## Betting Splits Feature (2026-03-07) - COMPLETED
- [x] Add 8 new DB columns (spreadAwayBetsPct, spreadAwayMoneyPct, totalOverBetsPct, totalOverMoneyPct, mlAwayBetsPct, mlAwayMoneyPct, awayML, homeML)
- [x] Run db:push migration to apply columns
- [x] Update vsinScraper.ts to parse 4 NCAAM splits fields (Bets%, Money% for spread and total)
- [x] Update nbaVsinScraper.ts to parse 6 NBA splits fields + ML odds
- [x] Fix NBA column order (Handle=money% is td[2]/td[5]/td[8], Bets% is td[3]/td[6]/td[9])
- [x] Update updateBookOdds in db.ts to write splits fields
- [x] Update vsinAutoRefresh.ts to pass splits to updateBookOdds for both NCAAM and NBA
- [x] Build BettingSplitsPanel component with animated bars, section headers, VSiN attribution
- [x] Integrate BettingSplitsPanel into GameCard with collapsible toggle
- [x] Integrate BettingSplitsPanel into PublishProjections with collapsible toggle
- [x] Verify splits data populated in DB (NCAAM: 4 fields, NBA: 6 fields + ML odds)

## Team Colors Database (2026-03-07)
- [x] Add primaryColor/secondaryColor/tertiaryColor columns to nba_teams table
- [x] Create ncaam_teams table with all team info + color columns
- [x] Run db:push migration (migration 0016)
- [x] Seed 365 NCAAM teams with colors from master CSV
- [x] Update 30 NBA teams with colors from NBA master CSV
- [x] Add getTeamColors / getGameTeamColors helpers to db.ts
- [x] Add teamColors.getForGame tRPC procedure to routers.ts
- [x] Rewrite BettingSplitsPanel to fetch colors from DB via tRPC
- [x] No hardcoded colors or CSV references in app code

## Team Colors Database (2026-03-07)
- [x] Add primaryColor/secondaryColor/tertiaryColor columns to nba_teams table
- [x] Create ncaam_teams table with all team info + color columns
- [x] Run db:push migration (migration 0016)
- [x] Seed 365 NCAAM teams with colors from master CSV
- [x] Update 30 NBA teams with colors from NBA master CSV
- [x] Add getTeamColors / getGameTeamColors helpers to db.ts
- [x] Add teamColors.getForGame tRPC procedure to routers.ts
- [x] Rewrite BettingSplitsPanel to fetch colors from DB via tRPC
- [x] No hardcoded colors or CSV references in app code

## Betting Splits Always-Visible Redesign (2026-03-07)
- [x] Redesign BettingSplitsPanel: always-visible, two-color bars, team abbreviations, Spread+Total (NCAAM) / Spread+Total+ML (NBA)
- [x] Restructure GameCard: splits panel left, model projections right on desktop; stacked on mobile
- [ ] Apply same layout to PublishProjections page (deferred — PublishProjections uses EditableGameCard, separate component)

## GameCard Layout Fix (2026-03-07)
- [x] Fix GameCard flex layout: splits column must be constrained to fixed width on desktop so model projections are always visible

## GameCard Layout Restructure (2026-03-07)
- [x] Move betting splits to right side, model projections to left side, 50/50 split
- [x] Polish overall card spacing, alignment, and justification

## GameCard Whitespace Fix (2026-03-07)
- [x] Remove dead vertical whitespace in projections column — both columns must fill height equally with no empty gaps

## BettingSplitsPanel Header Redesign (2026-03-07)
- [x] Center "BETTING SPLITS" in h1 style
- [x] Center "SPREAD" in h2 style with "{Away Team} {Away Spread}" left and "{Home Team} {Home Spread}" right using live book spread
- [x] Center "TOTAL" in h2 style with "OVER {Total}" left and "UNDER {Total}" right using live O/U
- [x] Ensure % bars are accurate to each corresponding side

## BettingSplitsPanel Black Bar Fix (2026-03-07)
- [x] No bar should ever be black in any sport/league — if primary color is black/very dark, fall back to secondary color

## BettingSplitsPanel Adaptive Bar Text Color (2026-03-07)
- [x] When bar color is white/very light, switch in-bar % text to black for readability

## BettingSplitsPanel WCAG Bar Text Contrast (2026-03-07)
- [x] Replace simple luminance threshold with WCAG contrast-ratio check for maximum bar text readability

## Splits Auto-Refresh Integration (2026-03-07)
- [x] Auto-refresh script: extract and persist betting splits alongside lines/odds on every tick
  - NCAAM update path: already writing all 4 splits fields
  - NCAAM insert path: fixed — now writes all 4 splits fields on first insert
  - NBA update path: already writing all 6 splits fields + ML odds
  - NBA insert path: already writing all 6 splits fields + ML odds
- [x] Refresh Now button: also update betting splits for each game when triggered
  - refreshBooksRoute.ts rewritten: scrapes NCAAM + NBA in parallel, writes all splits fields in updateBookOdds call

## Splits Timestamp + EditableGameCard Splits (2026-03-07)
- [x] Add global "Splits updated X min ago" timestamp at top of Dashboard feed (not per-card)
- [x] Add BettingSplitsPanel to EditableGameCard on Publish Projections page (50/50 layout, splits right, inputs left)

## Splits Timestamp Styling (2026-03-07)
- [x] Make "Updated ## min ago" green (#39FF14), always visible, clock icon, format: "Updated ## min ago"

## BettingSplitsPanel UX Polish (2026-03-07)
- [x] Swap row order: TICKET % on top, MONEY % on bottom
- [x] Rename "BET %" label to "TICKET %"
- [x] Make label text white
- [x] Add border/outline to bars (pills) and to the split divider line between the two halves

## BettingSplitsPanel Color Similarity Fix (2026-03-07)
- [x] Detect when away/home bar colors are too similar; cycle away team through secondary/tertiary/fallback until visually distinct
- [x] No white or black allowed on bars (isUnusableBarColor blocks both black <8% luminance and white >90% luminance)
- [x] Home team keeps primary unless it is white or black

## BettingSplitsPanel Color Assignment Audit (2026-03-07)
- [x] Verify each bar half uses only the hex color for the correct team (away left, home right) — no cross-contamination
- [x] Fix darkness threshold: lowered from 8% to 4% so deep purples (High Point) and dark maroons (Texas A&M) are allowed through

## Missing Team Colors (2026-03-07)
- [ ] Identify all NCAAM and NBA teams with null primaryColor in the DB
- [ ] Populate correct hex colors for all teams missing color data (source: ESPN team pages)

## NCAAM Feed Game Status Filter (2026-03-07)
- [x] Add gameStatus field to games DB schema (enum: 'upcoming' | 'live' | 'final')
- [x] Run db:push migration
- [x] Update ncaaScoreboard.ts NcaaGame interface to include gameStatus from gameState field (P→upcoming, I→live, F→final)
- [x] Update fetchNcaaGames() to return gameStatus on each game
- [x] Update vsinAutoRefresh.ts to write gameStatus on insert and update
- [x] Update db.ts updateNcaaStartTime to also update gameStatus
- [x] Add ALL/Upcoming/LIVE/FINAL filter tabs to Dashboard NCAAM feed
- [x] Wire filter tabs to gameStatus field in games.list tRPC procedure
- [x] Show live game count badge on LIVE tab
- [x] Save checkpoint and deliver

## Publish Projections Game Status Filter (2026-03-07)
- [x] Add ALL/UPCOMING/LIVE/FINAL filter tabs to Publish Projections page (mirrors Dashboard)
- [x] Apply client-side status filter to the game list on Publish Projections
- [x] Show live game count badge on LIVE tab
- [x] Save checkpoint and deliver

## Dashboard Status Filter Multi-Select + FINAL Sort (2026-03-07)
- [x] Change status filter from single-select to multi-select (UPCOMING, LIVE, FINAL can be combined)
- [x] When all three are selected simultaneously, auto-revert to ALL (unselect all)
- [x] When ALL is active, sort FINAL games to the bottom within each date group
- [x] Save checkpoint and deliver

## Live/Final Scores on GameCard (2026-03-07)
- [x] Add awayScore, homeScore, gameClock columns to games DB schema
- [x] Run db:push migration
- [x] Update ncaaScoreboard.ts to extract scores and gameClock from NCAA GraphQL API
- [x] Update vsinAutoRefresh.ts to write scores on insert and update
- [x] Add updateGameScores helper in db.ts
- [x] Wire 5-minute score refresh cycle in vsinAutoRefresh.ts
- [x] Update GameCard to show scores for LIVE and FINAL games
- [x] Show gameClock for LIVE games (e.g. "15:07 1st")
- [x] Save checkpoint and deliver

## GameCard LIVE Header Redesign (2026-03-07)
- [x] Hide date when game is LIVE (date is implied to be today)
- [x] Reformat LIVE score as: AwayLogo AwayScore-HomeScore HomeLogo
- [x] Save checkpoint and deliver

## NBA Live Scores + Status Filter (2026-03-07)
- [x] Add fetchNbaLiveScores() to nbaScoreboard.ts using todaysScoreboard_00.json
- [x] Map NBA teamId → DB slug for score matching (via NBA_BY_TEAM_ID from logo URLs)
- [x] Wire NBA scores/status/clock into vsinAutoRefresh.ts on insert and update
- [x] Add 5-minute NBA score refresh cycle in vsinAutoRefresh.ts
- [x] Add ALL/UPCOMING/LIVE/FINAL filter tabs to Dashboard for NBA sport
- [x] Verify GameCard LIVE/FINAL header displays correctly for NBA games
- [x] Save checkpoint and deliver

## 30-Second Score Refresh (2026-03-08)
- [x] Change SCORE_INTERVAL_MS from 5 minutes to 30 seconds in vsinAutoRefresh.ts
- [x] Update frontend refetchInterval from 5 minutes to 30 seconds in Dashboard
- [x] Save checkpoint and deliver

## GameCard FINAL Header Score Format (2026-03-08)
- [x] Update FINAL game header to use AwayLogo AwayScore-HomeScore HomeLogo (same as LIVE)
- [x] Save checkpoint and deliver

## Fix HTTP 414 Request-URI Too Large (2026-03-08)
- [x] Switch tRPC httpBatchLink to use maxURLLength: 2048 to auto-POST large batches (fixes 414 without breaking single-query GET)
- [x] Save checkpoint and deliver

## Remove Element at PublishProjections line 1065 (2026-03-08)
- [x] Identify and remove the element(s) around line 1065 that user marked "you can get rid of these"
- [x] Save checkpoint and deliver

## Dashboard LIVE+FINAL Sort Order (2026-03-08)
- [x] When LIVE+FINAL selected: LIVE games first (OT top, then period desc, clock asc), FINAL games after sorted by start time asc
- [x] Save checkpoint and deliver

## Fix LIVE Sort Always-On (2026-03-08)
- [x] Apply OT-first LIVE sort in ALL filter states (LIVE only, LIVE+FINAL, ALL), not just LIVE+FINAL
- [x] Save checkpoint and deliver

## Fix parseLiveSortKey for 2OT/3OT (2026-03-08)
- [x] Fixed: gameClock stored as "MM:SS 2OT" — added clockOtMatch regex to handle clock+OT-label format
- [x] Save checkpoint and deliver

## Fix Midnight ET Game Date Grouping (2026-03-08)
- [x] Audit backend: how gameDate is derived from startTime in NCAA and NBA scrapers
- [x] Audit frontend: how date groups are computed from gameDate/startTime in Dashboard.tsx
- [x] Fix backend: removed isMidnightGame prior-day logic; NCAA API already returns games under correct ET calendar date
- [x] Fix frontend: no change needed — groups by gameDate from DB which is now correct
- [x] Fixed DB record: Long Beach St @ Hawaii moved from 2026-03-07 to 2026-03-08
- [x] Test and verify Long Beach St vs Hawaii appears under March 8, not March 7
- [x] Save checkpoint and deliver

## Publish Projections Stats Bar Redesign (2026-03-08)
- [x] Add scoresRefreshedAt field to RefreshResult in vsinAutoRefresh.ts
- [x] Update refreshAllScoresNow() to record scoresRefreshedAt timestamp
- [x] Expose scoresRefreshedAt via lastRefresh tRPC procedure
- [x] Redesign stats bar: X/Y Games with Odds | X/Y Games Modeled | Odds Last Updated HH:MM:SS AM/PM EST | Scores Last Updated HH:MM:SS AM/PM EST
- [x] Save checkpoint and deliver

## Publish Projections: Stats Scoping + Submit + Refresh Now (2026-03-08)
- [x] Fix stats bar: withOddsCount, withModelCount, totalCount scoped to selected league+date (not all games)
- [x] Fix withOddsCount to require BOTH spread AND total (not just either)
- [x] Fix withModelCount to require BOTH spread AND total entered
- [x] Added league+date context label to stats bar header
- [x] Refresh Now now triggers full VSiN odds + all scores (NCAAM + NBA) refresh
- [x] Rename "Submit" for first-time save; after submit, dirty changes show "Save"
- [x] Save checkpoint and deliver

## Publish Projections: New Filter Tabs + Sort Order (2026-03-08)
- [x] Add MISSING ODDS filter tab to status filter row (orange, shows count)
- [x] Add MODELED filter tab to status filter row (green, shows count)
- [x] Add NOT MODELED filter tab to status filter row (amber, shows count)
- [x] Verified sort order: DB query already orders by startTimeEst earliest to latest
- [x] Added date-change reset so filter resets to ALL when navigating dates
- [x] Added contextual empty-state messages for each new filter
- [x] Save checkpoint and deliver

## Publish Projections: Delete Game Feature (2026-03-08)
- [x] Add deleteGame backend procedure (owner-only, hard delete from DB)
- [x] Add DELETE button to game card header (next to Live/No Odds badge)
- [x] Show DELETE button only in MISSING ODDS and NOT MODELED filter views
- [x] High-alert confirmation dialog: irreversible warning before deletion
- [x] Auto-hide MISSING ODDS/MODELED/NOT MODELED row when slate is fully complete (0 missing + 0 not modeled)
- [x] Stats bar counts update immediately after deletion (via listStaging invalidation)
- [x] Save checkpoint and deliver

## Score Refresh: 15s Interval + Real-Time Feed Updates (2026-03-08)
- [x] Change SCORE_INTERVAL_MS from 30s to 15s in vsinAutoRefresh.ts
- [x] Wire Feed page to auto-poll scores every 15s (refetchInterval) without page refresh
- [x] Animate score updates on GameCard: score flashes green with glow for 800ms when it changes
- [x] Save checkpoint and deliver

## GameCard Score App Redesign (2026-03-08)
- [x] Rebuild GameCard: Score-app style score panel (left), Books/Model table (center), Betting Splits (right) on desktop
- [x] Mobile: Score panel (left half), Betting Splits (right half), Model table full-width below
- [x] Upcoming games: show date + start time in score panel instead of scores
- [x] Large per-team score rows: logo + name left, big clamp(22-36px) score number right
- [x] Game clock / LIVE badge / FINAL badge above the score rows
- [x] Full responsive scaling: clamp() font sizes, lg breakpoint for 3-col vs 2-row layout
- [x] Winner highlighting: winning team name bold white, loser muted on FINAL
- [x] Save checkpoint and deliver

## Feed Desktop Full-Width Layout (2026-03-08)
- [x] Remove max-w-3xl constraint from main feed container
- [x] Remove max-w-3xl from header rows (brand, sport filter, status tabs, search bar)
- [x] Game cards fill full screen width edge-to-edge on desktop
- [x] Save checkpoint and deliver

## GameCard Layout Fixes: Full-Width, Compact Model Table, Horizontal Splits (2026-03-08)
- [x] Fix model table: remove justify-between, rows now compact and vertically centered
- [x] Fix score panel: flush left, no internal gaps
- [x] Redesign BettingSplitsPanel: horizontal SPREAD | TOTAL | ML columns on desktop/tablet (≥md)
- [x] Each market column: title, side labels, TICKETS bar on top, HANDLE bar on bottom
- [x] Remove rounded-xl from card, remove border-x from wrapper so cards fill full width edge-to-edge
- [x] Mobile: vertical stacked layout preserved (< md)
- [x] Save checkpoint and deliver

## Add ML Betting Splits to VSiN Scraper (NCAAM + NBA) (2026-03-08)
- [x] Update ScrapedOdds interface to include awayML, homeML, mlAwayBetsPct, mlAwayMoneyPct
- [x] Parse td[7] (ML lines), td[8] (ML tickets), td[9] (ML handle) in vsinScraper.ts
- [x] Confirmed vsinAutoRefresh.ts already writes ML fields to DB on upsert
- [x] Remove isNba guard from BettingSplitsPanel — ML column shows for any sport with data
- [x] Save checkpoint and deliver

## Add NCAAM Team Abbreviations to DB (2026-03-08)
- [x] Add abbrev column to ncaam_teams schema
- [x] Run db:push migration (0019_true_james_howlett.sql)
- [x] Bulk-upsert all abbreviations from provided list (match by vsinName/ncaaName)
- [x] Verified: 365/365 teams matched and updated (0 unmatched)
- [x] Save checkpoint and deliver

## Add NBA Team Abbreviations to DB (2026-03-08)
- [x] Add abbrev column to nba_teams schema
- [x] Run db:push migration (0020_faithful_deathbird.sql)
- [x] Seed all 30 NBA abbreviations
- [x] Verified: 30/30 teams matched (0 unmatched)
- [x] Save checkpoint and deliver

## VSiN Auth + NCAAM ML Splits + OVER/UNDER Label (2026-03-08)
- [x] Log into VSiN via browser and extract session cookies
- [x] Store VSiN credentials as env secrets and update scraper to send auth cookies
- [x] Verify NCAAM ML splits data is now populated after next refresh (8+ games with ML data confirmed)
- [x] Update BettingSplitsPanel: OVER/UNDER on desktop/tablet, O/U on mobile
- [x] Add ML fields to NCAAM updateBookOdds call in vsinAutoRefresh.ts (was missing)
- [x] Save checkpoint and deliver

## NBA VSiN Splits Verification (2026-03-08)
- [x] Verified NBA VSiN page HTML structure matches scraper column mapping (td[0]-td[9])
- [x] Confirmed NBA scraper correctly parses SPREAD (td[1]), TOTAL (td[4]), ML (td[7]) odds
- [x] Confirmed NBA scraper correctly parses Spread splits (td[2]=money, td[3]=tickets)
- [x] Confirmed NBA scraper correctly parses Total splits (td[5]=money, td[6]=tickets)
- [x] Confirmed NBA scraper correctly parses ML splits (td[8]=money, td[9]=tickets)
- [x] Confirmed 10 NBA games with full splits data in DB (all 3 markets populated)
- [x] Confirmed BettingSplitsPanel shows "Over/Under" on desktop/tablet and "O/U" on mobile for NBA
- [x] All 20 tests passing
- [x] Save checkpoint and deliver

## Live Game Visibility Fix (2026-03-08)
- [x] Remove today-only date filter from listGames — show all games that have VSiN odds regardless of date (purge handles cleanup at 6am EST)
- [x] Verified: 114 NCAAM games now visible (90 from 03/07 including 5 live + 24 from 03/08)
- [x] All 20 tests passing
- [x] Save checkpoint and deliver

## Midnight Game Date Fix (2026-03-08)
- [x] Delete duplicate 03/08 Long Beach State @ Hawaii record (id=930320)
- [x] Update 03/07 record (id=1620009) with correct startTimeEst=00:00
- [x] Fix NCAA scraper: fetch next-day midnight games and store them under current day's date
- [x] Fix score refresh: also fetch next-day midnight games for live score updates
- [x] Verified: long_beach_st @ hawaii now shows as date=2026-03-07 startTime=00:00 status=live
- [x] All 20 tests passing
- [x] Save checkpoint and deliver

## BettingSplitsPanel Abbreviation Display (2026-03-08)
- [x] Revert invalid inline styles injected by visual editor on the root div
- [x] Add abbrev field to TeamColors interface and getTeamColors query (server/db.ts)
- [x] Show school abbreviations (e.g., UND, SEAU) next to spread odds in SPREAD section
- [x] Show school abbreviations next to ML odds in ML section
- [x] Falls back to full awayLabel/homeLabel when abbrev is null
- [x] All 20 tests passing, no TypeScript errors
- [x] Save checkpoint and deliver

## BettingSplitsPanel Label Formatting (2026-03-08)
- [x] Unbold team abbreviation/name in Spread and ML label rows (fontWeight: 400)
- [x] Put spread value in parentheses: "UND (+11.5)" not "UND +11.5"
- [x] Put ML value in parentheses: "UND (+575)" not "UND +575"
- [x] Rename "Over/Under" section title to "Total" (desktop and mobile)
- [x] Rename "ML" section title to "Moneyline" (desktop and mobile)
- [x] Restructure Total label row: OVER {total#} UNDER left-center-right layout
- [x] Apply to both desktop MarketColumn and mobile MarketSection via isTotalMarket prop
- [x] All 20 tests passing, no TypeScript errors
- [x] Save checkpoint and deliver

## GameCard Layout Restructure (2026-03-08)
- [x] Move team scores adjacent to team names (score inline, not pushed to far right)
- [x] Score now sits immediately after team name in a grouped flex container
- [x] Desktop 3-column order confirmed: Score | Book/Model | Betting Splits
- [x] Mobile layout unchanged (score+splits row 1, model table row 2)
- [x] All 20 tests passing, no TypeScript errors
- [x] Save checkpoint and deliver

## GameCard Mobile Layout Fix (2026-03-08)
- [x] Restructure mobile layout: Score (row 1) → Model Table (row 2) → Betting Splits (row 3)
- [x] Desktop layout confirmed correct: Score | Model Table | Betting Splits (3 columns)
- [x] All 20 tests passing, no TypeScript errors
- [x] Save checkpoint and deliver

## GameCard Always-Horizontal Layout (2026-03-08)
- [x] Remove all responsive stacking — single horizontal 3-column row at ALL screen sizes
- [x] Score | Book/Model Table | Betting Splits always left-to-right, never vertical
- [x] overflow-x: auto on the card wrapper for very small screens
- [x] All 20 tests passing, no TypeScript errors
- [x] Save checkpoint and deliver

## ODDS/LINES Title for Model Table (2026-03-08)
- [x] Add "ODDS/LINES" section title to ModelTablePanel, styled same as "BETTING SPLITS" title
- [x] All 20 tests passing, no TypeScript errors
- [x] Save checkpoint and deliver

## ODDS/LINES Redesign with BOOK/MODEL Toggle (2026-03-08)
- [x] Add BOOK/MODEL toggle to ODDS/LINES section
- [x] BOOK mode: show VSiN SPREAD, TOTAL (O/U), MONEYLINE for away and home teams
- [x] MODEL mode: show model SPREAD, TOTAL (O/U), MONEYLINE for away and home teams (model ML shows — until schema updated)
- [x] Columns: SPREAD | TOTAL | MONEYLINE (matching Betting Splits layout)
- [x] Equal height alignment via h-full on both columns
- [x] Column headers change color: white for BOOK, green (#39FF14) for MODEL
- [x] Edge verdict shows only in MODEL tab when published
- [x] All 20 tests passing, no TypeScript errors
- [x] Save checkpoint and deliver

## ODDS/LINES MODEL Toggle — Edge-Only Values (2026-03-08)
- [x] MODEL mode: only replace the edge side's spread/total/ML value; non-edge side keeps the book line
- [x] Spread: awayModelSpread < awayBookSpread → away has edge (shows model spread); home keeps book spread
- [x] Total: modelTotal < bookTotal → UNDER has edge; modelTotal > bookTotal → OVER has edge
- [x] ML: non-edge side keeps book ML (model ML shows — until schema updated)
- [x] All 20 tests passing, no TypeScript errors
- [x] Save checkpoint and deliver

## Mobile GameCard Layout Redesign (2026-03-08)
- [x] Mobile: Score full-width on top, then ODDS/LINES left + BETTING SPLITS right side-by-side below
- [x] Desktop: keep existing 3-column horizontal layout (Score | Odds/Lines | Betting Splits)
- [x] Test and save checkpoint

## ScorePanel Layout — Score Pushed to Far Right (2026-03-08)
- [x] Team rows: logo+name on left, score pushed to far right (justify-between), no whitespace gap
- [x] Large score font, matching reference screenshot style
- [x] Test and save checkpoint

## Mobile Layout v2 — Score+OddsLines top, Splits below (2026-03-08)
- [x] Mobile row 1: Score (left) + ODDS/LINES (right) side-by-side
- [x] Mobile row 2: BETTING SPLITS full-width below
- [x] Desktop: unchanged 3-column layout
- [x] Test and save checkpoint

## BettingSplitsPanel — Always 3-column horizontal on mobile (2026-03-08)
- [x] Remove mobile vertical stacked layout (md:hidden flex-col)
- [x] Use horizontal 3-column layout at all screen sizes (compact mode on mobile)
- [x] Test and save checkpoint

## Two-Page Split: Model Projections + Betting Splits (2026-03-08)
- [ ] Create ModelProjections page: matchup/score + ODDS/LINES only (no splits)
- [ ] Create BettingSplits page: splits data only (no ODDS/LINES) for all leagues
- [ ] Add top-level navigation between the two pages
- [ ] Update App.tsx routes: /projections and /splits
- [ ] Update header nav to link to both pages
- [ ] Test and save checkpoint

## Two Dedicated Pages

- [x] Add mode prop to GameCard (projections / splits / full)
- [x] Create /projections page (ModelProjections) — score + ODDS/LINES only
- [x] Create /splits page (BettingSplitsPage) — score + BETTING SPLITS only
- [x] Register both routes in App.tsx
- [x] Page-tab navigation (Model Projections | Betting Splits) in both page headers

## Prominent Tab Bar Navigation

- [x] Replace small pill tabs with full-width underline tab bar in ModelProjections header
- [x] Replace small pill tabs with full-width underline tab bar in BettingSplits header

## Fix Post-Login Redirect & Dashboard

- [x] Change Home.tsx post-login redirect from /dashboard to /projections
- [x] Redirect /dashboard route to /projections in App.tsx

## Betting Splits Page Layout Fix

- [x] GameCard splits mode: Score on left, BettingSplits table on right (side-by-side)

## BettingSplitsPanel Redesign

- [x] Redesign BettingSplitsPanel: maximized padding, centering, spacing, large values, clear labels

## BettingSplitsPanel Readability Fix

- [x] Fix GameCard splits-mode: give splits panel more width (score narrower)
- [x] Fix BettingSplitsPanel: full-width bars, no-wrap labels, readable at any width

## Mobile Splits Height Fix

- [x] Shrink mobile MarketBlock height to match compact score panel height

## CompactScorePanel Name Display Fix

- [x] CompactScorePanel: show school name for NCAAM, nickname for NBA

## Share/Export Button Removal
- [x] Remove share/export buttons and ShareSheet from GameCard

## BettingSplitsPanel Label Redesign
- [x] Remove current bar labels and replace with AWAY_ABBR (SPREAD) - XX% format for Tickets and Handle rows

## Splits Bar Label Position Fix
- [x] Move ABBR (LINE) labels above each bar; show only % inside the pill

## Mobile Splits Market Toggle
- [x] Add 3-way toggle (SPREAD / ML / TOTAL) to mobile splits panel; show only active market's bars

## Visual Edit Batch (Mar 8)
- [x] BettingSplitsPanel: rename toggle labels to SPREAD/TOTAL/MONEYLINE
- [x] BettingSplitsPanel: fix pill overflow so both % values are always readable with padding
- [x] BettingSplitsPanel: remove market label span (SPR/TOT/ML text left of bars)
- [x] BettingSplits page: unselected tabs use light gray text (not white), selected stays white+bold
- [x] BettingSplits page: NCAAM icon → test tube clipart
- [x] BettingSplits page: NBA icon → money bag clipart
- [x] BettingSplits page: NCAAM/NBA tab selection style → white border only, no neon green fill
- [x] BettingSplits page: fix sticky date header gap when scrolling
- [x] Fix midnight EST game ordering (between March 7 and March 8 games)
- [x] Replace AI MODEL PROJECTIONS tab icon with test tube image
- [x] Replace BETTING SPLITS tab icon with money bag image
- [x] Replace NCAAM filter icon with March Madness logo
- [x] Replace NBA filter icon with NBA logo
- [x] Fix midnight EST game date: remove "pull from next day" logic in vsinAutoRefresh.ts
- [x] Fix frontend effectiveGameDate helper to not subtract a day for midnight games
- [x] Sort FINAL games to the bottom of their date group (after upcoming and live games) on both pages

## Visual Edit Batch (Mar 8 - ML Inputs & EV Grade)
- [ ] PublishProjections: add modelAwayML and modelHomeML editable input fields
- [ ] PublishProjections: wire ML inputs to updateProjections save mutation
- [ ] Backend: extend updateProjections to accept modelAwayML/modelHomeML
- [ ] EdgeVerdict (GameCard): add EV Grade A+–F scale below edge pts display
- [ ] EdgeVerdictLive (PublishProjections): add EV Grade A+–F scale below edge pts display
- [x] Move star/favorite button to left of game clock/start time in ScorePanel status row
- [x] Add neon green (#39FF14) LIVE indicator to the right of the period/clock (only when live, hidden when final/upcoming)
- [x] Add onFavoriteNotify prop to GameCard for in-page notification callback
- [x] Add in-page square notification (FavNotificationBanner) that appears top-right when user favorites a game, auto-dismisses after 4s
- [x] Add Favorites tab button (star icon) to the left of the calendar dropdown in filter bar
- [x] Favorites tab shows active favorite count badge
- [x] Favorites tab feed shows only favorited games (all sports, all dates)
- [x] isFavoriteStillActive() function: favorites expire at 11:00 UTC the day after the game date
- [x] getFavoriteGamesWithDates server helper: returns gameId + gameDate for expiry logic
- [x] getMyFavoritesWithDates tRPC procedure added to favorites router
- [x] Favorites tab hides calendar/sport/search filters and shows "MY FAVORITES" label instead
- [x] Model toggle available in both normal and favorites tab modes
- [x] Remove '⭐ MY FAVORITES' header from Favorites tab feed
- [x] Keep NCAAM/NBA sport buttons and search bar visible when Favorites tab is active (calendar also always visible)
- [x] Auto-dismiss Favorites tab and return user to main feed when activeFavCount drops to 0
- [x] Merge /projections and /splits into unified /feed route
- [x] AI MODEL PROJECTIONS and BETTING SPLITS tabs switch inline on /feed (no page navigation)
- [x] Redirect /projections, /splits, /dashboard to /feed
- [x] Update Home.tsx to redirect to /feed on login
- [x] Remove AI MODEL PROJECTIONS / BETTING SPLITS tab toggle from feed header
- [x] Display both odds/lines table AND betting splits panel on every game card (no tab switching needed)
- [x] Remove activeMainTab state and all tab-switching logic from ModelProjections
- [x] Sticky/frozen score panel on mobile: score column stays fixed left while odds/splits scroll horizontally underneath
- [x] Fix sticky score panel: ensure it fully occludes scrolling odds/splits content (no merged display when scrolling)
- [x] Fix sticky score panel clipping: scrolled content must not bleed through/over the frozen score panel
- [ ] Definitive fix: scrolled content must be fully hidden/clipped behind sticky score panel (no overlap/bleed-through on mobile)
- [x] Redesign Publish Projections mobile card layout: stacked SPREAD/TOTAL/MONEYLINE sections (replaces cramped side-by-side layout that caused input overlap at 375px-428px)
- [x] Fix /feed query error: replace unsupported CASE WHEN ORDER BY with app-level sort in listGames, listGamesByDate, listStagingGames, and listStagingGamesRange
- [x] Mobile GameCard redesign: team abbreviations in score panel, sticky BOOK/MODEL LINES + BETTING MARKET SPLITS + EDGE tab header, date title left-aligned above score, section order EDGE→BOOK ODDS→MODEL PROJECTIONS→SPLITS, toggle dimming behavior
- [ ] Desktop/tablet GameCard: always show full team name + nickname (two lines) in score panel for all sports (NCAAM: school + nickname, NBA: city + team name)
- [x] Implement production-grade structured client-side logging in GameCard (render, tab switch, edge calc, data validation)
- [x] Implement structured server-side logging in routers.ts and db.ts (request tracing, timing, error context, query diagnostics) — server/logger.ts created
- [x] Mobile GameCard OddsTable: BK→BOOK, MDL→MODEL sub-headers; active=white bold, inactive=light gray unbolded
- [x] Mobile GameCard OddsTable: inactive values use light gray 20% opacity (not neon green); active model values use #39FF14 bold full opacity; active book values use white bold
- [x] Mobile GameCard frozen left panel: two-line school+nickname layout (140px panel), ellipsis fallback for long names, score fixed-width 28px column
- [x] Mobile OddsTable: reduce away/home row font by 2pt (clamp down from 13px base)
- [x] Mobile OddsTable: MODEL edge values = #39FF14; non-edge active model = white bold 10% opacity
- [x] Mobile frozen panel: show game clock + period/half/quarter when live (gameClock field, neon green)
- [x] Mobile frozen panel: score flash (#39FF14) only on the team whose score increased (awayScoreFlash/homeScoreFlash)
- [x] Mobile frozen panel: scores precisely vertically centered with their team row (alignItems: center explicit)
- [x] Mobile frozen panel: game clock white font, inline right of LIVE badge; NCAAM 1st→1H format; NBA MM:SS + Q1/Q2/Q3/Q4/HALFTIME
- [x] Mobile frozen panel: team/school name +2pt font size (clamp 10px base), nickname +1pt (clamp 8px base)
- [x] Mobile OddsTable: non-edge active model values white 55% opacity (was 10%)
- [x] Mobile tab bar: active tab = white bold + neon green underline; inactive = gray 45%
- [x] Mobile frozen panel: justifyContent center + alignSelf stretch for full-height vertical centering
- [x] Rebuild mobile OddsTable: always-visible combined table, BOOK gray unbolded, MODEL neon green header, edge=#39FF14, non-edge model=white bold, book=gray 50%, ML underdog + prefix via formatMl()
- [x] OddsTable color/weight fix: BOOK tab=book white bold + model white unbolded 70% (edge=#39FF14 bold); MODEL tab=book white unbolded 70% + model light gray bold 90% (edge=#39FF14 bold); BOOK sub-header white 75% unbolded always
- [x] OddsTable sub-header tab-responsive: BOOK tab=BOOK white bold + MODEL white unbolded; MODEL tab=BOOK white unbolded + MODEL neon green bold
- [x] MODEL sub-header: not neon green or bold when BOOK LINES is active — white unbolded when BOOK active, neon green bold only when MODEL active; modelStyle factory now tab-branched (no edge highlight on BOOK tab)
- [x] MODEL non-edge values: white bold (not light gray) when MODEL tab active
- [x] Clock formatter: HT → HALFTIME always (all sports)
- [x] Frozen panel: away/home rows have minHeight: 36px to match OddsTable py-2 rows for precise vertical alignment
- [x] Revert incorrect hardcoded color on away spread model span (restored modelStyle factory call)
- [x] Sync frozen panel team rows and OddsTable rows to identical height: both use height: 44px, frozen panel padding: '0 6px', status row paddingTop: 8px paddingBottom: 4px to match OddsTable header height
- [x] Mobile tab bar dual-select: BOOK LINES + MODEL LINES can both be active simultaneously; dual mode = book light gray unbolded + model white bold (non-edge) / neon green bold (edge); sub-headers: BOOK white bold + MODEL neon green bold in dual
- [x] Default tab state = 'dual' (BOOK+MODEL both active) on every card mount and sport switch
- [x] Cannot deselect last active tab (at least one must always be active)
- [x] SPLITS and EDGE are exclusive single-select (cannot combine with BOOK/MODEL or each other)
- [x] OddsTable hidden when SPLITS or EDGE is active (only relevant section data shown)
- [x] Persist tab preference in localStorage (survives page reload and sport switch, 'dual' as default for new users)
- [x] ML edge detection using implied probability; +100 displays as EV (no -100 exists)
- [x] Mobile frozen panel: school/team name font +4pt, nickname +2pt
- [x] Mobile frozen panel: LIVE indicator +6pt, game start time +6pt, clock +6pt, FINAL badge +6pt
- [x] Mobile frozen panel: favorite star icon larger
- [x] School name: truncation fallback to abbreviation on mobile only; desktop/tablet always full name
- [x] Unbold game start time and clock time; keep FINAL bolded
- [x] Period notation: use 1Q/2Q/3Q/4Q, 1H/2H, 1P/2P/3P instead of 1st/2nd/3rd/4th
- [x] Nickname: +1pt bigger, white (#ffffff), not bolded
- [x] School name: semi-bold, white (#ffffff), all-caps; spell out State not St. (fallback to St. if truncated)
- [x] Start time: display EST instead of ET
- [x] Tab bar button text: +1pt font size
- [x] Team logo: add gap/padding between logo and name, center logo vertically between school+nickname, slightly bigger
- [x] ModelProjections date title: +6pt font size, white, bold
- [x] CalendarPicker: show "TODAY" for the active feed date (user local time + 11:00 UTC gate), with timezone debug logging
- [x] ModelProjections header: clean up duplicate fontSize properties, dot white 22px bold, league label 15px all-caps, apply across all feed pages
- [x] Desktop GameCard left panel: widen to fit long names like Oklahoma City without truncation
- [x] Desktop ScorePanel: ResizeObserver-based auto-scaling so team names never truncate at any viewport width
- [x] Responsive audit: automated overflow detection across 16 screen sizes (4 desktop, 4 tablet, 8 mobile)
- [x] Apply universal clamp/auto-scale rules to eliminate all truncation at every breakpoint
- [x] Re-run audit to confirm zero failures across all 16 screen sizes
- [x] Mobile frozen panel: deep diagnostic — measure all team names, find correct font size that fits every name without truncation
- [x] Mobile frozen panel: apply useAutoFontSize hook (same as desktop), remove maxWidth constraints, widen panel
- [x] Update audit script to detect overflow:hidden truncation via Canvas measureText on mobile
- [x] Sticky date/league header: always show full DATE · LEAGUE string on all screen sizes; responsive font sizing (mobile < tablet < desktop)
- [x] NCAAM clock: 1st→1ST HALF, 2nd→2ND HALF; 00:00 1st/2nd→END 1ST/2ND HALF; HALFTIME stays HALFTIME; FINAL stays FINAL
- [x] ModelProjections league label: fix duplicate fontSize property, set to 12px responsive clamp
- [x] Game clock span: enforce single-line display (no wrapping), font size capped so text never overflows to second line
- [x] MobileTeamNameBlock: school name font always >= nickname font (enforce in useAutoFontSize logic)
- [x] Add NHL button to sport filter (all feed pages); clicking shows NHL Coming Soon page with NHL logo + bold header + subheader
- [x] Sport filter buttons: reduce size so more leagues fit in the row
- [x] Uniform school/city name font size: single responsive clamp across all cards (computed from longest name vs container width)
- [x] Uniform nickname font size: single responsive clamp, always smaller than school/city name
- [x] Remove per-card useAutoFontSize from MobileTeamNameBlock and desktop ScorePanel; replace with fixed uniform values
- [x] Audit all 395 names, build abbreviation map (SAINT→ST., CALIFORNIA→CAL, etc.) to bring longest names under 14-char threshold
- [x] Update ncaamTeams.ts ncaaName display values with shortened forms; verify all fit at uniform font size
- [x] Replace useAutoFontSize in MobileTeamNameBlock with uniform clamp(9px, 2.4vw, 11px) for names and clamp(8px, 2.1vw, 10px) for nicknames
- [x] Widen mobile frozen panel grid column from 140px to 170px
- [x] Apply 30-team user-specified abbreviation map to ncaamTeams.ts with full verification log
- [x] Confirm no wrong-school mapping errors exist (Northwestern St. incident was caught — audit all 30)
- [x] Mobile game card school name: +2pt (clamp 11→13px), ALL CAPS, bold (700)
- [x] Mobile game card nickname: +1pt (clamp 9→11px), lowercase, semi-bold (600)
- [x] Mobile game card school name: +3pt more (clamp 14→16px), ALL CAPS bold
- [x] Mobile game card nickname: +1.5pt more (clamp 10.5→12.5px), lowercase semi-bold
- [x] GameCard tab buttons: +1pt font size
- [x] GameCard BOOK/MODEL sub-headers (column headers): +0.5pt font size
- [x] GameCard SPREAD/TOTAL/ML section headers: +1pt font size
- [x] GameCard OddsTable values: +0.25pt font size, +0.2px cell spacing
- [x] GameCard clock/time/FINAL: +1.5pt font size
- [x] GameCard LIVE indicator: +2pt font size
- [x] GameCard favorite star icon: larger (proportional to LIVE/clock)
- [x] GameCard score: left-align (duplicate CSS removed, clean single textAlign: left)
- [x] GameCard team logos: 1.5x larger (22px → 33px)
- [x] GameCard mobile: extend tab bar divider line full card width; move star+LIVE/FINAL/time above it in a single proportionally-scaled header row (star 13px, LIVE 9px, clock 8.5px, FINAL/time 8.5px, tabs 8px)
- [x] Move 4-tab filter (BOOK LINES/MODEL LINES/SPLITS/EDGE) from individual GameCards to a single feed-wide filter bar below date/sport header; applies to all cards at once; default dual-active BOOK+MODEL; present on NCAAM, NBA, NHL, Favorites feeds
- [x] Feed tab bar buttons: fix duplicate fontSize, set to 13px (single clean declaration)
- [x] OddsTable: SPREAD/TOTAL/ML headers +1pt (now clamp(10.25px,2.5vw,12.25px)), BOOK/MODEL sub-headers +0.75pt (now 8.25px), value cells +0.5pt (now 10.25-10.5px)
- [x] GameCard mobile: move per-card status row (star/LIVE/FINAL/time) into frozen left panel above home team row; text matches SPREAD/TOTAL/ML size; 30px height aligns with OddsTable header block
- [x] GameCard mobile: move status row (star/LIVE/FINAL/time) to above the away team row (above away, not between away and home)
- [x] GameCard mobile: style FINAL badge as a light grey pill with neon green (#39FF14) text
- [x] GameCard: never abbreviate "LOS ANGELES" to "LA" in team name display (DB updated + defensive normalization in code)
- [x] BUG FIXED: Oregon vs Maryland duplicate — deleted stale NCAA-only stub (id=1620073); added reverse-order team match in VSiN and NCAA-only insertion paths in vsinAutoRefresh.ts to prevent future duplicates
- [x] BUG FIXED: UMass-Lowell vs UMBC missing — fixed UMBC vsinSlug from 'umbc' to 'md-balt-co' in ncaamTeams.ts; next auto-refresh will populate odds and splits
- [x] AUDIT: 24 games on March 10 NCAAM slate, all confirmed present; no other duplicates or missing games found
- [x] Publish all 24 March 10 NCAAM model lines (spread, ML, total) to DB — 24/24 updated, all publishedToFeed=1
- [x] BettingSplitsPanel: fix rowLabel (TICKETS/MONEY) span — removed opacity:0 and duplicate fontSize; now white, bold, fully visible
- [x] BettingSplitsPanel: added letterSpacing 0.04em to all 4 inside percentage label spans to prevent clamping
- [x] BettingSplitsPanel: advanced splits bar logic — 100%/0% full bar single label, ≥1% always inside pill with min-width guarantee, labels never outside pill; unit tests for 100/0, 1/99, 4/96, 50/50 cases
- [x] BettingSplitsPanel: away segment label flush-left, home segment label flush-right; black stroke textShadow on every % label in all bars (mobile + desktop)
- [x] Desktop splits pill: fix home label clipped by overflow — ensure flex sizing keeps all labels fully visible inside pill
- [x] Desktop GameCard: vertically center left panel (team names/scores) with OddsTable rows
- [x] Feed tab bar (BOOK/MODEL/SPLITS/EDGE): hide on desktop/tablet (lg+), show only on mobile
- [x] BettingSplitsPanel: universal black stroke on ALL % labels every screen/code path; increase minWidth so single-digit values (1-9%) always have enough room inside pill on all screens
- [x] SplitBar desktop: dynamic proportional font+segment scaling with clamp() so % values scale with bar height at all viewport widths; single-digit always fully visible; 100% rule intact
- [x] GameCard desktop/tablet: consistent team name font sizes (school name + nickname) scaled with clamp() matching mobile hierarchy
- [x] Phase 1: CSS --scale variable in :root (100vw/393, clamped 1–3.85) + device viewport database comment
- [x] Phase 2: useViewportScale() hook — throttled resize, returns {width,height,scale,deviceType}
- [x] Phase 3: Fluid typography — clamp(base, calc(base * var(--scale)), max) on all text elements
- [x] Phase 4: Scale-adjusted spacing/dimensions — padding, margin, row-height, logo-size, card-radius
- [x] Phase 5: Fluid minmax grid columns for game board
- [x] Phase 6: useViewportScale hook integrated into app context
- [x] Phase 7-9: Mobile/tablet/desktop layout verified with scale engine
- [x] Phase 10: react-window virtualized game list rendering
- [x] Phase 11: Validation vitest against 25-device viewport database
- [x] GameCard desktop: widen left panel from 170px to clamp(170px,14vw,220px); bump useAutoFontSize max to 20px; nickname clamp(13px,1.3vw,17px) so names scale visibly larger on desktop
- [ ] GameCard desktop: diagnose and fix font size inconsistency — some names appear smaller than others; ensure all team name paths use consistent fluid clamp() sizing
- [x] Fix team name font scaling: MobileTeamNameBlock now uses useAutoFontSize (max=18px, min=9px) instead of fixed clamp() — long names like "UMass Lowell" auto-shrink to fit container
- [x] Fix awayNameRef/homeNameRef containers in ScorePanel: added flex-1 so useAutoFontSize measures full available width (was 68.6px, now 124.6px) — "UMass Lowell" now renders at 19.5px instead of 10.5px
- [x] Remove all truncation from team names/nicknames — no overflow:hidden, no textOverflow:ellipsis, no clipping; uniform clamp() font sizes scale with viewport, containers expand to fit full text
- [x] Desktop: merge ODDS + SPLITS into single unified table (BOOK → splits bars → MODEL per section) with EdgeVerdict on far right; mobile/tablet unchanged
- [x] Desktop DesktopMergedPanel refinement: per-column vertical stack = section header → BOOK row → TICKETS bar → HANDLE bar → MODEL row; EdgeVerdict pinned right; full screen width; desktop only
- [x] Desktop SectionCol: split bars show team labels flanking left/right of each bar (away label left, home label right), TICKETS/MONEY centered above bar — matching reference screenshots
- [x] Desktop SectionCol restructure: top = team labels + BOOK/MODEL column headers + values in same row; bottom = TICKETS bar + MONEY bar completely below the odds table
- [x] Desktop SectionCol exact layout: section title → 2-col grid (BOOK header | MODEL header → away book | away model → home book | home model) → separator → TICKETS bar → MONEY bar
- [x] Desktop SectionCol: add team abbreviation prefix to each value cell — SPREAD/ML show "ABBR value" (e.g. "PSU +4.5"), TOTAL keeps o/u prefix only (e.g. "o143.5"); desktop only
- [x] Desktop: uniform game card height — all cards same fixed height, all section columns same dimensions
- [x] Desktop SectionCol: team logos in SPREAD and MONEYLINE row labels (away logo left of away values, home logo left of home values)
- [x] Desktop SectionCol TOTAL: spell out "OVER" and "UNDER" as row labels instead of blank/o/u prefix
- [x] Desktop: remove team abbreviation text from SPREAD/ML row labels — logos only, no text
- [x] Desktop: fix OVER/UNDER in TOTAL section — text directly next to values, no separate label column
- [x] Desktop: enforce uniform fixed card height across all game cards (no minHeight variance)
- [x] Desktop: enforce uniform splits bar height and width across all 3 sections (SPREAD/TOTAL/ML) and all game cards
- [x] Desktop: logos must be immediately adjacent (right next to) the BOOK and MODEL spread/ML values — no gap between logo and number
- [x] Desktop: logos appear in BOTH BOOK and MODEL cells for SPREAD/ML rows (not just BOOK)
- [x] Desktop: TOTAL section — show plain "OVER" / "UNDER" text only, no o{total}/u{total} prefix notation
- [ ] Desktop: uniform splits bar height and width across all 3 sections (TICKETS and MONEY bars identical size)
- [ ] Desktop: OVER/UNDER rows show "OVER {bookTotal}" and "UNDER {bookTotal}" in BOOK cell, "OVER {modelTotal}" and "UNDER {modelTotal}" in MODEL cell
- [ ] Desktop: strip ALL o/u prefix from OVER/UNDER total values — format must be exactly "OVER {number}" / "UNDER {number}" with no o or u characters anywhere
- [x] Desktop: TICKETS and MONEY split bars same height (MONEY pill is currently taller than TICKETS)
- [x] Desktop: TOTAL section title must say "TOTAL" not "OVER/UNDER" (section header text fix)
- [x] Desktop: show team abbreviation next to logo in SPREAD and ML sections — {LOGO} {ABBR}
- [x] Desktop: uniform column widths — all section borders align at same horizontal positions across all game cards
- [x] Desktop: uniform height for every game card row (GAME/MATCHUP | SPREAD | TOTAL | MONEYLINE | EDGE all same height)
- [x] Desktop: TOTAL section header — remove OVER/UNDER corner texts and remove total value line beneath title
- [x] Desktop: enforce perfectly uniform SPREAD/TOTAL/ML/EDGE panel widths (grid-based, not flex)
- [x] Desktop: BOOK/MODEL column headers 4pt larger than value rows beneath them
- [x] Desktop: value rows 4pt smaller than BOOK/MODEL headers; abbreviations/OVER/UNDER labels 1pt smaller than values
- [x] Desktop: ALL BOOK values — light gray #D3D3D3, font-weight 500
- [x] Desktop: ALL MODEL non-edge values — white #FFFFFF, font-weight 600
- [x] Desktop: ALL MODEL edge values — neon green #39FF14, font-weight 700
- [x] Desktop: deep pixel-level audit and fix of game card panel uniform height/width — EDGE column fixed at clamp(120px,10vw,160px); pixel measurement confirms all 24 cards now have exactly 312|1|312|1|312|1|128px column widths (1 unique pattern, was 17 unique patterns)
- [x] Desktop: BOOK column title in all 3 SPLITS sections — change to white font
- [x] Desktop: fix SPREAD splits bar labels — homeSpreadLabel bug fixed (was using awayAbbr, now uses homeAbbr)
- [x] Desktop: TICKETS and MONEY row titles — change to white font
- [x] Desktop: score/matchup panel — teams wrapped in flex-col justify-center group, py-2→py-1 on each row; pixel measurement: teams at top=48px and top=126px in 179px card, now grouped and centered
- [ ] Desktop: move teams higher in score panel (reduce top padding/offset)
- [ ] Desktop: scale favorite star, game clock/startTime, and LIVE/FINAL badge to 1.5× team name font size
- [ ] Desktop+all screens: FINAL button neon green (#39FF14) matching mobile style

## Style Changes (2026-03-11)
- [x] SPREAD/TOTAL/MONEYLINE labels: increase font size by 1.5pt relative to BOOK/MODEL labels
- [x] Losing team score: reduce font-weight by 200 (e.g. 700→500)
- [x] LIVE badge: match FINAL pill style (neon green border, background, same font/padding)
- [x] Betting split pill %% values: add letterSpacing +0.2em to all percentage text in pills
- [x] SPREAD/TOTAL/MONEYLINE: increase font size by 1.5pt more than BOOK/MODEL (iteration 2)
- [x] Losing team score: add 100 back to bold level (500→600)
- [x] LIVE pill: increase border-radius to be more rounded (full pill shape)
- [x] LIVE pill: move to LEFT of gameClock/gameStatus text
- [x] Betting split pill %%: decrease letterSpacing by 0.2, then add 0.1 gap before % symbol via thin-space
- [x] LIVE/FINAL pill: halve border-radius (9999px → ~6px)
- [x] LIVE pill: add gap/space between dot and LIVE text
- [x] gameClock/LIVE/FINAL/star buttons: reduce size by 25%
- [x] Winning score fontWeight: reduce by 50 (900→850) for FINAL and LIVE games
- [x] SPREAD/TOTAL/MONEYLINE titles: reduce fontWeight by 50 (800→750)
- [x] Star favorite glow: reduce shine/glow intensity when toggled
- [x] Losing team score: visually distinct fontWeight from winner in both LIVE and FINAL games
- [ ] Score fontWeight ratio: winner=700, loser=600
- [ ] Exact vertical centering of gameClock/status, team names, and scores within card
- [ ] Enhanced Edge Verdict section on desktop

## Systemic Duplicate Game + Missing Odds Root Cause Fix (2026-03-11)
- [ ] Deep audit: DB state for all current duplicates across all dates
- [ ] Fix: team-pair reversal dedup (VSiN away/home != NCAA away/home)
- [ ] Fix: schedule-odds merge logic (update existing row instead of inserting new)
- [ ] Fix: add DB unique constraint on (gameDate, sorted awayTeam, sorted homeTeam)
- [ ] Fix: vsinAutoRefresh canonical team-pair key (sort teams alphabetically before lookup)
- [ ] Fix: ncaaScoreboard merge should update startTimeEst on existing VSiN row, not insert new
- [ ] Clean up all current DB duplicates after pipeline fix
- [ ] Add comprehensive pipeline logging for every insert/update/skip decision
- [ ] Full pipeline audit: cross-reference VSiN source, NCAA schedule, NBA schedule against DB
- [ ] Fix all odds/splits mapping mismatches found in audit
- [x] Fix reversed-team odds mapping bug in vsinAutoRefresh.ts (VSiN home/away order vs NCAA order mismatch causes inverted spreads/ML/splits — e.g. Bethune-Cookman @ Prairie View, isReversedMatch swap logic added)
- [x] Add kenpomSlug field to NcaamTeam interface and all 365 registry entries in ncaamTeams.ts
- [x] Push DB migration for kenpomSlug column in ncaam_teams table
- [x] Seed kenpomSlug values for all 365 ncaam_teams rows with full cross-validation

## Model v9 Backend Integration
- [x] Add modelAwayScore and modelHomeScore columns to games schema
- [x] Run db:push to sync new schema columns
- [x] Write server/model_v9_engine.py — headless Python engine (stdin JSON → stdout JSON)
- [x] Write server/ncaamModelEngine.ts — TS wrapper spawning Python engine per game
- [x] Write server/ncaamModelSync.ts — orchestrator: fetch games → lookup kenpomSlug/conf → parallel model runs → write to DB
- [x] Add conference→KenPom short code mapping (ncaamTeams conference names → model CONF_AVG_DE keys)
- [x] Add tRPC procedure model.runForDate (owner-only) — triggers manual model run
- [x] Auto-trigger model sync after VSiN refresh completes in vsinAutoRefresh.ts
- [x] Write vitest test for ncaamModelEngine (12 tests passing)
- [x] Save checkpoint after integration

## V9 Origination Engine Decoupling & Automation
- [ ] Remove v9 auto-trigger hook from vsinAutoRefresh.ts (keep slate/odds pipelines fully separate)
- [ ] Build dedicated ncaamModelWatcher.ts — polls DB for new unoriginated NCAAM games, fires v9 per game immediately on detection
- [ ] Wire ncaamModelWatcher into server startup (runs independently of VSiN refresh and slate population)
- [ ] Add tRPC procedure model.runFullSlate (owner-only) — manual full re-run of all today's games
- [ ] Populate modelAwayScore, modelHomeScore, modelAwaySpread, modelHomeSpread, modelTotal, modelAwayML, modelHomeML into game cards as pre-review placeholders
- [ ] Add deep structured logging to model watcher (game detected, v9 dispatched, result written, errors)
- [ ] Write integration test: simulate new game insertion → verify v9 fires and DB fields populate
- [ ] Verify slate population, odds refresh, and v9 origination are fully independent execution paths
- [ ] Save checkpoint after full integration test passes

## V9 Hardcoded Team Data (Eliminate Live KenPom Fetches)
- [ ] Bulk-fetch all 365 teams' KenPom conference-only scouting data (OE, DE, Tempo, APLO, secondary stats)
- [ ] Bulk-fetch all 365 teams' conference schedule PPG (scored and allowed, OT-adjusted)
- [ ] Build TEAM_DATA lookup dict in model_v9_engine.py — keyed by kenpomSlug
- [ ] Remove all live kenpompy fetches from model_v9_engine.py
- [ ] Update ncaamModelEngine.ts to remove kenpom_email/kenpom_pass from input JSON
- [ ] Update ncaamModelWatcher.ts to remove credential passing
- [ ] Test end-to-end pipeline with hardcoded data on all 4 test games
- [ ] Verify game card population for all test games
- [ ] Save checkpoint

## Model Projection Gating + Spread Rounding (2026-03-12)
- [ ] Round model spreads to nearest 0.5 in model_v9_engine.py output (e.g. -7.96 → -8.0, +3.43 → +3.5)
- [ ] Round model totals to nearest 0.5 in model_v9_engine.py output
- [ ] Add publishedModel boolean column to games DB schema (default false)
- [ ] Run db:push migration for publishedModel column
- [ ] Gate model fields (awayModelSpread, homeModelSpread, modelTotal, modelAwayML, modelHomeML) behind publishedModel=true in games.list public API — return null for unpublished model data
- [ ] Update Publish Projections page to show model projections (spread, total, ML, scores, over/under rates, win %) for review
- [ ] Add "Approve Model" toggle/button per game on Publish Projections page
- [ ] Add "Approve All" bulk action on Publish Projections page
- [ ] Wire publishedModel toggle to new tRPC procedure games.setModelPublished (owner-only)
- [ ] Verify public feed shows dashes for model columns until @prez approves each game
- [ ] Update vitest tests for new gating logic
- [ ] Re-run watcher to re-populate model data with rounded spreads/totals

## Spread Sign Fix + 0.5 Rounding (2026-03-12)
- [x] Fix spread sign logic: projected favorite (lower score) must get negative spread, underdog gets positive
- [x] Round awayModelSpread, homeModelSpread to nearest 0.5 before writing to DB
- [x] Round modelTotal to nearest 0.5 before writing to DB
- [x] Clear all existing model data from DB and re-run watcher to repopulate with correct values
- [x] Round model moneylines to whole integers (no decimal points) in watcher formatML
- [x] URGENT: Gate all model fields in listGames API — only return model data when publishedModel = true
- [x] URGENT: Clear all model data from DB until gating is in place
- [x] Add publishedModel boolean column to games table schema and run migration
- [x] Add setGameModelPublished helper in db.ts
- [x] Add setModelPublished tRPC procedure (ownerProcedure) in routers.ts
- [x] Add Approve Model / Model Live button to EditableGameCard in PublishProjections (NCAAM only, only when model data exists)
- [x] Scope publishedModel gate to NCAAM games only in listGames
