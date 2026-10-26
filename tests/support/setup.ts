import "dotenv/config";

// Services read DATABASE_URL; point them at the throw-away test database.
if (process.env.TEST_DATABASE_URL) process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
(process.env as Record<string, string>).NODE_ENV = "test";
process.env.SMS_PROVIDER = "console";
