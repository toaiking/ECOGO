
import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import { Order, PaymentMethod, OrderStatus, Product } from '../types';
import { storageService, normalizeString } from './storageService';

// --- VIETQR / EMVCO HELPER ---
const BANK_BIN_MAP: Record<string, string> = {
    'VCB': '970436', 'VIETCOMBANK': '970436',
    'TCB': '970407', 'TECHCOMBANK': '970407',
    'MB': '970422', 'MBBANK': '970422',
    'ACB': '970416',
    'VPB': '970432', 'VPBANK': '970432',
    'BIDV': '970418',
    'CTG': '970415', 'VIETINBANK': '970415',
    'STB': '970403', 'SACOMBANK': '970403',
    'TPB': '970423', 'TPBANK': '970423',
    'VIB': '970441',
    'MSB': '970426',
    'HDB': '970437', 'HDBANK': '970437',
    'OCB': '970448',
    'SHB': '970443',
    'LPB': '970449', 'LIENVIETPOSTBANK': '970449',
    'SEAB': '970440', 'SEABANK': '970440',
    'NAB': '970428', 'NAMABANK': '970428',
    'BAB': '970409', 'BACABANK': '970409',
    'ABB': '970425', 'ABBANK': '970425',
    'VCCB': '970454', 'VIETCAPITAL': '970454',
    'SCB': '970429',
    'EIB': '970431', 'EXIMBANK': '970431',
    'TIMO': '961023',
    'VIETMONEY': '970422', 
    'CAKE': '970432',
    'UOB': '970458',
    'CIMB': '422589'
};

const crc16 = (data: string): string => {
    let crc = 0xFFFF;
    for (let i = 0; i < data.length; i++) {
        crc ^= data.charCodeAt(i) << 8;
        for (let j = 0; j < 8; j++) {
            if ((crc & 0x8000) !== 0) {
                crc = ((crc << 1) ^ 0x1021) & 0xFFFF;
            } else {
                crc = (crc << 1) & 0xFFFF;
            }
        }
    }
    return (crc & 0xFFFF).toString(16).toUpperCase().padStart(4, '0');
};

const formatField = (id: string, value: string): string => {
    const len = value.length.toString().padStart(2, '0');
    return `${id}${len}${value}`;
};

const removeAccents = (str: string): string => {
    return str.normalize('NFD')
              .replace(/[\u0300-\u036f]/g, '')
              .replace(/đ/g, 'd').replace(/Đ/g, 'D')
              .replace(/[^a-zA-Z0-9 ]/g, ''); 
};

const generateVietQRPayload = (bankId: string, accountNo: string, amount: number, content: string): string => {
    const bin = BANK_BIN_MAP[bankId.toUpperCase()] || BANK_BIN_MAP['MB']; 
    const cleanContent = removeAccents(content).substring(0, 20); 
    
    const guid = formatField('00', 'A000000727');
    const beneficiaryBank = formatField('00', bin) + formatField('01', accountNo);
    const consumerInfo = formatField('01', beneficiaryBank);
    const serviceCode = formatField('02', 'QRIBFTTA');
    
    const tag38Value = guid + consumerInfo + serviceCode;

    let payload = '';
    payload += formatField('00', '01'); 
    payload += formatField('01', '12'); 
    payload += formatField('38', tag38Value); 
    payload += formatField('53', '704'); 
    payload += formatField('54', amount.toString()); 
    payload += formatField('58', 'VN'); 
    
    const additionalData = formatField('08', cleanContent);
    payload += formatField('62', additionalData);

    payload += '6304'; 
    const crc = crc16(payload);
    return payload + crc;
};

// --- FONT CACHING ---
let _fontCache: string | null = null;

const fetchFont = async (): Promise<string | null> => {
    if (_fontCache) return _fontCache;
    try {
        const response = await fetch('https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/fonts/Roboto/Roboto-Regular.ttf');
        if (!response.ok) throw new Error("Failed to load font");
        const blob = await response.blob();
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64data = reader.result as string;
                const content = base64data.split(',')[1];
                if (content) {
                    _fontCache = content;
                    resolve(content);
                } else {
                    resolve(null);
                }
            };
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        return null;
    }
};

const generateQRCode = async (text: string): Promise<string> => {
    try {
        return await QRCode.toDataURL(text, { width: 300, margin: 0, errorCorrectionLevel: 'M' });
    } catch (e) {
        return '';
    }
};

const drawDashedLine = (doc: jsPDF, x1: number, y1: number, x2: number, y2: number) => {
    doc.setLineDashPattern([2, 2], 0);
    doc.line(x1, y1, x2, y2);
    doc.setLineDashPattern([], 0); 
};

export const pdfService = {
    // --- CHỨC NĂNG TẠO SÁCH HƯỚNG DẪN 12 TRANG ---
    generateUserGuidePDF: async () => {
        const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
        const binaryFont = await fetchFont();
        let fontName = 'helvetica';
        if (binaryFont) {
            const fontFileName = 'Roboto.ttf';
            doc.addFileToVFS(fontFileName, binaryFont);
            doc.addFont(fontFileName, 'Roboto', 'normal');
            doc.addFont(fontFileName, 'Roboto', 'bold');
            doc.addFont(fontFileName, 'Roboto', 'italic');
            doc.setFont('Roboto');
            fontName = 'Roboto';
        }

        const margin = 20;
        const pageW = 210;
        const pageH = 297;
        const contentW = pageW - (margin * 2);
        let currentY = 0;

        // Helpers
        const addFooter = (page: number) => {
            doc.setFont(fontName, 'italic');
            doc.setFontSize(8);
            doc.setTextColor(150, 150, 150);
            doc.text(`Tài liệu hướng dẫn EcoGo v1.2 - Trang ${page}/12`, pageW/2, 285, { align: 'center' });
        };

        const drawMockupFrame = (x: number, y: number, w: number, h: number, title: string) => {
            // Vẽ khung điện thoại
            doc.setDrawColor(31, 41, 55);
            doc.setLineWidth(1);
            doc.roundedRect(x, y, w, h, 3, 3, 'S');
            // Vẽ màn hình
            doc.setFillColor(249, 250, 251);
            doc.rect(x + 2, y + 2, w - 4, h - 4, 'F');
            // Tiêu đề mockup
            doc.setFontSize(7);
            doc.setTextColor(100, 100, 100);
            doc.text(title, x + w/2, y - 2, { align: 'center' });
        };

        // --- TRANG 1: BÌA ---
        doc.setFillColor(21, 128, 61);
        doc.rect(0, 0, pageW, 120, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(36);
        doc.setFont(fontName, 'bold');
        doc.text("ECOGO LOGISTICS", pageW/2, 50, { align: 'center' });
        doc.setFontSize(14);
        doc.text("CẨM NANG VẬN HÀNH CHI TIẾT", pageW/2, 65, { align: 'center' });
        doc.setLineWidth(1);
        doc.setDrawColor(255, 255, 255);
        doc.line(80, 75, 130, 75);
        doc.setFontSize(10);
        doc.text("Phiên bản 1.2 - Phát hành 2024", pageW/2, 90, { align: 'center' });
        
        doc.setTextColor(50, 50, 50);
        currentY = 140;
        doc.setFontSize(16);
        doc.text("Nội dung chính:", margin, currentY);
        currentY += 10;
        const chapters = [
            "1. Cài đặt & Đăng nhập", "2. Tổng quan giao diện", "3. Quản lý kho hàng",
            "4. Quy trình tạo đơn AI", "5. Theo dõi & Trạng thái", "6. Thao tác cử chỉ",
            "7. Lộ trình Shipper", "8. Đối soát công nợ", "9. Quản lý khách hàng",
            "10. In ấn & Tem nhãn", "11. Cài đặt hệ thống", "12. Xử lý lỗi & FAQ"
        ];
        doc.setFontSize(11);
        chapters.forEach((c, i) => {
            doc.text(`${i+1}. ${c}`, margin + 5, currentY);
            currentY += 8;
        });
        addFooter(1);

        // --- TRANG 2: CÀI ĐẶT ---
        doc.addPage();
        currentY = 30;
        doc.setFontSize(18);
        doc.text("1. Cài đặt PWA & Đăng nhập", margin, currentY);
        currentY += 15;
        doc.setFontSize(11);
        doc.setFont(fontName, 'normal');
        doc.text("EcoGo là ứng dụng Web tiến tiến (PWA), không cần tải từ App Store.", margin, currentY);
        currentY += 10;
        doc.setFont(fontName, 'bold');
        doc.text("Các bước cài đặt trên iPhone (Safari):", margin, currentY);
        currentY += 8;
        doc.setFont(fontName, 'normal');
        const installSteps = [
            "1. Truy cập địa chỉ ứng dụng bằng Safari.",
            "2. Bấm vào biểu tượng 'Chia sẻ' (ô vuông có mũi tên lên).",
            "3. Cuộn xuống chọn 'Thêm vào màn hình chính' (Add to Home Screen).",
            "4. Bấm 'Thêm' ở góc phải."
        ];
        installSteps.forEach(s => { doc.text(s, margin + 5, currentY); currentY += 7; });
        
        // Minh họa PWA
        drawMockupFrame(margin + 100, 50, 40, 70, "iPhone Home Screen");
        doc.setFillColor(21, 128, 61);
        doc.roundedRect(margin + 105, 55, 8, 8, 2, 2, 'F'); // Icon app
        doc.setFontSize(6);
        doc.text("EcoGo", margin + 109, 65, { align: 'center' });
        addFooter(2);

        // --- TRANG 3: GIAO DIỆN ---
        doc.addPage();
        currentY = 30;
        doc.setFontSize(18);
        doc.text("2. Bản đồ giao diện chính", margin, currentY);
        currentY += 15;
        drawMockupFrame(margin, 50, 60, 100, "Cấu trúc màn hình");
        // Vẽ Navbar
        doc.setFillColor(31, 41, 55);
        doc.rect(margin + 2, 52, 56, 10, 'F');
        doc.setFontSize(5);
        doc.setTextColor(255, 255, 255);
        doc.text("NAVBAR", margin + 30, 58, { align: 'center' });
        // Vẽ Content
        doc.setFillColor(255, 255, 255);
        doc.rect(margin + 5, 65, 50, 60, 'F');
        doc.setTextColor(150, 150, 150);
        doc.text("NỘI DUNG", margin + 30, 95, { align: 'center' });
        // Vẽ Floating Button
        doc.setFillColor(34, 197, 94);
        doc.circle(margin + 50, 140, 5, 'F');
        doc.setTextColor(255, 255, 255);
        doc.text("⚡", margin + 50, 141, { align: 'center' });

        doc.setTextColor(50, 50, 50);
        doc.setFontSize(11);
        doc.text("Giải thích các khu vực:", margin + 70, 60);
        const navLabels = [
            "• Navbar: Chuyển đổi giữa các mục chính.",
            "• Nút Sét (⚡): Lối tắt mở nhanh Quét AI & Đối soát.",
            "• Chuông báo: Thông báo tiền về & hết hàng.",
            "• Màu trạng thái: Vàng (Chờ), Xanh (Xong), Tím (Giao)."
        ];
        currentY = 70;
        navLabels.forEach(l => { doc.text(l, margin + 70, currentY); currentY += 10; });
        addFooter(3);

        // --- TRANG 4: KHO HÀNG ---
        doc.addPage();
        currentY = 30;
        doc.setFontSize(18);
        doc.text("3. Quản lý kho & Lợi nhuận", margin, currentY);
        currentY += 15;
        doc.setFontSize(11);
        doc.text("Kho hàng là nơi lưu trữ Giá Vốn và Giá Bán để hệ thống tính lãi tự động.", margin, currentY);
        currentY += 10;
        doc.setFillColor(243, 244, 246);
        doc.roundedRect(margin, currentY, contentW, 40, 5, 5, 'F');
        doc.setFont(fontName, 'bold');
        doc.text("Bí kíp:", margin + 5, currentY + 10);
        doc.setFont(fontName, 'normal');
        doc.text("Hãy luôn nhập Giá Nhập (Import Price) chính xác. Hệ thống sẽ lấy con số", margin + 5, currentY + 20);
        doc.text("này tại thời điểm bán để chốt lợi nhuận cho từng đơn hàng.", margin + 5, currentY + 30);
        currentY += 50;
        doc.text("Các chỉ số cần lưu ý:", margin, currentY);
        currentY += 10;
        doc.text("- Tồn kho đỏ: Dưới 5 món (Cần nhập thêm).", margin + 5, currentY);
        currentY += 8;
        doc.text("- Vốn tồn: Tổng số tiền bạn đang 'kẹt' trong kho.", margin + 5, currentY);
        currentY += 8;
        doc.text("- Lịch sử xuất: Danh sách các đơn hàng đã lấy hàng này.", margin + 5, currentY);
        addFooter(4);

        // --- TRANG 5: TẠO ĐƠN AI ---
        doc.addPage();
        currentY = 30;
        doc.setFontSize(18);
        doc.text("4. Quy trình tạo đơn thông minh", margin, currentY);
        currentY += 15;
        doc.setFontSize(12);
        doc.setFont(fontName, 'bold');
        doc.text("Cách 1: Giọng nói (Voice AI)", margin, currentY);
        currentY += 8;
        doc.setFontSize(11);
        doc.setFont(fontName, 'normal');
        doc.text("Bấm giữ nút Micro, đọc: 'Chị Lan ở Vĩnh Phú 2 lấy 1 gạo 1 mắm'.", margin, currentY);
        currentY += 15;
        doc.setFontSize(12);
        doc.setFont(fontName, 'bold');
        doc.text("Cách 2: Smart-Paste (Copy tin nhắn)", margin, currentY);
        currentY += 8;
        doc.setFontSize(11);
        doc.setFont(fontName, 'normal');
        doc.text("Copy nội dung chat của khách, dán vào ô Ghi chú. AI sẽ hỏi tự điền.", margin, currentY);
        
        // Vẽ sơ đồ AI
        currentY += 20;
        doc.setDrawColor(200, 200, 200);
        doc.rect(margin, currentY, 40, 20);
        doc.text("Văn bản", margin + 20, currentY + 12, { align: 'center' });
        doc.line(margin + 40, currentY + 10, margin + 60, currentY + 10);
        doc.setFillColor(232, 240, 254);
        doc.circle(margin + 75, currentY + 10, 15, 'F');
        doc.text("AI GEMINI", margin + 75, currentY + 12, { align: 'center' });
        doc.line(margin + 90, currentY + 10, margin + 110, currentY + 10);
        doc.rect(margin + 110, currentY, 40, 20);
        doc.text("Đơn hàng", margin + 130, currentY + 12, { align: 'center' });
        addFooter(5);

        // --- TRANG 6: THEO DÕI ---
        doc.addPage();
        currentY = 30;
        doc.setFontSize(18);
        doc.text("5. Theo dõi & Quản lý trạng thái", margin, currentY);
        currentY += 15;
        doc.setFontSize(11);
        doc.text("Mỗi đơn hàng có 5 bước tiến độ. Hãy cập nhật để shipper biết việc:", margin, currentY);
        currentY += 15;
        const workflow = ["Chờ xử lý", "Đã lấy hàng", "Đang giao", "Hoàn tất"];
        workflow.forEach((step, i) => {
            doc.setFillColor(i === 3 ? 34 : 59, i === 3 ? 197 : 130, i === 3 ? 94 : 246);
            doc.rect(margin, currentY, 40, 10, 'F');
            doc.setTextColor(255, 255, 255);
            doc.text(step, margin + 20, currentY + 7, { align: 'center' });
            if (i < 3) {
                doc.setTextColor(200, 200, 200);
                doc.text("▼", margin + 20, currentY + 15, { align: 'center' });
            }
            currentY += 20;
        });
        doc.setTextColor(50, 50, 50);
        doc.text("Lưu ý: Bấm nút 'TIẾP THEO' là cách nhanh nhất để chuyển trạng thái.", margin + 60, 60);
        addFooter(6);

        // --- TRANG 7: CỬ CHỈ ---
        doc.addPage();
        currentY = 30;
        doc.setFontSize(18);
        doc.text("6. Thao tác cử chỉ & Chọn hàng loạt", margin, currentY);
        currentY += 15;
        doc.setFontSize(11);
        doc.text("Để xử lý 100 đơn hàng nhanh, hãy dùng các cử chỉ sau:", margin, currentY);
        currentY += 15;
        doc.setFont(fontName, 'bold');
        doc.text("1. Nhấn giữ (Long-press):", margin, currentY);
        doc.setFont(fontName, 'normal');
        doc.text("Để bật chế độ chọn nhiều đơn. Sau đó tích vào các đơn cần xử lý.", margin + 5, currentY + 7);
        currentY += 20;
        doc.setFont(fontName, 'bold');
        doc.text("2. Thanh công cụ nổi:", margin, currentY);
        doc.setFont(fontName, 'normal');
        doc.text("Khi chọn nhiều đơn, thanh đen dưới cùng sẽ hiện ra. Bạn có thể:", margin + 5, currentY + 7);
        doc.text("- In hàng loạt 50 đơn cùng lúc.", margin + 10, currentY + 14);
        doc.text("- Đổi trạng thái 50 đơn sang 'Đang giao' chỉ với 1 chạm.", margin + 10, currentY + 21);
        addFooter(7);

        // --- TRANG 8: LỘ TRÌNH ---
        doc.addPage();
        currentY = 30;
        doc.setFontSize(18);
        doc.text("7. Lập lộ trình Shipper", margin, currentY);
        currentY += 15;
        doc.text("Hệ thống tự động gom đơn theo khu vực địa lý:", margin, currentY);
        currentY += 15;
        const zones = ["1. Eco Xuân", "2. Ehome 4 (C1->B4)", "3. Nhà phố Ehome", "4. Vĩnh Phú 2"];
        zones.forEach(z => {
            doc.setDrawColor(200, 200, 200);
            doc.rect(margin, currentY, 80, 10);
            doc.text(z, margin + 5, currentY + 7);
            currentY += 12;
        });
        currentY += 10;
        doc.text("Nút 'LỘ TRÌNH' sẽ sắp xếp đơn theo thứ tự trên. Shipper chỉ cần đi", margin, currentY);
        doc.text("một vòng vòng duy nhất để tiết kiệm xăng và thời gian.", margin, currentY + 7);
        addFooter(8);

        // --- TRANG 9: ĐỐI SOÁT ---
        doc.addPage();
        currentY = 30;
        doc.setFontSize(18);
        doc.text("8. Đối soát tiền & VietQR", margin, currentY);
        currentY += 15;
        doc.text("Ngăn chặn thất thoát tiền chuyển khoản:", margin, currentY);
        currentY += 15;
        doc.setFont(fontName, 'bold');
        doc.text("Mã QR động:", margin, currentY);
        doc.setFont(fontName, 'normal');
        doc.text("Mỗi đơn có mã QR riêng. Khách quét sẽ hiện sẵn số tiền và mã đơn.", margin + 5, currentY + 7);
        currentY += 20;
        doc.setFont(fontName, 'bold');
        doc.text("Smart-Paste (AI Scanning):", margin, currentY);
        doc.setFont(fontName, 'normal');
        doc.text("Dán tin nhắn biến động số dư ngân hàng vào mục Đối Soát. AI sẽ tự", margin + 5, currentY + 7);
        doc.text("tìm mã đơn hàng khớp với nội dung đó để đánh dấu 'Đã nhận tiền'.", margin + 5, currentY + 14);
        addFooter(9);

        // --- TRANG 10: KHÁCH HÀNG ---
        doc.addPage();
        currentY = 30;
        doc.setFontSize(18);
        doc.text("9. Quản lý khách hàng (CRM)", margin, currentY);
        currentY += 15;
        doc.text("Hệ thống tự nhận diện thứ hạng khách hàng:", margin, currentY);
        currentY += 15;
        doc.text("🌱 Khách mới: Dưới 2 đơn.", margin, currentY);
        currentY += 8;
        doc.text("🌟 Khách thân thiết: Trên 5 đơn.", margin, currentY);
        currentY += 8;
        doc.text("💎 VIP: Trên 20 đơn (Có hiệu ứng nhấp nháy).", margin, currentY);
        currentY += 15;
        doc.text("Mẹo: Bấm vào icon Zalo trên thẻ khách để nhắn tin nhắc nợ hoặc", margin, currentY);
        doc.text("gửi phiếu nợ QR chuyên nghiệp chỉ trong 2 giây.", margin, currentY + 7);
        addFooter(10);

        // --- TRANG 11: IN ẤN ---
        doc.addPage();
        currentY = 30;
        doc.setFontSize(18);
        doc.text("10. In ấn & Tem nhãn", margin, currentY);
        currentY += 15;
        doc.text("EcoGo hỗ trợ 2 kiểu in chuẩn:", margin, currentY);
        currentY += 15;
        doc.setFont(fontName, 'bold');
        doc.text("1. In Tem Hóa Đơn (8 tem/A4):", margin, currentY);
        doc.setFont(fontName, 'normal');
        doc.text("Dùng để dán lên gói hàng. Mỗi tem có sẵn mã QR của khách đó.", margin + 5, currentY + 7);
        currentY += 20;
        doc.setFont(fontName, 'bold');
        doc.text("2. In Bảng Kê (Manifest):", margin, currentY);
        doc.setFont(fontName, 'normal');
        doc.text("Dạng danh sách bảng biểu để shipper ký nhận tiền sau khi đi giao về.", margin + 5, currentY + 7);
        addFooter(11);

        // --- TRANG 12: CÀI ĐẶT & FAQ ---
        doc.addPage();
        currentY = 30;
        doc.setFontSize(18);
        doc.text("11. Cấu hình & Xử lý lỗi", margin, currentY);
        currentY += 15;
        doc.text("Lỗi hay gặp:", margin, currentY);
        currentY += 10;
        doc.setFont(fontName, 'bold');
        doc.text("- Lỗi 'Resource Exhausted':", margin, currentY);
        doc.setFont(fontName, 'normal');
        doc.text("Hết băng thông Cloud trong ngày. App tự chuyển sang lưu trên máy.", margin + 5, currentY + 7);
        currentY += 20;
        doc.setFont(fontName, 'bold');
        doc.text("- AI không hiểu giọng nói:", margin, currentY);
        doc.setFont(fontName, 'normal');
        doc.text("Hãy đọc chậm, rõ tên sản phẩm giống như tên bạn đặt trong kho.", margin + 5, currentY + 7);
        
        currentY += 30;
        doc.setFontSize(14);
        doc.setFont(fontName, 'bold');
        doc.setTextColor(21, 128, 61);
        doc.text("CHÚC BẠN KINH DOANH THÀNH CÔNG!", pageW/2, currentY, { align: 'center' });
        addFooter(12);

        doc.save("Huong_Dan_Su_Dung_EcoGo_V1.pdf");
    },

    // --- CÁC PHƯƠNG THỨC IN ĐÃ CÓ ---
    generateCompactList: async (orders: Order[], batchId: string) => {
        const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
        const binaryFont = await fetchFont();
        let fontName = 'helvetica';
        if (binaryFont) {
            const fontFileName = 'Roboto.ttf';
            doc.addFileToVFS(fontFileName, binaryFont);
            doc.addFont(fontFileName, 'Roboto', 'normal');
            doc.addFont(fontFileName, 'Roboto', 'bold');
            doc.setFont('Roboto');
            fontName = 'Roboto';
        }

        const pageW = 210;
        const pageH = 297;
        const margin = 5; 
        const headerH = 12; 
        const tableW = pageW - (margin * 2);
        
        const wIdx = 8;
        const wCust = 42; 
        const wAddr = 65;
        const wItem = 45;
        const wNote = 15; 
        const wPrice = 25; 

        const xIdx = margin;
        const xCust = xIdx + wIdx;
        const xAddr = xCust + wCust;
        const xItem = xAddr + wAddr;
        const xNote = xItem + wItem;
        const xPrice = xNote + wNote;

        let currentY = headerH + 5;
        const fontSize = 7; 
        const rowPadding = 1; 
        const lineHeight = 3; 

        let totalAmount = 0;
        const itemSummary: Record<string, number> = {};
        const validOrders = orders.filter(o => o.status !== OrderStatus.CANCELLED);
        validOrders.forEach(o => {
            totalAmount += o.totalPrice;
            o.items.forEach(item => {
                const name = item.name.trim();
                if(name) itemSummary[name] = (itemSummary[name] || 0) + item.quantity;
            });
        });

        const drawPageHeader = (pageNo: number) => {
            doc.setFillColor(255, 255, 255);
            doc.rect(0, 0, pageW, headerH, 'F');
            doc.setFontSize(10);
            doc.setFont(fontName, 'bold');
            doc.setTextColor(0, 0, 0);
            doc.text(`${batchId} (${new Date().toLocaleDateString('vi-VN')}) - Tổng: ${validOrders.length} đơn`, margin, 8);
            doc.setFontSize(8);
            doc.setFont(fontName, 'normal');
            doc.text(`Trang ${pageNo}`, pageW - margin, 8, { align: 'right' });
            const hY = 10;
            const hHeight = 5;
            doc.setFillColor(0, 0, 0); 
            doc.rect(margin, hY, tableW, hHeight, 'F');
            doc.setTextColor(255, 255, 255); 
            doc.setFontSize(7);
            doc.setFont(fontName, 'bold');
            doc.setDrawColor(255, 255, 255);
            doc.setLineWidth(0.2);
            doc.line(xCust, hY, xCust, hY + hHeight);
            doc.line(xAddr, hY, xAddr, hY + hHeight);
            doc.line(xItem, hY, xItem, hY + hHeight);
            doc.line(xNote, hY, xNote, hY + hHeight);
            doc.line(xPrice, hY, xPrice, hY + hHeight);
            const ty = hY + 3.5;
            doc.text("STT", xIdx + 1, ty);
            doc.text("KHÁCH - SĐT", xCust + 1, ty);
            doc.text("ĐỊA CHỈ", xAddr + 1, ty);
            doc.text("HÀNG HÓA (SL)", xItem + 1, ty);
            doc.text("GHI CHÚ", xNote + 1, ty);
            doc.text("TỔNG TIỀN", xPrice + wPrice - 1, ty, { align: 'right' });
            doc.setTextColor(0, 0, 0); 
            return hY + hHeight;
        };

        let pageIndex = 1;
        currentY = drawPageHeader(pageIndex); 

        for (let i = 0; i < validOrders.length; i++) {
            const o = validOrders[i];
            doc.setFontSize(fontSize);
            doc.setFont(fontName, 'bold');
            const custText = `${o.customerName} - ${o.customerPhone}`;
            const custLines = doc.splitTextToSize(custText, wCust - 1.5);
            const addrLines = doc.splitTextToSize(o.address, wAddr - 1.5);
            doc.setFont(fontName, 'normal');
            const itemsStr = o.items.map(it => `${it.name} (x:${it.quantity})`).join(', ');
            const itemsLines = doc.splitTextToSize(itemsStr, wItem - 1.5);
            doc.setFont(fontName, 'italic');
            const noteLines = doc.splitTextToSize(o.notes || '', wNote - 1.5);
            doc.setFont(fontName, 'bold');
            let priceText = new Intl.NumberFormat('vi-VN').format(o.totalPrice);
            
            // Only show payment status if completed (DELIVERED/CANCELLED) to match OrderCard behavior
            if (o.status === OrderStatus.DELIVERED || o.status === OrderStatus.CANCELLED) {
                if (o.paymentMethod === PaymentMethod.PAID) priceText += " (Đã TT)";
                else if (o.paymentMethod === PaymentMethod.TRANSFER) priceText += o.paymentVerified ? " (CK Rồi)" : " (CK)";
                else if (o.paymentMethod === PaymentMethod.CASH) priceText += " (TM)"; 
            }
            const priceLines = doc.splitTextToSize(priceText, wPrice - 1.5);

            const maxLines = Math.max(custLines.length, addrLines.length, itemsLines.length, noteLines.length, priceLines.length, 1);
            const rowHeight = (maxLines * lineHeight) + (rowPadding * 2);

            if (currentY + rowHeight > pageH - 10) {
                doc.addPage();
                pageIndex++;
                currentY = drawPageHeader(pageIndex);
            }

            const textY = currentY + rowPadding + 2; 
            doc.setDrawColor(0, 0, 0);
            doc.setLineWidth(0.1);
            doc.rect(margin, currentY, tableW, rowHeight); 
            doc.line(xCust, currentY, xCust, currentY + rowHeight);
            doc.line(xAddr, currentY, xAddr, currentY + rowHeight);
            doc.line(xItem, currentY, xItem, currentY + rowHeight);
            doc.line(xNote, currentY, xNote, currentY + rowHeight);
            doc.line(xPrice, currentY, xPrice, currentY + rowHeight);
            doc.setFont(fontName, 'bold');
            doc.text(`${i + 1}`, xIdx + (wIdx/2), textY, { align: 'center' });
            doc.text(custLines, xCust + 1, textY);
            doc.text(addrLines, xAddr + 1, textY);
            doc.setFont(fontName, 'normal');
            doc.text(itemsLines, xItem + 1, textY);
            doc.setFont(fontName, 'italic');
            doc.text(noteLines, xNote + 1, textY);
            doc.setFont(fontName, 'bold');
            doc.text(priceLines, xPrice + wPrice - 1, textY, { align: 'right' });
            currentY += rowHeight;
        }

        if (pageH - currentY < 30) { doc.addPage(); currentY = 15; } else { currentY += 2; }
        doc.setDrawColor(0, 0, 0);
        doc.setLineWidth(0.3);
        doc.line(margin, currentY, margin + tableW, currentY);
        currentY += 5;
        doc.setFontSize(9);
        doc.setFont(fontName, 'bold');
        doc.text(`TỔNG CỘNG (${validOrders.length} đơn): ${new Intl.NumberFormat('vi-VN').format(totalAmount)}đ`, margin, currentY);
        currentY += 5;
        doc.setFontSize(7);
        doc.setFont(fontName, 'normal');
        let products: Product[] = [];
        try { products = JSON.parse(localStorage.getItem('ecogo_products_v1') || '[]'); } catch {}
        const summaryParts = Object.entries(itemSummary).sort((a,b) => a[0].localeCompare(b[0])).map(([name, qtyOrdered]) => {
            const normName = normalizeString(name);
            const p = products.find(p => normalizeString(p.name) === normName) || products.find(p => normalizeString(p.name).includes(normName));
            return p ? `${name}: ${qtyOrdered} [Tồn: ${p.stockQuantity || 0}]` : `${name}: ${qtyOrdered}`;
        });
        const summaryText = "TỔNG HÀNG (Đặt | Tồn):  " + summaryParts.join('   ');
        const sumLines = doc.splitTextToSize(summaryText, tableW);
        doc.text(sumLines, margin, currentY);
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        doc.save(`DS_${batchId}_${dateStr}.pdf`);
    },

    generateInvoiceBatch: async (orders: Order[], batchId: string) => {
        const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
        const binaryFont = await fetchFont();
        let fontName = 'helvetica';
        if (binaryFont) {
            const fontFileName = 'Roboto.ttf';
            doc.addFileToVFS(fontFileName, binaryFont);
            doc.addFont(fontFileName, 'Roboto', 'normal');
            doc.addFont(fontFileName, 'Roboto', 'bold');
            doc.setFont('Roboto');
            fontName = 'Roboto';
        }
        const bankConfig = await storageService.getBankConfig();
        const shopConfig = await storageService.getShopConfig();
        const currentUser = storageService.getCurrentUser() || 'Admin';
        const APP_NAME = (shopConfig?.shopName || "ECOGO LOGISTICS").toUpperCase(); 
        const HOTLINE = shopConfig?.hotline ? `Hotline: ${shopConfig.hotline}` : `User: ${currentUser}`;
        const pageWidth = 210;
        const pageHeight = 297;
        const cols = 2;
        const rows = 4;
        const cellWidth = pageWidth / cols; 
        const cellHeight = pageHeight / rows; 
        const padding = 6; 
        for (let i = 0; i < orders.length; i++) {
            const order = orders[i];
            if (i > 0 && i % 8 === 0) doc.addPage();
            const posInPage = i % 8;
            const colIndex = posInPage % 2;
            const rowIndex = Math.floor(posInPage / 2);
            const x = colIndex * cellWidth;
            const y = rowIndex * cellHeight;
            doc.setDrawColor(150, 150, 150);
            doc.setLineWidth(0.1);
            if (colIndex === 0) drawDashedLine(doc, x + cellWidth, y + 2, x + cellWidth, y + cellHeight - 2); 
            if (rowIndex < rows - 1) drawDashedLine(doc, x + 2, y + cellHeight, x + (cellWidth*2) - 2, y + cellHeight);
            const wx = x + padding;
            const wy = y + padding;
            const wWidth = cellWidth - (padding * 2);
            const headerH = 10;
            doc.setFillColor(0, 0, 0); 
            doc.rect(wx, wy, wWidth, headerH, 'F'); 
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(11);
            doc.setFont(fontName, 'bold');
            doc.text(APP_NAME, wx + 2, wy + 6.5);
            doc.setFontSize(8);
            doc.setFont(fontName, 'normal');
            doc.text(HOTLINE, wx + wWidth - 2, wy + 6.5, { align: 'right' });
            doc.setTextColor(0, 0, 0); 
            doc.setFontSize(16);
            doc.setFont(fontName, 'bold');
            doc.setTextColor(200, 200, 200); 
            doc.text(`#${(i + 1).toString().padStart(2, '0')}`, wx + wWidth - 2, wy + headerH + 7, { align: 'right' });
            doc.setTextColor(0, 0, 0); 
            let cy = wy + headerH + 5;
            doc.setFontSize(12);
            doc.setFont(fontName, 'bold');
            doc.text(`#${order.id}`, wx, cy);
            doc.setFontSize(8);
            doc.setFont(fontName, 'normal');
            doc.text(new Date(order.createdAt).toLocaleDateString('vi-VN'), wx, cy + 4);
            cy += 8;
            doc.setFontSize(9);
            doc.setFont(fontName, 'bold');
            doc.text(order.customerName.toUpperCase(), wx, cy);
            doc.setFont(fontName, 'normal');
            doc.text(order.customerPhone, wx + wWidth - 20, cy, { align: 'right' });
            cy += 4;
            doc.setFontSize(8);
            const addr = order.address.length > 55 ? order.address.substring(0, 52) + "..." : order.address;
            doc.text(`ĐC: ${addr}`, wx, cy);
            cy += 2;
            doc.setDrawColor(0, 0, 0);
            doc.setLineWidth(0.2);
            doc.line(wx, cy, wx + wWidth, cy);
            cy += 4;
            const MAX_ITEMS = 3; 
            const itemsToShow = order.items.slice(0, MAX_ITEMS);
            itemsToShow.forEach(item => {
                const name = item.name.length > 35 ? item.name.substring(0, 32) + ".." : item.name;
                doc.text(name, wx, cy);
                doc.setFont(fontName, 'bold');
                doc.text(`x${item.quantity}`, wx + wWidth, cy, { align: 'right' });
                doc.setFont(fontName, 'normal');
                cy += 4;
            });
            if (order.items.length > MAX_ITEMS) doc.text(`... (+${order.items.length - MAX_ITEMS} sp khác)`, wx, cy);
            if (order.notes) { cy += 2; doc.setFontSize(7); doc.text(`Ghi chú: ${order.notes}`, wx, cy); }
            const footerY = wy + cellHeight - (padding * 2); 
            const qrSize = 14;
            const qrY = footerY - qrSize;
            if (bankConfig && bankConfig.accountNo && order.paymentMethod !== PaymentMethod.PAID) {
                const qrString = generateVietQRPayload(bankConfig.bankId, bankConfig.accountNo, order.totalPrice, `DH ${order.id}`);
                const qrBase64 = await generateQRCode(qrString);
                if (qrBase64) {
                    doc.addImage(qrBase64, 'PNG', wx, qrY, qrSize, qrSize);
                    const arrowX = wx + qrSize + 1;
                    const arrowY = qrY + (qrSize / 2);
                    doc.setFontSize(7);
                    doc.setFont(fontName, 'bold');
                    doc.text("QUÉT MÃ ĐỂ", arrowX + 5, arrowY - 1);
                    doc.text("THANH TOÁN", arrowX + 5, arrowY + 2);
                    doc.setDrawColor(0, 0, 0);
                    doc.setLineWidth(0.3);
                    doc.line(arrowX + 4, arrowY, arrowX, arrowY); 
                    doc.line(arrowX + 1.5, arrowY - 1.5, arrowX, arrowY); 
                    doc.line(arrowX + 1.5, arrowY + 1.5, arrowX, arrowY); 
                }
            } else if (order.paymentMethod === PaymentMethod.PAID) {
                doc.setDrawColor(0, 0, 0); doc.setLineWidth(0.5); doc.rect(wx, qrY + 4, 25, 8);
                doc.setFontSize(10); doc.setFont(fontName, 'bold'); doc.text("ĐÃ TT", wx + 12.5, qrY + 9, { align: 'center' });
            }
            doc.setFontSize(16);
            doc.setFont(fontName, 'bold');
            doc.text(`${new Intl.NumberFormat('vi-VN').format(order.totalPrice)}đ`, wx + wWidth, footerY - 6, { align: 'right' });
            doc.setFontSize(8);
            doc.setFont(fontName, 'normal');
            doc.text("TỔNG THANH TOÁN", wx + wWidth, footerY - 13, { align: 'right' });
        }
        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        doc.save(`HoaDonBW_${batchId}_${dateStr}.pdf`);
    }
};
