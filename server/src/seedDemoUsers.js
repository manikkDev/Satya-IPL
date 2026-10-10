import User from "./models/User.js";

const DEMO_USERS = [
    {
        name: "Bank 2 Analyst",
        email: "analyst@arthsaathi.demo",
        password: "Analyst@123",
        role: "analyst",
        institutionId: 2,
    },
    {
        name: "Demo Citizen",
        email: "citizen@arthsaathi.demo",
        password: "Citizen@123",
        role: "citizen",
        institutionId: null,
    },
];

export default async function seedDemoUsers() {
    if (process.env.SEED_DEMO_USERS === "0") return;
    try {
        for (const demo of DEMO_USERS) {
            const exists = await User.findOne({ email: demo.email });
            if (!exists) {
                await User.create(demo);
                console.log(`Seeded demo user: ${demo.email} (${demo.role})`);
            }
        }
    } catch (error) {
        console.error("Demo user seeding failed:", error.message);
    }
}
