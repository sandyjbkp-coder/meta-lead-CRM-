import React from 'react';

export default function BtnPrimary({ children, ...props }) {
  return <button {...props} className={`btn-primary ${props.className || ''}`}>{children}</button>;
}
