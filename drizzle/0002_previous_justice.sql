CREATE TABLE `espn_teams` (
	`id` int AUTO_INCREMENT NOT NULL,
	`slug` varchar(128) NOT NULL,
	`displayName` varchar(255) NOT NULL,
	`espnId` varchar(20) NOT NULL,
	`conference` varchar(128) NOT NULL DEFAULT '',
	`sport` varchar(64) NOT NULL DEFAULT 'NCAAM',
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `espn_teams_id` PRIMARY KEY(`id`),
	CONSTRAINT `espn_teams_slug_unique` UNIQUE(`slug`)
);
