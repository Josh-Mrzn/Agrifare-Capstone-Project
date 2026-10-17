import React, { useEffect, useState } from 'react';
import SellerAnalytics from '../../../components/analytics/SellerAnalytics';
import { fetchMailStatus } from '../../../services/clientApi';

/**
 * The seller's Analytics tab. Everything is scoped on the server to the
 * signed-in seller; emailing a report is offered only when the server can
 * send mail.
 */
export default function ReportsTab() {
  const [mailReady, setMailReady] = useState(false);
  useEffect(() => {
    fetchMailStatus().then((res) => setMailReady(Boolean(res.data?.configured))).catch(() => {});
  }, []);
  return <SellerAnalytics base="/analytics/seller" canEmail={mailReady} />;
}
