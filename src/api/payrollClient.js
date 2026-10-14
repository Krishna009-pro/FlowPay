async function request(path, { method = 'GET', body, fetchImpl = globalThis.fetch } = {}) {
  const response = await fetchImpl(path, {
    method,
    credentials: 'same-origin',
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  let data = {};
  try { data = await response.json(); } catch { /* use generic status below */ }
  if (!response.ok) {
    const error = new Error(data.error || `Payroll API request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export function createPayrollClient({ fetchImpl = globalThis.fetch } = {}) {
  return {
    organizations: () => request('/api/organizations', { fetchImpl }),
    employeeOrganizations: () => request('/api/employee/organizations', { fetchImpl }),
    createOrganization: (legalName) => request('/api/organizations', { method: 'POST', body: { legalName }, fetchImpl }),
    employees: (organizationId) => request(`/api/organizations/${organizationId}/employees`, { fetchImpl }),
    createEmployee: (organizationId, employee) => request(`/api/organizations/${organizationId}/employees`, { method: 'POST', body: employee, fetchImpl }),
    approveEmployee: (organizationId, employeeId) => request(`/api/organizations/${organizationId}/employees/${employeeId}/approve`, { method: 'POST', body: {}, fetchImpl }),
    compensationTerms: (organizationId, employeeId) => request(`/api/organizations/${organizationId}/employees/${employeeId}/compensation`, { fetchImpl }),
    proposeCompensation: (organizationId, employeeId, term) => request(`/api/organizations/${organizationId}/employees/${employeeId}/compensation`, { method: 'POST', body: term, fetchImpl }),
    approveCompensation: (organizationId, termId) => request(`/api/organizations/${organizationId}/compensation/${termId}/approve`, { method: 'POST', body: {}, fetchImpl }),
    periods: (organizationId) => request(`/api/organizations/${organizationId}/payroll-periods`, { fetchImpl }),
    members: (organizationId) => request(`/api/organizations/${organizationId}/members`, { fetchImpl }),
    inviteMember: (organizationId, invitation) => request(`/api/organizations/${organizationId}/invitations`, { method: 'POST', body: invitation, fetchImpl }),
    acceptInvitation: (organizationId) => request(`/api/organizations/${organizationId}/invitations/accept`, { method: 'POST', body: {}, fetchImpl }),
    revokeMember: (organizationId, walletAddress) => request(`/api/organizations/${organizationId}/members/revoke`, { method: 'POST', body: { walletAddress }, fetchImpl }),
    createPeriod: (organizationId, period) => request(`/api/organizations/${organizationId}/payroll-periods`, { method: 'POST', body: period, fetchImpl }),
    claimPolicies: (organizationId) => request(`/api/organizations/${organizationId}/claim-policies`, { fetchImpl }),
    proposeClaimPolicy: (organizationId, policy) => request(`/api/organizations/${organizationId}/claim-policy`, { method: 'POST', body: policy, fetchImpl }),
    approveClaimPolicy: (organizationId, policyId) => request(`/api/organizations/${organizationId}/claim-policy/${policyId}/approve`, { method: 'POST', body: {}, fetchImpl }),
    payrollRuns: (organizationId) => request(`/api/organizations/${organizationId}/payroll-runs`, { fetchImpl }),
    createPayrollRun: (organizationId, periodId, run) => request(`/api/organizations/${organizationId}/payroll-periods/${periodId}/runs`, { method: 'POST', body: run, fetchImpl }),
    submitPayrollRun: (organizationId, runId) => request(`/api/organizations/${organizationId}/payroll-runs/${runId}/submit`, { method: 'POST', body: {}, fetchImpl }),
    approvePayrollRun: (organizationId, runId) => request(`/api/organizations/${organizationId}/payroll-runs/${runId}/approve`, { method: 'POST', body: {}, fetchImpl }),
    claims: (organizationId) => request(`/api/organizations/${organizationId}/claims/me`, { fetchImpl }),
    requestClaim: (organizationId, claim) => request(`/api/organizations/${organizationId}/claims`, { method: 'POST', body: claim, fetchImpl }),
    organizationClaims: (organizationId) => request(`/api/organizations/${organizationId}/claims`, { fetchImpl }),
    decideClaim: (organizationId, claimId, decision) => request(`/api/organizations/${organizationId}/claims/${claimId}/decision`, { method: 'POST', body: { decision }, fetchImpl }),
    dispatchFakePayout: (organizationId) => request('/api/dev/fake-payout/dispatch-one', { method: 'POST', body: { organizationId }, fetchImpl }),
    reconcileFakePayout: (organizationId, claimId) => request(`/api/dev/fake-payout/${organizationId}/${claimId}/reconcile`, { method: 'POST', body: {}, fetchImpl }),
    createSyntheticRecipient: (organizationId, employeeId) => request(`/api/dev/synthetic/organizations/${organizationId}/employees/${employeeId}/fake-recipient`, { method: 'POST', body: {}, fetchImpl }),
    accrueSyntheticEstimate: (organizationId, employeeId, periodId) => request(`/api/dev/synthetic/organizations/${organizationId}/employees/${employeeId}/periods/${periodId}/accrue`, { method: 'POST', body: {}, fetchImpl }),
    signOut: () => request('/api/auth/logout', { method: 'POST', fetchImpl }),
    session: async () => {
      try { return await request('/api/auth/session', { fetchImpl }); }
      catch (error) { if (error.status === 401) return null; throw error; }
    },
    signIn: async ({ walletAddress, signMessage }) => {
      const challenge = await request('/api/auth/challenge', { method: 'POST', body: { walletAddress }, fetchImpl });
      const signature = await signMessage(challenge.message);
      return request('/api/auth/verify', { method: 'POST', body: { message: challenge.message, signature }, fetchImpl });
    },
  };
}
