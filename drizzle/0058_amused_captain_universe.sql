ALTER TABLE `mlb_schedule_history` ADD `dkClosingAwayRunLine` decimal(4,1);--> statement-breakpoint
ALTER TABLE `mlb_schedule_history` ADD `dkClosingAwayRunLineOdds` varchar(16);--> statement-breakpoint
ALTER TABLE `mlb_schedule_history` ADD `dkClosingHomeRunLine` decimal(4,1);--> statement-breakpoint
ALTER TABLE `mlb_schedule_history` ADD `dkClosingHomeRunLineOdds` varchar(16);--> statement-breakpoint
ALTER TABLE `mlb_schedule_history` ADD `dkClosingTotal` decimal(5,1);--> statement-breakpoint
ALTER TABLE `mlb_schedule_history` ADD `dkClosingOverOdds` varchar(16);--> statement-breakpoint
ALTER TABLE `mlb_schedule_history` ADD `dkClosingUnderOdds` varchar(16);--> statement-breakpoint
ALTER TABLE `mlb_schedule_history` ADD `dkClosingAwayML` varchar(16);--> statement-breakpoint
ALTER TABLE `mlb_schedule_history` ADD `dkClosingHomeML` varchar(16);--> statement-breakpoint
ALTER TABLE `mlb_schedule_history` ADD `closingLineLockedAt` bigint;