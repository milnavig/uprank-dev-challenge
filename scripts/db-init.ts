import "dotenv/config";
import { closeDatabase, initializeDatabase, StoreError } from "../src/lib/store";

async function main() {
  try {
    await initializeDatabase();
    console.log("Dedicated local challenge database initialized.");
  } catch (error) {
    console.error(error instanceof StoreError ? error.message : "Local database initialization failed.");
    process.exitCode = 1;
  } finally { await closeDatabase(); }
}
void main();
