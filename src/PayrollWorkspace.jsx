import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Check, CircleHelp, Clock3, LogIn, LogOut, Plus, RefreshCw, ShieldCheck } from 'lucide-react';
import { createPayrollAuthClient } from './api/payrollAuth.js';
import { createPayrollClient } from './api/payrollClient.js';

const auth = createPayrollAuthClient();
const payroll = createPayrollClient();

function shortWallet(wallet) { return wallet ? `${wallet.slice(0, 6)}…${wallet.slice(-4)}` : '—'; }
function formatPaise(paise) {
  if (!Number.isSafeInteger(paise)) return '—';
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function parseRupees(value) {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,2}))?$/.exec(value.trim());
  if (!match) throw new TypeError('Enter a rupee amount with up to two decimal places.');
  const amount = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new RangeError('Amount must be positive and within the supported range.');
  return amount;
}
function indiaDate(value) {
  if (!value) return '—';
  return new Date(value).toLocaleDateString('en-IN', { dateStyle: 'medium', timeZone: 'Asia/Kolkata' });
}

export default function PayrollWorkspace({ wallet, onConnect }) {
  const [session, setSession] = useState(null);
  const [organizations, setOrganizations] = useState([]);
  const [employeeOrganizations, setEmployeeOrganizations] = useState([]);
  const [employeeClaims, setEmployeeClaims] = useState({});
  const [organizationId, setOrganizationId] = useState('');
  const [employees, setEmployees] = useState([]);
  const [members, setMembers] = useState([]);
  const [organizationClaims, setOrganizationClaims] = useState([]);
  const [claimPolicies, setClaimPolicies] = useState([]);
  const [compensationTerms, setCompensationTerms] = useState({});
  const [compensationForms, setCompensationForms] = useState({});
  const [syntheticRecipients, setSyntheticRecipients] = useState({});
  const [selectedPeriods, setSelectedPeriods] = useState({});
  const [periods, setPeriods] = useState([]);
  const [payrollRuns, setPayrollRuns] = useState([]);
  const [runPeriodId, setRunPeriodId] = useState('');
  const [claims, setClaims] = useState([]);
  const [legalName, setLegalName] = useState('');
  const [employeeRef, setEmployeeRef] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [employeeWallet, setEmployeeWallet] = useState('');
  const [inviteWallet, setInviteWallet] = useState('');
  const [inviteRole, setInviteRole] = useState('payroll_operator');
  const [invitationOrganizationId, setInvitationOrganizationId] = useState('');
  const [periodStart, setPeriodStart] = useState('');
  const [periodEnd, setPeriodEnd] = useState('');
  const [claimAmount, setClaimAmount] = useState('');
  const [policyForm, setPolicyForm] = useState({ version: 'policy-v1', minimumClaim: '1', maximumClaim: '5000', dailyClaims: '2', monthlyClaims: '5', autoPayMaximum: '1000' });
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const activeOrganization = useMemo(() => organizations.find((item) => item.id === organizationId), [organizations, organizationId]);
  const loadWorkspace = useCallback(async (id) => {
      if (!id) { setEmployees([]); setMembers([]); setPeriods([]); setPayrollRuns([]); setClaims([]); setOrganizationClaims([]); setClaimPolicies([]); return; }
    setLoading(true); setError('');
    try {
      const role = organizations.find((item) => item.id === id)?.role;
      const isOperator = ['owner', 'payroll_operator', 'payroll_approver', 'payout_executor'].includes(role);
      const canReadPayroll = ['owner', 'payroll_operator', 'payroll_approver'].includes(role);
      const results = await Promise.allSettled([
        canReadPayroll ? payroll.employees(id) : Promise.resolve({ employees: [] }),
        canReadPayroll ? payroll.periods(id) : Promise.resolve({ periods: [] }),
        payroll.claims(id),
        role === 'owner' ? payroll.members(id) : Promise.resolve({ members: [] }),
        isOperator ? payroll.organizationClaims(id) : Promise.resolve({ claims: [] }),
        payroll.claimPolicies(id),
        canReadPayroll ? payroll.payrollRuns(id) : Promise.resolve({ runs: [] }),
      ]);
      if (results[0].status === 'rejected') throw results[0].reason;
      if (results[1].status === 'rejected') throw results[1].reason;
      setEmployees(results[0].value.employees ?? []);
      const periodRows = results[1].value.periods ?? [];
      setPeriods(periodRows);
      setRunPeriodId((current) => periodRows.some((period) => period.id === current && period.status === 'open') ? current : periodRows.find((period) => period.status === 'open')?.id ?? '');
      setClaims(results[2].status === 'fulfilled' ? (results[2].value.claims ?? []) : []);
      setMembers(results[3].status === 'fulfilled' ? (results[3].value.members ?? []) : []);
      setOrganizationClaims(results[4].status === 'fulfilled' ? (results[4].value.claims ?? []) : []);
      setClaimPolicies(results[5].status === 'fulfilled' ? (results[5].value.policies ?? []) : []);
      setPayrollRuns(results[6].status === 'fulfilled' ? (results[6].value.runs ?? []) : []);
    } catch (cause) { setError(cause.message); }
    finally { setLoading(false); }
  }, [organizations]);

  const refreshOrganizations = useCallback(async () => {
    const result = await payroll.organizations();
    const rows = result.organizations ?? [];
    setOrganizations(rows);
    setOrganizationId((current) => rows.some((item) => item.id === current) ? current : rows[0]?.id ?? '');
    return rows;
  }, []);

  useEffect(() => {
    let live = true;
    async function restore() {
      if (!wallet?.address) { setSession(null); setEmployeeOrganizations([]); return; }
      setLoading(true); setError('');
      try {
        const restored = await auth.getSession();
        if (!live) return;
        if (restored?.walletAddress?.toLowerCase() === wallet.address.toLowerCase()) {
          setSession(restored);
          const employeeResult = await payroll.employeeOrganizations();
          if (live) {
            const rows = employeeResult.organizations ?? [];
            setEmployeeOrganizations(rows);
            rows.forEach((employeeOrg) => loadEmployeeClaims(employeeOrg.id));
          }
          const rows = await refreshOrganizations();
          if (live && rows[0]?.id) setOrganizationId(rows[0].id);
        } else setSession(null);
      } catch (cause) { if (live) setError(cause.message); }
      finally { if (live) setLoading(false); }
    }
    restore();
    return () => { live = false; };
  }, [wallet?.address, refreshOrganizations]);

  useEffect(() => { if (session && organizationId) loadWorkspace(organizationId); }, [session, organizationId, loadWorkspace]);

  async function perform(action, success) {
    setBusy(true); setError(''); setNotice('');
    try { const result = await action(); if (success) setNotice(success); return result; }
    catch (cause) { setError(cause.message); return null; }
    finally { setBusy(false); }
  }

  async function signIn() {
    if (!wallet?.walletClient || !wallet?.address) { onConnect(); return; }
    const result = await perform(() => auth.signIn({
      walletAddress: wallet.address,
      signMessage: (message) => wallet.walletClient.signMessage({ account: wallet.address, message }),
    }), 'Wallet session is active for this browser.');
    if (result) {
      setSession(result);
      try {
        const [rows, employeeResult] = await Promise.all([refreshOrganizations(), payroll.employeeOrganizations()]);
        const employeeRows = employeeResult.organizations ?? [];
        setEmployeeOrganizations(employeeRows);
        employeeRows.forEach((employeeOrg) => loadEmployeeClaims(employeeOrg.id));
        if (!rows.length) setOrganizationId('');
      } catch (cause) { setError(cause.message); }
    }
  }

  async function signOut() {
    await perform(async () => { await payroll.signOut(); setSession(null); setOrganizations([]); setEmployeeOrganizations([]); setOrganizationId(''); }, 'Signed out.');
  }

  async function createOrganization(event) {
    event.preventDefault();
    const result = await perform(() => payroll.createOrganization(legalName), 'Organization created.');
    if (result) { setLegalName(''); const rows = await refreshOrganizations(); setOrganizationId(result.id || rows.at(-1)?.id || ''); }
  }

  async function createEmployee(event) {
    event.preventDefault();
    const body = { employeeRef, displayName, ...(employeeWallet ? { employeeWallet } : {}) };
    const result = await perform(() => payroll.createEmployee(organizationId, body), 'Employee submitted for separate approval.');
    if (result) { setEmployeeRef(''); setDisplayName(''); setEmployeeWallet(''); await loadWorkspace(organizationId); }
  }

  async function approveEmployee(employeeId) {
    const result = await perform(() => payroll.approveEmployee(organizationId, employeeId), 'Employee record approved.');
    if (result) await loadWorkspace(organizationId);
  }

  async function loadCompensation(employeeId) {
    setError('');
    try {
      const result = await payroll.compensationTerms(organizationId, employeeId);
      setCompensationTerms((current) => ({ ...current, [employeeId]: result.terms ?? [] }));
    } catch (cause) { setError(cause.message); }
  }

  async function proposeCompensation(employeeId, event) {
    event.preventDefault();
    const form = compensationForms[employeeId] ?? {};
    let periodGrossPaise;
    try { periodGrossPaise = parseRupees(form.gross ?? ''); }
    catch (cause) { setError(cause.message); return; }
    if (!form.effectiveFrom) { setError('Choose when this compensation term takes effect.'); return; }
    const effectiveFrom = new Date(`${form.effectiveFrom}:00+05:30`).toISOString();
    const result = await perform(() => payroll.proposeCompensation(organizationId, employeeId, {
      periodGrossPaise, periodKind: form.periodKind ?? 'monthly', effectiveFrom,
    }), 'Compensation term submitted for separate approval.');
    if (result) await loadCompensation(employeeId);
  }

  async function approveCompensation(termId, employeeId) {
    const result = await perform(() => payroll.approveCompensation(organizationId, termId), 'Compensation term approved.');
    if (result) await loadCompensation(employeeId);
  }

  async function setUpFakeRecipient(employeeId) {
    const result = await perform(() => payroll.createSyntheticRecipient(organizationId, employeeId));
    if (result) {
      setSyntheticRecipients((current) => ({ ...current, [employeeId]: result.recipientReference }));
      setNotice(`Local fake payout reference ready: ${result.recipientReference}. No bank details were added.`);
    }
  }

  async function updateSyntheticAccrual(employeeId) {
    const periodId = selectedPeriods[employeeId] ?? periods.find((period) => period.status === 'open')?.id;
    if (!periodId) { setError('Create an open payroll period before running a synthetic estimate.'); return; }
    const result = await perform(() => payroll.accrueSyntheticEstimate(organizationId, employeeId, periodId));
    if (result) {
      setNotice(`Synthetic estimate: ${formatPaise(result.earnedPaise)} accrued (${result.deltaPaise < 0 ? '−' : '+'}${formatPaise(Math.abs(result.deltaPaise))} since last update). Not statutory pay.`);
      await loadWorkspace(organizationId);
    }
  }

  async function createPeriod(event) {
    event.preventDefault();
    const startsAt = new Date(`${periodStart}T00:00:00+05:30`).toISOString();
    const endsAt = new Date(`${periodEnd}T00:00:00+05:30`).toISOString();
    const result = await perform(() => payroll.createPeriod(organizationId, { startsAt, endsAt }), 'Payroll period created.');
    if (result) { setPeriodStart(''); setPeriodEnd(''); await loadWorkspace(organizationId); }
  }

  async function createPayrollPreview(event) {
    event.preventDefault();
    const period = periods.find((item) => item.id === runPeriodId && item.status === 'open');
    if (!period) { setError('Choose an open payroll period.'); return; }
    const activeEmployees = employees.filter((employee) => employee.status === 'active');
    let termResults;
    try {
      termResults = await Promise.all(activeEmployees.map(async (employee) => ({
        employee,
        terms: (await payroll.compensationTerms(organizationId, employee.id)).terms ?? [],
      })));
    } catch (cause) { setError(cause.message); return; }
    const lines = termResults.map(({ employee, terms }) => ({
      employeeId: employee.id,
      employeeRef: employee.employeeRef,
      approvedGrossTerms: terms.filter((term) => term.status === 'approved'
        && new Date(term.effectiveFrom) < new Date(period.endsAt)
        && (!term.effectiveTo || new Date(term.effectiveTo) > new Date(period.startsAt)))
        .map((term) => ({ periodGrossPaise: Number(term.periodGrossPaise), periodKind: term.periodKind,
          effectiveFrom: term.effectiveFrom, effectiveTo: term.effectiveTo })),
    }));
    const result = await perform(() => payroll.createPayrollRun(organizationId, period.id, {
      rulesVersion: 'IN-UNCONFIGURED',
      snapshot: { schemaVersion: 'gross-input-v1', jurisdiction: 'IN', currency: 'INR',
        payrollPeriod: { startsAt: period.startsAt, endsAt: period.endsAt },
        calculationStatus: 'unvalidated_gross_inputs', lines,
        warning: 'Gross contract inputs only. No deductions, net pay, statutory rules, or settlement are calculated.' },
    }), 'Gross-input snapshot saved as an unvalidated preview.');
    if (result) await loadWorkspace(organizationId);
  }

  async function submitRun(runId) {
    const result = await perform(() => payroll.submitPayrollRun(organizationId, runId), 'Payroll preview submitted for checker review.');
    if (result) await loadWorkspace(organizationId);
  }

  async function inviteMember(event) {
    event.preventDefault();
    const result = await perform(() => payroll.inviteMember(organizationId, { walletAddress: inviteWallet, role: inviteRole }), 'Wallet invited. Share the organization ID so they can accept after signing in.');
    if (result) { setInviteWallet(''); await loadWorkspace(organizationId); }
  }

  async function acceptInvitation(event) {
    event.preventDefault();
    const result = await perform(() => payroll.acceptInvitation(invitationOrganizationId), 'Invitation accepted.');
    if (result) { setInvitationOrganizationId(''); await refreshOrganizations(); setOrganizationId(result.organizationId); }
  }

  async function removeMember(walletAddress) {
    const result = await perform(() => payroll.revokeMember(organizationId, walletAddress), 'Membership revoked.');
    if (result) await loadWorkspace(organizationId);
  }

  async function decideClaim(claimId, decision) {
    const result = await perform(() => payroll.decideClaim(organizationId, claimId, decision), `Claim ${decision}d.`);
    if (result) await loadWorkspace(organizationId);
  }

  async function dispatchFakePayout() {
    const result = await perform(() => payroll.dispatchFakePayout(organizationId), 'One fake payout command was dispatched. No money moved.');
    if (result) await loadWorkspace(organizationId);
  }

  async function reconcileFakePayout(claimId) {
    const result = await perform(() => payroll.reconcileFakePayout(organizationId, claimId), 'Fake provider status was reconciled.');
    if (result) await loadWorkspace(organizationId);
  }

  async function proposePolicy(event) {
    event.preventDefault();
    let body;
    try {
      body = {
        version: policyForm.version,
        minimumClaimPaise: parseRupees(policyForm.minimumClaim),
        maximumClaimPaise: parseRupees(policyForm.maximumClaim),
        maximumDailyClaims: Number(policyForm.dailyClaims),
        maximumMonthlyClaims: Number(policyForm.monthlyClaims),
        autoPayMaximumPaise: parseRupees(policyForm.autoPayMaximum),
      };
    } catch (cause) { setError(cause.message); return; }
    const result = await perform(() => payroll.proposeClaimPolicy(organizationId, body), 'Claim policy submitted for separate approval.');
    if (result) await loadWorkspace(organizationId);
  }

  async function approvePolicy(policyId) {
    const result = await perform(() => payroll.approveClaimPolicy(organizationId, policyId), 'Claim policy approved.');
    if (result) await loadWorkspace(organizationId);
  }

  async function submitClaim(targetOrganizationId, event) {
    event.preventDefault();
    let requestedPaise;
    try { requestedPaise = parseRupees(claimAmount); }
    catch (cause) { setError(cause.message); return; }
    const result = await perform(() => payroll.requestClaim(targetOrganizationId, {
      requestedPaise, idempotencyKey: globalThis.crypto.randomUUID(),
    }), 'Salary claim submitted.');
    if (result) {
      setClaimAmount('');
      if (targetOrganizationId === organizationId) await loadWorkspace(organizationId);
      loadEmployeeClaims(targetOrganizationId);
    }
  }

  async function loadEmployeeClaims(targetOrganizationId) {
    try {
      const result = await payroll.claims(targetOrganizationId);
      setEmployeeClaims((current) => ({ ...current, [targetOrganizationId]: result.claims ?? [] }));
    } catch (cause) { setError(cause.message); }
  }

  return <section className="payroll-workspace">
    <div className="pw-banner"><div><span className="pw-kicker">INDIA · INR PAYROLL</span><h2>Employer payroll workspace</h2><p>Private payroll records and employer-led payout orchestration. No funds are held here.</p></div><span className="pw-synthetic"><i />LOCAL SYNTHETIC MODE</span></div>
    <div className="pw-notice"><ShieldCheck size={16} /><span>India payroll calculations and bank payouts are not enabled. This workspace uses synthetic records; Monad Testnet remains a separate demo.</span></div>

    {!session ? <section className="pw-card pw-auth"><div className="pw-icon"><LogIn size={18} /></div><h3>Sign in with your wallet</h3><p>FlowPay verifies a one-time signature and keeps the session in an HttpOnly browser cookie. No private key leaves your wallet.</p>
      {wallet?.address ? <div className="pw-connected">Connected wallet <strong>{shortWallet(wallet.address)}</strong></div> : <button className="pw-secondary" onClick={onConnect}>Connect wallet</button>}
      <button className="pw-primary" onClick={signIn} disabled={busy || !wallet?.address}>{busy ? 'Signing in…' : 'Sign in to payroll'}</button>
    </section> : <>
      <div className="pw-session"><span><i />Signed in as <strong>{shortWallet(session.walletAddress)}</strong></span><button onClick={signOut} disabled={busy}><LogOut size={14} />Sign out</button></div>
      {error && <div className="pw-message pw-error" role="alert"><AlertCircle size={15} />{error}</div>}
      {notice && <div className="pw-message pw-success"><Check size={15} />{notice}</div>}
      {employeeOrganizations.length > 0 && <section className="pw-card pw-employee-claims"><div className="pw-card-head"><div><h3>Employee salary claims</h3><p>These organizations are linked to your signed-in employee wallet.</p></div></div>
        {employeeOrganizations.map((employeeOrg) => <div className="pw-employee-claim-org" key={employeeOrg.id}><div className="pw-row"><div><strong>{employeeOrg.legalName}</strong><small>{employeeOrg.employeeRef}</small></div><button className="pw-small-action" onClick={() => loadEmployeeClaims(employeeOrg.id)}>Refresh claims</button></div><form className="pw-inline-form pw-claim-form" onSubmit={(event) => submitClaim(employeeOrg.id, event)}><input required inputMode="decimal" value={claimAmount} onChange={(event) => setClaimAmount(event.target.value)} placeholder="Claim amount in ₹" /><button className="pw-primary" disabled={busy}>Request claim</button></form><div className="pw-list">{(employeeClaims[employeeOrg.id] ?? []).map((claim) => <div className="pw-row" key={claim.id}><div><strong>{formatPaise(claim.requestedPaise)}</strong><small>{new Date(claim.createdAt).toLocaleString('en-IN')}</small></div><span className="pw-state">{claim.state.replaceAll('_', ' ')}</span></div>)}{!employeeClaims[employeeOrg.id]?.length && <div className="pw-empty">No claims loaded.</div>}</div></div>)}
      </section>}
      {organizations.length === 0 ? <section className="pw-card"><div className="pw-card-head"><div><h3>Create your organization</h3><p>The connected wallet becomes its initial owner.</p></div></div>
        <form className="pw-form pw-org-form" onSubmit={createOrganization}><label>Legal organization name<input required maxLength={200} value={legalName} onChange={(event) => setLegalName(event.target.value)} placeholder="Example: Northstar Design Pvt Ltd" /></label><button className="pw-primary" disabled={busy}><Plus size={14} />Create organization</button></form>
        <div className="pw-invite-accept"><strong>Accept a wallet invitation</strong><p>Ask the organization owner for its ID, then accept using the invited wallet.</p><form className="pw-inline-form" onSubmit={acceptInvitation}><input required value={invitationOrganizationId} onChange={(event) => setInvitationOrganizationId(event.target.value)} placeholder="Organization ID" /><button className="pw-secondary" disabled={busy}>Accept invitation</button></form></div>
      </section> : <>
        <section className="pw-card pw-org-bar"><label>Organization<select value={organizationId} onChange={(event) => setOrganizationId(event.target.value)}>{organizations.map((org) => <option key={org.id} value={org.id}>{org.legalName} · {org.role}</option>)}</select></label><form className="pw-inline-form" onSubmit={acceptInvitation}><input required value={invitationOrganizationId} onChange={(event) => setInvitationOrganizationId(event.target.value)} placeholder="Accept invite: organization ID" /><button className="pw-secondary" disabled={busy}>Accept</button></form><button className="pw-refresh" onClick={() => loadWorkspace(organizationId)} disabled={loading}><RefreshCw size={14} className={loading ? 'spin' : ''} />Refresh</button></section>
        {activeOrganization && <div className="pw-status-line"><span><ShieldCheck size={14} />Your role: <strong>{activeOrganization.role}</strong></span><span>Organization ID: <code>{activeOrganization.id}</code></span></div>}
        <div className="pw-grid">
          {activeOrganization?.role === 'owner' && <section className="pw-card"><div className="pw-card-head"><div><h3>Members and roles</h3><p>Invite a wallet to prepare payroll, approve runs, or execute local fake payouts.</p></div><span className="pw-count">{members.filter((member) => member.status === 'active').length}</span></div>
            <form className="pw-form" onSubmit={inviteMember}><div className="pw-fields"><label>Wallet address<input required value={inviteWallet} onChange={(event) => setInviteWallet(event.target.value)} placeholder="0x…" pattern="0x[a-fA-F0-9]{40}" /></label><label>Role<select value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}><option value="payroll_operator">Payroll operator</option><option value="payroll_approver">Payroll approver</option><option value="payout_executor">Payout executor</option></select></label></div><button className="pw-primary" disabled={busy}><Plus size={14} />Invite wallet</button></form>
            <div className="pw-list">{members.map((member) => <div className="pw-row" key={member.walletAddress}><div><strong>{shortWallet(member.walletAddress)} · {member.role.replaceAll('_', ' ')}</strong><small>{member.status}{member.invitationExpiresAt ? ` · expires ${indiaDate(member.invitationExpiresAt)}` : ''}</small></div>{member.walletAddress.toLowerCase() !== session.walletAddress.toLowerCase() && member.status !== 'revoked' && <button className="pw-small-action" onClick={() => removeMember(member.walletAddress)} disabled={busy}>Revoke</button>}</div>)}{members.length === 0 && <div className="pw-empty">No organization members.</div>}</div>
          </section>}
          {['owner', 'payroll_operator'].includes(activeOrganization?.role) && <section className="pw-card"><div className="pw-card-head"><div><h3>Employee claim policy</h3><p>Amounts are in INR; limits require a second authorized wallet to approve.</p></div><span className="pw-count">{claimPolicies.filter((policy) => policy.status === 'approved').length}</span></div>
            <form className="pw-form" onSubmit={proposePolicy}><div className="pw-fields"><label>Version<input required value={policyForm.version} onChange={(event) => setPolicyForm({ ...policyForm, version: event.target.value })} /></label><label>Minimum claim (₹)<input required inputMode="decimal" value={policyForm.minimumClaim} onChange={(event) => setPolicyForm({ ...policyForm, minimumClaim: event.target.value })} /></label><label>Maximum claim (₹)<input required inputMode="decimal" value={policyForm.maximumClaim} onChange={(event) => setPolicyForm({ ...policyForm, maximumClaim: event.target.value })} /></label><label>Auto-pay cap (₹)<input required inputMode="decimal" value={policyForm.autoPayMaximum} onChange={(event) => setPolicyForm({ ...policyForm, autoPayMaximum: event.target.value })} /></label><label>Daily claim count<input type="number" required min="1" max="1000" value={policyForm.dailyClaims} onChange={(event) => setPolicyForm({ ...policyForm, dailyClaims: event.target.value })} /></label><label>Monthly claim count<input type="number" required min="1" max="10000" value={policyForm.monthlyClaims} onChange={(event) => setPolicyForm({ ...policyForm, monthlyClaims: event.target.value })} /></label></div><button className="pw-primary" disabled={busy}><Plus size={14} />Propose claim policy</button></form>
            <div className="pw-list">{claimPolicies.slice(0, 5).map((policy) => <div className="pw-row" key={policy.id}><div><strong>{policy.version} · {formatPaise(policy.minimumClaimPaise)}–{formatPaise(policy.maximumClaimPaise)}</strong><small>{policy.status}{policy.status === 'approved' ? ` · auto cap ${formatPaise(policy.autoPayMaximumPaise)}` : ''}</small></div>{policy.status === 'pending_approval' && ['owner', 'payroll_approver'].includes(activeOrganization?.role) && policy.preparedByWallet?.toLowerCase() !== session.walletAddress.toLowerCase() && <button className="pw-small-action" onClick={() => approvePolicy(policy.id)} disabled={busy}>Approve</button>}</div>)}{claimPolicies.length === 0 && <div className="pw-empty">No claim policy yet.</div>}</div>
          </section>}
          <section className="pw-card"><div className="pw-card-head"><div><h3>Team</h3><p>Employee additions need another authorized wallet to approve.</p></div><span className="pw-count">{employees.length}</span></div>
            {['owner', 'payroll_operator'].includes(activeOrganization?.role) && <form className="pw-form" onSubmit={createEmployee}><div className="pw-fields"><label>Employee reference<input required value={employeeRef} onChange={(event) => setEmployeeRef(event.target.value)} placeholder="EMP-001" /></label><label>Display name<input required value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Synthetic employee" /></label></div><label>Linked employee wallet <small>optional</small><input value={employeeWallet} onChange={(event) => setEmployeeWallet(event.target.value)} placeholder="0x…" pattern="0x[a-fA-F0-9]{40}" /></label><button className="pw-primary" disabled={busy}><Plus size={14} />Add employee</button></form>}
            <div className="pw-list">{employees.map((employee) => <div className="pw-employee" key={employee.id}><div className="pw-row"><div><strong>{employee.displayName}</strong><small>{employee.employeeRef} · {employee.status}</small></div>{employee.status === 'pending_approval' && ['owner', 'payroll_approver'].includes(activeOrganization?.role) ? <button className="pw-small-action" onClick={() => approveEmployee(employee.id)} disabled={busy}>Approve</button> : <span className="pw-state">{employee.status}</span>}</div>
              {employee.status === 'active' && <details className="pw-comp-details" onToggle={(event) => { if (event.currentTarget.open && !compensationTerms[employee.id]) loadCompensation(employee.id); }}><summary>Compensation terms</summary><p>Gross contract amount per pay period. This is not net pay or a statutory calculation.</p>
                {['owner', 'payroll_operator'].includes(activeOrganization?.role) && <form className="pw-form" onSubmit={(event) => proposeCompensation(employee.id, event)}><div className="pw-fields"><label>Gross per period (₹)<input required inputMode="decimal" value={compensationForms[employee.id]?.gross ?? ''} onChange={(event) => setCompensationForms((current) => ({ ...current, [employee.id]: { ...current[employee.id], gross: event.target.value } }))} placeholder="50000.00" /></label><label>Period type<select value={compensationForms[employee.id]?.periodKind ?? 'monthly'} onChange={(event) => setCompensationForms((current) => ({ ...current, [employee.id]: { ...current[employee.id], periodKind: event.target.value } }))}><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="daily">Daily</option><option value="custom">Custom period</option></select></label></div><label>Effective from (IST)<input required type="datetime-local" value={compensationForms[employee.id]?.effectiveFrom ?? ''} onChange={(event) => setCompensationForms((current) => ({ ...current, [employee.id]: { ...current[employee.id], effectiveFrom: event.target.value } }))} /></label><button className="pw-primary" disabled={busy}><Plus size={14} />Propose term</button></form>}
                <div className="pw-list">{(compensationTerms[employee.id] ?? []).map((term) => <div className="pw-row" key={term.id}><div><strong>{formatPaise(Number(term.periodGrossPaise))} / {term.periodKind}</strong><small>{term.status} · starts {indiaDate(term.effectiveFrom)}</small></div>{term.status === 'pending_approval' && ['owner', 'payroll_approver'].includes(activeOrganization?.role) && term.preparedByWallet?.toLowerCase() !== session.walletAddress.toLowerCase() && <button className="pw-small-action" onClick={() => approveCompensation(term.id, employee.id)} disabled={busy}>Approve</button>}</div>)}{compensationTerms[employee.id]?.length === 0 && <div className="pw-empty">No compensation terms.</div>}</div>
                {['owner', 'payroll_operator'].includes(activeOrganization?.role) && <div className="pw-synthetic-controls"><button className="pw-secondary" onClick={() => setUpFakeRecipient(employee.id)} disabled={busy}>{syntheticRecipients[employee.id] ? 'Refresh fake reference' : 'Create fake payout reference'}</button>{syntheticRecipients[employee.id] && <small>FAKE · {syntheticRecipients[employee.id]}</small>}<div className="pw-inline-form"><select value={selectedPeriods[employee.id] ?? periods.find((period) => period.status === 'open')?.id ?? ''} onChange={(event) => setSelectedPeriods((current) => ({ ...current, [employee.id]: event.target.value }))}><option value="" disabled>Choose open period</option>{periods.filter((period) => period.status === 'open').map((period) => <option key={period.id} value={period.id}>{indiaDate(period.startsAt)} – {indiaDate(period.endsAt)}</option>)}</select><button className="pw-primary" onClick={() => updateSyntheticAccrual(employee.id)} disabled={busy || !periods.some((period) => period.status === 'open')}>Update synthetic earned estimate</button></div></div>}
              </details>}
            </div>)}{employees.length === 0 && <div className="pw-empty">No employee records yet.</div>}</div>
          </section>
          <section className="pw-card"><div className="pw-card-head"><div><h3>Payroll periods</h3><p>Create date windows in India Standard Time. End date is exclusive.</p></div><span className="pw-count">{periods.length}</span></div>
            {['owner', 'payroll_operator'].includes(activeOrganization?.role) && <form className="pw-form" onSubmit={createPeriod}><div className="pw-fields"><label>Starts <input type="date" required value={periodStart} onChange={(event) => setPeriodStart(event.target.value)} /></label><label>Ends <input type="date" required value={periodEnd} onChange={(event) => setPeriodEnd(event.target.value)} /></label></div><button className="pw-primary" disabled={busy}><Plus size={14} />Create period</button></form>}
            <div className="pw-list">{periods.map((period) => <div className="pw-row" key={period.id}><div><strong>{indiaDate(period.startsAt)} – {indiaDate(period.endsAt)}</strong><small>IST date window</small></div><span className="pw-state">{period.status}</span></div>)}{periods.length === 0 && <div className="pw-empty">No payroll periods created.</div>}</div>
          </section>
          {['owner', 'payroll_operator', 'payroll_approver'].includes(activeOrganization?.role) && <section className="pw-card pw-claims"><div className="pw-card-head"><div><h3>Payroll run review</h3><p>Creates an immutable gross-input snapshot. Statutory deductions and net pay are not calculated.</p></div><span className="pw-ops-label">UNVALIDATED RULES</span></div>
            {['owner', 'payroll_operator'].includes(activeOrganization?.role) && <form className="pw-inline-form pw-run-form" onSubmit={createPayrollPreview}><select required value={runPeriodId} onChange={(event) => setRunPeriodId(event.target.value)}><option value="" disabled>Choose open period</option>{periods.filter((period) => period.status === 'open').map((period) => <option key={period.id} value={period.id}>{indiaDate(period.startsAt)} – {indiaDate(period.endsAt)}</option>)}</select><button className="pw-primary" disabled={busy || !runPeriodId}><Plus size={14} />Create gross preview</button></form>}
            <div className="pw-list">{payrollRuns.map((run) => <div className="pw-row" key={run.id}><div><strong>{shortWallet(run.id)} · {run.status.replaceAll('_', ' ')}</strong><small>{run.rulesVersion} · {run.snapshotHash?.slice(0, 12)}… · {run.rulesStatus}</small></div><div className="pw-row-actions">{run.status === 'preview' && ['owner', 'payroll_operator'].includes(activeOrganization?.role) && <button className="pw-small-action" onClick={() => submitRun(run.id)} disabled={busy}>Submit for check</button>}{run.status === 'pending_approval' && ['owner', 'payroll_approver'].includes(activeOrganization?.role) && <button className="pw-small-action" title="An approved India payroll rules source is not configured" disabled>Approval blocked</button>}</div></div>)}{payrollRuns.length === 0 && <div className="pw-empty">No payroll runs created.</div>}</div>
            <p className="pw-run-note">Final approval stays blocked until an approved India payroll rules source is configured. An unvalidated preview never creates claimable wages.</p>
          </section>}
          <section className="pw-card pw-claims"><div className="pw-card-head"><div><h3>My salary claims</h3><p>Claims linked to this signed-in employee wallet.</p></div><span className="pw-count">{claims.length}</span></div>
            <form className="pw-inline-form pw-claim-form" onSubmit={(event) => submitClaim(organizationId, event)}><input required inputMode="decimal" value={claimAmount} onChange={(event) => setClaimAmount(event.target.value)} placeholder="Claim amount in ₹" /><button className="pw-primary" disabled={busy}>Request claim</button></form>
            <div className="pw-list">{claims.map((claim) => <div className="pw-row" key={claim.id}><div><strong>{formatPaise(claim.requestedPaise)}</strong><small>{new Date(claim.createdAt).toLocaleString('en-IN')} · {claim.providerReference || 'No provider reference'}</small></div><span className="pw-state">{claim.state.replaceAll('_', ' ')}</span></div>)}{claims.length === 0 && <div className="pw-empty"><CircleHelp size={15} />No claims for this wallet in this organization.</div>}</div>
          </section>
          {['owner', 'payroll_operator', 'payroll_approver', 'payout_executor'].includes(activeOrganization?.role) && <section className="pw-card pw-claims"><div className="pw-card-head"><div><h3>Claim review and payout operations</h3><p>Local fake provider only. Dispatch and reconciliation do not contact a bank.</p></div><div className="pw-ops-label">FAKE MODE</div></div>
            {['owner', 'payout_executor'].includes(activeOrganization?.role) && <button className="pw-primary pw-dispatch" onClick={dispatchFakePayout} disabled={busy}>Dispatch one fake payout</button>}
            <div className="pw-list">{organizationClaims.map((claim) => <div className="pw-row" key={claim.id}><div><strong>{claim.employeeRef} · {formatPaise(claim.requestedPaise)}</strong><small>{claim.state.replaceAll('_', ' ')} · {claim.providerReference || 'No provider reference'}</small></div><div className="pw-row-actions">{claim.state === 'awaiting_approval' && ['owner', 'payroll_approver'].includes(activeOrganization?.role) && <><button className="pw-small-action" onClick={() => decideClaim(claim.id, 'approve')} disabled={busy}>Approve</button><button className="pw-small-action pw-reject" onClick={() => decideClaim(claim.id, 'reject')} disabled={busy}>Reject</button></>}{claim.state === 'reconciliation_required' && ['owner', 'payout_executor'].includes(activeOrganization?.role) && <button className="pw-small-action" onClick={() => reconcileFakePayout(claim.id)} disabled={busy}>Reconcile fake</button>}</div></div>)}{organizationClaims.length === 0 && <div className="pw-empty">No claim operations in this organization.</div>}</div>
          </section>}
        </div>
      </>}
    </>}
    <div className="pw-footer"><Clock3 size={13} />Payroll preview, statutory deductions, automatic accrual funding, real payouts, and recovery setup remain gated pending India legal/provider and wallet governance reviews.</div>
  </section>;
}
