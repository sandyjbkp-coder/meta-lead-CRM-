import React from 'react';

export function Input(props) {
  return <input {...props} className={`input ${props.className || ''}`} />;
}

export function BtnPrimary({ children, ...props }) {
  return <button {...props} className={`btn-primary ${props.className || ''}`}>{children}</button>;
}

export function Card({ children, className = '' }) {
  return <div className={`card ${className}`}>{children}</div>;
}
