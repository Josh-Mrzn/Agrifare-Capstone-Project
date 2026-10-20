import React, { useCallback, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  LayoutGrid, Package, Boxes, ShoppingCart, Truck, BarChart3, MessageSquare, UserCog,
} from 'lucide-react';
import PortalShell from '../../components/PortalShell';
import NotificationBell from './components/NotificationBell';
import DashboardTab from './tabs/DashboardTab';
import ProductListTab from './tabs/ProductListTab';
import InventoryTab from './tabs/InventoryTab';
import OrdersTab from './tabs/OrdersTab';
import ReportsTab from './tabs/ReportsTab';
import MessagesTab from './tabs/MessagesTab';
import DeliveryPeopleTab from './tabs/DeliveryPeopleTab';
import AccountInfoTab from './tabs/AccountInfoTab';
import { clearSession, getSessionUser, saveSessionUser } from '../../utils/auth';
import './AdminPage.css';

const SECTIONS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutGrid },
  { id: 'orders', label: 'Orders', icon: ShoppingCart },
  { id: 'products', label: 'Products', icon: Package },
  { id: 'inventory', label: 'Inventory', icon: Boxes },
  { id: 'delivery', label: 'Delivery', icon: Truck },
  { id: 'messages', label: 'Messages', icon: MessageSquare },
  { id: 'analytics', label: 'Analytics', icon: BarChart3 },
  { id: 'account', label: 'Account', icon: UserCog },
];

/** Older notification links use the tab's label ("Orders", "Account Info"). */
function sectionFrom(param) {
  const key = String(param || '').toLowerCase().replace(/\s.*/, '');
  return SECTIONS.some((s) => s.id === key) ? key : 'dashboard';
}

export default function AdminPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [user, setUser] = useState(() => getSessionUser() || {});
  // A seller still applying (or turned down) has only their account page:
  // the shop tools open once a Super Admin approves the application.
  const approved = user.status === 'active';
  const sections = approved ? SECTIONS : SECTIONS.filter((s) => s.id === 'account');
  const active = approved ? sectionFrom(params.get('tab')) : 'account';

  // The live status from the account, so an approval shows without signing
  // out and back in.
  const onStatus = useCallback((me) => {
    setUser((prev) => {
      if (prev.status === me.status) return prev;
      const next = { ...prev, status: me.status };
      saveSessionUser(next);
      return next;
    });
  }, []);

  // The section lives in the URL, so a refresh, the Back button and links in
  // notifications all land on the right one.
  const go = (id) => setParams(id === 'dashboard' ? {} : { tab: id });

  const signOut = () => {
    clearSession();
    navigate('/login');
  };

  const content = {
    dashboard: <DashboardTab onNavigate={go} />,
    orders: <OrdersTab />,
    products: <ProductListTab />,
    inventory: <InventoryTab />,
    delivery: <DeliveryPeopleTab />,
    messages: <MessagesTab user={user} />,
    analytics: <ReportsTab />,
    account: <AccountInfoTab onStatus={onStatus} />,
  }[active];

  return (
    <PortalShell
      portalName="Seller portal"
      roleLabel="Seller"
      workspaceLabel="Seller workspace"
      sections={sections}
      active={active}
      onSelect={go}
      user={user}
      onSignOut={signOut}
      headerActions={approved ? <NotificationBell onNavigate={go} /> : null}
    >
      {content}
    </PortalShell>
  );
}
