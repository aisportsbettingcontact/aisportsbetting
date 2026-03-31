CREATE TABLE `mlb_bullpen_stats` (
	`id` int AUTO_INCREMENT NOT NULL,
	`teamAbbrev` varchar(8) NOT NULL,
	`mlbTeamId` int NOT NULL,
	`season` int NOT NULL,
	`relieverCount` int NOT NULL,
	`totalIp` double NOT NULL,
	`totalEr` int,
	`totalK` int,
	`totalBb` int,
	`totalHr` int,
	`totalH` int,
	`eraBullpen` double,
	`k9Bullpen` double,
	`bb9Bullpen` double,
	`hr9Bullpen` double,
	`whipBullpen` double,
	`kBbRatio` double,
	`fipBullpen` double,
	`lastFetchedAt` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `mlb_bullpen_stats_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_bullpen_team_season` UNIQUE(`teamAbbrev`,`season`)
);
--> statement-breakpoint
CREATE TABLE `mlb_park_factors` (
	`id` int AUTO_INCREMENT NOT NULL,
	`venueId` int NOT NULL,
	`venueName` varchar(128) NOT NULL,
	`teamAbbrev` varchar(8) NOT NULL,
	`runs2023` int,
	`games2023` int,
	`avgRpg2023` double,
	`pf2023` double,
	`runs2024` int,
	`games2024` int,
	`avgRpg2024` double,
	`pf2024` double,
	`runs2025` int,
	`games2025` int,
	`avgRpg2025` double,
	`pf2025` double,
	`parkFactor3yr` double NOT NULL,
	`leagueAvgRpg` double,
	`lastFetchedAt` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `mlb_park_factors_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_park_venue` UNIQUE(`venueId`)
);
--> statement-breakpoint
CREATE TABLE `mlb_umpire_modifiers` (
	`id` int AUTO_INCREMENT NOT NULL,
	`umpireId` int NOT NULL,
	`umpireName` varchar(128) NOT NULL,
	`gamesHp` int NOT NULL,
	`totalK` int NOT NULL,
	`totalBb` int NOT NULL,
	`totalH` int,
	`totalR` int,
	`kRate` double,
	`bbRate` double,
	`kModifier` double,
	`bbModifier` double,
	`seasonsIncluded` varchar(32),
	`lastFetchedAt` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `mlb_umpire_modifiers_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_umpire_id` UNIQUE(`umpireId`)
);
--> statement-breakpoint
CREATE INDEX `idx_bullpen_team` ON `mlb_bullpen_stats` (`teamAbbrev`);--> statement-breakpoint
CREATE INDEX `idx_park_team` ON `mlb_park_factors` (`teamAbbrev`);--> statement-breakpoint
CREATE INDEX `idx_umpire_name` ON `mlb_umpire_modifiers` (`umpireName`);