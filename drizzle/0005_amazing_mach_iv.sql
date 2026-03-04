ALTER TABLE `games` ADD `gameType` enum('regular_season','conference_tournament') DEFAULT 'regular_season' NOT NULL;--> statement-breakpoint
ALTER TABLE `games` ADD `conference` varchar(128);--> statement-breakpoint
ALTER TABLE `games` ADD `publishedToFeed` boolean DEFAULT false NOT NULL;