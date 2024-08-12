CREATE TABLE users_webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    userId VARCHAR NOT NULL,
    name VARCHAR NOT NULL,
    url TEXT NULL,
    createdAt TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updatedAt TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    FOREIGN KEY (userId) REFERENCES users(id) ON DELETE CASCADE
);

alter table user add column webhooks;