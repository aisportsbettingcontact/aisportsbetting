ALTER TABLE `tracked_bets` ADD `anGameId` int;--> statement-breakpoint
ALTER TABLE `tracked_bets` ADD `timeframe` enum('FULL_GAME','FIRST_5','FIRST_INNING') DEFAULT 'FULL_GAME' NOT NULL;--> statement-breakpoint
ALTER TABLE `tracked_bets` ADD `market` enum('ML','RL','TOTAL') DEFAULT 'ML' NOT NULL;--> statement-breakpoint
ALTER TABLE `tracked_bets` ADD `pickSide` enum('AWAY','HOME','OVER','UNDER');