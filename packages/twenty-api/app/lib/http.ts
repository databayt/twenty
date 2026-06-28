import { NextResponse, type NextRequest } from 'next/server';

import { authenticateRequest, AuthError, type AuthContext } from './auth';
import {
  assertObjectPermission,
  PermissionError,
  type ObjectOperation,
} from './permissions';

// Shared route guards reused by every native REST handler. authOrResponse returns the AuthContext or a
// 401/404 NextResponse; permitOrResponse returns a 403 NextResponse on a denied object permission, or
// null when allowed. Keeping both here keeps the route files DRY and consistent.

export const authOrResponse = async (
  request: NextRequest,
): Promise<AuthContext | NextResponse> => {
  try {
    return await authenticateRequest(request);
  } catch (error) {
    const authError =
      error instanceof AuthError ? error : new AuthError('Unauthorized');
    return NextResponse.json({ error: authError.message }, { status: authError.status });
  }
};

export const permitOrResponse = async (
  ctx: AuthContext,
  nameSingular: string,
  operation: ObjectOperation,
): Promise<NextResponse | null> => {
  try {
    await assertObjectPermission(ctx, { nameSingular }, operation);
    return null;
  } catch (error) {
    if (error instanceof PermissionError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
};
