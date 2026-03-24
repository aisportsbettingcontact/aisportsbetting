ALTER TABLE `games` ADD `mlbGamePk` int;--> statement-breakpoint
ALTER TABLE `games` ADD `broadcaster` varchar(128);--> statement-breakpoint
ALTER TABLE `games` ADD `awayStartingPitcher` varchar(128);--> statement-breakpoint
ALTER TABLE `games` ADD `homeStartingPitcher` varchar(128);--> statement-breakpoint
ALTER TABLE `games` ADD `awayPitcherConfirmed` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `games` ADD `homePitcherConfirmed` boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE `games` ADD `venue` varchar(128);--> statement-breakpoint
ALTER TABLE `games` ADD `doubleHeader` varchar(2) DEFAULT 'N';--> statement-breakpoint
ALTER TABLE `games` ADD `gameNumber` tinyint DEFAULT 1;--> statement-breakpoint
ALTER TABLE `games` ADD `awayRunLine` varchar(8);--> statement-breakpoint
ALTER TABLE `games` ADD `homeRunLine` varchar(8);--> statement-breakpoint
ALTER TABLE `games` ADD `awayRunLineOdds` varchar(16);--> statement-breakpoint
ALTER TABLE `games` ADD `homeRunLineOdds` varchar(16);--> statement-breakpoint
ALTER TABLE `games` ADD `rlAwayBetsPct` tinyint;--> statement-breakpoint
ALTER TABLE `games` ADD `rlAwayMoneyPct` tinyint;