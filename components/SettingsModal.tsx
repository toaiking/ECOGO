
import React, { useState, useEffect } from 'react';
import { BankConfig } from '../types';
import { storageService } from '../services/storageService';
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

  useEffect(() => {
      if (isOpen) {
          const load = async () => {
              const saved = await storageService.getBankConfig();
              if (saved) setConfig(saved);
          };
          load();
      }
  }, [isOpen]);

  const handleSave = async (e: React.FormEvent) => {
      e.preventDefault();
      await storageService.saveBankConfig(config);
      toast.success("Đã lưu thông tin ngân hàng!");
      onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden">
        <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
            <h3 className="text-lg font-bold text-gray-800">Cài đặt Thanh toán</h3>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><i className="fas fa-times"></i></button>
        </div>
        
        <form onSubmit={handleSave} className="p-6 space-y-4">
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

            <div className="pt-2">
                <button type="submit" className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl transition-all shadow-lg shadow-blue-100">
                    Lưu Cài Đặt
                </button>
            </div>
        </form>
      </div>
    </div>
  );
};

export default SettingsModal;
