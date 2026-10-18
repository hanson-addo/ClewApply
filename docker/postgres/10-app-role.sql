-- Local development only. Runs once, when the Postgres volume is first created.
-- The API logs in as clew_app, which can't bypass row-level security; migrations
-- (as clew, the table owner) grant it access table by table.
CREATE ROLE clew_app LOGIN PASSWORD 'clew_app' NOSUPERUSER NOBYPASSRLS;
