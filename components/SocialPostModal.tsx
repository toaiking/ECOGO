
import React, { useState } from 'react';
import { Product } from '../types';
import { generateSocialPost, PostStyle } from '../services/geminiService';
import toast from 'react-hot-toast';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    selectedProducts: Product[];
}

const STYLES: { id: PostStyle; label: string; icon: string; desc: string }[] = [
    { id: 'DEFAULT', label: 'Thân thiện', icon: '😊', desc: 'Giọng văn mời gọi, icon sinh động' },
    { id: 'FOMO', label: 'Gấp gáp', icon: '🔥', desc: 'Tạo cảm giác khan hiếm, chốt đơn nhanh' },
    { id: 'FUNNY', label: 'Hài hước', icon: '🤣', desc: 'Thả thính, bắt trend, vui vẻ' },
    { id: 'STORY', label: 'Tâm sự', icon: '📝', desc: 'Kể chuyện nhẹ nhàng, sâu lắng' },
    { id: 'MINIMAL', label: 'Tối giản', icon: '⚡', desc: 'Ngắn gọn, súc tích, chỉ menu & giá' },
];

const SocialPostModal: React.FC<Props> = ({ isOpen, onClose, selectedProducts }) => {
    const [location, setLocation] = useState('cư dân ehome4');
    const [time, setTime] = useState('6H SÁNG');
    const [generatedContent, setGeneratedContent] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [selectedStyle, setSelectedStyle] = useState<PostStyle>('DEFAULT');

    if (!isOpen) return null;

    const handleGenerate = async () => {
        setIsLoading(true);
        try {
            const content = await generateSocialPost(selectedProducts, location, time, selectedStyle);
            setGeneratedContent(content);
        } catch (error) {
            toast.error("Lỗi khi tạo bài đăng");
        } finally {
            setIsLoading(false);
        }
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(generatedContent);
        toast.success("Đã copy nội dung!");
    };

    return (
        <div className="fixed inset-0 z-[200] bg-gray-900/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white w-full max-w-lg rounded-[2rem] shadow-2xl overflow-hidden flex flex-col max-h-[90vh] border-4 border-gray-900">
                <div className="p-5 bg-gradient-to-r from-blue-600 to-purple-600 flex justify-between items-center text-white shrink-0">
                    <h3 className="font-black text-lg uppercase tracking-widest flex items-center gap-2">
                        <i className="fas fa-magic"></i> Soạn bài FB/Zalo
                    </h3>
                    <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/40 flex items-center justify-center transition-colors">
                        <i className="fas fa-times"></i>
                    </button>
                </div>

                <div className="flex-grow overflow-y-auto bg-gray-50">
                    {/* Settings Area */}
                    <div className="p-5 space-y-4">
                        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-[10px] font-black text-gray-400 uppercase ml-1 block mb-1">Khu vực (Header)</label>
                                <input 
                                    value={location} 
                                    onChange={(e) => setLocation(e.target.value)} 
                                    className="w-full p-2 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold outline-none focus:border-blue-500 transition-colors"
                                    placeholder="VD: cư dân ehome4"
                                />
                            </div>
                            <div>
                                <label className="text-[10px] font-black text-gray-400 uppercase ml-1 block mb-1">Giờ giao hàng</label>
                                <input 
                                    value={time} 
                                    onChange={(e) => setTime(e.target.value)} 
                                    className="w-full p-2 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold outline-none focus:border-blue-500 transition-colors"
                                    placeholder="VD: 6H SÁNG"
                                />
                            </div>
                        </div>

                        {/* Style Selector */}
                        <div>
                            <label className="text-[10px] font-black text-gray-400 uppercase ml-1 block mb-2">Chọn phong cách viết</label>
                            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
                                {STYLES.map(style => (
                                    <button
                                        key={style.id}
                                        onClick={() => setSelectedStyle(style.id)}
                                        className={`flex flex-col items-center p-3 min-w-[80px] rounded-2xl border-2 transition-all active:scale-95 ${
                                            selectedStyle === style.id 
                                            ? 'bg-purple-50 border-purple-500 text-purple-700 shadow-md' 
                                            : 'bg-white border-gray-100 text-gray-500 hover:border-gray-300'
                                        }`}
                                    >
                                        <span className="text-2xl mb-1">{style.icon}</span>
                                        <span className="text-[10px] font-black uppercase whitespace-nowrap">{style.label}</span>
                                    </button>
                                ))}
                            </div>
                            <div className="text-[10px] text-purple-600 font-bold mt-1 ml-1 italic animate-fade-in">
                                <i className="fas fa-info-circle mr-1"></i>
                                {STYLES.find(s => s.id === selectedStyle)?.desc}
                            </div>
                        </div>

                        {/* Products Summary */}
                        <div className="bg-orange-50 border-2 border-orange-100 p-3 rounded-2xl">
                            <div className="text-[10px] font-black text-orange-600 uppercase tracking-widest mb-1">Sản phẩm đã chọn ({selectedProducts.length})</div>
                            <div className="flex flex-wrap gap-1">
                                {selectedProducts.map(p => (
                                    <span key={p.id} className="text-[10px] font-bold bg-white text-orange-800 px-2 py-1 rounded-lg border border-orange-200 shadow-sm">
                                        {p.name}
                                    </span>
                                ))}
                            </div>
                        </div>

                        {/* Result Area */}
                        {generatedContent ? (
                            <div className="relative animate-scale-in">
                                <textarea 
                                    value={generatedContent} 
                                    onChange={(e) => setGeneratedContent(e.target.value)}
                                    className="w-full h-64 p-4 bg-white border-2 border-purple-200 rounded-2xl outline-none text-sm font-medium text-gray-800 resize-none shadow-inner focus:border-purple-500 transition-all"
                                ></textarea>
                                <button 
                                    onClick={handleCopy}
                                    className="absolute top-2 right-2 w-10 h-10 bg-gray-900 text-white rounded-xl shadow-lg flex items-center justify-center hover:bg-black active:scale-90 transition-all"
                                    title="Copy"
                                >
                                    <i className="fas fa-copy"></i>
                                </button>
                            </div>
                        ) : (
                            <div className="h-32 flex flex-col items-center justify-center text-gray-400 border-2 border-dashed border-gray-300 rounded-2xl bg-gray-50/50">
                                <i className="fas fa-robot text-3xl mb-2 opacity-50"></i>
                                <span className="text-xs font-bold uppercase tracking-widest">Sẵn sàng sáng tạo</span>
                            </div>
                        )}
                    </div>
                </div>

                <div className="p-4 bg-white border-t border-gray-200 flex gap-3 shrink-0">
                    {generatedContent && (
                        <button 
                            onClick={handleGenerate}
                            disabled={isLoading}
                            className="w-14 flex items-center justify-center bg-gray-100 text-gray-600 rounded-xl hover:bg-gray-200 transition-colors border-2 border-gray-200"
                            title="Viết lại kiểu khác"
                        >
                            <i className={`fas fa-sync ${isLoading ? 'fa-spin' : ''}`}></i>
                        </button>
                    )}
                    <button 
                        onClick={handleGenerate}
                        disabled={isLoading}
                        className="flex-grow py-4 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-2xl font-black uppercase text-xs tracking-widest shadow-lg hover:shadow-xl active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                    >
                        {isLoading ? (
                            <>
                                <i className="fas fa-circle-notch fa-spin"></i> AI Đang viết...
                            </>
                        ) : (
                            <>
                                <i className="fas fa-pen-nib"></i> {generatedContent ? 'Viết lại ngay' : 'Tạo bài đăng'}
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SocialPostModal;
