-- The government's third fixed role, between the admin and the agent: the supervisor reviews the
-- reports agents file on issued clearances (dismisses them or revokes the clearance) and cancels
-- trips whose bill isn't paid yet. Like the other government roles it is locked: its permissions,
-- and the new govt.reports.* ones the admin and the agent get, come from the code
-- (BUILTIN_ROLES in packages/shared/src/permissions.ts), so nothing goes into role_permissions.
INSERT INTO "roles" ("company_id", "key", "name", "scope") VALUES
  (NULL, 'govt_supervisor', 'Government supervisor', 'company')
ON CONFLICT DO NOTHING;
