/**
 * Backward-compatible re-export of the Phase 6 test harness.
 * Prefer importing from `./app` in new tests.
 */
export {
  authHeaders,
  closeTestApp,
  createTestApp,
  seedOrgWithFakeAccount,
} from './app';
