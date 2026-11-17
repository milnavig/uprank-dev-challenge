import "dotenv/config";
import { ImportError } from "../src/lib/importer";
import { closeDatabase, importSnapshot, StoreError } from "../src/lib/store";

async function main() {
  try {
    const snapshot = await importSnapshot({ apiKey: process.env.API_KEY ?? "" });
    const counts = Object.entries(snapshot.data).map(([kind, rows]) => `${kind}=${rows.length}`).join(", ");
    console.log(`Snapshot imported at reference ${snapshot.meta.referenceAt}. ${counts}.`);
  } catch (error) {
    console.error(error instanceof ImportError || error instanceof StoreError ? error.message : "Local data import failed.");
    process.exitCode = 1;
  } finally { await closeDatabase(); }
}
void main();
