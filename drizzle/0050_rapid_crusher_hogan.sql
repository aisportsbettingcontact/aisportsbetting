ALTER TABLE `games` DROP INDEX `games_matchup_unique`;--> statement-breakpoint
ALTER TABLE `games` ADD CONSTRAINT `games_matchup_unique` UNIQUE(`gameDate`,`awayTeam`,`homeTeam`,`gameNumber`);