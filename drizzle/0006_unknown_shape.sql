ALTER TABLE `games` MODIFY COLUMN `awayModelSpread` decimal(6,1);--> statement-breakpoint
ALTER TABLE `games` MODIFY COLUMN `homeModelSpread` decimal(6,1);--> statement-breakpoint
ALTER TABLE `games` MODIFY COLUMN `modelTotal` decimal(6,1);--> statement-breakpoint
ALTER TABLE `games` MODIFY COLUMN `spreadEdge` varchar(128);--> statement-breakpoint
ALTER TABLE `games` MODIFY COLUMN `spreadDiff` decimal(5,1);--> statement-breakpoint
ALTER TABLE `games` MODIFY COLUMN `totalEdge` varchar(128);--> statement-breakpoint
ALTER TABLE `games` MODIFY COLUMN `totalDiff` decimal(5,1);