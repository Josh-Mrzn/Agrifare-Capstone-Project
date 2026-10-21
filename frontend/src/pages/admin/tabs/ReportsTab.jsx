import React, { useEffect, useState } from 'react';
import SellerDashboard from '../../../components/analytics/SellerDashboard';
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
  return (
    <SellerDashboard
      base="/analytics/seller"
      canEmail={mailReady}
      greeting="Your sales from completed orders, in Philippine time."
    />
  );
}
