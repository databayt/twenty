import { type AuthContext } from './auth';
import { prisma } from './prisma';

// Object-level permission enforcement, ported faithfully from twenty-server's role model:
// principal -> role (via core.roleTarget) -> object permission (role default flag, overridden per
// object when the override column is non-null: `override ?? default`). Mirrors
// validateOperationIsPermittedOrThrow + workspace-roles-permissions-cache. Deferred (see ledger):
// field-level/restricted fields, settings-flag granularity, row-level/record-sharing, multi-role
// intersection, and the workspaceMember/workflow settings-gated special cases.

export class PermissionError extends Error {
  readonly status = 403;
  readonly code = 'PERMISSION_DENIED';

  constructor(message = 'Permission denied') {
    super(message);
    this.name = 'PermissionError';
  }
}

export type ObjectOperation =
  | 'read'
  | 'create'
  | 'update'
  | 'softDelete'
  | 'destroy';

type RoleFlags = {
  canReadAllObjectRecords: boolean;
  canUpdateAllObjectRecords: boolean;
  canSoftDeleteAllObjectRecords: boolean;
  canDestroyAllObjectRecords: boolean;
  canUpdateAllSettings: boolean;
};

// ACCESS -> userWorkspaceId, API_KEY -> apiKeyId. No roleTarget == no role == hard deny.
const resolveRoleId = async (auth: AuthContext): Promise<string> => {
  const principalId =
    auth.tokenType === 'API_KEY' ? auth.apiKeyId : auth.userWorkspaceId;
  if (!principalId) {
    throw new PermissionError('No role assigned to this principal');
  }

  const roleTarget = await prisma.roleTarget.findFirst({
    where:
      auth.tokenType === 'API_KEY'
        ? { workspaceId: auth.workspaceId, apiKeyId: principalId }
        : { workspaceId: auth.workspaceId, userWorkspaceId: principalId },
    select: { roleId: true },
  });
  if (!roleTarget) {
    throw new PermissionError('No role assigned to this principal');
  }
  return roleTarget.roleId;
};

const loadRole = async (
  roleId: string,
  workspaceId: string,
): Promise<RoleFlags> => {
  const role = await prisma.role.findFirst({
    where: { id: roleId, workspaceId },
    select: {
      canReadAllObjectRecords: true,
      canUpdateAllObjectRecords: true,
      canSoftDeleteAllObjectRecords: true,
      canDestroyAllObjectRecords: true,
      canUpdateAllSettings: true,
    },
  });
  if (!role) {
    throw new PermissionError('Role not found');
  }
  return role;
};

export const assertObjectPermission = async (
  auth: AuthContext,
  target: { nameSingular: string } | { objectMetadataId: string },
  operation: ObjectOperation,
): Promise<void> => {
  const roleId = await resolveRoleId(auth);
  const role = await loadRole(roleId, auth.workspaceId);

  const object = await prisma.objectMetadata.findFirst({
    where: {
      workspaceId: auth.workspaceId,
      ...('nameSingular' in target
        ? { nameSingular: target.nameSingular }
        : { id: target.objectMetadataId }),
    },
    select: { id: true, nameSingular: true, isSystem: true },
  });
  if (!object) {
    throw new PermissionError('Object not found in this workspace');
  }

  // System objects (except workspaceMember) skip record-permission checks (upstream fidelity).
  if (object.isSystem && object.nameSingular !== 'workspaceMember') {
    return;
  }

  const override = await prisma.objectPermission.findFirst({
    where: { roleId, objectMetadataId: object.id },
    select: {
      canReadObjectRecords: true,
      canUpdateObjectRecords: true,
      canSoftDeleteObjectRecords: true,
      canDestroyObjectRecords: true,
    },
  });

  // override wins only when non-null; null/undefined falls back to the role default. `??`, never `||`.
  // create and update share canUpdate (upstream has no separate create flag).
  const decision: Record<
    ObjectOperation,
    { override: boolean | null | undefined; fallback: boolean }
  > = {
    read: {
      override: override?.canReadObjectRecords,
      fallback: role.canReadAllObjectRecords,
    },
    create: {
      override: override?.canUpdateObjectRecords,
      fallback: role.canUpdateAllObjectRecords,
    },
    update: {
      override: override?.canUpdateObjectRecords,
      fallback: role.canUpdateAllObjectRecords,
    },
    softDelete: {
      override: override?.canSoftDeleteObjectRecords,
      fallback: role.canSoftDeleteAllObjectRecords,
    },
    destroy: {
      override: override?.canDestroyObjectRecords,
      fallback: role.canDestroyAllObjectRecords,
    },
  };

  const { override: overrideValue, fallback } = decision[operation];
  if (!(overrideValue ?? fallback)) {
    throw new PermissionError('Permission denied');
  }
};

export const assertSettingsPermission = async (
  auth: AuthContext,
  flag: 'canUpdateAllSettings',
): Promise<void> => {
  const roleId = await resolveRoleId(auth);
  const role = await loadRole(roleId, auth.workspaceId);
  if (!role[flag]) {
    throw new PermissionError('Permission denied');
  }
};
