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

## Login Error Investigation (2026-03-12)
- [x] Diagnose "string did not match expected pattern" login error — caused by missing app_session cookie (session cookie cleared during server crash window)
- [x] Fix slow site load issue — caused by publishedmodel column missing from DB during brief migration window
- [x] Fix "Failed to update model approval status" error on Publish Projections page — root cause: sameSite:none cookie without secure:true silently dropped by browser; fixed with trust proxy + conditional sameSite
- [x] Fix feed loading screen crash (happening simultaneously with model approval error) — same root cause as above

## Slow Load + No Games Found Investigation (2026-03-12)
- [x] Diagnose site taking very long to load — caused by polling storm (5 simultaneous games.list polls at 15s intervals); fixed by raising all to 60s with 30s staleTime
- [x] Diagnose "no games found" after refresh — all 44 NCAAM games had publishedToFeed=0 (temporary state); re-published all 44 games
- [ ] Investigate whether all user sessions need to be invalidated

## Session Invalidation System (2026-03-12)
- [x] Deep analysis: trace full auth lifecycle to determine best invalidation strategy
- [x] Implement tokenVersion field in app_users table for per-user JWT invalidation
- [x] Add forceLogout (individual) and forceLogoutAll (bulk) procedures
- [x] Add admin UI controls for force-logout in User Management page
- [x] Run DB migration and verify end-to-end
- [x] Write vitest tests for tokenVersion system (16 tests passing)

## Bulk Approve Models (2026-03-12)
- [x] Add bulkApproveModels DB helper (approves all pending games with model data for a date)
- [x] Add games.bulkApproveModels tRPC procedure (owner-only)
- [x] Add "Approve All Models" button to Publish Projections header (neon green ghost style, shows pending count badge, hidden when count=0)
- [x] Add 5 vitest tests for pendingApprovalCount logic (168/169 total passing)

## Mobile Layout Fixes (2026-03-12)
- [x] Fix filter bar (Favorites/Today/Sport tabs/Search) to fit within screen width — no horizontal scroll, all items visible
- [x] Fix date+league subtitle to always be single-line, fully centered, never clipped on any screen width
- [x] Ensure tab bar scales proportionally to screen width (font size, padding, icon size all responsive)
- [x] Verify no horizontal overflow anywhere on Dashboard on mobile (375px width)

## Mobile Deep Optimization Audit (2026-03-12)
- [x] Add useMobileDebug hook: logs vw/vh, devicePixelRatio, safeAreaInsets, headerHeight, scale factor on every resize
- [x] Fix index.css: add env(safe-area-inset-*) support, ensure --scale is clamped correctly for 320px-430px range
- [x] Fix ModelProjections header: all rows fit on every mobile width 320px-430px without overflow
- [x] Fix GameCard: frozen left panel correct width, horizontal scroll table correct column widths on all mobile sizes
- [x] Fix feed main area: height = 100dvh - headerHeight, no vertical scroll bleed, safe area bottom padding
- [x] Verify no overflow:hidden clipping on any interactive element (search dropdown, calendar picker)

## Edge Detection Fix (2026-03-12)
- [x] Audit spread, total, and ML edge detection algorithms in GameCard
- [x] Fix ML edge: must be directionally consistent with spread edge (if UCLA spread is edge, Rutgers ML cannot also be edge)
- [x] Implement unified edge direction model: spread-first with implied-prob fallback when no spread edge
- [x] Write vitest tests for edge consistency across all scenarios (17 tests passing)

## NHL Teams Database (2026-03-12)
- [x] Extract NHL slugs and logo URLs from NHL.com HTML source
- [x] Extract VSiN slugs and team names from VSiN HTML source
- [x] Build complete 32-team mapping with all 12 columns validated (13 checks: 0 errors, 0 warnings)
- [x] Add nhl_teams table to DB schema and run db:push (migration 0027)
- [x] Add upsertNhlTeams, getNhlTeams, getNhlTeamByDbSlug, getNhlTeamByAbbrev helpers to db.ts
- [x] Extend getTeamColors() to handle sport="NHL"
- [x] Seed all 32 NHL teams into the database (32/32 inserted, 0 errors)
- [x] Run validation query confirming 32 rows, no nulls, correct conferences/divisions (13/13 checks passed)

## NHL Data Pipeline (2026-03-12)
- [x] Audit existing VSIN scraper (vsinScraper.ts) and NBA scraper to understand exact API endpoints
- [x] Test NHL.com API endpoint (api-web.nhle.com/v1/schedule/today) for today's games
- [x] Test VSIN NHL API endpoint for betting splits
- [x] Build nhlVsinScraper.ts: authenticate, fetch NHL splits, parse into ScrapedOdds objects
- [x] Build nhlSchedule.ts: fetch NHL.com API schedule, extract start times, map to DB slugs via nhl_teams table
- [x] Add NHL game import to auto-refresh cron (same pattern as NCAAM/NBA)
- [x] Add NHL tRPC procedures: games.listNhl, games.refreshNhl
- [x] Write vitest tests for NHL scraper mapping

## NHL Pipeline Full Test (2026-03-13)
- [x] Audit NCAAM/NBA refresh job and DB helpers to mirror for NHL
- [x] Finalize nhlVsinScraper.ts with full debug logging
- [x] Build nhlRefreshJob.ts: VSiN scrape + NHL API schedule + map/match + DB upsert (integrated into vsinAutoRefresh.ts)
- [x] Add NHL DB helpers: upsertNhlGame, getNhlGames, getNhlGamesByDate
- [x] Add NHL tRPC procedures: nhl.listGames, nhl.refresh
- [x] Wire NHL refresh into auto-refresh cron
- [x] Run end-to-end pipeline test: scrape → map → store → verify DB rows (14/14 games, 14/14 odds, 14/14 splits)
- [x] Validate mapping accuracy: every VSiN game matched to NHL API game (16/16 VSiN games processed)
- [x] Write vitest tests for NHL pipeline

## NHL tRPC Integration (2026-03-13)
- [x] Fix triggerRefresh fallback object to include nhlUpdated/nhlInserted/nhlScheduleInserted/nhlTotal fields
- [x] Add NHL case to isValidGame() in routers.ts (NHL_VALID_DB_SLUGS)
- [x] Add NHL sport selector button to Publish Projections page
- [x] Add NHL Refresh Stats section to Publish Projections stats bar
- [x] Fix fetchNhlLiveScores() to use DST-aware ET date calculation (was hardcoded -5h, now uses Intl.DateTimeFormat)
- [x] Live end-to-end validation: 13/13 HTML parse checks passed, 11/11 slug checks passed, 14/14 DB games verified

## NHL Full-Stack Display Audit (2026-03-13)
- [x] DB audit: 14/14 today's games with complete odds/splits/scores; 42 future schedule-only stubs (expected, no VSiN lines yet)
- [x] GameCard.tsx: add NHL_BY_DB_SLUG import and NHL team lookup (city, nickname, logoUrl)
- [x] PublishProjections.tsx: add NHL_BY_DB_SLUG import and NHL team lookup in EditableGameCard
- [x] Dashboard.tsx: add NHL sport tab button (blue #4FC3F7 style), NHL_BY_DB_SLUG import
- [x] Dashboard.tsx: fix SearchResultRow to use NHL city/nickname for NHL teams
- [x] Dashboard.tsx: fix TeamBadge to use NHL logo for NHL teams
- [x] Dashboard.tsx: fix sport label to show 'NHL HOCKEY' when NHL tab active
- [x] routers.ts: confirmed isValidGame() handles sport='NHL' via NHL_VALID_DB_SLUGS
- [x] TypeScript: 0 errors after all changes
- [x] Test suite: 185/186 passing (1 pre-existing KenPom credentials failure)

## NHL Feed + Publish Projections Display Fixes (2026-03-13)
- [x] Remove "NHL MODEL / COMING SOON..." placeholder from ModelProjections.tsx NHL tab — show real game cards
- [x] Fix Publish Projections ML display: add BOOK ML column to desktop layout showing awayML/homeML from DB
- [x] Confirmed publishedToFeed: all 14 today's NHL games are published (0 unpublished)
- [x] Advanced debug audit: 14/14 games with spread, total, ML, published — 0 missing fields
- [x] Mobile tab filter: removed NHL gate so mobile tab bar shows for NHL too
- [x] TypeScript: 0 errors; 185/186 tests passing (1 pre-existing KenPom env failure)

## Auth Error Fix (2026-03-13)
- [x] Diagnose "Not authenticated" TRPCClientError: race condition in initial tRPC batch — favorites.getMyFavorites fires before appUsers.me resolves, no app_session cookie yet
- [x] Fix ModelProjections.tsx: change isAppAuthedForFav to !appAuthLoading && Boolean(appUser) so favorites queries wait for auth state to resolve
- [x] Fix ModelProjections.tsx: add retry:false to favorites queries to prevent retry loops
- [x] Fix main.tsx: suppress UNAUTHORIZED console errors for optional auth-gated queries (favorites) to eliminate noise
- [x] TypeScript: 0 errors; 185/186 tests passing (1 pre-existing KenPom env failure)

## Loading Screen Fix (2026-03-13)
- [ ] Add QueryClient defaultOptions: staleTime=5min, retry=1 to prevent long spinners
- [ ] Add 3s timeout fallback in Home.tsx so landing page shows even if auth is slow
- [ ] Add staleTime to useAppAuth hook to cache appUsers.me for 5 minutes
- [ ] Verify fix: loading screen resolves quickly on mobile

## Site-Wide Hardening Audit (2026-03-13)
- [ ] Server: Fix DB connection pool (single connection → pool of 10, keepAlive, connectTimeout)
- [ ] Server: Add global unhandledRejection + uncaughtException handlers to prevent server crash
- [ ] Server: Add request timeout middleware (30s) to prevent hanging requests causing 503s
- [ ] Server: Add health check endpoint /api/health for load balancer monitoring
- [ ] Auth: Fix loading screen — add 5s timeout fallback so users see login prompt not black spinner
- [ ] Auth: Add staleTime to QueryClient defaults to reduce cold-start latency
- [ ] Auth: Fix tokenVersion mismatch UX — show clear session-expired message instead of blank spinner
- [ ] Frontend: Fix all TypeScript errors in GameCard.tsx, vsinAutoRefresh.ts
- [ ] Frontend: Add React ErrorBoundary to all pages to prevent full page crashes
- [ ] Frontend: Add loading timeout fallback to ModelProjections, Dashboard, PublishProjections
- [ ] Cron: Add try/catch around every cron job tick to prevent uncaught exceptions crashing server
- [ ] Cron: Fix ScoreRefresh — add NHL score refresh to the score refresh cycle
- [ ] Cron: Add memory leak protection — clear intervals on process exit
- [ ] DB: Fix TypeScript type for drizzle pool instance

## Site-Wide 100x Hardening Audit (2026-03-13)
- [x] TypeScript: eliminated all 331 errors (292 from sortGamesByStartTime generic inference bug, 39 from implicit any lambdas)
- [x] Root cause: sortGamesByStartTime<T> generic + _db:any caused Drizzle rows to lose all fields except {gameDate,startTimeEst,sortOrder}
- [x] Fix: added explicit Promise<Game[]> return types to listGames, listGamesByDate, listStagingGames, listStagingGamesRange
- [x] Fix: added explicit Promise<AppUser[]> return types to listAppUsers and app user helpers
- [x] Fix: added ModelFile type annotation to routers.ts lambda; FileRow type to FilesPage.tsx
- [x] Server: added global process.on('unhandledRejection') and process.on('uncaughtException') crash guards in server/_core/index.ts
- [x] Server: added /health endpoint for load balancer health probes (returns 200 without hitting DB)
- [x] Server: added 30-second request timeout middleware to kill hanging connections
- [x] Server: added tRPC onError handler to log INTERNAL_SERVER_ERROR paths with stack traces
- [x] DB: upgraded from single connection to mysql2 connection pool (max=10, connectTimeout=10s, keepAlive=true)
- [x] Auth: added 4-second timeout to Home.tsx and LoginPage.tsx loading spinners (shows login page if server is slow)
- [x] Auth: updated useAppAuth hook with staleTime=5min, retry=1, retryDelay=1s, refetchOnWindowFocus=false
- [x] QueryClient: added defaultOptions with staleTime=5min, retry=1, retryDelay=1s, refetchOnWindowFocus=false
- [x] Cron: confirmed all setInterval ticks in vsinAutoRefresh.ts are wrapped in try/catch
- [x] Frontend: favorites queries use !appAuthLoading guard to prevent race condition on initial load
- [x] Test suite: 185/186 passing (1 pre-existing KenPom env failure unrelated to hardening)

## NHL Puck Line Odds + O/U Odds (2026-03-13)
- [x] Add awaySpreadOdds, homeSpreadOdds, overOdds, underOdds columns to games DB schema
- [x] Run db:push migration
- [x] Build MetaBet consensus odds scraper for NHL (vsin.com/odds/ with HKN filter)
- [x] Parse consensus spread odds, O/U odds from MetaBet board HTML
- [x] Wire MetaBet scrape into NHL refresh pipeline (alongside VSiN splits)
- [x] Update updateBookOdds DB helper to write spread/O/U odds columns
- [x] Update GameCard to display puck line odds in parentheses (e.g. +1.5 (-226))
- [x] Update GameCard to display O/U odds in parentheses (e.g. o5.5 (-107))

## MetaBet Consensus Spread Odds + O/U Odds — All Sports (2026-03-13)
- [x] Build shared metabetScraper.ts: fetch MetaBet API for BKC (NCAAM), BKP (NBA), HKN (NHL)
- [x] Parse consensus spread odds (awaySpreadOdds, homeSpreadOdds) and O/U odds (overOdds, underOdds)
- [x] Extend updateBookOdds DB helper to accept and write awaySpreadOdds, homeSpreadOdds, overOdds, underOdds
- [x] Wire MetaBet scrape into NCAAM refresh pipeline (alongside VSiN splits)
- [x] Wire MetaBet scrape into NBA refresh pipeline
- [x] Wire MetaBet scrape into NHL refresh pipeline
- [x] Update GameCard BOOK view: show spread odds in parentheses e.g. +4.5 (-105) for all sports
- [x] Update GameCard BOOK view: show O/U odds in parentheses e.g. o233.5 (-113) for all sports
- [ ] Write vitest tests for MetaBet scraper decimal-to-American conversion

## MetaBet DraftKings → Consensus Fallback
- [x] Update metabetScraper: fetch both DraftKings and consensus providers per game
- [x] Apply DK first, fall back to consensus per-market (spread, O/U, ML) when DK value is null
- [x] Verify North Texas @ Tulsa resolves correctly with consensus fallback

## Full Odds/Lines DB Population + Display Audit
- [ ] Diagnose why awayBookSpread and bookTotal are null in DB after MetaBet refresh
- [ ] Fix MetaBet refresh pipeline wiring so spread line and total write to DB correctly
- [ ] Trigger live refresh and re-run DB audit to confirm 100% field completeness
- [ ] Visual audit: mobile display of spread/ML/O/U odds for NCAAM, NBA, NHL
- [ ] Visual audit: tablet display of spread/ML/O/U odds for NCAAM, NBA, NHL
- [ ] Visual audit: desktop display of spread/ML/O/U odds for NCAAM, NBA, NHL
- [ ] Fix any display gaps or truncation issues found across screen sizes

- [ ] Audit vsin.com/odds/ page structure for NBA and NHL spread/total/ML lines with juice
- [ ] Build vsin.com/odds/ scraper for NBA and NHL (spread number + juice, total + juice, ML)
- [ ] Integrate new odds scraper into vsinAutoRefresh.ts (replace/supplement current NBA/NHL odds source)
- [ ] Publish NBA March 13 games to feed after odds are populated
- [ ] Verify NBA and NHL game cards display spread, total, and ML with correct odds on mobile and desktop

## NCAA.com Full Slate Audit (2026-03-13)
- [ ] Fix March 13: remove duplicate new_mexico@san_diego_st entry (wrong date - real game is March 14)
- [ ] Fix March 13: kent@akron status correction (showing live but should be upcoming)
- [ ] Populate missing spread/total odds for 16 March 13 games via MetaBet NCAAM endpoint
- [ ] Audit March 14+ dates for missing D1 NCAAM games (check NCAA.com for each date)
- [ ] Ensure NCAA scoreboard sync covers all 365 teams on all dates going forward
- [ ] Fix Ole Miss slug mapping (NCAA.com shows "Ole Miss", DB slug is "mississippi")
- [ ] Fix CSUN slug mapping (NCAA.com shows "CSUN", DB slug is "csu_northridge")
- [ ] Fix Southern U. slug mapping (NCAA.com shows "Southern U.", DB slug is "southern_u")
- [ ] Fix Florida A&M HTML entity (NCAA.com shows "Florida A&amp;M", DB slug is "florida_a_and_m")
- [ ] Fix Alabama A&M HTML entity (NCAA.com shows "Alabama A&amp;M", DB slug is "alabama_a_and_m")

## Action Network Odds Integration
- [ ] Discover Action Network API endpoints for NCAAB, NBA, NHL odds
- [ ] Build actionNetworkScraper.ts using Open + DK NJ (book 128508) columns
- [ ] Integrate Action Network scraper into vsinAutoRefresh replacing MetaBet
- [ ] Backfill today's games (March 13) with Action Network odds
- [ ] Verify all leagues display correctly on feed (mobile + desktop)
- [x] Replace MetaBet with Action Network v1 API for all DK odds (spread, O/U, ML, juice) for NCAAM, NBA, NHL
- [x] Add anSlug field to all 365 NCAAM, 30 NBA, and 32 NHL team registries
- [x] Add BY_AN_SLUG lookup maps and getTeamByAnSlug helpers to all three team registries
- [x] Build actionNetworkScraper.ts using AN v1 API for DK odds (spread, total, ML, awaySpreadOdds, homeSpreadOdds, overOdds, underOdds)
- [x] Build vsinBettingSplitsScraper.ts using data.vsin.com/betting-splits/ for splits only (today + tomorrow)
- [x] Rebuild vsinAutoRefresh.ts to use Action Network for odds and new VSiN scraper for splits
- [x] Add tomorrow's VSiN splits pre-population (runTomorrowSplitsUpdate) in main refresh orchestrator
- [x] Fix NHL live clock: rewrite fetchNhlLiveScores to use /v1/scoreboard/now for period/clock/intermission data
- [x] Add NHL intermission support to frontend clock formatter (1ST INT, 2ND INT, OT INT, Final/OT, Final/SO)
- [x] Confirm DK juice (awaySpreadOdds, homeSpreadOdds, overOdds, underOdds) populated in DB and displayed on Feed
- [ ] Switch AN scraper from v1 API to v2 API to get all 34 NCAAB games with DK odds and opening lines
- [ ] Fix New Mexico vs San Diego St. gameDate (should be 2026-03-14, not 2026-03-13) and TBD start time
- [ ] Add Utah Hockey Club to NHL registry (missing anSlug causing NO_SLUG in logs)
## Action Network HTML Parser Integration (March 14, 2026)
- [x] Build anHtmlParser.ts: parse AN best-odds HTML table to extract DK spread odds for all NCAAB games
- [x] Build tRPC procedure: games.ingestAnHtml (owner-only) to accept spread HTML + totals HTML and apply DK odds to DB
- [x] Add UI panel in PublishProjections for pasting AN HTML (spread + totals pages)
- [x] Add vitest tests for anHtmlParser
- [x] Upgrade to All Markets mode (3 rows per game: spread + total + ML)
- [x] Add 18 new DB schema columns: openAwaySpread, openHomeSpread, openTotal, openOverOdds, openUnderOdds, openAwayML, openHomeML, openAwaySpreadOdds, openHomeSpreadOdds + DK NJ equivalents
- [x] Build IngestAnOdds page at /admin/ingest-an with paste area, date/sport controls, result display
- [x] 21/21 NCAAB games matched and parsed correctly with 0 failures
- [x] 6 vitest tests passing for anHtmlParser

## NBA + NHL AN HTML Parser Extension (March 14, 2026)
- [x] Fetch and deep-parse NBA AN HTML to understand team slug format
- [x] Fetch and deep-parse NHL AN HTML to understand team slug format
- [x] Build NBA slug lookup map (anSlug → dbSlug) in ingestAnHtml procedure
- [x] Build NHL slug lookup map (anSlug → dbSlug) in ingestAnHtml procedure
- [x] Test NBA: 7/7 games matched and parsed correctly
- [x] Test NHL: 14/14 games matched and parsed correctly
- [x] Add vitest cases for NBA and NHL (4 new tests, 10 total passing)
- [x] Fix classifyRow MIN_CELLS threshold for 11-column NBA/NHL tables
- [x] Checkpoint

## Full Pipeline Audit: VSIN ↔ League Site + AN Odds + Splits (March 14, 2026)
- [ ] Deep audit: parse VSiN splits HTML (pasted_content_27) and extract all NCAAB/NBA/NHL games
- [ ] Deep audit: parse NBA.com schedule HTML (pasted_content_28) and extract all NBA games
- [ ] Deep audit: parse NHL.com scores HTML (pasted_content_29) and extract all NHL games
- [ ] Deep audit: parse NCAA.com scoreboard HTML (pasted_content_30) and extract all NCAAB games
- [ ] Cross-reference DB state vs league site: find all unmatched/missing games
- [ ] Fix VSIN ↔ League site matching for NCAAB (slug normalization, missing teams)
- [ ] Fix VSIN ↔ League site matching for NBA (team name normalization)
- [ ] Fix VSIN ↔ League site matching for NHL (team name normalization)
- [ ] Verify AN odds (Open + DK) are mapped to correct away/home fields for all 3 sports
- [ ] Fix any AN odds field inversion issues (away vs home team assignment)
- [ ] Verify betting splits are fetched and stored for all 3 sports
- [ ] Fix splits pipeline for NBA and NHL if not working
- [ ] Verify splits display correctly on GameCard for all 3 sports
- [ ] Full end-to-end test and checkpoint

## Odds/Lines Source Refactor: AN Only (March 14, 2026)
- [x] Remove all VSiN odds/lines scraping — keep only splits scraping in vsinAutoRefresh.ts
- [x] Remove applyActionNetworkOdds and fetchActionNetworkOdds (AN API-based odds) from pipeline
- [x] Fix ingestAnHtml to write DK line to awayBookSpread/homeBookSpread/bookTotal/awayML/homeML + juice fields
- [x] Remove redundant dkAwaySpread/dkHomeSpread/dkTotal/dkAwayML/dkHomeML columns from schema (9 columns dropped)
- [x] Fix GameCard to use awayBookSpread/homeBookSpread as primary display (no DK-specific fallback)
- [x] Fix GameCard TypeScript errors from open/dk line refactor (moved string builders to correct scope)
- [x] Fix OddsLinesPanel second call site to pass open line props
- [x] Fix updateAnOdds to parse spread/total strings to numbers for decimal columns
- [x] 195/196 vitest tests passing (1 pre-existing KenPom env var failure)
- [x] Checkpoint
- [ ] Change NCAAM start times from EST to PST to avoid midnight confusion
- [ ] Keep NBA and NHL start times in EST
- [ ] Update existing DB games with corrected PST start times for NCAAM

- [x] Change NCAAM start times from EST to PST (NCAA scraper uses epochToPt, vsinAutoRefresh uses gameDatePst)
- [x] Keep NBA and NHL start times in EST
- [x] Fix all 21 NCAAM games for March 14 to use correct PST start times from NCAA API epochs
- [x] Move Cal Baptist @ Utah Valley from March 15 to March 14 (correct PST date = March 14 at 8:59 PM PST)
- [x] Remove UNM vs SDSU from March 14 (moved to March 13 per PST calendar date)
- [x] Apply AN odds to all 42 games (21 NCAAM + 7 NBA + 14 NHL) - 42/42 with DK + Open odds
- [x] Apply VSiN splits to all 42 games - 41/42 with splits (Kings @ Clippers late game, splits not yet posted)
- [x] Add gameDatePst field to NcaaGame interface for correct PST calendar date assignment
- [x] Update vsinAutoRefresh to use gameDatePst when inserting NCAAM games
- [x] Update sortGamesByStartTime to remove 00:00 special case (no longer needed with PST)
- [x] Update GameCard.tsx formatMilitaryTime to show PST for NCAAM, EST for NBA/NHL

- [x] Fix Kings vs Clippers missing splits from VSiN HTML provided by user (getNbaTeamByVsinSlug alias resolution fix)
- [x] Fix GameCard height/overflow/truncation - replaced fixed height+overflow:hidden with minHeight so content never clips
- [x] Ensure dynamic scaling for all GameCard content across all leagues and screen sizes (removed all overflow:hidden from desktop layout columns)

- [x] Audit VSiN scraper for March 15 NCAAM/NBA/NHL slate completeness (18/18 games resolved, 0 slug failures)
- [x] Audit Action Network scraper for March 15 Open/DK NJ odds mapping (7/7 NBA resolved, NCAAM/NHL DK not yet posted by DK)
- [x] Run live diagnostic against VSiN tomorrow endpoint for all leagues (5 NCAAM + 7 NBA + 6 NHL = 18 games, all matched)
- [x] Run live diagnostic against Action Network for March 15 odds (7 NBA games with DK odds, all matched)
- [x] Fix Portland Trail Blazers slug mismatch: NBA.com CDN uses "blazers" but registry had "trailblazers" — added NBA_SCHEDULE_SLUG_ALIASES and updated getNbaTeamByNbaSlug()
- [x] Fix Kings vs Clippers missing splits: VSiNAutoRefresh was using NBA_BY_VSIN_SLUG.get() directly instead of getNbaTeamByVsinSlug() — fixed to use alias-aware helper
- [x] Build refreshAnApiOdds() function: auto-populates DK NJ current lines from AN API for all leagues (NBA/NHL/NCAAM) without manual HTML paste
- [x] Wire refreshAnApiOdds() into runVsinRefresh() for both today and tomorrow dates
- [x] Verify all March 15 games have correct splits and odds in DB (5 NCAAM + 7 NBA + 6 NHL all present with splits and DK odds where available)
- [x] Fix DK NJ book ID: was 79 (bet365 NJ), correct is 68 (DK NJ) — fixed in actionNetworkScraper.ts
- [x] Fix Open line book ID: was missing, correct is 30 — added to actionNetworkScraper.ts
- [x] Upgrade actionNetworkScraper.ts to AN v2 scoreboard API (returns ALL games including conference tournament games not in v1 API)
- [x] Add NCAAM_AN_SLUG_ALIASES for v2 API slug differences: wichita-state-shockers, south-florida-bulls, pennsylvania-quakers
- [x] Update getNcaamTeamByAnSlug() to apply NCAAM_AN_SLUG_ALIASES for transparent v1/v2 resolution
- [x] Update refreshAnApiOdds() to use alias-aware getNcaamTeamByAnSlug() for NCAAM slug resolution
- [x] Update refreshAnApiOdds() to pass Open line data (spread, total, ML) through to updateAnOdds()
- [x] FINAL DIAGNOSTIC: 18/18 March 15 games — ALL slugs resolved, ALL DB matched, ALL DK populated, ALL Open populated
- [x] Build OddsCell pill component: rounded rectangle, bold main value + smaller juice below, orange bookmark badge for best-value cell
- [x] Integrate OddsCell into desktop SectionCol BOOK cells (DesktopMergedPanel)
- [x] Integrate OddsCell into desktop OddsLinesPanel BOOK cells
- [x] Integrate OddsCell into mobile OddsTable BOOK cells (full mode)
- [x] Integrate OddsCell MODEL cells with pill style (neon green edge / white non-edge)
- [x] Ensure OddsCell scales seamlessly across all breakpoints (clamp-based sizing)
- [x] DEBUG: Diagnose why DK NJ spread shows wrong value (user reports Dayton +3.5 -118 on DK NJ but app shows different)
- [x] DEBUG: Diagnose why book odds update constantly/dynamically (possibly pulling live-betting lines from AN instead of pre-game)
- [x] FIX: Ensure AN scraper targets only pre-game DK NJ lines, not live/in-game lines
- [x] FIX: Ensure correct book (DK NJ) and correct line type (spread, not live) is being stored and displayed

## AN Odds Pipeline Hardening + Odds History (March 15, 2026)
- [x] Add odds_history table to drizzle schema (gameId, sport, scrapedAt UTC, source, awaySpread, awaySpreadOdds, homeSpread, homeSpreadOdds, total, overOdds, underOdds, awayML, homeML)
- [x] Run db:push to migrate schema
- [x] Build insertOddsHistory() and listOddsHistory() DB helpers
- [x] Freeze odds on game start: skip updateAnOdds() for games with gameStatus='live' or 'final'
- [x] Change AN refresh schedule from 30-min to hourly, 3am–midnight PST
- [x] Write to odds_history on every AN refresh (auto + manual)
- [x] Ensure manual Refresh Now button also writes to odds_history
- [x] Build OddsHistory UI component in Publish Projections (per-game collapsible table, EST timestamps)
- [x] Confirm EST timestamp: DST-aware (10:59am PDT → 1:59pm EDT; 10:59am PST → 1:59pm EST)
- [x] Write vitest tests for odds freeze logic and history insertion
- [x] Save checkpoint

## Publish Projections UX Fixes (March 15, 2026 - Round 2)
- [x] Verify OddsHistoryPanel is visible and functional on every game card in Publish Projections
- [x] Fix OddsHistoryPanel to render correctly (tRPC procedure wired, component placement confirmed)
- [x] Scope "Refresh Now" button to only refresh the active sport tab (NCAAM/NBA/NHL)
- [x] Scope "Publish All" button to only publish games on the active sport tab
- [x] Pass active sport to triggerRefresh tRPC procedure so server only refreshes that sport
- [x] Add deep server-side logging to refresh pipeline (sport-scoped, per-game, freeze detection)
- [x] Add deep server-side logging to publish pipeline (sport-scoped, per-game publish confirmation)
- [x] Add deep client-side logging for Refresh Now and Publish All button actions

## NHL Model Pipeline
- [ ] Write nhl_model_engine.py: Monte Carlo model with NaturalStatTrick + goalie factor
- [ ] Write nhlNaturalStatScraper.ts: scrape team stats from NaturalStatTrick
- [ ] Write nhlGoalieScraper.ts: scrape goalie stats from NaturalStatTrick
- [ ] Write nhlRotoWireScraper.ts: scrape starting goalies from RotoWire
- [ ] Add NHL-specific DB columns: awayPuckLineOdds, homePuckLineOdds, awayStartingGoalie, homeStartingGoalie, modelAwayGoals, modelHomeGoals
- [ ] Run db:push to migrate new NHL columns
- [ ] Write nhlModelEngine.ts: TypeScript wrapper that spawns nhl_model_engine.py
- [ ] Write nhlModelSync.ts: auto-detect new NHL games, run model, store unpublished projections
- [ ] Wire nhlModelSync into vsinAutoRefresh.ts cron (hourly, 3am-midnight PST)
- [ ] Wire nhlModelSync into runVsinRefreshManual (sport-scoped)
- [ ] Extend Publish Projections page to show puck line odds for NHL game cards
- [ ] Ensure Refresh Now and Publish All on NHL tab only trigger NHL pipeline
- [ ] Write vitest tests for NHL model engine and scraper
- [ ] Save checkpoint

## NHL Model Pipeline (Mar 15, 2026)
- [x] Write NHL Monte Carlo model engine Python script (nhl_model_engine.py) — NaturalStatTrick + MoneyPuck + RotoWire data sources
- [x] Build NaturalStatTrick team/player/goalie stats scraper (nhlNaturalStatScraper.ts)
- [x] Build RotoWire starting goalie scraper (nhlRotoWireScraper.ts)
- [x] Build NHL model engine TypeScript wrapper (nhlModelEngine.ts) — stdin/stdout JSON bridge
- [x] Extend DB schema with NHL-specific fields (awayGoalie, homeGoalie, awayGoalieConfirmed, homeGoalieConfirmed, modelAwayPLCoverPct, modelHomePLCoverPct)
- [x] Run db:push to migrate NHL-specific columns
- [x] Build nhlModelSync.ts: auto-detect new games, run model, store unpublished projections
- [x] Wire nhlModelSync into server startup (_core/index.ts)
- [x] Wire runVsinRefreshManual to call syncNhlModelForToday when NHL is in scope
- [x] Update Publish Projections: show PUCK LINE label instead of SPREAD for NHL
- [x] Update Publish Projections: show goalie names (confirmed=green, projected=amber) below team names for NHL
- [x] Update Publish Projections: show puck line odds in Book column for NHL
- [x] Update Publish Projections: show PL Odds column header instead of Book ML for NHL
- [x] Ensure Refresh Now and Publish All on NHL tab only operate on NHL data
- [x] Write 24 vitest tests for NHL model pipeline (puck line odds, goalie adj, cover pct, sport-scoping, freeze detection)

## NHL Sharp Line Origination Engine Rewrite (Mar 15, 2026)
- [ ] Rewrite nhl_model_engine.py: correlated NB distributions (k=7-10, rho=0.12-0.18), 200k sims
- [ ] Implement OFF_rating (xGF60 0.40, HDCF60 0.20, Rush60 0.15, Rebounds60 0.10, ShotAttempts60 0.15)
- [ ] Implement DEF_rating (xGA60 0.40, HDCA60 0.25, RushAllowed 0.20, SlotShots 0.15)
- [ ] Implement goalie_multiplier = 1 - (GSAX / shots_faced), typical range 0.92-1.08
- [ ] Implement fatigue factors (normal=1.00, 1-day=0.97, B2B=0.94)
- [ ] Implement home_ice = 1.04
- [ ] Implement pace_factor from combined shot rate
- [ ] Ensure ML/PL/total all derive from same joint distribution (no independent estimation)
- [ ] Update nhlNaturalStatScraper.ts to supply Rush60, Rebounds60, SlotShots, HD Save%, workload
- [ ] Update nhlModelEngine.ts to pass new input fields
- [ ] Update nhlModelSync.ts to pass new scraped fields to model
- [ ] Verify model output consistency constraints (Section 11)
- [ ] Run tests, verify engine produces correct output, save checkpoint

## NHL Improvements (Mar 15 2026 - Round 2)
- [ ] Add Puck Line odds input (awayPLOdds, homePLOdds) and Over/Under odds inputs (overOdds, underOdds) to NHL game cards in Publish Projections
- [ ] Upgrade edge detection in nhl_model_engine.py to full probability-space engine (Sections 1-12 pseudocode): implied prob → no-vig → model prob → EV → edge classification for ML, PL, Total
- [ ] Wire real rest-days from last game date into fatigue multiplier in nhlModelSync.ts
- [ ] Add RotoWire injury feed check: poll for goalie scratches every 30 min, auto-update DB goalie fields, re-run model if starter is scratched

## Current Sprint (Mar 15, 2026)
- [x] Add awayPLOdds/homePLOdds state + input fields to EditableGameCard PUCK LINE section (NHL only)
- [x] Add overOdds/underOdds state + input fields to EditableGameCard TOTAL section (NHL only)
- [x] Wire NHL odds inputs into handleSave, handleReset, computeEdges
- [x] Implement industry-grade Sharp Edge Detection Engine in nhl_model_engine.py (distribution-translated, vig-removed, EV + classification)
- [x] Build 10-minute RotoWire goalie auto-check cron (nhlGoalieWatcher.ts)
- [x] Parse RotoWire lineups page for goalie name + status (Confirmed/Expected)
- [x] Compare scraped goalies vs DB; if confirmed starter changed, update DB + re-run NHL model
- [x] Register goalie watcher in server startup + add tRPC procedures for manual trigger
- [ ] Wire real rest days into fatigue multiplier (days since last game from schedule)

## Sprint Mar 15, 2026 — Part 2

- [x] Build Hockey Reference schedule scraper (nhlHockeyRefScraper.ts) — parse https://www.hockey-reference.com/leagues/NHL_2026_games.html for all game dates by team
- [x] Wire rest-days (days since last game) into nhlModelSync.ts and pass to Python model engine as away_rest_days / home_rest_days
- [x] Fix nhlModelSync.ts team abbrev resolution — use NHL_BY_DB_SLUG instead of .toUpperCase() (was silently failing for TBL, CBJ, NJD, NYI, NYR, LAK, SJS, VGK)
- [x] Add Utah Hockey Club AN slug alias (utah-hockey-club → utah_mammoth) in nhlTeams.ts + use getNhlTeamByAnSlug helper in vsinAutoRefresh.ts
- [x] Audit AN NHL scraper — confirmed all markets (PL, total, ML) and both books (Open + DK NJ) are captured and written to DB correctly
- [x] Display goalie name + confirmed/expected status below each team name in NHL Publish Projections game cards (desktop + mobile)
- [x] Add Goalie Watcher last-check timestamp + change count + model re-run indicator to NHL stats bar
- [x] Trigger goalie watcher check when "Refresh Now" is clicked while NHL tab is active
- [x] Write 30 unit tests for all new NHL features (rest days, abbrev resolution, Utah alias, americanOddsToBreakEven, matchGameToDb) — all passing

## Sprint Mar 15, 2026 — Part 3 (NHL Auto-Model + Goalie Fix)

- [ ] Fix nhlRotoWireScraper.ts: use .lineup__player-highlight selector, extract full goalie name from .lineup__player-highlight-name a, status from .is-confirmed/.is-expected class
- [ ] Fix RotoWire team abbrev extraction: use .lineup__abbr (is-visit = away, is-home = home) not the advanced-lineups approach
- [ ] Auto-trigger NHL model immediately when both goalies are populated for a game (in goalie watcher + on server startup)
- [ ] nhlModelSync.ts: on startup, run model for all today's NHL games that have both goalies but no modelRunAt
- [ ] Ensure every game card in Publish Projections shows goalie name + confirmed/expected status
- [ ] Fix goalie watcher to use correct HTML selectors matching pasted_content_21.txt structure

## NHL Pipeline Fixes (2026-03-15)
- [x] Fix NST goalie stats URL: goaliestats.php (404) → playerteams.php?stdoi=g
- [x] Fix NST team name normalization: full names ("Chicago Blackhawks") → 3-letter abbrevs ("CHI")
- [x] Fix NST dot-notation codes: N.J → NJD, S.J → SJS, T.B → TBL, L.A → LAK
- [x] Add vitest tests for normalizeAbbrev (8 tests, all passing)
- [x] Implement new puck line origination engine in Python model (Sections 1-9 of spec)
- [x] Implement new Total Origination Engine (compute_pace_factor, fix NoneType SA_60 bug)
- [x] Fix NoneType + NoneType bug in compute_pace_factor (SA_60 None handling)
- [x] Fix RotoWire goalie watcher: ensure all current-day NHL games show goalie names with confirmed/expected status
- [x] Verify full NHL model pipeline: real NST stats used, valid puck lines produced, goalie data populated
- [x] Display model puck line odds on Publish Projections page (e.g., -1.5 (-115) / +1.5 (+105))
- [x] Display model total odds on Publish Projections page (e.g., 6.5 O(-110) / U(-110))
- [x] Fix GoalieWatcher to process ALL games on RotoWire (live + final + upcoming), not just upcoming
- [x] Add schema columns: modelAwayPLOdds, modelHomePLOdds, modelOverOdds, modelUnderOdds, modelPuckLineSpread
- [x] Add vitest tests for GoalieWatcher (12 tests passing)
- [x] Display model puck line odds on public feed GameCard for NHL games
- [x] Display model total odds on public feed GameCard for NHL games

## NHL Model Improvements (2026-03-15 Session 2)
- [x] Display model puck line odds on public feed GameCard for NHL games (MODEL LINES column)
- [x] Display model total odds on public feed GameCard for NHL games (MODEL LINES column)
- [ ] Auto-trigger model run when both goalies are populated (GoalieWatcher + server startup)
- [ ] Add goalie confirmed/expected status badges to Publish Projections NHL game cards
- [ ] Rewrite NHL model engine: single Monte Carlo simulation core (N=50000 trials)
- [ ] All markets (ML, PL, O/U) derived from same simulation distribution
- [ ] Remove all separate calculation paths (no spread = expected_home - expected_away)
- [ ] Verify mathematically consistent outputs: ML/PL/total all from same sim
- [ ] Expand NST scraper to pull HDCF%, SCF%, HDCF/60, HDCA/60, Rush/60, RushA/60, Reb/60, Slot Shots for all teams
- [ ] Update NhlTeamStats type and DB schema with all new columns
- [ ] Remove fallback paths in compute_off_rating and compute_def_rating - require all fields
- [ ] Run DB migration and force model re-run with complete data
- [x] Fix goalie multiplier: Bayesian regression (K=500) prevents tiny-sample backups from dominating (Brossoit 1 GP: 1.106 → 1.004)
- [x] Add 6 new vitest tests for Bayesian goalie multiplier regression behavior (308 total passing)
- [x] Raise edge detection thresholds: ML=5pp, PL=6pp, Total=8pp to reduce noise
- [x] Re-run all 6 March 15 NHL games with corrected goalie model
- [ ] Fix total edge direction: book u6.5 +114 vs model u6.5 -118 should flag UNDER edge, not OVER
- [ ] Fix puck line model odds: +468/+155 are wildly wrong (should be realistic ±1.5 cover probabilities)
- [ ] Add nightly league-average recalibration cron job (scrape NST each morning, update engine constants)
- [ ] Add C3 violation alerts to Publish Projections admin panel (P(home-1.5) > P(home_win) flag)
- [ ] Full audit: NHL puck line odds calculation (Python engine) - mkt_pl_away_odds bug
- [ ] Full audit: NHL total odds calculation and edge direction (Python engine + GameCard)
- [ ] Full audit: NHL moneyline odds calculation (Python engine)
- [ ] Full audit: DB storage of model odds (nhlModelSync writes)
- [ ] Full audit: GameCard display of all NHL model values across all 3 panels
- [ ] Fix all identified bugs in puck line, total, ML calculations and display
- [x] Fix NHL puck line mkt_pl computation: favorite-aware logic (away-fav games were computing P(home wins by 2+) instead of P(away wins by 2+))
- [x] Fix NHL puck line edge detection: same favorite-aware fix applied to edge detection section
- [x] Fix NHL model spread display: modelAwayPuckLine/modelHomePuckLine now mirrors book spread (not model origination)
- [x] Fix NHL total edge direction: GameCard now uses model odds at book line to determine over/under edge direction
- [x] Fix ML vs puck line mathematical inconsistency: WPG ML=+106 (48.6% win) but WPG -1.5 puck line=-273 (73% cover) — impossible, team with 48.6% win rate cannot be 73% to win by 2+
- [x] Fix puck line favorite assignment: team with more negative ML should always be at -1.5; derive book spread from ML odds not spread field (STL -112 ML = STL is -1.5 favorite, not WPG)
- [x] NHL puck line fallback: when DK gives ML favorite a +1.5 spread, use FanDuel spread instead (if both DK and FD give +1.5 to ML fav, keep DK as-is)
- [ ] NHL puck line consensus: use DK + Open majority vote to determine -1.5 favorite (not ML-based); FD is outlier for STL@WPG
- [ ] NHL puck line best odds: display best available odds between DK NJ and FD NJ for each side of the puck line
- [ ] Revert NHL puck line to DK NJ only — remove FD fallback and ML-based override, use DK spread as-is
- [x] Fix STL@WPG spread: DK NJ has WPG Jets -1.5 (+235), STL Blues +1.5 (-290) — DB corrected + model re-run + edge label fix
- [x] Audit Python engine edge detection: verify model implied prob > book break-even prob for ML, PL, total
- [x] Fix any incorrect edge direction logic in Python engine
- [x] Add deep diagnostic logging for all edge calculations (break-even, implied prob, edge pp, verdict)
- [x] Fix mobile odds cell overlap: redesign OddsCell to two-line dark card style (line value top white, odds bottom neon green), fix grid spacing
- [x] Fix 1: One sticky global column header (SPREAD/TOTAL/ML + BOOK/MODEL sub-labels) — remove per-card headers
- [x] Fix 2: Collapse FINAL/LIVE status into card top-left — remove full-width status row
- [x] Fix 3: Remove green borders from MODEL cells — color-only distinction (bright green text, dark cell, no border)
- [x] Fix 4: Bind score tightly to team name — same row, adjacent, brand green when live
- [x] Fix 5: Add Edge Badge as rightmost column on each game card
- [x] Rename MDL → MODEL everywhere in UI
- [x] Implement calculateEdge/getVerdict/getEdgeColor helpers in GameCard.tsx (juice-only math, per-market independent)
- [x] Redesign EdgeBadge: 3 stacked rows (SPR/O/U/ML) with verdict label + pp value, dynamic bg/border from bestEdge
- [x] Apply BettingCell color grammar: line=white/75% 400 11px, juice=white/90% or neon green 700 18px
- [x] Wire all three market edges from juice numbers (not string parsing), recalculate on every render
- [x] Shrink left panel to 80px — keep logo (20px) and star button (compact 10px)
- [x] Show abbreviation-only team name (e.g. "STL") + score on same row in left panel
- [x] Replace circular sub-cells with flat 2-column BettingCell grid (BK/MDL headers, line, juice rows)
- [x] Equalize all 3 market columns to flex-1 (SPREAD/TOTAL/ML identical width)
- [x] EdgeBadge fixed at 60px (w-[60px] shrink-0)
- [x] Outer row: gap-[4px] to fit 375px screen budget
- [x] Make team logos bigger in left panel (from 20px to 28px)
- [x] Use city abbreviations instead of team abbreviations (NHL: official abbrev e.g. "NSH", "EDM")
- [x] Spell out BOOK and MODEL in BettingCell header (not BK/MDL)
- [x] Edge-conditional neon green: only MODEL juice is green when that side has an edge; both white if no edge
- [x] Add empty spacer row above ML odds to align with SPREAD/TOTAL line row height
- [x] Run NHL model for all 5 March 16 2026 games manually
- [x] Post all 5 NHL model projections to the main feed (publishedModel=1 for all 5 games)
- [x] Wire automatic daily NHL model execution (scheduler every 30min 9AM-9PM PST, auto-approve after each run)

## UI/Discord Fixes (March 18, 2026)
- [x] Fix Discord /auth/discord/connect 404 on production — moved all routes to /api/auth/discord/* (Manus proxy only forwards /api/* to Express)
- [x] Deep-audit route registration chain: confirmed routes registered before serveStatic catch-all
- [x] Add granular checkpoint logging at every layer of Discord OAuth flow (CHECKPOINT:1-9, A-C)
- [x] Verify production build includes Discord routes (confirmed in dist/index.js at line 3184)
- [x] Test Discord OAuth end-to-end on dev server — all 3 routes respond correctly
- [x] Update frontend ModelProjections.tsx to use /api/auth/discord/* URLs
- [x] Add route prefix invariant tests to discordAuth.test.ts (6 new tests, all passing)
- [x] Update Discord Developer Portal redirect URI to https://aisportsbettingmodels.com/api/auth/discord/callback
- [x] Fix redirect_uri construction: x-forwarded-host resolves to internal Cloud Run hostname (*.a.run.app) not public domain
- [x] Added PUBLIC_ORIGIN env var (set to https://aisportsbettingmodels.com) — used as canonical origin for redirect_uri
- [x] Add deep CHECKPOINT:1-10 + A-C logging at every step of OAuth flow including all proxy headers
- [x] Add PUBLIC_ORIGIN invariant tests (3 new tests: value set, no trailing slash, exact callback URL match)
- [x] Confirmed PUBLIC_ORIGIN=SET in dev server startup log
- [ ] Test Discord OAuth end-to-end on published site after publishing
- [x] Check callback logs to confirm DB write succeeded — DB columns exist and updateAppUser call is correct
- [x] Add Discord Status column to User Management table (Connected/Not Connected badge with Discord logo)
- [x] Add Discord Username column to User Management table (@username in Discord purple or —)
- [x] Verified header button shows @discordUsername when discordId is set, Connect Discord when null
- [x] Added discord_linked/discord_error URL param handler in ModelProjections.tsx — force-refetches appUsers.me and shows toast
- [x] Updated colSpan from 9 to 10 for loading/empty state rows in UserManagement table
- [x] Hard-lock EDGE ROI footer in GameCard - remove EDGE column rendering permanently
- [x] Ensure edge footer shows for all sports (NHL, NBA, NCAAM) in MODEL PROJECTIONS

## Discord DB-Backed State Fix (March 18, 2026)
- [x] Root cause identified: in-memory CSRF state fails across Cloud Run instances (state_mismatch)
- [x] Add discord_oauth_states table to schema (state, userId, expiresAt, createdAt)
- [x] Run db:push to migrate discord_oauth_states table to production DB
- [x] Rewrite discordAuth.ts: DB-backed state storage (insert on /connect, lookup+delete on /callback)
- [x] Add exhaustive CHECKPOINT:1-11 + A-C logging at every step of the OAuth flow
- [x] Add DB write verification in CHECKPOINT:10 (read-back after updateAppUser to confirm write)
- [x] Add cleanup of expired states on each /connect and /callback request
- [x] Write test-discord-connect.ts: verifies JWT → /connect → DB state row inserted → correct redirect_uri
- [x] Write test-discord-callback.ts: verifies DB state lookup → token exchange → state consumed
- [x] Both test scripts PASS: state_mismatch eliminated, token_exchange_failed on fake code (expected)
- [x] TypeScript: 0 errors. 23/23 Discord tests passing.
- [ ] Test Discord OAuth end-to-end on published site after publishing

## Discord Button Branding & One-Time Lock (March 18, 2026)
- [x] Restyle Discord button: solid #738ADB bg, white text, GG Sans font, Discord SVG logo — no opacity/transparency
- [x] Not connected state: Discord logo + "CONNECT DISCORD" (white, GG Sans, read-only link to /api/auth/discord/connect)
- [x] Connected state: Discord logo + "@DISPLAYNAME" (white, GG Sans, read-only div — no click, no disconnect)
- [x] Remove all user-facing disconnect options from ModelProjections.tsx (confirmed by test)
- [x] Remove disconnect mutation call from frontend (users cannot disconnect their own Discord)
- [x] Add owner-only Disconnect button in User Management table (Discord logo icon, hover Discord purple)
- [x] Add appUsers.adminDisconnectDiscord ownerProcedure on server (clears discordId/Username/Avatar/ConnectedAt)
- [x] Load GG Sans woff2 fonts via @font-face in index.html (CDN-hosted, 4 weights: 400/500/600/700)
- [x] Apply GG Sans to Discord button only via inline fontFamily style (not global font change)
- [x] Updated discordAuth.test.ts: replaced disconnect URL test with one-time-only policy invariant test
- [x] TypeScript: 0 errors. 331/332 tests passing (1 pre-existing KenPom env var test)

## Discord Button Color Fix & Uniqueness Enforcement (March 18, 2026)
- [x] Change Discord button color from #738ADB to #3238a9 (darker, richer blue)
- [x] Ensure mobile shows full text: CONNECT DISCORD or @DISPLAYNAME (removed hidden sm:inline, always visible)
- [x] Server-side uniqueness check already implemented at CHECKPOINT:9 (already_linked redirect)
- [x] Added comprehensive error messages map: already_linked shows clear "Each Discord account can only be connected to one account" message
- [x] One-time-only connection policy intact: no user disconnect option, owner-only in User Management

## Mobile Header Layout Fix (March 18, 2026)
- [x] Fix PREZ BETS title overlapping CONNECT DISCORD button on mobile
- [x] Removed absolute centering (absolute left-1/2 -translate-x-1/2) — replaced with left-aligned flex item
- [x] PREZ BETS left-aligned, Discord button + user icon right-aligned via flex-1 spacer
- [x] Dynamic font scaling via clamp(12px, 3.5vw, 18px) for brand text, clamp(14px, 3.5vw, 20px) for icon
- [x] TypeScript: 0 errors

## March Madness Focus (March 2026)
- [x] Rename NCAAM → MARCH MADNESS in all UI labels (tabs, headers, subtitles)
- [x] Create MARCH_MADNESS_TEAMS allowlist (68 bracket teams) in shared/marchMadnessTeams.ts
- [x] Filter NCAAM feed to only show March Madness bracket teams
- [x] Populate First Four games (PV A&M vs Lehigh, Miami OH vs SMU) with VSiN odds/splits
- [x] Publish First Four games to feed
- [x] Ensure auto-refresh pipeline only ingests March Madness games going forward (VSiN scraper accepts all D1; feed API filters to bracket teams only)
- [x] Cross-reference First Four game odds (VSiN vs Action Network) for PV A&M vs Lehigh and Miami OH vs SMU

## March Madness Full Feed Audit (March 18, 2026)
- [x] Identify and fix 2 missing Round of 64 games — confirmed 30 R64 in DB + 2 TBD (FF-dependent, not yet in DB)
- [x] March 17 First Four games (UMBC vs Howard, Texas vs NC State) — already played, not added (daily purge would delete them; historical only)
- [x] VSiN has not yet posted R64 odds (March 19-20 games) — auto-refresh will pick them up as they go live
- [x] Publish BYU vs Texas and Howard vs Michigan (R64 games with complete odds+splits) — published ✅
- [x] Unpublish 4 non-bracket contaminating games (navy/wake_forest, dayton/bradley, george_washington/utah_valley, sam_houston_st/new_mexico)
- [x] isValidGame filter in routers.ts confirmed working — blocks all non-bracket NCAAM teams at API layer
- [x] Re-run full audit — confirmed: 4 games on feed (2 FF + 2 R64), all with complete odds+splits, zero contamination

## Bracket Region Verification (March 18, 2026)
- [x] EAST region (8 games) verified against NCAA.com HTML — all 8 match DB
- [ ] SOUTH region (8 games) verified against NCAA.com HTML
- [ ] WEST region (8 games) verified against NCAA.com HTML
- [ ] MIDWEST region (8 games) verified against NCAA.com HTML

## Bracket Fixes (2026-03-19)
- [x] Fix bracket advancement: TCU won (66 vs Ohio St. 64) but has not advanced to next round slot
- [x] Fix team row layout: logos must only appear on the LEFT side; scores must appear on the RIGHT side (remove right-side logo circles)
- [x] Audit all completed March 19 R64 games and auto-advance winners to R32 slots
- [x] Ensure bracket advancement is fully automated (score refresh triggers advancement)

## March 20 Model Runs (2026-03-20)
- [x] Model and publish game 1: Santa Clara @ Kentucky (09:15 EST) — spread +2.0/-2.0, total 150.0, MOD edges on spread+total
- [x] Model and publish game 2: Akron @ Texas Tech (09:40 EST) — spread +8.0/-8.0, total 150.5, LOW edge on total UNDER
- [x] Model and publish game 3: LIU Brooklyn @ Arizona (10:35 EST) — spread +27.0/-27.0, total 143.5, HIGH edges on spread+total

## March 20 Model Runs — Games 4–8 (2026-03-20)
- [x] Model and publish game 4: Wright St. @ Virginia (10:50 EST) — spread +15.5/-15.5, total 141.5, LOW edges on spread+total UNDER
- [x] Model and publish game 5: Tennessee St. @ Iowa St. (11:50 EST) — spread +22.5/-22.5, total 142.5, MOD edges on spread+total UNDER
- [x] Model and publish game 6: Hofstra @ Alabama (12:15 EST) — spread +10.0/-10.0, total 153.0, MOD edges on spread+total UNDER
- [x] Model and publish game 7: Utah St. @ Villanova (13:10 EST) — spread -0.5/+0.5, total 143.0, LOW edge on total UNDER
- [x] Model and publish game 8: Miami OH @ Tennessee (13:25 EST) — spread +11.5/-11.5, total 144.0, MOD edge on total UNDER

## March 20 Model Runs — Remaining Games (2026-03-20)
- [x] Publish game 9: Iowa @ Clemson (15:50) — spread -1.5/+1.5, total 131.0, no edges
- [x] Publish game 10: N. Iowa @ St. John's (16:10) — spread +8.0/-8.0, total 128.0, LOW spread edge
- [x] Publish game 11: UCF @ UCLA (16:25) — spread +4.5/-4.5, total 149.0, no edges
- [x] Publish game 12: Queens NC @ Purdue (16:35) — spread +22.0/-22.0, total 159.0, LOW spread edge
- [x] Publish game 13: Prairie View A&M @ Florida (18:25) — spread +30.5/-30.5, total 148.5, HIGH edges
- [x] Publish game 14: Cal Baptist @ Kansas (18:45) — spread +11.5/-11.5, total 134.5, HIGH edges
- [x] Publish game 15: Furman @ Connecticut (19:00) — spread +18.5/-18.5, total 134.5, LOW total edge
- [x] Publish game 16: Missouri @ Miami FL (19:10) — spread +3.5/-3.5, total 145.0, LOW total edge
- [x] Fix date for 4 games incorrectly tagged as March 20 (Michigan St, TCU, Nebraska, Arkansas) — moved to 2026-03-21 with correct VSiN lines
- [x] Trigger model watcher for 2026-03-21 — modeled 7 games (Michigan St, TCU, Nebraska, Arkansas, Saint Louis, VCU, Liberty)
- [x] All 16 March 20 NCAAM games: published=16/16, modeled=16/16

## Bracket Tab Full Overhaul (2026-03-20)
- [x] Teams must STAY in R64 slot with final scores; loser dimmed, winner highlighted — do NOT remove teams from R64
- [x] Winners correctly populate R32/R16/E8/F4/Championship slots
- [x] Connector SVG lines: gapless, no disconnected matchups in any region
- [x] Zoom/scroll/pan: fully functional on mobile, tablet, desktop
- [x] Responsive scaling: correct bracket sizing across all screen sizes
- [x] Full audit: all regions (SOUTH, EAST, MIDWEST, WEST), all rounds, all scores accurate
- [x] Debug logging: bracket data flow from DB → component → render
- [x] Re-insert 16 missing R64 games + 4 First Four games deleted by daily purge
- [x] Protect bracket games from daily purge (bracketGameId IS NOT NULL exclusion in deleteOldGames)
- [x] Auto-scale on load: bracket fits viewport width after data loads (useLayoutEffect + setTimeout 300ms)
- [x] Auto-scale re-runs on window resize

## Bracket Mobile Fix (2026-03-20)
- [ ] Fix auto-scale not firing on mobile (375px viewport) — bracket renders at full 2012px width- [x] Fix auto-scale on mobile — ResizeObserver on bk-layout to read offsetWidth (not scrollWidth inside overflow:hidden)
- [x] Fix touch zoom/pan — pinch-to-zoom and drag-to-pan on iOS Safari
- [x] Fix page scroll conflict — bracket container must capture touch events without blocking page scroll
- [x] Fix bracket container height on mobile — must fill viewport without overflow
- [x] Ensure transform-origin is top-left so scaled bracket starts at top-left corner of bracket canvas on all screen sizes (mobile, tablet, desktop)

## Bracket Connector Audit (2026-03-20)
- [ ] Deep debug connector logic: inject articulate logging for all card positions, midpoints, path coordinates
- [ ] Fix connector gaps: every R64→R32→S16→E8 transition must be gapless in all 4 regions
- [ ] Fix RTL connector direction: WEST and MIDWEST regions connect right-to-left correctly
- [ ] Verify connector scaling: paths are drawn in the wrap coordinate space (unaffected by canvas scale transform)
- [ ] Verify connector redraw fires after auto-scale changes the canvas transform

## Bracket Connector Full Fix (2026-03-20)
- [ ] Fix drawConnectors: use cy(tgt) as yMid convergence point (not midpoint of source cards)
- [ ] Fix R64→R32→S16→E8 connectors in all 4 regions (28 transitions, max 40.1px offset)
- [ ] Fix E8→Final Four connectors (LTR E8 right edge → FF left; RTL E8 left edge → FF right)
- [ ] Fix Final Four→Championship connectors (FF top/bottom cards → Champ center)
- [ ] Verify all transitions ≤1px offset after fix

## Bracket Layout Redesign — Championship Dead Center (2026-03-20)
- [ ] Championship card must be in the absolute dead center of the bracket canvas
- [ ] Work backwards: FF cards flank Championship left/right, E8 cards flank FF, S16 flank E8, R32 flank S16, R64 outermost
- [ ] All connectors radiate inward from R64 → R32 → S16 → E8 → FF → Championship
- [ ] EAST and SOUTH regions on the LEFT half (LTR), WEST and MIDWEST on the RIGHT half (RTL)
- [ ] Vertical centering: Championship at vertical midpoint, regions stacked above/below

## Bracket Spacing / Overlap Fix (2026-03-20)
- [ ] Compute mathematically exact layout: no overlap, no clamping, consistent gaps across all rounds
- [ ] Championship at exact dead center (y = layoutHeight / 2)
- [ ] FF cards equidistant above/below Championship, not overlapping E8 cards
- [ ] R64 gaps computed from card height so no cards overlap within a column
- [ ] R32/S16/E8 gaps computed as 2x/4x/8x the R64 gap (standard bracket doubling)
- [ ] ROUND_PAD values computed so card[0] center aligns with its feeder midpoint
- [ ] All connector paths arrive at exact card center-Y (no offset)

## Discord Splits Card Quality Improvements (2026-03-24)
- [x] Embed Barlow Condensed fonts as base64 data URIs in splits_card.html (no CDN dependency)
- [x] Fix center header readability: "@" symbol bright white (30px bold), league/time/date fully visible
- [x] Fix JS syntax error in onerror handler (use global logoErr() function instead of inline code)
- [x] Enable 2x device pixel ratio rendering (--force-device-scale-factor=2) for maximum sharpness
- [x] Use scale:"device" in Playwright screenshot for crisp 2x output

## Discord Splits Card v2 (2026-03-24)
- [x] Remove "NBA · DAILY BETTING SPLITS" subtitle from center header (keep @ symbol, time, date only)
- [x] Fix Over color to #39FF14 (neon green), Under color to #FF1818 (bright red)
- [x] Add sport filter option to /splits command: NBA, NHL, NCAAM, ALL
- [x] Add game selection option: ALL (post all games) or individual game picker (select one game)
- [x] Update fetchAllDailySplits to accept optional sport parameter
- [x] Wire autocomplete handler in bot.ts for game picker
- [x] Re-register Discord slash command with new sport/game/date options

## Discord Splits Card v3 (2026-03-24)
- [x] Remove Discord header text message ("📊 Daily Betting Splits — ...") from /splits posts
- [x] Increase card canvas width 820px → 1100px for higher resolution output
- [x] Increase Playwright viewport 860px → 1160px
- [x] Make city names significantly bigger: 22px → 30px
- [x] Make team nicknames bigger: 11px → 15px
- [x] Make team logos bigger: 54px circle → 80px circle, 38px image → 58px image
- [x] Increase overall card padding and spacing for premium feel
- [x] Increase market section fonts: labels 12px → 16px, line values 26px → 36px, bars 26px → 34px

## Discord Splits Card Logo Fix (2026-03-24)
- [x] Debug onerror handler: ROOT CAUSE = inline onerror with double-quoted style string broke HTML attribute parsing, leaking fallback text as DOM content
- [x] Fix logoHTML function: removed inline onerror entirely, use hidden .abbr-fallback span + JS addEventListener after DOM build
- [x] Verified fix with GSW/DAL logos: images load cleanly (naturalWidth=500), fallback span stays display:none
- [x] Rebuilt splits_card.html v4 with corrected logo rendering

## Remove March Madness Bracket (2026-03-24)
- [x] Remove Bracket tab from navigation/sidebar (FEED_TABS, bracket pill button)
- [x] Delete MarchMadnessBracket.tsx page component permanently
- [x] Remove /bracket route and MarchMadnessBracket import from App.tsx
- [x] Remove bracket type from FeedMobileTab, GameCard props, VirtualizedGameList
- [x] Remove CDN_MARCH_MADNESS constant and March Madness icon from nav pill
- [x] NCAAM pill now shows plain text label with no icon

## Sport Tab Auto-Hide (2026-03-24)
- [x] Add tRPC procedure games.activeSports returning which sports have games today or tomorrow (UTC)
- [x] Add getActiveSports() helper to db.ts using groupBy query on gameDate + sport
- [x] Update ModelProjections.tsx to query activeSports and hide pills with no upcoming games
- [x] Auto-switch selected sport if current sport becomes hidden (fallback: NHL → NBA → NCAAM)
- [x] Pills show during loading (activeSports undefined) to avoid flash of empty nav

## NCAAM Tab Visibility Bug (2026-03-24)
- [x] Debug: ROOT CAUSE = getActiveSports counted unpublished regular season NCAAM games (wichita_st@tulsa, st_josephs@new_mexico) that have odds but publishedToFeed=0 and no bracketGameId
- [x] Fix: NCAAM now requires bracketGameId IS NOT NULL — only March Madness bracket games trigger the tab
- [x] Verified: [activeSports] log confirms NCAAM=false when no bracket games exist today/tomorrow

## Discord Splits Card Total Bar Colors (2026-03-24)
- [x] Over bar: now uses CSS var(--away-primary) — matches away team color
- [x] Under bar: now uses CSS var(--home-primary) — matches home team color
- [x] Verified via test render: MIL(green) Over / LAC(blue) Under display correctly

## /splits Command Channel Targeting (2026-03-24)
- [ ] Audit splitsCommand.ts: find where target channel is set (hardcoded vs interaction.channelId)
- [ ] Update execute() to post cards to interaction.channelId (the channel where /splits was run)
- [ ] Add detailed logging: log channelId, gameCount, and per-card success/failure
- [ ] Verify TypeScript compiles cleanly

## /splits Channel Targeting + NYI/NYR Fix (2026-03-24)
- [x] Fix stray backtick syntax error on summary line in splitsCommand.ts (auto-fixed by file tool)
- [x] /splits posts to interaction.channelId (channel where command was run) — removed hardcoded SPLITS_CHANNEL_ID
- [x] Deep debug NYI/NYR splits loading failure:
      ROOT CAUSE: vsinAutoRefresh.ts used raw NHL_BY_VSIN_SLUG.get(g.awayVsinSlug) without applying
      VSIN_NHL_HREF_ALIASES first. VSiN page sends "ny-islanders" and "ny-rangers" but the map
      is keyed on "new-york-islanders" and "new-york-rangers". Silent miss = NULL splits every time.
- [x] Fix: added resolveNhlVsinSlug() helper that applies VSIN_NHL_HREF_ALIASES before map lookup
- [x] Replaced both raw NHL_BY_VSIN_SLUG.get() call sites (today + tomorrow blocks) with resolveNhlVsinSlug()
- [x] Added detailed alias-resolution logging to confirm matches in server logs
- [x] Zero raw NHL_BY_VSIN_SLUG.get() calls remain in the codebase
- [x] Future aliases: add to VSIN_NHL_HREF_ALIASES in shared/nhlTeams.ts only — no code changes needed elsewhere

## Discord Splits Card Team Name Fix (2026-03-24)
- [x] Audit how city/nickname are passed to splits card template (buildCardData in splitsCommand.ts)
- [x] Fixed city/nickname for all NHL/NBA multi-word teams: added city+nickname fields to TeamEntry interface,
      populated from NHL_TEAMS/NBA_TEAMS shared registries (which already have city/nickname),
      fetchSplits.ts now passes away_city/away_nickname/home_city/home_nickname,
      splitsCommand.ts uses these directly instead of splitTeamName() — no more wrapping bugs
- [x] Ensure city line never wraps (single line always) — verified in test renders
- [x] Ensure nickname line never wraps (single line always) — verified in test renders
- [x] Test render VGK, CBJ, TOR, GSW, OKC cards to verify correct display — all confirmed working

## Production ENOENT Fix (2026-03-24)
- [x] Fixed ENOENT: splits_card.html not found in production (/usr/src/app/dist/splits_card.html)
      Root cause: esbuild bundles TS into dist/index.js but never copies static assets.
      In prod, import.meta.url = dist/index.js so __dirname = dist/, but splits_card.html was only in server/discord/.
      Fix: updated build script in package.json to cp splits_card.html, model_v10_engine.py, nhl_model_engine.py to dist/ after esbuild.
      All three files now present in dist/ after build. Verified build output.

## Discord Bot "Application Did Not Respond" Fix (2026-03-24)
- [x] Audit full interaction handling chain: bot.ts, splitsCommand.ts, defer/timeout logic
- [x] Identified root cause: Discord gateway duplicate delivery — same interaction ID delivered twice;
      second delivery hits deferReply on already-acknowledged interaction → throws → outer catch
      tries interaction.reply() but interaction is in broken state → Discord sees no valid response
- [x] Implemented guaranteed immediate deferReply at very top of handleSplitsCommand (before auth check)
      wrapped in try/catch: if deferReply fails (duplicate), bail out immediately with no further action
- [x] Moved access control AFTER deferReply so unauthorized users get editReply (not reply)
- [x] Added interaction deduplication guard in bot.ts: tracks seen interaction IDs for 10s,
      drops duplicates before they reach the command handler
- [x] Added interaction ID to all log lines for full traceability
- [x] Improved outer catch in bot.ts: checks deferred/replied state before choosing editReply vs reply
      logs reply failures separately instead of swallowing them

## /splits Command Performance Optimization (2026-03-24)
- [x] Profiled: 11.6s breakdown = 8.8s Playwright cold-start (76%) + 1.1s render + 0.45s upload + 0.16s deferReply
- [x] Identified root bottleneck: Chromium launched fresh on every command (no warm browser)
- [x] Implemented warmUpRenderer() called on bot login: Chromium + template + 2 pooled pages ready in ~2.6s
      First /splits after restart now finds warm browser — cold-start eliminated
- [x] Parallel rendering: all cards rendered concurrently with Promise.all() — N games = ~1x render time
- [x] Template HTML cached in memory at module load (1.1 MB read once, not on every render)
- [x] Parallel logo fetch: away+home logos fetched with Promise.all() instead of sequentially
- [x] Warm page pool: 2 pre-opened pages maintained; refilled async after each render
- [x] IMAGE_DELAY_MS reduced from 1500ms to 800ms (safe: 1.25 msg/s vs Discord limit of 1 msg/s)
- [x] Granular timing logs: each phase (logo fetch, page claim, setContent, screenshot) logged with ms
- [x] Expected result: 1-card warm = ~1.5s, 4-card warm = ~2.5s (parallel render) + 3x800ms gaps = ~5s total

## MLB Database — Teams + Active Players (2026-03-24)
- [ ] Add brAbbrev field to mlbTeams.ts shared registry (30 teams)
- [ ] Add brAbbrev column to mlb_teams schema
- [ ] Add mlb_players table to schema (brId, name, position, bats, throws, currentTeamBrAbbrev, mlbamId, isActive)
- [ ] Run db:push to create mlb_teams and mlb_players tables
- [ ] Seed all 30 MLB teams with complete data: mlbId, mlbCode, abbrev, vsinSlug, anSlug, anLogoSlug, brAbbrev, name, nickname, city, league, division, logoUrl, primaryColor, secondaryColor, tertiaryColor
- [ ] Seed active players from BR player list HTML (55 active players extracted, mapped to current teams)
- [ ] Verify all 30 teams and active players are correctly stored with accurate team assignments

## MLB Database — Teams + Active Players (2026-03-24)
- [x] Audit existing NHL/NBA team schema and shared registry structure
- [x] Build mlbTeams.ts shared registry: all 30 teams with mlbId, mlbCode, abbrev, brAbbrev, league, division, city, nickname, name, vsinSlug, dbSlug, anSlug, anLogoSlug, logoUrl, primaryColor, secondaryColor, tertiaryColor
- [x] Cross-referenced sources: MLB.com (mlbId, mlbCode), Baseball Reference (brAbbrev), VSiN (vsinSlug), Action Network (anSlug, anLogoSlug), Rotowire (dbSlug)
- [x] Added mlb_teams table to drizzle/schema.ts (19 columns) and ran db:push
- [x] Added mlb_players table to drizzle/schema.ts (12 columns: brId, mlbamId, name, position, bats, throws, currentTeamBrAbbrev, isActive, lastSyncedAt) and ran db:push
- [x] Fetched 902 active players from MLB Stats API (2026 season) for MLBAM ID cross-reference
- [x] Extracted 55 notable active/recent players from Baseball Reference active player list (pasted_content_12.txt, pasted_content_13.txt)
- [x] Cross-referenced all 55 BR players with MLBAM API: 40 matched in 2026 season, 15 found in 2025 season (marked isActive=false)
- [x] Wrote seed-mlb.mjs and ran successfully: 30 teams inserted, 55 players inserted
- [x] Verified: 30 teams (5 per division × 6 divisions), 40 active + 15 inactive players

## MLB Player Sync Cron (08:00 UTC nightly)
- [ ] Audit existing cron infrastructure (scoreRefresh, vsinScraper crons)
- [ ] Write server/discord/mlbPlayerSync.ts with MLB Stats API integration
- [ ] Implement diff-based update logic: insert new players, update changed team/status
- [ ] Add structured noise-free logging: sync start, API fetch count, inserts, updates, skips, errors
- [ ] Register cron at 08:00 UTC in server startup
- [ ] Verify TypeScript compiles cleanly
- [ ] Test sync manually before relying on cron

## MLB Feed Integration (2026-03-24)
- [x] Fix isValidGame() in routers.ts to use MLB_VALID_DB_SLUGS (dbSlug) instead of MLB_BY_ABBREV (abbrev) for MLB team validation
- [x] Add MLB pill to ModelProjections.tsx sport selector (NHL | NBA | NCAAM | MLB)
- [x] Add MLB to selectedSport type in ModelProjections.tsx
- [x] Update auto-switch logic in ModelProjections.tsx to include MLB in fallback order (MLB → NHL → NBA → NCAAM)
- [x] Update date header label in ModelProjections.tsx for MLB: "MLB BASEBALL"
- [x] Update column header in ModelProjections.tsx for MLB: "RUN LINE" instead of "SPREAD"
- [x] Add MLB choice to Discord /splits command sport filter
- [x] Fix root cause of "Unknown column" DB errors: columns were already in DB, errors were from before migration was applied
