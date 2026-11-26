import React from 'react';

export default function Badge({ status }) {
  const styles = {
    new: 'badge-new',
    contacted: 'badge-contacted',
    qualified: 'badge-qualified',
    proposal: 'badge-proposal',
    won: 'badge-won',
    lost: 'badge-lost',
  }[status] || 'badge-new';

  return (
    <span className={styles}>
      {status}
    </span>
  );
}
