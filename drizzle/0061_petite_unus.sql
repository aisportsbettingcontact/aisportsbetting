CREATE TABLE `tracked_bets` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`gameId` int,
	`sport` varchar(16) NOT NULL DEFAULT 'MLB',
	`gameDate` varchar(20) NOT NULL,
	`awayTeam` varchar(128),
	`homeTeam` varchar(128),
	`betType` enum('ML','RL','OVER','UNDER','PROP','PARLAY','TEASER','FUTURE','CUSTOM') NOT NULL DEFAULT 'ML',
	`pick` varchar(255) NOT NULL,
	`odds` int NOT NULL,
	`risk` decimal(10,2) NOT NULL,
	`toWin` decimal(10,2) NOT NULL,
	`book` varchar(64),
	`notes` text,
	`result` enum('PENDING','WIN','LOSS','PUSH','VOID') NOT NULL DEFAULT 'PENDING',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tracked_bets_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `app_users` MODIFY COLUMN `role` enum('owner','admin','handicapper','user') NOT NULL DEFAULT 'user';--> statement-breakpoint
CREATE INDEX `idx_tb_user_id` ON `tracked_bets` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_tb_game_id` ON `tracked_bets` (`gameId`);--> statement-breakpoint
CREATE INDEX `idx_tb_game_date` ON `tracked_bets` (`gameDate`);--> statement-breakpoint
CREATE INDEX `idx_tb_sport` ON `tracked_bets` (`sport`);--> statement-breakpoint
CREATE INDEX `idx_tb_result` ON `tracked_bets` (`result`);