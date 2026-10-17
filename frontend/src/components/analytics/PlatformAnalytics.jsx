import React, { useEffect, useMemo, useState } from 'react';
import FilterBar from './FilterBar';
import { DEFAULT_FILTERS, toParams, compareLabel } from './filters';
import TimeChart from './TimeChart';
import ExportPanel from './ExportPanel';
import useAnalytics from './useAnalytics';
import SellerAnalytics, { Gate, SeasonsView } from './SellerAnalytics';
import {
  Panel, Empty, KpiRow, RankBars, ShareBar, DataTable, InsightList, Notice,
} from './parts';
import { PALETTE, STATUS_COLORS, formatValue, formatDay, bucketTitle } from './format';
import { fetchOptions } from '../../services/analyticsApi';
import './analytics.css';

const BASE = '/analytics/platform';

const VIEWS = [
  { id: 'overview', label: 'Overview' },
  { id: 'sales', label: 'Sales and orders' },
  { id: 'sellers', label: 'Sellers' },
  { id: 'products', label: 'Products' },
  { id: 'users', label: 'Accounts' },
  { id: 'seasons', label: 'Seasons' },
  { id: 'reports', label: 'Reports' },
];

const SHOW = {
  overview: { variety: true },
  sales: { variety: true },
  sellers: { variety: true },
  products: { variety: true },
  users: { compare: false },
  seasons: { range: false, compare: false, granularity: false, variety: true },
  reports: { variety: true, status: true },
};

const REPORTS = [
  { id: 'sales', title: 'Marketplace sales', text: 'Every completed order line with seller, rice, pack size and total. No buyer names.' },
  { id: 'orders', title: 'Marketplace orders', text: 'Every order line in the period with its order and payment status. Uses the status filter.' },
  { id: 'sellers', title: 'Seller performance', text: 'Each seller’s sales, share, orders, buyers, average order and change.' },
  { id: 'products', title: 'Varieties', text: 'Sales, share, quantity and price per kg for each rice variety.' },
];

const manilaDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(d));

/**
 * Marketplace analytics for the Super Admin. Opening a seller shows that
 * seller's own analytics, from the same server code the seller sees.
 */
export default function PlatformAnalytics({ initialSeller = null }) {
  const [view, setView] = useState('overview');
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [options, setOptions] = useState({});
  const [period, setPeriod] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);
  const [seller, setSeller] = useState(initialSeller);

  useEffect(() => {
    fetchOptions(BASE).then((res) => setOptions(res.data)).catch(() => {});
  }, []);

  const params = useMemo(() => toParams(filters), [filters]);

  if (seller) {
    return (
      <SellerAnalytics
        base={`${BASE}/sellers/${seller.sellerId}`}
        onBack={() => setSeller(null)}
        heading={<div className="an-seller-head"><span className="eyebrow">Seller analytics</span><h2>{seller.name}</h2></div>}
      />
    );
  }

  const drill = (point) => {
    if (!point?.end) return;
    setFilters((f) => ({ ...f, range: 'custom', from: manilaDate(point.start), to: manilaDate(new Date(new Date(point.end).getTime() - 1)), granularity: 'auto' }));
  };
  const open = (link) => {
    if (link.sellerId) { setSeller({ sellerId: link.sellerId, name: link.name || 'Seller' }); return; }
    if (link.variety) setFilters((f) => ({ ...f, variety: link.variety }));
    if (link.tab) setView(link.tab);
  };
  const shared = { params, filters, setFilters, drill, open, onPeriod: setPeriod, onUpdated: setUpdatedAt, openSeller: setSeller };

  return (
    <div className="an">
      <div className="tabs an-views" role="tablist" aria-label="Marketplace analytics views">
        {VIEWS.map((v) => <button key={v.id} type="button" role="tab" className="tab" aria-selected={view === v.id} onClick={() => setView(v.id)}>{v.label}</button>)}
      </div>
      <FilterBar filters={filters} onChange={setFilters} options={options} show={SHOW[view]} period={view === 'seasons' ? null : period} updatedAt={updatedAt} />
      {view === 'overview' && <Overview {...shared} />}
      {view === 'sales' && <Sales {...shared} />}
      {view === 'sellers' && <Sellers {...shared} />}
      {view === 'products' && <Products {...shared} />}
      {view === 'users' && <Accounts {...shared} />}
      {view === 'seasons' && <SeasonsView base={BASE} params={params} onUpdated={setUpdatedAt} />}
      {view === 'reports' && <ExportPanel base={BASE} reports={REPORTS} params={params} period={period} />}
    </div>
  );
}

function useSection(section, params, onPeriod, onUpdated) {
  const res = useAnalytics(BASE, section, params);
  useEffect(() => {
    if (res.data?.period) onPeriod(res.data.period);
    if (res.data?.dataUpdatedAt !== undefined) onUpdated(res.data.dataUpdatedAt);
  }, [res.data, onPeriod, onUpdated]);
  return res;
}

const salesSeries = (period) => [
  { key: 'sales', label: 'Completed sales', color: PALETTE[0] },
  ...(period?.comparison ? [{ key: 'previousSales', label: period.comparison.kind === 'yoy' ? 'Same period last year' : 'Previous period', color: '#8c968a', dashed: true }] : []),
];
const statusSeries = [
  { key: 'completed', label: 'Completed', color: STATUS_COLORS.completed },
  { key: 'inProgress', label: 'In progress', color: STATUS_COLORS.inProgress },
  { key: 'cancelled', label: 'Cancelled', color: STATUS_COLORS.cancelled },
];

function Overview({ params, drill, open, onPeriod, onUpdated, openSeller, setFilters }) {
  const res = useSection('overview', params, onPeriod, onUpdated);
  return (
    <Gate res={res} rows={3}>
      {(d) => {
        const cl = compareLabel(d.period);
        const a = d.allTime;
        return (
          <>
            {d.insights[0] && <p className="an-lede"><strong>{d.insights[0].title}.</strong> {d.insights[0].detail}</p>}
            <KpiRow kpis={d.kpis} compareLabel={cl} trends={{ sales: d.series.map((p) => p.sales), orders: d.series.map((p) => p.orders), aov: d.series.map((p) => p.aov) }} onOpen={{ sales: () => open({ tab: 'sales' }), sellersWithSales: () => open({ tab: 'sellers' }), newAccounts: () => open({ tab: 'users' }) }} />
            <div className="an-now" aria-label="Current counts, not limited to the selected period">
              <span className="an-now-title">Right now, all time</span>
              <span><strong>{a.buyers}</strong> registered buyers</span>
              <span><strong>{a.activeSellers}</strong> active sellers of {a.sellers}</span>
              <span><strong>{a.suspendedSellers}</strong> suspended</span>
              <span><strong>{a.pendingApprovals}</strong> applications waiting</span>
              <span><strong>{a.riders}</strong> delivery riders</span>
            </div>
            <div className="an-grid an-grid-main">
              <Panel title="Marketplace sales over time" subtitle={`Completed orders by ${d.period.granularity}${cl ? `, against the ${cl}` : ''}. Click to zoom in.`}>
                <TimeChart points={d.series} series={salesSeries(d.period)} granularity={d.period.granularity} kind="area" kinds={['area', 'line', 'bar']} valueType="peso" onSelect={drill} label="Marketplace completed sales over time" />
              </Panel>
              <Panel title="What stands out">
                <InsightList insights={d.insights.slice(1, 6)} onOpen={open} />
              </Panel>
            </div>
            <div className="an-grid an-grid-3">
              <Panel title="Orders in this period" subtitle="Orders placed in the period, by where they are now.">
                <ShareBar label="Order status" parts={[
                  { key: 'c', label: 'Completed', value: d.status.completed, color: STATUS_COLORS.completed },
                  { key: 'p', label: 'In progress', value: d.status.inProgress, color: STATUS_COLORS.inProgress },
                  { key: 'x', label: 'Cancelled', value: d.status.cancelled, color: STATUS_COLORS.cancelled },
                ]} />
                <Notice>A checkout split across two sellers counts as one order for each seller, so seller figures add up to these totals.</Notice>
              </Panel>
              <Panel title="Top sellers" subtitle="Click a seller to open their analytics.">
                <RankBars rows={d.topSellers.map((s) => ({ key: String(s.sellerId), label: s.name, value: s.sales, share: s.share, seller: s }))} extra={(r) => `${r.share}%`} onPick={(r) => openSeller({ sellerId: r.seller.sellerId, name: r.seller.name })} label="Top sellers by completed sales" />
              </Panel>
              <Panel title="Top varieties" subtitle="Click one to filter by it.">
                <RankBars rows={d.varieties.map((v, i) => ({ key: v.variety, label: v.variety, value: v.sales, color: PALETTE[i % PALETTE.length], share: v.share }))} extra={(r) => `${r.share}%`} onPick={(r) => setFilters((f) => ({ ...f, variety: r.key }))} label="Completed sales by variety" />
              </Panel>
            </div>
          </>
        );
      }}
    </Gate>
  );
}

function Sales({ params, drill, open, onPeriod, onUpdated }) {
  const res = useSection('sales', params, onPeriod, onUpdated);
  return (
    <Gate res={res} rows={3}>
      {(d) => {
        const g = d.period.granularity;
        const cl = compareLabel(d.period);
        const sellerSeries = d.sellerSeries.keys.map((k, i) => ({ key: k, label: d.sellerSeries.labels[k], color: k === 'others' ? '#b9b4a6' : PALETTE[i % PALETTE.length] }));
        const varietySeries = d.varietySeries.keys.map((k, i) => ({ key: k, label: k, color: PALETTE[i % PALETTE.length] }));
        return (
          <>
            <KpiRow kpis={d.kpis} compareLabel={cl} />
            <Panel title="Completed sales against the comparison period">
              <TimeChart points={d.series} series={salesSeries(d.period)} granularity={g} kind="line" kinds={['line', 'area', 'bar']} valueType="peso" height={260} onSelect={drill} label="Marketplace sales against the comparison period" />
            </Panel>
            <div className="an-grid an-grid-2">
              <Panel title="Order status over time" subtitle="Orders placed in each period, by where they are now.">
                <TimeChart points={d.series} series={statusSeries} granularity={g} kind="stacked" valueType="number" height={220} label="Orders by status over time" />
              </Panel>
              <Panel title="Orders and average order value" subtitle="Two separate measures side by side; one does not explain the other.">
                <TimeChart points={d.series} series={[{ key: 'orders', label: 'Completed orders', color: PALETTE[0] }]} granularity={g} kind="bar" valueType="number" height={150} label="Completed orders over time" />
                <TimeChart points={d.series} series={[{ key: 'aov', label: 'Average completed order', color: PALETTE[1] }]} granularity={g} kind="line" valueType="peso" height={150} label="Average order value over time" />
              </Panel>
              <Panel title="Sales by seller" subtitle="The five largest sellers; the rest are grouped.">
                <TimeChart points={d.sellerSeries.points} series={sellerSeries} granularity={g} kind="stacked" kinds={['stacked', 'line']} valueType="peso" height={230} label="Completed sales by seller over time" />
              </Panel>
              <Panel title="Sales by variety">
                <TimeChart points={d.varietySeries.points} series={varietySeries} granularity={g} kind="stacked" kinds={['stacked', 'line']} valueType="peso" height={230} label="Completed sales by variety over time" />
              </Panel>
            </div>
            <div className="an-grid an-grid-2">
              <Panel title="Best and worst periods">
                {d.extremes ? (
                  <dl className="an-facts">
                    <div><dt>Strongest</dt><dd>{bucketTitle(d.extremes.best.start, g)} <strong>{formatValue(d.extremes.best.sales, 'peso')}</strong></dd></div>
                    <div><dt>Weakest</dt><dd>{bucketTitle(d.extremes.worst.start, g)} <strong>{formatValue(d.extremes.worst.sales, 'peso')}</strong></dd></div>
                    {d.moves?.rise && <div><dt>Largest rise</dt><dd>into {bucketTitle(d.moves.rise.to.start, g)} <strong>+{formatValue(d.moves.rise.delta, 'peso')}</strong></dd></div>}
                    {d.moves?.fall && <div><dt>Largest drop</dt><dd>into {bucketTitle(d.moves.fall.to.start, g)} <strong>−{formatValue(Math.abs(d.moves.fall.delta), 'peso')}</strong></dd></div>}
                  </dl>
                ) : <Empty title="Not enough periods to compare" />}
              </Panel>
              <Panel title="What the numbers say"><InsightList insights={d.insights} onOpen={open} /></Panel>
            </div>
          </>
        );
      }}
    </Gate>
  );
}

const SELLER_FILTERS = [
  { id: 'all', label: 'All sellers' },
  { id: 'selling', label: 'With sales' },
  { id: 'none', label: 'No sales' },
  { id: 'declining', label: 'Declining' },
];

function Sellers({ params, onPeriod, onUpdated, openSeller }) {
  const res = useSection('sellers', params, onPeriod, onUpdated);
  const [which, setWhich] = useState('all');
  return (
    <Gate res={res} rows={1}>
      {(d) => {
        const cl = compareLabel(d.period);
        const rows = d.sellers.filter((s) => which === 'all'
          || (which === 'selling' && s.sales > 0)
          || (which === 'none' && !s.sales)
          || (which === 'declining' && s.growth?.pct != null && s.growth.pct < 0));
        return (
          <>
            {d.insights.length > 0 && <Panel title="Sellers to look at"><InsightList insights={d.insights} /></Panel>}
            <Panel
              title="Seller performance"
              subtitle={`${formatValue(d.platformSales, 'peso')} in completed sales this period. Sales include delivery fees and exclude cancelled and unfinished orders; seller amounts add up to the platform total.`}
              actions={<div className="an-seg" role="group" aria-label="Which sellers">{SELLER_FILTERS.map((f) => <button key={f.id} type="button" aria-pressed={which === f.id} onClick={() => setWhich(f.id)}>{f.label}</button>)}</div>}
            >
              <DataTable
                rows={rows}
                rowKey={(r) => r.sellerId}
                searchKeys={['name']}
                initialSort={{ key: 'sales', dir: 'desc' }}
                caption="Sellers by completed sales"
                pageSize={15}
                columns={[
                  { key: 'name', label: 'Seller', primary: true, render: (r) => <button type="button" className="row-link" onClick={() => openSeller({ sellerId: r.sellerId, name: r.name })}>{r.name}</button> },
                  { key: 'status', label: 'Account', render: (r) => <span className={`badge${r.status === 'active' ? ' badge-success' : r.status === 'suspended' ? ' badge-danger' : ''}`}>{r.status}</span> },
                  { key: 'sales', label: 'Sales', align: 'right', type: 'peso' },
                  { key: 'share', label: 'Share', align: 'right', type: 'percent' },
                  { key: 'orders', label: 'Orders', align: 'right' },
                  { key: 'buyers', label: 'Buyers', align: 'right' },
                  { key: 'aov', label: 'Avg order', align: 'right', type: 'peso' },
                  { key: 'lastSale', label: 'Last sale', render: (r) => formatDay(r.lastSale), sortValue: (r) => (r.lastSale ? new Date(r.lastSale).getTime() : null) },
                  ...(cl ? [{ key: 'growth', label: 'Change', align: 'right', sortValue: (r) => r.growth?.pct ?? null, render: (r) => (r.growth?.pct == null ? <span className="muted">{r.sales ? 'New' : '—'}</span> : <span className={r.growth.pct >= 0 ? 'text-success' : 'text-danger'}>{r.growth.pct > 0 ? '+' : ''}{r.growth.pct}%</span>) }] : []),
                  { key: 'topVariety', label: 'Top variety', sortable: false, render: (r) => (r.topVariety ? `${r.topVariety.variety} (${r.topVariety.share}%)` : '—') },
                ]}
              />
            </Panel>
          </>
        );
      }}
    </Gate>
  );
}

function Products({ params, filters, setFilters, onPeriod, onUpdated, openSeller }) {
  const res = useSection('products', params, onPeriod, onUpdated);
  return (
    <Gate res={res} rows={2}>
      {(d) => {
        const g = d.period.granularity;
        const series = d.varietySeries.keys.map((k, i) => ({ key: k, label: k, color: PALETTE[i % PALETTE.length] }));
        const cl = compareLabel(d.period);
        return (
          <>
            <div className="an-grid an-grid-2">
              <Panel title="Top varieties" subtitle="Click one to see which sellers sell it.">
                <RankBars rows={d.varieties.map((v, i) => ({ key: v.variety, label: v.variety, value: v.sales, color: PALETTE[i % PALETTE.length], share: v.share, kg: v.kg }))} extra={(r) => `${r.share}% · ${formatValue(r.kg, 'kg')}`} selected={filters.variety || d.distribution.variety} onPick={(r) => setFilters((f) => ({ ...f, variety: f.variety === r.key ? '' : r.key }))} label="Completed sales by variety" />
              </Panel>
              <Panel title={d.distribution.variety ? `Who sells ${d.distribution.variety}` : 'Sales across sellers'} subtitle="Share of this variety’s completed sales by seller.">
                <RankBars rows={d.distribution.sellers.map((s) => ({ key: String(s.sellerId), label: s.name, value: s.sales, share: s.share, seller: s }))} extra={(r) => `${r.share}%`} onPick={(r) => openSeller({ sellerId: r.seller.sellerId, name: r.seller.name })} label="Sellers of the selected variety" />
              </Panel>
            </div>
            <Panel title="Variety demand over time">
              {series.length ? <TimeChart points={d.varietySeries.points} series={series} granularity={g} kind="line" kinds={['line', 'stacked']} valueType="peso" height={250} label="Completed sales by variety over time" /> : <Empty title="No completed sales in this period" />}
            </Panel>
            <Panel title="Varieties" subtitle="Sellers offering counts active listings today; sellers with sales counts this period.">
              <DataTable
                rows={d.varieties}
                rowKey={(r) => r.variety}
                initialSort={{ key: 'sales', dir: 'desc' }}
                caption="Varieties"
                columns={[
                  { key: 'variety', label: 'Variety', primary: true, render: (r) => <strong>{r.variety}</strong> },
                  { key: 'sales', label: 'Sales', align: 'right', type: 'peso' },
                  { key: 'share', label: 'Share', align: 'right', type: 'percent' },
                  { key: 'orders', label: 'Orders', align: 'right' },
                  { key: 'kg', label: 'Kilograms', align: 'right', type: 'kg' },
                  { key: 'pricePerKg', label: 'Avg ₱/kg', align: 'right', type: 'pesoExact' },
                  { key: 'sellersOffering', label: 'Sellers offering', align: 'right' },
                  { key: 'sellersWithSales', label: 'Sellers with sales', align: 'right' },
                  ...(cl ? [{ key: 'change', label: 'Change', align: 'right', sortValue: (r) => r.change?.pct ?? null, render: (r) => (r.change?.pct == null ? <span className="muted">—</span> : <span className={r.change.pct >= 0 ? 'text-success' : 'text-danger'}>{r.change.pct > 0 ? '+' : ''}{r.change.pct}%</span>) }] : []),
                ]}
              />
            </Panel>
            <Panel title="Products" subtitle="Each pack size is its own row. Top 100 by completed sales.">
              <DataTable
                rows={d.products}
                rowKey={(r) => r.key}
                searchKeys={['name', 'variety', 'sellerName']}
                initialSort={{ key: 'sales', dir: 'desc' }}
                caption="Products across the marketplace"
                columns={[
                  { key: 'name', label: 'Product', primary: true, render: (r) => <strong>{r.name}</strong> },
                  { key: 'sellerName', label: 'Seller', render: (r) => r.sellerName },
                  { key: 'variety', label: 'Variety', render: (r) => r.variety },
                  { key: 'sales', label: 'Sales', align: 'right', type: 'peso' },
                  { key: 'orders', label: 'Orders', align: 'right' },
                  { key: 'sacks', label: 'Packs sold', align: 'right', render: (r) => `${r.sacks} × ${r.pack}` },
                  { key: 'kg', label: 'Kilograms', align: 'right', type: 'kg' },
                ]}
              />
            </Panel>
          </>
        );
      }}
    </Gate>
  );
}

function Accounts({ params, onPeriod, onUpdated }) {
  const res = useSection('users', params, onPeriod, onUpdated);
  return (
    <Gate res={res} rows={2}>
      {(d) => {
        const t = d.totals;
        const a = d.allTime;
        return (
          <>
            <KpiRow kpis={[
              { id: 'b', label: 'New buyers', value: t.newBuyers, format: 'number', note: 'Accounts created in the period' },
              { id: 's', label: 'New seller sign-ups', value: t.newSellers, format: 'number', note: 'Applications, approved or not' },
              { id: 'ap', label: 'Sellers approved', value: t.approvals, format: 'number', note: 'Approvals granted in the period' },
              { id: 'r', label: 'New riders', value: t.newRiders, format: 'number', note: 'Added by sellers' },
            ]} />
            <div className="an-grid an-grid-2">
              <Panel title="New accounts over time" subtitle="By the date each account was created.">
                <TimeChart points={d.series} series={[{ key: 'buyers', label: 'Buyers', color: PALETTE[0] }, { key: 'sellers', label: 'Sellers', color: PALETTE[1] }, { key: 'riders', label: 'Riders', color: PALETTE[2] }]} granularity={d.period.granularity} kind="stacked" kinds={['stacked', 'line']} valueType="number" height={230} label="New accounts over time" />
              </Panel>
              <Panel title="Sellers approved over time" subtitle="Approval is a separate event from signing up; a seller can sign up in one month and be approved in the next.">
                <TimeChart points={d.series} series={[{ key: 'approvals', label: 'Sellers approved', color: PALETTE[1] }]} granularity={d.period.granularity} kind="bar" valueType="number" height={230} label="Seller approvals over time" />
              </Panel>
            </div>
            <Panel title="All accounts today" subtitle="Current totals, not limited to the selected period.">
              <dl className="an-facts an-facts-wide">
                <div><dt>Registered buyers</dt><dd><strong>{a.buyers}</strong></dd></div>
                <div><dt>Sellers</dt><dd><strong>{a.sellers}</strong>{a.activeSellers} active, {a.suspendedSellers} suspended, {a.pendingSellers} pending</dd></div>
                <div><dt>Applications waiting</dt><dd><strong>{a.pendingApprovals}</strong></dd></div>
                <div><dt>Delivery riders</dt><dd><strong>{a.riders}</strong></dd></div>
              </dl>
            </Panel>
          </>
        );
      }}
    </Gate>
  );
}
