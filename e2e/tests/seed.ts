// The made-up jobs seed-jobs.py adds before the run. Keep the two in step.
export const hasSeededJobs = Boolean(process.env.CLEW_MIGRATIONS_DATABASE_URL);

export const THREAD = {
  title: "E2E Thread Engineer",
  company: "Labyrinth Logistics",
  domain: "boards.greenhouse.io",
};
export const ROUTE = { title: "E2E Route Planner", company: "Minos Maps" };
export const MAZE = { title: "E2E Maze Analyst", company: "Daedalus Designs" };
