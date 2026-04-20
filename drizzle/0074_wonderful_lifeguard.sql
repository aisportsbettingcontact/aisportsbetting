CREATE TABLE `mlb_calibration_constants` (
	`id` int AUTO_INCREMENT NOT NULL,
	`paramName` varchar(64) NOT NULL,
	`currentValue` decimal(12,8) NOT NULL,
	`baselineValue` decimal(12,8),
	`previousValue` decimal(12,8),
	`sampleSize` int,
	`ciLower` decimal(12,8),
	`ciUpper` decimal(12,8),
	`updateSource` varchar(16) DEFAULT 'INIT',
	`lastUpdatedAt` bigint NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `mlb_calibration_constants_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_cal_param` UNIQUE(`paramName`)
);
--> statement-breakpoint
CREATE TABLE `mlb_drift_state` (
	`id` int AUTO_INCREMENT NOT NULL,
	`market` varchar(32) NOT NULL,
	`windowSize` int NOT NULL DEFAULT 50,
	`rollingValue` decimal(8,6),
	`baselineValue` decimal(8,6),
	`delta` decimal(8,6),
	`direction` varchar(8),
	`driftDetected` tinyint DEFAULT 0,
	`sampleSize` int,
	`lastCheckedAt` bigint,
	`lastRecalibrationAt` bigint,
	`consecutiveDriftCount` int DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `mlb_drift_state_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_drift_market` UNIQUE(`market`)
);
--> statement-breakpoint
CREATE INDEX `idx_cal_updated` ON `mlb_calibration_constants` (`lastUpdatedAt`);