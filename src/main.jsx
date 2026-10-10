import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Activity, ArrowDownLeft, ArrowUpRight, Bell, Check, ChevronDown, CircleHelp, Clock3, Command, Copy, CreditCard, ExternalLink, Gift, Landmark, LayoutDashboard, LogOut, Menu, MoreHorizontal, Pause, Play, Plus, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Wallet, X } from 'lucide-react';
import './styles.css';

const START_BALANCE = 1240.5;
const RATE_PER_SECOND = 3200 / (30 * 24 * 60 * 60);
const money = (n, digits = 2) => `$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;

function App() {
  const [elapsed, setElapsed] = useState(0);
  const [paused, setPaused] = useState(false);
  const [withdrawn, setWithdrawn] = useState(0);
  const [saved, setSaved] = useState(0);
  const [savingsPct, setSavingsPct] = useState(10);
  const [modal, setModal] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [toast, setToast] = useState('');
  const [tab, setTab] = useState('Overview');
  const [copied, setCopied] = useState(false);
  const earned = START_BALANCE + elapsed * RATE_PER_SECOND;
  const spendable = Math.max(0, earned * (1 - savingsPct / 100) - withdrawn);
  const reserve = earned * savingsPct / 100 - saved;
  const total = earned - withdrawn - saved;

  useEffect(() => {
    if (paused) return;
    const id = setInterval(() => setElapsed(x => x + 1), 1000);
    return () => clearInterval(id);
  }, [paused]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 2800);
    return () => clearTimeout(id);
  }, [toast]);

  const transactions = useMemo(() => [
    { title: 'Salary stream started', sub: 'Today, 9:00 AM · FlowPay payroll', amount: '+$1,240.50', type: 'in', icon: Activity, state: 'Confirmed' },
    ...(withdrawn > 0 ? [{ title: 'Early salary withdrawal', sub: 'Just now · Your wallet', amount: `−${money(withdrawn)}`, type: 'out', icon: ArrowUpRight, state: 'Confirmed' }] : []),
    { title: 'Monthly salary deposit', sub: 'May 1 · Acme Studio', amount: '+$3,200.00', type: 'in', icon: ArrowDownLeft, state: 'Confirmed' },
    { title: 'Savings allocation', sub: 'May 1 · Auto-save · 10%', amount: '+$320.00', type: 'save', icon: Landmark, state: 'Saved' },
  ], [withdrawn]);

  const submitWithdraw = (e) => {
    e.preventDefault();
    const amount = Number(withdrawAmount);
    if (!amount || amount <= 0 || amount > spendable) return;
    setWithdrawn(v => v + amount);
    setModal(false); setWithdrawAmount(''); setToast(`${money(amount)} withdrawal confirmed`);
  };

  const withdrawMax = () => { setWithdrawAmount(spendable.toFixed(2)); };
  const copyAddress = async () => { try { await navigator.clipboard.writeText('0x71C...8a42'); } catch {} setCopied(true); setTimeout(() => setCopied(false), 1500); };

  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#top"><span className="brand-mark"><Activity size={19} strokeWidth={2.8}/></span><span>flowpay<span className="brand-dot">.</span></span></a>
      <div className="workspace-switch"><div className="workspace-avatar">A</div><div className="workspace-copy"><strong>Acme Studio</strong><span>Workspace</span></div><ChevronDown size={15}/></div>
      <div className="nav-label">WORKSPACE</div>
      <nav className="main-nav">
        {[['Overview', LayoutDashboard], ['My salary', Wallet], ['Activity', Activity]].map(([name, Icon]) => <button key={name} className={`nav-item ${tab === name ? 'active' : ''}`} onClick={() => setTab(name)}><Icon size={17}/><span>{name}</span>{name === 'Activity' && <span className="nav-count">4</span>}</button>)}
      </nav>
      <div className="nav-label streams-label">PAYROLL</div>
      <button className="nav-item" onClick={() => setToast('Your employer payroll is up to date')}><Landmark size={17}/><span>Employer payroll</span></button>
      <div className="sidebar-spacer"/>
      <div className="help-card"><div className="help-icon"><CircleHelp size={16}/></div><strong>Need a hand?</strong><p>Find answers in our help center.</p><button onClick={() => setToast('Help center is coming soon')}>Visit help center <ArrowUpRight size={13}/></button></div>
      <button className="profile-row"><div className="profile-avatar">JD</div><div className="profile-info"><strong>Jordan Davis</strong><span>jordan@acme.studio</span></div><MoreHorizontal size={18}/></button>
    </aside>

    <main className="main-area" id="top">
      <header className="topbar"><div className="breadcrumbs"><span>Workspace</span><span className="crumb-slash">/</span><strong>{tab}</strong></div><div className="top-actions"><span className="network-pill"><i/>Monad testnet</span><button className="icon-button" aria-label="Notifications" onClick={() => setToast('You’re all caught up')}><Bell size={18}/><i className="notification-dot"/></button><div className="top-divider"/><div className="top-avatar">JD</div></div></header>

      <div className="content">
        <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> TUESDAY, MAY 20, 2025</div><h1>Your money, in motion<span>.</span></h1><p className="heading-sub">Your salary doesn’t wait for payday. Neither should you.</p></div><button className="outline-button" onClick={() => setToast('Shareable payroll link copied')}><ExternalLink size={15}/> Share account</button></div>

        <section className="hero-card">
          <div className="hero-topline"><div className="live-label"><span className={`live-pulse ${paused ? 'is-paused' : ''}`}/>{paused ? 'STREAM PAUSED' : 'LIVE SALARY STREAM'}</div><button className="stream-menu" onClick={() => setToast('Stream settings are up to date')} aria-label="Stream settings"><MoreHorizontal size={19}/></button></div>
          <div className="hero-main"><div><div className="balance-label">AVAILABLE TO WITHDRAW <span className="info-mark" title="Your earned salary minus auto-savings and withdrawals">i</span></div><div className="hero-balance"><span className="currency">$</span>{spendable.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</div><div className="balance-change"><span className="change-pill"><ArrowUpRight size={13}/> 0.12%</span><span>since stream started</span></div></div><div className="hero-art" aria-hidden="true"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="orbit-core"><Activity size={23}/></div><span className="orbit-node node-a"/><span className="orbit-node node-b"/><span className="orbit-node node-c"/></div></div>
          <div className="hero-bottom"><div className="stream-meta"><span className="meta-icon"><Clock3 size={15}/></span><span><small>STREAMING SINCE</small><strong>Today, 9:00 AM</strong></span></div><div className="stream-meta"><span className="meta-icon"><CreditCard size={15}/></span><span><small>MONTHLY RATE</small><strong>$3,200.00 <em>/ month</em></strong></span></div><div className="stream-meta"><span className="meta-icon employer-icon">A</span><span><small>PAID BY</small><strong>Acme Studio</strong></span></div><button className="hero-withdraw" onClick={() => setModal(true)}><ArrowUpRight size={16}/> Withdraw funds</button></div>
          <div className="hero-grid" aria-hidden="true"/>
        </section>

        <section className="stats-grid">
          <article className="stat-card"><div className="stat-top"><span className="stat-title">Total earned</span><span className="stat-icon earned-icon"><Activity size={16}/></span></div><strong className="stat-value">{money(earned)}</strong><div className="stat-foot"><span className="tiny-trend"><ArrowUpRight size={12}/> 2.4%</span><span>vs. last month</span></div></article>
          <article className="stat-card"><div className="stat-top"><span className="stat-title">Withdrawn</span><span className="stat-icon withdraw-icon"><ArrowUpRight size={16}/></span></div><strong className="stat-value">{money(withdrawn)}</strong><div className="stat-foot">Across 1 withdrawal</div></article>
          <article className="stat-card savings-card"><div className="stat-top"><span className="stat-title">Auto-saved</span><span className="stat-icon saved-icon"><Landmark size={16}/></span></div><strong className="stat-value">{money(Math.max(0, reserve + saved))}</strong><div className="stat-foot"><span className="savings-percent"><span/> {savingsPct}% of earnings</span><button className="text-action" onClick={() => document.getElementById('savings-setting')?.scrollIntoView({behavior:'smooth',block:'center'})}>Manage</button></div></article>
          <article className="stat-card funding-card"><div className="stat-top"><span className="stat-title">Employer funding</span><span className="funding-status"><span/> Funded</span></div><strong className="stat-value">$8,400<span className="stat-unit">.00</span></strong><div className="funding-progress"><span style={{width:`${Math.min(100, Math.max(20, total / 8400 * 100))}%`}}/></div><div className="stat-foot"><span>Remaining in payroll</span><strong>{money(Math.max(0,8400 - total))}</strong></div></article>
        </section>

        <section className="lower-grid">
          <article className="panel activity-panel"><div className="panel-heading"><div><h2>Recent activity</h2><p>Your latest salary movements</p></div><button className="filter-button" onClick={() => setToast('Showing all recent activity')}><SlidersHorizontal size={14}/> Filter</button></div><div className="activity-list">{transactions.slice(0,4).map((tx,i)=>{const Icon=tx.icon;return <div className="transaction" key={`${tx.title}-${i}`}><div className={`tx-icon ${tx.type}`}><Icon size={16}/></div><div className="tx-copy"><strong>{tx.title}</strong><span>{tx.sub}</span></div><div className="tx-right"><strong className={tx.type==='out'?'negative':''}>{tx.amount}</strong><span className="tx-state"><i/> {tx.state}</span></div></div>})}</div><button className="view-all" onClick={() => setTab('Activity')}>View all activity <ArrowUpRight size={14}/></button></article>
          <article className="panel savings-panel" id="savings-setting"><div className="panel-heading savings-heading"><div><div className="mini-icon"><Sparkles size={15}/></div><h2>Save as you earn</h2><p>Put a little aside, automatically.</p></div><button className="settings-button" onClick={() => setToast('Savings settings saved')} aria-label="Savings settings"><Settings2 size={17}/></button></div><div className="savings-visual"><div className="donut" style={{'--savings':`${savingsPct}%`}}><div className="donut-inner"><Landmark size={18}/><strong>{savingsPct}%</strong><span>of each stream</span></div></div><div className="savings-detail"><span>Saved this stream</span><strong>{money(Math.max(0, reserve + saved))}</strong><span className="savings-note"><span/> Earning while you wait</span></div></div><div className="slider-header"><span>Auto-save rate</span><strong>{savingsPct}%</strong></div><input aria-label="Auto-save rate" type="range" min="0" max="30" step="5" value={savingsPct} onChange={e => setSavingsPct(Number(e.target.value))} style={{'--range':`${(savingsPct/30)*100}%`}}/><div className="range-labels"><span>0% spend</span><span>30% save</span></div><div className="savings-foot"><ShieldCheck size={14}/><span>Your savings stay yours. Always.</span><button onClick={() => setToast('Savings are tracked in this demo')}>Learn more</button></div></article>
        </section>

        <section className="payroll-strip"><div className="payroll-avatar">A</div><div className="payroll-copy"><strong>Paid by Acme Studio</strong><span>Payroll stream · Active since May 20</span></div><div className="funding-mini"><span>Stream funding</span><strong><i/> Fully funded</strong></div><div className="payroll-amount"><span>Remaining balance</span><strong>{money(Math.max(0,8400 - total))}</strong></div><button className={`pause-button ${paused?'resume':''}`} onClick={() => {setPaused(p=>!p);setToast(paused?'Salary stream resumed':'Salary stream paused')}}>{paused?<Play size={14}/>:<Pause size={14}/>} {paused?'Resume stream':'Pause stream'}</button><button className="more-button" aria-label="More payroll options" onClick={() => setToast('Payroll options')}><MoreHorizontal size={18}/></button></section>
        <footer className="footer"><span>© 2025 FlowPay, Inc.</span><span><i/> All systems operational</span><a href="#top" onClick={e=>{e.preventDefault();setToast('Built for the Monad hackathon')}}>Built for a better payday <span>↗</span></a></footer>
      </div>
    </main>

    {modal && <div className="modal-backdrop" onClick={() => setModal(false)}><section className="withdraw-modal" onClick={e=>e.stopPropagation()}><div className="modal-head"><div className="modal-icon"><ArrowUpRight size={18}/></div><button className="close-modal" onClick={() => setModal(false)} aria-label="Close"><X size={18}/></button></div><h2>Take your pay with you.</h2><p>Your earned salary is ready when you are.</p><div className="modal-available"><span>Available to withdraw</span><strong>{money(spendable)}</strong></div><form onSubmit={submitWithdraw}><label htmlFor="withdraw-input">Amount</label><div className="amount-input"><span>$</span><input id="withdraw-input" type="number" min="0.01" max={spendable.toFixed(2)} step="0.01" placeholder="0.00" value={withdrawAmount} onChange={e=>setWithdrawAmount(e.target.value)} autoFocus/><button type="button" onClick={withdrawMax}>MAX</button></div><div className="receive-row"><span>Receiving wallet</span><button type="button" onClick={copyAddress}>{copied?<Check size={13}/>:<Copy size={13}/>} {copied?'Copied':'0x71C...8a42'}</button></div><button className="confirm-withdraw" type="submit" disabled={!Number(withdrawAmount)||Number(withdrawAmount)>spendable}>Confirm withdrawal <ArrowUpRight size={15}/></button></form><div className="modal-note"><ShieldCheck size={14}/> This demo simulates a confirmed withdrawal.</div></section></div>}
    {toast && <div className="toast"><span><Check size={14}/></span>{toast}<button onClick={() => setToast('')} aria-label="Dismiss"><X size={14}/></button></div>}
  </div>
}

createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
