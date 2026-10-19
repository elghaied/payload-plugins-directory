import * as migration_20261018_214820_initial from './20261018_214820_initial';
import * as migration_20261018_220035_data_model from './20261018_220035_data_model';
import * as migration_20261018_220655_rename_github_created_at from './20261018_220655_rename_github_created_at';
import * as migration_20261018_225054_authorship_admin_only from './20261018_225054_authorship_admin_only';
import * as migration_20261019_004030_sync_status from './20261019_004030_sync_status';
import * as migration_20261019_011902_jobs from './20261019_011902_jobs';
import * as migration_20261019_041900_taxonomy_ai from './20261019_041900_taxonomy_ai';
import * as migration_20261019_050500_seed_taxonomy from './20261019_050500_seed_taxonomy';
import * as migration_20261019_052800_enrich_jobs from './20261019_052800_enrich_jobs';
import * as migration_20261019_094206_maintainer_revocation from './20261019_094206_maintainer_revocation';
import * as migration_20261019_101513_maintainers from './20261019_101513_maintainers';

export const migrations = [
  {
    up: migration_20261018_214820_initial.up,
    down: migration_20261018_214820_initial.down,
    name: '20261018_214820_initial',
  },
  {
    up: migration_20261018_220035_data_model.up,
    down: migration_20261018_220035_data_model.down,
    name: '20261018_220035_data_model',
  },
  {
    up: migration_20261018_220655_rename_github_created_at.up,
    down: migration_20261018_220655_rename_github_created_at.down,
    name: '20261018_220655_rename_github_created_at',
  },
  {
    up: migration_20261018_225054_authorship_admin_only.up,
    down: migration_20261018_225054_authorship_admin_only.down,
    name: '20261018_225054_authorship_admin_only',
  },
  {
    up: migration_20261019_004030_sync_status.up,
    down: migration_20261019_004030_sync_status.down,
    name: '20261019_004030_sync_status',
  },
  {
    up: migration_20261019_011902_jobs.up,
    down: migration_20261019_011902_jobs.down,
    name: '20261019_011902_jobs',
  },
  {
    up: migration_20261019_041900_taxonomy_ai.up,
    down: migration_20261019_041900_taxonomy_ai.down,
    name: '20261019_041900_taxonomy_ai',
  },
  {
    up: migration_20261019_050500_seed_taxonomy.up,
    down: migration_20261019_050500_seed_taxonomy.down,
    name: '20261019_050500_seed_taxonomy',
  },
  {
    up: migration_20261019_052800_enrich_jobs.up,
    down: migration_20261019_052800_enrich_jobs.down,
    name: '20261019_052800_enrich_jobs',
  },
  {
    up: migration_20261019_094206_maintainer_revocation.up,
    down: migration_20261019_094206_maintainer_revocation.down,
    name: '20261019_094206_maintainer_revocation',
  },
  {
    up: migration_20261019_101513_maintainers.up,
    down: migration_20261019_101513_maintainers.down,
    name: '20261019_101513_maintainers'
  },
];
