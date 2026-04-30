CREATE TABLE `mlb_schedule_history` (
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
	`dkAwayRunLine` decimal(4,1),
	`dkAwayRunLineOdds` varchar(16),
	`dkHomeRunLine` decimal(4,1),
	`dkHomeRunLineOdds` varchar(16),
	`dkTotal` decimal(5,1),
	`dkOverOdds` varchar(16),
	`dkUnderOdds` varchar(16),
	`dkAwayML` varchar(16),
	`dkHomeML` varchar(16),
	`awayRunLineCovered` boolean,
	`homeRunLineCovered` boolean,
	`totalResult` varchar(8),
	`awayWon` boolean,
	`lastRefreshedAt` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `mlb_schedule_history_id` PRIMARY KEY(`id`),
	CONSTRAINT `mlb_schedule_history_anGameId_unique` UNIQUE(`anGameId`)
);
--> statement-breakpoint
CREATE INDEX `idx_msh_an_game_id` ON `mlb_schedule_history` (`anGameId`);--> statement-breakpoint
CREATE INDEX `idx_msh_game_date` ON `mlb_schedule_history` (`gameDate`);--> statement-breakpoint
CREATE INDEX `idx_msh_away_slug` ON `mlb_schedule_history` (`awaySlug`);--> statement-breakpoint
CREATE INDEX `idx_msh_home_slug` ON `mlb_schedule_history` (`homeSlug`);--> statement-breakpoint
CREATE INDEX `idx_msh_game_status` ON `mlb_schedule_history` (`gameStatus`);