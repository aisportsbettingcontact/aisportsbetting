CREATE TABLE `nba_schedule_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`anGameId` int NOT NULL,
	`gameDate` varchar(10) NOT NULL,
	`startTimeUtc` varchar(32) NOT NULL,
	`gameStatus` varchar(16) NOT NULL DEFAULT 'scheduled',
	`awaySlug` varchar(128) NOT NULL,
	`awayAbbr` varchar(8) NOT NULL,
	`awayName` varchar(128) NOT NULL,
	`awayTeamId` int NOT NULL,
	`awayScore` int,
	`homeSlug` varchar(128) NOT NULL,
	`homeAbbr` varchar(8) NOT NULL,
	`homeName` varchar(128) NOT NULL,
	`homeTeamId` int NOT NULL,
	`homeScore` int,
	`dkAwaySpread` decimal(5,1),
	`dkAwaySpreadOdds` varchar(16),
	`dkHomeSpread` decimal(5,1),
	`dkHomeSpreadOdds` varchar(16),
	`dkTotal` decimal(6,1),
	`dkOverOdds` varchar(16),
	`dkUnderOdds` varchar(16),
	`dkAwayML` varchar(16),
	`dkHomeML` varchar(16),
	`awaySpreadCovered` boolean,
	`homeSpreadCovered` boolean,
	`totalResult` varchar(8),
	`awayWon` boolean,
	`lastRefreshedAt` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `nba_schedule_history_id` PRIMARY KEY(`id`),
	CONSTRAINT `nba_schedule_history_anGameId_unique` UNIQUE(`anGameId`)
);
--> statement-breakpoint
CREATE TABLE `nhl_schedule_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`anGameId` int NOT NULL,
	`gameDate` varchar(10) NOT NULL,
	`startTimeUtc` varchar(32) NOT NULL,
	`gameStatus` varchar(16) NOT NULL DEFAULT 'scheduled',
	`awaySlug` varchar(128) NOT NULL,
	`awayAbbr` varchar(8) NOT NULL,
	`awayName` varchar(128) NOT NULL,
	`awayTeamId` int NOT NULL,
	`awayScore` int,
	`homeSlug` varchar(128) NOT NULL,
	`homeAbbr` varchar(8) NOT NULL,
	`homeName` varchar(128) NOT NULL,
	`homeTeamId` int NOT NULL,
	`homeScore` int,
	`dkAwayPuckLine` decimal(4,1),
	`dkAwayPuckLineOdds` varchar(16),
	`dkHomePuckLine` decimal(4,1),
	`dkHomePuckLineOdds` varchar(16),
	`dkTotal` decimal(5,1),
	`dkOverOdds` varchar(16),
	`dkUnderOdds` varchar(16),
	`dkAwayML` varchar(16),
	`dkHomeML` varchar(16),
	`awayPuckLineCovered` boolean,
	`homePuckLineCovered` boolean,
	`totalResult` varchar(8),
	`awayWon` boolean,
	`lastRefreshedAt` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `nhl_schedule_history_id` PRIMARY KEY(`id`),
	CONSTRAINT `nhl_schedule_history_anGameId_unique` UNIQUE(`anGameId`)
);
--> statement-breakpoint
CREATE INDEX `idx_nbash_an_game_id` ON `nba_schedule_history` (`anGameId`);--> statement-breakpoint
CREATE INDEX `idx_nbash_game_date` ON `nba_schedule_history` (`gameDate`);--> statement-breakpoint
CREATE INDEX `idx_nbash_away_slug` ON `nba_schedule_history` (`awaySlug`);--> statement-breakpoint
CREATE INDEX `idx_nbash_home_slug` ON `nba_schedule_history` (`homeSlug`);--> statement-breakpoint
CREATE INDEX `idx_nbash_game_status` ON `nba_schedule_history` (`gameStatus`);--> statement-breakpoint
CREATE INDEX `idx_nhlsh_an_game_id` ON `nhl_schedule_history` (`anGameId`);--> statement-breakpoint
CREATE INDEX `idx_nhlsh_game_date` ON `nhl_schedule_history` (`gameDate`);--> statement-breakpoint
CREATE INDEX `idx_nhlsh_away_slug` ON `nhl_schedule_history` (`awaySlug`);--> statement-breakpoint
CREATE INDEX `idx_nhlsh_home_slug` ON `nhl_schedule_history` (`homeSlug`);--> statement-breakpoint
CREATE INDEX `idx_nhlsh_game_status` ON `nhl_schedule_history` (`gameStatus`);