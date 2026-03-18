-- Migration 006: Map server_members.role to member_roles table

INSERT OR IGNORE INTO member_roles (server_id, user_id, role_id) VALUES ('19635edd-c74f-46ff-a243-991bc5e7f0a2', 'user_39bpQUsPv6iUZuVz4IpUfgCFAQp', 'role_everyone_pred');
INSERT OR IGNORE INTO member_roles (server_id, user_id, role_id) VALUES ('19635edd-c74f-46ff-a243-991bc5e7f0a2', 'user_39bpQUsPv6iUZuVz4IpUfgCFAQp', 'role_owner_pred');
INSERT OR IGNORE INTO member_roles (server_id, user_id, role_id) VALUES ('e594d426-2cbe-44a4-9ba6-63b3e34b3184', 'user_39bqWzvvpQ4KAlllY2yFvGKzvsX', '07dcef21-7da4-4466-b938-f5d4c5f69cf6');
INSERT OR IGNORE INTO member_roles (server_id, user_id, role_id) VALUES ('e594d426-2cbe-44a4-9ba6-63b3e34b3184', 'user_3AHSxlOOMguQFcaEufzfsVV3CXF', '07dcef21-7da4-4466-b938-f5d4c5f69cf6');
INSERT OR IGNORE INTO member_roles (server_id, user_id, role_id) VALUES ('e594d426-2cbe-44a4-9ba6-63b3e34b3184', 'user_3AHSxPTJ5spMEk9n2kgKTVF1DMY', '07dcef21-7da4-4466-b938-f5d4c5f69cf6');
INSERT OR IGNORE INTO member_roles (server_id, user_id, role_id) VALUES ('19635edd-c74f-46ff-a243-991bc5e7f0a2', 'user_39bqWzvvpQ4KAlllY2yFvGKzvsX', 'role_everyone_pred');

-- Finally, drop the old role column (commented out until verification)
-- ALTER TABLE server_members DROP COLUMN role;
