
import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import { Order, PaymentMethod, OrderStatus, Product } from '../types';
import { storageService, normalizeString } from './storageService';

// --- FONT CACHING & LOADING ---
const fontCache: Record<string, string> = {};

const loadFonts = async (doc: jsPDF) => {
    const fonts = [
        { url: 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/fonts/Roboto/Roboto-Regular.ttf', name: 'Roboto-Regular.ttf', style: 'normal' },
        { url: 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/fonts/Roboto/Roboto-Medium.ttf', name: 'Roboto-Medium.ttf', style: 'bold' },
        { url: 'https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/fonts/Roboto/Roboto-Italic.ttf', name: 'Roboto-Italic.ttf', style: 'italic' }
    ];

    for (const f of fonts) {
        if (!fontCache[f.name]) {
            try {
                const resp = await fetch(f.url);
                const blob = await resp.blob();
                const reader = new FileReader();
                await new Promise((resolve) => {
                    reader.onloadend = () => {
                        const res = reader.result as string;
                        fontCache[f.name] = res.split(',')[1];
                        resolve(true);
                    };
                    reader.readAsDataURL(blob);
                });
            } catch (e) { console.error('Font load error', e); }
        }
        if (fontCache[f.name]) {
            doc.addFileToVFS(f.name, fontCache[f.name]);
            doc.addFont(f.name, 'Roboto', f.style);
        }
    }
    doc.setFont('Roboto', 'normal');
};

// --- HELPER GRAPHICS ---
const drawArrow = (doc: jsPDF, x: number, y: number) => {
    // Vẽ mũi tên chỉ sang phải (Vector) - hướng vào QR code bên phải
    doc.setFillColor(0, 0, 0); 
    
    // Đầu mũi tên (Tam giác)
    doc.triangle(x, y - 2, x, y + 2, x + 3, y, 'F');
    
    // Thân mũi tên (Hình chữ nhật)
    doc.rect(x - 6, y - 1, 6, 2, 'F');
};

const generateQRCode = async (text: string): Promise<string> => {
    try {
        return await QRCode.toDataURL(text, { width: 400, margin: 0, errorCorrectionLevel: 'M' });
    } catch (e) {
        return '';
    }
};

const getPaymentQR = async (order: Order): Promise<string | null> => {
    try {
        const bankConfig = await storageService.getBankConfig();
        // Nếu chưa cài đặt ngân hàng, trả về null để dùng fallback QR nội bộ
        if (!bankConfig || !bankConfig.accountNo || !bankConfig.bankId) return null;

        // XỬ LÝ TÊN KHÁCH KHÔNG DẤU CHO DỄ ĐỐI SOÁT
        // 1. Loại bỏ dấu và chuyển in hoa
        let cleanName = normalizeString(order.customerName).toUpperCase();
        // 2. Chỉ giữ lại ký tự chữ số và khoảng trắng (an toàn cho ngân hàng)
        cleanName = cleanName.replace(/[^A-Z0-9 ]/g, '');
        // 3. Cắt ngắn tên nếu quá dài để đảm bảo toàn bộ nội dung < 50 ký tự (giới hạn an toàn của nhiều app)
        // "DH " (3) + ID (8) + " " (1) = 12 chars. Dư khoảng 30-38 chars cho tên.
        if (cleanName.length > 25) {
            cleanName = cleanName.substring(0, 25).trim();
        }

        const desc = `DH ${order.id} ${cleanName}`;
        
        // Sử dụng template 'qr_only' để lấy mã QR ma trận thuần túy
        const url = `https://img.vietqr.io/image/${bankConfig.bankId}-${bankConfig.accountNo}-qr_only.png?amount=${order.totalPrice}&addInfo=${encodeURIComponent(desc)}`;
        
        const response = await fetch(url);
        if (!response.ok) return null;
        
        const blob = await response.blob();
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.error("Error fetching VietQR:", e);
        return null;
    }
};

export const pdfService = {
    generateUserGuidePDF: async () => {
        const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
        await loadFonts(doc);

        const margin = 20;
        const pageW = 210;
        const contentW = pageW - (margin * 2);
        
        doc.setFontSize(24);
        doc.setFont('Roboto', 'bold');
        doc.text("CẨM NANG VẬN HÀNH ECOGO", pageW / 2, 40, { align: 'center' });
        
        doc.setFontSize(12);
        doc.setFont('Roboto', 'normal');
        const intro = "Tài liệu hướng dẫn sử dụng nhanh các chức năng chính của hệ thống quản lý đơn hàng.";
        const lines = doc.splitTextToSize(intro, contentW);
        doc.text(lines, margin, 60);

        doc.save('EcoGo_Guide.pdf');
    },

    // --- CHỨC NĂNG IN TEM 8 TEM/A4 (GIAO DIỆN V4 - Layout Mới: QR Phải) ---
    generateInvoiceBatch: async (orders: Order[], batchName: string) => {
        const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
        await loadFonts(doc);

        const shopConfig = await storageService.getShopConfig();
        const shopName = (shopConfig?.shopName || 'ECOGO STORE').toUpperCase();
        const hotline = shopConfig?.hotline || '';

        const labelW = 105; // 210 / 2 = 105mm (width)
        const labelH = 74;  // 297 / 4 = 74.25mm (height)
        
        const startX = 0;
        const startY = 0;
        
        let col = 0;
        let row = 0;

        for (let i = 0; i < orders.length; i++) {
            const order = orders[i];
            
            // Tọa độ gốc của Tem hiện tại
            const x = startX + (col * labelW);
            const y = startY + (row * labelH);

            // Padding nội dung bên trong tem
            const pX = x + 4; 
            const pY = y + 4;
            const contentW = labelW - 8;
            const contentH = labelH - 8;

            // 1. VIỀN TEM (Nét đứt mờ để hướng dẫn cắt)
            doc.setDrawColor(180);
            doc.setLineWidth(0.1);
            doc.setLineDashPattern([2, 2], 0);
            doc.rect(x, y, labelW, labelH); 
            doc.setLineDashPattern([], 0);

            // ---------------------------------------------------------
            // 2. HEADER SECTION
            // ---------------------------------------------------------
            
            // Dòng 1: Tên Shop (Trái) & Mã Đơn (Phải)
            doc.setTextColor(0, 0, 0);
            doc.setFontSize(10);
            doc.setFont('Roboto', 'bold');
            doc.text(shopName, pX, pY + 4); 
            
            doc.setFontSize(14);
            doc.text(`#${order.id}`, pX + contentW, pY + 4, { align: 'right' });

            // Dòng 2: Hotline/Ngày (Trái) & Số thứ tự (Phải)
            doc.setFontSize(8);
            doc.setFont('Roboto', 'normal');
            const dateStr = new Date(order.createdAt).toLocaleDateString('vi-VN');
            const metaInfo = hotline ? `Hotline: ${hotline}  |  ${dateStr}` : `Ngày: ${dateStr}`;
            doc.text(metaInfo, pX, pY + 8); 

            doc.setFont('Roboto', 'bold');
            doc.text(`[${i + 1}/${orders.length}]`, pX + contentW, pY + 8, { align: 'right' });

            // Đường kẻ phân cách Header
            doc.setDrawColor(0);
            doc.setLineWidth(0.4);
            doc.line(pX, pY + 11, pX + contentW, pY + 11);

            // ---------------------------------------------------------
            // 3. BODY SECTION (Thông tin khách hàng)
            // ---------------------------------------------------------
            let cursorY = pY + 18;
            
            // Tên khách hàng (TO, IN HOA, ĐẬM)
            doc.setFontSize(11); 
            doc.setFont('Roboto', 'bold'); 
            doc.text(order.customerName.toUpperCase(), pX, cursorY);
            
            // Số điện thoại
            const nameWidth = doc.getTextWidth(order.customerName.toUpperCase());
            if (nameWidth < (contentW / 2)) {
                 doc.text(` - ${order.customerPhone}`, pX + nameWidth, cursorY);
                 cursorY += 6;
            } else {
                 cursorY += 5;
                 doc.text(order.customerPhone, pX, cursorY);
                 cursorY += 6;
            }

            // Địa chỉ
            doc.setFontSize(10);
            doc.setFont('Roboto', 'bold'); 
            const addrLines = doc.splitTextToSize(order.address, contentW);
            const displayAddr = addrLines.length > 3 ? addrLines.slice(0, 3) : addrLines;
            if (addrLines.length > 3) displayAddr[2] += '...';
            doc.text(displayAddr, pX, cursorY);
            
            cursorY += (displayAddr.length * 5) + 3;

            // Đường kẻ phân cách mỏng
            doc.setLineWidth(0.1);
            doc.setDrawColor(200);
            doc.line(pX, cursorY, pX + contentW, cursorY);
            cursorY += 4;

            // 4. ITEMS LIST (Hàng hóa)
            doc.setFontSize(9);
            doc.setFont('Roboto', 'normal');
            doc.setTextColor(0, 0, 0); 
            
            const itemsStr = order.items.map(it => `${it.name} [x${it.quantity}]`).join(', ');
            const itemLines = doc.splitTextToSize(itemsStr, contentW);
            const displayItems = itemLines.length > 4 ? itemLines.slice(0, 4) : itemLines;
            if (itemLines.length > 4) displayItems[3] += '...';
            
            doc.text(displayItems, pX, cursorY);
            
            // Ghi chú (nếu có)
            if (order.notes) {
                 cursorY += (displayItems.length * 4) + 2;
                 doc.setFont('Roboto', 'italic');
                 doc.setFontSize(8);
                 doc.text(`Ghi chú: ${order.notes}`, pX, cursorY);
            }

            // ---------------------------------------------------------
            // 5. FOOTER SECTION (NEW LAYOUT: PRICE LEFT, QR RIGHT)
            // ---------------------------------------------------------
            const footerY = pY + contentH - 2;
            const qrSize = 21; // Increased size for better scanning
            const qrX = pX + contentW - qrSize;
            const qrY = footerY - qrSize + 2;

            // A. QR Code (Bên Phải)
            try {
                let qrData = await getPaymentQR(order);
                if (!qrData) {
                    const qrText = `DH:${order.id}|${order.totalPrice}`;
                    qrData = await generateQRCode(qrText);
                }

                if (qrData) {
                    doc.addImage(qrData, 'PNG', qrX, qrY, qrSize, qrSize);
                    
                    // Text "Quét thanh toán" dưới QR
                    doc.setFontSize(7);
                    doc.setFont('Roboto', 'bold');
                    doc.setTextColor(0);
                    doc.text("Quét thanh toán", qrX + (qrSize/2), footerY + 4, { align: 'center' });
                }
            } catch (e) {
                console.error("QR Gen failed", e);
            }

            // B. Tổng tiền (Bên Trái)
            doc.setTextColor(0, 0, 0);
            const isCOD = order.paymentMethod === 'CASH';
            
            // Mũi tên chỉ vào QR (Từ giá tiền chỉ sang phải)
            drawArrow(doc, qrX - 3, footerY - (qrSize/2) + 2);

            if (isCOD) {
                doc.setFontSize(10);
                doc.setFont('Roboto', 'normal');
                doc.text("Thu hộ (COD):", pX, footerY - 11);
                
                doc.setFontSize(24); // Siêu to
                doc.setFont('Roboto', 'bold');
                doc.text(`${new Intl.NumberFormat('vi-VN').format(order.totalPrice)}`, pX, footerY);
            } else {
                // Hộp "ĐÃ THANH TOÁN" bên trái
                doc.setDrawColor(0);
                doc.setLineWidth(0.5);
                doc.rect(pX, footerY - 13, 45, 15); 
                
                doc.setFontSize(12);
                doc.setFont('Roboto', 'bold');
                doc.text("KHÔNG THU", pX + 22.5, footerY - 6, { align: 'center' });
                
                doc.setFontSize(7);
                doc.setFont('Roboto', 'italic');
                doc.text("(Đã thanh toán)", pX + 22.5, footerY - 2, { align: 'center' });
            }

            // Next Grid Position
            col++;
            if (col >= 2) {
                col = 0;
                row++;
            }
            // Add page if needed
            if (row >= 4 && i < orders.length - 1) {
                doc.addPage();
                col = 0;
                row = 0;
            }
        }

        doc.save(`Tem_${batchName}.pdf`);
    },

    // --- MODE 1: SINGLE COLUMN LIST (HIGH DENSITY TABLE) ---
    // Updated: High density (50 rows/page), Bold Address, Explicit Quantity, Payment Status
    generateCompactList: async (orders: Order[], batchId: string) => {
        const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4' });
        
        await loadFonts(doc);
        const fontName = 'Roboto';

        // --- PAGE CONFIG ---
        const pageW = 210;
        const pageH = 297;
        const margin = 5; 
        const headerH = 12; 
        const tableW = pageW - (margin * 2); // 200mm
        
        // --- COLUMN WIDTHS (Total 200mm) ---
        const wIdx = 8;
        const wCust = 42; 
        const wAddr = 65; // Wide for address
        const wItem = 45; // Items
        const wNote = 15; 
        const wPrice = 25; 

        // X Positions
        const xIdx = margin;
        const xCust = xIdx + wIdx;
        const xAddr = xCust + wCust;
        const xItem = xAddr + wAddr;
        const xNote = xItem + wItem;
        const xPrice = xNote + wNote;

        let currentY = headerH + 5;
        
        // --- HIGH DENSITY SETTINGS ---
        const fontSize = 7; 
        const rowPadding = 1; 
        const lineHeight = 3; 

        // Data Prep
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

            // Doc Title
            doc.setFontSize(10);
            doc.setFont(fontName, 'bold');
            doc.setTextColor(0, 0, 0);
            doc.text(`${batchId} (${new Date().toLocaleDateString('vi-VN')}) - Tổng: ${validOrders.length} đơn`, margin, 8);
            
            doc.setFontSize(8);
            doc.setFont(fontName, 'normal');
            doc.text(`Trang ${pageNo}`, pageW - margin, 8, { align: 'right' });
            
            // --- TABLE HEADER (BLACK BG) ---
            const hY = 10;
            const hHeight = 5;
            
            doc.setFillColor(0, 0, 0);
            doc.rect(margin, hY, tableW, hHeight, 'F');
            doc.setTextColor(255, 255, 255); 
            doc.setFontSize(7);
            doc.setFont(fontName, 'bold');
            
            // Dividers
            doc.setDrawColor(255, 255, 255);
            doc.setLineWidth(0.2);
            doc.line(xCust, hY, xCust, hY + hHeight);
            doc.line(xAddr, hY, xAddr, hY + hHeight);
            doc.line(xItem, hY, xItem, hY + hHeight);
            doc.line(xNote, hY, xNote, hY + hHeight);
            doc.line(xPrice, hY, xPrice, hY + hHeight);

            // Text
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
            
            // --- PREPARE CONTENT ---
            doc.setFontSize(fontSize);
            
            // 1. Customer: Name - Phone (BOLD)
            doc.setFont(fontName, 'bold');
            const custText = `${o.customerName} - ${o.customerPhone}`;
            const custLines = doc.splitTextToSize(custText, wCust - 1.5);
            
            // 2. Address (BOLD)
            doc.setFont(fontName, 'bold');
            const addrLines = doc.splitTextToSize(o.address, wAddr - 1.5);
            
            // 3. Items (Normal)
            doc.setFont(fontName, 'normal');
            // Explicit Quantity Display: "Name (SL: 2)"
            const itemsStr = o.items.map(it => `${it.name} (SL:${it.quantity})`).join(', ');
            const itemsLines = doc.splitTextToSize(itemsStr, wItem - 1.5);
            
            // 4. Notes (Italic)
            doc.setFont(fontName, 'italic');
            const noteText = o.notes || '';
            const noteLines = doc.splitTextToSize(noteText, wNote - 1.5);
            
            // 5. Price & Payment (Bold)
            doc.setFont(fontName, 'bold');
            let priceText = new Intl.NumberFormat('vi-VN').format(o.totalPrice);
            
            // Payment Logic: Clearly distinguish status for Manifest
            if (o.paymentMethod === PaymentMethod.PAID) {
                priceText += " (Đã TT)";
            } else if (o.paymentMethod === PaymentMethod.TRANSFER) {
                if (o.paymentVerified) {
                    priceText += " (CK Rồi)";
                } else {
                    priceText += " (CK)";
                }
            } else if (o.paymentMethod === PaymentMethod.CASH) {
                priceText += " (TM)"; 
            }
            const priceLines = doc.splitTextToSize(priceText, wPrice - 1.5);

            // --- CALCULATE ROW HEIGHT ---
            const maxLines = Math.max(
                custLines.length, 
                addrLines.length, 
                itemsLines.length, 
                noteLines.length,
                priceLines.length,
                1
            );
            const rowHeight = (maxLines * lineHeight) + (rowPadding * 2);

            // Check Page Break
            if (currentY + rowHeight > pageH - 10) {
                doc.addPage();
                pageIndex++;
                currentY = drawPageHeader(pageIndex);
            }

            // --- DRAW ROW ---
            const textY = currentY + rowPadding + 2; 

            doc.setDrawColor(0, 0, 0);
            doc.setLineWidth(0.1);
            doc.rect(margin, currentY, tableW, rowHeight); 
            
            doc.line(xCust, currentY, xCust, currentY + rowHeight);
            doc.line(xAddr, currentY, xAddr, currentY + rowHeight);
            doc.line(xItem, currentY, xItem, currentY + rowHeight);
            doc.line(xNote, currentY, xNote, currentY + rowHeight);
            doc.line(xPrice, currentY, xPrice, currentY + rowHeight);

            // 1. STT
            doc.setFont(fontName, 'bold');
            doc.text(`${i + 1}`, xIdx + (wIdx/2), textY, { align: 'center' });

            // 2. Customer (Bold)
            doc.text(custLines, xCust + 1, textY);

            // 3. Address (Bold)
            doc.text(addrLines, xAddr + 1, textY);

            // 4. Items (Normal)
            doc.setFont(fontName, 'normal');
            doc.text(itemsLines, xItem + 1, textY);

            // 5. Notes (Italic)
            doc.setFont(fontName, 'italic');
            doc.text(noteLines, xNote + 1, textY);

            // 6. Price (Bold)
            doc.setFont(fontName, 'bold');
            doc.text(priceLines, xPrice + wPrice - 1, textY, { align: 'right' });

            currentY += rowHeight;
        }

        // --- SUMMARY FOOTER ---
        // Ensure summary doesn't break awkwardly
        if (pageH - currentY < 30) {
            doc.addPage();
            currentY = 15;
        } else {
            currentY += 2;
        }

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
        
        // Get Products for Stats (Read directly from LocalStorage to avoid async/UI issues in this pure function)
        let products: Product[] = [];
        try {
            products = JSON.parse(localStorage.getItem('ecogo_products_v1') || '[]');
        } catch {}
        
        const summaryParts = Object.entries(itemSummary)
            .sort((a,b) => a[0].localeCompare(b[0]))
            .map(([name, qtyOrdered]) => {
                // Find product by fuzzy name matching
                const normName = normalizeString(name);
                const p = products.find(p => normalizeString(p.name) === normName) 
                       || products.find(p => normalizeString(p.name).includes(normName));
                
                if (p) {
                    // UPDATED: Show ONLY Ordered and Stock (No Imported/Balance)
                    return `${name}: ${qtyOrdered} [Tồn: ${p.stockQuantity || 0}]`;
                }
                return `${name}: ${qtyOrdered}`;
            });

        const summaryText = "TỔNG HÀNG (Đặt | Tồn):  " + summaryParts.join('   ');
            
        const sumLines = doc.splitTextToSize(summaryText, tableW);
        doc.text(sumLines, margin, currentY);

        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        doc.save(`DS_${batchId}_${dateStr}.pdf`);
    }
};
