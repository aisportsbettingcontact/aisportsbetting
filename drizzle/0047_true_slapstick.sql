ALTER TABLE `mlb_park_factors` ADD `runs2026` int;--> statement-breakpoint
ALTER TABLE `mlb_park_factors` ADD `games2026` int;--> statement-breakpoint
ALTER TABLE `mlb_park_factors` ADD `avgRpg2026` double;--> statement-breakpoint
ALTER TABLE `mlb_park_factors` ADD `pf2026` double;--> statement-breakpoint
ALTER TABLE `mlb_park_factors` DROP COLUMN `runs2023`;--> statement-breakpoint
ALTER TABLE `mlb_park_factors` DROP COLUMN `games2023`;--> statement-breakpoint
ALTER TABLE `mlb_park_factors` DROP COLUMN `avgRpg2023`;--> statement-breakpoint
ALTER TABLE `mlb_park_factors` DROP COLUMN `pf2023`;