import * as migration_20261018_214820_initial from './20261018_214820_initial';
import * as migration_20261018_220035_data_model from './20261018_220035_data_model';

export const migrations = [
  {
    up: migration_20261018_214820_initial.up,
    down: migration_20261018_214820_initial.down,
    name: '20261018_214820_initial',
  },
  {
    up: migration_20261018_220035_data_model.up,
    down: migration_20261018_220035_data_model.down,
    name: '20261018_220035_data_model'
  },
];
