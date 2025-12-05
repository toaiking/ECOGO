
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
      hotline: ''
  });
  const [testResult, setTestResult] = useState<string>('');
  const [isRunningTest, setIsRunningTest] = useState(false);
  
  // Tag State
  const [quickTags, setQuickTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState('');

  // Logo State
  const [logo, setLogo] = useState<string | null>(null);
  
  // Import State
  const [showPdfImport, setShowPdfImport] = useState(false);
  const [pdfJsonData, setPdfJsonData] = useState('');
  const [importBatchName, setImportBatchName] = useState('');

  useEffect(() => {
      if (isOpen) {
          const load = async () => {
              const saved = await storageService.getBankConfig();
              if (saved) setConfig(saved);
              
              const savedShop = await storageService.getShopConfig();
              if (savedShop) setShopConfig(savedShop);
              
              // Load tags
              const tags = storageService.getQuickTags();
              setQuickTags(tags);
              
              // Load Logo
              const savedLogo = storageService.getLogo();
              setLogo(savedLogo);

              // Try fetching from cloud to update local if newer
              storageService.fetchQuickTagsFromCloud().then(t => setQuickTags(t));
              
              // Default batch name
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
          if (file.size > 1024 * 1024) { // 1MB limit
              toast.error("Ảnh quá lớn! Vui lòng chọn ảnh < 1MB");
              return;
          }
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
      
      // Allow UI to update before blocking with heavy task
      setTimeout(async () => {
          try {
              const result = await storageService.generatePerformanceData(10000);
              setTestResult(`Hoàn tất! Tạo ${result.count} khách trong ${result.duration}ms.`);
              toast.success(`Stress test OK: ${result.duration}ms`);
          } catch (e: any) {
              setTestResult('Lỗi: ' + (e?.message || e));
          } finally {
              setIsRunningTest(false);
          }
      }, 100);
  };

  const handleMarkOld = async () => {
      if (window.confirm("Bạn có chắc chắn muốn đánh dấu TẤT CẢ khách hàng hiện tại là KHÁCH CŨ không?\n\nHọ sẽ không hiện nhãn 'NEW' nữa.")) {
          setIsRunningTest(true);
          setTestResult('Đang cập nhật...');
          try {
              const count = await storageService.markAllCustomersAsOld();
              setTestResult(`Đã cập nhật xong ${count} khách hàng.`);
              toast.success(`Xong! ${count} khách hàng đã thành Khách Cũ.`);
          } catch (e: any) {
              setTestResult('Lỗi: ' + (e?.message || e));
          } finally {
              setIsRunningTest(false);
          }
      }
  };

  const handleFixDuplicates = async () => {
      setIsRunningTest(true);
      setTestResult('Đang phân tích...');
      try {
          const count = await storageService.fixDuplicateCustomerIds();
          setTestResult(`Đã tách ${count} khách trùng ID.`);
          toast.success(`Xong! Đã sửa ${count} lỗi.`);
      } catch (e: any) {
          setTestResult('Lỗi: ' + (e?.message || e));
          toast.error("Lỗi khi sửa dữ liệu");
      } finally {
          setIsRunningTest(false);
      }
  };

  const handleMergeDuplicates = async () => {
      if (!window.confirm("Hành động này sẽ gộp các khách hàng có CÙNG SỐ ĐIỆN THOẠI thành 1 người duy nhất (giữ lại người có nhiều đơn nhất). Bạn có chắc không?")) return;
      
      setIsRunningTest(true);
      setTestResult('Đang gộp khách hàng trùng lặp...');
      try {
          const count = await storageService.mergeCustomersByPhone();
          setTestResult(`Đã gộp thành công ${count} nhóm khách hàng trùng lặp.`);
          toast.success(`Xong! Đã gộp ${count} nhóm khách.`);
      } catch (e: any) {
          setTestResult('Lỗi: ' + (e?.message || e));
          toast.error("Lỗi gộp dữ liệu");
      } finally {
          setIsRunningTest(false);
      }
  };
  
  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (file.type !== 'application/pdf') {
          toast.error("Vui lòng chọn file PDF");
          return;
      }
      
      setIsRunningTest(true);
      const loading = toast.loading("AI đang đọc PDF...");
      setTestResult("Đang phân tích file PDF bằng AI...");

      try {
          const parsedData = await dataImportService.parsePdfFile(file);
          setPdfJsonData(JSON.stringify(parsedData, null, 2));
          toast.success(`Đã đọc được ${parsedData.length} dòng từ PDF!`);
          setTestResult(`Đã trích xuất ${parsedData.length} đơn hàng. Vui lòng kiểm tra JSON bên dưới và bấm Import.`);
      } catch (error: any) {
          console.error(error);
          toast.error("Lỗi đọc PDF: " + error.message);
          setTestResult("Lỗi: " + error.message);
      } finally {
          toast.dismiss(loading);
          setIsRunningTest(false);
          // Clear input so same file can be selected again
          e.target.value = '';
      }
  };

  const handlePdfImport = async () => {
      if (!pdfJsonData.trim()) {
          toast.error("Vui lòng dán dữ liệu JSON hoặc chọn file PDF");
          return;
      }
      if (!importBatchName.trim()) {
          toast.error("Vui lòng nhập tên Lô");
          return;
      }
      
      setIsRunningTest(true);
      setTestResult("Đang xử lý import...");
      
      try {
          const rawData = JSON.parse(pdfJsonData);
          if (!Array.isArray(rawData)) {
              throw new Error("Dữ liệu JSON phải là một mảng []");
          }
          
          const msg = await dataImportService.processImportData(rawData, importBatchName);
          setTestResult(msg);
          toast.success("Import thành công!");
          setPdfJsonData('');
      } catch (e: any) {
          console.error(e);
          setTestResult("Lỗi Import: " + e.message);
          toast.error("Lỗi Import (Xem chi tiết bên dưới)");
      } finally {
          setIsRunningTest(false);
      }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden flex flex-col max-h-[90vh]">
        <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
            <h3 className="text-lg font-bold text-gray-800">Cài đặt</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><i className="fas fa-times"></i></button>
        </div>
        
        <div className="overflow-y-auto p-6 space-y-6">
            <form onSubmit={handleSave} className="space-y-4">
                
                {/* Branding Section */}
                <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Thông tin Cửa hàng</h4>
                <div className="space-y-3 bg-gray-50 p-3 rounded-xl border border-gray-100">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 mb-1">Tên Shop / Header Hóa đơn</label>
                        <input 
                            value={shopConfig.shopName}
                            onChange={e => setShopConfig({...shopConfig, shopName: e.target.value})}
                            className="w-full p-2.5 bg-white border border-gray-200 rounded-lg outline-none focus:border-eco-500 font-bold text-gray-800 uppercase"
                            placeholder="ECOGO LOGISTICS"
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-gray-500 mb-1">Hotline (In trên hóa đơn)</label>
                        <input 
                            value={shopConfig.hotline}
                            onChange={e => setShopConfig({...shopConfig, hotline: e.target.value})}
                            className="w-full p-2.5 bg-white border border-gray-200 rounded-lg outline-none focus:border-eco-500 font-medium"
                            placeholder="0912..."
                        />
                    </div>
                    
                    <div className="flex items-center gap-4 pt-2 border-t border-gray-200 mt-2">
                        <div className="w-12 h-12 bg-white rounded-lg flex items-center justify-center border border-gray-200 overflow-hidden relative flex-shrink-0">
                            {logo ? (
                                <img src={logo} alt="Logo" className="w-full h-full object-contain" />
                            ) : (
                                <i className="fas fa-image text-gray-300"></i>
                            )}
                        </div>
                        <div className="flex-grow">
                            <label className="block text-xs font-bold text-blue-600 mb-1 cursor-pointer hover:underline">
                                <input type="file" accept="image/*" className="hidden" onChange={handleLogoUpload} />
                                <i className="fas fa-upload mr-1"></i> Đổi Logo
                            </label>
                            {logo && (
                                <button type="button" onClick={handleRemoveLogo} className="text-xs font-bold text-red-500 hover:text-red-600">
                                    <i className="fas fa-trash mr-1"></i> Xóa
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Bank Section */}
                <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider pt-2">Ngân hàng & Thanh toán</h4>
                <div className="space-y-3">
                    <div>
                        <label className="block text-xs font-bold text-gray-500 mb-1">Ngân hàng</label>
                        <select 
                            value={config.bankId}
                            onChange={e => setConfig({...config, bankId: e.target.value})}
                            className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:border-eco-500 font-medium"
                        >
                            {BANKS.map(b => (
                                <option key={b.id} value={b.id}>{b.name} ({b.id})</option>
                            ))}
                        </select>
                    </div>
                    
                    <div>
                        <label className="block text-xs font-bold text-gray-500 mb-1">Số tài khoản</label>
                        <input 
                            type="text"
                            value={config.accountNo}
                            onChange={e => setConfig({...config, accountNo: e.target.value})}
                            placeholder="VD: 0912345678"
                            required
                            className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:border-eco-500 font-bold tracking-wide"
                        />
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-gray-500 mb-1">Tên chủ tài khoản (Viết hoa)</label>
                        <input 
                            type="text"
                            value={config.accountName}
                            onChange={e => setConfig({...config, accountName: e.target.value.toUpperCase()})}
                            placeholder="NGUYEN VAN A"
                            className="w-full p-2.5 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:border-eco-500 font-bold uppercase"
                        />
                    </div>
                </div>

                {/* Quick Tags Section */}
                <div className="border-t border-gray-100 pt-4 mt-4">
                    <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-2">Thẻ nhập nhanh (Ghi chú)</h4>
                    <div className="flex gap-2 mb-3">
                        <input 
                            value={newTag}
                            onChange={e => setNewTag(e.target.value)}
                            placeholder="Thêm thẻ (VD: Dễ vỡ)"
                            className="flex-grow p-2 text-sm bg-gray-50 border border-gray-200 rounded-lg outline-none focus:border-eco-500"
                        />
                        <button type="button" onClick={addTag} className="px-3 bg-eco-100 text-eco-700 rounded-lg font-bold text-sm hover:bg-eco-200">+</button>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {quickTags.map(tag => (
                            <div key={tag} className="flex items-center gap-1 bg-gray-100 px-2 py-1 rounded text-xs font-medium text-gray-700">
                                {tag}
                                <button type="button" onClick={() => removeTag(tag)} className="text-gray-400 hover:text-red-500 w-4 h-4 flex items-center justify-center rounded-full"><i className="fas fa-times text-[10px]"></i></button>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="pt-4 border-t border-gray-100">
                    <button type="submit" className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-blue-100">
                        Lưu Cài Đặt
                    </button>
                </div>
            </form>

            <div className="border-t border-gray-100 pt-4">
                <h4 className="text-sm font-bold text-gray-400 uppercase tracking-wider mb-3">Developer Zone</h4>
                <div className="bg-yellow-50 rounded-xl p-4 border border-yellow-100 space-y-3">
                    <button 
                        onClick={() => setShowPdfImport(!showPdfImport)}
                        className="w-full py-2 bg-purple-100 hover:bg-purple-200 text-purple-800 rounded-lg font-bold text-xs transition-colors flex items-center justify-center gap-2"
                    >
                        <i className="fas fa-file-import"></i> Import PDF Data (AI)
                    </button>
                    
                    {showPdfImport && (
                        <div className="space-y-2 animate-fade-in bg-white p-3 rounded-lg border border-yellow-200">
                            <label className="text-[10px] font-bold text-gray-500 uppercase">Tên lô hàng</label>
                            <input 
                                value={importBatchName}
                                onChange={e => setImportBatchName(e.target.value)}
                                className="w-full p-2 bg-gray-50 border border-gray-200 rounded text-xs font-bold"
                            />
                            
                            {/* File Upload Button */}
                            <div className="relative group cursor-pointer">
                                <label className="block w-full py-2 bg-eco-50 text-eco-700 border border-eco-200 rounded-lg text-center font-bold text-xs cursor-pointer hover:bg-eco-100 transition-colors">
                                    <i className="fas fa-cloud-upload-alt mr-2"></i> Chọn File PDF để đọc
                                    <input type="file" accept="application/pdf" className="hidden" onChange={handleFileSelect} disabled={isRunningTest} />
                                </label>
                            </div>

                            <div className="text-center text-[10px] text-gray-400">HOẶC Dán JSON</div>
                            
                            <textarea 
                                value={pdfJsonData}
                                onChange={e => setPdfJsonData(e.target.value)}
                                placeholder='[{"unit_price":120, "customer_name":"A", ...}]'
                                className="w-full h-32 p-2 bg-gray-50 border border-gray-200 rounded text-[10px] font-mono"
                            />
                            
                            <button 
                                onClick={handlePdfImport}
                                disabled={isRunningTest}
                                className="w-full py-2 bg-purple-600 text-white rounded font-bold text-xs hover:bg-purple-700 shadow-md"
                            >
                                {isRunningTest ? 'Đang xử lý...' : 'Bắt đầu Import'}
                            </button>
                        </div>
                    )}

                    <div className="h-px bg-yellow-200 my-2"></div>

                    <button 
                        onClick={handleMarkOld} 
                        disabled={isRunningTest}
                        className="w-full py-2 bg-blue-100 hover:bg-blue-200 text-blue-800 rounded-lg font-bold text-xs transition-colors"
                    >
                        Đánh dấu tất cả là Khách cũ
                    </button>
                    
                    <button 
                        onClick={handleMergeDuplicates} 
                        disabled={isRunningTest}
                        className="w-full py-2 bg-green-100 hover:bg-green-200 text-green-800 rounded-lg font-bold text-xs transition-colors"
                    >
                        Gộp Khách Hàng Trùng Lặp
                    </button>

                    <button 
                        onClick={handleFixDuplicates} 
                        disabled={isRunningTest}
                        className="w-full py-2 bg-orange-100 hover:bg-orange-200 text-orange-800 rounded-lg font-bold text-xs transition-colors"
                    >
                        Phân tách Khách trùng ID
                    </button>

                    <button 
                        onClick={runStressTest} 
                        disabled={isRunningTest}
                        className={`w-full py-2 rounded-lg font-bold text-xs transition-colors ${isRunningTest ? 'bg-gray-200 text-gray-500' : 'bg-yellow-400 hover:bg-yellow-500 text-yellow-900'}`}
                    >
                        {isRunningTest ? 'Đang chạy...' : 'Tạo 10.000 Khách hàng ảo'}
                    </button>
                    {testResult && (
                        <div className="mt-2 text-xs font-mono bg-white p-2 rounded border border-gray-200 text-gray-600 max-h-20 overflow-y-auto">
                            {testResult}
                        </div>
                    )}
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
