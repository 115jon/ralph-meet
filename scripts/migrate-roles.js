import { execSync } from 'child_process';
import crypto from 'crypto';

function genId() {
  return crypto.randomBytes(16).toString('hex');
}

async function migrate() {
  const dbName = 'ralph-chat-db';

  // 1. Get all servers
  console.log("Fetching servers...");
  const serversRaw = execSync(`npx wrangler d1 execute ${dbName} --local --json --command="SELECT id, owner_id FROM servers"`, { encoding: 'utf-8' });
  const serversRows = JSON.parse(serversRaw)[0].results;

  for (const server of serversRows) {
    const serverId = server.id;
    const ownerId = server.owner_id;

    // Check if roles exist
    const rolesRaw = execSync(`npx wrangler d1 execute ${dbName} --local --json --command="SELECT name, id FROM roles WHERE server_id = '${serverId}'"`, { encoding: 'utf-8' });
    const roles = JSON.parse(rolesRaw)[0].results;

    let everyoneRoleId = roles.find(r => r.name === '@everyone')?.id;
    let ownerRoleId = roles.find(r => r.name === 'Owner')?.id;

    if (!everyoneRoleId) {
      everyoneRoleId = genId();
      console.log(`Creating @everyone role for ${serverId}`);
      execSync(`npx wrangler d1 execute ${dbName} --local --command="INSERT INTO roles (id, server_id, name, permissions, position, is_default, created_at) VALUES ('${everyoneRoleId}', '${serverId}', '@everyone', 64384, 0, 1, datetime('now'))"`);
    }

    if (!ownerRoleId) {
      ownerRoleId = genId();
      console.log(`Creating Owner role for ${serverId}`);
      execSync(`npx wrangler d1 execute ${dbName} --local --command="INSERT INTO roles (id, server_id, name, color, permissions, position, is_default, created_at) VALUES ('${ownerRoleId}', '${serverId}', 'Owner', '#FACC15', 1, 1, 0, datetime('now'))"`);
    }

    // Assign Owner role to owner
    console.log(`Assigning Owner role to ${ownerId} in ${serverId}`);
    execSync(`npx wrangler d1 execute ${dbName} --local --command="INSERT OR IGNORE INTO member_roles (server_id, user_id, role_id) VALUES ('${serverId}', '${ownerId}', '${ownerRoleId}')"`);

    // Assign @everyone role to all members
    console.log(`Assigning @everyone role to all members in ${serverId}`);
    execSync(`npx wrangler d1 execute ${dbName} --local --command="INSERT OR IGNORE INTO member_roles (server_id, user_id, role_id) SELECT server_id, user_id, '${everyoneRoleId}' FROM server_members WHERE server_id = '${serverId}'"`);
  }

  console.log("Done iterating servers.");
}

migrate().catch(console.error);
