CREATE TABLE IF NOT EXISTS monitor_groups (
    groupId INT AUTO_INCREMENT PRIMARY KEY,
    groupName VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;


CREATE TABLE IF NOT EXISTS monitor (
    monitorId INT AUTO_INCREMENT PRIMARY KEY,
    monitorType VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    url VARCHAR(255) NOT NULL,
    `interval` INT NOT NULL,
    retries INT NOT NULL,
    retryInterval INT NOT NULL,
    timeout INT NOT NULL,
    acceptedStatusCodes JSON NOT NULL,
    description TEXT,
    groupName VARCHAR(255) NOT NULL,
    userID INT NOT NULL,
    createdAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updatedAt DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    FOREIGN KEY (groupName) REFERENCES monitor_groups(groupName),
    FOREIGN KEY (userID) REFERENCES users(userId)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
