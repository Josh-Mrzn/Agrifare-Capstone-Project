import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import FilterBar from './FilterBar';
import { DEFAULT_FILTERS, toParams, compareLabel } from './filters';
import TimeChart from './TimeChart';
import ExportPanel from './ExportPanel';
import useAnalytics from './useAnalytics';
import {
  Panel, Empty, Loading, ErrorState, KpiRow, RankBars, ShareBar, DataTable, InsightList, Notice,
} from './parts';
import { PALETTE, STATUS_COLORS, formatValue, formatDay, bucketTitle } from './format';
import { fetchOptions } from '../../services/analyticsApi';
import './analytics.css';

const SELLER_VIEWS = [
  { id: 'overview', label: 'Overview' },
  { id: 'sales', label: 'Sales' },
  { id: 'products', label: 'Products' },
  { id: 'buyers', label: 'Buyers' },
  { id: 'seasons', label: 'Seasons' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'reports', label: 'Reports' },
];

/** Which filters change each view. Filters that would do nothing are hidden. */
const SHOW = {
  overview: { variety: true, product: true },
  sales: { variety: true, product: true },
  products: { variety: true },
  buyers: { variety: true },
  seasons: { range: false, compare: false, granularity: false, variety: true, product: true },
  inventory: { compare: false },
  reports: { variety: true, product: true, status: true },
};

const SELLER_REPORTS = [
  { id: 'sales', title: 'Sales report', text: 'Every completed order line with buyer, rice, pack size, fees and total.' },
  { id: 'orders', title: 'Orders and transactions', text: 'Every order line in the period with its order and payment status. Uses the status filter.' },
  { id: 'products', title: 'Product and variety performance', text: 'Sales, share, quantity and price per kg for each product and variety.' },
  { id: 'buyers', title: 'Buyer analytics', text: 'Buyers with their orders, spend and type, plus past buyers who have gone quiet.' },
  { id: 'inventory', title: 'Inventory and stock movement', text: 'Stock, sell-through and days of stock left per product, and every logged movement.' },
];

/** YYYY-MM-DD in Manila for an instant. */
const manilaDate = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila' }).format(new Date(d));

/**
 * Seller analytics, for the seller themselves (base /analytics/seller) or for
 * a Super Admin looking at one seller (base /analytics/platform/sellers/:id).
 * The server decides whose records these are; this component only asks.
 */
export default function SellerAnalytics({ base = '/analytics/seller', canEmail = false, heading, onBack }) {
  const [view, setView] = useState('overview');
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [options, setOptions] = useState({});
  const [period, setPeriod] = useState(null);
  const [updatedAt, setUpdatedAt] = useState(null);

  useEffect(() => {
    let live = true;
    fetchOptions(base).then((res) => live && setOptions(res.data)).catch(() => {});
    return () => { live = false; };
  }, [base]);

  const params = useMemo(() => toParams(filters), [filters]);

  /** Zoom into one bucket: the range becomes that bucket, the rest stays. */
  const drill = (point) => {
    if (!point?.end) return;
    const end = new Date(new Date(point.end).getTime() - 1);
    setFilters((f) => ({ ...f, range: 'custom', from: manilaDate(point.start), to: manilaDate(end), granularity: 'auto' }));
  };

  /** "Show me" on a finding: open its view, applying any filter it names. */
  const open = (link) => {
    if (link.variety) setFilters((f) => ({ ...f, variety: link.variety, productId: '' }));
    if (link.tab) setView(link.tab);
  };

  const shared = { base, params, filters, setFilters, drill, open, onPeriod: setPeriod, onUpdated: setUpdatedAt };

  return (
    <div className="an">
      {(heading || onBack) && (
        <div className="an-heading">
          {onBack && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
              <ArrowLeft size={15} aria-hidden="true" /> All sellers
            </button>
          )}
          {heading}
        </div>
      )}
      <div className="tabs an-views" role="tablist" aria-label="Analytics views">
        {SELLER_VIEWS.map((v) => (
          <button key={v.id} type="button" role="tab" className="tab" aria-selected={view === v.id} onClick={() => setView(v.id)}>{v.label}</button>
        ))}
      </div>
      <FilterBar filters={filters} onChange={setFilters} options={options} show={SHOW[view]} period={view === 'seasons' ? null : period} updatedAt={updatedAt} />

      {view === 'overview' && <OverviewView {...shared} />}
      {view === 'sales' && <SalesView {...shared} />}
      {view === 'products' && <ProductsView {...shared} />}
      {view === 'buyers' && <BuyersView {...shared} />}
      {view === 'seasons' && <SeasonsView {...shared} />}
      {view === 'inventory' && <InventoryView {...shared} />}
      {view === 'reports' && <ExportPanel base={base} reports={SELLER_REPORTS} params={params} period={period} canEmail={canEmail} />}
    </div>
  );
}

/** Load a section and report its period up to the filter bar. */
function useSection(base, section, params, onPeriod, onUpdated) {
  const res = useAnalytics(base, section, params);
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

export function Gate({ res, rows, children }) {
  if (res.error) return <ErrorState message={res.error} onRetry={res.reload} />;
  if (!res.data) return <Loading rows={rows} />;
  return <div className={`an-body${res.loading ? ' is-refreshing' : ''}`}>{children(res.data)}</div>;
}

// ------------------------------------------------------------- Overview

function OverviewView({ base, params, drill, open, onPeriod, onUpdated, setFilters }) {
  const res = useSection(base, 'overview', params, onPeriod, onUpdated);
  return (
    <Gate res={res} rows={3}>
      {(d) => {
        const cl = compareLabel(d.period);
        const trend = (k) => d.series.map((p) => p[k]);
        const s = d.status;
        return (
          <>
            {d.insights[0] && <p className="an-lede"><strong>{d.insights[0].title}.</strong> {d.insights[0].detail}</p>}
            <KpiRow kpis={d.kpis} compareLabel={cl} trends={{ sales: trend('sales'), orders: trend('orders'), aov: trend('aov'), kg: trend('kg') }} onOpen={{ sales: () => open({ tab: 'sales' }), repeat: () => open({ tab: 'buyers' }) }} />
            <div className="an-grid an-grid-main">
              <Panel title="Sales over time" subtitle={`Completed orders by ${d.period.granularity}${cl ? `, against the ${cl}` : ''}. Click a point to zoom in.`}>
                <TimeChart points={d.series} series={salesSeries(d.period)} granularity={d.period.granularity} kind="area" kinds={['area', 'line', 'bar']} valueType="peso" onSelect={drill} label="Completed sales over time" />
              </Panel>
              <Panel title="What stands out" subtitle="Worked out from the numbers on this page.">
                <InsightList insights={d.insights.slice(1, 6)} onOpen={open} />
              </Panel>
            </div>
            <div className="an-grid an-grid-3">
              <Panel title="Orders over time" subtitle="Orders placed, by where they are now.">
                <TimeChart points={d.series} series={statusSeries} granularity={d.period.granularity} kind="stacked" valueType="number" height={200} onSelect={drill} label="Orders over time by status" />
              </Panel>
              <Panel title="Order status" subtitle={`${s.completed + s.inProgress + s.cancelled} orders placed in this period.`}>
                <ShareBar label="Order status" parts={[
                  { key: 'c', label: 'Completed', value: s.completed, color: STATUS_COLORS.completed },
                  { key: 'p', label: 'In progress', value: s.inProgress, color: STATUS_COLORS.inProgress },
                  { key: 'x', label: 'Cancelled', value: s.cancelled, color: STATUS_COLORS.cancelled },
                ]} />
                {d.cancellationRate != null && <Notice>Cancellation rate {formatValue(d.cancellationRate, 'percent')} of orders placed.</Notice>}
              </Panel>
              <Panel title="Top varieties" subtitle="Click one to filter everything to it.">
                <RankBars rows={d.varieties.map((v, i) => ({ key: v.variety, label: v.variety, value: v.sales, color: PALETTE[i % PALETTE.length], share: v.share }))} extra={(r) => `${r.share}%`} onPick={(r) => { setFilters((f) => ({ ...f, variety: r.key, productId: '' })); }} label="Completed sales by variety" />
              </Panel>
            </div>
            {d.inventory && (
              <Panel title="Stock" subtitle={`${formatValue(d.inventory.totals.stockKg, 'kg')} on hand across ${d.inventory.totals.activeProducts} active products.`} actions={<button type="button" className="btn btn-secondary btn-sm" onClick={() => open({ tab: 'inventory' })}>Inventory analytics</button>}>
                {d.inventory.alerts.length ? (
                  <ul className="an-alerts">{d.inventory.alerts.map((a) => <li key={a.productId + a.text} className={`is-${a.level}`}>{a.text}</li>)}</ul>
                ) : <Empty title="No stock warnings">Every active product is above its warning level.</Empty>}
              </Panel>
            )}
          </>
        );
      }}
    </Gate>
  );
}

// ------------------------------------------------------------- Sales

function SalesView({ base, params, drill, open, onPeriod, onUpdated }) {
  const res = useSection(base, 'sales', params, onPeriod, onUpdated);
  return (
    <Gate res={res} rows={3}>
      {(d) => {
        const cl = compareLabel(d.period);
        const g = d.period.granularity;
        const hasPrevOrders = d.period.comparison;
        return (
          <>
            <KpiRow kpis={d.kpis} compareLabel={cl} trends={{ sales: d.series.map((p) => p.sales), orders: d.series.map((p) => p.orders), aov: d.series.map((p) => p.aov) }} />
            <Panel title="Sales against the comparison period" subtitle={cl ? `Each ${g} lined up with the same position in the ${cl}.` : 'Choose a comparison above to add a second line.'}>
              <TimeChart points={d.series} series={salesSeries(d.period)} granularity={g} kind="line" kinds={['line', 'area', 'bar']} valueType="peso" height={270} onSelect={drill} label="Completed sales compared with the comparison period" />
            </Panel>
            <div className="an-grid an-grid-2">
              <Panel title="Number of orders" subtitle="Completed orders. A rise here with flat sales means smaller orders.">
                <TimeChart points={d.series} series={[{ key: 'orders', label: 'Completed orders', color: PALETTE[0] }, ...(hasPrevOrders ? [{ key: 'previousOrders', label: 'Comparison period', color: '#8c968a', dashed: true }] : [])]} granularity={g} kind="bar" valueType="number" height={210} onSelect={drill} label="Completed orders over time" />
              </Panel>
              <Panel title="Average order value" subtitle="Completed sales divided by completed orders, per period. Gaps mean no orders.">
                <TimeChart points={d.series} series={[{ key: 'aov', label: 'Average order value', color: PALETTE[1] }]} granularity={g} kind="line" valueType="peso" height={210} label="Average order value over time" />
              </Panel>
              <Panel title="Completed and cancelled" subtitle="Orders placed in each period, by where they ended up.">
                <TimeChart points={d.series} series={statusSeries} granularity={g} kind="stacked" valueType="number" height={210} label="Completed, in-progress and cancelled orders" />
              </Panel>
              <Panel title="New and returning buyers" subtitle="Distinct buyers with a completed order in each period.">
                <TimeChart points={d.buyerSeries} series={[{ key: 'returningBuyers', label: 'Returning', color: PALETTE[0] }, { key: 'newBuyers', label: 'New', color: PALETTE[1] }]} granularity={g} kind="stacked" valueType="number" height={210} label="New and returning buyers" />
              </Panel>
            </div>
            <div className="an-grid an-grid-2">
              <Panel title="Best and worst periods" subtitle={`Finished ${g}s only; the one still running is left out.`}>
                {d.extremes ? (
                  <dl className="an-facts">
                    <div><dt>Strongest</dt><dd>{bucketTitle(d.extremes.best.start, g)} <strong>{formatValue(d.extremes.best.sales, 'peso')}</strong></dd></div>
                    <div><dt>Weakest</dt><dd>{bucketTitle(d.extremes.worst.start, g)} <strong>{formatValue(d.extremes.worst.sales, 'peso')}</strong></dd></div>
                    {d.moves?.rise && <div><dt>Largest rise</dt><dd>into {bucketTitle(d.moves.rise.to.start, g)} <strong>+{formatValue(d.moves.rise.delta, 'peso')}</strong></dd></div>}
                    {d.moves?.fall && <div><dt>Largest drop</dt><dd>into {bucketTitle(d.moves.fall.to.start, g)} <strong>−{formatValue(Math.abs(d.moves.fall.delta), 'peso')}</strong></dd></div>}
                  </dl>
                ) : <Empty title="Not enough periods to compare">Pick a longer range, or group by a smaller unit.</Empty>}
                <Notice>Order to completed: average {formatValue(d.completion.current.avgDays, 'days')}, median {formatValue(d.completion.current.medianDays, 'days')}, across {d.completion.current.count} completed orders with a recorded completion time.</Notice>
              </Panel>
              <Panel title="What the numbers say">
                <InsightList insights={d.insights} onOpen={open} />
              </Panel>
            </div>
          </>
        );
      }}
    </Gate>
  );
}

// ------------------------------------------------------------- Products

function ProductsView({ base, params, filters, setFilters, onPeriod, onUpdated }) {
  const res = useSection(base, 'products', params, onPeriod, onUpdated);
  const [hidden, setHidden] = useState([]);
  return (
    <Gate res={res} rows={2}>
      {(d) => {
        const g = d.period.granularity;
        const series = d.varietySeries.keys.map((k, i) => ({ key: k, label: k, color: PALETTE[i % PALETTE.length] }));
        const shown = series.filter((s) => !hidden.includes(s.key));
        const cl = compareLabel(d.period);
        return (
          <>
            <div className="an-grid an-grid-2">
              <Panel title="Sales by variety" subtitle="Completed sales. Click a variety to filter the whole page to it.">
                <RankBars rows={d.varieties.map((v, i) => ({ key: v.variety, label: v.variety, value: v.sales, color: PALETTE[i % PALETTE.length], share: v.share, kg: v.kg }))} extra={(r) => `${r.share}% · ${formatValue(r.kg, 'kg')}`} selected={filters.variety} onPick={(r) => setFilters((f) => ({ ...f, variety: f.variety === r.key ? '' : r.key, productId: '' }))} label="Completed sales by variety" />
              </Panel>
              <Panel title="What changed">
                <InsightList insights={d.insights} empty="No product changes to report for this period." />
              </Panel>
            </div>
            <Panel
              title="Variety demand over time"
              subtitle="Completed sales per variety. Toggle a variety to hide or show it; switch to stacked to see the mix."
              actions={series.length > 1 && (
                <div className="an-toggles">
                  {series.map((s) => (
                    <button key={s.key} type="button" className="an-toggle" aria-pressed={!hidden.includes(s.key)} onClick={() => setHidden((h) => (h.includes(s.key) ? h.filter((x) => x !== s.key) : [...h, s.key]))}>
                      <i style={{ background: s.color }} />{s.label}
                    </button>
                  ))}
                </div>
              )}
            >
              {shown.length ? (
                <TimeChart points={d.varietySeries.points} series={shown} granularity={g} kind="line" kinds={['line', 'stacked']} valueType="peso" height={260} label="Completed sales by variety over time" />
              ) : <Empty title="All varieties hidden" />}
            </Panel>
            <Panel title="Products" subtitle={`Each pack size is its own row: a 25 kg sack and a 5 kg bag are not the same unit.${cl ? ` Change is against the ${cl}.` : ''}`}>
              <DataTable
                rows={d.products}
                rowKey={(r) => r.key}
                searchKeys={['name', 'variety']}
                initialSort={{ key: 'sales', dir: 'desc' }}
                caption="Products by completed sales"
                empty="No completed sales in this period."
                columns={[
                  { key: 'name', label: 'Product', primary: true, render: (r) => <strong>{r.name}</strong> },
                  { key: 'variety', label: 'Variety', render: (r) => r.variety },
                  { key: 'sales', label: 'Sales', align: 'right', type: 'peso' },
                  { key: 'share', label: 'Share', align: 'right', type: 'percent' },
                  { key: 'orders', label: 'Orders', align: 'right' },
                  { key: 'sacks', label: 'Packs sold', align: 'right', render: (r) => `${r.sacks} × ${r.pack}` },
                  { key: 'kg', label: 'Kilograms', align: 'right', type: 'kg' },
                  { key: 'pricePerKg', label: 'Avg ₱/kg', align: 'right', type: 'pesoExact' },
                  ...(cl ? [{ key: 'change', label: 'Change', align: 'right', sortValue: (r) => r.change?.pct ?? null, render: (r) => (r.change?.pct == null ? <span className="muted">{r.previousSales ? '—' : 'New'}</span> : <span className={r.change.pct >= 0 ? 'text-success' : 'text-danger'}>{r.change.pct > 0 ? '+' : ''}{r.change.pct}%</span>) }] : []),
                ]}
              />
            </Panel>
          </>
        );
      }}
    </Gate>
  );
}

// ------------------------------------------------------------- Buyers

const SEGMENTS = [
  { id: 'all', label: 'All buyers' },
  { id: 'new', label: 'New' },
  { id: 'returning', label: 'Returning' },
  { id: 'highValue', label: 'High value' },
];

function BuyersView({ base, params, onPeriod, onUpdated }) {
  const res = useSection(base, 'buyers', params, onPeriod, onUpdated);
  const [segment, setSegment] = useState('all');
  return (
    <Gate res={res} rows={2}>
      {(d) => {
        const cl = compareLabel(d.period);
        const rows = d.buyers.filter((b) => segment === 'all' || (segment === 'highValue' ? b.highValue : b.segment === segment));
        return (
          <>
            <KpiRow kpis={d.kpis} compareLabel={cl} />
            <div className="an-grid an-grid-2">
              <Panel title="New and returning buyers over time">
                <TimeChart points={d.series} series={[{ key: 'returningBuyers', label: 'Returning', color: PALETTE[0] }, { key: 'newBuyers', label: 'New', color: PALETTE[1] }]} granularity={d.period.granularity} kind="stacked" valueType="number" height={220} label="New and returning buyers over time" />
              </Panel>
              <Panel title="Buyer groups" subtitle="How each group is decided.">
                <dl className="an-defs">
                  <div><dt>New <strong>{d.segments.new}</strong></dt><dd>First completed order with you falls in this period.</dd></div>
                  <div><dt>Returning <strong>{d.segments.returning}</strong></dt><dd>Completed an order before this period, and again in it.</dd></div>
                  <div><dt>High value <strong>{d.segments.highValue}</strong></dt><dd>Top fifth of buyers by completed spend in this period. Needs at least 5 buyers.</dd></div>
                  <div><dt>Lapsed <strong>{d.segments.lapsed}</strong></dt><dd>Bought from you before, with no completed order in the {d.inactiveDays} days up to the end of this period.</dd></div>
                </dl>
                <InsightList insights={d.insights} />
              </Panel>
            </div>
            <Panel
              title="Buyers in this period"
              subtitle={`Names and order figures only. Buyers who ordered without an account are matched by name.${d.totalBuyers > d.buyers.length ? ` Showing the top ${d.buyers.length} of ${d.totalBuyers}.` : ''}`}
              actions={(
                <div className="an-seg" role="group" aria-label="Buyer group">
                  {SEGMENTS.map((s) => <button key={s.id} type="button" aria-pressed={segment === s.id} onClick={() => setSegment(s.id)}>{s.label}</button>)}
                </div>
              )}
            >
              <DataTable
                rows={rows}
                rowKey={(r) => r.key}
                searchKeys={['name']}
                initialSort={{ key: 'spent', dir: 'desc' }}
                caption="Buyers by spend"
                empty="No buyers with completed orders in this period."
                columns={[
                  { key: 'name', label: 'Buyer', primary: true, render: (r) => <strong>{r.name || 'Unnamed'}</strong> },
                  { key: 'segment', label: 'Type', render: (r) => <span className={`badge${r.segment === 'new' ? ' badge-warning' : ' badge-success'}`}>{r.segment === 'new' ? 'New' : 'Returning'}{r.highValue ? ' · High value' : ''}</span> },
                  { key: 'orders', label: 'Orders', align: 'right' },
                  { key: 'spent', label: 'Spent', align: 'right', type: 'peso' },
                  { key: 'aov', label: 'Avg order', align: 'right', type: 'peso' },
                  { key: 'lastOrder', label: 'Last order', render: (r) => formatDay(r.lastOrder), sortValue: (r) => new Date(r.lastOrder).getTime() },
                  { key: 'daysSinceLast', label: 'Days since', align: 'right' },
                ]}
              />
            </Panel>
            <Panel title={`Past buyers not seen for ${d.inactiveDays}+ days`} subtitle="Ranked by what they spent with you in total. Worth a message.">
              <DataTable
                rows={d.lapsed}
                rowKey={(r) => r.key}
                searchKeys={['name']}
                empty="Nobody has gone quiet. Every past buyer ordered recently."
                columns={[
                  { key: 'name', label: 'Buyer', primary: true, render: (r) => <strong>{r.name || 'Unnamed'}</strong> },
                  { key: 'lastOrder', label: 'Last completed order', render: (r) => formatDay(r.lastOrder), sortValue: (r) => new Date(r.lastOrder).getTime() },
                  { key: 'lifetimeSpent', label: 'Lifetime spend', align: 'right', type: 'peso' },
                ]}
              />
            </Panel>
          </>
        );
      }}
    </Gate>
  );
}

// ------------------------------------------------------------- Seasons

export function SeasonsView({ base, params, onUpdated }) {
  const seasonParams = useMemo(() => {
    const { variety, productId } = params;
    return { ...(variety ? { variety } : {}), ...(productId ? { productId } : {}) };
  }, [params]);
  const res = useAnalytics(base, 'seasons', seasonParams);
  useEffect(() => { if (res.data) onUpdated(null); }, [res.data, onUpdated]);
  return (
    <Gate res={res} rows={2}>
      {(d) => {
        const months = d.monthly.filter((m) => !m.beforeHistory);
        if (!months.length || !d.firstSale) {
          return <Empty title="No sales history yet">Seasonal patterns need completed orders over several months. They appear here as sales are completed.</Empty>;
        }
        const hasYoy = d.yearOverYear.some((m) => m.previousYearSales != null);
        const series = d.varietySeries.keys.map((k, i) => ({ key: k, label: k, color: PALETTE[i % PALETTE.length] }));
        const varietyPoints = d.varietySeries.points.filter((p) => months.some((m) => m.key === p.key));
        return (
          <>
            <Notice>
              {d.season.coverage === 'short'
                ? `There are ${d.season.monthsOfHistory} months of sales history. That is too short to call any pattern seasonal; this shows what happened, not what will.`
                : d.season.coverage === 'one-year'
                  ? 'One year of history shows one cycle. A pattern needs to repeat before it can be relied on.'
                  : 'Two or more years of history: patterns that repeat across years are worth planning around. This is still a record of the past, not a forecast.'}
            </Notice>
            {d.insights[0] && <p className="an-lede"><strong>{d.insights[0].title}.</strong> {d.insights[0].detail}</p>}
            <div className="an-grid an-grid-2">
              <Panel title="Monthly sales" subtitle={`Since ${formatDay(d.firstSale)}, the first completed sale on record.`}>
                <TimeChart points={months} series={[{ key: 'sales', label: 'Completed sales', color: PALETTE[0] }]} granularity="month" kind="bar" kinds={['bar', 'line']} valueType="peso" height={240} label="Monthly completed sales" />
              </Panel>
              <Panel title="Monthly orders">
                <TimeChart points={months} series={[{ key: 'orders', label: 'Completed orders', color: PALETTE[1] }]} granularity="month" kind="bar" valueType="number" height={240} label="Monthly completed orders" />
              </Panel>
            </div>
            <Panel title="This year against last year" subtitle={hasYoy ? 'The last twelve months beside the same months a year earlier.' : 'Needs sales from more than a year ago, which there are not yet.'}>
              {hasYoy ? (
                <TimeChart points={d.yearOverYear} series={[{ key: 'sales', label: 'Last 12 months', color: PALETTE[0] }, { key: 'previousYearSales', label: 'Year before', color: '#8c968a', dashed: true }]} granularity="month" kind="line" valueType="peso" height={240} label="Year over year monthly sales" />
              ) : <Empty title="No year-over-year comparison yet" />}
            </Panel>
            {series.length > 0 && (
              <Panel title="Variety demand through the year" subtitle="Completed sales per variety, per month.">
                <TimeChart points={varietyPoints} series={series} granularity="month" kind="stacked" kinds={['stacked', 'line']} valueType="peso" height={260} label="Monthly sales by variety" />
              </Panel>
            )}
          </>
        );
      }}
    </Gate>
  );
}

// ------------------------------------------------------------- Inventory

function InventoryView({ base, params, onPeriod, onUpdated, setFilters, filters }) {
  const res = useSection(base, 'inventory', params, onPeriod, onUpdated);
  return (
    <Gate res={res} rows={2}>
      {(d) => {
        const t = d.totals;
        const kpis = [
          { id: 'stock', label: 'Stock on hand', value: t.stockKg, format: 'kg', note: `${t.activeProducts} active products` },
          { id: 'sold', label: 'Sold in period', value: t.soldKg, format: 'kg', note: 'From logged sales' },
          { id: 'restocked', label: 'Restocked', value: t.restockedKg, format: 'kg' },
          { id: 'returned', label: 'Returned', value: t.returnedKg, format: 'kg', note: 'Back on the shelf from returns' },
          { id: 'adjusted', label: 'Adjustments', value: t.adjustedKg, format: 'kg', note: 'Net of count corrections and damage' },
          { id: 'low', label: 'Low / sold out', value: t.low + t.out, format: 'number', note: `${t.low} low, ${t.out} sold out` },
        ];
        const levels = d.levels?.points?.map((p, i) => ({ key: `${i}`, start: p.at, stock: p.stock, end: p.at }));
        return (
          <>
            <KpiRow kpis={kpis} />
            <div className="an-grid an-grid-main">
              <Panel title="Stock movement" subtitle="Kilograms sold, restocked and returned per period, from the movement log. Adjustments can go either way and are totalled above.">
                <TimeChart points={d.series} series={[{ key: 'sold', label: 'Sold', color: PALETTE[0] }, { key: 'restocked', label: 'Restocked', color: PALETTE[1] }, { key: 'returned', label: 'Returned', color: PALETTE[2] }]} granularity={d.period.granularity} kind="bar" valueType="kg" height={250} label="Stock movement over time" />
              </Panel>
              <Panel title="Needs restocking">
                {d.alerts.length ? (
                  <ul className="an-alerts">{d.alerts.map((a) => <li key={a.productId + a.text} className={`is-${a.level}`}>{a.text}</li>)}</ul>
                ) : <Empty title="Nothing needs restocking">All active products are above their warning levels.</Empty>}
              </Panel>
            </div>
            <div className="an-grid an-grid-2">
              <Panel title="Fast movers" subtitle="Most kilograms sold in this period.">
                <RankBars rows={d.fastMovers.map((p) => ({ key: p.productId, label: p.name, value: p.soldKg }))} valueType="kg" label="Fast-moving products" />
              </Panel>
              <Panel title="Slow movers" subtitle="In stock, least sold in this period.">
                {d.slowMovers.length ? (
                  <RankBars rows={d.slowMovers.map((p) => ({ key: p.productId, label: p.name, value: p.stock, color: 'var(--gold)' }))} valueType="kg" extra={(r) => `${formatValue(d.slowMovers.find((p) => p.productId === r.key)?.soldKg, 'kg')} sold`} label="Slow-moving products by stock on hand" />
                ) : <Empty title="No slow movers" />}
              </Panel>
            </div>
            <Panel
              title="Recorded stock level"
              subtitle="The stock level after each logged movement, oldest first. Only recorded points are drawn and they are evenly spaced, so the gap between two points is not to scale in time."
              actions={(
                <select className="select" aria-label="Product" value={filters.productId} onChange={(e) => setFilters((f) => ({ ...f, productId: e.target.value }))}>
                  <option value="">Choose a product</option>
                  {d.products.map((p) => <option key={p.productId} value={p.productId}>{p.name}</option>)}
                </select>
              )}
            >
              {!filters.productId ? <Empty title="Choose a product to see its stock history" /> : levels?.length ? (
                <TimeChart points={levels} series={[{ key: 'stock', label: 'Stock after movement', color: PALETTE[0] }]} granularity="day" kind="line" valueType="kg" height={220} label={`Recorded stock level of ${d.levels.name}`} />
              ) : <Empty title="No logged movements for this product yet" />}
            </Panel>
            <Panel title="Products" subtitle="Sell-through is the share of available stock that sold. Days of stock left needs two weeks of logged sales.">
              <DataTable
                rows={d.products}
                rowKey={(r) => r.productId}
                searchKeys={['name', 'variety']}
                initialSort={{ key: 'soldKg', dir: 'desc' }}
                caption="Inventory by product"
                columns={[
                  { key: 'name', label: 'Product', primary: true, render: (r) => <strong>{r.name}</strong> },
                  { key: 'status', label: 'Status', render: (r) => <span className={`badge${r.status === 'out' ? ' badge-danger' : r.status === 'low' ? ' badge-warning' : ' badge-success'}`}>{{ out: 'Sold out', low: 'Low', ok: 'In stock' }[r.status]}</span> },
                  { key: 'stock', label: 'Stock', align: 'right', type: 'kg' },
                  { key: 'soldKg', label: 'Sold', align: 'right', type: 'kg' },
                  { key: 'restockedKg', label: 'Restocked', align: 'right', type: 'kg' },
                  { key: 'sellThrough', label: 'Sell-through', align: 'right', type: 'percent' },
                  { key: 'kgPerDay', label: 'Kg / day', align: 'right', type: 'decimal' },
                  { key: 'daysCover', label: 'Days left', align: 'right', render: (r) => (r.daysCover == null ? <span className="muted" title="Needs two weeks of logged sales">—</span> : formatValue(r.daysCover, 'decimal')) },
                ]}
              />
              {d.limitations.map((l) => <Notice key={l}>{l}</Notice>)}
              <Notice>Stock value is not shown: AgriFair records selling prices but not what the stock cost.</Notice>
            </Panel>
          </>
        );
      }}
    </Gate>
  );
}
