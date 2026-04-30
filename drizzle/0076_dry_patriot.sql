CREATE TABLE `bet_edit_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`betId` int NOT NULL,
	`requestedBy` int NOT NULL,
	`requestType` enum('EDIT','DELETE') NOT NULL,
	`proposedChanges` text,
	`reason` text,
	`status` enum('PENDING','APPROVED','DENIED') NOT NULL DEFAULT 'PENDING',
	`reviewedBy` int,
	`reviewedAt` timestamp,
	`reviewNote` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bet_edit_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `tracked_bets` ADD `wagerType` enum('PREGAME','LIVE') DEFAULT 'PREGAME' NOT NULL;--> statement-breakpoint
ALTER TABLE `tracked_bets` ADD `customLine` decimal(6,1);--> statement-breakpoint
CREATE INDEX `idx_ber_bet_id` ON `bet_edit_requests` (`betId`);--> statement-breakpoint
CREATE INDEX `idx_ber_requested_by` ON `bet_edit_requests` (`requestedBy`);--> statement-breakpoint
CREATE INDEX `idx_ber_status` ON `bet_edit_requests` (`status`);