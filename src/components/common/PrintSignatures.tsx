import React from 'react';
import { useApp } from '../../context/AppContext';

/** Shown only when a page is printed / saved as PDF: authorized signature (current user) left, receiver right. */
export const PrintSignatures: React.FC<{ receiverName?: string }> = ({ receiverName }) => {
  const { currentUser, language, tv } = useApp() as any;
  const bn = language === 'bn';
  return (
    <div className="print-only sig-flex justify-between gap-16 mt-16 pt-2" style={{ pageBreakInside: 'avoid' }}>
      <div style={{ width: '42%' }}>
        <div style={{ borderTop: '1.5px solid #0f172a', marginBottom: 5 }} />
        <div className="font-extrabold text-[11px]">{bn ? 'অনুমোদনকারীর স্বাক্ষর' : 'Authorized signature'}</div>
        <div className="text-[11px] mt-1">{bn ? 'নাম' : 'Name'}: <b>{currentUser?.full_name || 'N/A'}</b></div>
        <div className="text-[10px] text-slate-500">{currentUser?.role ? tv(currentUser.role) : 'N/A'}</div>
      </div>
      <div style={{ width: '42%', textAlign: 'right' }}>
        <div style={{ borderTop: '1.5px solid #0f172a', marginBottom: 5 }} />
        <div className="font-extrabold text-[11px]">{bn ? 'গ্রহীতার স্বাক্ষর' : 'Receiver signature'}</div>
        <div className="text-[11px] mt-1">{bn ? 'নাম' : 'Name'}: {receiverName ? <b>{receiverName}</b> : <span style={{ display: 'inline-block', width: 150, borderBottom: '1px dotted #475569', height: 11, verticalAlign: 'bottom' }} />}</div>
      </div>
    </div>
  );
};
