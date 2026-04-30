ALTER TABLE `games` ADD `actualFgTotal` decimal(5,1);--> statement-breakpoint
ALTER TABLE `games` ADD `actualF5Total` decimal(5,1);--> statement-breakpoint
ALTER TABLE `games` ADD `actualNrfiBinary` tinyint;--> statement-breakpoint
ALTER TABLE `games` ADD `brierFgTotal` decimal(7,6);--> statement-breakpoint
ALTER TABLE `games` ADD `brierF5Total` decimal(7,6);--> statement-breakpoint
ALTER TABLE `games` ADD `brierNrfi` decimal(7,6);--> statement-breakpoint
ALTER TABLE `games` ADD `brierFgMl` decimal(7,6);--> statement-breakpoint
ALTER TABLE `games` ADD `brierF5Ml` decimal(7,6);--> statement-breakpoint
ALTER TABLE `games` ADD `outcomeIngestedAt` bigint;