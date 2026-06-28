import { GraphQLError, GraphQLScalarType } from 'graphql';
import { createSchema, createYoga, type YogaInitialContext } from 'graphql-yoga';
import { type NextRequest } from 'next/server';

import { authenticateRequest, AuthError, type AuthContext } from '../lib/auth';
import { assertObjectPermission, PermissionError } from '../lib/permissions';
import {
  listWorkspaceCompanies,
  type WorkspaceCompany,
} from '../lib/workspace';

// Slice 5 (GraphQL milestone — first increment): a NATIVE graphql-yoga endpoint serving one real
// authenticated query, proving Yoga + the Slice 2 auth + the Prisma/tenant spine run natively. It
// lives at /graphql-native — the real /graphql stays PROXIED to legacy, because the SPA's codegen
// needs twenty's full metadata-driven dynamic schema (a partial native schema there would break the
// app). The native schema grows here incrementally until it can someday replace /graphql wholesale.
// jsonwebtoken + node:crypto + Prisma raw queries are not edge-safe.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type GraphQLContext = { auth: AuthContext };

const dateTimeScalar = new GraphQLScalarType<Date | string, string>({
  name: 'DateTime',
  serialize: (value: unknown): string =>
    value instanceof Date ? value.toISOString() : String(value),
});

const schema = createSchema<GraphQLContext>({
  typeDefs: /* GraphQL */ `
    scalar DateTime

    type Company {
      id: ID!
      name: String
      createdAt: DateTime!
    }

    type CompanyEdge {
      node: Company!
      cursor: String!
    }

    type PageInfo {
      hasNextPage: Boolean!
      hasPreviousPage: Boolean!
      startCursor: String
      endCursor: String
    }

    type CompanyConnection {
      edges: [CompanyEdge!]!
      pageInfo: PageInfo!
      totalCount: Int
    }

    type Query {
      companies(first: Int): CompanyConnection!
    }
  `,
  resolvers: {
    DateTime: dateTimeScalar,
    Query: {
      companies: async (
        _parent: unknown,
        args: { first?: number | null },
        context: GraphQLContext,
      ): Promise<{
        edges: { node: WorkspaceCompany; cursor: string }[];
        pageInfo: {
          hasNextPage: boolean;
          hasPreviousPage: boolean;
          startCursor: string | null;
          endCursor: string | null;
        };
        totalCount: number;
      }> => {
        try {
          await assertObjectPermission(
            context.auth,
            { nameSingular: 'company' },
            'read',
          );
        } catch (error) {
          if (error instanceof PermissionError) {
            throw new GraphQLError(error.message, {
              extensions: { code: 'FORBIDDEN', http: { status: error.status } },
            });
          }
          throw error;
        }

        const rows = await listWorkspaceCompanies(
          context.auth.databaseSchema,
          args.first ?? 50,
        );
        return {
          edges: rows.map((node) => ({ node, cursor: node.id })),
          pageInfo: {
            hasNextPage: false,
            hasPreviousPage: false,
            startCursor: null,
            endCursor: null,
          },
          totalCount: rows.length,
        };
      },
    },
  },
});

const { handleRequest } = createYoga<object, GraphQLContext>({
  schema,
  graphqlEndpoint: '/graphql-native',
  fetchAPI: { Response },
  graphiql: process.env.NODE_ENV !== 'production',
  // Fail-closed auth in the context factory — gates queries AND introspection (backend-only endpoint).
  // Throw GraphQLError (not a plain Error) so Yoga surfaces the real 401/404 instead of masking it.
  context: async ({ request }: YogaInitialContext): Promise<GraphQLContext> => {
    try {
      return { auth: await authenticateRequest(request as NextRequest) };
    } catch (error) {
      const status = error instanceof AuthError ? error.status : 401;
      const message =
        error instanceof AuthError ? error.message : 'Unauthorized';
      throw new GraphQLError(message, {
        extensions: { code: 'UNAUTHENTICATED', http: { status } },
      });
    }
  },
});

export { handleRequest as GET, handleRequest as POST, handleRequest as OPTIONS };
