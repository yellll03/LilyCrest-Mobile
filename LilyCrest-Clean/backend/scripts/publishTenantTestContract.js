'use strict';

require('dotenv').config();
const { connectToMongo, closeConnection } = require('../config/database');
const { initializeFirebase } = require('../config/firebase');
const { publishTenantTestContract, resolveContractSnapshot } = require('../services/contractPublication.service');

async function main() {
  const userId = String(process.env.PUBLISH_TENANT_USER_ID || '').trim();
  const publishedBy = String(process.env.CONTRACT_QA_PUBLISHED_BY || '').trim();
  const write = process.argv.includes('--write');
  if (!userId) throw new Error('PUBLISH_TENANT_USER_ID is required.');
  const db = await connectToMongo();
  const audit = await resolveContractSnapshot(db, userId);
  console.log(JSON.stringify({
    ready: audit.ok,
    blockers: audit.blockers || [],
    fields: audit.ok ? {
      tenantLegalName: { found: true, source: 'approved_reservation_application' },
      tenantResidentialAddress: { found: true, source: 'approved_reservation_application' },
      branch: { found: true, source: 'authoritative_room_assignment' },
      room: { found: true, source: 'assigned_room' },
      bedSlot: { found: true, source: 'approved_reservation_selected_bed' },
      moveInDate: { found: true, source: 'approved_reservation' },
      moveOutDate: { found: true, source: 'move_in_plus_lease_duration' },
      leaseType: { found: true, source: 'official_duration_threshold' },
      pricing: { found: true, source: 'verified_official_template_and_reservation' },
    } : null,
  }, null, 2));
  if (!write) return;
  if (process.env.CONTRACT_QA_CONFIRM !== 'PUBLISH_CONTROLLED_TENANT_CONTRACT') {
    throw new Error('CONTRACT_QA_CONFIRM must explicitly authorize controlled publication.');
  }
  if (!publishedBy) throw new Error('CONTRACT_QA_PUBLISHED_BY is required.');
  initializeFirebase();
  const result = await publishTenantTestContract(db, userId, publishedBy);
  console.log(JSON.stringify({ published: result.ok, existing: result.existing || false, blockers: result.blockers || [] }));
}

main()
  .catch((error) => { console.error(error.message); process.exitCode = 1; })
  .finally(() => closeConnection());
