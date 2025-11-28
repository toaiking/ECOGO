
import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { Order, OrderStatus, PaymentMethod } from '../types';
import { storageService } from '../services/storageService';
import ConfirmModal from './ConfirmModal';

const PaymentAudit: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [bankConfig, setBankConfig] = useState<any>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [isSharing, setIsSharing] = useState(false);

  useEffect(() => {
    // Subscribe to orders
    const unsub = storageService.subscribeOrders((allOrders) => {
      // Filter: Transfer method + Not Verified + Not Cancelled
      const pending = allOrders.filter(o => 
        o.paymentMethod === PaymentMethod.TRANSFER && 
        !o.paymentVerified && 
        o.status !== OrderStatus.CANCELLED
      );
      // Sort by newest
      setOrders(pending.sort((a, b) => b.createdAt - a.createdAt));
    });

    // Load bank config
    storageService.getBankConfig().then(setBankConfig);

    return () => {
      if (unsub) unsub();
    };
  }, []);

  const totalAmount = orders.reduce((sum, o) => sum + o.totalPrice, 0);

  const handleConfirmClick = (id: string) => {
    setSelectedOrderId(id);
    setShowConfirm(true);
  };

  const confirmPayment = async () => {
    if (selectedOrderId) {
      const order = orders.find(o => o.id === selectedOrderId);
      await storageService.updatePaymentVerification(selectedOrderId, true, order ? { name: order.customerName } : undefined);
      setShowConfirm(false);
      setSelectedOrderId(null);
      toast.success("Đã xác nhận nhận tiền!");
    }
  };

  const handleShareQR = async (order: Order) => {
    if (!bankConfig || !bankConfig.accountNo) {
      toast.error("Vui lòng cài đặt thông tin Ngân hàng trong Cài đặt trước");
      return;
    }

    setIsSharing(true);
    const toastId = toast.loading("Đang tạo mã QR...");

    try {
      const desc = `DH ${order.id}`;
      // VietQR QuickLink
      const url = `https://img.vietqr.io/image/${bankConfig.bankId}-${bankConfig.accountNo}-${bankConfig.template || 'compact2'}.png?amount=${order.totalPrice}&addInfo=${encodeURIComponent(desc)}&accountName=${encodeURIComponent(bankConfig.accountName)}`;

      // Fetch image to blob
      const response = await fetch(url);
      const blob = await response.blob();
      const file = new File([blob], `QR-${order.id}.png`, { type: "image/png" });

      if (navigator.share) {
        await navigator.share({
          title: `Thanh toán đơn hàng ${order.id}`,
          text: `Mã QR thanh toán cho đơn hàng ${order.id} trị giá ${new Intl.NumberFormat('vi-VN').format(order.totalPrice)}đ`,
          files: [file]
        });
        toast.dismiss(toastId);
        toast.success("Đã mở chia sẻ!");
      } else {
        // Fallback: Copy URL
        await navigator.clipboard.writeText(url);
        toast.dismiss(toastId);
        toast.success("Đã copy link ảnh QR (Thiết bị không hỗ trợ chia sẻ ảnh trực tiếp)");
      }
    } catch (e) {
      console.error(e);
      toast.dismiss(toastId);
      toast.error("Lỗi chia sẻ QR");
    } finally {
      setIsSharing(false);
    }
  };

  const handleSMS = async (order: Order) => {
     if (!bankConfig || !bankConfig.accountNo) {
      toast.error("Chưa có thông tin ngân hàng");
      return;
    }

    const price = new Intl.NumberFormat('vi-VN').format(order.totalPrice);
    const msg = `Chào ${order.customerName}, đơn hàng ${order.id} của bạn có giá trị ${price}đ. Vui lòng CK tới STK ${bankConfig.accountNo} (${bankConfig.bankId}) - ${bankConfig.accountName}. Nội dung: DH ${order.id}. Cảm ơn!`;
    
    // Detect OS for correct separator
    const ua = navigator.userAgent.toLowerCase();
    const isIOS = ua.indexOf('iphone') > -1 || ua.indexOf('ipad') > -1;
    const separator = isIOS ? '&' : '?';
    
    window.open(`sms:${order.customerPhone}${separator}body=${encodeURIComponent(msg)}`, '_self');
  };

  return (
    <div className="max-w-6xl mx-auto pb-20 animate-fade-in">
      {/* HEADER STATS */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-800 rounded-2xl p-6 text-white shadow-lg mb-6 flex flex-col md:flex-row justify-between items-center gap-4">
        <div>
          <h1 className="text-2xl font-black mb-1"><i className="fas fa-file-invoice-dollar mr-2"></i>Đối soát Chuyển khoản</h1>
          <p className="text-blue-100 text-sm">Danh sách đơn hàng chờ xác nhận thanh toán ngân hàng</p>
        </div>
        <div className="text-right bg-white/10 p-4 rounded-xl border border-white/20 min-w-[200px]">
          <div className="text-xs text-blue-200 uppercase font-bold">Tổng chờ thu</div>
          <div className="text-3xl font-black">{new Intl.NumberFormat('vi-VN').format(totalAmount)}<span className="text-sm font-normal text-blue-200 ml-1">đ</span></div>
          <div className="text-xs font-bold bg-white/20 inline-block px-2 py-0.5 rounded mt-1">{orders.length} đơn hàng</div>
        </div>
      </div>

      {/* LIST */}
      <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden min-h-[400px]">
        {orders.length === 0 ? (
           <div className="flex flex-col items-center justify-center py-20 text-gray-400">
             <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mb-4">
                <i className="fas fa-check text-3xl text-green-500"></i>
             </div>
             <p className="font-bold text-gray-600">Tuyệt vời! Không có đơn nào tồn đọng.</p>
             <p className="text-sm">Tất cả đơn chuyển khoản đã được xác nhận.</p>
           </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 text-gray-500 text-[10px] font-bold uppercase tracking-wider border-b border-gray-100">
                  <th className="p-4">Đơn hàng</th>
                  <th className="p-4">Khách hàng</th>
                  <th className="p-4 text-right">Số tiền</th>
                  <th className="p-4 text-center">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {orders.map(order => (
                  <tr key={order.id} className="hover:bg-blue-50/30 transition-colors group">
                    <td className="p-4">
                      <div className="font-bold text-gray-800 text-sm">#{order.id}</div>
                      <div className="text-xs text-gray-400">{new Date(order.createdAt).toLocaleDateString('vi-VN')}</div>
                      {order.batchId && <div className="mt-1 inline-block text-[9px] bg-gray-100 text-gray-500 px-1.5 rounded border border-gray-200">{order.batchId}</div>}
                    </td>
                    <td className="p-4">
                      <div className="font-bold text-gray-800 text-sm">{order.customerName}</div>
                      <div className="text-xs text-gray-500 font-mono">{order.customerPhone}</div>
                      <div className="text-[10px] text-gray-400 truncate max-w-[200px]">{order.address}</div>
                    </td>
                    <td className="p-4 text-right">
                      <div className="font-black text-blue-600 text-base">{new Intl.NumberFormat('vi-VN').format(order.totalPrice)}đ</div>
                      <div className="text-[10px] text-gray-400">Chuyển khoản</div>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center justify-center gap-2">
                         <button 
                            onClick={() => handleConfirmClick(order.id)}
                            className="bg-green-100 hover:bg-green-200 text-green-700 p-2 rounded-lg transition-colors flex flex-col items-center min-w-[60px]"
                            title="Xác nhận đã nhận tiền"
                         >
                            <i className="fas fa-check-circle text-lg mb-1"></i>
                            <span className="text-[9px] font-bold uppercase">Đã nhận</span>
                         </button>

                         <button 
                            onClick={() => handleShareQR(order)}
                            disabled={isSharing}
                            className="bg-blue-100 hover:bg-blue-200 text-blue-700 p-2 rounded-lg transition-colors flex flex-col items-center min-w-[60px]"
                            title="Chia sẻ mã QR qua Zalo/Messenger"
                         >
                            {isSharing ? <i className="fas fa-spinner fa-spin text-lg mb-1"></i> : <i className="fas fa-qrcode text-lg mb-1"></i>}
                            <span className="text-[9px] font-bold uppercase">Gửi QR</span>
                         </button>

                         <button 
                            onClick={() => handleSMS(order)}
                            className="bg-yellow-100 hover:bg-yellow-200 text-yellow-700 p-2 rounded-lg transition-colors flex flex-col items-center min-w-[60px]"
                            title="Gửi tin nhắn nhắc nhở"
                         >
                            <i className="fas fa-comment-dots text-lg mb-1"></i>
                            <span className="text-[9px] font-bold uppercase">SMS</span>
                         </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmModal 
        isOpen={showConfirm}
        title="Xác nhận thanh toán"
        message="Bạn chắc chắn đã nhận được tiền cho đơn hàng này? Trạng thái sẽ chuyển thành 'Đã thanh toán'."
        onConfirm={confirmPayment}
        onCancel={() => setShowConfirm(false)}
        confirmLabel="Đúng, Đã nhận"
        isDanger={false}
      />
    </div>
  );
};

export default PaymentAudit;
