import mongoose from "mongoose";
import seedDocumentsAndAlerts from "./src/seedDocumentsAndAlerts.js";

async function main() {
  await mongoose.connect("mongodb://localhost:27017/satya");
  await seedDocumentsAndAlerts("satya-demo");
  await mongoose.disconnect();
  console.log("Seeding finished successfully!");
}

main().catch(err => {
  console.error("Seeding failed:", err);
  process.exit(1);
});
