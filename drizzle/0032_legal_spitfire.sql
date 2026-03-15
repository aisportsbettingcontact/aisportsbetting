ALTER TABLE `games` ADD `awayGoalie` varchar(128);--> statement-breakpoint
ALTER TABLE `games` ADD `homeGoalie` varchar(128);--> statement-breakpoint
ALTER TABLE `games` ADD `awayGoalieConfirmed` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `games` ADD `homeGoalieConfirmed` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `games` ADD `modelAwayPLCoverPct` decimal(5,2);--> statement-breakpoint
ALTER TABLE `games` ADD `modelHomePLCoverPct` decimal(5,2);