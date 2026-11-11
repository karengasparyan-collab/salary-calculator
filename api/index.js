/* Vercel entry point: every request (pages and /api/…) goes through the same handler as `npm start`,
 * so the password protects everything. Settings come from the project's Environment Variables. */
const { createHandler, configFromEnv } = require("../server.js");
const { storeFromEnv } = require("../store.js");
const path = require("path");

module.exports = createHandler(configFromEnv(process.env), { store: storeFromEnv(process.env, path.join(__dirname, "..")) });
