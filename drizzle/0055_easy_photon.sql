CREATE TABLE `user_sessions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`startedAt` bigint NOT NULL,
	`endedAt` bigint,
	`durationMs` bigint,
	`lastHeartbeat` bigint,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `user_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_sess_user_id` ON `user_sessions` (`userId`);--> statement-breakpoint
CREATE INDEX `idx_sess_started_at` ON `user_sessions` (`startedAt`);--> statement-breakpoint
CREATE INDEX `idx_sess_ended_at` ON `user_sessions` (`endedAt`);