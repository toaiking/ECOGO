
import React, { useState } from 'react';
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
}

const statusConfig: Record<OrderStatus, { color: string; bg: string; label: string; icon: string }> = {
  [OrderStatus.PENDING]: { bg: 'bg-yellow-100', color: 'text-yellow-700', label: 'Chờ xử lý', icon: 'fa-clock' },
  [OrderStatus.PICKED_UP]: { bg: 'bg-blue-100', color: 'text-blue-700', label: 'Đã lấy', icon: 'fa-box-open' },
  [OrderStatus.IN_TRANSIT]: { bg: 'bg-purple-100', color: 'text-purple-700', label: 'Đang giao', icon: 'fa-shipping-fast' },
  [OrderStatus.DELIVERED]: { bg: 'bg-green-100', color: 'text-green-700', label: 'Hoàn tất', icon: 'fa-check-circle' },
  [OrderStatus.CANCELLED]: { bg: 'bg-red-100', color: 'text-red-700', label: 'Hủy', icon: 'fa-times-circle' },
};

// Image Compression Helper
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

                // Resize logic: Max 800px width/height
                const MAX_DIM = 800;
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > MAX_DIM) {
                        height *= MAX_DIM / width;
                        width = MAX_DIM;
                    }
                } else {
                    if (height > MAX_DIM) {
                        width *= MAX_DIM / height;
                        height = MAX_DIM;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);
                // Compress to JPEG 70% quality
                resolve(canvas.toDataURL('image/jpeg', 0.7));
            };
            img.onerror = reject;
        };
        reader.onerror = reject;
    });
};

export const OrderCard: React.FC<Props> = ({ 
  order, onUpdate, onDelete, onEdit, 
  isSortMode, index, isCompactMode
}) => {
  const [uploading, setUploading] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [qrUrl, setQrUrl] = useState('');
  const [showImageModal, setShowImageModal] = useState(false);
  
  const handleStatusChange = async (newStatus: OrderStatus) => {
    await storageService.updateStatus(order.id, newStatus);
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setUploading(true);
      try {
          const compressedBase64 = await compressImage(file);
          await storageService.updateStatus(order.id, OrderStatus.DELIVERED, compressedBase64);
          toast.success('Đã lưu ảnh & Hoàn tất đơn');
      } catch (error) {
          toast.error("Lỗi xử lý ảnh");
          console.error(error);
      } finally {
          setUploading(false);
      }
    }
  };

  const handleDeletePhoto = async () => {
      if (window.confirm("Xóa ảnh xác thực này?")) {
          await storageService.deleteDeliveryProof(order.id);
          toast.success("Đã xóa ảnh");
      }
  };

  const handleFinishOrder = async (method: PaymentMethod) => {
      const updated = { ...order, paymentMethod: method };
      await storageService.updateOrderDetails(updated);
      await storageService.updateStatus(order.id, OrderStatus.DELIVERED);
      toast.success(`Đã hoàn tất (${method === PaymentMethod.CASH ? 'Tiền mặt' : 'Chuyển khoản'})`);
  };

  const togglePaymentVerification = async () => {
      await storageService.updatePaymentVerification(order.id, !order.paymentVerified);
      if (!order.paymentVerified) {
          toast.success("Đã xác nhận nhận tiền!");
      }
  };

  const showVietQR = async (e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (showQR) {
          setShowQR(false);
          return;
      }
      const bankConfig = await storageService.getBankConfig();
      if (!bankConfig || !bankConfig.accountNo) {
          toast.error("Chưa cài đặt ngân hàng. Vào Menu > Cài đặt.");
          return;
      }

      const desc = `TT Don ${order.id}`;
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

          if (navigator.share) {
              await navigator.share({
                  title: 'Mã QR Thanh toán',
                  text: `Thanh toán đơn hàng #${order.id}. Số tiền: ${new Intl.NumberFormat('vi-VN').format(order.totalPrice)}đ`,
                  files: [file]
              });
          } else {
              await navigator.clipboard.writeText(qrUrl);
              toast.success("Đã copy link ảnh QR");
          }
      } catch (e) {
          console.error(e);
          toast.error("Không thể chia sẻ ảnh QR");
      }
  };

  const sendSMS = async () => {
    const msg = await generateDeliveryMessage(order);
    const ua = navigator.userAgent.toLowerCase();
    const isIOS = ua.indexOf('iphone') > -1 || ua.indexOf('ipad') > -1;
    const separator = isIOS ? '&' : '?';
    window.open(`sms:${order.customerPhone}${separator}body=${encodeURIComponent(msg)}`, '_self');
  };

  const handlePrint = (e: React.MouseEvent) => {
      e.stopPropagation();
      const printWindow = window.open('', '_blank');
      if (printWindow) {
          const itemsHtml = order.items.map(item => `
             <tr>
                <td style="padding: 8px; border-bottom: 1px solid #ddd;">${item.name}</td>
                <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: center;">${item.quantity}</td>
                <td style="padding: 8px; border-bottom: 1px solid #ddd; text-align: right;">${new Intl.NumberFormat('vi-VN').format(item.price * item.quantity)}</td>
             </tr>
          `).join('');

          const dateStr = new Date(order.createdAt).toLocaleDateString('vi-VN');

          printWindow.document.write(`
              <html>
                <head>
                  <title>Phiếu Giao Hàng - ${order.id}</title>
                  <style>
                    body { font-family: sans-serif; padding: 20px; max-width: 600px; margin: 0 auto; }
                    h1 { text-align: center; border-bottom: 2px solid #000; padding-bottom: 10px; }
                    .info { margin-bottom: 20px; }
                    .info p { margin: 5px 0; }
                    table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
                    th { text-align: left; border-bottom: 2px solid #000; padding: 8px; }
                    .total { text-align: right; font-size: 1.2em; font-weight: bold; margin-top: 20px; }
                    .footer { margin-top: 40px; text-align: center; font-size: 0.8em; font-style: italic; }
                  </style>
                </head>
                <body>
                  <h1>PHIẾU GIAO HÀNG</h1>
                  <div class="info">
                      <p><strong>Mã đơn:</strong> #${order.id}</p>
                      <p><strong>Khách hàng:</strong> ${order.customerName}</p>
                      <p><strong>SĐT:</strong> ${order.customerPhone}</p>
                      <p><strong>Địa chỉ:</strong> ${order.address}</p>
                      <p><strong>Ngày:</strong> ${dateStr}</p>
                  </div>
                  <table>
                    <thead>
                        <tr>
                            <th>Tên hàng</th>
                            <th style="text-align: center;">SL</th>
                            <th style="text-align: right;">Thành tiền</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${itemsHtml}
                    </tbody>
                  </table>
                  <div class="total">
                      Tổng thu: ${new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(order.totalPrice)}
                      <br>
                      <span style="font-size: 0.7em; font-weight: normal;">(${order.paymentMethod === PaymentMethod.CASH ? 'Tiền mặt' : 'Chuyển khoản/Đã TT'})</span>
                  </div>
                  <div class="footer">
                      Cảm ơn quý khách đã mua hàng!<br>
                      EcoGo Logistics
                  </div>
                </body>
              </html>
          `);
          printWindow.document.close();
          printWindow.print();
      }
  };

  const nextStatus = (e: React.MouseEvent) => {
      e.stopPropagation();
      if(order.status === OrderStatus.PENDING) handleStatusChange(OrderStatus.PICKED_UP);
      else if(order.status === OrderStatus.PICKED_UP) handleStatusChange(OrderStatus.IN_TRANSIT);
  }

  const config = statusConfig[order.status];
  const isCompleted = order.status === OrderStatus.DELIVERED || order.status === OrderStatus.CANCELLED;
  
  const PaymentBadge = () => {
    return (
       <div className="flex items-center gap-1">
            {order.paymentMethod === PaymentMethod.CASH ? (
                <span className="text-[10px] font-bold text-gray-500 bg-gray-100 px-2 py-1 rounded border border-gray-200 whitespace-nowrap">Tiền mặt</span>
            ) : order.paymentMethod === PaymentMethod.PAID ? (
                <span className="text-[10px] font-bold text-green-700 bg-green-100 px-2 py-1 rounded border border-green-200 whitespace-nowrap">Đã thanh toán</span>
            ) : (
                <span 
                    className={`text-[10px] font-bold px-2 py-1 rounded border cursor-pointer whitespace-nowrap ${order.paymentVerified ? 'text-green-700 bg-green-100 border-green-200' : 'text-blue-600 bg-blue-50 border-blue-200'}`}
                    onClick={(e) => { e.stopPropagation(); togglePaymentVerification(); }}
                    title={order.paymentVerified ? "Đã nhận tiền" : "Chờ xác nhận"}
                >
                {order.paymentVerified ? 'Đã nhận tiền' : 'Chờ CK'}
                </span>
            )}
            
            <button 
                onClick={showVietQR}
                className="w-6 h-6 flex-shrink-0 flex items-center justify-center rounded bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white transition-colors border border-blue-100 shadow-sm"
                title="Mã QR"
            >
                <i className="fas fa-qrcode text-[10px]"></i>
            </button>
       </div>
    );
  };

  // --- COMPACT MODE (3-Line Layout) ---
  if (isCompactMode) {
      return (
          <div className="group px-4 py-3 hover:bg-gray-50 transition-colors cursor-pointer border-b border-gray-100 last:border-0" onClick={() => onEdit(order)}>
               {/* Desktop: Single Row */}
               <div className="hidden md:flex items-center gap-4 text-sm">
                    <div 
                        className={`w-3 h-3 rounded-full flex-shrink-0 cursor-pointer ${config.bg.replace('100','500')}`} 
                        title={`${config.label} ${order.lastUpdatedBy ? `- bởi ${order.lastUpdatedBy}` : ''}`}
                    ></div>
                    
                    <div className="w-48 flex flex-col justify-center" title={order.customerName}>
                        <div className="font-bold text-gray-800 truncate">{order.customerName}</div>
                        <a href={`tel:${order.customerPhone}`} onClick={e => e.stopPropagation()} className="text-xs text-eco-600 hover:text-eco-800 font-mono hover:underline">{order.customerPhone}</a>
                    </div>
                    
                    <div className="flex-grow flex flex-col justify-center text-xs overflow-hidden">
                        <span className="text-gray-800 truncate font-medium">{order.address}</span>
                        <span className="text-gray-500 italic truncate">
                            {order.items.map((i, idx) => (
                                <span key={idx}>
                                    {i.name} <b className="text-gray-900">x{i.quantity}</b>{idx < order.items.length - 1 ? ', ' : ''}
                                </span>
                            ))}
                        </span>
                    </div>

                    <div className="w-36 text-right flex flex-col items-end">
                         <span className="font-bold text-gray-900 text-base">{new Intl.NumberFormat('vi-VN').format(order.totalPrice)}</span>
                         <div className="mt-1"><PaymentBadge /></div>
                    </div>

                    <div className="flex items-center gap-2 w-auto justify-end pl-4 border-l border-gray-100">
                         <button onClick={(e) => { e.stopPropagation(); sendSMS(); }} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="SMS">
                            <i className="fas fa-comment-dots"></i>
                         </button>
                         {!isCompleted && (
                             <button 
                                onClick={nextStatus}
                                className="w-8 h-8 flex items-center justify-center rounded-lg bg-gray-100 text-gray-600 hover:bg-black hover:text-white transition-colors"
                                title="Chuyển trạng thái"
                             >
                                <i className="fas fa-arrow-right"></i>
                             </button>
                         )}
                         <button onClick={handlePrint} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-200 rounded-lg transition-colors" title="In phiếu">
                            <i className="fas fa-print"></i>
                         </button>
                    </div>
               </div>

               {/* Mobile: 3-Line Layout */}
               <div className="md:hidden flex flex-col gap-2 relative">
                    {/* Row 1: Name + Tools + Price */}
                    <div className="flex justify-between items-start">
                        <div className="flex items-center gap-2 overflow-hidden">
                            <span className="font-black text-gray-900 text-sm truncate max-w-[140px]">{order.customerName}</span>
                            {/* Grouped Call & SMS */}
                            <div className="flex bg-gray-100 rounded-lg p-0.5 items-center h-7 shrink-0 border border-gray-200">
                                <a href={`tel:${order.customerPhone}`} onClick={e => e.stopPropagation()} className="w-8 flex items-center justify-center text-eco-700 active:bg-white rounded-md transition-all h-full">
                                    <i className="fas fa-phone text-xs"></i>
                                </a>
                                <div className="w-px h-3 bg-gray-300"></div>
                                <button onClick={(e) => { e.stopPropagation(); sendSMS(); }} className="w-8 flex items-center justify-center text-blue-600 active:bg-white rounded-md transition-all h-full">
                                    <i className="fas fa-comment-dots text-xs"></i>
                                </button>
                            </div>
                        </div>
                        <div className="text-right">
                            <span className="font-black text-gray-900 text-base block leading-none">
                                {new Intl.NumberFormat('vi-VN').format(order.totalPrice)}<small className="text-[10px] text-gray-500">đ</small>
                            </span>
                        </div>
                    </div>

                    {/* Row 2: Address */}
                    <div className="text-xs text-gray-500 truncate flex items-center gap-1.5">
                        <i className="fas fa-map-marker-alt text-gray-400 text-[10px]"></i>
                        {order.address}
                    </div>

                    {/* Row 3: Items + Payment/Action */}
                    <div className="flex justify-between items-end pt-1">
                        <div className="flex-grow text-xs text-gray-600 italic truncate pr-2 leading-relaxed">
                           {order.items.map(i => `${i.name} (x${i.quantity})`).join(', ')}
                        </div>
                        
                        {/* Integrated Payment Badge with QR (Small) */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                            <div onClick={e => e.stopPropagation()} className="flex items-center">
                                <PaymentBadge />
                            </div>

                            {!isCompleted && (
                                <button 
                                    onClick={nextStatus}
                                    className="w-8 h-8 flex items-center justify-center bg-gray-900 text-white rounded-lg shadow-md active:scale-95 ml-1"
                                >
                                    <i className="fas fa-arrow-right text-xs"></i>
                                </button>
                            )}
                        </div>
                    </div>
               </div>
          </div>
      );
  }

  // --- FULL CARD MODE ---
  return (
    <>
    <div 
      className={`
        group relative bg-white rounded-2xl border shadow-sm transition-all duration-300 overflow-hidden flex flex-col
        ${isSortMode ? 'border-dashed border-2 border-gray-300 hover:border-eco-400' : 'border-gray-100 hover:shadow-lg'}
    `}>
      
      {isSortMode && (
          <div className="absolute left-0 top-0 bottom-0 w-8 bg-gray-50 flex items-center justify-center border-r border-gray-100 z-10 cursor-grab active:cursor-grabbing">
              <span className="text-sm font-bold text-gray-400 transform -rotate-90">#{index !== undefined ? index + 1 : ''}</span>
          </div>
      )}

      <div className={`flex-grow flex flex-col ${isSortMode ? 'pl-8' : ''}`}>
          
          {/* HEADER: Split Left (Customer) / Right (Finance) */}
          <div className="p-4 pb-3 flex justify-between items-start gap-4">
             {/* Left: Customer Info */}
             <div className="flex-grow min-w-0">
                 <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-black text-gray-900 text-lg truncate" title={order.customerName}>
                        {order.customerName}
                    </h3>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider whitespace-nowrap ${config.bg} ${config.color}`}>
                        {config.label}
                    </span>
                 </div>
                 
                 <a href={`tel:${order.customerPhone}`} onClick={e => e.stopPropagation()} className="inline-flex items-center text-sm font-bold text-gray-600 hover:text-eco-700 transition-colors mb-2">
                    <i className="fas fa-phone-alt text-xs mr-1.5 opacity-60"></i>
                    {order.customerPhone}
                 </a>
             </div>

             {/* Right: Price & Payment Status */}
             <div className="text-right flex flex-col items-end flex-shrink-0">
                 <div className="text-xl font-black text-eco-700 leading-none mb-1.5">
                    {new Intl.NumberFormat('vi-VN').format(order.totalPrice)}
                    <span className="text-xs text-eco-500 ml-0.5 align-top">đ</span>
                 </div>
                 <div onClick={e => e.stopPropagation()}>
                    <PaymentBadge />
                 </div>
             </div>
          </div>

          {/* SUB-HEADER: Address & Tools */}
          <div className="px-4 flex justify-between items-center gap-3 mb-3">
              <div className="text-xs text-gray-500 truncate flex items-center gap-1.5 flex-grow">
                  <i className="fas fa-map-marker-alt text-gray-300"></i>
                  <span className="truncate">{order.address}</span>
              </div>

              <div className="flex gap-1.5 flex-shrink-0">
                    <a 
                        href={`https://zalo.me/${order.customerPhone}`} 
                        target="_blank" 
                        rel="noreferrer"
                        onClick={e => e.stopPropagation()} 
                        className="w-7 h-7 flex items-center justify-center rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-600 hover:text-white transition-colors"
                        title="Chat Zalo"
                    >
                        <span className="font-black text-[10px]">Z</span>
                    </a>
                    <a 
                        href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.address)}`} 
                        target="_blank" 
                        rel="noreferrer"
                        onClick={e => e.stopPropagation()} 
                        className="w-7 h-7 flex items-center justify-center rounded-lg bg-red-50 text-red-600 hover:bg-red-600 hover:text-white transition-colors"
                        title="Google Maps"
                    >
                        <i className="fas fa-map-marker-alt text-[10px]"></i>
                    </a>
                    <button onClick={(e) => { e.stopPropagation(); sendSMS(); }} className="w-7 h-7 flex items-center justify-center rounded-lg bg-green-50 text-green-600 hover:bg-green-600 hover:text-white transition-colors" title="SMS">
                        <i className="fas fa-comment-dots text-[10px]"></i>
                    </button>
              </div>
          </div>

          {/* BODY: Items List */}
          <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 border-b flex-grow">
            {order.notes && (
                <div className="mb-3 px-3 py-2 bg-yellow-50 border border-yellow-100 rounded-lg text-xs text-yellow-800 italic flex gap-2 items-start">
                    <i className="fas fa-sticky-note text-yellow-400 mt-0.5"></i>
                    <span>{order.notes}</span>
                </div>
            )}

            <div className="space-y-2">
               {order.items.map((item, idx) => (
                 <div key={idx} className="flex justify-between items-center text-sm group/item">
                    <div className="flex items-center gap-2 overflow-hidden">
                        <span className="w-1.5 h-1.5 rounded-full bg-gray-300"></span>
                        <span className="text-gray-700 font-medium truncate">{item.name}</span>
                    </div>
                    <div className="flex items-center gap-3">
                        <span className="text-xs font-bold bg-white border border-gray-200 text-gray-600 px-1.5 py-0.5 rounded">x{item.quantity}</span>
                    </div>
                 </div>
               ))}
            </div>
            
            {/* Meta Info Footer */}
            <div className="flex justify-between items-center mt-3 pt-2 border-t border-gray-200/50">
                <div className="flex items-center gap-2">
                    {order.batchId && (
                        <span className="text-[9px] text-gray-400 bg-white border border-gray-200 px-1.5 py-0.5 rounded uppercase tracking-wider">{order.batchId}</span>
                    )}
                </div>
                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={(e) => { e.stopPropagation(); onEdit(order); }} className="text-gray-400 hover:text-blue-600 text-[10px] uppercase font-bold flex items-center gap-1"><i className="fas fa-pen"></i> Sửa</button>
                    <button onClick={handlePrint} className="text-gray-400 hover:text-gray-800 text-[10px] uppercase font-bold flex items-center gap-1"><i className="fas fa-print"></i> In</button>
                    <button onClick={(e) => { e.stopPropagation(); onDelete(order.id); }} className="text-gray-400 hover:text-red-600 text-[10px] uppercase font-bold flex items-center gap-1"><i className="fas fa-trash"></i> Xóa</button>
                </div>
            </div>
          </div>

          {/* FOOTER: Main Actions */}
          <div className="p-3 bg-white relative z-10" onClick={(e) => e.stopPropagation()}>
            {/* State 1: Pending -> Picked Up */}
            {order.status === OrderStatus.PENDING && (
                <button onClick={() => handleStatusChange(OrderStatus.PICKED_UP)} className="w-full py-3 rounded-xl bg-gray-900 text-white text-sm font-bold hover:bg-gray-800 transition-all shadow-md">
                    Nhận Đơn
                </button>
            )}
            
            {/* State 2: Picked Up -> In Transit */}
            {order.status === OrderStatus.PICKED_UP && (
                <button onClick={() => handleStatusChange(OrderStatus.IN_TRANSIT)} className="w-full py-3 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 transition-all shadow-md shadow-blue-100">
                    <i className="fas fa-motorcycle mr-2"></i> Đi Giao Hàng
                </button>
            )}
            
            {/* State 3: In Transit -> Completed (Split Choice) */}
            {order.status === OrderStatus.IN_TRANSIT && (
                <div className="flex gap-2">
                    <button 
                        onClick={() => handleFinishOrder(PaymentMethod.CASH)} 
                        className="flex-1 py-3 rounded-xl bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 transition-all shadow-md shadow-emerald-100 flex flex-col items-center justify-center gap-0.5 leading-tight"
                    >
                        <span>Thu tiền mặt</span>
                        <span className="text-[9px] opacity-80 font-normal">Hoàn tất</span>
                    </button>
                    
                    <button 
                        onClick={() => handleFinishOrder(PaymentMethod.TRANSFER)} 
                        className="flex-1 py-3 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 transition-all shadow-md shadow-blue-100 flex flex-col items-center justify-center gap-0.5 leading-tight"
                    >
                        <span>Chuyển khoản</span>
                        <span className="text-[9px] opacity-80 font-normal">Hoàn tất</span>
                    </button>
                    
                    <label className={`w-12 flex items-center justify-center rounded-xl border-2 border-dashed border-gray-300 cursor-pointer transition-colors ${uploading ? 'bg-gray-100' : 'bg-white hover:border-eco-500 hover:text-eco-500 text-gray-400'}`}>
                        <input type="file" accept="image/*" capture="environment" className="hidden" onChange={handlePhotoUpload} disabled={uploading} />
                        {uploading ? <i className="fas fa-spinner fa-spin"></i> : <i className="fas fa-camera"></i>}
                    </label>
                </div>
            )}
            
            {/* State 4: Completed */}
            {isCompleted && (
                <div className="flex items-center justify-center pt-1 gap-2">
                    {order.deliveryProof ? (
                        <div className="flex items-center gap-2 bg-green-50 px-3 py-1.5 rounded-lg border border-green-100">
                            <button 
                                onClick={(e) => { e.stopPropagation(); setShowImageModal(true); }}
                                className="flex items-center gap-2 text-xs font-bold text-green-700 hover:underline"
                            >
                                <i className="fas fa-check-circle"></i> Xem ảnh xác thực
                            </button>
                            <div className="w-px h-3 bg-green-200 mx-1"></div>
                            <button onClick={handleDeletePhoto} className="text-gray-400 hover:text-red-600 transition-colors" title="Xóa ảnh">
                                <i className="fas fa-trash-alt text-[10px]"></i>
                            </button>
                        </div>
                    ) : (
                        <span className="text-xs font-medium text-gray-400 flex items-center gap-1">
                            {order.status === OrderStatus.DELIVERED ? <><i className="fas fa-check text-green-500"></i> Đã giao thành công</> : <><i className="fas fa-times text-red-500"></i> Đã hủy đơn</>}
                        </span>
                    )}
                </div>
            )}
          </div>
      </div>
      
      {/* LIGHTBOX MODAL */}
      {showImageModal && order.deliveryProof && (
          <div className="fixed inset-0 z-[99999] bg-black/95 flex items-center justify-center p-4 animate-fade-in" onClick={() => setShowImageModal(false)}>
              <div className="relative w-full h-full flex items-center justify-center">
                  <img 
                    src={order.deliveryProof} 
                    alt="Proof" 
                    className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" 
                    onClick={e => e.stopPropagation()}
                  />
                  <button 
                    onClick={() => setShowImageModal(false)}
                    className="absolute top-4 right-4 bg-white/10 hover:bg-white/20 text-white rounded-full w-10 h-10 flex items-center justify-center transition-colors"
                  >
                      <i className="fas fa-times text-xl"></i>
                  </button>
              </div>
          </div>
      )}

      {/* QR MODAL */}
      {showQR && (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-gray-900/80 backdrop-blur-sm p-4 animate-fade-in" onClick={() => setShowQR(false)}>
            <div className="bg-white p-6 rounded-2xl shadow-2xl max-w-sm w-full text-center" onClick={e => e.stopPropagation()}>
                <h3 className="text-lg font-bold text-gray-900 mb-1">Thanh toán Chuyển khoản</h3>
                <p className="text-sm text-gray-500 mb-4">Quét mã để thanh toán đơn hàng #{order.id}</p>
                
                <div className="bg-white p-2 rounded-lg border border-gray-100 shadow-inner mb-4 inline-block">
                    {qrUrl ? (
                        <img src={qrUrl} alt="VietQR" className="w-64 h-64 object-contain" />
                    ) : (
                        <div className="w-64 h-64 flex items-center justify-center text-gray-400 bg-gray-50">
                            <i className="fas fa-spinner fa-spin mr-2"></i> Đang tạo mã...
                        </div>
                    )}
                </div>
                
                <div className="text-2xl font-black text-gray-900 mb-2">
                    {new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(order.totalPrice)}
                </div>
                
                <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded-lg mb-6 border border-amber-100 text-left">
                    <i className="fas fa-info-circle mr-1"></i>
                    Khách hàng quét mã sẽ tự động điền số tiền và nội dung.
                </p>

                <div className="flex gap-3">
                    <button 
                        onClick={handleShareQR}
                        className="w-12 flex items-center justify-center bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-xl transition-colors"
                        title="Chia sẻ ảnh QR"
                    >
                        <i className="fas fa-share-alt"></i>
                    </button>

                    <button 
                        onClick={() => { togglePaymentVerification(); setShowQR(false); }}
                        className="flex-1 py-3 bg-green-600 hover:bg-green-700 text-white font-bold rounded-xl transition-colors shadow-lg shadow-green-100"
                    >
                        <i className="fas fa-check mr-2"></i>Đã nhận tiền
                    </button>
                    <button onClick={() => setShowQR(false)} className="px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold rounded-xl transition-colors">
                        Đóng
                    </button>
                </div>
            </div>
        </div>
      )}
    </div>
    </>
  );
};
