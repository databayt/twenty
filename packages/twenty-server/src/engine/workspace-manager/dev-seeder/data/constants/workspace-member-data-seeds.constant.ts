import {
  SEED_APPLE_WORKSPACE_ID,
  SEED_YCOMBINATOR_WORKSPACE_ID,
  SEED_HOGWARTS_WORKSPACE_ID,
} from 'src/engine/workspace-manager/dev-seeder/core/constants/seeder-workspaces.constant';
import { generateRandomUsers } from 'src/engine/workspace-manager/dev-seeder/core/utils/generate-random-users.util';
import { USER_DATA_SEED_IDS } from 'src/engine/workspace-manager/dev-seeder/core/utils/seed-users.util';

export const WORKSPACE_MEMBER_ALBUS_ID = '701819b1-b9dd-4b6e-840b-e9b4ef8c0216';
export const WORKSPACE_MEMBER_ALI_E_ID = '701819b1-b9dd-4b6e-840b-e9b4ef8c0226';
export const WORKSPACE_MEMBER_ALI_EDU_ID = '701819b1-b9dd-4b6e-840b-e9b4ef8c0227';

export const ALBUS_WORKSPACE_MEMBER_SEED: WorkspaceMemberDataSeed = {
  id: WORKSPACE_MEMBER_ALBUS_ID,
  nameFirstName: 'Abdou',
  nameLastName: 'Hogwarts',
  locale: 'en',
  colorScheme: 'Light',
  userEmail: 'abdout@hogwarts.edu',
  userId: USER_DATA_SEED_IDS.ALBUS,
};

export const ALI_E_WORKSPACE_MEMBER_SEED: WorkspaceMemberDataSeed = {
  id: WORKSPACE_MEMBER_ALI_E_ID,
  nameFirstName: 'Ali',
  nameLastName: 'Hogwarts',
  locale: 'en',
  colorScheme: 'Light',
  userEmail: 'ali@hogwarts.e',
  userId: USER_DATA_SEED_IDS.ALI_E,
};

export const ALI_EDU_WORKSPACE_MEMBER_SEED: WorkspaceMemberDataSeed = {
  id: WORKSPACE_MEMBER_ALI_EDU_ID,
  nameFirstName: 'Ali',
  nameLastName: 'Hogwarts',
  locale: 'en',
  colorScheme: 'Light',
  userEmail: 'ali@hogwarts.edu',
  userId: USER_DATA_SEED_IDS.ALI_EDU,
};

type WorkspaceMemberDataSeed = {
  id: string;
  nameFirstName: string;
  nameLastName: string;
  locale: string;
  colorScheme: string;
  userEmail: string;
  userId: string;
};

export const WORKSPACE_MEMBER_DATA_SEED_COLUMNS: (keyof WorkspaceMemberDataSeed)[] =
  [
    'id',
    'nameFirstName',
    'nameLastName',
    'locale',
    'colorScheme',
    'userEmail',
    'userId',
  ];

export const WORKSPACE_MEMBER_DATA_SEED_IDS = {
  TIM: '20202020-0687-4c41-b707-ed1bfca972a7',
  JONY: '20202020-77d5-4cb6-b60a-f4a835a85d61',
  PHIL: '20202020-1553-45c6-a028-5a9064cce07f',
  JANE: '20202020-463f-435b-828c-107e007a2711',
  SCOTT: '20202020-1111-4a01-8001-000000000003',
};

const {
  workspaceMembers: randomWorkspaceMembers,
  workspaceMemberIds: randomWorkspaceMemberIds,
} = generateRandomUsers();

export const RANDOM_WORKSPACE_MEMBER_IDS = randomWorkspaceMemberIds;

const originalWorkspaceMembers: WorkspaceMemberDataSeed[] = [
  {
    id: WORKSPACE_MEMBER_DATA_SEED_IDS.TIM,
    nameFirstName: 'Tim',
    nameLastName: 'Apple',
    locale: 'en',
    colorScheme: 'Light',
    userEmail: 'tim@apple.dev',
    userId: USER_DATA_SEED_IDS.TIM,
  },
  {
    id: WORKSPACE_MEMBER_DATA_SEED_IDS.JONY,
    nameFirstName: 'Jony',
    nameLastName: 'Ive',
    locale: 'en',
    colorScheme: 'Light',
    userEmail: 'jony.ive@apple.dev',
    userId: USER_DATA_SEED_IDS.JONY,
  },
  {
    id: WORKSPACE_MEMBER_DATA_SEED_IDS.PHIL,
    nameFirstName: 'Phil',
    nameLastName: 'Schiler',
    locale: 'en',
    colorScheme: 'Light',
    userEmail: 'phil.schiler@apple.dev',
    userId: USER_DATA_SEED_IDS.PHIL,
  },
  {
    id: WORKSPACE_MEMBER_DATA_SEED_IDS.JANE,
    nameFirstName: 'Jane',
    nameLastName: 'Austen',
    locale: 'en',
    colorScheme: 'Light',
    userEmail: 'jane.austen@apple.dev',
    userId: USER_DATA_SEED_IDS.JANE,
  },
];

// Scott only belongs to the Apple workspace (he has no YCombinator
// user-workspace), so he must never leak into other workspaces' member seeds.
const appleOnlyWorkspaceMembers: WorkspaceMemberDataSeed[] = [
  {
    id: WORKSPACE_MEMBER_DATA_SEED_IDS.SCOTT,
    nameFirstName: 'Scott',
    nameLastName: 'Forstall',
    locale: 'en',
    colorScheme: 'Light',
    userEmail: 'scott.forstall@apple.dev',
    userId: USER_DATA_SEED_IDS.SCOTT,
  },
];

export const WORKSPACE_MEMBER_DATA_SEEDS: WorkspaceMemberDataSeed[] = [
  ...originalWorkspaceMembers,
  ...randomWorkspaceMembers,
];

export const getWorkspaceMemberDataSeeds = (
  workspaceId: string,
): WorkspaceMemberDataSeed[] => {
  // In test environment, only return original members to avoid conflicts
  // (Scott is appended for Apple to back the impersonation escalation test).
  if (process.env.NODE_ENV === 'test') {
    return workspaceId === SEED_APPLE_WORKSPACE_ID
      ? [...originalWorkspaceMembers, ...appleOnlyWorkspaceMembers]
      : originalWorkspaceMembers;
  }

  if (workspaceId === SEED_APPLE_WORKSPACE_ID) {
    // Apple workspace gets all workspace members (original + random + Scott)
    return [...WORKSPACE_MEMBER_DATA_SEEDS, ...appleOnlyWorkspaceMembers];
  } else if (workspaceId === SEED_YCOMBINATOR_WORKSPACE_ID) {
    // YC workspace gets all 4 original workspace members
    return originalWorkspaceMembers;
  } else if (workspaceId === SEED_HOGWARTS_WORKSPACE_ID) {
    return [
      ALBUS_WORKSPACE_MEMBER_SEED,
      ALI_E_WORKSPACE_MEMBER_SEED,
      ALI_EDU_WORKSPACE_MEMBER_SEED,
    ];
  }

  return originalWorkspaceMembers;
};
