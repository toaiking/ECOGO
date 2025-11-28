import React, { useState, useEffect, useRef } from 'react';
import toast from 'react-hot-toast';
import { Order, OrderStatus, PaymentMethod } from '../types';
import { storageService } from '../services/storageService';
import { generateDeliveryMessage } from '../services/geminiService';

interface Props {
  order: Order;
  onUpdate: (order: Order) => void;
  onDelete: (id: string) => void;
  onEdit: (order: Order) => void;
  isSortMode?: boolean;
  index?: number;
  isCompactMode?: boolean; 
  onTouchStart?: (e: React.TouchEvent<HTMLDivElement>) => void;
  onTouchMove?: (e: React.TouchEvent<HTMLDivElement>) => void;
  onTouchEnd?: (e: React.TouchEvent<HTMLDivElement>) => void;
  isNewCustomer?: boolean;
  onSplitBatch?: (order: Order) => void;
}

const statusConfig: Record<OrderStatus, { color: string; bg: string; label: string; icon: string }> = {
  [OrderStatus.PENDING]: { bg: 'bg-yellow-50', color: 'text-yellow-700', label: 'Chờ xử lý', icon: 'fa-clock' },
  [OrderStatus.PICKED_UP]: { bg: 'bg-blue-50', color: 'text-blue-700', label: 'Đã lấy', icon: 'fa-box-open' },
  [OrderStatus.IN_TRANSIT]: { bg: 'bg-purple-50', color: 'text-purple-700', label: 'Đang giao', icon: 'fa-shipping-fast' },
  [OrderStatus.DELIVERED]: { bg: 'bg-green-50', color: 'text-green-700', label: 'Hoàn tất', icon: 'fa-check-circle' },
  [OrderStatus.CANCELLED]: { bg: 'bg-red-50', color: 'text-red-700', label: 'Hủy', icon: 'fa-times-circle' },
};

const compressImage = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target?.result as string;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                if (!ctx) { resolve(img.src); return; }
                const MAX_DIM = 800;
                let width = img.width;
                let height = img.height;
                if (width > height) { if (width > MAX_DIM) { height *= MAX_DIM / width; width = MAX_DIM; } } else { if (height > MAX_DIM) { width *= MAX_DIM / height; height = MAX_DIM; } }
                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.7));
            };
            img.onerror = reject;
        };
        reader.onerror = reject;
    });
};

export const OrderCard: React.FC<Props> = ({ 
  order, onUpdate, onDelete, onEdit, 
  isSortMode, index, isCompactMode,
  onTouchStart, onTouchMove, onTouchEnd,
  isNewCustomer, onSplitBatch
}) => {
  const [uploading, setUploading] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [qrUrl, setQrUrl] = useState('');
  const [showImageModal, setShowImageModal] = useState(false);
  const [showCompactPaymentChoice, setShowCompactPaymentChoice] = useState(false);
  const [showActionMenu, setShowActionMenu] = useState(false);
  
  const actionMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
          if (actionMenuRef.current && !actionMenuRef.current.contains(event.target as Node)) {
              setShowActionMenu(false);
          }
      };
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleStatusChange = async (newStatus: OrderStatus) => { 
      await storageService.updateStatus(
          order.id, 
          newStatus, 
          undefined, 
          { name: order.customerName, address: order.address }
      ); 
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploading(true);
      try {
          const compressedBase64 = await compressImage(file);
          await storageService.updateStatus(
              order.id, 
              OrderStatus.DELIVERED, 
              compressedBase64,
              { name: order.customerName, address: order.address }
          );
          toast.success('Đã lưu ảnh & Hoàn tất');
      } catch (error) { toast.error("Lỗi xử lý ảnh"); } finally { setUploading(false); }
    }
  };
  const handleDeletePhoto = async () => { if (window.confirm("Xóa ảnh?")) { await storageService.deleteDeliveryProof(order.id); toast.success("Đã xóa"); } };
  const handleShareProof = async () => {
      if (!order.deliveryProof) {
          toast.error("Chưa có ảnh xác thực");
          return;
      }
      try {
          const base64Response = await fetch(order.deliveryProof);
          const blob = await base64Response.blob();
          const file = new File([blob], `delivery-${order.id}.jpg`, { type: "image/jpeg" });
          const text = `Đã giao đơn #${order.id} - ${order.customerName}`;
          await navigator.clipboard.writeText(text); 
          toast("Đã copy nội dung!", { icon: '📋' });
          if (navigator.share) { await navigator.share({ title: `Giao hàng #${order.id}`, text: text, files: [file] }); } else { toast.success('Trình duyệt không hỗ trợ Share ảnh. Hãy gửi thủ công.'); }
      } catch (e) { console.error(e); toast.error("Lỗi chia sẻ"); }
  };
  const handleFinishOrder = async (method: PaymentMethod) => {
      const updated = { ...order, paymentMethod: method };
      await storageService.updateOrderDetails(updated);
      await storageService.updateStatus(
          order.id, 
          OrderStatus.DELIVERED, 
          undefined,
          { name: order.customerName, address: order.address }
      );
      toast.success(`Xong: ${method === PaymentMethod.CASH ? 'Tiền mặt' : 'Chuyển khoản'}`);
      setShowCompactPaymentChoice(false);
  };
  const togglePaymentVerification = async () => { 
      await storageService.updatePaymentVerification(
          order.id, 
          !order.paymentVerified,
          { name: order.customerName }
      ); 
      if (!order.paymentVerified) toast.success("Đã xác nhận tiền!"); 
  };
  const showVietQR = async (e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (showQR) { setShowQR(false); return; }
      const bankConfig = await storageService.getBankConfig();
      if (!bankConfig || !bankConfig.accountNo) { toast.error("Chưa cài đặt ngân hàng"); return; }
      const desc = `DH ${order.id}`;
      const url = `https://img.vietqr.io/image/${bankConfig.bankId}-${bankConfig.accountNo}-${bankConfig.template}.png?amount=${order.totalPrice}&addInfo=${encodeURIComponent(desc)}&accountName=${encodeURIComponent(bankConfig.accountName)}`;
      setQrUrl(url);
      setShowQR(true);
  };
  const handleShareQR = async () => {
      if (!qrUrl) return;
      try {
          const response = await fetch(qrUrl);
          const blob = await response.blob();
          const file = new File([blob], `qr-${order.id}.png`, { type: "image/png" });
          if (navigator.share) { await navigator.share({ title: 'Mã QR', text: `Thanh toán ${order.totalPrice}đ`, files: [file] }); } else { await navigator.clipboard.writeText(qrUrl); toast.success("Đã copy link QR"); }
      } catch (e) { toast.error("Lỗi chia sẻ QR"); }
  };
  const sendSMS = async () => { const msg = await generateDeliveryMessage(order); const ua = navigator.userAgent.toLowerCase(); const isIOS = ua.indexOf('iphone') > -1 || ua.indexOf('ipad') > -1; const separator = isIOS ? '&' : '?'; window.open(`sms:${order.customerPhone}${separator}body=${encodeURIComponent(msg)}`, '_self'); };
  const nextStatus = (e: React.MouseEvent) => { e.stopPropagation(); if(order.status === OrderStatus.PENDING) handleStatusChange(OrderStatus.PICKED_UP); else if(order.status === OrderStatus.PICKED_UP) handleStatusChange(OrderStatus.IN_TRANSIT); else if(order.status === OrderStatus.IN_TRANSIT) setShowCompactPaymentChoice(true); }
  const handlePrint = () => {
    const printWindow = window.open('', '_blank'); if (!printWindow) return;
    const itemsStr = order.items.map(i => `<tr><td style="padding:5px;border-bottom:1px solid #ddd;">${i.name}</td><td style="padding:5px;border-bottom:1px solid #ddd;text-align:center;">${i.quantity}</td><td style="padding:5px;border-bottom:1px solid #ddd;text-align:right;">${new Intl.NumberFormat('vi-VN').format(i.price)}</td><td style="padding:5px;border-bottom:1px solid #ddd;text-align:right;">${new Intl.NumberFormat('vi-VN').format(i.price * i.quantity)}</td></tr>`).join('');
    printWindow.document.write(`<html><head><title>Phiếu Giao Hàng - ${order.id}</title><style>body{font-family:sans-serif;padding:20px;font-size:13px;max-width:800px;margin:0 auto}.header{text-align:center;margin-bottom:20px;border-bottom:2px solid #000;padding-bottom:10px}.info-group{margin-bottom:15px}.label{font-weight:bold;width:120px;display:inline-block}table{width:100%;border-collapse:collapse;margin-top:20px}th{text-align:left;background:#f0f0f0;padding:8px;border-bottom:2px solid #ddd}.total-row td{font-weight:bold;padding:10px 5px;border-top:2px solid #000;font-size:15px}.footer{margin-top:40px;text-align:center;font-style:italic;font-size:11px;color:#666}</style></head><body><div class="header"><h1 style="margin:0;font-size:20px;">PHIẾU GIAO HÀNG</h1><div style="font-size:11px;margin-top:5px;">Mã đơn: <b>#${order.id}</b> | Ngày: ${new Date(order.createdAt).toLocaleDateString('vi-VN')}</div></div><div class="info-group"><div><span class="label">Người nhận:</span> <b>${order.customerName}</b></div><div><span class="label">Điện thoại:</span> ${order.customerPhone}</div><div><span class="label">Địa chỉ:</span> ${order.address}</div>${order.notes ? `<div><span class="label">Ghi chú:</span> ${order.notes}</div>` : ''}</div><table><thead><tr><th>Sản phẩm</th><th style="width:50px;text-align:center;">SL</th><th style="width:100px;text-align:right;">Đơn giá</th><th style="width:100px;text-align:right;">Thành tiền</th></tr></thead><tbody>${itemsStr}<tr class="total-row"><td colspan="3" style="text-align:right;">TỔNG THANH TOÁN:</td><td style="text-align:right;">${new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(order.totalPrice)}</td></tr></tbody></table><div style="margin-top:20px;border:1px dashed #ccc;padding:10px;"><div><b>Hình thức thanh toán:</b> ${order.paymentMethod === PaymentMethod.CASH ? 'Tiền mặt (COD)' : (order.paymentMethod === PaymentMethod.TRANSFER ? 'Chuyển khoản' : 'Đã thanh toán')}</div>${order.paymentMethod === PaymentMethod.CASH ? '<div><b>Thu hộ (COD):</b> ' + new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(order.totalPrice) + '</div>' : ''}</div><div class="footer">Cảm ơn quý khách đã ủng hộ!</div></body></html>`);
    printWindow.document.close(); printWindow.print();
  };

  const config = statusConfig[order.status];
  const isCompleted = order.status === OrderStatus.DELIVERED || order.status === OrderStatus.CANCELLED;
  const PaymentBadge = () => {
    const showText = isCompleted || order.paymentVerified;
    return (
       <div className="flex items-center gap-1">
            {showText && (order.paymentMethod === PaymentMethod.CASH ? (<span className="text-[9px] font-bold text-gray-500 bg-gray-50 px-1.5 py-0.5 rounded border border-gray-200 whitespace-nowrap">Tiền mặt</span>) : order.paymentMethod === PaymentMethod.PAID ? (<span className="text-[9px] font-bold text-green-700 bg-green-50 px-1.5 py-0.5 rounded border border-green-100 whitespace-nowrap">Đã TT</span>) : (<span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border cursor-pointer whitespace-nowrap ${order.paymentVerified ? 'text-green-700 bg-green-50 border-green-100' : 'text-blue-600 bg-blue-50 border-blue-100'}`} onClick={(e) => { e.stopPropagation(); togglePaymentVerification(); }}>{order.paymentVerified ? 'Đã nhận' : 'Chờ CK'}</span>))}
            <button onClick={showVietQR} className="w-6 h-6 flex-shrink-0 flex items-center justify-center rounded bg-white text-blue-600 hover:bg-blue-50 border border-blue-100 shadow-sm"><i className="fas fa-qrcode text-[10px]"></i></button>
       </div>
    );
  };

  if (isCompactMode) {
      return (
          <>
          <div className="group px-2 py-1.5 hover:bg-gray-50 transition-colors cursor-pointer border-b border-gray-100 last:border-0 relative" onClick={() => onEdit(order)}>
               <div className="hidden md:flex items-center gap-3 text-sm">
                    <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${config.bg.replace('50','500')}`}></div>
                    <div className="w-40 font-bold text-gray-800 truncate">{order.customerName} {isNewCustomer && <span className="text-[9px] bg-red-500 text-white px-1 rounded ml-1">NEW</span>}<div className="text-[10px] text-gray-400 font-normal">{order.customerPhone}</div></div>
                    <div className="flex-grow text-xs text-gray-600 truncate">{order.address} - <span className="italic text-gray-400">{order.items.map(i=>i.name).join(', ')}</span></div>
                    <div className="flex items-center gap-2"><span className="font-bold text-gray-900">{new Intl.NumberFormat('vi-VN').format(order.totalPrice)}</span><PaymentBadge /></div>
                    <div className="flex items-center gap-1 pl-2">{!isCompleted && (<button onClick={nextStatus} className="w-7 h-7 flex items-center justify-center rounded bg-gray-100 hover:bg-black hover:text-white transition-colors"><i className="fas fa-arrow-right text-xs"></i></button>)}<button onClick={(e) => { e.stopPropagation(); sendSMS(); }} className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"><i className="fas fa-comment-dots text-xs"></i></button></div>
               </div>
               <div className="md:hidden flex flex-col gap-0.5 relative">
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-2 overflow-hidden max-w-[65%]">
                            <span className="font-bold text-gray-900 text-sm truncate">{order.customerName}</span>
                            {isNewCustomer && <span className="text-[8px] font-bold bg-red-500 text-white px-1 rounded flex-shrink-0">NEW</span>}
                            <div className="flex bg-gray-100 rounded-md h-5 items-center flex-shrink-0">
                                <a href={`tel:${order.customerPhone}`} onClick={e => e.stopPropagation()} className="w-6 flex items-center justify-center text-gray-600 active:text-eco-600 h-full"><i className="fas fa-phone text-[9px]"></i></a>
                                <div className="w-px h-2.5 bg-gray-300"></div>
                                <button onClick={(e) => { e.stopPropagation(); sendSMS(); }} className="w-6 flex items-center justify-center text-gray-600 active:text-blue-600 h-full"><i className="fas fa-comment-dots text-[9px]"></i></button>
                            </div>
                        </div>
                        <span className="font-black text-gray-900 text-sm">{new Intl.NumberFormat('vi-VN').format(order.totalPrice)}<small className="text-[9px] text-gray-400 font-normal">đ</small></span>
                    </div>
                    <div className="flex justify-between items-center">
                        <div className="text-[10px] text-gray-500 truncate max-w-[70%] flex items-center gap-1"><i className="fas fa-map-marker-alt text-[8px] text-gray-300"></i> {order.address}</div>
                        <span className={`text-[9px] px-1.5 rounded font-bold uppercase whitespace-nowrap ${config.bg} ${config.color}`}>{config.label}</span>
                    </div>
                    <div className="flex justify-between items-center pt-0.5 border-t border-gray-50 mt-0.5">
                        <div className="text-[10px] text-gray-400 italic truncate pr-2 flex-grow">{order.items.map(i => `${i.name} x${i.quantity}`).join(', ')}</div>
                        <div className="flex items-center gap-1.5 flex-shrink-0" onClick={e => e.stopPropagation()}><PaymentBadge />{!isCompleted && (<button onClick={nextStatus} className="w-5 h-5 flex items-center justify-center bg-gray-900 text-white rounded shadow-sm active:scale-95"><i className="fas fa-arrow-right text-[8px]"></i></button>)}</div>
                    </div>
               </div>
          </div>
          {showCompactPaymentChoice && (<div className="fixed inset-0 z-[99999] bg-gray-900/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={(e) => { e.stopPropagation(); setShowCompactPaymentChoice(false); }}><div className="bg-white w-full max-w-xs rounded-xl shadow-2xl p-4" onClick={e => e.stopPropagation()}><h3 className="text-center font-bold text-gray-800 mb-3 text-sm uppercase">Hoàn tất đơn hàng</h3><div className="grid grid-cols-2 gap-3"><button onClick={(e) => { e.stopPropagation(); handleFinishOrder(PaymentMethod.CASH); }} className="p-3 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-lg text-center"><span className="block text-xl">💵</span><span className="text-xs font-bold text-emerald-700">TIỀN MẶT</span></button><button onClick={(e) => { e.stopPropagation(); handleFinishOrder(PaymentMethod.TRANSFER); }} className="p-3 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg text-center"><span className="block text-xl">💳</span><span className="text-xs font-bold text-blue-700">CHUYỂN KHOẢN</span></button></div></div></div>)}
          </>
      );
  }

  return (
    <>
    <div className={`group relative bg-white rounded-lg border shadow-sm transition-all duration-200 flex flex-col ${isSortMode ? 'border-dashed border-2 border-gray-300' : 'border-gray-100 hover:shadow-md'}`}>
      <div className={`flex-grow flex flex-col`}>
          <div className="p-3 flex justify-between items-start gap-3 border-b border-gray-50 relative">
             {isSortMode && (<div className="absolute top-0 right-0 p-2 cursor-grab active:cursor-grabbing touch-none text-gray-300 hover:text-eco-600 z-10" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}><i className="fas fa-grip-vertical text-lg"></i></div>)}
             <div className={`flex-grow min-w-0 ${isSortMode ? 'pr-6' : ''}`}>
                 <div className="flex items-center gap-2 mb-1"><h3 className="font-bold text-gray-900 text-sm truncate leading-snug pb-1">{order.customerName}</h3>{isNewCustomer && <span className="text-[8px] font-bold bg-red-500 text-white px-1.5 py-0.5 rounded-sm">NEW</span>}<span className={`text-[9px] px-1.5 rounded-sm font-bold uppercase ${config.bg} ${config.color}`}>{config.label}</span></div>
                 <div className="text-[11px] text-gray-500 leading-tight truncate">{order.address}</div>
                 <div className="flex items-center gap-3 mt-1"><a href={`tel:${order.customerPhone}`} className="text-[10px] font-bold text-gray-400 hover:text-gray-800 font-mono flex items-center gap-1"><i className="fas fa-phone"></i> {order.customerPhone}</a>{order.lastUpdatedBy && <span className="text-[9px] text-gray-300 flex items-center gap-1"><i className="fas fa-user-edit"></i> {order.lastUpdatedBy}</span>}</div>
             </div>
             <div className="text-right flex-shrink-0 flex flex-col items-end gap-1"><div className="text-sm font-black text-eco-700 leading-none">{new Intl.NumberFormat('vi-VN').format(order.totalPrice)}<span className="text-[9px] text-gray-400 font-normal ml-0.5">đ</span></div><div onClick={e => e.stopPropagation()}><PaymentBadge /></div></div>
          </div>
          <div className="p-2.5 bg-gray-50/30 flex-grow text-xs space-y-1">{order.notes && <div className="text-[10px] text-yellow-700 bg-yellow-50 px-1.5 py-0.5 rounded italic truncate mb-1 border border-yellow-100"><i className="fas fa-sticky-note mr-1"></i>{order.notes}</div>}{order.items.map((item, idx) => (<div key={idx} className="flex justify-between items-center text-[11px] leading-tight"><span className="text-gray-700 truncate max-w-[80%]">{item.name}</span><span className="font-bold text-gray-900">x{item.quantity}</span></div>))}</div>
          <div className="p-2 bg-white border-t border-gray-100 flex justify-between items-center" onClick={(e) => e.stopPropagation()}>
                <div className="flex gap-1.5">
                    {order.status === OrderStatus.PENDING && <button onClick={() => handleStatusChange(OrderStatus.PICKED_UP)} className="px-2.5 py-1 bg-gray-800 text-white text-[10px] font-bold rounded hover:bg-black transition-colors">Nhận</button>}
                    {order.status === OrderStatus.PICKED_UP && <button onClick={() => handleStatusChange(OrderStatus.IN_TRANSIT)} className="px-2.5 py-1 bg-blue-600 text-white text-[10px] font-bold rounded hover:bg-blue-700 transition-colors">Giao</button>}
                    {order.status === OrderStatus.IN_TRANSIT && (<div className="flex gap-1"><button onClick={() => handleFinishOrder(PaymentMethod.CASH)} className="px-2 py-1 bg-emerald-600 text-white text-[10px] font-bold rounded hover:bg-emerald-700">TM</button><button onClick={() => handleFinishOrder(PaymentMethod.TRANSFER)} className="px-2 py-1 bg-blue-600 text-white text-[10px] font-bold rounded hover:bg-blue-700">CK</button><label className="w-6 h-6 flex items-center justify-center border border-gray-200 rounded cursor-pointer hover:bg-gray-50 text-gray-400"><input type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoUpload} disabled={uploading} /><i className={`fas ${uploading ? 'fa-spinner fa-spin' : 'fa-camera'}`}></i></label></div>)}
                    {isCompleted && order.deliveryProof && (<button onClick={() => setShowImageModal(true)} className="text-[10px] font-bold text-green-600 flex items-center gap-1 px-2 py-1 bg-green-50 rounded border border-green-100"><i className="fas fa-image"></i> Ảnh</button>)}
                </div>
                <div className="flex gap-1">
                    <a href={`https://zalo.me/${order.customerPhone}`} target="_blank" className="w-6 h-6 rounded bg-blue-50 text-blue-600 flex items-center justify-center hover:bg-blue-600 hover:text-white transition-colors font-bold text-[9px] border border-blue-100">Z</a>
                    <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.address)}`} target="_blank" className="w-6 h-6 rounded bg-red-50 text-red-600 flex items-center justify-center hover:bg-red-600 hover:text-white transition-colors border border-red-100"><i className="fas fa-map-marker-alt text-[10px]"></i></a>
                    <button onClick={() => sendSMS()} className="w-6 h-6 rounded bg-green-50 text-green-600 flex items-center justify-center hover:bg-green-600 hover:text-white transition-colors border border-green-100"><i className="fas fa-comment-dots text-[10px]"></i></button>
                    <div className="relative" ref={actionMenuRef}>
                        <button onClick={() => setShowActionMenu(!showActionMenu)} className={`w-6 h-6 rounded text-gray-400 hover:text-gray-700 flex items-center justify-center border border-transparent hover:border-gray-200 ${showActionMenu ? 'bg-gray-100 text-gray-700' : ''}`}><i className="fas fa-ellipsis-v text-[10px]"></i></button>
                        {showActionMenu && (
                            <div className="absolute bottom-full right-0 mb-1 bg-white shadow-xl border border-gray-200 rounded-lg p-1 min-w-[130px] z-20 animate-fade-in">
                                <button onClick={() => { onEdit(order); setShowActionMenu(false); }} className="w-full text-left px-3 py-2 hover:bg-gray-50 text-xs text-blue-600 font-bold flex items-center gap-2 rounded"><i className="fas fa-edit"></i> Sửa đơn</button>
                                {onSplitBatch && order.batchId && (<button onClick={() => { onSplitBatch(order); setShowActionMenu(false); }} className="w-full text-left px-3 py-2 hover:bg-gray-50 text-xs text-orange-600 flex items-center gap-2 rounded font-bold"><i className="fas fa-history"></i> Giao sau</button>)}
                                <button onClick={() => { handlePrint(); setShowActionMenu(false); }} className="w-full text-left px-3 py-2 hover:bg-gray-50 text-xs text-gray-600 flex items-center gap-2 rounded"><i className="fas fa-print"></i> In phiếu</button>
                                {order.deliveryProof && <button onClick={() => { handleShareProof(); setShowActionMenu(false); }} className="w-full text-left px-3 py-2 hover:bg-gray-50 text-xs text-purple-600 flex items-center gap-2 rounded"><i className="fas fa-share-alt"></i> Gửi ảnh</button>}
                                <div className="border-t border-gray-100 my-1"></div>
                                {order.deliveryProof && <button onClick={() => { handleDeletePhoto(); setShowActionMenu(false); }} className="w-full text-left px-3 py-2 hover:bg-red-50 text-xs text-red-500 flex items-center gap-2 rounded"><i className="fas fa-image"></i> Xóa ảnh</button>}
                                <button onClick={() => { onDelete(order.id); setShowActionMenu(false); }} className="w-full text-left px-3 py-2 hover:bg-red-50 text-xs text-red-600 flex items-center gap-2 rounded"><i className="fas fa-trash"></i> Xóa đơn</button>
                            </div>
                        )}
                    </div>
                </div>
          </div>
      </div>
      {showImageModal && order.deliveryProof && (<div className="fixed inset-0 z-[99999] bg-black/95 flex items-center justify-center p-4" onClick={() => setShowImageModal(false)}><img src={order.deliveryProof} className="max-w-full max-h-full object-contain rounded" onClick={e=>e.stopPropagation()} /><button onClick={() => setShowImageModal(false)} className="absolute top-4 right-4 text-white text-2xl"><i className="fas fa-times"></i></button></div>)}
      {showQR && (<div className="fixed inset-0 z-[99999] flex items-center justify-center bg-gray-900/80 backdrop-blur-sm p-4" onClick={() => setShowQR(false)}><div className="bg-white p-5 rounded-xl shadow-2xl max-w-xs w-full text-center" onClick={e => e.stopPropagation()}><h3 className="text-base font-bold text-gray-800 mb-3">Thanh toán QR</h3>{qrUrl ? <img src={qrUrl} className="w-full h-auto rounded border mb-3" /> : <div className="h-48 flex items-center justify-center"><i className="fas fa-spinner fa-spin"></i></div>}<div className="text-xl font-black text-gray-900 mb-4">{new Intl.NumberFormat('vi-VN').format(order.totalPrice)}đ</div><div className="flex gap-2"><button onClick={handleShareQR} className="flex-1 py-2 bg-blue-50 text-blue-700 font-bold rounded text-xs">Chia sẻ QR</button><button onClick={() => { togglePaymentVerification(); setShowQR(false); }} className="flex-1 py-2 bg-green-600 text-white font-bold rounded text-xs">Đã nhận tiền</button></div><button onClick={() => setShowQR(false)} className="mt-3 text-gray-400 text-xs hover:text-gray-600">Đóng</button></div></div>)}
    </div>
    </>
  );
};