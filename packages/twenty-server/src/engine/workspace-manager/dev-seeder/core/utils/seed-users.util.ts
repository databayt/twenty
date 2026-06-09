import { type QueryRunner } from 'typeorm';

import { generateRandomUsers } from './generate-random-users.util';

const tableName = 'user';

export const USER_DATA_SEED_IDS = {
  JANE: '20202020-e6b5-4680-8a32-b8209737156b',
  TIM: '20202020-9e3b-46d4-a556-88b9ddc2b034',
  JONY: '20202020-3957-4908-9c36-2929a23f8357',
  PHIL: '20202020-7169-42cf-bc47-1cfef15264b8',
  SCOTT: '20202020-1111-4a01-8001-000000000001',
  ALBUS: '701819b1-b9dd-4b6e-840b-e9b4ef8c0215',
  ALI_E: '701819b1-b9dd-4b6e-840b-e9b4ef8c0220',
  ALI_EDU: '701819b1-b9dd-4b6e-840b-e9b4ef8c0221',
};

const { users: randomUsers, userIds: randomUserIds } = generateRandomUsers();

export const RANDOM_USER_IDS = randomUserIds;

type SeedUsersArgs = {
  queryRunner: QueryRunner;
  schemaName: string;
};

export const seedUsers = async ({ queryRunner, schemaName }: SeedUsersArgs) => {
  const originalUsers = [
    {
      id: USER_DATA_SEED_IDS.TIM,
      firstName: 'Tim',
      lastName: 'Apple',
      email: 'tim@apple.dev',
      passwordHash:
        '$2b$10$3LwXjJRtLsfx4hLuuXhxt.3mWgismTiZFCZSG3z9kDrSfsrBl0fT6', // tim@apple.dev
      canImpersonate: true,
      canAccessFullAdminPanel: true,
      isEmailVerified: true,
    },
    {
      id: USER_DATA_SEED_IDS.JONY,
      firstName: 'Jony',
      lastName: 'Ive',
      email: 'jony.ive@apple.dev',
      passwordHash:
        '$2b$10$3LwXjJRtLsfx4hLuuXhxt.3mWgismTiZFCZSG3z9kDrSfsrBl0fT6', // tim@apple.dev
      canImpersonate: true,
      canAccessFullAdminPanel: true,
      isEmailVerified: true,
    },
    {
      id: USER_DATA_SEED_IDS.PHIL,
      firstName: 'Phil',
      lastName: 'Schiler',
      email: 'phil.schiler@apple.dev',
      passwordHash:
        '$2b$10$3LwXjJRtLsfx4hLuuXhxt.3mWgismTiZFCZSG3z9kDrSfsrBl0fT6', // tim@apple.dev
      canImpersonate: true,
      canAccessFullAdminPanel: true,
      isEmailVerified: true,
    },
    {
      id: USER_DATA_SEED_IDS.JANE,
      firstName: 'Jane',
      lastName: 'Austen',
      email: 'jane.austen@apple.dev',
      passwordHash:
        '$2b$10$3LwXjJRtLsfx4hLuuXhxt.3mWgismTiZFCZSG3z9kDrSfsrBl0fT6', // tim@apple.dev
      canImpersonate: true,
      canAccessFullAdminPanel: true,
      isEmailVerified: true,
    },
    {
      id: USER_DATA_SEED_IDS.SCOTT,
      firstName: 'Scott',
      lastName: 'Forstall',
      email: 'scott.forstall@apple.dev',
      passwordHash:
        '$2b$10$3LwXjJRtLsfx4hLuuXhxt.3mWgismTiZFCZSG3z9kDrSfsrBl0fT6', // tim@apple.dev
      canImpersonate: false,
      canAccessFullAdminPanel: false,
      isEmailVerified: true,
    },
    {
      id: USER_DATA_SEED_IDS.ALBUS,
      firstName: 'Abdou',
      lastName: 'Hogwarts',
      email: 'abdout@hogwarts.edu',
      passwordHash:
        '$2b$10$oBuZ9vZ8rG6XD/KvQy7v3ekcry4UepOvBCsjbTAoLAM9NII7JkNou', // 1234
      canImpersonate: true,
      canAccessFullAdminPanel: true,
      isEmailVerified: true,
    },
    {
      id: USER_DATA_SEED_IDS.ALI_E,
      firstName: 'Ali',
      lastName: 'Hogwarts',
      email: 'ali@hogwarts.e',
      passwordHash:
        '$2b$10$oBuZ9vZ8rG6XD/KvQy7v3ekcry4UepOvBCsjbTAoLAM9NII7JkNou', // 1234
      canImpersonate: true,
      canAccessFullAdminPanel: true,
      isEmailVerified: true,
    },
    {
      id: USER_DATA_SEED_IDS.ALI_EDU,
      firstName: 'Ali',
      lastName: 'Hogwarts',
      email: 'ali@hogwarts.edu',
      passwordHash:
        '$2b$10$oBuZ9vZ8rG6XD/KvQy7v3ekcry4UepOvBCsjbTAoLAM9NII7JkNou', // 1234
      canImpersonate: true,
      canAccessFullAdminPanel: true,
      isEmailVerified: true,
    },
  ];

  const allUsers = [...originalUsers, ...randomUsers];

  await queryRunner.manager
    .createQueryBuilder()
    .insert()
    .into(`${schemaName}.${tableName}`, [
      'id',
      'firstName',
      'lastName',
      'email',
      'passwordHash',
      'canImpersonate',
      'canAccessFullAdminPanel',
      'isEmailVerified',
    ])
    .orIgnore()
    .values(allUsers)
    .execute();
};
