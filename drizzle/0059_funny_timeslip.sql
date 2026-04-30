ALTER TABLE `games` ADD `oddsSource` enum('open','dk','partial');--> statement-breakpoint
ALTER TABLE `odds_history` ADD `lineSource` enum('open','dk','partial');