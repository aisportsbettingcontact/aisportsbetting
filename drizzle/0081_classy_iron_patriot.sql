CREATE INDEX `idx_tb_user_result` ON `tracked_bets` (`userId`,`result`);--> statement-breakpoint
CREATE INDEX `idx_tb_user_result_date` ON `tracked_bets` (`userId`,`result`,`gameDate`);