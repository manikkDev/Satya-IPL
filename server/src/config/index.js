// Configuration variables and environment setup
import dotenv from 'dotenv';
dotenv.config();

export const config = {
    port: process.env.PORT || 5000,
    dbUri: process.env.DB_URI || '',
    // add other configuration setup here
};
