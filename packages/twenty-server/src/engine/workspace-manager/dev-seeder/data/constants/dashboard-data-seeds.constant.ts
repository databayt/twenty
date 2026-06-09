import { PAGE_LAYOUT_SEEDS } from 'src/engine/workspace-manager/dev-seeder/core/constants/page-layout-seeds.constant';
import { SEED_HOGWARTS_WORKSPACE_ID } from 'src/engine/workspace-manager/dev-seeder/core/constants/seeder-workspaces.constant';
import { generateSeedId } from 'src/engine/workspace-manager/dev-seeder/core/utils/generate-seed-id.util';
import {
  WORKSPACE_MEMBER_ALBUS_ID,
  WORKSPACE_MEMBER_DATA_SEED_IDS,
} from 'src/engine/workspace-manager/dev-seeder/data/constants/workspace-member-data-seeds.constant';

type DashboardDataSeed = {
  id: string;
  title: string;
  pageLayoutId: string;
  createdBySource: string;
  createdByWorkspaceMemberId: string;
  createdByName: string;
  updatedBySource: string;
  updatedByWorkspaceMemberId: string;
  updatedByName: string;
  position: number;
};

export const DASHBOARD_DATA_SEED_COLUMNS: (keyof DashboardDataSeed)[] = [
  'id',
  'title',
  'pageLayoutId',
  'createdBySource',
  'createdByWorkspaceMemberId',
  'createdByName',
  'updatedBySource',
  'updatedByWorkspaceMemberId',
  'updatedByName',
  'position',
];

export const DASHBOARD_DATA_SEED_IDS = {
  SALES_OVERVIEW: '20202020-9e82-4342-91ef-c9e70f16a675',
  CUSTOMER_INSIGHTS: '20202020-d64e-4588-98cc-c56ba821247b',
  TEAM_PERFORMANCE: '20202020-b888-4c58-8975-76b4c2035d3a',
};

export const getDashboardDataSeeds = (
  workspaceId: string,
): DashboardDataSeed[] => {
  const isHogwarts = workspaceId === SEED_HOGWARTS_WORKSPACE_ID;
  const creatorTim = isHogwarts
    ? WORKSPACE_MEMBER_ALBUS_ID
    : WORKSPACE_MEMBER_DATA_SEED_IDS.TIM;
  const creatorJony = isHogwarts
    ? WORKSPACE_MEMBER_ALBUS_ID
    : WORKSPACE_MEMBER_DATA_SEED_IDS.JONY;
  const creatorPhil = isHogwarts
    ? WORKSPACE_MEMBER_ALBUS_ID
    : WORKSPACE_MEMBER_DATA_SEED_IDS.PHIL;
  const creatorNameTim = isHogwarts ? 'Albus Dumbledore' : 'Tim Apple';
  const creatorNameJony = isHogwarts ? 'Albus Dumbledore' : 'Jony Ive';
  const creatorNamePhil = isHogwarts ? 'Albus Dumbledore' : 'Phil Schiller';

  return [
    {
      id: DASHBOARD_DATA_SEED_IDS.SALES_OVERVIEW,
      title: 'Sales Overview',
      pageLayoutId: generateSeedId(
        workspaceId,
        PAGE_LAYOUT_SEEDS.SALES_DASHBOARD,
      ),
      createdBySource: 'MANUAL',
      createdByWorkspaceMemberId: creatorTim,
      createdByName: creatorNameTim,
      updatedBySource: 'MANUAL',
      updatedByWorkspaceMemberId: creatorTim,
      updatedByName: creatorNameTim,
      position: 0,
    },
    {
      id: DASHBOARD_DATA_SEED_IDS.CUSTOMER_INSIGHTS,
      title: 'Customer Insights',
      pageLayoutId: generateSeedId(
        workspaceId,
        PAGE_LAYOUT_SEEDS.CUSTOMER_DASHBOARD,
      ),
      createdBySource: 'MANUAL',
      createdByWorkspaceMemberId: creatorJony,
      createdByName: creatorNameJony,
      updatedBySource: 'MANUAL',
      updatedByWorkspaceMemberId: creatorJony,
      updatedByName: creatorNameJony,
      position: 1,
    },
    {
      id: DASHBOARD_DATA_SEED_IDS.TEAM_PERFORMANCE,
      title: 'Team & Activity',
      pageLayoutId: generateSeedId(
        workspaceId,
        PAGE_LAYOUT_SEEDS.TEAM_DASHBOARD,
      ),
      createdBySource: 'MANUAL',
      createdByWorkspaceMemberId: creatorPhil,
      createdByName: creatorNamePhil,
      updatedBySource: 'MANUAL',
      updatedByWorkspaceMemberId: creatorPhil,
      updatedByName: creatorNamePhil,
      position: 2,
    },
  ];
};
