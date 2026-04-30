CREATE INDEX `idx_tb_user_sport_date` ON `tracked_bets` (`userId`,`sport`,`gameDate`);--> statement-breakpoint
CREATE INDEX `idx_tb_user_date` ON `tracked_bets` (`userId`,`gameDate`);