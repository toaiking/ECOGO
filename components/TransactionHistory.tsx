import React, { useState, useEffect, useMemo } from 'react';
import { Search, FileText, Upload, CheckCircle, AlertCircle, Printer, Filter, Trash2 } from 'lucide-react';
import { Order, BankTransaction, OrderStatus, PaymentMethod } from '../types';
import { storageService } from '../services/storageService';
import { reconciliationService } from '../services/reconciliationService';
import { pdfService } from '../services/pdfService';
import toast from 'react-hot-toast';

const TransactionHistory: React.FC = () => {
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [pendingOrders, setPendingOrders] = useState<Order[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [filterStatus, setFilterStatus] = useState<'ALL' | 'MATCHED' | 'UNMATCHED'>('ALL');
  const [reviewTransactions, setReviewTransactions] = useState<BankTransaction[] | null>(null);

  useEffect(() => {
    loadData();
    const unsub = storageService.subscribeBankTransactions((txs) => {
      setTransactions(txs);
    });
    return () => unsub();
  }, []);

  const loadData = async () => {
    const orders = await storageService.getOrders();
    const pending = orders.filter((o: Order) => !o.paymentVerified && o.status !== OrderStatus.CANCELLED && o.paymentMethod === PaymentMethod.TRANSFER);
    setPendingOrders(pending);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    try {
      const text = await reconciliationService.extractTextFromPDF(file);
      
      setIsAiProcessing(true);
      const aiResult = await reconciliationService.parseWithAI(text);
      const withMatches = reconciliationService.suggestMatches(aiResult.transactions, pendingOrders);
      setReviewTransactions(withMatches);
      
      toast.success('Đã phân tích xong bằng AI');
    } catch (error) {
      toast.error('Lỗi khi phân tích bằng AI. Đang thử phương pháp thủ công...');
      try {
        const text = await reconciliationService.extractTextFromPDF(file);
        const parsed = reconciliationService.parseBankStatement(text);
        const withMatches = reconciliationService.suggestMatches(parsed, pendingOrders);
        setReviewTransactions(withMatches);
      } catch (manualError) {
        toast.error('Không thể đọc file PDF');
      }
    } finally {
      setIsProcessing(false);
      setIsAiProcessing(false);
      if (e.target) e.target.value = '';
    }
  };

  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        toast.error('Bộ nhớ tạm trống');
        return;
      }

      setIsProcessing(true);
      setIsAiProcessing(true);
      
      try {
        const aiResult = await reconciliationService.parseWithAI(text);
        const withMatches = reconciliationService.suggestMatches(aiResult.transactions, pendingOrders);
        setReviewTransactions(withMatches);
        toast.success('Đã phân tích xong bằng AI');
      } catch (aiError) {
        const parsed = reconciliationService.parseBankStatement(text);
        const withMatches = reconciliationService.suggestMatches(parsed, pendingOrders);
        setReviewTransactions(withMatches);
      }
    } catch (error) {
      toast.error('Không thể đọc bộ nhớ tạm');
    } finally {
      setIsProcessing(false);
      setIsAiProcessing(false);
    }
  };

  const confirmImport = () => {
    if (!reviewTransactions) return;
    storageService.saveBankTransactions([...reviewTransactions, ...transactions]);
    toast.success(`Đã nhập ${reviewTransactions.length} giao dịch`);
    setReviewTransactions(null);
  };

  const updateReviewTx = (id: string, field: keyof BankTransaction, value: any) => {
    if (!reviewTransactions) return;
    setReviewTransactions(prev => 
      prev ? prev.map(tx => tx.id === id ? { ...tx, [field]: value } : tx) : null
    );
  };

  const removeReviewTx = (id: string) => {
    if (!reviewTransactions) return;
    setReviewTransactions(prev => prev ? prev.filter(tx => tx.id !== id) : null);
  };

  const confirmMatch = async (txId: string, orderId: string) => {
    try {
      await storageService.updatePaymentVerificationBatch([orderId], true);
      const updatedTxs = transactions.map(tx => 
        tx.id === txId ? { ...tx, isVerified: true } : tx
      );
      storageService.saveBankTransactions(updatedTxs);
      // Refresh pending orders
      await loadData();
      toast.success('Đã xác nhận thanh toán');
    } catch (error) {
      toast.error('Lỗi khi xác nhận');
    }
  };

  const filteredTransactions = useMemo(() => {
    return transactions.filter(tx => {
      const searchLower = searchTerm.toLowerCase();
      const matchesSearch = 
        tx.description.toLowerCase().includes(searchLower) ||
        tx.amount.toString().includes(searchTerm) ||
        (tx.remitter && tx.remitter.toLowerCase().includes(searchLower)) ||
        (tx.bankName && tx.bankName.toLowerCase().includes(searchLower));
      
      const matchesFilter = 
        filterStatus === 'ALL' ||
        (filterStatus === 'MATCHED' && tx.suggestedOrderId) ||
        (filterStatus === 'UNMATCHED' && !tx.suggestedOrderId);

      return matchesSearch && matchesFilter;
    });
  }, [transactions, searchTerm, filterStatus]);

  const handlePrint = async () => {
    if (filteredTransactions.length === 0) {
      toast.error('Không có dữ liệu để in');
      return;
    }
    toast.loading('Đang tạo PDF...');
    await pdfService.generateTransactionReport(filteredTransactions);
    toast.dismiss();
  };

  const clearAll = () => {
    if (window.confirm('Bạn có chắc muốn xóa danh sách hiện tại?')) {
      setTransactions([]);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Lịch sử Giao dịch & Đối soát</h1>
          <p className="text-slate-500">Tải sao kê hoặc dán nội dung để đối soát nhanh với đơn hàng</p>
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-sm"
          >
            <Printer size={18} />
            <span>In PDF</span>
          </button>
          <button
            onClick={clearAll}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-red-100 text-red-600 rounded-lg hover:bg-red-50 transition-colors shadow-sm"
          >
            <Trash2 size={18} />
            <span>Xóa hết</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={20} />
          <input
            type="text"
            placeholder="Tìm kiếm theo nội dung hoặc số tiền..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-3 bg-white border border-slate-200 rounded-xl focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 outline-none transition-all shadow-sm"
          />
        </div>
        <div className="flex gap-2">
          <label className="flex-1 cursor-pointer">
            <input type="file" accept=".pdf" onChange={handleFileUpload} className="hidden" />
            <div className="flex items-center justify-center gap-2 h-full px-4 py-3 bg-emerald-600 text-white rounded-xl hover:bg-emerald-700 transition-colors shadow-sm">
              <Upload size={20} />
              <span className="font-medium">Tải PDF</span>
            </div>
          </label>
          <button
            onClick={handlePaste}
            className="flex items-center justify-center gap-2 px-4 py-3 bg-slate-800 text-white rounded-xl hover:bg-slate-900 transition-colors shadow-sm"
          >
            <FileText size={20} />
            <span className="font-medium">Dán văn bản</span>
          </button>
        </div>
      </div>

      <div className="flex items-center gap-4 overflow-x-auto pb-2">
        <button
          onClick={() => setFilterStatus('ALL')}
          className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
            filterStatus === 'ALL' ? 'bg-emerald-100 text-emerald-700' : 'bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          Tất cả ({transactions.length})
        </button>
        <button
          onClick={() => setFilterStatus('MATCHED')}
          className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
            filterStatus === 'MATCHED' ? 'bg-blue-100 text-blue-700' : 'bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          Có gợi ý ({transactions.filter(t => t.suggestedOrderId).length})
        </button>
        <button
          onClick={() => setFilterStatus('UNMATCHED')}
          className={`px-4 py-2 rounded-full text-sm font-medium transition-all whitespace-nowrap ${
            filterStatus === 'UNMATCHED' ? 'bg-amber-100 text-amber-700' : 'bg-white text-slate-600 hover:bg-slate-50'
          }`}
        >
          Chưa khớp ({transactions.filter(t => !t.suggestedOrderId).length})
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-bottom border-slate-200">
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Ngày</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Số tiền</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Người gửi / Ngân hàng</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Nội dung</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider">Gợi ý khớp</th>
                <th className="px-6 py-4 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isProcessing ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
                      <p>{isAiProcessing ? 'AI đang phân tích dữ liệu...' : 'Đang trích xuất văn bản...'}</p>
                      {isAiProcessing && <p className="text-xs text-slate-400">Quá trình này có thể mất vài giây để đạt độ chính xác cao nhất</p>}
                    </div>
                  </td>
                </tr>
              ) : filteredTransactions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center gap-2">
                      <Search size={40} className="opacity-20" />
                      <p>Không tìm thấy giao dịch nào</p>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredTransactions.map((tx) => (
                  <tr key={tx.id} className={`hover:bg-slate-50 transition-colors ${tx.isVerified ? 'bg-emerald-50/30' : ''}`}>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-slate-600">{tx.date}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="text-sm font-bold text-slate-900">
                        {new Intl.NumberFormat('vi-VN').format(tx.amount)}đ
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col">
                        <span className="text-sm font-medium text-slate-900">{tx.remitter || '---'}</span>
                        <span className="text-xs text-slate-500">{tx.bankName || '---'}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <p className="text-sm text-slate-600 line-clamp-2 max-w-xs">{tx.description}</p>
                    </td>
                    <td className="px-6 py-4">
                      {tx.isVerified ? (
                        <div className="flex items-center gap-1.5 text-emerald-600 font-medium text-sm">
                          <CheckCircle size={16} />
                          <span>Đã xác nhận</span>
                        </div>
                      ) : tx.suggestedOrderId ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 text-blue-600 font-medium text-sm">
                            <AlertCircle size={16} />
                            <span>Khớp đơn: #{tx.suggestedOrderId}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold uppercase ${
                              tx.matchConfidence === 'HIGH' ? 'bg-emerald-100 text-emerald-700' :
                              tx.matchConfidence === 'MEDIUM' ? 'bg-blue-100 text-blue-700' :
                              'bg-amber-100 text-amber-700'
                            }`}>
                              {tx.matchConfidence === 'HIGH' ? 'Tin cậy cao' : 
                               tx.matchConfidence === 'MEDIUM' ? 'Khớp tiền' : 'Khớp tên'}
                            </span>
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400 italic">Không tìm thấy gợi ý</span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {!tx.isVerified && tx.suggestedOrderId && (
                        <button
                          onClick={() => confirmMatch(tx.id, tx.suggestedOrderId!)}
                          className="px-3 py-1.5 bg-emerald-500 text-white text-xs font-bold rounded-lg hover:bg-emerald-600 transition-colors shadow-sm"
                        >
                          Xác nhận ngay
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Review Giao dịch mới */}
      {reviewTransactions && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-5xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-slate-100 flex items-center justify-between bg-emerald-50">
              <div>
                <h2 className="text-xl font-bold text-emerald-900">Kiểm tra dữ liệu nhập ({reviewTransactions.length})</h2>
                <p className="text-emerald-700 text-sm">Vui lòng kiểm tra kỹ số tiền và ngày tháng trước khi xác nhận</p>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setReviewTransactions(null)}
                  className="px-4 py-2 text-slate-600 font-medium hover:bg-slate-100 rounded-xl transition-colors"
                >
                  Hủy bỏ
                </button>
                <button
                  onClick={confirmImport}
                  className="px-6 py-2 bg-emerald-600 text-white font-bold rounded-xl hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-200"
                >
                  Xác nhận Nhập
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto p-6">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-white z-10">
                  <tr className="border-b border-slate-200">
                    <th className="pb-3 text-xs font-bold text-slate-500 uppercase">Ngày</th>
                    <th className="pb-3 text-xs font-bold text-slate-500 uppercase">Số tiền (VNĐ)</th>
                    <th className="pb-3 text-xs font-bold text-slate-500 uppercase">Người gửi / Ngân hàng</th>
                    <th className="pb-3 text-xs font-bold text-slate-500 uppercase">Nội dung</th>
                    <th className="pb-3 text-xs font-bold text-slate-500 uppercase text-right">Xóa</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {reviewTransactions.map((tx) => (
                    <tr key={tx.id} className="group">
                      <td className="py-3 pr-4">
                        <input
                          type="text"
                          value={tx.date}
                          onChange={(e) => updateReviewTx(tx.id, 'date', e.target.value)}
                          className="w-24 px-2 py-1 border border-transparent group-hover:border-slate-200 rounded focus:border-emerald-500 outline-none text-sm"
                        />
                      </td>
                      <td className="py-3 pr-4">
                        <input
                          type="number"
                          value={tx.amount}
                          onChange={(e) => updateReviewTx(tx.id, 'amount', parseFloat(e.target.value))}
                          className="w-32 px-2 py-1 border border-transparent group-hover:border-slate-200 rounded focus:border-emerald-500 outline-none text-sm font-bold text-emerald-700"
                        />
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex flex-col gap-1">
                          <input
                            type="text"
                            value={tx.remitter || ''}
                            placeholder="Người gửi"
                            onChange={(e) => updateReviewTx(tx.id, 'remitter', e.target.value)}
                            className="w-full px-2 py-1 border border-transparent group-hover:border-slate-200 rounded focus:border-emerald-500 outline-none text-sm font-medium"
                          />
                          <input
                            type="text"
                            value={tx.bankName || ''}
                            placeholder="Ngân hàng"
                            onChange={(e) => updateReviewTx(tx.id, 'bankName', e.target.value)}
                            className="w-full px-2 py-1 border border-transparent group-hover:border-slate-200 rounded focus:border-emerald-500 outline-none text-xs text-slate-500"
                          />
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="space-y-1">
                          <textarea
                            value={tx.description}
                            onChange={(e) => updateReviewTx(tx.id, 'description', e.target.value)}
                            className="w-full px-2 py-1 border border-transparent group-hover:border-slate-200 rounded focus:border-emerald-500 outline-none text-sm resize-none h-8"
                          />
                          {tx.rawText && (
                            <div className="text-[10px] text-slate-400 italic truncate max-w-[200px] group-hover:max-w-none group-hover:whitespace-normal transition-all">
                              Gốc: {tx.rawText}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="py-3 text-right">
                        <button
                          onClick={() => removeReviewTx(tx.id)}
                          className="p-1.5 text-slate-300 hover:text-red-500 transition-colors"
                          title="Xóa giao dịch này"
                        >
                          <Trash2 size={16} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TransactionHistory;
