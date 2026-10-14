import { resolveWalletSession } from '../auth/challenges.js';
import { readSessionCookie } from './auth.js';
import { createOrganization } from '../repositories/organization.js';
import { approveEmployeeCreation, createEmployee, listEmployees } from '../repositories/employee.js';
import { approveCompensationTerm, listCompensationTerms, proposeCompensationTerm } from '../repositories/compensation.js';
import { approvePayrollRun, createPayrollRun, getPayrollRun, listPayrollRuns, submitPayrollRun } from '../repositories/payrollRuns.js';
import { approveClaimPolicy, getApprovedClaimPolicy, listClaimPolicies, proposeClaimPolicy } from '../repositories/claimPolicies.js';
import { decideExceptionalClaim, listEmployeeClaims, listOrganizationClaims, requestEmployeeClaim } from '../repositories/claims.js';
import { closePayrollPeriod, createPayrollPeriod, listPayrollPeriods } from '../repositories/payrollPeriods.js';
import { acceptMemberInvitation, createMemberInvitation, listOrganizationMembers, revokeMember } from '../repositories/memberships.js';
import { accrueSyntheticEstimate, createSyntheticRecipient } from '../repositories/syntheticPayroll.js';
import { dispatchNextPayout, reconcileFakePayout } from '../payout/outboxWorker.js';

const UUID = { type: 'string', format: 'uuid' };
const INCOME = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER };

function requireSession(database, allowedOrigins) {
  return async (request, reply) => {
    try {
      const session = await resolveWalletSession(database.pool, readSessionCookie(request.headers.cookie));
      if (request.method !== 'GET') {
        if (!allowedOrigins.includes(request.headers.origin) || request.headers.origin !== session.origin) {
          return reply.code(403).send({ error: 'origin_not_allowed' });
        }
      } else if (request.headers.origin && request.headers.origin !== session.origin) {
        return reply.code(403).send({ error: 'origin_not_allowed' });
      }
      request.flowPayWallet = session.walletAddress;
    } catch {
      return reply.code(401).send({ error: 'wallet_session_required' });
    }
  };
}

function routeFailure(reply, error) {
  const message = error?.message ?? '';
  if (/membership|required|authorized|approver|operator|employee wallet is not linked/i.test(message)) {
    return reply.code(403).send({ error: 'forbidden' });
  }
  if (/available balance|payroll period|payroll policy|rules|snapshot|pending|closed|idempotency|claim|compensation|employee change|payout recipient|effective|invitation|already|revoked|overlap|changed before|has not ended/i.test(message)) {
    return reply.code(409).send({ error: 'request_conflict' });
  }
  if (/not found|unavailable/i.test(message)) return reply.code(404).send({ error: 'not_found' });
  if (error instanceof TypeError || error instanceof RangeError) {
    return reply.code(400).send({ error: 'invalid_request' });
  }
  return reply.code(500).send({ error: 'request_failed' });
}

export function registerPayrollRoutes(app, { database, allowedOrigins, rulesProvider = null, fakeProvider = null, nodeEnv = 'development' }) {
  const authenticated = requireSession(database, allowedOrigins);
  const organizationParams = { type: 'object', required: ['organizationId'], properties: { organizationId: UUID }, additionalProperties: false };

  app.post('/api/organizations', {
    preHandler: authenticated,
    schema: { body: { type: 'object', required: ['legalName'], additionalProperties: false, properties: { legalName: { type: 'string', minLength: 1, maxLength: 200 } } } },
  }, async (request, reply) => {
    try {
      const organization = await createOrganization(database.pool, {
        legalName: request.body.legalName,
        ownerWallet: request.flowPayWallet,
        requestId: request.id,
      });
      return reply.code(201).send(organization);
    } catch (error) { return routeFailure(reply, error); }
  });

  app.get('/api/organizations', { preHandler: authenticated }, async (request, reply) => {
    try {
      const result = await database.pool.query(
        `SELECT o.id, o.legal_name AS "legalName", o.status, m.role
         FROM organization_memberships m JOIN organizations o ON o.id = m.organization_id
         WHERE m.wallet_address = $1 AND m.status = 'active' AND o.status = 'active'
         ORDER BY o.created_at, o.id`,
        [request.flowPayWallet],
      );
      return { organizations: result.rows };
    } catch { return reply.code(500).send({ error: 'request_failed' }); }
  });

  app.get('/api/employee/organizations', { preHandler: authenticated }, async (request, reply) => {
    try {
      const result = await database.pool.query(
        `SELECT e.organization_id AS id, o.legal_name AS "legalName", e.employee_ref AS "employeeRef"
         FROM employees e JOIN organizations o ON o.id = e.organization_id
         WHERE e.wallet_address = $1 AND e.status = 'active' AND o.status = 'active'
         ORDER BY o.created_at, e.employee_ref`,
        [request.flowPayWallet],
      );
      return { organizations: result.rows };
    } catch { return reply.code(500).send({ error: 'request_failed' }); }
  });

  app.get('/api/organizations/:organizationId/members', {
    preHandler: authenticated, schema: { params: organizationParams },
  }, async (request, reply) => {
    try {
      return { members: await listOrganizationMembers(database.pool, {
        organizationId: request.params.organizationId, actorWallet: request.flowPayWallet,
      }) };
    } catch (error) { return routeFailure(reply, error); }
  });

  app.post('/api/organizations/:organizationId/invitations', {
    preHandler: authenticated,
    schema: { params: organizationParams, body: { type: 'object', required: ['walletAddress', 'role'], additionalProperties: false,
      properties: { walletAddress: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' }, role: { type: 'string', enum: ['payroll_operator', 'payroll_approver', 'payout_executor'] } } } },
  }, async (request, reply) => {
    try {
      const invitation = await createMemberInvitation(database.pool, {
        organizationId: request.params.organizationId, actorWallet: request.flowPayWallet,
        ...request.body, requestId: request.id,
      });
      return reply.code(201).send(invitation);
    } catch (error) { return routeFailure(reply, error); }
  });

  app.post('/api/organizations/:organizationId/invitations/accept', {
    preHandler: authenticated, schema: { params: organizationParams, body: { type: 'object', additionalProperties: false } },
  }, async (request, reply) => {
    try {
      return await acceptMemberInvitation(database.pool, {
        organizationId: request.params.organizationId, walletAddress: request.flowPayWallet, requestId: request.id,
      });
    } catch (error) { return routeFailure(reply, error); }
  });

  app.post('/api/organizations/:organizationId/members/revoke', {
    preHandler: authenticated,
    schema: { params: organizationParams, body: { type: 'object', required: ['walletAddress'], additionalProperties: false,
      properties: { walletAddress: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' } } } },
  }, async (request, reply) => {
    try {
      return await revokeMember(database.pool, {
        organizationId: request.params.organizationId, targetWallet: request.body.walletAddress,
        actorWallet: request.flowPayWallet, requestId: request.id,
      });
    } catch (error) { return routeFailure(reply, error); }
  });

  app.post('/api/organizations/:organizationId/employees', {
    preHandler: authenticated,
    schema: {
      params: organizationParams,
      body: { type: 'object', required: ['employeeRef', 'displayName'], additionalProperties: false, properties: {
        employeeRef: { type: 'string', minLength: 1, maxLength: 100 },
        displayName: { type: 'string', minLength: 1, maxLength: 200 },
        employeeWallet: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' },
      } },
    },
  }, async (request, reply) => {
    try {
      const employee = await createEmployee(database.pool, {
        organizationId: request.params.organizationId,
        actorWallet: request.flowPayWallet,
        employeeRef: request.body.employeeRef,
        displayName: request.body.displayName,
        employeeWallet: request.body.employeeWallet ?? null,
        requestId: request.id,
      });
      return reply.code(202).send(employee);
    } catch (error) { return routeFailure(reply, error); }
  });

  app.get('/api/organizations/:organizationId/employees', {
    preHandler: authenticated,
    schema: { params: organizationParams },
  }, async (request, reply) => {
    try {
      return { employees: await listEmployees(database.pool, { organizationId: request.params.organizationId, actorWallet: request.flowPayWallet }) };
    } catch (error) { return routeFailure(reply, error); }
  });

  app.post('/api/organizations/:organizationId/employees/:employeeId/approve', {
    preHandler: authenticated,
    schema: { params: { type: 'object', required: ['organizationId', 'employeeId'], properties: { organizationId: UUID, employeeId: UUID }, additionalProperties: false }, body: { type: 'object', additionalProperties: false } },
  }, async (request, reply) => {
    try {
      const employee = await approveEmployeeCreation(database.pool, {
        organizationId: request.params.organizationId, employeeId: request.params.employeeId,
        actorWallet: request.flowPayWallet, requestId: request.id,
      });
      return employee;
    } catch (error) { return routeFailure(reply, error); }
  });

  app.post('/api/organizations/:organizationId/employees/:employeeId/compensation', {
    preHandler: authenticated,
    schema: {
      params: { type: 'object', required: ['organizationId', 'employeeId'], properties: { organizationId: UUID, employeeId: UUID }, additionalProperties: false },
      body: { type: 'object', required: ['periodGrossPaise', 'periodKind', 'effectiveFrom'], additionalProperties: false, properties: {
        periodGrossPaise: INCOME,
        periodKind: { type: 'string', enum: ['monthly', 'weekly', 'daily', 'custom'] },
        effectiveFrom: { type: 'string', format: 'date-time' },
        effectiveTo: { type: 'string', format: 'date-time' },
      } },
    },
  }, async (request, reply) => {
    try {
      const term = await proposeCompensationTerm(database.pool, {
        organizationId: request.params.organizationId, employeeId: request.params.employeeId,
        actorWallet: request.flowPayWallet, ...request.body, requestId: request.id,
      });
      return reply.code(202).send(term);
    } catch (error) { return routeFailure(reply, error); }
  });

  app.get('/api/organizations/:organizationId/employees/:employeeId/compensation', {
    preHandler: authenticated,
    schema: { params: { type: 'object', required: ['organizationId', 'employeeId'], properties: { organizationId: UUID, employeeId: UUID }, additionalProperties: false } },
  }, async (request, reply) => {
    try {
      return { terms: await listCompensationTerms(database.pool, {
        organizationId: request.params.organizationId, employeeId: request.params.employeeId, actorWallet: request.flowPayWallet,
      }) };
    } catch (error) { return routeFailure(reply, error); }
  });

  app.post('/api/organizations/:organizationId/compensation/:termId/approve', {
    preHandler: authenticated,
    schema: { params: { type: 'object', required: ['organizationId', 'termId'], properties: { organizationId: UUID, termId: UUID }, additionalProperties: false }, body: { type: 'object', additionalProperties: false } },
  }, async (request, reply) => {
    try {
      return await approveCompensationTerm(database.pool, {
        organizationId: request.params.organizationId, termId: request.params.termId,
        actorWallet: request.flowPayWallet, requestId: request.id,
      });
    } catch (error) { return routeFailure(reply, error); }
  });

  app.post('/api/organizations/:organizationId/claim-policy', {
    preHandler: authenticated,
    schema: { params: organizationParams, body: { type: 'object', required: [
      'version', 'minimumClaimPaise', 'maximumClaimPaise', 'maximumDailyClaims', 'maximumMonthlyClaims', 'autoPayMaximumPaise',
    ], additionalProperties: false, properties: {
      version: { type: 'string', minLength: 1, maxLength: 64 },
      minimumClaimPaise: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
      maximumClaimPaise: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
      maximumDailyClaims: { type: 'integer', minimum: 1, maximum: 1000 },
      maximumMonthlyClaims: { type: 'integer', minimum: 1, maximum: 10000 },
      autoPayMaximumPaise: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    } } },
  }, async (request, reply) => {
    try {
      const policy = await proposeClaimPolicy(database.pool, {
        organizationId: request.params.organizationId, actorWallet: request.flowPayWallet,
        requestId: request.id, ...request.body,
      });
      return reply.code(202).send(policy);
    } catch (error) { return routeFailure(reply, error); }
  });

  app.post('/api/organizations/:organizationId/claim-policy/:policyId/approve', {
    preHandler: authenticated,
    schema: { params: { type: 'object', required: ['organizationId', 'policyId'], properties: { organizationId: UUID, policyId: UUID }, additionalProperties: false }, body: { type: 'object', additionalProperties: false } },
  }, async (request, reply) => {
    try {
      return await approveClaimPolicy(database.pool, {
        organizationId: request.params.organizationId, policyId: request.params.policyId,
        actorWallet: request.flowPayWallet, requestId: request.id,
      });
    } catch (error) { return routeFailure(reply, error); }
  });

  app.get('/api/organizations/:organizationId/claim-policy', {
    preHandler: authenticated, schema: { params: organizationParams },
  }, async (request, reply) => {
    try {
      const policy = await getApprovedClaimPolicy(database.pool, {
        organizationId: request.params.organizationId, actorWallet: request.flowPayWallet,
      });
      return { policy };
    } catch (error) { return routeFailure(reply, error); }
  });

  app.get('/api/organizations/:organizationId/claim-policies', {
    preHandler: authenticated, schema: { params: organizationParams },
  }, async (request, reply) => {
    try {
      return { policies: await listClaimPolicies(database.pool, {
        organizationId: request.params.organizationId, actorWallet: request.flowPayWallet,
      }) };
    } catch (error) { return routeFailure(reply, error); }
  });

  app.get('/api/organizations/:organizationId/payroll-periods', {
    preHandler: authenticated, schema: { params: organizationParams },
  }, async (request, reply) => {
    try {
      return { periods: await listPayrollPeriods(database.pool, {
        organizationId: request.params.organizationId, actorWallet: request.flowPayWallet,
      }) };
    } catch (error) { return routeFailure(reply, error); }
  });

  app.post('/api/organizations/:organizationId/payroll-periods', {
    preHandler: authenticated,
    schema: { params: organizationParams, body: {
      type: 'object', required: ['startsAt', 'endsAt'], additionalProperties: false,
      properties: { startsAt: { type: 'string', format: 'date-time' }, endsAt: { type: 'string', format: 'date-time' } },
    } },
  }, async (request, reply) => {
    try {
      const period = await createPayrollPeriod(database.pool, {
        organizationId: request.params.organizationId, actorWallet: request.flowPayWallet,
        ...request.body, requestId: request.id,
      });
      return reply.code(201).send(period);
    } catch (error) { return routeFailure(reply, error); }
  });

  app.post('/api/organizations/:organizationId/payroll-periods/:periodId/close', {
    preHandler: authenticated,
    schema: { params: { type: 'object', required: ['organizationId', 'periodId'], properties: { organizationId: UUID, periodId: UUID }, additionalProperties: false }, body: { type: 'object', additionalProperties: false } },
  }, async (request, reply) => {
    try {
      return await closePayrollPeriod(database.pool, {
        organizationId: request.params.organizationId, periodId: request.params.periodId,
        actorWallet: request.flowPayWallet, requestId: request.id,
      });
    } catch (error) { return routeFailure(reply, error); }
  });

  app.post('/api/organizations/:organizationId/payroll-periods/:periodId/runs', {
    preHandler: authenticated,
    schema: { params: { type: 'object', required: ['organizationId', 'periodId'], properties: { organizationId: UUID, periodId: UUID }, additionalProperties: false }, body: {
      type: 'object', required: ['rulesVersion', 'snapshot'], additionalProperties: false,
      properties: { rulesVersion: { type: 'string', minLength: 1, maxLength: 100 }, snapshot: { type: 'object' } },
    } },
  }, async (request, reply) => {
    try {
      const run = await createPayrollRun(database.pool, {
        organizationId: request.params.organizationId, periodId: request.params.periodId,
        actorWallet: request.flowPayWallet, ...request.body, requestId: request.id,
      });
      return reply.code(201).send(run);
    } catch (error) { return routeFailure(reply, error); }
  });

  app.get('/api/organizations/:organizationId/payroll-runs', {
    preHandler: authenticated, schema: { params: organizationParams },
  }, async (request, reply) => {
    try {
      return { runs: await listPayrollRuns(database.pool, {
        organizationId: request.params.organizationId, actorWallet: request.flowPayWallet,
      }) };
    } catch (error) { return routeFailure(reply, error); }
  });

  app.post('/api/organizations/:organizationId/payroll-runs/:runId/submit', {
    preHandler: authenticated,
    schema: { params: { type: 'object', required: ['organizationId', 'runId'], properties: { organizationId: UUID, runId: UUID }, additionalProperties: false }, body: { type: 'object', additionalProperties: false } },
  }, async (request, reply) => {
    try {
      return await submitPayrollRun(database.pool, {
        organizationId: request.params.organizationId, runId: request.params.runId,
        actorWallet: request.flowPayWallet, requestId: request.id,
      });
    } catch (error) { return routeFailure(reply, error); }
  });

  app.post('/api/organizations/:organizationId/payroll-runs/:runId/approve', {
    preHandler: authenticated,
    schema: { params: { type: 'object', required: ['organizationId', 'runId'], properties: { organizationId: UUID, runId: UUID }, additionalProperties: false }, body: { type: 'object', additionalProperties: false } },
  }, async (request, reply) => {
    try {
      return await approvePayrollRun(database.pool, {
        organizationId: request.params.organizationId, runId: request.params.runId,
        actorWallet: request.flowPayWallet, requestId: request.id, rulesProvider,
      });
    } catch (error) {
      if (/approval blocked: no approved India payroll rules are configured|approval blocked: an approved India payroll rules version is required/i.test(error?.message ?? '')) {
        return reply.code(409).send({ error: 'india_rules_unconfigured' });
      }
      return routeFailure(reply, error);
    }
  });

  app.get('/api/organizations/:organizationId/payroll-runs/:runId', {
    preHandler: authenticated,
    schema: { params: { type: 'object', required: ['organizationId', 'runId'], properties: { organizationId: UUID, runId: UUID }, additionalProperties: false } },
  }, async (request, reply) => {
    try {
      const run = await getPayrollRun(database.pool, {
        organizationId: request.params.organizationId, runId: request.params.runId, actorWallet: request.flowPayWallet,
      });
      return run ? { run } : reply.code(404).send({ error: 'not_found' });
    } catch (error) { return routeFailure(reply, error); }
  });

  app.post('/api/organizations/:organizationId/claims', {
    preHandler: authenticated,
    schema: { params: organizationParams, body: {
      type: 'object', required: ['requestedPaise', 'idempotencyKey'], additionalProperties: false,
      properties: {
        requestedPaise: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
        idempotencyKey: { type: 'string', minLength: 8, maxLength: 200 },
      },
    } },
  }, async (request, reply) => {
    try {
      const claim = await requestEmployeeClaim(database.pool, {
        organizationId: request.params.organizationId, walletAddress: request.flowPayWallet,
        requestedPaise: request.body.requestedPaise, idempotencyKey: request.body.idempotencyKey,
        requestId: request.id,
      });
      return reply.code(claim.idempotentReplay ? 200 : 202).send(claim);
    } catch (error) { return routeFailure(reply, error); }
  });

  app.get('/api/organizations/:organizationId/claims', {
    preHandler: authenticated,
    schema: { params: organizationParams, querystring: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 200 } }, additionalProperties: false } },
  }, async (request, reply) => {
    try {
      return { claims: await listOrganizationClaims(database.pool, {
        organizationId: request.params.organizationId, actorWallet: request.flowPayWallet,
        limit: request.query.limit ?? 100,
      }) };
    } catch (error) { return routeFailure(reply, error); }
  });

  app.get('/api/organizations/:organizationId/claims/me', {
    preHandler: authenticated,
    schema: { params: organizationParams, querystring: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 } }, additionalProperties: false } },
  }, async (request, reply) => {
    try {
      return { claims: await listEmployeeClaims(database.pool, {
        organizationId: request.params.organizationId, walletAddress: request.flowPayWallet,
        limit: request.query.limit ?? 50,
      }) };
    } catch (error) { return routeFailure(reply, error); }
  });

  app.post('/api/organizations/:organizationId/claims/:claimId/decision', {
    preHandler: authenticated,
    schema: { params: { type: 'object', required: ['organizationId', 'claimId'], properties: { organizationId: UUID, claimId: UUID }, additionalProperties: false }, body: {
      type: 'object', required: ['decision'], additionalProperties: false,
      properties: { decision: { type: 'string', enum: ['approve', 'reject'] } },
    } },
  }, async (request, reply) => {
    try {
      return await decideExceptionalClaim(database.pool, {
        organizationId: request.params.organizationId, claimId: request.params.claimId,
        actorWallet: request.flowPayWallet, decision: request.body.decision, requestId: request.id,
      });
    } catch (error) { return routeFailure(reply, error); }
  });

  if (nodeEnv !== 'production' && fakeProvider) {
    app.post('/api/dev/synthetic/organizations/:organizationId/employees/:employeeId/fake-recipient', {
      preHandler: authenticated,
      schema: { params: { type: 'object', required: ['organizationId', 'employeeId'], properties: { organizationId: UUID, employeeId: UUID }, additionalProperties: false }, body: { type: 'object', additionalProperties: false } },
    }, async (request, reply) => {
      try {
        return await createSyntheticRecipient(database.pool, {
          organizationId: request.params.organizationId, employeeId: request.params.employeeId,
          actorWallet: request.flowPayWallet, requestId: request.id,
        });
      } catch (error) { return routeFailure(reply, error); }
    });

    app.post('/api/dev/synthetic/organizations/:organizationId/employees/:employeeId/periods/:periodId/accrue', {
      preHandler: authenticated,
      schema: { params: { type: 'object', required: ['organizationId', 'employeeId', 'periodId'], properties: { organizationId: UUID, employeeId: UUID, periodId: UUID }, additionalProperties: false }, body: { type: 'object', additionalProperties: false } },
    }, async (request, reply) => {
      try {
        return await accrueSyntheticEstimate(database.pool, {
          organizationId: request.params.organizationId, employeeId: request.params.employeeId,
          periodId: request.params.periodId, actorWallet: request.flowPayWallet, requestId: request.id,
        });
      } catch (error) { return routeFailure(reply, error); }
    });

    app.post('/api/dev/fake-payout/dispatch-one', {
      preHandler: authenticated,
      schema: { body: { type: 'object', required: ['organizationId'], additionalProperties: false, properties: { organizationId: UUID } } },
    }, async (request, reply) => {
      try {
        const executor = await database.pool.query(
          `SELECT 1 FROM organization_memberships m JOIN organizations o ON o.id = m.organization_id
           WHERE m.organization_id = $1 AND m.wallet_address = $2 AND m.status = 'active'
             AND o.status = 'active' AND m.role = ANY($3::text[])`,
          [request.body.organizationId, request.flowPayWallet, ['owner', 'payout_executor']],
        );
        if (executor.rowCount !== 1) return reply.code(403).send({ error: 'forbidden' });
        const result = await dispatchNextPayout(database.pool, fakeProvider, { organizationId: request.body.organizationId });
        return result ?? reply.code(204).send();
      } catch { return reply.code(500).send({ error: 'fake_payout_dispatch_failed' }); }
    });

    app.post('/api/dev/fake-payout/:organizationId/:claimId/reconcile', {
      preHandler: authenticated,
      schema: { params: { type: 'object', required: ['organizationId', 'claimId'], properties: { organizationId: UUID, claimId: UUID }, additionalProperties: false }, body: { type: 'object', additionalProperties: false } },
    }, async (request, reply) => {
      try {
        const executor = await database.pool.query(
          `SELECT 1 FROM organization_memberships m JOIN organizations o ON o.id = m.organization_id
           WHERE m.organization_id = $1 AND m.wallet_address = $2 AND m.status = 'active'
             AND o.status = 'active' AND m.role = ANY($3::text[])`,
          [request.params.organizationId, request.flowPayWallet, ['owner', 'payout_executor']],
        );
        if (executor.rowCount !== 1) return reply.code(403).send({ error: 'forbidden' });
        const attempt = await database.pool.query(
          `SELECT provider_idempotency_key FROM payout_attempts
           WHERE organization_id = $1 AND claim_id = $2 AND provider_key = 'fake'
           ORDER BY attempt_number DESC LIMIT 1`,
          [request.params.organizationId, request.params.claimId],
        );
        if (!attempt.rows[0]) return reply.code(404).send({ error: 'not_found' });
        return await reconcileFakePayout(database.pool, fakeProvider, {
          organizationId: request.params.organizationId, commandKey: attempt.rows[0].provider_idempotency_key,
        });
      } catch (error) { return routeFailure(reply, error); }
    });
  }
}
