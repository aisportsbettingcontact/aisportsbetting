CREATE TABLE `odds_history` (
	`id` int AUTO_INCREMENT NOT NULL,
	`gameId` int NOT NULL,
	`sport` varchar(16) NOT NULL,
	`scrapedAt` bigint NOT NULL,
	`source` enum('auto','manual') NOT NULL DEFAULT 'auto',
	`awaySpread` varchar(16),
	`awaySpreadOdds` varchar(16),
	`homeSpread` varchar(16),
	`homeSpreadOdds` varchar(16),
	`total` varchar(16),
	`overOdds` varchar(16),
	`underOdds` varchar(16),
	`awayML` varchar(16),
	`homeML` varchar(16),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `odds_history_id` PRIMARY KEY(`id`)
);
