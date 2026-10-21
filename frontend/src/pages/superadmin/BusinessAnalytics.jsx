import React from 'react';
import PlatformDashboard from '../../components/analytics/PlatformDashboard';

/** The Super Admin's Analytics section: the whole marketplace on one page. */
export default function BusinessAnalytics({ onChanged }) {
  return (
    <PlatformDashboard
      greeting="Marketplace sales from completed orders, in Philippine time."
      onChanged={onChanged}
    />
  );
}
