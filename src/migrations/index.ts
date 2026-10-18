import * as migration_20261018_214820_initial from './20261018_214820_initial';

export const migrations = [
  {
    up: migration_20261018_214820_initial.up,
    down: migration_20261018_214820_initial.down,
    name: '20261018_214820_initial'
  },
];
