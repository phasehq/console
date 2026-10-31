-- Bench-only: trim api_secretevent from 19 to 8 indexes and the tag link
-- table from 6 to 3, keeping every index a query or FK action needs.
-- (Production would do this with DROP/CREATE INDEX CONCURRENTLY.)

-- text_pattern_ops twins: only serve LIKE 'prefix%' on uuids; nothing does that.
DROP INDEX api_secretevent_id_ed22ddff_like;
DROP INDEX api_secretevent_environment_id_3bdb60e1_like;
DROP INDEX api_secretevent_folder_id_c999052f_like;
DROP INDEX api_secretevent_secret_id_738a0205_like;
DROP INDEX api_secretevent_service_account_id_8d3ea700_like;
DROP INDEX api_secretevent_service_account_token_id_150acaaf_like;
DROP INDEX api_secretevent_service_token_id_9f7f79ff_like;
DROP INDEX api_secretevent_user_id_2592fcc2_like;

-- Single-column FK indexes already covered by a composite with the same
-- leading column (secret_event_history_idx, secret_logs_env_idx,
-- sa_token_last_used_idx). Cascades/filters on these columns still use the composites.
DROP INDEX api_secretevent_secret_id_738a0205;
DROP INDEX api_secretevent_environment_id_3bdb60e1;
DROP INDEX api_secretevent_service_account_token_id_150acaaf;

-- FK indexes that only serve ON DELETE SET NULL / CASCADE lookups: make them
-- partial so the (common) NULL rows skip them entirely. service_token_id is
-- always NULL now that legacy service tokens are retired.
DROP INDEX api_secretevent_user_id_2592fcc2;
DROP INDEX api_secretevent_service_account_id_8d3ea700;
DROP INDEX api_secretevent_service_token_id_9f7f79ff;
DROP INDEX api_secretevent_folder_id_c999052f;
CREATE INDEX secretevent_user_nn_idx ON api_secretevent (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX secretevent_sa_nn_idx ON api_secretevent (service_account_id) WHERE service_account_id IS NOT NULL;
CREATE INDEX secretevent_st_nn_idx ON api_secretevent (service_token_id) WHERE service_token_id IS NOT NULL;
CREATE INDEX secretevent_folder_nn_idx ON api_secretevent (folder_id) WHERE folder_id IS NOT NULL;

-- Tag links: the unique (secretevent_id, secrettag_id) index covers lookups by event.
DROP INDEX api_secretevent_tags_secretevent_id_9270341e;
DROP INDEX api_secretevent_tags_secretevent_id_9270341e_like;
DROP INDEX api_secretevent_tags_secrettag_id_f4d7f748_like;
