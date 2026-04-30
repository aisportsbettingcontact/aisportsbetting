ALTER TABLE `games` MODIFY COLUMN `oddsSource` enum('open','dk');--> statement-breakpoint
ALTER TABLE `odds_history` MODIFY COLUMN `lineSource` enum('open','dk');