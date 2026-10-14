import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Activity, AlertCircle, ArrowDownToLine, ArrowUpRight, Check, ChevronDown,
  ChevronRight, CircleHelp, Clock3, Copy, CreditCard, ExternalLink, Landmark,
  LayoutDashboard, LogOut, Pause, Play, Plus, RefreshCw, ShieldCheck, Wallet, X,
} from 'lucide-react';
import { formatEther, isAddress, parseEther } from 'viem';
import {
  DEPLOYMENT_BLOCK, FLOWPAY_ADDRESS, FLOWPAY_CONFIG_ERROR,
  FLOWPAY_FACTORY_ADDRESS, FLOWPAY_FACTORY_CONFIG_ERROR, FLOWPAY_FACTORY_DEPLOYMENT_BLOCK,
  MONAD_CHAIN_ID, MONAD_CONFIG_ERROR, MONADSCAN_TX_URL,
} from './chain/config.js';
import {
  connectWallet, createFactoryStream, getWalletChainId, isStreamRegistered,
  loadAccountStreams, readActivity, readStream, registerLegacyStream, submitAction,
  switchToMonadTestnet, waitForAction,
} from './chain/flowPay.js';
import { performWalletAction } from './chain/transactionFlow.js';
import { projectSnapshot } from './chain/projectSnapshot.js';
import { subscribeWalletEvents } from './chain/walletEvents.js';
import { emptyActivityState } from './chain/activityState.js';
import './styles.css';

const PayrollWorkspace = lazy(() => import('./PayrollWorkspace.jsx'));

const MONTH_SECONDS = 30n * 24n * 60n * 60n;
const NAV_ITEMS = [
  ['Overview', LayoutDashboard], ['Payroll system', Landmark], ['My salary', Wallet],
  ['Activity', Activity], ['Employer payroll', Landmark],
];

function formatMon(value, digits = 6) {
  if (typeof value !== 'bigint') return '—';
  const places = Math.min(18, Math.max(2, digits));
  const unit = 10n ** BigInt(18 - places);
  const scale = 10n ** BigInt(places);
  const absolute = value < 0n ? -value : value;
  const rounded = (absolute + unit / 2n) / unit;
  const whole = (rounded / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  let fraction = (rounded % scale).toString().padStart(places, '0').replace(/0+$/, '');
  if (fraction.length < 2) fraction = fraction.padEnd(2, '0');
  return (value < 0n ? '-' : '') + whole + '.' + fraction;
}

function shortAddress(address) {
  return address ? address.slice(0, 6) + '…' + address.slice(-4) : '—';
}

function errorMessage(error) {
  if (error?.code === 4001 || /user rejected|request rejected/i.test(error?.message || '')) return 'The wallet request was cancelled.';
  return error?.shortMessage || error?.cause?.shortMessage || error?.message || 'The request could not be completed.';
}

function dateTime(timestamp) {
  return timestamp ? new Date(timestamp * 1_000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : 'Time unavailable';
}

function roleFor(address, employer, snapshot, employeeAddress) {
  if (!address) return 'Visitor';
  if (employer && address.toLowerCase() === employer.toLowerCase()) return 'Employer';
  if ((snapshot?.streamCreated && address.toLowerCase() === snapshot.employee.toLowerCase())
    || (employeeAddress && address.toLowerCase() === employeeAddress.toLowerCase())) return 'Employee';
  return 'Viewer';
}

function App() {
  const [tab, setTab] = useState('Overview');
  const [wallet, setWallet] = useState(null);
  const [streamChoices, setStreamChoices] = useState([]);
  const [selectedStreamAddress, setSelectedStreamAddress] = useState(null);
  const [streamsLoading, setStreamsLoading] = useState(false);
  const [streamsError, setStreamsError] = useState('');
  const [factoryReady, setFactoryReady] = useState(false);
  const [legacyRegistered, setLegacyRegistered] = useState(false);
  const [legacyStream, setLegacyStream] = useState(null);
  const [streamData, setStreamData] = useState(null);
  const [activity, setActivity] = useState([]);
  const [activityStreamAddress, setActivityStreamAddress] = useState(null);
  const [readError, setReadError] = useState('');
  const [readErrorStreamAddress, setReadErrorStreamAddress] = useState(null);
  const [activityError, setActivityError] = useState('');
  const [activityErrorStreamAddress, setActivityErrorStreamAddress] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [transaction, setTransaction] = useState(null);
  const [formError, setFormError] = useState('');
  const [toast, setToast] = useState('');
  const [copied, setCopied] = useState(false);
  const [modal, setModal] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [nowSeconds, setNowSeconds] = useState(Math.floor(Date.now() / 1_000));
  const [employeeAddress, setEmployeeAddress] = useState('');
  const [monthlyRate, setMonthlyRate] = useState('');
  const [initialFunding, setInitialFunding] = useState('');
  const [topUpAmount, setTopUpAmount] = useState('');
  const [salaryClaimAmount, setSalaryClaimAmount] = useState('');
  const [savingsClaimAmount, setSavingsClaimAmount] = useState('');
  const [draftSavingsRate, setDraftSavingsRate] = useState(1_000);
  const refreshSequence = useRef(0);

  const selectedStream = streamChoices.find((stream) => stream.address.toLowerCase() === selectedStreamAddress?.toLowerCase());
  const activeStreamAddress = selectedStream?.address;
  const activeDeploymentBlock = selectedStream?.deploymentBlock;
  const activeStreamData = streamData?.address?.toLowerCase() === activeStreamAddress?.toLowerCase() ? streamData : null;
  const snapshot = activeStreamData?.snapshot;
  const activeReadError = readErrorStreamAddress?.toLowerCase() === activeStreamAddress?.toLowerCase() ? readError : '';
  const activeActivityError = activityErrorStreamAddress?.toLowerCase() === activeStreamAddress?.toLowerCase() ? activityError : '';
  const role = roleFor(wallet?.address, activeStreamData?.employer || selectedStream?.employer, snapshot, selectedStream?.employee);
  const networkReady = Boolean(wallet && wallet.chainId === MONAD_CHAIN_ID);
  const live = useMemo(
    () => projectSnapshot(snapshot, activeStreamData?.blockTimestamp || nowSeconds, nowSeconds, !activeReadError),
    [snapshot, activeStreamData?.blockTimestamp, nowSeconds, activeReadError],
  );
  const setupError = MONAD_CONFIG_ERROR || (!selectedStream && FLOWPAY_CONFIG_ERROR) || '';
  const canWrite = networkReady && !busy && !setupError && Boolean(activeStreamAddress);
  const canEmployer = canWrite && role === 'Employer';
  const canEmployee = canWrite && role === 'Employee';
  const canCreateStream = networkReady && !busy && !MONAD_CONFIG_ERROR && !FLOWPAY_FACTORY_CONFIG_ERROR && Boolean(FLOWPAY_FACTORY_ADDRESS) && factoryReady;
  const canImportLegacy = networkReady && !busy && !MONAD_CONFIG_ERROR && !FLOWPAY_FACTORY_CONFIG_ERROR && Boolean(FLOWPAY_FACTORY_ADDRESS) && factoryReady
    && Boolean(wallet?.address && legacyStream?.employer?.toLowerCase() === wallet.address.toLowerCase())
    && Boolean(legacyStream?.created)
    && !legacyRegistered;
  const recentActivity = useMemo(() => activityStreamAddress?.toLowerCase() === activeStreamAddress?.toLowerCase()
    ? [...activity].reverse() : [], [activity, activityStreamAddress, activeStreamAddress]);
  const statusLabel = setupError ? 'Setup required'
    : activeReadError ? 'Read unavailable'
      : !snapshot ? 'Waiting for contract'
        : !snapshot.streamCreated ? 'No stream yet'
          : snapshot.paused ? 'Paused'
            : snapshot.underfunded ? 'Needs funding' : 'Streaming';

  const refresh = useCallback(async (address = activeStreamAddress, deploymentBlock = activeDeploymentBlock) => {
    const sequence = ++refreshSequence.current;
    if (!address) {
      setStreamData(null);
      setActivity([]);
      setActivityStreamAddress(null);
      setReadError('');
      setReadErrorStreamAddress(null);
      setActivityError('');
      setActivityErrorStreamAddress(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setReadError('');
    setActivityError('');
    try {
      const result = await readStream(address);
      if (sequence !== refreshSequence.current) return;
      setStreamData(result);
      setReadError('');
      setReadErrorStreamAddress(null);
    } catch (error) {
      if (sequence !== refreshSequence.current) return;
      setReadError(errorMessage(error));
      setReadErrorStreamAddress(address);
    }
    try {
      const events = await readActivity(address, deploymentBlock);
      if (sequence !== refreshSequence.current) return;
      setActivity(events);
      setActivityStreamAddress(address);
      setActivityError('');
      setActivityErrorStreamAddress(null);
    } catch (error) {
      if (sequence !== refreshSequence.current) return;
      setActivityError(errorMessage(error));
      setActivityErrorStreamAddress(address);
    }
    if (sequence === refreshSequence.current) setLoading(false);
  }, [activeStreamAddress, activeDeploymentBlock]);

  const loadStreams = useCallback(async (account = wallet?.address) => {
    setStreamsLoading(true);
    setStreamsError('');
    setStreamChoices([]);
    setSelectedStreamAddress(null);
    const nextChoices = [];
    let registeredLegacy = false;
    let loadError = '';
    setFactoryReady(false);
    if (account && FLOWPAY_FACTORY_CONFIG_ERROR) loadError = FLOWPAY_FACTORY_CONFIG_ERROR;
    if (account && !FLOWPAY_FACTORY_CONFIG_ERROR && FLOWPAY_FACTORY_ADDRESS) {
      try {
        const indexed = await loadAccountStreams(account);
        setFactoryReady(true);
        const indexedAddresses = [...new Set([...indexed.employerStreams, ...indexed.employeeStreams])];
        const factoryRecords = [];
        for (let offset = 0; offset < indexedAddresses.length; offset += 5) {
          const group = await Promise.all(indexedAddresses.slice(offset, offset + 5).map(async (address) => {
            try {
              const data = await readStream(address);
              const employerMatch = data.employer.toLowerCase() === account.toLowerCase();
              const employeeMatch = data.snapshot.streamCreated && data.snapshot.employee.toLowerCase() === account.toLowerCase();
              if (!employerMatch && !employeeMatch) return null;
              return {
                address,
                source: 'factory',
                deploymentBlock: FLOWPAY_FACTORY_DEPLOYMENT_BLOCK,
                employer: data.employer,
                employee: data.snapshot.employee,
              };
            } catch (error) {
              loadError = errorMessage(error);
              return {
                address,
                source: 'factory',
                deploymentBlock: FLOWPAY_FACTORY_DEPLOYMENT_BLOCK,
                employer: indexed.employerStreams.some((entry) => entry.toLowerCase() === address.toLowerCase()) ? account : undefined,
                employee: indexed.employeeStreams.some((entry) => entry.toLowerCase() === address.toLowerCase()) ? account : undefined,
                unavailable: true,
              };
            }
          }));
          factoryRecords.push(...group);
        }
        nextChoices.push(...factoryRecords.filter(Boolean));
      } catch (error) {
        loadError = errorMessage(error);
        setFactoryReady(false);
      }
    }

    if (FLOWPAY_ADDRESS && !FLOWPAY_CONFIG_ERROR) {
      try {
        const legacy = await readStream(FLOWPAY_ADDRESS);
        setLegacyStream({ address: FLOWPAY_ADDRESS, employer: legacy.employer, employee: legacy.snapshot.employee, created: legacy.snapshot.streamCreated });
        if (account) {
          const party = [legacy.employer, legacy.snapshot.employee].some((address) => address.toLowerCase() === account.toLowerCase());
          if (party) nextChoices.push({ address: FLOWPAY_ADDRESS, source: 'legacy', deploymentBlock: DEPLOYMENT_BLOCK, employer: legacy.employer, employee: legacy.snapshot.employee });
          if (FLOWPAY_FACTORY_ADDRESS && !FLOWPAY_FACTORY_CONFIG_ERROR && legacy.employer.toLowerCase() === account.toLowerCase()) {
            try { registeredLegacy = await isStreamRegistered(FLOWPAY_ADDRESS); }
            catch { registeredLegacy = false; }
          }
        } else {
          nextChoices.push({ address: FLOWPAY_ADDRESS, source: 'legacy', deploymentBlock: DEPLOYMENT_BLOCK, employer: legacy.employer, employee: legacy.snapshot.employee });
        }
      } catch (error) {
        setLegacyStream(null);
        if (!loadError) loadError = errorMessage(error);
      }
    } else {
      setLegacyStream(null);
      if (!loadError && FLOWPAY_CONFIG_ERROR) loadError = FLOWPAY_CONFIG_ERROR;
    }

    const unique = [...new Map(nextChoices.map((stream) => [stream.address.toLowerCase(), stream])).values()];
    setStreamChoices(unique);
    setLegacyRegistered(registeredLegacy);
    setStreamsError(loadError);
    setSelectedStreamAddress((current) => unique.some((stream) => stream.address.toLowerCase() === current?.toLowerCase())
      ? current
      : unique[0]?.address || null);
    setStreamsLoading(false);
  }, [wallet?.address]);

  useEffect(() => {
    const timer = window.setInterval(() => setNowSeconds(Math.floor(Date.now() / 1_000)), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    loadStreams(wallet?.address);
  }, [loadStreams, wallet?.address]);

  useEffect(() => {
    refresh();
    const timer = window.setInterval(() => refresh(), 12_000);
    return () => window.clearInterval(timer);
  }, [refresh, activeStreamAddress, activeDeploymentBlock]);

  useEffect(() => {
    if (snapshot) setDraftSavingsRate(Number(snapshot.savingsRateBps));
  }, [snapshot?.savingsRateBps]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(''), 2_800);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    const provider = window.ethereum;
    if (!provider?.on) return undefined;
    const onAccounts = (accounts) => {
      if (!accounts.length) setWallet(null);
      else setWallet((current) => current ? { ...current, address: accounts[0] } : current);
    };
    const onChain = (chainId) => setWallet((current) => current ? { ...current, chainId: Number.parseInt(chainId, 16) } : current);
    return subscribeWalletEvents(provider, { onAccounts, onChain });
  }, []);

  async function handleConnect() {
    setFormError('');
    try { setWallet(await connectWallet()); }
    catch (error) { setFormError(errorMessage(error)); }
  }

  async function handleSwitchNetwork() {
    setFormError('');
    try {
      await switchToMonadTestnet();
      const chainId = await getWalletChainId();
      setWallet((current) => current ? { ...current, chainId } : current);
    } catch (error) { setFormError(errorMessage(error)); }
  }

  async function handleCopyAddress() {
    if (!wallet?.address) return setFormError('Connect your wallet before copying its address.');
    try {
      await navigator.clipboard.writeText(wallet.address);
      setCopied(true);
      setToast('Wallet address copied');
      window.setTimeout(() => setCopied(false), 1_400);
    } catch { setFormError('The wallet address could not be copied by this browser.'); }
  }

  async function performAction(label, send) {
    setBusy(true);
    setFormError('');
    try {
      return await performWalletAction({
        label,
        send,
        waitForReceipt: waitForAction,
        refresh,
        errorMessage,
        onTransaction: setTransaction,
      });
    } finally { setBusy(false); }
  }

  async function handleCreateStream(event) {
    event.preventDefault();
    setFormError('');
    if (!wallet?.walletClient || !canCreateStream) return;
    try {
      if (!isAddress(employeeAddress)) throw new Error('Enter a valid employee wallet address.');
      if (employeeAddress.toLowerCase() === wallet.address.toLowerCase()) throw new Error('The employee wallet must differ from the employer wallet.');
      const rate = parseEther(monthlyRate) / MONTH_SECONDS;
      const funding = parseEther(initialFunding);
      if (rate === 0n) throw new Error('Monthly salary is too small to represent a non-zero per-second rate.');
      if (funding === 0n) throw new Error('Initial funding must be greater than 0 MON.');
      setBusy(true);
      setTransaction({ label: 'Create salary stream', status: 'wallet' });
      const created = await createFactoryStream(wallet.walletClient, employeeAddress, rate, funding, (hash) => {
        setTransaction({ label: 'Create salary stream', status: 'pending', hash });
      });
      setTransaction({ label: 'Create salary stream', status: 'confirmed', hash: created.hash });
      await loadStreams(wallet.address);
      const record = {
        address: created.streamAddress,
        source: 'factory',
        deploymentBlock: FLOWPAY_FACTORY_DEPLOYMENT_BLOCK,
        employer: wallet.address,
        employee: employeeAddress,
      };
      setStreamChoices((current) => [...current.filter((stream) => stream.address.toLowerCase() !== created.streamAddress.toLowerCase()), record]);
      setSelectedStreamAddress(created.streamAddress);
      setStreamData(await readStream(created.streamAddress));
      setReadError('');
      setReadErrorStreamAddress(null);
      setActivity(await readActivity(created.streamAddress, FLOWPAY_FACTORY_DEPLOYMENT_BLOCK));
      setActivityStreamAddress(created.streamAddress);
      setActivityError('');
      setActivityErrorStreamAddress(null);
      setEmployeeAddress('');
      setMonthlyRate('');
      setInitialFunding('');
      setToast('New salary stream is live');
    } catch (error) {
      setFormError(errorMessage(error));
      setTransaction((current) => ({ ...current, label: 'Create salary stream', status: 'error', message: errorMessage(error) }));
    } finally { setBusy(false); }
  }

  async function handleRegisterLegacy() {
    if (!wallet?.walletClient || !canImportLegacy) return;
    setBusy(true);
    setFormError('');
    setTransaction({ label: 'Import existing stream', status: 'wallet' });
    try {
      const imported = await registerLegacyStream(wallet.walletClient, FLOWPAY_ADDRESS, (hash) => {
        setTransaction({ label: 'Import existing stream', status: 'pending', hash });
      });
      setTransaction({ label: 'Import existing stream', status: 'confirmed', hash: imported.hash });
      await loadStreams(wallet.address);
      setLegacyRegistered(true);
      setSelectedStreamAddress(FLOWPAY_ADDRESS);
      setToast('Existing stream added to your list');
    } catch (error) {
      setFormError(errorMessage(error));
      setTransaction((current) => ({ ...current, label: 'Import existing stream', status: 'error', message: errorMessage(error) }));
    } finally { setBusy(false); }
  }

  async function handleTopUp(event) {
    event.preventDefault();
    setFormError('');
    try {
      const amount = parseEther(topUpAmount);
      if (amount === 0n) throw new Error('Enter a top-up amount greater than 0 MON.');
      if (await performAction('Add payroll funding', () => submitAction(wallet.walletClient, activeStreamAddress, 'topUp', [], amount))) setTopUpAmount('');
    } catch (error) { setFormError(errorMessage(error)); }
  }

  async function submitClaim(amountText, kind) {
    setFormError('');
    try {
      const amount = parseEther(amountText);
      const available = kind === 'salary' ? live?.salaryClaimable : live?.savingsClaimable;
      if (amount === 0n) throw new Error('Enter an amount greater than 0 MON.');
      if (!available || amount > available) throw new Error('The amount exceeds the current claimable balance.');
      const ok = await performAction(
        kind === 'salary' ? 'Withdraw earned salary' : 'Claim reserved savings',
        () => submitAction(wallet.walletClient, activeStreamAddress, kind === 'salary' ? 'claimSalary' : 'claimSavings', [amount]),
      );
      if (ok) {
        if (kind === 'salary') setSalaryClaimAmount('');
        else setSavingsClaimAmount('');
        setWithdrawAmount('');
      }
      return ok;
    } catch (error) {
      setFormError(errorMessage(error));
      return false;
    }
  }

  async function handleClaim(event, kind) {
    event.preventDefault();
    await submitClaim(kind === 'salary' ? salaryClaimAmount : savingsClaimAmount, kind);
  }

  async function handleWithdraw(event) {
    event.preventDefault();
    if (await submitClaim(withdrawAmount, 'salary')) setModal(false);
  }

  async function handleSaveRate() {
    if (!snapshot || draftSavingsRate === Number(snapshot.savingsRateBps)) return;
    await performAction('Update auto-save rate', () => submitAction(wallet.walletClient, activeStreamAddress, 'setSavingsRate', [draftSavingsRate]));
  }

  const heading = tab === 'Payroll system' ? 'India payroll'
    : tab === 'Employer payroll' ? 'Testnet stream controls'
    : tab === 'My salary' ? 'Your salary'
      : tab === 'Activity' ? 'On-chain activity'
        : 'Your money, in motion';

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#top" onClick={(event) => { event.preventDefault(); setTab('Overview'); }}>
        <span className="brand-mark"><Activity size={19} strokeWidth={2.8} /></span><span>flowpay<span className="brand-dot">.</span></span>
      </a>
      <div className="workspace-switch"><div className="workspace-avatar">F</div><div className="workspace-copy"><strong>FlowPay</strong><span>Monad salary streams</span></div><ChevronDown size={15} /></div>
      <div className="nav-label">WORKSPACE</div>
      <nav className="main-nav" aria-label="Main navigation">
        {NAV_ITEMS.map(([name, Icon]) => <button key={name} className={'nav-item ' + (tab === name ? 'active' : '')} onClick={() => setTab(name)} aria-current={tab === name ? 'page' : undefined}>
          <Icon size={17} /><span>{name}</span>
        </button>)}
      </nav>
      <div className="nav-label streams-label">NETWORK</div>
      <div className="network-side"><span className={'network-dot ' + (wallet && !networkReady ? 'network-dot-off' : '')} /><span><strong>{wallet && !networkReady ? 'Wrong network' : 'Monad Testnet'}</strong><small>Chain {MONAD_CHAIN_ID}</small></span></div>
      <div className="sidebar-spacer" />
      <div className="help-card"><div className="help-icon"><CircleHelp size={16} /></div><strong>Need a hand?</strong><p>Check the network and contract.</p><a href="https://docs.monad.xyz/developer-essentials/testnet" target="_blank" rel="noreferrer">Monad Testnet docs <ArrowUpRight size={13} /></a></div>
      {wallet ? <button className="profile-row" onClick={() => setWallet(null)} title="Disconnect this app"><div className="profile-avatar">{wallet.address.slice(2, 4).toUpperCase()}</div><div className="profile-info"><strong>{shortAddress(wallet.address)}</strong><span>{role} · Disconnect</span></div><LogOut size={18} /></button>
        : <button className="profile-row" onClick={handleConnect}><div className="profile-avatar"><Wallet size={14} /></div><div className="profile-info"><strong>Wallet disconnected</strong><span>Connect MetaMask</span></div><ChevronRight size={17} /></button>}
    </aside>

    <main className="main-area" id="top">
      <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>{tab}</strong></div>
        <div className="top-actions">{tab === 'Payroll system' ? <span className="network-pill"><i />India · INR</span> : <span className={'network-pill ' + (wallet && !networkReady ? 'network-pill-wrong' : '')}><i />{wallet && !networkReady ? 'Switch to Monad' : 'Monad Testnet · 10143'}</span>}
          {wallet ? <><button className="icon-button" aria-label="Copy wallet address" title="Copy address" onClick={handleCopyAddress}>{copied ? <Check size={16} /> : <Copy size={16} />}</button><div className="top-divider" /><button className="top-avatar" title="Disconnect app" onClick={() => setWallet(null)}>{wallet.address.slice(2, 4).toUpperCase()}</button>{!networkReady && <button className="outline-button" onClick={handleSwitchNetwork}>Switch network</button>}</>
            : <button className="outline-button top-connect" onClick={handleConnect}><Wallet size={15} />Connect wallet</button>}
        </div>
      </header>
      <div className="content">
        <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line" />{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}</div><h1>{heading}<span>.</span></h1><p className="heading-sub">{tab === 'Payroll system' ? 'Employer funded, INR denominated, locally simulated.' : 'Salary settles in native MON on Monad Testnet.'}</p></div>
          {tab !== 'Payroll system' && <button className="outline-button" onClick={() => refresh()} disabled={loading || !activeStreamAddress}><RefreshCw size={14} className={loading ? 'spin' : ''} />{loading ? 'Refreshing' : 'Refresh'}</button>}
        </div>

        {tab !== 'Payroll system' && <section className="stream-switcher">
          <label htmlFor="active-stream">Active salary stream</label>
          <select id="active-stream" value={activeStreamAddress || ''} onChange={(event) => setSelectedStreamAddress(event.target.value || null)} disabled={streamsLoading || busy || !streamChoices.length}>
            {!streamChoices.length && <option value="">{streamsLoading ? 'Finding your streams…' : 'No stream available for this wallet'}</option>}
            {streamChoices.map((stream) => {
              const streamRole = roleFor(wallet?.address, stream.employer, { streamCreated: true, employee: stream.employee }, stream.employee);
              const participant = streamRole === 'Employer' ? 'Employee ' + shortAddress(stream.employee) : 'Employer ' + shortAddress(stream.employer);
              return <option value={stream.address} key={stream.address}>{streamRole === 'Employer' ? 'Employer payroll' : streamRole === 'Employee' ? 'Your salary' : 'Read only'} · {participant} · {shortAddress(stream.address)}</option>;
            })}
          </select>
          <div className="stream-switcher-meta">
            <span>{selectedStream ? (selectedStream.source === 'legacy' ? 'Original FlowPay contract' : 'Factory-created stream') : streamsError || 'Connect a wallet to find its streams, or create a new stream.'}</span>
            <button className="small-button" onClick={() => loadStreams(wallet?.address)} disabled={streamsLoading}><RefreshCw size={13} className={streamsLoading ? 'spin' : ''} />Refresh list</button>
            <button className="small-button" onClick={() => setTab('Employer payroll')}>New stream <Plus size={13} /></button>
          </div>
          {streamsError && <p className="stream-list-error" role="status">{streamsError}</p>}
        </section>}

        {tab !== 'Payroll system' && setupError && <section className="notice setup-notice"><span className="notice-icon"><AlertCircle size={17} /></span><div><strong>Fresh contract required</strong><p>{setupError} Restart this app after updating the local config.</p></div><a href="https://testnet.monadscan.com" target="_blank" rel="noreferrer">MonadScan <ExternalLink size={13} /></a></section>}
        {tab !== 'Payroll system' && wallet && !networkReady && <section className="notice warning-notice"><span className="notice-icon"><AlertCircle size={17} /></span><div><strong>Wallet is on another network</strong><p>Switch MetaMask to Monad Testnet before making a transaction.</p></div><button className="small-button" onClick={handleSwitchNetwork}>Switch network</button></section>}
        {activeReadError && activeStreamAddress && <section className="notice error-notice"><span className="notice-icon"><AlertCircle size={17} /></span><div><strong>Could not read selected stream</strong><p>{activeReadError}{snapshot ? ' Showing the last confirmed snapshot; the live counter is paused.' : ''}</p></div></section>}
        {transaction && <section className={'transaction-banner ' + transaction.status}><span className="transaction-icon">{transaction.status === 'confirmed' ? <Check size={16} /> : transaction.status === 'error' ? <AlertCircle size={16} /> : <Clock3 size={16} />}</span>
          <div className="transaction-copy"><strong>{transaction.label} · {transaction.status === 'wallet' ? 'Check MetaMask' : transaction.status === 'pending' ? 'Pending confirmation' : transaction.status === 'confirmed' ? 'Confirmed on Monad' : 'Could not complete'}</strong>
            {transaction.hash && <a href={MONADSCAN_TX_URL(transaction.hash)} target="_blank" rel="noreferrer">{shortAddress(transaction.hash)} · View on MonadScan <ExternalLink size={12} /></a>}{transaction.message && <p>{transaction.message}</p>}</div><button className="dismiss-button" onClick={() => setTransaction(null)} aria-label="Dismiss transaction message"><X size={16} /></button>
        </section>}
        {formError && <section className="inline-error" role="alert"><AlertCircle size={15} />{formError}<button onClick={() => setFormError('')} aria-label="Dismiss error"><X size={14} /></button></section>}

        {tab === 'Payroll system' && <Suspense fallback={<div className="pw-card pw-loading">Opening payroll workspace…</div>}><PayrollWorkspace wallet={wallet} onConnect={handleConnect} /></Suspense>}
        {tab === 'Overview' && <OverviewPage
          snapshot={snapshot} live={live} streamData={activeStreamData} activity={recentActivity.slice(0, 4)} statusLabel={statusLabel} loading={loading} activityError={activeActivityError} setupError={setupError}
          role={role} onClaim={() => role === 'Employee' ? setModal(true) : setTab('Employer payroll')} onActivity={() => setTab('Activity')} onPayroll={() => setTab('Employer payroll')} onMySalary={() => setTab('My salary')}
          onPause={() => performAction('Pause salary stream', () => submitAction(wallet.walletClient, activeStreamAddress, 'pause'))} onResume={() => performAction('Resume salary stream', () => submitAction(wallet.walletClient, activeStreamAddress, 'resume'))}
          canEmployer={canEmployer} busy={busy} savingsRate={snapshot ? Number(snapshot.savingsRateBps) : undefined} draftSavingsRate={draftSavingsRate} setDraftSavingsRate={setDraftSavingsRate} onSaveRate={handleSaveRate}
        />}
        {tab === 'My salary' && <EmployeePage snapshot={snapshot} live={live} role={role} canEmployee={canEmployee} busy={busy} setupError={setupError} readError={activeReadError} loading={loading}
          salaryClaimAmount={salaryClaimAmount} setSalaryClaimAmount={setSalaryClaimAmount} savingsClaimAmount={savingsClaimAmount} setSavingsClaimAmount={setSavingsClaimAmount}
          draftSavingsRate={draftSavingsRate} setDraftSavingsRate={setDraftSavingsRate} onSaveRate={handleSaveRate} onClaim={handleClaim} setModal={setModal} />}
        {tab === 'Employer payroll' && <EmployerPage snapshot={snapshot} live={live} role={role} canEmployer={canEmployer} busy={busy} setupError={setupError} readError={activeReadError} loading={loading}
          employeeAddress={employeeAddress} setEmployeeAddress={setEmployeeAddress} monthlyRate={monthlyRate} setMonthlyRate={setMonthlyRate} initialFunding={initialFunding} setInitialFunding={setInitialFunding}
          topUpAmount={topUpAmount} setTopUpAmount={setTopUpAmount} onCreate={handleCreateStream} onTopUp={handleTopUp}
          onPause={() => performAction('Pause salary stream', () => submitAction(wallet.walletClient, activeStreamAddress, 'pause'))} onResume={() => performAction('Resume salary stream', () => submitAction(wallet.walletClient, activeStreamAddress, 'resume'))}
          canCreateStream={canCreateStream} canImportLegacy={canImportLegacy} factorySetupError={FLOWPAY_FACTORY_CONFIG_ERROR || (!FLOWPAY_FACTORY_ADDRESS ? 'Deploy the factory and set its address and deployment block to create additional streams.' : !factoryReady ? (streamsLoading ? 'Checking factory code on Monad Testnet…' : streamsError || 'The configured factory is not available on Monad Testnet.') : '')}
          onRegisterLegacy={handleRegisterLegacy} streamAddress={activeStreamAddress} legacyAvailable={Boolean(legacyStream?.created && wallet?.address && legacyStream.employer.toLowerCase() === wallet.address.toLowerCase() && !legacyRegistered)} />}
        {tab === 'Activity' && <ActivityPage events={recentActivity} loading={loading} error={activeActivityError} setupError={setupError} />}

        {tab !== 'Payroll system' && <footer className="footer"><span><ShieldCheck size={13} />Balances come from the selected contract.</span><span>Counter projection is capped by confirmed funding.</span><a href={activeStreamAddress ? 'https://testnet.monadscan.com/address/' + activeStreamAddress : 'https://testnet.monadscan.com'} target="_blank" rel="noreferrer">{activeStreamAddress ? 'Open stream on MonadScan' : 'MonadScan'} <ExternalLink size={11} /></a></footer>}
      </div>
    </main>

    {modal && <div className="modal-backdrop" onClick={() => setModal(false)}><section className="withdraw-modal" onClick={(event) => event.stopPropagation()}>
      <div className="modal-head"><div className="modal-icon"><ArrowUpRight size={18} /></div><button className="close-modal" onClick={() => setModal(false)} aria-label="Close"><X size={18} /></button></div>
      <h2>Claim earned salary</h2><p>This sends vested MON from the FlowPay contract to the employee wallet.</p><div className="modal-available"><span>Claimable salary</span><strong>{formatMon(live?.salaryClaimable)} MON</strong></div>
      <form onSubmit={handleWithdraw}><label htmlFor="withdraw-input">Amount to claim</label><div className="amount-input"><span>MON</span><input id="withdraw-input" type="number" min="0" step="any" value={withdrawAmount} onChange={(event) => setWithdrawAmount(event.target.value)} placeholder="0.00" disabled={!canEmployee || busy} /><button type="button" onClick={() => setWithdrawAmount(formatEther(live?.salaryClaimable || 0n))} disabled={!canEmployee || busy || !live?.salaryClaimable}>MAX</button></div>
        <div className="receive-row"><span>Receiving wallet</span><strong>{role === 'Employee' ? shortAddress(wallet?.address) : 'Connect the employee wallet'}</strong></div><button className="confirm-withdraw" type="submit" disabled={!canEmployee || busy || !live?.salaryClaimable}>Confirm claim <ArrowUpRight size={15} /></button></form>
      <div className="modal-note"><ShieldCheck size={14} />MetaMask signs the claim; MonadScan records the transaction.</div>
    </section></div>}
    {toast && <div className="toast"><span><Check size={14} /></span>{toast}<button onClick={() => setToast('')} aria-label="Dismiss"><X size={14} /></button></div>}
  </div>;
}

function OverviewPage({ snapshot, live, streamData, activity, statusLabel, loading, activityError, setupError, role, onClaim, onActivity, onPayroll, onMySalary, onPause, onResume, canEmployer, busy, savingsRate, draftSavingsRate, setDraftSavingsRate, onSaveRate }) {
  const active = Boolean(snapshot?.streamCreated);
  const monthlyRate = snapshot ? snapshot.ratePerSecond * MONTH_SECONDS : undefined;
  const createdAt = activity.find((entry) => entry.name === 'StreamCreated')?.timestamp;
  const progress = snapshot && snapshot.totalDeposited > 0n && live
    ? Number((live.totalVested * 10_000n) / snapshot.totalDeposited) / 100 : 0;
  const paused = Boolean(snapshot?.paused);
  const exhausted = Boolean(snapshot?.underfunded);
  return <>
    <section className="hero-card">
      <div className="hero-topline"><div className="live-label"><span className={'live-pulse ' + (!active || paused || exhausted ? 'is-paused' : '')} />{statusLabel.toUpperCase()}</div><span className="block-label">{streamData?.blockNumber ? 'Block ' + streamData.blockNumber.toString() : 'Waiting for contract read'}</span></div>
      <div className="hero-main"><div><div className="balance-label">AVAILABLE TO WITHDRAW <span className="info-mark" title="Vested salary available to the connected employee">i</span></div>
        <div className="hero-balance"><span className="currency">MON</span>{formatMon(live?.salaryClaimable)}</div><div className="balance-change"><span className="change-pill"><Activity size={13} />{active ? 'Per-second stream' : 'No active stream'}</span><span>Monad Testnet · live contract state</span></div></div>
        <div className="hero-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit-core"><Activity size={23} /></div><span className="orbit-node node-a" /><span className="orbit-node node-b" /><span className="orbit-node node-c" /></div>
      </div>
      <div className="hero-bottom">
        <div className="stream-meta"><span className="meta-icon"><Clock3 size={15} /></span><span><small>STREAM STARTED</small><strong>{createdAt ? dateTime(createdAt) : '—'}</strong></span></div>
        <div className="stream-meta"><span className="meta-icon"><CreditCard size={15} /></span><span><small>MONTHLY RATE</small><strong>{formatMon(monthlyRate, 4)} <em>MON / month</em></strong></span></div>
        <div className="stream-meta"><span className="meta-icon employer-icon"><Landmark size={14} /></span><span><small>PAID BY</small><strong>{shortAddress(streamData?.employer)}</strong></span></div>
        <button className="hero-withdraw" onClick={onClaim} disabled={!active || (role !== 'Employee' && role !== 'Employer')}>{role === 'Employee' ? <><ArrowUpRight size={16} />Withdraw funds</> : <><Landmark size={16} />Payroll controls</>}</button>
      </div>
      {paused && <div className="hero-caption">Accrual is paused. Salary vested before the pause remains claimable.</div>}
      {exhausted && !paused && <div className="hero-caption">Current funding is fully vested. Add MON to continue accrual.</div>}
    </section>

    <section className="stats-grid">
      <StatCard title="Total earned" value={snapshot ? formatMon(live?.totalVested) + ' MON' : '—'} foot={snapshot ? 'Vested from funded payroll' : 'Waiting for contract data'} icon={<Activity size={16} />} tone="earned-icon" />
      <StatCard title="Salary claimed" value={snapshot ? formatMon(snapshot.salaryClaimed) + ' MON' : '—'} foot="Transferred to employee wallet" icon={<ArrowUpRight size={16} />} tone="withdraw-icon" />
      <StatCard title="Savings accrued" value={snapshot ? formatMon(snapshot.savingsAccrued) + ' MON' : '—'} foot={snapshot ? (Number(snapshot.savingsRateBps) / 100) + '% of future vesting' : 'Waiting for contract data'} icon={<Landmark size={16} />} tone="saved-icon" />
      <article className="stat-card funding-card"><div className="stat-top"><span className="stat-title">Unvested funding</span><span className="funding-status"><span />{snapshot ? (exhausted ? 'Fully vested' : 'Streaming') : '—'}</span></div><strong className="stat-value">{snapshot ? formatMon(live?.availableToVest) : '—'}<span className="stat-unit"> MON</span></strong><div className="funding-progress"><span style={{ width: Math.min(100, Math.max(0, progress)) + '%' }} /></div><div className="stat-foot"><span>Contract balance</span><strong>{snapshot ? formatMon(snapshot.contractBalance) + ' MON' : '—'}</strong></div></article>
    </section>

    <section className="lower-grid">
      <article className="panel savings-panel" id="savings-setting"><div className="panel-heading savings-heading"><div><div className="mini-icon"><Landmark size={15} /></div><h2>Save as you earn</h2><p>Choose how much of future vested pay to reserve.</p></div></div>
        <div className="savings-visual"><div className="donut" style={{ '--savings': ((savingsRate || 0) / 100) + '%' }}><div className="donut-inner"><Landmark size={18} /><strong>{savingsRate === undefined ? '—' : (savingsRate / 100) + '%'}</strong><span>of future pay</span></div></div><div className="savings-detail"><span>Available savings</span><strong>{snapshot ? formatMon(live?.savingsClaimable) + ' MON' : '—'}</strong><span className="savings-note"><span />Held in contract · no yield</span></div></div>
        <div className="slider-header"><span>Auto-save rate</span><strong>{draftSavingsRate / 100}%</strong></div><input aria-label="Auto-save rate" type="range" min="0" max="3000" step="500" value={draftSavingsRate} onChange={(event) => setDraftSavingsRate(Number(event.target.value))} style={{ '--range': ((draftSavingsRate / 3000) * 100) + '%' }} disabled={!snapshot?.streamCreated || role !== 'Employee' || busy} /><div className="range-labels"><span>0% spend</span><span>30% save</span></div>
        <button className="save-rate-button" onClick={onSaveRate} disabled={!snapshot?.streamCreated || role !== 'Employee' || busy || draftSavingsRate === Number(snapshot?.savingsRateBps)}>{busy ? 'Waiting for wallet…' : 'Save rate on-chain'}</button>
        <div className="savings-foot"><ShieldCheck size={14} /><span>Changes apply to future vesting only.</span><button onClick={onMySalary}>Open salary</button></div>
      </article>
      <article className="panel activity-panel"><div className="panel-heading"><div><h2>Recent activity</h2><p>Events read from the FlowPay contract</p></div><button className="filter-button" onClick={onActivity}>View all <ArrowUpRight size={14} /></button></div>
        {activity.length ? <div className="activity-list">{activity.map((entry) => <ActivityRow key={entry.transactionHash + entry.name} entry={entry} />)}</div>
          : <ActivityEmptyState setupError={setupError} error={activityError} loading={loading} compact />}
        <button className="view-all" onClick={onActivity}>View all activity <ArrowUpRight size={14} /></button>
      </article>
    </section>

    <section className="payroll-strip"><div className="payroll-avatar">F</div><div className="payroll-copy"><strong>{active ? 'FlowPay salary stream' : 'No salary stream yet'}</strong><span>{active ? 'Employee ' + shortAddress(snapshot.employee) : 'Create a funded stream to begin'}</span></div>
      <div className="funding-mini"><span>Stream status</span><strong><i />{statusLabel}</strong></div><div className="payroll-amount"><span>Unvested</span><strong>{snapshot ? formatMon(live?.availableToVest) + ' MON' : '—'}</strong></div>
      {active ? (paused ? <button className="pause-button resume" onClick={onResume} disabled={!canEmployer || busy}><Play size={14} />Resume stream</button> : <button className="pause-button" onClick={onPause} disabled={!canEmployer || busy}><Pause size={14} />Pause stream</button>)
        : <button className="pause-button" onClick={onPayroll}>Create stream <Plus size={14} /></button>}
    </section>
  </>;
}

function StatCard({ title, value, foot, icon, tone }) {
  return <article className="stat-card"><div className="stat-top"><span className="stat-title">{title}</span><span className={'stat-icon ' + tone}>{icon}</span></div><strong className="stat-value">{value}</strong><div className="stat-foot">{foot}</div></article>;
}

function EmployeePage({ snapshot, live, role, canEmployee, busy, setupError, readError, loading, salaryClaimAmount, setSalaryClaimAmount, savingsClaimAmount, setSavingsClaimAmount, draftSavingsRate, setDraftSavingsRate, onSaveRate, onClaim }) {
  if (!snapshot || !snapshot.streamCreated) return <EmptyState title={setupError ? 'Fresh contract required' : readError ? 'Contract data unavailable' : loading ? 'Reading contract' : 'No salary stream yet'} body={setupError || readError || (loading ? 'Loading state from Monad Testnet.' : 'The employer must create and fund a stream before salary can accrue.')} loading={loading} />;
  return <div className="lower-grid action-grid">
    <section className="panel form-panel"><div className="panel-heading"><div><h2>Withdraw earned salary</h2><p>Claim vested MON to the connected employee wallet.</p></div><span className="mini-icon"><ArrowDownToLine size={16} /></span></div>
      <div className="modal-available"><span>Available to claim</span><strong>{formatMon(live?.salaryClaimable)} MON</strong></div>
      <form className="onchain-form" onSubmit={(event) => onClaim(event, 'salary')}><label htmlFor="salary-amount">Amount</label><div className="amount-input"><span>MON</span><input id="salary-amount" type="number" min="0" step="any" value={salaryClaimAmount} onChange={(event) => setSalaryClaimAmount(event.target.value)} placeholder="0.00" disabled={!canEmployee || busy} /><button type="button" onClick={() => setSalaryClaimAmount(formatEther(live?.salaryClaimable || 0n))} disabled={!canEmployee || busy || !live?.salaryClaimable}>MAX</button></div><button className="confirm-withdraw" type="submit" disabled={!canEmployee || busy || !live?.salaryClaimable}>Withdraw salary <ArrowUpRight size={15} /></button></form>
      <RoleHint role={role} required="Employee" />
    </section>
    <section className="panel form-panel"><div className="panel-heading"><div><h2>Reserved savings</h2><p>Held in the contract, available to claim at any time. No yield.</p></div><span className="mini-icon"><Landmark size={16} /></span></div>
      <div className="modal-available"><span>Available to claim</span><strong>{formatMon(live?.savingsClaimable)} MON</strong></div>
      <form className="onchain-form" onSubmit={(event) => onClaim(event, 'savings')}><label htmlFor="savings-amount">Amount</label><div className="amount-input"><span>MON</span><input id="savings-amount" type="number" min="0" step="any" value={savingsClaimAmount} onChange={(event) => setSavingsClaimAmount(event.target.value)} placeholder="0.00" disabled={!canEmployee || busy} /><button type="button" onClick={() => setSavingsClaimAmount(formatEther(live?.savingsClaimable || 0n))} disabled={!canEmployee || busy || !live?.savingsClaimable}>MAX</button></div><button className="confirm-withdraw" type="submit" disabled={!canEmployee || busy || !live?.savingsClaimable}>Claim savings <ArrowUpRight size={15} /></button></form>
      <label className="rate-label" htmlFor="employee-savings-rate">Reserve from future earnings</label><div className="slider-header"><span>Auto-save rate</span><strong>{draftSavingsRate / 100}%</strong></div>
      <input id="employee-savings-rate" type="range" min="0" max="3000" step="500" value={draftSavingsRate} onChange={(event) => setDraftSavingsRate(Number(event.target.value))} style={{ '--range': ((draftSavingsRate / 3000) * 100) + '%' }} disabled={!canEmployee || busy} />
      <button className="save-rate-button" onClick={onSaveRate} disabled={!canEmployee || busy || draftSavingsRate === Number(snapshot.savingsRateBps)}>Save rate on-chain</button><RoleHint role={role} required="Employee" />
    </section>
  </div>;
}

function EmployerPage({ snapshot, live, role, canEmployer, canCreateStream, canImportLegacy, legacyAvailable, factorySetupError, busy, setupError, readError, loading, employeeAddress, setEmployeeAddress, monthlyRate, setMonthlyRate, initialFunding, setInitialFunding, topUpAmount, setTopUpAmount, onCreate, onTopUp, onPause, onResume, onRegisterLegacy, streamAddress }) {
  const createPanel = <section className="panel form-panel"><div className="panel-heading"><div><h2>New employee stream</h2><p>Create one independently funded on-chain stream for each employee.</p></div><span className="mini-icon"><Plus size={16} /></span></div>
    <form className="onchain-form" onSubmit={onCreate}><label htmlFor="employee-address">Employee wallet address</label><input id="employee-address" type="text" autoComplete="off" spellCheck="false" value={employeeAddress} onChange={(event) => setEmployeeAddress(event.target.value)} placeholder="0x…" disabled={!canCreateStream || busy} />
      <div className="two-fields"><div><label htmlFor="monthly-rate">Monthly salary</label><div className="plain-input"><input id="monthly-rate" type="number" min="0" step="any" value={monthlyRate} onChange={(event) => setMonthlyRate(event.target.value)} placeholder="0.00" disabled={!canCreateStream || busy} /><span>MON</span></div></div>
        <div><label htmlFor="initial-funding">Initial funding</label><div className="plain-input"><input id="initial-funding" type="number" min="0" step="any" value={initialFunding} onChange={(event) => setInitialFunding(event.target.value)} placeholder="0.00" disabled={!canCreateStream || busy} /><span>MON</span></div></div></div>
      <button className="confirm-withdraw" type="submit" disabled={!canCreateStream || busy}><Plus size={15} />Create and fund stream</button>
    </form>
    {factorySetupError ? <p className="inline-copy">{factorySetupError}</p> : !canCreateStream ? <p className="inline-copy">Connect a wallet on Monad Testnet to create a stream.</p> : null}
    {legacyAvailable && <div className="legacy-import"><div><strong>Original FlowPay stream</strong><span>Register it in the new list without moving its funds.</span></div><button className="small-button" onClick={onRegisterLegacy} disabled={!canImportLegacy || busy}>Import <ArrowUpRight size={13} /></button></div>}
  </section>;

  if (!snapshot || !snapshot.streamCreated) return <div className="lower-grid action-grid">
    {createPanel}
    <aside className="panel health-panel"><div className="panel-heading"><div><h2>How funding works</h2><p>Each employee has a separate MON contract. The factory does not hold salary funds.</p></div><span className="mini-icon"><ShieldCheck size={16} /></span></div>
      <div className="explainer-row"><span>01</span><p>Enter the employee wallet and monthly salary.</p></div><div className="explainer-row"><span>02</span><p>Fund their new stream in the same transaction.</p></div><div className="explainer-row"><span>03</span><p>Select streams above to manage payroll separately.</p></div>
      {setupError && <p className="inline-copy error-copy">{setupError}</p>}{readError && <p className="inline-copy error-copy">{readError}</p>}{loading && !setupError && !readError && <p className="inline-copy">Reading Monad Testnet…</p>}
    </aside>
  </div>;

  return <div className="lower-grid action-grid multi-stream-grid">
    {createPanel}
    <section className="panel form-panel"><div className="panel-heading"><div><h2>Selected stream controls</h2><p>Employer actions require this stream’s employer wallet.</p></div><span className="funding-status"><span />{snapshot.paused ? 'Paused' : snapshot.underfunded ? 'Needs funds' : 'Active'}</span></div>
      <div className="detail-list"><Detail label="Employee" value={snapshot.employee} mono /><Detail label="Monthly salary" value={formatMon(snapshot.ratePerSecond * MONTH_SECONDS, 4) + ' MON'} /><Detail label="Contract balance" value={formatMon(snapshot.contractBalance) + ' MON'} /><Detail label="Unvested funding" value={formatMon(live?.availableToVest) + ' MON'} /><Detail label="Salary claimed" value={formatMon(snapshot.salaryClaimed) + ' MON'} /><Detail label="Savings claimed" value={formatMon(snapshot.savingsClaimed) + ' MON'} /></div>
      <form className="onchain-form top-up-form" onSubmit={onTopUp}><label htmlFor="topup-amount">Add payroll funding</label><div className="amount-input"><span>MON</span><input id="topup-amount" type="number" min="0" step="any" value={topUpAmount} onChange={(event) => setTopUpAmount(event.target.value)} placeholder="0.00" disabled={!canEmployer || busy} /><button type="submit" disabled={!canEmployer || busy}><Plus size={14} />Add</button></div></form>
      <div className="control-row">{snapshot.paused ? <button className="confirm-withdraw" onClick={onResume} disabled={!canEmployer || busy}><Play size={15} />Resume stream</button> : <button className="pause-button" onClick={onPause} disabled={!canEmployer || busy}><Pause size={15} />Pause stream</button>}</div><RoleHint role={role} required="Employer" />
    </section>
    <aside className="panel health-panel"><div className="panel-heading"><div><h2>Stream status</h2><p>{snapshot.paused ? 'Accrual is paused; vested salary remains claimable.' : snapshot.underfunded ? 'All current funding has vested. Top up to continue.' : 'Salary accrues against the MON held in this contract.'}</p></div><span className="mini-icon"><Activity size={16} /></span></div>
      <div className="health-number"><span>Auto-save rate</span><strong>{Number(snapshot.savingsRateBps) / 100}%</strong></div><div className="health-number"><span>Total vested</span><strong>{formatMon(live?.totalVested)} MON</strong></div><div className="health-number"><span>Salary claimable</span><strong>{formatMon(live?.salaryClaimable)} MON</strong></div>
      {streamAddress && <a className="contract-link" href={'https://testnet.monadscan.com/address/' + streamAddress} target="_blank" rel="noreferrer">View selected stream <ExternalLink size={13} /></a>}
    </aside>
  </div>;
}

function ActivityPage({ events, loading, error, setupError }) {
  return <section className="panel activity-panel full-activity"><div className="panel-heading"><div><h2>Recent activity</h2><p>Decoded from confirmed FlowPay contract events.</p></div><span className="network-pill"><i />Monad Testnet</span></div>
    {events.length ? <div className="activity-list">{events.map((entry) => <ActivityRow key={entry.transactionHash + entry.name} entry={entry} />)}</div>
      : <ActivityEmptyState setupError={setupError} error={error} loading={loading} />}
  </section>;
}

function ActivityEmptyState({ setupError, error, loading, compact = false }) {
  const state = emptyActivityState({ setupError, error, loading });
  return <EmptyState compact={compact} loading={!setupError && !error && loading} title={state.title} body={state.body} />;
}

function ActivityRow({ entry }) {
  const labels = { StreamCreated: 'Salary stream created', ToppedUp: 'Payroll funding added', StreamPaused: 'Salary stream paused', StreamResumed: 'Salary stream resumed', SavingsRateChanged: 'Auto-save rate changed', SalaryClaimed: 'Salary withdrawn', SavingsClaimed: 'Savings claimed' };
  const claimed = entry.name === 'SalaryClaimed' || entry.name === 'SavingsClaimed';
  const amount = entry.args?.amount;
  const rate = entry.args?.newRateBps;
  const value = amount !== undefined ? (claimed ? '−' : '+') + formatMon(amount) + ' MON' : rate !== undefined ? (Number(rate) / 100) + '%' : '';
  const icon = claimed ? <ArrowUpRight size={15} /> : entry.name === 'ToppedUp' ? <Plus size={15} /> : entry.name === 'StreamPaused' ? <Pause size={14} /> : entry.name === 'StreamResumed' ? <Play size={14} /> : <Activity size={15} />;
  return <div className="transaction"><div className={'tx-icon ' + (claimed ? 'out' : entry.name === 'ToppedUp' ? 'save' : 'in')}>{icon}</div><div className="tx-copy"><strong>{labels[entry.name] || entry.name}</strong><span>{dateTime(entry.timestamp)}</span></div><div className="tx-right"><strong className={claimed ? 'negative' : ''}>{value}</strong><a className="tx-state" href={MONADSCAN_TX_URL(entry.transactionHash)} target="_blank" rel="noreferrer">View transaction <ExternalLink size={12} /></a></div></div>;
}

function Detail({ label, value, mono = false }) {
  return <div className="detail-row"><span>{label}</span><strong className={mono ? 'mono-detail' : ''} title={value}>{value}</strong></div>;
}

function RoleHint({ role, required }) {
  if (role === required) return <p className="role-hint good-hint"><Check size={13} />Connected as {required.toLowerCase()}.</p>;
  return <p className="role-hint"><ShieldCheck size={13} />Connect the {required.toLowerCase()} wallet on Monad Testnet to enable this action.</p>;
}

function EmptyState({ title, body, loading = false, compact = false }) {
  return <div className={'empty-state ' + (compact ? 'compact' : '')}>{loading ? <RefreshCw size={18} className="spin" /> : <Activity size={18} />}<strong>{title}</strong><p>{body}</p></div>;
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App /></React.StrictMode>);
