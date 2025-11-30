
import jsPDF from 'jspdf';
import QRCode from 'qrcode';
import { Order, PaymentMethod } from '../types';
import { storageService } from './storageService';

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
    // Fallback common mappings
    'TIMO': '961023',
    'VIETMONEY': '970422', 
    'CAKE': '970432',
    'UOB': '970458',
    'CIMB': '422589'
};

/* CRC16-CCITT (0xFFFF) Implementation for EMVCo */
const crc16 = (data: string): string => {
    let crc = 0xFFFF;
    for (let i = 0; i < data.length; i++) {
        crc ^= data.charCodeAt(i) << 8;
        for (let j = 0; j < 8; j++) {
            if ((crc & 0x8000) !== 0) {
                crc = (crc << 1) ^ 0x1021;
            } else {
                crc = crc << 1;
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
              .replace(/[^a-zA-Z0-9 ]/g, ''); // Only alphanumeric allowed in VietQR content
};

const generateVietQRPayload = (bankId: string, accountNo: string, amount: number, content: string): string => {
    // 1. Setup Data
    const bin = BANK_BIN_MAP[bankId.toUpperCase()] || BANK_BIN_MAP['MB']; // Default to MB if unknown
    const cleanContent = removeAccents(content).substring(0, 20); // Limit length
    
    // 2. Build Consumer Account Information (Tag 38)
    // GUID for VietQR: A000000727
    const guid = formatField('00', 'A000000727');
    // Beneficiary Organization (Tag 01) -> BIN (00) + Account (01)
    const beneficiaryBank = formatField('00', bin) + formatField('01', accountNo);
    const consumerInfo = formatField('01', beneficiaryBank);
    // Service Code (Tag 02): QRIBFTTA (Quick Transfer)
    const serviceCode = formatField('02', 'QRIBFTTA');
    
    const tag38Value = guid + consumerInfo + serviceCode;

    // 3. Construct Full Payload
    let payload = '';
    payload += formatField('00', '01'); // Payload Format Indicator
    payload += formatField('01', '12'); // Point of Initiation Method (12 = Dynamic)
    payload += formatField('38', tag38Value); // Merchant Account Information
    payload += formatField('53', '704'); // Transaction Currency (VND)
    payload += formatField('54', amount.toString()); // Transaction Amount
    payload += formatField('58', 'VN'); // Country Code
    
    // Additional Data Field (Tag 62) - Reference Label
    const additionalData = formatField('08', cleanContent);
    payload += formatField('62', additionalData);

    // 4. Add CRC (Tag 63)
    payload += '6304'; // ID 63 + Length 04
    const crc = crc16(payload);
    return payload + crc;
};

// --- FONT CACHING SYSTEM ---
let _fontCache: string | null = null;

const fetchFont = async (): Promise<string | null> => {
    if (_fontCache) return _fontCache;

    try {
        // Load font from CDN (Roboto Regular)
        const response = await fetch('https://cdnjs.cloudflare.com/ajax/libs/pdfmake/0.2.7/fonts/Roboto/Roboto-Regular.ttf');
        if (!response.ok) throw new Error("Failed to load font");
        
        const blob = await response.blob();
        
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64data = reader.result as string;
                // Remove data:application/octet-stream;base64, prefix
                const content = base64data.split(',')[1];
                if (content) {
                    _fontCache = content;
                    resolve(content);
                } else {
                    resolve(null);
                }
            };
            reader.onerror = () => {
                 console.warn("FileReader failed to parse font");
                 resolve(null);
            };
            reader.readAsDataURL(blob);
        });
    } catch (e) {
        console.warn("Could not load Vietnamese font, fallback to standard Helvetica.", e);
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
    doc.setLineDashPattern([], 0); // Reset
};

export const pdfService = {
    // --- MODE 1: COMPACT LIST (2 COLUMNS - ~50 orders/page) ---
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

        const logoBase64 = storageService.getLogo();
        
        // --- PAGE CONFIG ---
        const pageH = 297;
        const pageW = 210;
        const margin = 5;
        const headerH = 25;
        const footerH = 10;
        
        // Column Config
        const colGap = 5;
        const colW = (pageW - (margin * 2) - colGap) / 2; // ~97.5mm
        
        // Content Config
        const startY = headerH;
        const contentH = pageH - headerH - footerH;
        const rowH = 11; // 10mm height per order
        const rowsPerCol = Math.floor(contentH / rowH); // ~26 rows
        const ordersPerPage = rowsPerCol * 2; // ~52 orders

        let totalAmount = 0;
        const itemSummary: Record<string, number> = {};

        // Prepare Summary Data
        orders.forEach(o => {
            totalAmount += o.totalPrice;
            o.items.forEach(item => {
                const name = item.name.trim();
                if(name) itemSummary[name] = (itemSummary[name] || 0) + item.quantity;
            });
        });

        // HELPER: Draw Header on New Page
        const drawHeader = (pageNo: number) => {
            if (logoBase64) {
                try { doc.addImage(logoBase64, 'PNG', margin, 5, 12, 12, undefined, 'FAST'); } catch(e){}
            }
            doc.setFontSize(14);
            doc.setFont(fontName, 'bold');
            doc.text("DANH SÁCH GIAO HÀNG", pageW / 2, 10, { align: 'center' });
            
            doc.setFontSize(9);
            doc.setFont(fontName, 'normal');
            doc.text(`Lô: ${batchId} | ${new Date().toLocaleDateString('vi-VN')} | Trang ${pageNo}`, pageW / 2, 16, { align: 'center' });
            
            // Draw Column Headers
            doc.setFontSize(8);
            doc.setFont(fontName, 'bold');
            doc.setFillColor(230, 230, 230);
            
            // Col 1 Header
            doc.rect(margin, 20, colW, 5, 'F');
            doc.text("#", margin + 2, 23.5);
            doc.text("Khách / ĐC / Hàng", margin + 8, 23.5);
            doc.text("Thu hộ", margin + colW - 2, 23.5, { align: 'right' });

            // Col 2 Header
            const col2X = margin + colW + colGap;
            doc.rect(col2X, 20, colW, 5, 'F');
            doc.text("#", col2X + 2, 23.5);
            doc.text("Khách / ĐC / Hàng", col2X + 8, 23.5);
            doc.text("Thu hộ", col2X + colW - 2, 23.5, { align: 'right' });
        };

        let pageIndex = 1;
        drawHeader(pageIndex);

        // --- RENDER LOOP ---
        for (let i = 0; i < orders.length; i++) {
            const o = orders[i];
            
            // Calculate Position
            const indexInPage = i % ordersPerPage;
            if (i > 0 && indexInPage === 0) {
                doc.addPage();
                pageIndex++;
                drawHeader(pageIndex);
            }

            const colIndex = indexInPage < rowsPerCol ? 0 : 1;
            const rowIndex = indexInPage % rowsPerCol;
            
            const x = margin + (colIndex * (colW + colGap));
            const y = startY + (rowIndex * rowH);

            // Draw Row Content
            // 1. Index
            doc.setFontSize(8);
            doc.setFont(fontName, 'bold');
            doc.text(`${i + 1}`, x + 2, y + 4);
            
            // 2. Customer Name (Bold)
            doc.setFontSize(8);
            doc.text(o.customerName, x + 8, y + 4);
            
            // Phone (Small next to name)
            doc.setFont(fontName, 'normal');
            doc.setFontSize(7);
            doc.text(` - ${o.customerPhone}`, x + 8 + doc.getTextWidth(o.customerName), y + 4);

            // 3. Address (Truncated line 1)
            const addrWidth = colW - 35; // Space for address
            const addr = o.address.length > 35 ? o.address.substring(0, 32) + "..." : o.address;
            doc.text(addr, x + 8, y + 7);

            // 4. Items (Line 2)
            doc.setFontSize(7);
            const items = o.items.map(it => `${it.name}(${it.quantity})`).join(', ');
            let itemStr = items;
            if (doc.getTextWidth(items) > addrWidth) {
                 // Simple truncate for compact view
                 itemStr = items.substring(0, 50) + "...";
            }
            doc.text(itemStr, x + 8, y + 10);

            // 5. Money
            doc.setFontSize(9);
            doc.setFont(fontName, 'bold');
            const price = new Intl.NumberFormat('vi-VN').format(o.totalPrice);
            doc.text(price, x + colW - 2, y + 5, { align: 'right' });
            
            // Payment Method
            doc.setFontSize(6);
            doc.setFont(fontName, 'normal');
            const method = o.paymentMethod === PaymentMethod.CASH ? 'TM' : (o.paymentVerified ? 'Đã CK' : 'Chờ CK');
            doc.text(method, x + colW - 2, y + 9, { align: 'right' });

            // Separator Line
            doc.setDrawColor(240, 240, 240);
            doc.line(x, y + rowH, x + colW, y + rowH);
        }

        // --- SUMMARY PAGE ---
        doc.addPage();
        doc.setFontSize(14);
        doc.setFont(fontName, 'bold');
        doc.text("TỔNG HỢP", pageW / 2, 15, { align: 'center' });
        
        doc.setFontSize(11);
        doc.text(`Tổng đơn: ${orders.length}`, 20, 30);
        doc.text(`Tổng tiền: ${new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(totalAmount)}`, 20, 38);

        doc.text("HÀNG HÓA CẦN CHUẨN BỊ:", 20, 50);
        doc.setFontSize(10);
        doc.setFont(fontName, 'normal');
        
        let sumY = 60;
        const sortedSummary = Object.entries(itemSummary).sort((a, b) => a[0].localeCompare(b[0]));
        
        sortedSummary.forEach(([name, qty]) => {
            if (sumY > 280) {
                doc.addPage();
                sumY = 20;
            }
            doc.text(name, 20, sumY);
            doc.setLineDashPattern([1, 1], 0);
            doc.line(100, sumY, 170, sumY);
            doc.setLineDashPattern([], 0);
            doc.setFont(fontName, 'bold');
            doc.text(qty.toString(), 180, sumY, { align: 'right' });
            doc.setFont(fontName, 'normal');
            sumY += 7;
        });

        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        doc.save(`DanhSach_${batchId}_${dateStr}.pdf`);
    },

    // --- MODE 2: MODERN INVOICE GRID (8 TEM/A4) ---
    // Updated Layout: Professional, Clean Grid, High Priority on Total & ID
    generateInvoiceBatch: async (orders: Order[], batchId: string) => {
        const doc = new jsPDF({
            orientation: 'p',
            unit: 'mm',
            format: 'a4',
            putOnlyUsedFonts: true,
            floatPrecision: 16
        });

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

        const logoBase64 = storageService.getLogo();
        const bankConfig = await storageService.getBankConfig();

        // BRAND COLORS
        const COLOR_PRIMARY = [21, 128, 61]; // Eco Green #15803d
        const COLOR_TEXT = [31, 41, 55];     // Gray 800
        const COLOR_LIGHT = [107, 114, 128]; // Gray 500

        const pageWidth = 210;
        const pageHeight = 297;
        const marginLeft = 0; // Use almost full width, margins handled inside cell
        const marginTop = 0;
        
        // Grid Config
        const cols = 2;
        const rows = 4;
        const cellWidth = pageWidth / cols; // 105mm
        const cellHeight = pageHeight / rows; // 74.25mm
        const padding = 5; // Internal padding inside each invoice

        for (let i = 0; i < orders.length; i++) {
            const order = orders[i];
            
            if (i > 0 && i % 8 === 0) {
                doc.addPage();
                doc.setFont(fontName); 
            }

            const posInPage = i % 8;
            const colIndex = posInPage % 2;
            const rowIndex = Math.floor(posInPage / 2);

            // Absolute Coords for this Cell
            const x = colIndex * cellWidth;
            const y = rowIndex * cellHeight;

            // --- 1. CUTTING MARKS (Gray Dashed) ---
            doc.setDrawColor(200, 200, 200);
            doc.setLineWidth(0.1);
            if (colIndex === 0) drawDashedLine(doc, x + cellWidth, y, x + cellWidth, y + cellHeight); // Vert
            if (rowIndex < rows - 1) drawDashedLine(doc, x, y + cellHeight, x + cellWidth * 2, y + cellHeight); // Horz

            // Working Area (With Padding)
            const wx = x + padding;
            const wy = y + padding;
            const wWidth = cellWidth - (padding * 2);
            const wHeight = cellHeight - (padding * 2);

            // --- 2. HEADER BAR (Solid Green) ---
            const headerH = 9;
            doc.setFillColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]);
            doc.rect(x, y, cellWidth, headerH + 2, 'F'); // Full width header strip + slight bleed

            // Logo & Brand Name
            if (logoBase64) {
                try {
                    doc.addImage(logoBase64, 'PNG', wx, y + 1.5, 8, 8, undefined, 'FAST');
                } catch (e) {}
            }
            doc.setTextColor(255, 255, 255);
            doc.setFontSize(10);
            doc.setFont(fontName, 'bold');
            doc.text("ECOGO LOGISTICS", wx + (logoBase64 ? 10 : 0), y + 7);
            
            // Right Header Text (Optional hotline/web)
            doc.setFontSize(7);
            doc.setFont(fontName, 'normal');
            doc.text("Hotline: 0909...", x + cellWidth - padding, y + 7, { align: 'right' });

            // Reset Text Color
            doc.setTextColor(COLOR_TEXT[0], COLOR_TEXT[1], COLOR_TEXT[2]);

            // --- 3. METADATA BLOCK (Order ID & Date) ---
            let cy = y + headerH + 6; // Current Y cursor
            
            // Order ID (Big & Bold)
            doc.setFontSize(12);
            doc.setFont(fontName, 'bold');
            doc.text(`#${order.id}`, wx, cy);

            // Date (Right aligned, lighter)
            doc.setTextColor(COLOR_LIGHT[0], COLOR_LIGHT[1], COLOR_LIGHT[2]);
            doc.setFontSize(8);
            doc.setFont(fontName, 'normal');
            doc.text(new Date(order.createdAt).toLocaleDateString('vi-VN'), x + cellWidth - padding, cy, { align: 'right' });
            
            cy += 5;

            // --- 4. CUSTOMER INFO ---
            doc.setTextColor(COLOR_TEXT[0], COLOR_TEXT[1], COLOR_TEXT[2]);
            // Name
            doc.setFontSize(9);
            doc.setFont(fontName, 'bold');
            doc.text(order.customerName, wx, cy);
            
            // Phone
            const nameWidth = doc.getTextWidth(order.customerName);
            doc.setFont(fontName, 'normal');
            doc.setFontSize(9);
            doc.text(` - ${order.customerPhone}`, wx + nameWidth, cy);

            cy += 4.5;
            // Address (Limit width)
            doc.setFontSize(8);
            doc.setTextColor(COLOR_LIGHT[0], COLOR_LIGHT[1], COLOR_LIGHT[2]);
            const addr = order.address.length > 55 ? order.address.substring(0, 52) + "..." : order.address;
            doc.text(addr, wx, cy);

            // Divider Line
            cy += 3;
            doc.setDrawColor(220, 220, 220);
            doc.setLineWidth(0.1);
            doc.line(wx, cy, x + cellWidth - padding, cy);
            
            cy += 4;

            // --- 5. ITEMS LIST ---
            // Render max 3-4 items to fit
            doc.setTextColor(COLOR_TEXT[0], COLOR_TEXT[1], COLOR_TEXT[2]);
            doc.setFontSize(8);
            
            const MAX_ITEMS = 4;
            const itemsToShow = order.items.slice(0, MAX_ITEMS);
            
            itemsToShow.forEach(item => {
                const name = item.name.length > 30 ? item.name.substring(0, 28) + ".." : item.name;
                doc.text(name, wx, cy);
                
                // Qty & Price
                const meta = `x${item.quantity}`;
                doc.setFont(fontName, 'bold');
                doc.text(meta, x + cellWidth - padding - 20, cy, { align: 'right' });
                
                // If needed, can show price per item, but usually total is enough for labels
                // doc.text(formatMoney(item.price * item.quantity), x + cellWidth - padding, cy, { align: 'right' });
                
                doc.setFont(fontName, 'normal');
                cy += 4;
            });
            
            if (order.items.length > MAX_ITEMS) {
                doc.setFontSize(7);
                doc.setTextColor(COLOR_LIGHT[0], COLOR_LIGHT[1], COLOR_LIGHT[2]);
                doc.text(`...và ${order.items.length - MAX_ITEMS} sản phẩm khác`, wx, cy);
            }

            // --- 6. FOOTER (Total & QR) ---
            const footerY = y + cellHeight - padding;
            
            // QR Code (Bottom Left)
            const qrSize = 16;
            const qrX = wx;
            const qrY = footerY - qrSize + 2;

            if (bankConfig && bankConfig.accountNo && order.paymentMethod !== PaymentMethod.PAID) {
                // Generate VietQR
                const content = `DH ${order.id}`;
                const qrString = generateVietQRPayload(bankConfig.bankId, bankConfig.accountNo, order.totalPrice, content);
                const qrBase64 = await generateQRCode(qrString);
                if (qrBase64) {
                    doc.addImage(qrBase64, 'PNG', qrX, qrY, qrSize, qrSize);
                }
                doc.setFontSize(6);
                doc.text("Quét để TT", qrX + (qrSize/2), qrY + qrSize + 2, { align: 'center' });
            } else if (order.paymentMethod === PaymentMethod.PAID) {
                // Paid Badge
                doc.setDrawColor(21, 128, 61); // Green
                doc.roundedRect(qrX, footerY - 10, 25, 8, 1, 1, 'D');
                doc.setTextColor(21, 128, 61);
                doc.setFontSize(8);
                doc.setFont(fontName, 'bold');
                doc.text("ĐÃ THANH TOÁN", qrX + 12.5, footerY - 5, { align: 'center' });
            } else {
                // COD Badge
                doc.setDrawColor(100, 100, 100); 
                doc.roundedRect(qrX, footerY - 10, 20, 8, 1, 1, 'D');
                doc.setTextColor(100, 100, 100);
                doc.setFontSize(8);
                doc.setFont(fontName, 'bold');
                doc.text("COD", qrX + 10, footerY - 5, { align: 'center' });
            }

            // TOTAL (Bottom Right - HUGE)
            doc.setTextColor(COLOR_PRIMARY[0], COLOR_PRIMARY[1], COLOR_PRIMARY[2]); // Green
            doc.setFontSize(16);
            doc.setFont(fontName, 'bold');
            const totalStr = `${new Intl.NumberFormat('vi-VN').format(order.totalPrice)}đ`;
            doc.text(totalStr, x + cellWidth - padding, footerY - 4, { align: 'right' });
            
            // Label "Tổng cộng"
            doc.setTextColor(COLOR_LIGHT[0], COLOR_LIGHT[1], COLOR_LIGHT[2]);
            doc.setFontSize(7);
            doc.setFont(fontName, 'normal');
            doc.text("TỔNG CỘNG", x + cellWidth - padding, footerY - 11, { align: 'right' });
        }

        const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        doc.save(`HoaDon8Up_${batchId}_${dateStr}.pdf`);
    }
};
