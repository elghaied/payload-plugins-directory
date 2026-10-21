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
import * as migration_20261019_110150_submissions_claim_check from './20261019_110150_submissions_claim_check';
import * as migration_20261021_000259_media_origin from './20261021_000259_media_origin';
import * as migration_20261021_011329_search_index from './20261021_011329_search_index';
import * as migration_20261021_013801_search_resync_task from './20261021_013801_search_resync_task';
import * as migration_20261021_034401_readme_truncated from './20261021_034401_readme_truncated';
import * as migration_20261021_070342_readme_html from './20261021_070342_readme_html';
import * as migration_20261021_073906_render_readmes_task from './20261021_073906_render_readmes_task';
import * as migration_20261021_105019_template_categories from './20261021_105019_template_categories';
import * as migration_20261021_105100_seed_template_categories from './20261021_105100_seed_template_categories';
import * as migration_20261021_111206_templates from './20261021_111206_templates';
import * as migration_20261021_113614_template_tasks from './20261021_113614_template_tasks';
import * as migration_20261021_120037_enrich_template_task from './20261021_120037_enrich_template_task';
import * as migration_20261021_124916_submission_kind from './20261021_124916_submission_kind';

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
    name: '20261019_101513_maintainers',
  },
  {
    up: migration_20261019_110150_submissions_claim_check.up,
    down: migration_20261019_110150_submissions_claim_check.down,
    name: '20261019_110150_submissions_claim_check',
  },
  {
    up: migration_20261021_000259_media_origin.up,
    down: migration_20261021_000259_media_origin.down,
    name: '20261021_000259_media_origin',
  },
  {
    up: migration_20261021_011329_search_index.up,
    down: migration_20261021_011329_search_index.down,
    name: '20261021_011329_search_index',
  },
  {
    up: migration_20261021_013801_search_resync_task.up,
    down: migration_20261021_013801_search_resync_task.down,
    name: '20261021_013801_search_resync_task',
  },
  {
    up: migration_20261021_034401_readme_truncated.up,
    down: migration_20261021_034401_readme_truncated.down,
    name: '20261021_034401_readme_truncated',
  },
  {
    up: migration_20261021_070342_readme_html.up,
    down: migration_20261021_070342_readme_html.down,
    name: '20261021_070342_readme_html',
  },
  {
    up: migration_20261021_073906_render_readmes_task.up,
    down: migration_20261021_073906_render_readmes_task.down,
    name: '20261021_073906_render_readmes_task',
  },
  {
    up: migration_20261021_105019_template_categories.up,
    down: migration_20261021_105019_template_categories.down,
    name: '20261021_105019_template_categories',
  },
  {
    up: migration_20261021_105100_seed_template_categories.up,
    down: migration_20261021_105100_seed_template_categories.down,
    name: '20261021_105100_seed_template_categories',
  },
  {
    up: migration_20261021_111206_templates.up,
    down: migration_20261021_111206_templates.down,
    name: '20261021_111206_templates',
  },
  {
    up: migration_20261021_113614_template_tasks.up,
    down: migration_20261021_113614_template_tasks.down,
    name: '20261021_113614_template_tasks',
  },
  {
    up: migration_20261021_120037_enrich_template_task.up,
    down: migration_20261021_120037_enrich_template_task.down,
    name: '20261021_120037_enrich_template_task',
  },
  {
    up: migration_20261021_124916_submission_kind.up,
    down: migration_20261021_124916_submission_kind.down,
    name: '20261021_124916_submission_kind'
  },
];
