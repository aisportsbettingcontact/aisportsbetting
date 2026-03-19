ALTER TABLE `games` ADD `bracketGameId` int;--> statement-breakpoint
ALTER TABLE `games` ADD `bracketRound` varchar(20);--> statement-breakpoint
ALTER TABLE `games` ADD `bracketRegion` varchar(20);--> statement-breakpoint
ALTER TABLE `games` ADD `bracketSlot` int;--> statement-breakpoint
ALTER TABLE `games` ADD `nextBracketGameId` int;--> statement-breakpoint
ALTER TABLE `games` ADD `nextBracketSlot` enum('top','bottom');