ALTER TABLE `mlb_pitcher_stats` ADD `nrfiStarts` int;--> statement-breakpoint
ALTER TABLE `mlb_pitcher_stats` ADD `nrfiCount` int;--> statement-breakpoint
ALTER TABLE `mlb_pitcher_stats` ADD `nrfiRate` double;--> statement-breakpoint
ALTER TABLE `mlb_pitcher_stats` ADD `f5RunsAllowedMean` double;--> statement-breakpoint
ALTER TABLE `mlb_pitcher_stats` ADD `fgRunsAllowedMean` double;--> statement-breakpoint
ALTER TABLE `mlb_pitcher_stats` ADD `ipMean3yr` double;--> statement-breakpoint
ALTER TABLE `mlb_pitcher_stats` ADD `nrfiSampleSeasons` varchar(32);--> statement-breakpoint
ALTER TABLE `mlb_pitcher_stats` ADD `nrfiCalibVersion` varchar(32);--> statement-breakpoint
ALTER TABLE `mlb_pitcher_stats` ADD `nrfiSeededAt` bigint;