
import React, { useState } from 'react';
import { pdfService } from '../services/pdfService';
import toast from 'react-hot-toast';

interface Props {
    isOpen: boolean;
    onClose: () => void;
}

const steps = [
    {
        title: "1. Cài đặt & Đăng nhập",
        icon: "fa-mobile-screen",
        color: "bg-slate-800",
        desc: "Ứng dụng EcoGo là App dạng PWA. Bạn cài đặt trực tiếp từ Safari (iPhone) hoặc Chrome (Android) để 'Thêm vào màn hình chính'.",
        visual: (
            <div className="flex gap-4 items-center justify-center py-4">
                <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center border-2 border-gray-900 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"><i className="fab fa-safari text-blue-500"></i></div>
                <i className="fas fa-arrow-right text-gray-300"></i>
                <div className="w-10 h-10 bg-gray-100 rounded-lg flex items-center justify-center border-2 border-gray-900 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)]"><i className="fas fa-share-square text-gray-700"></i></div>
                <i className="fas fa-arrow-right text-gray-300"></i>
                <div className="w-10 h-10 bg-eco-500 rounded-lg flex items-center justify-center border-2 border-gray-900 shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] text-white"><i className="fas fa-check"></i></div>
            </div>
        ),
        tip: "Mẹo: App sẽ chạy nhanh hơn và có icon riêng trên điện thoại sau khi cài đặt."
    },
    {
        title: "2. Bản đồ giao diện",
        icon: "fa-map",
        color: "bg-blue-600",
        desc: "5 khu vực chính: Dashboard (Số liệu), Tạo đơn (Nhập liệu), Theo dõi (Giao hàng), Đối soát (Tiền bạc), Kho & Khách.",
        visual: (
            <div className="w-full bg-gray-100 rounded-xl p-2 border-2 border-gray-900">
                <div className="h-4 bg-gray-800 rounded-t-lg mb-2"></div>
                <div className="flex gap-1 h-20">
                    <div className="flex-1 bg-white border border-gray-300 rounded"></div>
                    <div className="flex-1 bg-white border border-gray-300 rounded"></div>
                </div>
                <div className="h-6 flex justify-around items-center mt-2">
                    <div className="w-4 h-4 bg-eco-500 rounded-full"></div>
                    <div className="w-4 h-4 bg-orange-400 rounded-full"></div>
                    <div className="w-4 h-4 bg-blue-400 rounded-full"></div>
                </div>
            </div>
        ),
        tip: "Mẹo: Luôn để ý Nút Sét (⚡) ở góc phải để dùng nhanh các tính năng AI."
    },
    {
        title: "3. Quản lý kho hàng",
        icon: "fa-warehouse",
        color: "bg-amber-600",
        desc: "Lưu Giá Vốn và Giá Bán. Hệ thống tự động tính lãi dựa trên 'Giá Vốn' tại thời điểm chốt đơn.",
        visual: (
            <div className="space-y-2">
                <div className="flex justify-between bg-white border border-gray-200 p-2 rounded-lg text-[9px] font-black">
                    <span>GẠO ST25</span>
                    <span className="text-eco-600">TỒN: 50</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                    <div className="bg-gray-50 p-1 text-[8px] border rounded">Vốn: 120k</div>
                    <div className="bg-blue-50 p-1 text-[8px] border border-blue-100 rounded text-blue-600">Bán: 160k</div>
                </div>
            </div>
        ),
        tip: "Mẹo: Hàng sắp hết (< 5) sẽ tự động báo đỏ và gửi thông báo chuông."
    },
    {
        title: "4. Lên đơn AI & Smart-Paste",
        icon: "fa-robot",
        color: "bg-purple-600",
        desc: "Dùng giọng nói hoặc Copy tin nhắn Zalo dán vào ô Ghi chú. AI Gemini sẽ tự bóc tách tên, địa chỉ, hàng hóa.",
        visual: (
            <div className="flex items-center justify-center p-4">
                <div className="relative">
                    <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center text-purple-600 animate-pulse border-2 border-purple-300">
                        <i className="fas fa-microphone"></i>
                    </div>
                    <div className="absolute -right-2 -bottom-2 bg-white rounded-lg p-1 border shadow-sm text-[8px] font-bold">Chị Lan...</div>
                </div>
            </div>
        ),
        tip: "Mẹo: AI hiểu được cả các tên viết tắt bạn đặt trong Kho hàng."
    },
    {
        title: "5. Theo dõi & Trạng thái",
        icon: "fa-tasks",
        color: "bg-orange-500",
        desc: "Cập nhật tiến độ: Chờ xử lý -> Đã lấy -> Đang giao -> Hoàn tất. Mỗi trạng thái có màu sắc nhận diện riêng.",
        visual: (
            <div className="flex justify-between items-center py-2">
                <div className="w-6 h-6 bg-yellow-400 rounded-full"></div>
                <div className="h-0.5 flex-grow bg-gray-200"></div>
                <div className="w-6 h-6 bg-blue-500 rounded-full"></div>
                <div className="h-0.5 flex-grow bg-gray-200"></div>
                <div className="w-6 h-6 bg-purple-500 rounded-full"></div>
                <div className="h-0.5 flex-grow bg-gray-200"></div>
                <div className="w-6 h-6 bg-green-500 rounded-full flex items-center justify-center text-[8px] text-white"><i className="fas fa-check"></i></div>
            </div>
        ),
        tip: "Mẹo: Nút 'Tiếp theo' trên thẻ đơn sẽ tự nhảy sang bước kế tiếp."
    },
    {
        title: "6. Thao tác cử chỉ",
        icon: "fa-hand-pointer",
        color: "bg-teal-600",
        desc: "Nhấn giữ (Long-press) vào một đơn để bật chế độ chọn nhiều. Xử lý 100 đơn chỉ với vài lần chạm.",
        visual: (
            <div className="border-2 border-gray-900 rounded-xl p-2 bg-gray-50 flex flex-col gap-2">
                <div className="bg-eco-100 p-1 border border-eco-300 rounded flex justify-between items-center">
                    <div className="w-3 h-3 bg-eco-500 rounded-sm"></div>
                    <div className="w-20 h-2 bg-gray-300 rounded"></div>
                </div>
                <div className="bg-gray-900 text-white p-2 rounded-lg text-[8px] font-bold text-center">ĐÃ CHỌN 5 ĐƠN - IN PDF</div>
            </div>
        ),
        tip: "Mẹo: Rung nhẹ khi nhấn giữ báo hiệu bạn đã vào chế độ chọn nhiều."
    },
    {
        title: "7. Lập lộ trình tối ưu",
        icon: "fa-route",
        color: "bg-indigo-600",
        desc: "Bấm nút 'Lộ trình' để AI sắp xếp đơn theo khu vực: Eco Xuân -> Ehome 4 -> Vĩnh Phú 2 -> Marina.",
        visual: (
            <div className="relative h-24 bg-gray-100 rounded-xl border-2 border-gray-900 overflow-hidden">
                <div className="absolute left-4 top-4 w-4 h-4 bg-red-500 rounded-full border-2 border-white shadow-sm"></div>
                <div className="absolute right-6 top-8 w-4 h-4 bg-blue-500 rounded-full border-2 border-white shadow-sm"></div>
                <div className="absolute left-10 bottom-6 w-4 h-4 bg-purple-500 rounded-full border-2 border-white shadow-sm"></div>
                <svg className="absolute inset-0 w-full h-full opacity-30"><path d="M16 16 L120 32 L40 80" stroke="black" strokeWidth="2" fill="none" /></svg>
            </div>
        ),
        tip: "Mẹo: Dùng nút 'Copy cho Shipper' để gửi danh sách sạch đẹp qua Zalo."
    },
    {
        title: "8. Đối soát công nợ",
        icon: "fa-file-invoice-dollar",
        color: "bg-red-500",
        desc: "Sử dụng 'Smart-Paste' để dán tin nhắn ngân hàng. AI tự khớp mã đơn và gạch nợ tự động.",
        visual: (
            <div className="bg-black text-green-400 p-2 rounded-lg font-mono text-[8px] border-2 border-gray-700">
                &gt; Nhận: 150.000đ<br/>
                &gt; ND: DH ABC12345<br/>
                &gt; AI: Đã khớp đơn #ABC12345
            </div>
        ),
        tip: "Mẹo: Luôn in Tem có mã QR để khách quét, tiền về sẽ tự có mã đơn."
    },
    {
        title: "9. Chăm sóc khách hàng",
        icon: "fa-users-gear",
        color: "bg-cyan-600",
        desc: "Hệ thống tự gắn nhãn VIP, Thân thiết. Lưu địa chỉ và SĐT để tự điền cho lần mua sau.",
        visual: (
            <div className="flex gap-2">
                <div className="flex-1 bg-white border border-gray-200 p-2 rounded-lg flex flex-col items-center">
                    <div className="w-8 h-8 bg-eco-100 text-eco-600 rounded-full flex items-center justify-center text-xs">💎</div>
                    <span className="text-[7px] font-bold mt-1">KHÁCH VIP</span>
                </div>
                <div className="flex-1 bg-white border border-gray-200 p-2 rounded-lg flex flex-col items-center">
                    <div className="w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-xs">🌱</div>
                    <span className="text-[7px] font-bold mt-1">KHÁCH MỚI</span>
                </div>
            </div>
        ),
        tip: "Mẹo: Bấm nút Messenger để mở nhanh khung chat với khách trên Facebook."
    },
    {
        title: "10. In ấn chuyên nghiệp",
        icon: "fa-print",
        color: "bg-slate-700",
        desc: "Hỗ trợ in 8 tem/tờ A4 hoặc Bảng kê Manifest cho shipper ký nhận.",
        visual: (
            <div className="grid grid-cols-4 gap-1 p-2 bg-white border-2 border-gray-900 rounded-lg">
                {[1,2,3,4,5,6,7,8].map(i => <div key={i} className="aspect-[3/4] bg-gray-100 border border-gray-300 rounded-sm flex flex-col gap-1 p-0.5"><div className="h-1 bg-gray-400 w-full"></div><div className="h-3 bg-white w-full"></div></div>)}
            </div>
        ),
        tip: "Mẹo: In tem dán giúp shipper giao nhanh hơn và tránh nhầm hàng."
    },
    {
        title: "11. Cài đặt thương hiệu",
        icon: "fa-cog",
        color: "bg-gray-600",
        desc: "Tải Logo shop, cài đặt Ngân hàng nhận tiền và các thẻ ghi chú nhanh (Dễ vỡ, Giao hẻm...).",
        visual: (
            <div className="space-y-2">
                <div className="flex items-center gap-2 bg-white border p-1 rounded">
                    <div className="w-4 h-4 bg-gray-200 rounded"></div>
                    <div className="h-2 w-16 bg-gray-100 rounded"></div>
                </div>
                <div className="h-6 bg-blue-600 rounded-lg shadow-sm"></div>
            </div>
        ),
        tip: "Mẹo: Logo shop sẽ xuất hiện trên mọi hóa đơn PDF bạn gửi khách."
    },
    {
        title: "12. Đồng bộ & Offline",
        icon: "fa-cloud-arrow-up",
        color: "bg-sky-600",
        desc: "EcoGo hoạt động ngay cả khi mất mạng. Dữ liệu sẽ tự đồng bộ lên Cloud khi có 4G/Wifi trở lại.",
        visual: (
            <div className="flex items-center justify-center py-4">
                <div className="flex flex-col items-center">
                    <i className="fas fa-mobile-alt text-2xl text-gray-800"></i>
                    <div className="h-4 w-0.5 bg-gray-300 border-dashed border-l-2"></div>
                    <i className="fas fa-cloud text-blue-500 text-2xl"></i>
                </div>
            </div>
        ),
        tip: "Mẹo: Nếu thấy icon 'Offline' màu xám, đừng lo, đơn hàng của bạn vẫn được lưu an toàn."
    }
];

const UserGuideModal: React.FC<Props> = ({ isOpen, onClose }) => {
    const [currentStep, setCurrentStep] = useState(0);
    const [isDownloading, setIsDownloading] = useState(false);

    if (!isOpen) return null;

    const step = steps[currentStep];

    const handleDownloadPDF = async () => {
        setIsDownloading(true);
        const load = toast.loading("Đang soạn sách hướng dẫn 12 trang...");
        try {
            await pdfService.generateUserGuidePDF();
            toast.success("Đã tải cẩm nang vận hành!", { id: load });
        } catch (e) {
            toast.error("Lỗi tạo PDF.", { id: load });
        } finally {
            setIsDownloading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[200] bg-gray-900/80 backdrop-blur-md flex items-center justify-center p-2 sm:p-4 animate-fade-in">
            <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-xl overflow-hidden flex flex-col max-h-[95vh] border-4 border-gray-900">
                
                {/* Progress Bar */}
                <div className="flex h-1.5 bg-gray-100">
                    {steps.map((_, idx) => (
                        <div key={idx} className={`flex-1 transition-all duration-500 ${idx <= currentStep ? 'bg-eco-500' : 'bg-transparent'}`}></div>
                    ))}
                </div>

                <div className="p-4 flex justify-between items-center bg-gray-50 border-b-4 border-gray-900">
                    <div className="flex items-center gap-3">
                        <h2 className="font-black text-sm text-gray-900 uppercase italic tracking-widest leading-none">Chương {currentStep + 1} / {steps.length}</h2>
                        <button 
                            onClick={handleDownloadPDF}
                            disabled={isDownloading}
                            className="w-8 h-8 rounded-lg bg-blue-50 border-2 border-blue-200 text-blue-600 hover:bg-blue-600 hover:text-white flex items-center justify-center transition-all active:scale-90"
                            title="Tải sách HD 12 trang"
                        >
                            <i className={`fas ${isDownloading ? 'fa-circle-notch fa-spin' : 'fa-download'}`}></i>
                        </button>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 rounded-xl bg-white border-2 border-gray-900 text-gray-400 hover:text-red-500 flex items-center justify-center transition-all shadow-[2px_2px_0px_0px_rgba(0,0,0,1)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"><i className="fas fa-times"></i></button>
                </div>

                <div className="flex-grow overflow-y-auto p-6 sm:p-8 no-scrollbar bg-white">
                    <div className="flex flex-col items-center">
                        <div className={`w-16 h-16 ${step.color} text-white rounded-2xl flex items-center justify-center text-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] mb-6 border-2 border-gray-900`}>
                            <i className={`fas ${step.icon}`}></i>
                        </div>
                        
                        <h3 className="text-xl font-black text-gray-900 mb-4 uppercase italic tracking-tight text-center">{step.title}</h3>
                        
                        <p className="text-gray-600 font-bold text-sm leading-relaxed mb-6 text-center">
                            {step.desc}
                        </p>

                        <div className="w-full bg-gray-50 border-2 border-gray-200 p-6 rounded-[2rem] mb-6 shadow-inner">
                             {step.visual}
                        </div>

                        <div className="w-full bg-eco-50 border-2 border-eco-100 p-4 rounded-2xl">
                            <div className="flex items-center gap-2 mb-1">
                                <i className="fas fa-lightbulb text-eco-600 text-xs"></i>
                                <span className="text-[10px] font-black text-eco-700 uppercase tracking-widest">Bí kíp vận hành</span>
                            </div>
                            <p className="text-xs font-bold text-eco-800 italic">
                                {step.tip}
                            </p>
                        </div>
                    </div>
                </div>

                <div className="p-4 bg-white border-t-4 border-gray-900 flex gap-3">
                    {currentStep > 0 ? (
                        <button 
                            onClick={() => setCurrentStep(currentStep - 1)}
                            className="px-6 py-4 bg-white border-2 border-gray-900 text-gray-900 font-black rounded-2xl hover:bg-gray-100 transition-all uppercase text-xs shadow-[3px_3px_0px_0px_rgba(0,0,0,1)] active:translate-x-0.5 active:translate-y-0.5 active:shadow-none"
                        >
                            <i className="fas fa-arrow-left"></i>
                        </button>
                    ) : (
                        <div className="w-16"></div>
                    )}
                    
                    {currentStep < steps.length - 1 ? (
                        <button 
                            onClick={() => setCurrentStep(currentStep + 1)}
                            className="flex-grow py-4 bg-black text-white font-black rounded-2xl shadow-[4px_4px_0px_0px_rgba(34,197,94,1)] hover:bg-gray-800 transition-all active:translate-x-0.5 active:translate-y-0.5 active:shadow-none uppercase text-xs tracking-widest"
                        >
                            Tiếp theo <i className="fas fa-arrow-right ml-1"></i>
                        </button>
                    ) : (
                        <button 
                            onClick={onClose}
                            className="flex-grow py-4 bg-eco-600 text-white font-black rounded-2xl shadow-[4px_4px_0px_0px_rgba(0,0,0,1)] hover:bg-eco-700 transition-all active:translate-x-0.5 active:translate-y-0.5 active:shadow-none uppercase text-xs tracking-widest"
                        >
                            Bắt đầu làm việc! <i className="fas fa-rocket ml-1"></i>
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default UserGuideModal;
