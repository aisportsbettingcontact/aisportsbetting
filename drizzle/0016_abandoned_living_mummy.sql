CREATE TABLE `ncaam_teams` (
	`id` int AUTO_INCREMENT NOT NULL,
	`dbSlug` varchar(128) NOT NULL,
	`ncaaSlug` varchar(128) NOT NULL,
	`vsinSlug` varchar(128) NOT NULL,
	`ncaaName` varchar(255) NOT NULL,
	`ncaaNickname` varchar(128) NOT NULL,
	`vsinName` varchar(255) NOT NULL,
	`conference` varchar(128) NOT NULL,
	`logoUrl` text NOT NULL,
	`primaryColor` varchar(16),
	`secondaryColor` varchar(16),
	`tertiaryColor` varchar(16),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ncaam_teams_id` PRIMARY KEY(`id`),
	CONSTRAINT `ncaam_teams_dbSlug_unique` UNIQUE(`dbSlug`),
	CONSTRAINT `ncaam_teams_ncaaSlug_unique` UNIQUE(`ncaaSlug`),
	CONSTRAINT `ncaam_teams_vsinSlug_unique` UNIQUE(`vsinSlug`)
);
--> statement-breakpoint
ALTER TABLE `nba_teams` ADD `primaryColor` varchar(16);--> statement-breakpoint
ALTER TABLE `nba_teams` ADD `secondaryColor` varchar(16);--> statement-breakpoint
ALTER TABLE `nba_teams` ADD `tertiaryColor` varchar(16);