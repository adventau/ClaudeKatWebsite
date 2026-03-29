// Budget Period Statement — HTML Template Builder
// Generates a self-contained HTML document for PDF rendering via Puppeteer

function fmt(n) { return '$' + (n || 0).toFixed(2); }
function pct(a, b) { return b > 0 ? Math.round(a / b * 100) : 0; }
function pctChange(start, end) {
  if (!start || start === 0) return { val: 0, dir: 'flat' };
  const change = ((end - start) / Math.abs(start) * 100);
  return { val: Math.abs(Math.round(change * 10) / 10), dir: change >= 0 ? 'up' : 'down' };
}
function changeHtml(change) {
  if (change.dir === 'flat') return '<span style="color:#999">—</span>';
  const color = change.dir === 'up' ? '#22c55e' : '#ef4444';
  const arrow = change.dir === 'up' ? '↑' : '↓';
  return `<span style="color:${color}">${arrow} ${change.val}%</span>`;
}
function esc(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }
function barColor(pctVal) {
  if (pctVal >= 100) return '#ef4444';
  if (pctVal >= 75) return '#f97316';
  return '#f59e0b';
}

function buildStatementHTML(data) {
  const {
    periodLabel, periodStart, periodEnd, generatedDate,
    netWorthStart, netWorthEnd,
    kaliphStart, kaliphEnd, kathrineStart, kathrineEnd,
    totalBudgeted, totalSpent, totalUnbudgeted, surplus,
    overallPct,
    prevAllocation, // { periodLabel, surplus, allocations: [{name, type, platform, amount}] } | null
    categories, // [{emoji, name, color, budgeted, spent, overUnder, pctUsed, paired, partnerName, partnerSpent}]
    kaliphSpent, kaliphTxnCount, kathrineSpent, kathrineTxnCount,
    transactions, // [{date, who, description, category, categoryColor, amount}]
    goals, // [{name, target, current, pctDone, addedThisPeriod, color}]
    holdings, // [{symbol, name, shares, startValue, endValue, changePct, changeDir}]
    portfolioTotalEnd, portfolioChange,
  } = data;

  // ① Header
  const headerHtml = `
  <div style="background:#0f0e1a;padding:2rem 2.5rem 1.75rem;color:#fff">
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1.5rem">
      <div>
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.15em;color:#a78bfa;margin-bottom:4px">The Royal</div>
        <div style="font-size:22px;font-weight:700;letter-spacing:0.02em">Kat &amp; Kai Vault</div>
      </div>
      <div style="text-align:right">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.1em;color:#999;margin-bottom:4px">Budget statement</div>
        <div style="font-size:14px;font-weight:600">${esc(periodLabel)}</div>
        <div style="font-size:11px;color:#888;margin-top:2px">Generated ${esc(generatedDate)}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:1px;background:#2a2640;border-radius:10px;overflow:hidden">
      <div style="background:#1a1830;padding:1rem 1.25rem">
        <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px">Net Worth</div>
        <div style="font-size:20px;font-weight:700">${fmt(netWorthEnd)}</div>
        <div style="font-size:12px;margin-top:4px">${changeHtml(pctChange(netWorthStart, netWorthEnd))}</div>
      </div>
      <div style="background:#1a1830;padding:1rem 1.25rem">
        <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px">Kaliph</div>
        <div style="font-size:20px;font-weight:700">${fmt(kaliphEnd)}</div>
        <div style="font-size:11px;color:#888;margin-top:2px">from ${fmt(kaliphStart)}</div>
        <div style="font-size:12px;margin-top:2px">${changeHtml(pctChange(kaliphStart, kaliphEnd))}</div>
      </div>
      <div style="background:#1a1830;padding:1rem 1.25rem">
        <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px">Kathrine</div>
        <div style="font-size:20px;font-weight:700">${fmt(kathrineEnd)}</div>
        <div style="font-size:11px;color:#888;margin-top:2px">from ${fmt(kathrineStart)}</div>
        <div style="font-size:12px;margin-top:2px">${changeHtml(pctChange(kathrineStart, kathrineEnd))}</div>
      </div>
    </div>
  </div>`;

  // ② Budget Summary
  const budgetBarColor = barColor(overallPct);
  const budgetSummaryHtml = `
  <div style="padding:1.75rem 2.5rem;border-bottom:0.5px solid #ebe8e0">
    <div style="font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px">Budget Summary</div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-bottom:14px">
      <div style="background:#f5f3ee;border-radius:8px;padding:11px 12px">
        <div style="font-size:10px;color:#999;margin-bottom:4px">Budgeted</div>
        <div style="font-size:16px;font-weight:700;color:#1a1a2e">${fmt(totalBudgeted)}</div>
      </div>
      <div style="background:#f5f3ee;border-radius:8px;padding:11px 12px">
        <div style="font-size:10px;color:#999;margin-bottom:4px">Spent</div>
        <div style="font-size:16px;font-weight:700;color:#1a1a2e">${fmt(totalSpent)}</div>
      </div>
      <div style="background:#f5f3ee;border-radius:8px;padding:11px 12px">
        <div style="font-size:10px;color:#999;margin-bottom:4px">Unbudgeted</div>
        <div style="font-size:16px;font-weight:700;color:#1a1a2e">${fmt(totalUnbudgeted)}</div>
      </div>
      <div style="background:#f5f3ee;border-radius:8px;padding:11px 12px">
        <div style="font-size:10px;color:#999;margin-bottom:4px">Surplus</div>
        <div style="font-size:16px;font-weight:700;color:#a78bfa">${fmt(surplus)}</div>
      </div>
    </div>
    <div style="height:7px;background:#e5e2dc;border-radius:4px;overflow:hidden;margin-bottom:6px">
      <div style="height:7px;width:${Math.min(overallPct, 100)}%;background:${budgetBarColor};border-radius:4px"></div>
    </div>
    <div style="font-size:11px;color:#999;text-align:right">${overallPct}% of budget used</div>
  </div>`;

  // ③ Previous Surplus Allocation
  let allocationHtml;
  if (prevAllocation && prevAllocation.allocations && prevAllocation.allocations.length > 0) {
    const cards = prevAllocation.allocations.map(a => `
      <div style="background:#f5f3ee;border-radius:8px;padding:11px 12px">
        <div style="font-size:13px;font-weight:600;color:#1a1a2e;margin-bottom:2px">${esc(a.name)}</div>
        <div style="font-size:11px;color:#999">${esc(a.type)}${a.platform ? ' · ' + esc(a.platform) : ''}</div>
        <div style="font-size:15px;font-weight:700;color:#1a1a2e;margin-top:6px">${fmt(a.amount)}</div>
      </div>
    `).join('');
    allocationHtml = `
    <div style="padding:1.75rem 2.5rem;border-bottom:0.5px solid #ebe8e0">
      <div style="font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px">Previous Period Surplus Allocation</div>
      <div style="font-size:12px;color:#999;margin-bottom:12px">From ${esc(prevAllocation.periodLabel)} &middot; ${fmt(prevAllocation.surplus)} surplus</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${cards}</div>
    </div>`;
  } else {
    allocationHtml = `
    <div style="padding:1.75rem 2.5rem;border-bottom:0.5px solid #ebe8e0">
      <div style="font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px">Previous Period Surplus Allocation</div>
      <div style="font-size:12px;color:#999;font-style:italic">No allocation recorded for previous period</div>
    </div>`;
  }

  // ④ Spending by Category
  let catCardsHtml;
  if (categories.length > 0) {
    catCardsHtml = categories.map(c => {
      const catPct = pct(c.spent, c.budgeted);
      const overUnderColor = c.overUnder >= 0 ? '#22c55e' : '#ef4444';
      const overUnderLabel = c.overUnder >= 0 ? `Under ${fmt(c.overUnder)}` : `Over ${fmt(Math.abs(c.overUnder))}`;
      let subLine = '';
      if (c.paired && c.partnerName) {
        subLine = `<div style="font-size:11px;color:#999;margin-top:4px">${esc(c.name)}: ${fmt(c.spent)} &middot; ${esc(c.partnerName)}: ${fmt(c.partnerSpent)}</div>`;
      }
      return `
      <div style="border:0.5px solid #ebe8e0;border-radius:10px;padding:12px 14px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div style="font-size:13px;font-weight:600;color:#1a1a2e">${c.emoji} ${esc(c.displayName || c.name)}</div>
          <div style="font-size:12px;text-align:right">
            <span style="color:#1a1a2e">${fmt(c.spent)} / ${fmt(c.budgeted)}</span>
            <span style="color:${overUnderColor};margin-left:6px">&middot; ${overUnderLabel}</span>
          </div>
        </div>${subLine}
        <div style="height:5px;background:#e5e2dc;border-radius:3px;overflow:hidden;margin-top:8px">
          <div style="height:5px;width:${Math.min(catPct, 100)}%;background:${c.color};border-radius:3px"></div>
        </div>
      </div>`;
    }).join('');
  } else {
    catCardsHtml = '<div style="font-size:12px;color:#999;font-style:italic">No budget categories for this period</div>';
  }
  const categorySectionHtml = `
  <div style="padding:1.75rem 2.5rem;border-bottom:0.5px solid #ebe8e0">
    <div style="font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px">Spending by Category</div>
    ${catCardsHtml}
  </div>`;

  // ⑤ Per Person Breakdown
  const personHtml = `
  <div style="padding:1.75rem 2.5rem;border-bottom:0.5px solid #ebe8e0">
    <div style="font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px">Per Person Breakdown</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <div style="background:#f5f3ee;border-radius:8px;padding:12px 14px">
        <div style="font-size:13px;font-weight:600;color:#1a1a2e;margin-bottom:4px">Kaliph</div>
        <div style="font-size:18px;font-weight:700;color:#1a1a2e">${fmt(kaliphSpent)}</div>
        <div style="font-size:11px;color:#999;margin-top:2px">${kaliphTxnCount} transaction${kaliphTxnCount !== 1 ? 's' : ''}</div>
        <div style="font-size:11px;color:#999;margin-top:4px">${fmt(kaliphStart)} &rarr; ${fmt(kaliphEnd)}</div>
      </div>
      <div style="background:#f5f3ee;border-radius:8px;padding:12px 14px">
        <div style="font-size:13px;font-weight:600;color:#1a1a2e;margin-bottom:4px">Kathrine</div>
        <div style="font-size:18px;font-weight:700;color:#1a1a2e">${fmt(kathrineSpent)}</div>
        <div style="font-size:11px;color:#999;margin-top:2px">${kathrineTxnCount} transaction${kathrineTxnCount !== 1 ? 's' : ''}</div>
        <div style="font-size:11px;color:#999;margin-top:4px">${fmt(kathrineStart)} &rarr; ${fmt(kathrineEnd)}</div>
      </div>
    </div>
  </div>`;

  // ⑥ Transaction Log
  let txnTableHtml;
  if (transactions.length > 0) {
    const rows = transactions.map((t, i) => `
      <tr style="border-bottom:0.5px solid ${i % 2 === 0 ? '#f5f3ee' : '#fff'}">
        <td style="padding:7px 8px;font-size:11px;color:#666">${esc(t.date)}</td>
        <td style="padding:7px 8px;font-size:11px;color:#1a1a2e">${capitalize(esc(t.who))}</td>
        <td style="padding:7px 8px;font-size:11px;color:#1a1a2e">${esc(t.description)}</td>
        <td style="padding:7px 8px"><span style="display:inline-block;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:500;background:${t.categoryColor || '#e5e2dc'};color:#fff">${esc(t.category)}</span></td>
        <td style="padding:7px 8px;font-size:11px;font-weight:600;color:#1a1a2e;text-align:right">${fmt(t.amount)}</td>
      </tr>
    `).join('');
    txnTableHtml = `
    <table style="width:100%;border-collapse:collapse;table-layout:fixed">
      <thead>
        <tr style="border-bottom:1px solid #ebe8e0">
          <th style="padding:7px 8px;font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.06em;text-align:left;width:15%">Date</th>
          <th style="padding:7px 8px;font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.06em;text-align:left;width:14%">Who</th>
          <th style="padding:7px 8px;font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.06em;text-align:left;width:35%">Description</th>
          <th style="padding:7px 8px;font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.06em;text-align:left;width:18%">Category</th>
          <th style="padding:7px 8px;font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.06em;text-align:right;width:18%">Amount</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
  } else {
    txnTableHtml = '<div style="font-size:12px;color:#999;font-style:italic">No transactions for this period</div>';
  }
  const txnSectionHtml = `
  <div style="padding:1.75rem 2.5rem;border-bottom:0.5px solid #ebe8e0">
    <div style="font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px">Transaction Log</div>
    ${txnTableHtml}
  </div>`;

  // ⑦ Savings Goals
  let goalsHtml;
  if (goals.length > 0) {
    const goalCards = goals.map(g => `
      <div style="background:#f5f3ee;border-radius:8px;padding:12px 14px">
        <div style="font-size:13px;font-weight:600;color:#1a1a2e;margin-bottom:4px">${esc(g.name)}</div>
        <div style="font-size:11px;color:#999;margin-bottom:8px">Target: ${fmt(g.target)} &middot; Current: ${fmt(g.current)}</div>
        <div style="height:5px;background:#e5e2dc;border-radius:3px;overflow:hidden;margin-bottom:6px">
          <div style="height:5px;width:${Math.min(g.pctDone, 100)}%;background:${g.color || '#8b5cf6'};border-radius:3px"></div>
        </div>
        ${g.addedThisPeriod > 0 ? `<div style="font-size:11px;color:#22c55e;font-weight:500">+${fmt(g.addedThisPeriod)} added this period</div>` : ''}
      </div>
    `).join('');
    goalsHtml = `
    <div style="padding:1.75rem 2.5rem;border-bottom:0.5px solid #ebe8e0">
      <div style="font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px">Savings Goals</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">${goalCards}</div>
    </div>`;
  } else {
    goalsHtml = `
    <div style="padding:1.75rem 2.5rem;border-bottom:0.5px solid #ebe8e0">
      <div style="font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px">Savings Goals</div>
      <div style="font-size:12px;color:#999;font-style:italic">No savings goals</div>
    </div>`;
  }

  // ⑧ Portfolio Snapshot
  let portfolioHtml;
  if (holdings.length > 0) {
    const hRows = holdings.map((h, i) => `
      <tr style="border-bottom:0.5px solid ${i % 2 === 0 ? '#f5f3ee' : '#fff'}">
        <td style="padding:7px 8px;font-size:12px;font-weight:600;color:#1a1a2e">${esc(h.symbol)}</td>
        <td style="padding:7px 8px;font-size:11px;color:#666">${esc(h.name)}</td>
        <td style="padding:7px 8px;font-size:11px;color:#1a1a2e;text-align:right">${h.shares.toFixed(4)}</td>
        <td style="padding:7px 8px;font-size:11px;color:#1a1a2e;text-align:right">${fmt(h.startValue)}</td>
        <td style="padding:7px 8px;font-size:11px;color:#1a1a2e;text-align:right">${fmt(h.endValue)}</td>
        <td style="padding:7px 8px;font-size:11px;text-align:right">${changeHtml({ val: h.changePct, dir: h.changeDir })}</td>
      </tr>
    `).join('');
    portfolioHtml = `
    <div style="padding:1.75rem 2.5rem;border-bottom:0.5px solid #ebe8e0">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.1em">Portfolio Snapshot</div>
        <div style="text-align:right">
          <span style="font-size:16px;font-weight:700;color:#1a1a2e">${fmt(portfolioTotalEnd)}</span>
          <span style="font-size:12px;margin-left:6px">${changeHtml(portfolioChange)}</span>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;table-layout:fixed">
        <thead>
          <tr style="border-bottom:1px solid #ebe8e0">
            <th style="padding:7px 8px;font-size:10px;color:#999;text-transform:uppercase;text-align:left;width:12%">Ticker</th>
            <th style="padding:7px 8px;font-size:10px;color:#999;text-transform:uppercase;text-align:left;width:30%">Name</th>
            <th style="padding:7px 8px;font-size:10px;color:#999;text-transform:uppercase;text-align:right;width:14%">Shares</th>
            <th style="padding:7px 8px;font-size:10px;color:#999;text-transform:uppercase;text-align:right;width:14%">Start</th>
            <th style="padding:7px 8px;font-size:10px;color:#999;text-transform:uppercase;text-align:right;width:14%">End</th>
            <th style="padding:7px 8px;font-size:10px;color:#999;text-transform:uppercase;text-align:right;width:16%">Change</th>
          </tr>
        </thead>
        <tbody>${hRows}</tbody>
      </table>
    </div>`;
  } else {
    portfolioHtml = `
    <div style="padding:1.75rem 2.5rem;border-bottom:0.5px solid #ebe8e0">
      <div style="font-size:10px;color:#999;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:12px">Portfolio Snapshot</div>
      <div style="font-size:12px;color:#999;font-style:italic">No portfolio holdings</div>
    </div>`;
  }

  // ⑨ Footer
  const footerHtml = `
  <div style="background:#f5f3ee;padding:1rem 2.5rem;display:flex;justify-content:space-between">
    <div style="font-size:11px;color:#bbb">Generated ${esc(generatedDate)} &middot; The Royal Kat &amp; Kai Vault</div>
    <div style="font-size:11px;color:#bbb">Private &amp; confidential</div>
  </div>`;

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a2e;max-width:680px;margin:0 auto">
${headerHtml}
${budgetSummaryHtml}
${allocationHtml}
${categorySectionHtml}
${personHtml}
${txnSectionHtml}
${goalsHtml}
${portfolioHtml}
${footerHtml}
</body>
</html>`;
}

module.exports = { buildStatementHTML };
