
import React, { useState, useEffect } from 'react';
import { BankConfig, ShopConfig } from '../types';
import { storageService } from '../services/storageService';
import { dataImportService } from '../services/dataImportService';
import toast from 'react-hot-toast';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

const BANKS = [
    { id: 'MB', name: 'MB Bank (Quân Đội)' },
    { id: 'VCB', name: 'Vietcombank' },
    { id: 'TCB', name: 'Techcombank' },
    { id: 'ACB', name: 'ACB (Á Châu)' },
    { id: 'VPB', name: 'VPBank' },
    { id: 'TPB', name: 'TPBank' },
    { id: 'VIB', name: 'VIB' },
    { id: 'BIDV', name: 'BIDV' },
    { id: 'CTG', name: 'VietinBank' },
    { id: 'STB', name: 'Sacombank' },
    { id: 'MSB', name: 'MSB (Hàng Hải)' },
];

const SettingsModal: React.FC<Props> = ({ isOpen, onClose }) => {
  const [config, setConfig] = useState<BankConfig>({
      bankId: 'MB',
      accountNo: '',
      accountName: '',
      template: 'compact2'
  });
  const [shopConfig, setShopConfig] = useState<ShopConfig>({
      shopName: 'ECOGO LOGISTICS',
      hotline: '',
      address: ''
  });
  const [testResult, setTestResult] = useState<string>('');
  const [isRunningTest, setIsRunningTest] = useState(false);
  
  const [quickTags, setQuickTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');
  const [logo, setLogo] = useState<string | null>(null);
  const [showPdfImport, setShowPdfImport] = useState(false);
  const [pdfJsonData, setPdfJsonData] = useState('');
  const [importBatchName, setImportBatchName] = useState('');

  useEffect(() => {
      if (isOpen) {
          const load = async () => {
              const saved = await storageService.getBankConfig();
              if (saved) setConfig(saved);
              
              const savedShop = await storageService.getShopConfig();
              if (savedShop) setShopConfig({ ...savedShop, address: savedShop.address || '' });
              
              const tags = storageService.getQuickTags();
              setQuickTags(tags);
              
              const savedLogo = storageService.getLogo();
              setLogo(savedLogo);

              storageService.fetchQuickTagsFromCloud().then(t => setQuickTags(t));
              
              const today = new Date().toISOString().slice(0, 10);
              setImportBatchName(`PDF-${today}`);
          };
          load();
      }
  }, [isOpen]);

  const handleSave = async (e: React.FormEvent) => {
      e.preventDefault();
      await storageService.saveBankConfig(config);
      await storageService.saveShopConfig(shopConfig);
      await storageService.saveQuickTags(quickTags);
      toast.success("Đã lưu tất cả cài đặt!");
      onClose();
  };
  
  const addTag = (e: React.FormEvent) => {
      e.preventDefault();
      const tag = newTag.trim();
      if (tag && !quickTags.includes(tag)) {
          setQuickTags([...quickTags, tag]);
          setNewTag('');
      } else if (quickTags.includes(tag)) {
          toast.error("Thẻ này đã tồn tại");
      }
  };
  
  const removeTag = (tagToRemove: string) => {
      setQuickTags(quickTags.filter(t => t !== tagToRemove));
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
          if (file.size > 1024 * 1024) { toast.error("Ảnh quá lớn! Vui lòng chọn ảnh < 1MB"); return; }
          const reader = new FileReader();
          reader.onloadend = () => {
              const base64 = reader.result as string;
              storageService.saveLogo(base64);
              setLogo(base64);
              toast.success("Đã cập nhật Logo");
          };
          reader.readAsDataURL(file);
      }
  };

  const handleRemoveLogo = () => {
      storageService.removeLogo();
      setLogo(null);
      toast.success("Đã xóa Logo");
  };

  const runStressTest = async () => {
      setIsRunningTest(true);
      setTestResult('Đang tạo 10,000 khách hàng...');
      setTimeout(async () => {
          try {
              const result = await storageService.generatePerformanceData(10000);
              setTestResult(`Hoàn tất! Tạo ${result.count} khách trong ${result.duration}ms.`);
              toast.success(`Stress test OK: ${result.duration}ms`);
          } catch (e: any) { setTestResult('Lỗi: ' + (e?.message || e)); } finally { setIsRunningTest(false); }
      }, 100);
  };

  const handleMarkOld = async () => {
      if (window.confirm("Đánh dấu tất cả là Khách Cũ?")) {
          setIsRunningTest(true);
          try {
              const count = await storageService.markAllCustomersAsOld();
              setTestResult(`Đã cập nhật xong ${count} khách hàng.`);
              toast.success(`Xong! ${count} khách hàng đã thành Khách Cũ.`);
          } catch (e: any) { setTestResult('Lỗi: ' + (e?.message || e)); } finally { setIsRunningTest(false); }
      }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setIsRunningTest(true);
      const loading = toast.loading("AI đang đọc PDF...");
      try {
          const parsedData = await dataImportService.parsePdfFile(file);
          setPdfJsonData(JSON.stringify(parsedData, null, 2));
          toast.success(`Đã đọc được ${parsedData.length} dòng!`);
      } catch (error: any) { toast.error("Lỗi đọc PDF"); } finally { toast.dismiss(loading); setIsRunningTest(false); e.target.value = ''; }
  };

  const handlePdfImport = async () => {
      if (!pdfJsonData.trim() || !importBatchName.trim()) { toast.error("Thiếu thông tin"); return; }
      setIsRunningTest(true);
      try {
          const rawData = JSON.parse(pdfJsonData);
          const msg = await dataImportService.processImportData(rawData, importBatchName);
          setTestResult(msg);
          toast.success("Import thành công!");
          setPdfJsonData('');
      } catch (e: any) { toast.error("Lỗi Import"); } finally { setIsRunningTest(false); }
  };

  const handleRecalculateStock = async () => {
      setIsRunningTest(true);
      try {
          const count = await storageService.recalculateInventoryFromOrders();
          setTestResult(`Đã cập nhật lại tồn kho cho ${count} sản phẩm bị lệch.`);
          toast.success("Đồng bộ kho hoàn tất!");
      } catch (e: any) {
          toast.error("Lỗi đồng bộ kho");
      } finally {
          setIsRunningTest(false);
      }
  };

  if (!isOpen) return null;

  const vInputClass = "w-full p-2.5 bg-white border-2 border-gray-800 rounded-xl outline-none focus:ring-4 focus:ring-eco-50 font-black text-black placeholder-gray-300 transition-all";

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
            <h3 className="text-lg font-black text-gray-800 uppercase tracking-tighter">Cài đặt hệ thống</h3>
            <button onClick={onClose} className="w-8 h-8 rounded-full bg-white text-gray-400 hover:text-gray-600 flex items-center justify-center border border-gray-100"><i className="fas fa-times"></i></button>
        </div>
        
        <div className="overflow-y-auto p-6 space-y-8">
            <form onSubmit={handleSave} className="space-y-6">
                
                <div className="space-y-4">
                    <h4 className="text-[10px] font-black text-eco-600 uppercase tracking-widest flex items-center gap-2">
                        <i className="fas fa-store"></i> Thông tin Shop
                    </h4>
                    <div className="space-y-3">
                        <div>
                            <label className="block text-[10px] font-black text-gray-400 uppercase mb-1 ml-1">Tên Cửa hàng / Đầu phiếu</label>
                            <input value={shopConfig.shopName} onChange={e => setShopConfig({...shopConfig, shopName: e.target.value})} className={vInputClass} placeholder="ECOGO LOGISTICS" />
                        </div>
                        <div>
                            <label className="block text-[10px] font-black text-gray-400 uppercase mb-1 ml-1">Hotline lấy hàng</label>
                            <input value={shopConfig.hotline} onChange={e => setShopConfig({...shopConfig, hotline: e.target.value})} className={vInputClass} placeholder="09xxxxxx" />
                        </div>
                        <div>
                            <label className="block text-[10px] font-black text-gray-400 uppercase mb-1 ml-1">Địa chỉ lấy hàng (Quan trọng cho Ahamove)</label>
                            <textarea value={shopConfig.address} onChange={e => setShopConfig({...shopConfig, address: e.target.value})} className={`${vInputClass} text-xs font-bold h-20 resize-none`} placeholder="Nhập địa chỉ chính xác để tài xế qua lấy..." />
                        </div>
                        <div className="flex items-center gap-4 p-3 bg-gray-50 rounded-xl border border-dashed border-gray-300">
                            <div className="w-12 h-12 bg-white rounded-lg flex items-center justify-center border-2 border-gray-800 overflow-hidden shrink-0">
                                {logo ? <img src={logo} alt="Logo" className="w-full h-full object-contain" /> : <i className="fas fa-image text-gray-300"></i>}
                            </div>
                            <div className="flex-grow">
                                <label className="block text-[10px] font-black text-blue-600 cursor-pointer hover:underline uppercase">
                                    <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                                    <i className="fas fa-upload mr-1"></i> Tải ảnh Logo
                                </label>
                                {logo && <button type="button" onClick={handleRemoveLogo} className="text-[10px] font-black text-red-500 hover:text-red-600 uppercase mt-1"><i className="fas fa-trash mr-1"></i> Xóa Logo</button>}
                            </div>
                        </div>
                    </div>
                </div>

                <div className="space-y-4">
                    <h4 className="text-[10px] font-black text-blue-600 uppercase tracking-widest flex items-center gap-2">
                        <i className="fas fa-university"></i> Tài khoản nhận tiền
                    </h4>
                    <div className="space-y-3">
                        <div>
                            <label className="block text-[10px] font-black text-gray-400 uppercase mb-1 ml-1">Chọn Ngân hàng</label>
                            <select value={config.bankId} onChange={e => setConfig({...config, bankId: e.target.value})} className={`${vInputClass} appearance-none`}>
                                {BANKS.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-[10px] font-black text-gray-400 uppercase mb-1 ml-1">Số tài khoản (STK)</label>
                            <input type="text" value={config.accountNo} onChange={e => setConfig({...config, accountNo: e.target.value})} className={`${vInputClass} text-lg tracking-widest`} placeholder="Số tài khoản..." />
                        </div>
                        <div>
                            <label className="block text-[10px] font-black text-gray-400 uppercase mb-1 ml-1">Chủ tài khoản (Viết hoa)</label>
                            <input type="text" value={config.accountName} onChange={e => setConfig({...config, accountName: e.target.value.toUpperCase()})} className={`${vInputClass} uppercase`} placeholder="NGUYEN VAN A" />
                        </div>
                    </div>
                </div>

                <div className="space-y-3">
                    <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                        <i className="fas fa-tags"></i> Thẻ Ghi Chú Nhanh
                    </h4>
                    <div className="flex gap-2">
                        <input value={newTag} onChange={e => setNewTag(e.target.value)} placeholder="VD: Giao hẻm..." className={vInputClass} />
                        <button type="button" onClick={addTag} className="px-4 bg-black text-white rounded-xl font-black shadow-lg hover:bg-gray-800 transition-all">+</button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {quickTags.map(tag => (
                            <div key={tag} className="flex items-center gap-2 bg-white border-2 border-gray-800 px-3 py-1.5 rounded-lg text-[10px] font-black text-black">
                                {tag}
                                <button type="button" onClick={() => removeTag(tag)} className="text-gray-400 hover:text-red-600"><i className="fas fa-times"></i></button>
                            </div>
                        ))}
                    </div>
                </div>

                <button type="submit" className="w-full py-4 bg-black text-white rounded-2xl font-black text-sm shadow-xl hover:bg-gray-800 transition-all active:scale-95 uppercase tracking-widest">
                    Lưu toàn bộ cài đặt <i className="fas fa-save ml-2"></i>
                </button>
            </form>

            <div className="border-t-2 border-gray-100 pt-8">
                <h4 className="text-[10px] font-black text-red-500 uppercase tracking-widest mb-4">Công cụ quản trị (Dành cho Dev)</h4>
                <div className="bg-gray-50 rounded-2xl p-4 border-2 border-gray-200 space-y-4">
                    <button onClick={() => setShowPdfImport(!showPdfImport)} className="w-full py-2.5 bg-white border-2 border-gray-800 rounded-xl font-black text-[10px] uppercase shadow-sm hover:bg-gray-100 transition-all">
                        <i className="fas fa-file-import mr-2"></i> Nhập dữ liệu từ PDF (AI)
                    </button>
                    
                    {showPdfImport && (
                        <div className="space-y-3 animate-fade-in bg-white p-4 rounded-xl border-2 border-gray-800">
                            <div>
                                <label className="text-[9px] font-black text-gray-400 uppercase ml-1">Tên lô hàng</label>
                                <input value={importBatchName} onChange={e => setImportBatchName(e.target.value)} className={vInputClass} />
                            </div>
                            <label className="block w-full py-3 bg-blue-50 text-blue-700 border-2 border-blue-200 border-dashed rounded-xl text-center font-black text-[10px] cursor-pointer hover:bg-blue-100 uppercase">
                                <i className="fas fa-cloud-upload-alt mr-2"></i> Chọn File PDF
                                <input type="file" accept="application/pdf" className="hidden" onChange={handleFileSelect} disabled={isRunningTest} />
                            </label>
                            <textarea value={pdfJsonData} onChange={e => setPdfJsonData(e.target.value)} placeholder="Dữ liệu JSON..." className={`${vInputClass} h-32 text-[10px] font-mono`} />
                            <button onClick={handlePdfImport} disabled={isRunningTest} className="w-full py-3 bg-eco-600 text-white rounded-xl font-black text-[10px] uppercase shadow-md">{isRunningTest ? 'Đang xử lý...' : 'Xác nhận Import'}</button>
                        </div>
                    )}

                    <div className="grid grid-cols-1 gap-2">
                        <button onClick={handleMarkOld} disabled={isRunningTest} className="w-full py-2 bg-gray-200 hover:bg-gray-300 rounded-lg font-black text-[9px] uppercase">Gỡ nhãn NEW toàn bộ khách</button>
                        <button onClick={handleRecalculateStock} disabled={isRunningTest} className="w-full py-2 bg-purple-100 text-purple-700 hover:bg-purple-200 rounded-lg font-black text-[9px] uppercase">Đồng bộ lại Tồn Kho (Fix Lỗi)</button>
                        <button onClick={runStressTest} disabled={isRunningTest} className="w-full py-2 bg-yellow-400 hover:bg-yellow-500 rounded-lg font-black text-[9px] uppercase">Stress Test (10k Khách)</button>
                    </div>
                    {testResult && <div className="mt-2 text-[9px] font-mono bg-black text-green-400 p-3 rounded-xl max-h-24 overflow-y-auto leading-tight">{testResult}</div>}
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
